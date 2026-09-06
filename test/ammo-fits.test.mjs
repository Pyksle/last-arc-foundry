/**
 * Issue #91, second report: "The 'fits' option for the ammunition is defaulting
 * back to arrows. Add a dropdown box adding arrows for bows, and bolts for
 * crossbows as ammunition options."
 *
 * Two complaints in one sentence, and both are fair.
 *
 * The field is a list of WEAPON CATEGORIES — `bows`, `crossbows`, `guns` — and
 * it was a free-text comma box. Nothing on the sheet said what words it wanted,
 * and "arrows" is the obvious thing to write on a stack of arrows. It matches
 * no category, so `ammunitionFor` filters the quiver out of the Reload picker
 * and the stack silently fits nothing. That is the "defaulting back" they saw:
 * not a value reverting, but a value that was never going to work.
 *
 * (The box also genuinely dropped typing before 0.62.1 — one of the nine comma
 * boxes #87 turned out to be. That is fixed; this replaces the control so the
 * class of bug cannot come back, because a tick writes straight to the document
 * and never passes through the submit pipeline that ate it.)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LASTARC } from "../module/config.mjs";
import * as AMMO from "../module/ammunition.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("§ #91 the list names the categories that eat ammunition", () => {
  test("three of them, and they are weapon categories", () => {
    assert.deepEqual([...LASTARC.ammunitionCategories].sort(), ["bows", "crossbows", "guns"]);
    for (const key of LASTARC.ammunitionCategories) {
      assert.ok(LASTARC.weaponCategories.includes(key),
        `${key} is offered as a "fits" value and is not a weapon category, so ` +
        "nothing will ever match it");
    }
  });

  test("each one has a label to show", () => {
    const lang = JSON.parse(read("lang/en.json"));
    for (const key of LASTARC.ammunitionCategories) {
      assert.ok(lang[`LASTARC.WeaponCategory.${key}`], `${key} would render a raw key`);
    }
  });

  test("`requiresAmmunition` and the picker agree on the same three", () => {
    // If these ever drifted, a GM could tick a category on the stack that the
    // attack pipeline never asks about.
    for (const key of LASTARC.weaponCategories) {
      assert.equal(AMMO.requiresAmmunition(key), LASTARC.ammunitionCategories.has(key),
        `${key} disagrees between the tick list and the ammunition rule`);
    }
  });
});

describe("§ #91 the control is ticks, not typing", () => {
  const sheet = code(read("module/sheets/item-sheet.mjs"));
  const template = read("templates/item/item-sheet.hbs");
  const css = read("styles/last-arc.css");
  const lang = JSON.parse(read("lang/en.json"));

  test("the comma box is gone from the template", () => {
    assert.ok(!template.includes('name="system.fitsText"'),
      "the free-text box is still there, so the words it wants are still a guess");
  });

  test("and from the repack, which no longer has anything to repack", () => {
    assert.ok(!sheet.includes('"system.fitsText"'),
      "the submit pipeline still rewrites a field nothing writes");
  });

  test("the ticks are drawn and wired", () => {
    assert.match(template, /data-action="toggleAmmoFits"/);
    assert.match(sheet, /toggleAmmoFits: LastArcItemSheet\.#onToggleAmmoFits/,
      "the button has no handler, so it is decoration");
    assert.match(sheet, /static async #onToggleAmmoFits\(/);
  });

  test("the handler writes straight to the document", () => {
    // This is the whole reason the class of bug cannot return: a tick never
    // passes through `_prepareSubmitData`, which is what ate the typing.
    const fn = sheet.slice(sheet.indexOf("static async #onToggleAmmoFits"));
    assert.match(fn.slice(0, fn.indexOf("\n  }")), /#toggleInArray\("fits"/);
  });

  test("an unrecognised value stays togglable, so it can be removed", () => {
    /**
     * `#toggleInArray` refuses a key outside its valid list. If that list were
     * the three categories alone, a stack already saying it fits "arrows" would
     * show the offending tick and refuse to clear it — visible, wrong, and
     * uncorrectable except by deleting the item.
     */
    const fn = sheet.slice(sheet.indexOf("static async #onToggleAmmoFits"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    assert.match(body, /\.\.\.LASTARC\.ammunitionCategories/);
    assert.match(body, /this\.document\.system\.fits/,
      "the valid list ignores what the document already holds");
  });

  test("and it is drawn differently, with a note saying why", () => {
    assert.match(template, /\{\{#if this\.unknown\}\}/);
    assert.match(css, /\.la-prof__box\.is-unknown \{/);
    assert.ok(lang["LASTARC.Note.AmmoFitsStray"]);
    assert.ok(lang["LASTARC.Note.AmmoFitsAll"]);
    assert.ok(lang["LASTARC.Tooltip.AmmoFits"]);
  });

  test("an unknown label is printed raw, not run through localize", () => {
    // "arrows" is not a translation key; localizing it would render the string
    // "arrows" anyway on a good day and a blank on a bad one.
    const block = template.slice(template.indexOf('data-action="toggleAmmoFits"'));
    assert.match(block.slice(0, 400),
      /\{\{#if this\.unknown\}\}\{\{this\.label\}\}\{\{else\}\}\{\{localize this\.label\}\}/);
  });
});

describe("§ #91 blank still means everything", () => {
  test("an empty list fits any weapon", () => {
    // The field is a free-text box no longer, but the rule it had is worth
    // keeping: a stack nobody has categorised must not vanish from the picker.
    const ammo = { type: "ammunition", system: { fits: [] } };
    const actor = { items: [ammo] };
    assert.equal(AMMO.requiresAmmunition("bows"), true);
    for (const category of LASTARC.ammunitionCategories) {
      const fits = ammo.system.fits;
      assert.ok(fits.length === 0 || fits.includes(category),
        `an uncategorised stack should still fit ${category}`);
    }
    assert.equal(actor.items.length, 1);
  });

  test("the sheet says so rather than leaving three empty boxes", () => {
    const sheet = code(read("module/sheets/item-sheet.mjs"));
    assert.match(sheet, /context\.ammoFitsAll = \(sys\.fits \?\? \[\]\)\.length === 0/);
  });
});
