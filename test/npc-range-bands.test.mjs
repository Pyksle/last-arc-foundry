/**
 * Range increments for statblock attacks (#43, item 6).
 *
 * The GM asked to "manually dictate the range increments and apply the attack
 * roll reduction similar to how alt+clicking works for player range attacks".
 *
 * The band picker, the −2/−5/−10 and the card already existed for players — a
 * character's bands come from the weapon's SIZE via one table in the book. A
 * monster's do not: a statblock prints its own numbers and no size row
 * reproduces them. So the increments are typed per attack, and everything
 * downstream is the machinery players already use.
 *
 * The guard that matters is the three-way one at the bottom. `reachable-choices`
 * cannot read an input name ending in `{{this.key}}`, so these fields are
 * excused there and vouched for here — by a check that is strictly stronger,
 * because it also catches a band added to the config and forgotten in the
 * schema or the editor.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { npcRangeBands, rangeBandPenalty } from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const npcModel = read("module/data/npc.mjs");
const npcSheet = read("module/sheets/npc-sheet.mjs");
const template = read("templates/actor/npc-sheet.hbs");
const lang = JSON.parse(read("lang/en.json"));

describe("§43 a statblock's bands come from its own printed numbers", () => {
  test("nothing recorded means no picker", () => {
    // Every attack in every existing world has zeros here. None of them may
    // start interrupting a roll to ask a question with no answer.
    assert.equal(npcRangeBands({ rangeBands: { pointBlank: 0, short: 0, mid: 0, long: 0 } }), null);
    assert.equal(npcRangeBands({}), null);
    assert.equal(npcRangeBands(null), null);
  });

  test("typed increments become bands with the standard penalties", () => {
    const bands = npcRangeBands({ rangeBands: { pointBlank: 20, short: 40, mid: 60, long: 80 } });
    assert.deepEqual(bands.map((b) => [b.key, b.from, b.to, b.penalty]), [
      ["pointBlank", 0, 20, 0],
      ["short", 21, 40, -2],
      ["mid", 41, 60, -5],
      ["long", 61, 80, -10]
    ]);
  });

  test("the penalties are the shared ones, not a second copy", () => {
    for (const band of npcRangeBands({ rangeBands: { pointBlank: 5, short: 10, mid: 15, long: 20 } })) {
      assert.equal(band.penalty, rangeBandPenalty(band.key),
        `${band.key} has drifted from LASTARC.rangeBands`);
    }
  });

  /**
   * A creature with a short increment and nothing beyond has a MAXIMUM range.
   * Continuing past the first blank would invent reach the page never gave it —
   * and worse, hand the GM a "long range" option for a weapon that cannot get
   * there.
   */
  test("bands stop at the first unrecorded increment", () => {
    const bands = npcRangeBands({ rangeBands: { pointBlank: 6, short: 12, mid: 0, long: 0 } });
    assert.deepEqual(bands.map((b) => b.key), ["pointBlank", "short"]);
  });

  test("a gap does not let a later band leak through", () => {
    const bands = npcRangeBands({ rangeBands: { pointBlank: 6, short: 0, mid: 30, long: 40 } });
    assert.deepEqual(bands.map((b) => b.key), ["pointBlank"],
      "mid and long were recorded past a blank short — they must not be offered");
  });
});

describe("§43 the picker reaches the roll", () => {
  test("the NPC sheet asks for bands before rolling an attack", () => {
    assert.match(npcSheet, /npcRangeBands\(attack\)/,
      "the NPC attack roll never consults the increments, so typing them does " +
      "nothing — the field would be storable and inert");
    assert.match(npcSheet, /situationalOptions\(event, \{ rangeBands: bands \}\)/,
      "the bands are computed and not passed to the prompt");
  });

  test("melee attacks are never asked", () => {
    assert.match(npcSheet, /!attack\.isMelee \? D\.npcRangeBands\(attack\) : null/,
      "a claw would be asked how far away the target is");
  });

  test("the editor only shows the boxes on ranged attacks", () => {
    assert.match(template, /\{\{#unless this\.isMelee\}\}/,
      "four distance boxes on every melee attack is noise on every statblock");
  });
});

describe("§43 config, schema and editor are one list", () => {
  const configKeys = Object.keys(LASTARC.rangeBands);

  test("the schema is generated from the config, not hand-copied", () => {
    assert.match(npcModel, /Object\.keys\(LASTARC\.rangeBands\)\.map\(/,
      "the rangeBands schema lists its keys by hand, so a band added to the " +
      "config would have nowhere to store");
  });

  test("the editor's boxes are generated from the config too", () => {
    assert.match(npcSheet, /Object\.entries\(LASTARC\.rangeBands\)\.map\(/,
      "the editor lists its boxes by hand, so a band added to the config would " +
      "be storable and untypeable — the exact defect of issue #32");
  });

  test("every band has a label and a tooltip", () => {
    for (const key of configKeys) {
      assert.ok(lang[LASTARC.rangeBands[key].label],
        `${key} has no label string, so its box would be captioned with a key`);
      assert.ok(lang[`LASTARC.Tooltip.RangeBand.${key}`],
        `${key} has no tooltip; the boxes are meaningless without one`);
    }
    assert.ok(lang["LASTARC.Field.RangeIncrements"]);
  });

  test("the rendered input path matches the schema's mount point", () => {
    // The one thing the loop cannot prove about itself: that it writes to
    // `system.attacks.N.rangeBands.KEY` and not somewhere adjacent.
    assert.match(template, /name="system\.attacks\.\{\{[^}]*\}\}\.rangeBands\.\{\{this\.key\}\}"/,
      "the generated inputs do not bind to the rangeBands schema");
  });
});
