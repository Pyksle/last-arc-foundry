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
const page = await browser.newPage();

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
    const runner = await globalThis.quench.runAllBatches();

    // runAllBatches resolves with the Mocha runner; wait for it to finish.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Quench timed out")), timeout);
      if (runner.stats?.end) { clearTimeout(timer); return resolve(); }
      runner.once("end", () => { clearTimeout(timer); resolve(); });
    });

    const failures = [];
    runner.on?.("fail", () => {});   // no-op; collected below

    return {
      stats: { ...runner.stats },
      failures: (runner.failures ?? []).map((t) => ({
        title: t.fullTitle?.() ?? t.title,
        error: t.err?.message ?? String(t.err)
      }))
    };
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
  const form = page.locator("form#join-game, form.join-form").first();
  if (!(await form.count())) return;

  try {
    await form.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;   // already joined
  }

  console.log(`→ joining as ${USER}`);
  const select = page.locator("select[name='userid']").first();
  if (await select.count()) {
    await select.selectOption({ label: USER }).catch(async () => {
      // Some setups list users by id rather than label.
      await select.selectOption({ index: 1 });
    });
  }

  if (PASSWORD) await page.fill("input[name='password']", PASSWORD);
  await page.click("button[name='join'], button[type='submit']");
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
