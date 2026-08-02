/**
 * The shared row builders (issue #44).
 *
 * These moved out of `character-sheet.mjs` so the preview harness could call
 * the SAME code the sheet calls, instead of keeping a hand-written second copy
 * that quietly drifted. Being Foundry-free, they can now be tested by calling
 * them rather than by grepping the sheet for their source — which is what the
 * three tests they displaced were reduced to doing.
 *
 * That matters beyond tidiness. A source scan asserts a line of code exists; it
 * cannot assert the line is right. `valueInput: src.attributes[key].value` and
 * `valueInput: sys.attributes[key].value` differ by three characters and by
 * whether every Active Effect on the sheet stacks on itself at the next submit.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LASTARC } from "../module/config.mjs";
import * as ROWS from "../module/sheet-rows.mjs";

/* ── a fixture with source and prepared values DELIBERATELY different ─────── */

const src = {
  attributes: { str: { value: 14, racialMod: 1, cap: 20 } },
  skills: { athletics: { misc: 3 } },
  defences: { ref: { misc: 2 } }
};

const sys = {
  details: { level: 5 },
  breakGauge: { penalty: -2, step: 2, persistentSteps: 1 },
  // Real config keys. The first draft of this fixture said "blades", which
  // is not a category — the same invented-value drift #44 exists to stop.
  proficiencies: { weapons: ["swords"], armour: ["light"] },
  attributes: Object.fromEntries(LASTARC.attributeOrder.map((k) => [
    // 18 here against 14 in `src`: an Active Effect has raised it.
    k, { value: 18, racialMod: 0, cap: 20, total: 18, mod: 4 }
  ])),
  skills: Object.fromEntries(Object.keys(LASTARC.allSkills).map((k) => [
    k, {
      trained: k === "athletics",
      grantedTrained: k === "stealth",
      grantedFocus: k === "perception" ? 1 : 0,
      technicks: k === "perception" ? 2 : 0,
      focus: 0,
      misc: 9,               // against 3 in `src`
      total: 7,
      appliesArmourPenalty: false,
      passive: 12
    }
  ])),
  defences: Object.fromEntries(LASTARC.opposableDefences.map((k) => [
    k, { value: 17, misc: 8, classBonus: 2, technicks: 1, beforeBreak: 19 }
  ])),
  resources: { secondWind: { max: 3, used: 1 }, hp: { value: 12, max: 30 }, mp: { value: 0, max: 0 } }
};

/* ── proficiencies ────────────────────────────────────────────────────────── */

describe("§44 proficiency rows come from the config, not a hand-typed list", () => {
  const { weaponProficiencies, armourProficiencies } = ROWS.proficiencyRows(sys);

  test("one row per configured weapon category, in config order", () => {
    assert.deepEqual(weaponProficiencies.map((r) => r.key), LASTARC.weaponCategories,
      "a category added to the config must grow a control on its own — this " +
      "shipped as a hand-typed list once and left every character permanently " +
      "non-proficient with whatever was missing");
  });

  test("one row per configured armour type", () => {
    assert.deepEqual(armourProficiencies.map((r) => r.key), Object.keys(LASTARC.armourTypes));
  });

  test("active reflects what the actor actually has", () => {
    assert.deepEqual(weaponProficiencies.filter((r) => r.active).map((r) => r.key), ["swords"],
      "exactly the recorded proficiency, and nothing else, reads as active");
    assert.ok(armourProficiencies.find((r) => r.key === "light").active);
  });

  test("an actor with no proficiencies recorded does not throw", () => {
    assert.doesNotThrow(() => ROWS.proficiencyRows({ proficiencies: {} }));
    assert.doesNotThrow(() => ROWS.proficiencyRows({}));
  });
});

/* ── the _source rule ─────────────────────────────────────────────────────── */

describe("§44 editable values come from _source, never the prepared model", () => {
  /**
   * The rule this enforces is CLAUDE.md rule 4's sibling. Attributes are the
   * commonest Active Effect target of all: bind an input to the POST-effect
   * value and the buffed number is written back to the database the next time
   * the player touches anything, so the effect stacks on itself every submit.
   */
  test("attribute inputs carry the stored value, not the buffed one", () => {
    const rows = ROWS.attributeRows(sys, src);
    const str = rows.find((r) => r.key === "str");
    assert.equal(str.valueInput, 14, "the input must show what is STORED");
    assert.equal(str.total, 18, "...while the readout shows the effect");
    assert.equal(str.racialModInput, 1);
  });

  test("a skill's misc input carries the stored value", () => {
    const row = ROWS.skillRow("athletics", LASTARC.skills.athletics, sys, src);
    assert.equal(row.miscInput, 3, "the input must show what is STORED");
    assert.equal(row.misc, 9, "...while the row still knows the prepared value");
  });

  test("a defence's misc input carries the stored value", () => {
    const ref = ROWS.defenceRows(sys, src).find((r) => r.key === "ref");
    assert.equal(ref.miscInput, 2);
    assert.equal(ref.misc, 8);
  });

  test("a missing _source entry falls back rather than throwing", () => {
    // A freshly created actor has no `_source` entry for an untouched field.
    assert.equal(ROWS.attributeRows(sys, {})[0].valueInput, 0);
    assert.equal(ROWS.skillRow("athletics", LASTARC.skills.athletics, sys, {}).miscInput, 0);
  });
});

/* ── granted training (#43) ───────────────────────────────────────────────── */

describe("§44 the skill row carries granted training", () => {
  test("a technick-granted skill says so without the checkbox lying", () => {
    const row = ROWS.skillRow("stealth", LASTARC.skills.stealth, sys, src);
    assert.equal(row.grantedTrained, true, "the row cannot mark what it is not told");
    assert.equal(row.trained, false,
      "the checkbox must still hold the PLAYER's own value — binding it to the " +
      "derived one is rule 4, and has shipped twice");
  });

  test("granted focus and technick bonus reach the row", () => {
    const row = ROWS.skillRow("perception", LASTARC.skills.perception, sys, src);
    assert.equal(row.grantedFocus, 1);
    assert.equal(row.grantedBonus, 2);
  });

  test("every skill row has all three keys, granted or not", () => {
    const { skills, weaponSkills } = ROWS.skillRows(sys, src);
    for (const row of [...skills, ...weaponSkills]) {
      for (const key of ["grantedTrained", "grantedFocus", "grantedBonus"]) {
        assert.ok(key in row, `${row.key} is missing ${key}`);
      }
    }
  });

  test("rows are produced for every configured skill", () => {
    const { skills, weaponSkills } = ROWS.skillRows(sys, src);
    assert.deepEqual(skills.map((r) => r.key), Object.keys(LASTARC.skills));
    assert.deepEqual(weaponSkills.map((r) => r.key), Object.keys(LASTARC.weaponSkills));
  });
});

/* ── localisation is injected, not imported ───────────────────────────────── */

describe("§44 localize is injected so these stay Foundry-free", () => {
  test("the adjustment tooltip is built with the caller's localizer", () => {
    const row = ROWS.skillRow("athletics", LASTARC.skills.athletics, sys, src,
      (key) => `«${key}»`);
    assert.match(row.adjustmentTooltip, /«LASTARC\./,
      "the injected localizer was ignored, so this module has a hidden " +
      "dependency on Foundry's and the harness cannot render it truthfully");
  });

  test("with no localizer it still returns a usable row", () => {
    // The default is the identity function: a test that only cares about shape
    // should not have to supply one.
    assert.doesNotThrow(() => ROWS.skillRow("athletics", LASTARC.skills.athletics, sys, src));
  });

  test("the break track labels the terminal step rather than printing null", () => {
    const track = ROWS.breakTrackRows(sys, (k) => k);
    const terminal = track.find((c) => c.isTerminal);
    assert.ok(terminal, "no terminal step — the null penalty is being treated as a number");
    assert.equal(terminal.label, "LASTARC.Break.Unconscious");
    assert.equal(track[0].label, "LASTARC.Break.Normal", "step 0 is no penalty, not −0");
    assert.equal(track[3].label, "−5", "the middle steps print their own number");
  });

  test("the track marks current, passed and persistent steps", () => {
    const track = ROWS.breakTrackRows(sys, (k) => k);
    assert.ok(track[2].isCurrent, "step 2 is where the fixture sits");
    assert.ok(track[1].isPassed);
    assert.ok(track[1].isPersistent, "one persistent step means step 1 is floored");
    assert.ok(!track[3].isPersistent);
  });

  test("second wind pips are formatted with the caller's formatter", () => {
    const pips = ROWS.secondWindPips(sys, (key, data) => `${key}:${data.n}`);
    assert.equal(pips.length, 3, "one pip per use, and max is derived");
    assert.deepEqual(pips.map((p) => p.spent), [true, false, false]);
    assert.match(pips[0].label, /:1$/, "the pip number must reach the formatter");
  });
});

/* ── gauges ───────────────────────────────────────────────────────────────── */

describe("§44 gauge fills are guarded", () => {
  test("zero maximum yields zero, not NaN", () => {
    // A statblock with no MP is common, and `0/0` on the page is a percentage
    // width of `NaN%`, which CSS drops — a silently full-looking bar.
    assert.equal(ROWS.gaugePercent(0, 0), 0);
  });

  test("temporary HP above the maximum clamps to full", () => {
    assert.equal(ROWS.gaugePercent(40, 30), 100);
  });

  test("a negative current value clamps to empty", () => {
    assert.equal(ROWS.gaugePercent(-5, 30), 0);
  });

  test("an ordinary fraction rounds", () => {
    assert.equal(ROWS.gaugePercent(12, 30), 40);
  });
});

/* ── the NPC variants (CLAUDE.md §10) ─────────────────────────────────────── */

describe("§44 the two actor shapes diverge on purpose, and only where they must", () => {
  const npcSys = {
    attributes: sys.attributes,
    defences: Object.fromEntries(LASTARC.opposableDefences.map((k) => [
      k, { value: 15, base: 17 }
    ]))
  };

  test("a statblock's attributes carry no editable-source fields", () => {
    // A character's do, because an Active Effect must not be written back on
    // the next submit. A statblock's scores are typed directly — there is
    // nothing derived to protect them from.
    const row = ROWS.npcAttributeRows(npcSys)[0];
    for (const key of ["valueInput", "racialModInput", "capInput"]) {
      assert.ok(!(key in row), `${key} is cargo-culted onto the statblock row`);
    }
    assert.equal(row.key, LASTARC.attributeOrder[0], "printed order, not key order");
  });

  test("a statblock's defences show the PRINTED value beside the live one", () => {
    const ref = ROWS.npcDefenceRows(npcSys).find((r) => r.key === "ref");
    assert.equal(ref.base, 17, "the page's number");
    assert.equal(ref.value, 15, "...and what it is now, after the gauge");
    assert.ok(!("miscInput" in ref),
      "a statblock has no misc slot — that is the character's own column");
  });

  test("both shapes cover every defence", () => {
    assert.deepEqual(ROWS.npcDefenceRows(npcSys).map((r) => r.key), LASTARC.opposableDefences);
    assert.deepEqual(ROWS.defenceRows(sys, src).map((r) => r.key), LASTARC.opposableDefences);
  });

  test("the break track is SHARED, not duplicated per actor type", () => {
    // It was byte-identical in both sheets, which is a change to one silently
    // missing the other. Same input, same output, one function.
    const a = ROWS.breakTrackRows(sys, (k) => k);
    const b = ROWS.breakTrackRows({ breakGauge: sys.breakGauge }, (k) => k);
    assert.deepEqual(a, b, "the track must depend on nothing but the gauge");
  });
});
