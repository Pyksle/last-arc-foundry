/**
 * Per-reader sheet layout (issues #54 and #55).
 *
 * The maths is small. What is not small is the set of ways this feature can
 * quietly ruin a sheet, so the tests are weighted there:
 *
 *   1. A NEW SECTION MUST NOT LAND AT THE BOTTOM. The moment anybody customises
 *      their layout, their saved order is a complete list — and the obvious
 *      "append anything unrecognised" rule then files every future panel below
 *      Biography, forever, on every sheet that was ever touched. It would be
 *      reported as the panel being missing, months later, by somebody who never
 *      connected it to this release.
 *   2. THE ORDER IN CONFIG MUST BE THE ORDER IN THE TEMPLATE. A fresh reader's
 *      layout IS the canonical list, applied as CSS `order`. If the two
 *      disagree, opening a sheet for the first time visibly reshuffles it.
 *   3. THE SWAP PARTNER MUST BE ON SCREEN. The Actions panel renders only in
 *      combat, so a literal-neighbour swap is a click that does nothing — the
 *      #46 complaint, which this project has now had three times.
 *   4. IT IS THE READER'S FLAG, NOT THE ACTOR'S. Writing this to the actor
 *      needs OWNER, so tidying a sheet you merely observe would fail with the
 *      permission error 0.44.1 was spent removing.
 *   5. LOCKED IS THE DEFAULT. The lock was asked for to prevent accidents; a
 *      layout that arrives unlocked hands every player nineteen new ones.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import * as L from "../module/sheet-layout.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));

const body = read("templates/actor/character-body.hbs");
const npc = read("templates/actor/npc-sheet.hbs");
const charSheet = read("module/sheets/character-sheet.mjs");
const npcSheet = read("module/sheets/npc-sheet.mjs");
const layoutSrc = read("module/sheets/sheet-layout-controls.mjs");
const titlePartial = read("templates/actor/section-title.hbs");
const css = read("styles/last-arc.css");

/** Strip Handlebars and JS comments; a guard that matches the note explaining
 *  the fix is not a guard. Three of these shipped inert in one week. */
const uncomment = (s) => s
  .replace(/\{\{!--[\s\S]*?--\}\}/g, "")
  .replace(/\{\{![\s\S]*?\}\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/* ── normaliseOrder ────────────────────────────────────────────────────────── */

describe("normaliseOrder reconciles a saved order with what ships", () => {
  const canonical = ["a", "b", "c", "d"];

  test("nothing saved gives the designed order", () => {
    assert.deepEqual(L.normaliseOrder([], canonical), canonical);
    assert.deepEqual(L.normaliseOrder(undefined, canonical), canonical);
  });

  test("a customised order survives untouched", () => {
    assert.deepEqual(L.normaliseOrder(["d", "a", "c", "b"], canonical),
      ["d", "a", "c", "b"]);
  });

  test("a retired section is dropped", () => {
    assert.deepEqual(L.normaliseOrder(["a", "gone", "b", "c", "d"], canonical),
      ["a", "b", "c", "d"]);
  });

  test("a duplicated id is kept once", () => {
    assert.deepEqual(L.normaliseOrder(["a", "b", "a", "c", "d"], canonical),
      ["a", "b", "c", "d"]);
  });

  test("a NEW section lands after its designed predecessor, not at the end", () => {
    // The reader has never seen "c". It belongs between b and d, and appending
    // it would bury it below everything they own.
    assert.deepEqual(L.normaliseOrder(["a", "b", "d"], canonical),
      ["a", "b", "c", "d"]);
  });

  test("a new FIRST section lands first", () => {
    assert.deepEqual(L.normaliseOrder(["b", "c", "d"], canonical),
      ["a", "b", "c", "d"]);
  });

  test("a new LAST section lands last", () => {
    assert.deepEqual(L.normaliseOrder(["a", "b", "c"], canonical),
      ["a", "b", "c", "d"]);
  });

  test("two adjacent new sections keep their designed order", () => {
    assert.deepEqual(L.normaliseOrder(["a", "d"], canonical),
      ["a", "b", "c", "d"]);
  });

  test("a new section follows its predecessor even where the reader moved it", () => {
    // "b" was dragged to the bottom; "c" ships new and belongs after "b".
    assert.deepEqual(L.normaliseOrder(["a", "d", "b"], canonical),
      ["a", "d", "b", "c"]);
  });

  test("the inputs are not mutated", () => {
    const saved = ["a", "d"];
    const canon = [...canonical];
    L.normaliseOrder(saved, canon);
    assert.deepEqual(saved, ["a", "d"]);
    assert.deepEqual(canon, canonical);
  });
});

/* ── moveSection ───────────────────────────────────────────────────────────── */

describe("moveSection swaps with the nearest RENDERED neighbour", () => {
  const order = ["a", "b", "c"];

  test("up and down", () => {
    assert.deepEqual(L.moveSection(order, "b", "up"), ["b", "a", "c"]);
    assert.deepEqual(L.moveSection(order, "b", "down"), ["a", "c", "b"]);
  });

  test("off either end is null, not a wrap and not a no-op copy", () => {
    assert.equal(L.moveSection(order, "a", "up"), null);
    assert.equal(L.moveSection(order, "c", "down"), null);
  });

  test("an id that is not in the order is null", () => {
    assert.equal(L.moveSection(order, "zz", "up"), null);
  });

  test("an absent neighbour is stepped over, so one click moves one place", () => {
    // "b" is the Actions panel, out of combat. Moving "c" up must reach "a".
    assert.deepEqual(L.moveSection(order, "c", "up", ["a", "c"]), ["c", "b", "a"]);
  });

  test("the absent section keeps its slot", () => {
    const next = L.moveSection(order, "c", "up", ["a", "c"]);
    assert.equal(next[1], "b", "the hidden panel stays between its neighbours");
  });

  test("nothing rendered in that direction is null", () => {
    assert.equal(L.moveSection(["a", "b", "c"], "c", "up", ["c"]), null);
  });

  test("the input is not mutated", () => {
    const start = ["a", "b", "c"];
    L.moveSection(start, "b", "up");
    assert.deepEqual(start, ["a", "b", "c"]);
  });
});

/* ── toggleCollapsed ───────────────────────────────────────────────────────── */

describe("toggleCollapsed", () => {
  test("flips both ways", () => {
    assert.deepEqual(L.toggleCollapsed([], "spells"), ["spells"]);
    assert.deepEqual(L.toggleCollapsed(["spells"], "spells"), []);
  });

  test("leaves the others alone", () => {
    assert.deepEqual(L.toggleCollapsed(["a", "b"], "b"), ["a"]);
  });

  test("an explicit state overrides the flip", () => {
    assert.deepEqual(L.toggleCollapsed(["a"], "a", true), ["a"]);
    assert.deepEqual(L.toggleCollapsed([], "a", false), []);
  });

  test("a corrupted flag with duplicates comes back clean", () => {
    assert.deepEqual(L.toggleCollapsed(["a", "a", "b"], "c"), ["a", "b", "c"]);
  });

  test("the input is not mutated", () => {
    const start = ["a"];
    L.toggleCollapsed(start, "b");
    assert.deepEqual(start, ["a"]);
  });
});

/* ── resolveLayout ─────────────────────────────────────────────────────────── */

describe("resolveLayout", () => {
  const canonical = ["a", "b", "c"];

  test("a reader who has never touched it gets the designed order, LOCKED", () => {
    const out = L.resolveLayout({ canonical });
    assert.deepEqual(out.order, canonical);
    assert.equal(out.locked, true);
    assert.ok(out.rows.every((r) => !r.collapsed));
  });

  test("locked is only false when it is explicitly false", () => {
    assert.equal(L.resolveLayout({ saved: {}, canonical }).locked, true);
    assert.equal(L.resolveLayout({ saved: { locked: false }, canonical }).locked, false);
    assert.equal(L.resolveLayout({ saved: { locked: true }, canonical }).locked, true);
  });

  test("collapsed ids reach the rows", () => {
    const out = L.resolveLayout({ saved: { collapsed: ["b"] }, canonical });
    assert.deepEqual(out.rows.filter((r) => r.collapsed).map((r) => r.id), ["b"]);
  });

  test("rows carry the index the sheet sets as CSS order", () => {
    const out = L.resolveLayout({ saved: { order: ["c", "a", "b"] }, canonical });
    assert.deepEqual(out.rows.map((r) => [r.id, r.index]), [["c", 0], ["a", 1], ["b", 2]]);
  });

  test("the end arrows are disabled against what is ON SCREEN", () => {
    // "a" is not rendered, so "b" is the top one and its up arrow is dead.
    const out = L.resolveLayout({ canonical, present: ["b", "c"] });
    const by = Object.fromEntries(out.rows.map((r) => [r.id, r]));
    assert.equal(by.b.isFirst, true);
    assert.equal(by.c.isLast, true);
    assert.equal(by.a.isFirst, false, "an absent section is not the first one");
  });

  test("a stale saved order is normalised on the way out", () => {
    const out = L.resolveLayout({ saved: { order: ["gone", "c"] }, canonical });
    assert.deepEqual(out.order, ["a", "b", "c"]);
  });
});

/* ── the canonical lists against the templates ─────────────────────────────── */

/**
 * Section ids in DOM order, resolving the shared partials to the section each
 * one renders. Both sheets include the same three, in different places.
 */
const SHARED = {
  laDamageMods: "damagemods",
  laStatusPalette: "statuses",
  laEffectsPanel: "effects"
};

function domSections(template) {
  const out = [];
  for (const line of uncomment(template).split("\n")) {
    const partial = line.match(/\{\{>\s*(la\w+)\s*\}\}/);
    if (partial && SHARED[partial[1]]) { out.push(SHARED[partial[1]]); continue; }

    const section = line.match(/<section[^>]*\bdata-section="([\w-]+)"/);
    if (section) out.push(section[1]);
  }
  return out;
}

describe("every section the sheet ships is declared, in the same order", () => {
  for (const [type, template] of [["character", body], ["npc", npc]]) {
    test(`${type}: config order is the template's DOM order`, () => {
      // Not a set comparison. A fresh reader's layout IS this list, applied as
      // CSS `order`, so a disagreement reshuffles the sheet on first open.
      assert.deepEqual(
        domSections(template),
        LASTARC.sheetSections[type].map((s) => s.id)
      );
    });

    test(`${type}: no duplicate ids`, () => {
      const ids = LASTARC.sheetSections[type].map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length);
    });

    test(`${type}: every section has a real label`, () => {
      for (const { id, label } of LASTARC.sheetSections[type]) {
        assert.ok(lang[label], `${type}/${id} wants ${label}, which is not in en.json`);
      }
    });
  }

  test("the shared partials are the only sections either sheet imports", () => {
    // A fourth shared panel added without an entry here would vanish from the
    // order check above, and the check would still pass — silently.
    for (const template of [body, npc]) {
      for (const [, name] of uncomment(template).matchAll(/\{\{>\s*(la\w+)\s*\}\}/g)) {
        if (["laItemOrder", "laSectionTitle", "laLayoutControls"].includes(name)) continue;
        assert.ok(SHARED[name], `partial ${name} renders a panel nobody declared`);
      }
    }
  });

  test("no panel escapes the layout without a data-section", () => {
    for (const [type, template] of [["character", body], ["npc", npc]]) {
      const opens = uncomment(template).match(/<section[^>]*class="[^"]*\bla-panel\b[^"]*"[^>]*>/g) ?? [];
      for (const tag of opens) {
        assert.match(tag, /data-section="/,
          `${type} has a la-panel with no data-section:\n${tag}`);
      }
    }
    for (const p of ["damage-mods", "status-palette", "effects-panel"]) {
      const tag = read(`templates/actor/${p}.hbs`).match(/<section[^>]*la-panel[^>]*>/)[0];
      assert.match(tag, /data-section="/, `${p} partial has no data-section`);
    }
  });
});

/* ── the title partial ─────────────────────────────────────────────────────── */

describe("the section title is one partial, not thirty-five copies", () => {
  test("no template writes its own panel title any more", () => {
    for (const [name, src] of [["character", body], ["npc", npc],
      ["damage-mods", read("templates/actor/damage-mods.hbs")],
      ["status-palette", read("templates/actor/status-palette.hbs")],
      ["effects-panel", read("templates/actor/effects-panel.hbs")]]) {
      assert.doesNotMatch(uncomment(src), /<h2 class="la-panel__title">/,
        `${name} still hand-rolls a title; the collapse control would miss it`);
    }
  });

  test("the partial carries the collapse toggle and both arrows", () => {
    const src = uncomment(titlePartial);
    assert.match(src, /data-action="toggleSection"/);
    assert.match(src, /data-action="moveSection"[\s\S]*data-direction="up"/);
    assert.match(src, /data-action="moveSection"[\s\S]*data-direction="down"/);
  });

  test("the collapse control says what it does to a screen reader", () => {
    assert.match(uncomment(titlePartial), /aria-expanded=/);
  });
});

/* ── both sheets, or the feature is half-built ─────────────────────────────── */

/**
 * The integrity suite CANNOT catch this one, and it is worth saying why.
 *
 * Its two reachability checks each build a UNION: every `data-action` found in
 * any template, against every action declared by any of the three sheet
 * classes. So an action declared only on the character sheet, with its button
 * rendered by a partial that the statblock also includes, satisfies both halves
 * and is stone dead on the statblock. Every control this feature adds is in a
 * shared partial, so every one of them is exposed to exactly that.
 *
 * `custom-effects.test.mjs` hit this first and closed it the same way. Copying
 * the shape rather than inventing one keeps the two tests recognisably the same
 * check.
 */
describe("both sheets declare every action the shared partials emit", () => {
  const emitted = [...new Set(
    [titlePartial, read("templates/actor/layout-controls.hbs")]
      .flatMap((src) => [...uncomment(src).matchAll(/data-action="(\w+)"/g)].map((m) => m[1]))
  )];

  test("the partials emit the four controls this feature is", () => {
    // Guards the guard: if the extraction silently found nothing, every
    // assertion below would pass vacuously.
    assert.deepEqual(emitted.sort(),
      ["moveSection", "resetLayout", "toggleLayoutLock", "toggleSection"]);
  });

  for (const [name, src] of [["character", charSheet], ["npc", npcSheet]]) {
    for (const action of ["toggleSection", "moveSection", "toggleLayoutLock", "resetLayout"]) {
      test(`${name} sheet declares ${action}`, () => {
        assert.match(src, new RegExp(`\\b${action}:\\s*LastArc\\w+Sheet\\.#on`));
      });
    }

    test(`${name} sheet applies the layout on every render`, () => {
      assert.match(uncomment(src), /_onRender\([\s\S]{0,400}applyLayout\(this, "(character|npc)"\)/,
        "without this the arrangement is lost on the next re-render");
    });
  }
});

/* ── it is the reader's flag ───────────────────────────────────────────────── */

describe("layout is stored against the user, never the actor", () => {
  const src = uncomment(layoutSrc);

  test("reads and writes go to game.user", () => {
    assert.match(src, /game\.user\.setFlag\(/);
    assert.match(src, /game\.user\??\.getFlag\(/);
  });

  test("nothing writes the layout to a document the reader may not own", () => {
    assert.doesNotMatch(src, /document\.setFlag\(/,
      "an actor flag needs OWNER; observers must still be able to tidy a sheet");
    assert.doesNotMatch(src, /\bactor\.update\(/);
  });

  test("resetting UNSETS rather than writing an empty object", () => {
    // setFlag merges, so writing {} would clear nothing at all.
    assert.match(src, /unsetFlag\(/);
  });

  test("a collapse does not re-render the sheet", () => {
    // The whole of #55's second sentence: re-rendering is what loses the
    // scroll position, and there is no reason to do it — the DOM change is
    // one class.
    const toggle = src.slice(src.indexOf("export async function toggleSection"));
    const fn = toggle.slice(0, toggle.indexOf("\nexport ") + 1 || undefined);
    assert.doesNotMatch(fn, /\.render\(/,
      "toggleSection re-renders, which throws away the scroll position");
  });
});

/* ── how it reorders, and what it must not touch ───────────────────────────── */

describe("reordering moves the nodes, not the paint", () => {
  const layout = uncomment(layoutSrc);

  test("the panels are actually moved in the DOM", () => {
    assert.match(layout, /\.after\(|insertBefore\(|appendChild\(/);
  });

  test("nothing sets CSS order", () => {
    // `order` repaints and leaves the tab sequence and the accessibility tree
    // in the original arrangement — the feature, not working, for the readers
    // least able to work around it.
    assert.doesNotMatch(layout, /style\.order|"order"/);
    assert.doesNotMatch(uncomment(css), /\.la-body\s*\{[^}]*flex-direction/);
  });

  test("a panel already in place is not moved", () => {
    // Biography holds a prose-mirror, and moving a live custom element is not
    // free. A re-render with an unchanged arrangement must touch nothing.
    assert.match(layout, /nextElementSibling\s*!==/);
  });
});

describe("the CSS the feature needs, and the sheets it must not reach", () => {
  test("collapsing hides the contents but keeps the title", () => {
    assert.match(css, /\.la-panel\.is-collapsed\s*>\s*\*:not\(\.la-panel__title\)/);
  });

  test("the move arrows are hidden until the sheet is unlocked", () => {
    assert.match(uncomment(css), /is-layout-unlocked/);
  });

  test("the title restyle is scoped to panels that have a section", () => {
    // `.la-panel` is also the item sheet's furniture, forty-five times over,
    // with plain text titles and no controls in them.
    assert.match(css, /\.la-panel\[data-section\]\s*>\s*\.la-panel__title\s*\{/);
    assert.doesNotMatch(uncomment(css), /^\.la-panel__title\s*\{\s*$[^}]*display:\s*flex/m);
  });
});

/* ── the two things Foundry does that would have killed this quietly ───────── */

describe("Foundry's own behaviour, worked around on purpose", () => {
  const layout = uncomment(layoutSrc);

  test("the layout controls are re-enabled for readers who cannot edit", () => {
    /**
     * `DocumentSheetV2#_onRender` disables every form control — `<button>`
     * included — when `isEditable` is false. An OBSERVER is exactly who this
     * feature is for: somebody tidying a sheet they cannot change. Without this
     * every control would be dead for them, silently.
     */
    const start = layout.indexOf("function reEnable");
    assert.ok(start >= 0, "there is no reEnable at all");
    assert.match(layout, /^\s*reEnable\(root\);$/m, "reEnable is defined but never called");
    const body = layout.slice(start, layout.indexOf("\n}", start));

    assert.match(body, /\.disabled = false/);
    for (const action of ["toggleSection", "toggleLayoutLock", "resetLayout"]) {
      assert.match(body, new RegExp(`data-action="${action}"`),
        `${action} is left disabled for a reader who cannot edit the document`);
    }

    // The move arrows are deliberately absent: `applyLayout` sets their
    // disabled state from isFirst/isLast on every render, which overrides the
    // blanket disable anyway. Asserted so the omission reads as a decision.
    assert.doesNotMatch(body, /moveSection/);
    assert.match(layout, /if \(up\) up\.disabled = row\.isFirst/);
  });

  test("scroll position is remembered around a re-render", () => {
    /**
     * `PARTS.body.scrollable = [""]` resolves to `.la-body`, which has no
     * `overflow` rule — the scroller is `.window-content`, an ancestor the
     * part-scoped selector cannot reach. So Foundry has been restoring a
     * scrollTop that is permanently 0, on sheets that re-render on every
     * committed keystroke.
     */
    assert.match(layout, /\.window-content/);
    assert.match(layout, /export function rememberScroll/);
    assert.match(layout, /export function restoreScroll/);

    for (const [name, src] of [["character", charSheet], ["npc", npcSheet]]) {
      assert.match(uncomment(src), /_preRender\([\s\S]{0,200}rememberScroll\(this\)/,
        `${name} sheet does not record the scroll position before it re-renders`);
      assert.match(uncomment(src), /_onRender\([\s\S]{0,300}restoreScroll\(this\)/,
        `${name} sheet does not put the reader back where they were`);
    }
  });

  test("the body is NOT given its own overflow", () => {
    // That would make it a second nested scroller, and a definite-height
    // column of panels is the geometry that collapses a prose-mirror
    // (CLAUDE.md rule 8).
    assert.doesNotMatch(uncomment(css), /\.la-body\s*\{[^}]*overflow/);
  });
});
