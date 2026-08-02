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
import {
  Handlebars, PARTIALS, buildContext, root,
  renderedItemSheets, renderedNpcSheet, renderedCards, renderedCharacterSheet
} from "../tools/preview.mjs";

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

/**
 * Coverage, not just compilation.
 *
 * Quench has "renders an item sheet for every subtype", "renders the NPC sheet"
 * and "leaves no untranslated LASTARC keys in the rendered sheet". All three are
 * among the 79 that have never run. Nothing needs a live Foundry to answer them
 * — only a context and a Handlebars — so they run here now.
 *
 * Before this the harness reached TWO of thirteen templates. The NPC sheet, all
 * eighteen item subtypes and five of the seven chat cards had never been
 * rendered outside a live Foundry at all.
 */
describe("§ every sheet and card renders, for every subtype", () => {
  const subtypes = Object.keys(
    JSON.parse(read("system.json")).documentTypes.Item
  );

  test("every declared item subtype was rendered", () => {
    assert.deepEqual(Object.keys(renderedItemSheets).sort(), subtypes.sort(),
      "a subtype declared in system.json was never rendered, so nothing has " +
      "checked that its sheet opens");
  });

  test("each item sheet produced real markup", () => {
    for (const [type, html] of Object.entries(renderedItemSheets)) {
      // A template that renders to almost nothing has had its whole body
      // skipped by a false guard, which passes a throw-check while showing
      // the player an empty sheet.
      assert.ok(html.length > 2000, `${type}: only ${html.length} chars — the body is being skipped`);
      assert.match(html, /<input|<select|<textarea|prose-mirror/,
        `${type}: no editable control at all`);
    }
  });

  test("the NPC sheet and every chat card render", () => {
    assert.ok(renderedNpcSheet.length > 5000, `NPC sheet: ${renderedNpcSheet.length} chars`);
    for (const [path, html] of Object.entries(renderedCards)) {
      assert.ok(html.length > 100, `${path}: ${html.length} chars`);
    }
  });

  /**
   * The failure mode a player SEES: a raw `LASTARC.Skill.foo` sitting in the
   * markup where a word should be. It happens whenever a key is referenced and
   * never added to en.json, and the integrity suite's literal scan cannot catch
   * the ones assembled at runtime.
   */
  test("no untranslated LASTARC key reaches the rendered output", () => {
    const leaks = [];
    const scan = (label, html) => {
      for (const m of new Set([...html.matchAll(/LASTARC\.[A-Za-z][\w.]*/g)].map((x) => x[0]))) {
        leaks.push(`${label}: ${m}`);
      }
    };

    for (const [type, html] of Object.entries(renderedItemSheets)) scan(`item/${type}`, html);
    scan("character-sheet", renderedCharacterSheet);
    scan("npc-sheet", renderedNpcSheet);
    for (const [path, html] of Object.entries(renderedCards)) scan(path, html);

    assert.deepEqual(leaks, [],
      "these render as a raw key where a word should be:\n  " + leaks.join("\n  "));
  });
  /**
   * `undefined` rendered as literal text.
   *
   * Handlebars prints whatever it is given, so a context key holding
   * `undefined` becomes the WORD in the markup. The armour proficiency row read
   * "undefined · undefined · undefined" for exactly this reason — the fixture
   * reached for `armourTypes[key].label` on a config entry that is a plain
   * string. Cheap to check, and invisible any other way.
   */
  test("nothing renders the word undefined", () => {
    const bad = [];
    const scan = (label, html) => {
      if (/\bundefined\b/.test(html)) bad.push(label);
    };
    for (const [type, html] of Object.entries(renderedItemSheets)) scan(`item/${type}`, html);
    scan("character-sheet", renderedCharacterSheet);
    scan("npc-sheet", renderedNpcSheet);
    for (const [path, html] of Object.entries(renderedCards)) scan(path, html);

    assert.deepEqual(bad, [],
      "these render `undefined` as literal text, which means a context value " +
      "is missing or the wrong shape:\n  " + bad.join("\n  "));
  });
});

/**
 * The harness must supply what the sheets actually assign (issue #44).
 *
 * `tools/preview.mjs` builds its context BY HAND rather than calling
 * `_prepareContext`, which cannot run without Foundry. That makes the fixture a
 * second copy of a decision — the same shape of defect as issue #40, sitting in
 * the tool used to verify the work.
 *
 * It failed in the safe direction, which is exactly why it went unnoticed:
 * fourteen keys were missing, so the Spells, Performances and Features panels,
 * the Second Wind pips and the study allowances rendered blank in every preview
 * ever taken. A reviewer sees an empty panel and cannot tell "not wired up"
 * from "not in this fixture" — and telling those apart is the whole job.
 *
 * This does not fix the duplication; it makes the copies diverge loudly. The
 * durable answer is lifting the pure half of `_prepareContext` into a
 * Foundry-free module, which is what #44 is still open for.
 */
describe("§ issue #44: the preview fixture tracks what the sheets assign", () => {
  const assignedBy = (file) =>
    new Set([...read(file).matchAll(/context\.(\w+)\s*=/g)].map((m) => m[1]));

  test("the extractor finds the assignments it polices", () => {
    const keys = assignedBy("module/sheets/character-sheet.mjs");
    assert.ok(keys.size >= 30, `only found ${keys.size} context assignments`);
    assert.ok(keys.has("attacks"), [...keys].join(", "));
  });

  test("every key the character sheet assigns is in the fixture", () => {
    const fixture = new Set(Object.keys(buildContext()));
    const missing = [...assignedBy("module/sheets/character-sheet.mjs")]
      .filter((k) => !fixture.has(k))
      .sort();

    assert.deepEqual(missing, [],
      "the preview renders these as blank, so it cannot distinguish an unwired " +
      "panel from an unpopulated fixture:\n  " + missing.join("\n  "));
  });
});
