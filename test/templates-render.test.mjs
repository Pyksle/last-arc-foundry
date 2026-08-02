/**
 * Every template compiles, and everything it reaches for exists.
 *
 * WHY THIS EXISTS. Quench has an "it renders the character sheet without
 * throwing" test — arguably the most valuable of its 79 — and Quench has never
 * run, because it needs a licensed Foundry and a live world. The offline
 * fallback, `tools/preview.mjs`, could have covered the same ground without
 * Foundry. It had been THROWING ON STARTUP since the first Handlebars partial
 * was introduced: it never registered `laItemOrder` or `laStatusPalette`, and a
 * missing partial is an exception, not a blank.
 *
 * Nobody noticed because nothing runs a dev tool. So the project's only offline
 * check on whether a sheet renders at all was itself unchecked, and every sheet
 * change for weeks shipped with "not verified in a live Foundry" attached to it
 * — true, and more true than intended.
 *
 * Importing the harness is the test. If a template gains a partial, a helper or
 * a syntax error, this goes red on the next `npm test` instead of the next time
 * someone happens to run the preview.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The import itself compiles and renders the character sheet, both chat cards
// and the item sheet against the synthetic context. A throw fails the suite.
import { Handlebars, PARTIALS, buildContext, root } from "../tools/preview.mjs";

const read = (p) => readFileSync(join(root, p), "utf8");
const slurp = (d) => readdirSync(join(root, d), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? slurp(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const templates = slurp("templates").filter((p) => p.endsWith(".hbs"));

describe("§ every template compiles and resolves what it references", () => {
  test("there are templates to check", () => {
    assert.ok(templates.length >= 8, `only found ${templates.length}`);
  });

  test("each one compiles", () => {
    for (const t of templates) {
      assert.doesNotThrow(() => Handlebars.compile(read(t)), `${t} does not compile`);
    }
  });

  /**
   * The exact failure that broke the harness. A partial is resolved at RENDER
   * time, so an unregistered one is invisible until something actually renders
   * — which, for a dev tool nobody runs, is never.
   */
  test("every partial a template uses is registered", () => {
    const used = new Set();
    for (const t of templates) {
      for (const m of read(t).matchAll(/\{\{>\s*([\w-]+)/g)) used.add(m[1]);
    }
    const missing = [...used].filter((p) => !Handlebars.partials[p]);
    assert.deepEqual(missing, [],
      `these partials are used and never registered, which throws on render:\n  ${missing.join("\n  ")}`);
  });

  /**
   * The harness must register the same partials the SYSTEM does. If they drift,
   * the preview renders something the player will never see.
   */
  test("the harness registers the same partials as the system", () => {
    const src = read("module/last-arc.mjs");
    const system = [...src.matchAll(/^\s*(la\w+):\s*`systems\/\$\{SYSTEM_ID\}\/([\w/.-]+)`/gm)]
      .map(([, name, path]) => `${name}=${path}`).sort();
    const harness = Object.entries(PARTIALS).map(([n, p]) => `${n}=${p}`).sort();

    assert.deepEqual(harness, system,
      "tools/preview.mjs and registerPartials() disagree about the partial set, " +
      "so the preview is rendering a different sheet from the one that ships");
  });

  /**
   * Handlebars silently renders an unknown `{{key}}` as empty, but an unknown
   * HELPER throws. Both matter; only the second is catchable this way, and it
   * is the one that takes the whole sheet down.
   */
  test("every helper a template invokes is registered", () => {
    const BUILTIN = new Set(["if", "unless", "each", "with", "log", "lookup", "blockHelperMissing", "else",      "helperMissing"]);
    const used = new Set();
    for (const t of templates) {
      const src = read(t).replace(/\{\{!--[\s\S]*?--\}\}/g, "");
      // A helper is an identifier followed by an ARGUMENT — `{{foo bar}}` or
      // `{{#foo bar}}` or a subexpression `(foo bar)`. `{{foo}}` alone is a
      // property lookup and must not be counted.
      for (const m of src.matchAll(/\{\{[#~]?\s*([a-zA-Z][\w]*)\s+[^}]/g)) used.add(m[1]);
      for (const m of src.matchAll(/\(\s*([a-zA-Z][\w]*)\s+[^)]/g)) used.add(m[1]);
    }
    const missing = [...used].filter((h) => !BUILTIN.has(h) && !Handlebars.helpers[h]);
    assert.deepEqual(missing, [],
      `these helpers are invoked by a template and registered nowhere:\n  ${missing.join("\n  ")}`);
  });

  /**
   * The harness stubs Foundry's helpers. If the system registers one the stub
   * set lacks, the preview throws again — which is how this started.
   */
  test("the harness stubs every helper the system registers", () => {
    const system = [...read("module/last-arc.mjs")
      .matchAll(/registerHelper\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]);
    const missing = system.filter((h) => !Handlebars.helpers[h]);
    assert.deepEqual(missing, [],
      `the system registers these and the preview harness does not:\n  ${missing.join("\n  ")}`);
  });

  test("the synthetic actor is substantial enough to exercise the sheet", () => {
    const ctx = buildContext();
    // A fixture that lost its rows would render an empty sheet and pass every
    // assertion above while proving nothing.
    for (const key of ["skills", "attacks", "attributes", "defenceRows"]) {
      assert.ok(ctx[key] && Object.keys(ctx[key]).length > 0,
        `the preview fixture has no ${key}, so rendering it proves nothing`);
    }
  });
});
