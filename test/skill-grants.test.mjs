/**
 * A technick-granted skill has to LOOK granted (issue #43).
 *
 * Reported by the GM after using the skill-grant editor from 0.22.0: the
 * technick worked, but "the trained box does not show as marked, which could
 * lead to players thinking they don't have access to it".
 *
 * The maths was right and had been all along. It was even explained — in the
 * ADJ column's tooltip, with a comment in `skillAdjustmentParts` anticipating
 * this exact confusion: "granted training is a real +2 with an UNTICKED box, so
 * it needs its own line". Someone saw it coming and put the answer somewhere
 * nobody hovers. A player looks at the TRAINED column, sees an empty box, and
 * stops.
 *
 * So this is a display bug over correct arithmetic, and the fix has to respect
 * CLAUDE.md rule 4: the checkbox writes the player's OWN training and must keep
 * showing only that. The granted state is a separate glyph.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const body = read("templates/actor/character-body.hbs");
const sheet = read("module/sheets/character-sheet.mjs");
const model = read("module/data/character.mjs");

describe("§43 granted training is visible", () => {
  test("the row is given the granted values at all", () => {
    // `toRow` passed none of these, so the template could not have shown them
    // even if it wanted to. It became `skillRow` in `sheet-rows.mjs` (#44), and
    // the assertion is now made by calling it — see test/sheet-rows.test.mjs,
    // "every skill row has all three keys". Kept here as a pointer so the
    // #43 story stays readable in one place.
    for (const key of ["grantedTrained", "grantedFocus", "grantedBonus"]) {
      assert.match(read("module/sheet-rows.mjs"), new RegExp(`${key}:`),
        `skillRow does not pass ${key}`);
    }
  });

  test("a granted skill renders a tick rather than an empty box", () => {
    assert.match(body, /la-skill__granted-tick/,
      "nothing marks a granted skill, so it reads as untrained");
    // Both skill blocks — general and weapon skills.
    assert.equal((body.match(/la-skill__granted-tick/g) ?? []).length, 2,
      "only one of the two skill tables marks granted training");
  });

  /**
   * RULE 4. The checkbox must reflect the stored value and nothing else. An
   * earlier attempt rendered it `checked` from the derived state and `disabled`
   * — browsers grey a disabled control and drop its accent colour, so it drew a
   * faint EMPTY box: worse than the bug being fixed, and a control showing
   * something other than what it stores.
   */
  test("the checkbox still shows only the player's own training", () => {
    const rows = body.match(/name="system\.skills\.\{\{this\.key\}\}\.trained"[^>]*>/g) ?? [];
    assert.equal(rows.length, 2, "expected one trained checkbox per skill table");
    for (const row of rows) {
      assert.match(row, /\{\{#if this\.trained\}\}checked\{\{\/if\}\}/,
        "the box must reflect the stored value");
      assert.doesNotMatch(row, /trainedEffective|grantedTrained/,
        "the box must not be driven by a derived value — CLAUDE.md rule 4");
      assert.doesNotMatch(row, /disabled/,
        "a disabled checkbox renders greyed and empty, which is what this " +
        "change exists to stop");
    }
  });
});

describe("§43 a granted skill counts, and pays for itself", () => {
  /**
   * Anchored on the DEFINITION. `#trainedSkillLimits(` also appears as a call
   * inside prepareDerivedData, and matching that first swallows two hundred
   * unrelated lines and tests them instead — the same trap `#aggregateGrants`
   * set earlier in this project.
   */
  const found = model.match(/\n {2}#trainedSkillLimits\([^)]*\)\s*\{[\s\S]*?\n {2}\}/);
  assert.ok(found, "trainedSkillLimits definition not found");
  const fn = found[0];

  test("granted trainings are counted as known", () => {
    assert.match(fn, /grantedKeys/,
      "the trained readout ignores granted skills, so the count is short");
    assert.match(fn, /known\s*=[\s\S]{0,120}grantedKeys\.length/);
  });

  /**
   * And raise the allowance by the same one. Counting a granted skill without
   * raising the maximum would report a character OVER budget for taking Skill
   * Training — punishing them in the readout for a technick they paid for.
   */
  test("granted trainings raise the allowance too", () => {
    assert.match(fn, /trainedSkillCount\([\s\S]{0,120}\+ grantedKeys\.length/,
      "a granted skill eats the class allowance, so the sheet reports the " +
      "character over budget for taking Skill Training");
  });

  test("a skill trained BOTH ways is not counted twice", () => {
    assert.match(fn, /!this\.skills\[key\]\?\.trained/,
      "a player who also ticked the box has the skill counted twice");
  });

  test("the limits are computed after grants are available", () => {
    assert.match(model, /#trainedSkillLimits\(grants\)/,
      "called without grants, it cannot see granted training at all");
  });
});
