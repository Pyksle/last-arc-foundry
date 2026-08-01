/**
 * Situational modifiers (issue #16, v0).
 *
 * The label helpers are the whole Foundry-free surface of this feature; the
 * prompt and the wiring need a live sheet. What is worth pinning here is that a
 * typed reason survives onto the card, because the alternative — a modifier
 * appearing in a total with nothing saying why — is the thing that makes a
 * table stop trusting the numbers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { LASTARC } from "../module/config.mjs";
import { situationalLabel, situationalSuffix } from "../module/dice/situational.mjs";

describe("§16 situational modifiers", () => {
  test("a typed reason becomes the part label", () => {
    assert.equal(situationalLabel("higher ground"), "higher ground");
  });

  test("no reason falls back to the string table", () => {
    assert.equal(situationalLabel(null), "LASTARC.Mod.situational");
    assert.equal(situationalLabel(""), "LASTARC.Mod.situational");
  });

  test("a check label carries the reason and a signed number", () => {
    assert.equal(situationalSuffix("bad footing", -2), " — bad footing -2");
    assert.equal(situationalSuffix("charging", 2), " — charging +2");
  });

  test("a modifier with no reason still shows the number", () => {
    assert.equal(situationalSuffix(null, 2), " — +2");
  });

  /**
   * Alt-clicking, entering nothing and pressing Roll must not decorate the
   * label with a meaningless "+0" — that reads as a modifier that was applied.
   */
  test("an empty modifier adds nothing to the label", () => {
    assert.equal(situationalSuffix(null, 0), "");
    assert.equal(situationalSuffix("", 0), "");
  });
});

/**
 * ISSUE #29. The performance skill-bonus sentence hardcoded "to all weapon
 * skills" and printed the chosen scope beside it, so every scope except that
 * one contradicted its own label. It also never said which roll the bonus
 * modifies, while "Bonus damage" sat directly beneath it on the same card —
 * which is how a weapon-skill bonus came to be applied to damage rolls.
 */
describe("§9 performance skill bonus wording", () => {
  const lang = JSON.parse(
    readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")
  );

  test("the sentence names no scope of its own", () => {
    // Case-INSENSITIVE. The string this guards against read "to all weapon
    // skills" in lower case while the label is "All weapon skills", so an
    // exact comparison would have let the original bug straight through.
    const s = lang["LASTARC.Card.PerformSkillBonus"].toLowerCase();
    for (const scope of Object.values(LASTARC.performanceBonusScopes)) {
      const label = lang[scope.label].toLowerCase();
      assert.ok(!s.includes(label),
        `the sentence hardcodes "${label}"; it must interpolate {scope} instead`);
    }
    assert.match(s, /\{scope\}/, "the chosen scope must appear in the sentence");
  });

  test("both variants say which roll is modified", () => {
    for (const key of ["LASTARC.Card.PerformSkillBonus",
                       "LASTARC.Card.PerformSkillBonusUnscoped"]) {
      assert.match(lang[key], /d20/,
        `${key} must say the bonus is to the check, not the damage roll`);
    }
  });
});
