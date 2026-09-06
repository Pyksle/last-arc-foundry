/**
 * Issue #93: "If I could make my own tabs/folders to swap between when we're in
 * combat or out of combat that would be cool."
 *
 * Not tabs. A tab hides what is not in it, and these panels are already
 * collapsible, already reorderable, and some of them are already conditionally
 * absent — Actions appears only in combat. Three ways for a panel to be missing
 * is two too many, and the third would be the one nobody could explain.
 *
 * A PROFILE is a snapshot of the arrangement the reader has already built: the
 * order, and which panels are folded away. Swapping applies it. It reuses every
 * rule #54 and #55 established, including the one that matters most — applying
 * a profile goes back through `normaliseOrder`, so an arrangement saved before
 * a panel shipped still places that panel where it was designed to go rather
 * than dropping it or parking it under Biography.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as L from "../module/sheet-layout.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const uncomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\{!--[\s\S]*?--\}\}/g, "");

describe("§ #93 naming an arrangement", () => {
  test("a name is trimmed and its whitespace collapsed", () => {
    assert.equal(L.normaliseProfileName("  In   combat "), "In combat");
  });

  test("and capped, so the picker cannot go elastic", () => {
    const long = "x".repeat(100);
    assert.equal(L.normaliseProfileName(long).length, L.MAX_PROFILE_NAME);
  });

  test("a name of nothing but space is no name", () => {
    assert.equal(L.normaliseProfileName("   "), "");
    assert.equal(L.normaliseProfileName(null), "");
    assert.equal(L.normaliseProfileName(undefined), "");
  });
});

describe("§ #93 saving one", () => {
  const arrangement = { order: ["attacks", "skills"], collapsed: ["skills"] };

  test("the first save makes the list", () => {
    const saved = L.saveProfile([], "Combat", arrangement);
    assert.deepEqual(saved,
      [{ name: "Combat", order: ["attacks", "skills"], collapsed: ["skills"] }]);
  });

  test("it copies, so a later move cannot rewrite history", () => {
    const order = ["attacks", "skills"];
    const [profile] = L.saveProfile([], "Combat", { order, collapsed: [] });
    order.reverse();
    assert.deepEqual(profile.order, ["attacks", "skills"],
      "the profile is aliasing the live order and changes with it");
  });

  test("saving the same name again replaces it IN PLACE", () => {
    // Appending would leave two rows the picker cannot tell apart.
    let saved = L.saveProfile([], "Combat", arrangement);
    saved = L.saveProfile(saved, "Downtime", arrangement);
    saved = L.saveProfile(saved, "combat", { order: ["skills"], collapsed: [] });

    assert.equal(saved.length, 2);
    assert.deepEqual(saved.map((p) => p.name), ["combat", "Downtime"],
      "the replacement moved to the end");
    assert.deepEqual(saved[0].order, ["skills"]);
  });

  test("an unusable name saves nothing", () => {
    assert.equal(L.saveProfile([], "  ", arrangement), null);
  });

  test("the list has a ceiling, and overwriting is exempt from it", () => {
    const full = Array.from({ length: L.MAX_PROFILES },
      (_, i) => ({ name: `p${i}`, order: [], collapsed: [] }));
    assert.equal(L.saveProfile(full, "one more", arrangement), null);
    assert.ok(L.saveProfile(full, "p3", arrangement),
      "a full list must still let you re-save one you already have");
  });

  test("neither input is mutated", () => {
    const before = [{ name: "Combat", order: [], collapsed: [] }];
    const copy = JSON.parse(JSON.stringify(before));
    L.saveProfile(before, "Downtime", arrangement);
    assert.deepEqual(before, copy);
  });
});

describe("§ #93 finding and forgetting", () => {
  const profiles = [
    { name: "Combat", order: ["attacks"], collapsed: [] },
    { name: "Downtime", order: ["biography"], collapsed: ["attacks"] }
  ];

  test("names match however they were typed", () => {
    assert.equal(L.findProfile(profiles, "combat")?.name, "Combat");
    assert.equal(L.findProfile(profiles, "  DOWNTIME  ")?.name, "Downtime");
  });

  test("a name nobody saved finds nothing", () => {
    assert.equal(L.findProfile(profiles, "Sailing"), null);
    assert.equal(L.findProfile(profiles, ""), null);
  });

  test("forgetting drops exactly one", () => {
    assert.deepEqual(L.deleteProfile(profiles, "combat").map((p) => p.name), ["Downtime"]);
  });

  test("forgetting one that is not there changes nothing", () => {
    assert.deepEqual(L.deleteProfile(profiles, "Sailing").map((p) => p.name),
      ["Combat", "Downtime"]);
  });
});

describe("§ #93 what the sheet is told to draw", () => {
  const canonical = ["attributes", "skills", "attacks", "biography"];
  const profiles = [{ name: "Combat", order: ["attacks", "skills"], collapsed: [] }];

  test("the picker is given the saved names", () => {
    const layout = L.resolveLayout({ saved: { profiles }, canonical });
    assert.deepEqual(layout.profiles, [{ name: "Combat", isActive: false }]);
  });

  test("the active one is marked, in ITS OWN spelling", () => {
    // The stored name may be cased differently from the profile's. Matching on
    // the raw string leaves the picker with nothing selected.
    const layout = L.resolveLayout({ saved: { profiles, active: "combat" }, canonical });
    assert.equal(layout.active, "Combat");
    assert.equal(layout.profiles[0].isActive, true);
  });

  test("an active name that was since forgotten reads as none", () => {
    const layout = L.resolveLayout({ saved: { profiles: [], active: "Combat" }, canonical });
    assert.equal(layout.active, null);
    assert.deepEqual(layout.profiles, []);
  });

  test("a nameless entry is not offered", () => {
    const layout = L.resolveLayout({
      saved: { profiles: [{ name: "  ", order: [], collapsed: [] }] }, canonical });
    assert.deepEqual(layout.profiles, []);
  });

  test("a sheet nobody has touched offers none, and may save", () => {
    const layout = L.resolveLayout({ saved: null, canonical });
    assert.deepEqual(layout.profiles, []);
    assert.equal(layout.active, null);
    assert.equal(layout.canSave, true);
  });

  test("a full list may not save another", () => {
    const full = Array.from({ length: L.MAX_PROFILES },
      (_, i) => ({ name: `p${i}`, order: [], collapsed: [] }));
    assert.equal(L.resolveLayout({ saved: { profiles: full }, canonical }).canSave, false);
  });
});

describe("§ #93 a profile saved before a panel existed", () => {
  /**
   * The slow disaster `normaliseOrder` was written to prevent, arriving by a
   * new road. A profile is a stored order like any other, so applying one has
   * to go back through the same reconciliation — otherwise every panel shipped
   * after a reader saved "Combat" would land at the bottom of that arrangement,
   * below Biography, and be reported as missing.
   */
  const canonical = ["attributes", "skills", "beastforms", "attacks", "biography"];

  test("a newly shipped panel lands where it was designed to", () => {
    const stale = ["attributes", "skills", "attacks", "biography"];
    const order = L.normaliseOrder(stale, canonical);
    assert.deepEqual(order,
      ["attributes", "skills", "beastforms", "attacks", "biography"]);
  });

  test("a panel that no longer ships is dropped from it", () => {
    const order = L.normaliseOrder(["attributes", "gonepanel", "skills"], canonical);
    assert.ok(!order.includes("gonepanel"));
  });
});

describe("§ #93 the wiring", () => {
  const controls = read("module/sheets/sheet-layout-controls.mjs");
  const template = uncomment(read("templates/actor/layout-controls.hbs"));
  const css = read("styles/last-arc.css");
  const lang = JSON.parse(read("lang/en.json"));

  test("applying a profile goes through the reconciliation", () => {
    // Writing the stored order and NOT re-rendering the layout would skip
    // `normaliseOrder` entirely — see the section above for what that costs.
    const fn = controls.slice(controls.indexOf("export async function switchLayoutProfile"));
    assert.match(fn.slice(0, fn.indexOf("\n}")), /applyLayout\(sheet, type\)/);
  });

  test("moving or folding a panel stops claiming a profile is showing", () => {
    for (const gesture of ["toggleSection", "moveSection"]) {
      const fn = controls.slice(controls.indexOf(`export async function ${gesture}`));
      assert.match(fn.slice(0, fn.indexOf("\n}")), /active: null/,
        `${gesture} leaves the picker naming an arrangement that is no longer on screen`);
    }
  });

  test("the store states every key, profiles included", () => {
    // `setFlag` merges: a key left out is retained, which is how #53 ate a
    // week. Every write here states all five.
    const fn = controls.slice(controls.indexOf("async function store("));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const key of ["order:", "collapsed:", "locked:", "profiles:", "active:"]) {
      assert.ok(body.includes(key), `store() omits ${key}`);
    }
  });

  test("a deliberate `null` active is not read as 'keep the old one'", () => {
    // `active: patch.active ?? now.active` would make clearing it impossible.
    const fn = controls.slice(controls.indexOf("async function store("));
    assert.match(fn.slice(0, fn.indexOf("\n}")), /patch\.active === undefined/);
  });

  test("Reset keeps the arrangements you named", () => {
    // There is no undo, and "put this back" must not mean "throw away my work".
    const fn = controls.slice(controls.indexOf("export async function resetLayout"));
    assert.match(fn.slice(0, fn.indexOf("\n}\n")), /profiles: kept/);
  });

  test("dismissing the name prompt saves nothing", () => {
    // An empty name and a dismissed dialog are different answers, and reading
    // the second as the first would store a row the picker cannot show.
    const fn = controls.slice(controls.indexOf("export async function saveLayoutProfile"));
    assert.match(fn.slice(0, fn.indexOf("\n}")), /if \(name === null\) return;/);
  });

  test("the picker survives the lock, and the buttons do not", () => {
    assert.match(css, /\.la-layout__save,\s*\n\.la-layout__delete \{ display: none; \}/);
    assert.match(css, /\.is-layout-unlocked \.la-layout__save/);
    assert.ok(!/\.la-layout__profiles \{ display: none; \}/.test(css),
      "swapping is the request — it must not be hidden behind Arrange");
  });

  test("the hidden wrapper actually hides", () => {
    // `.la-layout__profiles { display: flex }` beats a bare `[hidden]`, so the
    // empty picker would show on every untouched sheet.
    assert.match(css, /\.la-layout__profiles\[hidden\] \{ display: none; \}/);
  });

  test("every control it emits has a string", () => {
    for (const m of template.matchAll(/localize ['"]([\w.]+)['"]/g)) {
      assert.ok(lang[m[1]], `${m[1]} is missing`);
    }
  });
});
