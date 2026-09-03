/**
 * Every class a template reaches for has to exist in the stylesheet.
 *
 * Two defects prompted this, both of which the whole suite was green through.
 *
 * The Grants proficiency picker (#75) invented `la-prof-grid` and `la-subhead`,
 * which no rule matched, and put `la-prof` — the GRID CONTAINER class — on every
 * button. Each button became its own 8rem-column grid and threw its label out
 * of the box. The Quench test passed the entire time, because it queried the
 * buttons by `data-action`, which is just as true of an element rendering as a
 * pile of debris.
 *
 * The Beast Forms panel (0.55.0) shipped with NINE classes and no rules at all.
 * Same reason: everything asserted about it was a query, and a query does not
 * care what the thing looks like.
 *
 * This cannot see the second half of either bug — `la-prof` exists, so using it
 * in the wrong place is invisible here. What it does catch is a class the
 * stylesheet has never heard of, which is what both of them led with, and it
 * costs one regex to say so.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "styles/last-arc.css"), "utf8");

/**
 * BEM MODIFIERS ARE EXEMPT, and only modifiers.
 *
 * `la-panel--attributes` and its thirty siblings carry no rules on purpose:
 * the base `la-panel` is styled, and the modifier is a hook for the layout
 * code and for tests to aim at. A guard that demanded a rule for each would be
 * answered by thirty empty rulesets, which is worse than no guard.
 *
 * A BASE class with no rule is a different thing entirely: nothing else is
 * styling that element, so it is being drawn by the browser's defaults.
 */
const isModifier = (cls) => cls.includes("--");

/**
 * Classes that are query hooks rather than styling, and render acceptably
 * because a parent's layout already covers them.
 *
 * PRE-EXISTING, every one — they were here before this guard and are listed so
 * it can start working rather than be postponed. Two are aimed at by tests
 * (`la-panel__label` by the Quench layout batch); the rest sit inside a flex
 * parent that already positions them. Adding to this list is a decision to
 * ship an element the stylesheet does not describe, so it wants a reason.
 */
const HOOKS_ONLY = new Map([
  ["la-panel__label", "queried by the sheet-layout batch; the title's own rule paints it"],
  ["la-item__edit", "the ✎ button, positioned by .la-item's flex row"],
  ["la-effects", "container; the rows inside it carry the layout"],
  ["la-npc-skills", "container for the printed skill list"],
  ["la-drops__table", "container; the table's own cells are styled"],
  ["la-attack__notes", "inline text inside a styled attack row"],
  ["la-attack__band", "inline text inside a styled attack row"],
  ["la-attack__row", "wrapper inside .la-attack; checked in a live sheet — the " +
    "fields inside carry their own styling and the default block flow reads " +
    "cleanly, though the third row would probably rather be columns"]
]);

function classesInTemplates() {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".hbs")) files.push(join(dir, entry.name));
    }
  })("templates");

  const used = new Map();
  for (const file of files) {
    for (const m of readFileSync(join(root, file), "utf8").matchAll(/class="([^"]*)"/g)) {
      // Handlebars expressions inside the attribute are conditions, not class
      // names — `{{#if x}}is-active{{/if}}` must not be read as a token.
      for (const token of m[1].replace(/\{\{[^}]*\}\}/g, " ").split(/\s+/)) {
        if (token.startsWith("la-") && !used.has(token)) used.set(token, file);
      }
    }
  }
  return used;
}

const styled = (cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(css);

describe("every class a template uses is one the stylesheet knows", () => {
  test("the scan finds the classes it is meant to police", () => {
    const used = classesInTemplates();
    // If this collapses the test below passes vacuously, which is how a guard
    // silently stops guarding.
    assert.ok(used.size > 100, `expected the sheets' full vocabulary, found ${used.size}`);
    assert.ok(used.has("la-prof__box"), "the proficiency picker was not scanned");
    assert.ok(used.has("la-beastform"), "the Beast Forms panel was not scanned");
  });

  test("no base class is drawn by the browser's defaults", () => {
    const orphans = [...classesInTemplates()]
      .filter(([cls]) => !isModifier(cls) && !HOOKS_ONLY.has(cls) && !styled(cls))
      .map(([cls, file]) => `${cls} — used in ${file}, no rule in styles/last-arc.css`);

    assert.deepEqual(orphans, [],
      "these render with no styling at all; add a rule, or an entry in " +
      "HOOKS_ONLY saying which parent already positions them:\n  " +
      orphans.join("\n  "));
  });

  /**
   * An exemption that stops being true is worse than none: it vouches for a
   * class that has since been styled, and hides the next one added beside it.
   */
  test("the hooks list has no stale entries", () => {
    const used = classesInTemplates();
    const stale = [...HOOKS_ONLY.keys()]
      .filter((cls) => !used.has(cls) || styled(cls))
      .map((cls) => (used.has(cls) ? `${cls} (now styled — remove it)` : `${cls} (no longer used)`));

    assert.deepEqual(stale, [], `stale HOOKS_ONLY entries:\n  ${stale.join("\n  ")}`);
  });
});
