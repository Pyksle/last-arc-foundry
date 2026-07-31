/**
 * Drive Quench's test batches inside a running headless Foundry.
 *
 * The plain-node suite (`npm test`) verifies the maths. This verifies that the
 * maths is wired to Foundry correctly — document creation, derived data on live
 * actors, Active Effect ordering, sheet rendering, combat sorting. None of that
 * can be checked without a real Foundry.
 *
 * ── Prerequisites ───────────────────────────────────────────────────────────
 *
 *   1. Foundry's Node.js build running and licensed (see README).
 *   2. A world using the `last-arc` system, launched.
 *   3. The Quench module installed AND enabled in that world.
 *   4. `npm i -D playwright && npx playwright install chromium`
 *
 * Playwright is deliberately NOT a hard dependency in package.json — it pulls
 * ~100MB of browser binaries, which has no business being mandatory for a
 * contributor who only wants to run the unit tests.
 *
 *   node tools/integration-test.mjs [--url=http://localhost:30000] [--headed]
 */

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const URL_BASE = arg("url") ?? process.env.FOUNDRY_URL ?? "http://localhost:30000";
const USER = arg("user") ?? process.env.FOUNDRY_USER ?? "Gamemaster";
const PASSWORD = arg("password") ?? process.env.FOUNDRY_PASSWORD ?? "";
const HEADED = process.argv.includes("--headed");
const TIMEOUT = Number(arg("timeout") ?? 180_000);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "playwright is not installed.\n\n" +
    "  npm i -D playwright && npx playwright install chromium\n\n" +
    "It is optional on purpose — the unit suite (npm test) needs nothing extra."
  );
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

const browser = await chromium.launch({ headless: !HEADED });

// Foundry hard-requires 1024x768 and logs a console *error* below that — and
// Playwright's default viewport is 1280x720, which is 48px too short. Without
// this the run trips the console-error check on every invocation regardless of
// whether anything is actually wrong.
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// Surface browser-side errors: a system that throws during init produces a
// perfectly clean-looking run of zero tests otherwise.
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`Uncaught: ${err.message}`));

let exitCode = 0;

try {
  console.log(`→ ${URL_BASE}`);
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await joinAsUser(page);

  console.log("→ waiting for game.ready");
  await page.waitForFunction(() => globalThis.game?.ready === true, { timeout: 120_000 });

  const hasQuench = await page.evaluate(() => !!globalThis.quench);
  if (!hasQuench) {
    throw new Error(
      "Quench is not active in this world. Install the Quench module and enable it " +
      "in Game Settings → Manage Modules."
    );
  }

  console.log("→ running Quench batches");
  const results = await page.evaluate(async (timeout) => {
    // Quench's Mocha reporter writes results into its own QuenchResults window.
    // If that window has never been rendered its `element` is undefined, every
    // reporter callback throws "Cannot read properties of undefined (reading
    // 'querySelector')", and the run dies before a single test executes —
    // presenting as a bare timeout with zero tests run. Render it first.
    await globalThis.quench.app.render(true);

    // `runBatches(filter = "**")` defaults to every registered batch and
    // resolves with the Mocha runner — the tests are still going at that point.
    const runner = await globalThis.quench.runBatches();

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Quench timed out")), timeout);
      const done = () => { clearTimeout(timer); resolve(); };
      if (runner.stats?.end) return done();
      runner.once("end", done);
    });

    // Walk the finished suite tree rather than listening for "fail" events.
    // A listener attached after `runBatches` resolves can race past failures
    // that already fired, and `runner.failures` is a COUNT in Mocha, not a
    // list — calling .map on it throws and turns a red run into a crash.
    const failures = [];
    (function walk(suite) {
      for (const t of suite.tests ?? []) {
        if (t.state === "failed") {
          failures.push({
            title: t.fullTitle?.() ?? t.title,
            error: t.err?.stack ?? t.err?.message ?? String(t.err)
          });
        }
      }
      for (const s of suite.suites ?? []) walk(s);
    })(runner.suite);

    return { stats: { ...runner.stats }, failures };
  }, TIMEOUT);

  report(results);
  if ((results.stats.failures ?? 0) > 0) exitCode = 1;

} catch (err) {
  console.error(`\n✖ ${err.message}`);
  exitCode = 1;
} finally {
  if (consoleErrors.length) {
    console.error(`\n${consoleErrors.length} browser console error(s):`);
    for (const e of consoleErrors.slice(0, 25)) console.error(`  ${e}`);
    // Console errors during a passing run still indicate something is wrong.
    if (exitCode === 0) exitCode = 1;
  }
  await browser.close();
}

process.exit(exitCode);

/* -------------------------------------------------------------------------- */

/**
 * Get past the join screen.
 *
 * Foundry shows a user-select form when a world is running. If the browser
 * already has a session the page goes straight to the game, so this tolerates
 * the form being absent.
 */
async function joinAsUser(page) {
  // Anchor on the user <select> rather than the form. In v13 the form is
  // `#join-game-form`, and there is a second `#join-game-setup` form on the same
  // page posting to the same endpoint — matching on form id is both
  // version-fragile and ambiguous. `select[name="userid"]` appears exactly once
  // and only on the join screen.
  const select = page.locator("select[name='userid']").first();

  try {
    await select.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;   // already joined, or the world auto-joined a single user
  }

  // Foundry disables the <option> for any user already logged in, so the
  // requested user may be unselectable simply because a browser tab is sitting
  // on that session. Fall back to any free user rather than timing out for 30s
  // on a disabled option.
  const options = await select.evaluate((el) =>
    [...el.options].map((o) => ({ label: o.label, value: o.value, disabled: o.disabled }))
  );
  const free = options.filter((o) => o.value && !o.disabled);
  const target = free.find((o) => o.label === USER) ?? free[0];

  if (!target) {
    const taken = options.filter((o) => o.value).map((o) => o.label).join(", ");
    throw new Error(
      `No user is available to join — every user is already logged in (${taken}). ` +
      `Close the browser tab holding that session, or add a second Gamemaster ` +
      `user in the world for the test driver to use.`
    );
  }

  console.log(`→ joining as ${target.label}`);
  await select.selectOption({ value: target.value });

  if (PASSWORD) await page.fill("#join-game-form input[name='password']", PASSWORD);
  await page.click("button[name='join']");
}

function report({ stats, failures }) {
  const { tests = 0, passes = 0, failures: failed = 0, pending = 0, duration = 0 } = stats;

  console.log("");
  console.log(`  tests    ${tests}`);
  console.log(`  passing  ${passes}`);
  console.log(`  failing  ${failed}`);
  if (pending) console.log(`  pending  ${pending}`);
  console.log(`  duration ${duration}ms`);

  if (failures?.length) {
    console.log("\n  failures:");
    for (const f of failures) {
      console.log(`\n  ✖ ${f.title}`);
      console.log(`    ${f.error}`);
    }
  }
  console.log("");
}
