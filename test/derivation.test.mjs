/**
 * Unit tests for the Last Arc derivation math.
 *
 * These are the PRIMARY verification for §4 and §5.5 — there is no Foundry
 * install in this environment, and this logic is where a silent sign error or
 * rounding slip would do the most damage. Run with `npm test`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LASTARC } from "../module/config.mjs";
import { compareTurnOrder } from "../module/initiative.mjs";
import {
  rd,
  signed,
  resolveInjuryRoll,
  weaponSkillFor,
  wieldCategory as wieldCat,
  skillAdjustmentParts,
  attributeModifier,
  breakPenalty,
  breakPenaltyOrZero,
  clampStep,
  isIncapacitated,
  worsenStep,
  improveStep,
  reconcilePersistent,
  agiContributionToRef,
  applyIncapacitationOverride,
  computeDefences,
  breakThreshold,
  resourceMax,
  hpMax,
  mpMax,
  classDefenceBonuses,
  heroPointMax,
  skillModifier,
  trainedSkillCount,
  passivePerception,
  bulkLimits,
  encumbranceState,
  speedAfterPenalties,
  wieldCategory,
  lightWeaponAllowsChoice,
  strDamageMultiplier,
  applyDamageMitigation,
  exceedsBreakThreshold,
  restRecovery,
  secondWindHeal,
  canUseSecondWind,
  improvedInitiativeDie,
  aggregateGrants,
  checkPrerequisites,
  shieldSkillOptions,
  blockModifiers,
  resolveBlock,
  resolveHealing
} from "../module/derivation.mjs";

/* -------------------------------------------------------------------------- */

describe("§1 universal rounding", () => {
  test("rounds DOWN, not toward zero, for negatives", () => {
    // The distinction that matters: truncation would give -2 here.
    assert.equal(rd(-1.5), -2);
    assert.equal(rd(-0.5), -1);
    assert.equal(rd(2.9), 2);
  });
});

describe("§2 attribute modifiers", () => {
  test("standard formula", () => {
    assert.equal(attributeModifier(10), 0);
    assert.equal(attributeModifier(11), 0);
    assert.equal(attributeModifier(12), 1);
    assert.equal(attributeModifier(18), 4);
    assert.equal(attributeModifier(20), 5);
  });

  test("scores below 10 round down correctly", () => {
    assert.equal(attributeModifier(9), -1);   // floor(-0.5)
    assert.equal(attributeModifier(7), -2);   // floor(-1.5) — NOT -1
    assert.equal(attributeModifier(3), -4);
    assert.equal(attributeModifier(1), -5);
  });

  test("A3: clamp holds the ceiling at +5 for racial caps above 20", () => {
    assert.equal(attributeModifier(22, true), 5);
    assert.equal(attributeModifier(22, false), 6);
  });
});

/* -------------------------------------------------------------------------- */

describe("§6 Break Gauge — sign convention", () => {
  test("penalties are non-linear and index-based, never -step", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map(breakPenalty),
      [0, -1, -2, -5, -10]
    );
  });

  test("step 5 returns null, not 0 — incapacitated, not unpenalised", () => {
    assert.equal(breakPenalty(5), null);
    assert.equal(breakPenaltyOrZero(5), 0);
    assert.ok(isIncapacitated(5));
    assert.ok(!isIncapacitated(4));
  });

  test("worsen INCREASES the index, improve DECREASES it", () => {
    assert.equal(worsenStep(0), 1);
    assert.equal(worsenStep(2, 2), 4);
    assert.equal(improveStep(3), 2);
  });

  test("both directions clamp to 0..5", () => {
    assert.equal(worsenStep(5), 5);
    assert.equal(worsenStep(4, 99), 5);
    assert.equal(improveStep(0), 0);
  });

  test("recovery floors at persistentSteps, never below", () => {
    assert.equal(improveStep(3, 1, 2), 2);
    assert.equal(improveStep(2, 1, 2), 2, "cannot improve past a persistent step");
    assert.equal(improveStep(4, 3, 2), 2, "multi-step improvement still floors");
  });

  test("persistentSteps <= step invariant is enforced", () => {
    assert.deepEqual(reconcilePersistent(1, 3), { step: 3, persistentSteps: 3 });
    assert.deepEqual(reconcilePersistent(4, 2), { step: 4, persistentSteps: 2 });
  });
});

/* -------------------------------------------------------------------------- */

describe("§4.1 Reflex — Agility contribution", () => {
  test("armour caps the BONUS", () => {
    assert.equal(agiContributionToRef(6, { maxAgiBonus: 4 }), 4);
    assert.equal(agiContributionToRef(2, { maxAgiBonus: 4 }), 2);
  });

  test("unarmoured defaults to no cap rather than NaN", () => {
    const r = agiContributionToRef(6);
    assert.equal(r, 6);
    assert.ok(Number.isFinite(r), "must not be NaN — this poisons every downstream value");
  });

  test("a NEGATIVE modifier always applies in full", () => {
    assert.equal(agiContributionToRef(-3, { maxAgiBonus: 0 }), -3);
    assert.equal(agiContributionToRef(-3, { agiDenied: true }), -3,
      "flat-footed removes the bonus, not the penalty");
  });

  test("agiDenied zeroes a positive bonus", () => {
    assert.equal(agiContributionToRef(4, { agiDenied: true }), 0);
  });
});

describe("§4.1 incapacitation override", () => {
  test("sets to -5 rather than adding -5", () => {
    assert.equal(applyIncapacitationOverride(3, true), -5);
    assert.equal(applyIncapacitationOverride(3, false), 3);
  });

  test("is idempotent — unconscious + prone + helpless must not reach -15", () => {
    let m = 3;
    m = applyIncapacitationOverride(m, true);
    m = applyIncapacitationOverride(m, true);
    m = applyIncapacitationOverride(m, true);
    assert.equal(m, -5);
  });

  test("does not RAISE an already-worse modifier", () => {
    assert.equal(applyIncapacitationOverride(-8, true), -8);
  });
});

describe("§4.1 defences", () => {
  const base = {
    level: 4, agiMod: 3, vitMod: 2, mndMod: 1,
    classBonus: { ref: 2, fort: 1, will: 0 },
    armour: { refBonus: 2, maxAgiBonus: 4 }
  };

  test("composes all terms", () => {
    const d = computeDefences(base);
    assert.equal(d.ref, 10 + 4 + 3 + 2 + 2 + 0 + 0);   // 21
    assert.equal(d.fort, 10 + 4 + 2 + 1);              // 17
    assert.equal(d.will, 10 + 4 + 1 + 0);              // 15
  });

  test("break penalty lowers ALL THREE defences", () => {
    const d = computeDefences({ ...base, breakStep: 3 });
    assert.equal(d.breakPenalty, -5);
    assert.equal(d.ref, 21 - 5);
    assert.equal(d.fort, 17 - 5);
    assert.equal(d.will, 15 - 5);
  });

  test("no defence is ever NaN when unarmoured", () => {
    const d = computeDefences({ level: 1, agiMod: 2, armour: undefined });
    for (const k of ["ref", "fort", "will"]) {
      assert.ok(Number.isFinite(d[k]), `${k} was ${d[k]}`);
    }
  });

  test("Fortitude takes no incapacitation override", () => {
    const up = computeDefences({ ...base, incapacitated: false });
    const down = computeDefences({ ...base, incapacitated: true });
    assert.equal(up.fort, down.fort, "Vit is unaffected by unconsciousness");
    assert.ok(down.ref < up.ref, "Reflex should drop");
    assert.ok(down.will < up.will, "Will should drop");
  });
});

/* -------------------------------------------------------------------------- */

describe("§4.2 Break Threshold", () => {
  test("size bonus applies from Large up only", () => {
    assert.equal(breakThreshold({ fort: 20, size: "medium" }), 20);
    assert.equal(breakThreshold({ fort: 20, size: "small" }), 20);
    assert.equal(breakThreshold({ fort: 20, size: "large" }), 25);
    assert.equal(breakThreshold({ fort: 20, size: "colossal" }), 70);
  });

  /**
   * Issue #7. This test previously asserted the opposite — "THE DEATH SPIRAL:
   * worsening the gauge lowers Threshold automatically" — and passed, because
   * it fed `breakThreshold` the already-penalised Fortitude itself. The pure
   * function is agnostic about which Fortitude it is given; the test encoded
   * the wrong CALL-SITE convention and then verified its own premise.
   *
   * The book's Break Gauge penalty is enumerated at every step as applying "to
   * all defences, attack rolls, skill checks, and attribute checks". Break
   * Threshold is in none of those lists. It is what damage is compared
   * against, not a roll or a roll target, and the book lists it among the
   * statistics computed at character creation.
   */
  test("Threshold is built from the UNPENALISED Fortitude, so the gauge does not move it", () => {
    const actor = { level: 5, vitMod: 3, classBonus: { ref: 0, fort: 2, will: 0 } };

    // What the actor model now feeds it: fort minus the break penalty, which
    // is the `beforeBreak` subtotal.
    const thresholdAt = (step) => {
      const d = computeDefences({ ...actor, breakStep: step });
      return breakThreshold({ fort: d.fort - d.breakPenalty });
    };

    const unbroken = thresholdAt(0);
    assert.equal(unbroken, 20);

    for (const step of [1, 2, 3, 4]) {
      assert.equal(thresholdAt(step), unbroken,
        `Threshold moved at break step ${step}; it must stay constant`);
    }
  });

  test("the optional spiral is still expressible by passing the live Fortitude", () => {
    // breakGaugeAffectsThreshold restores this for tables that read it the
    // other way, so the arithmetic must still work — it is the call site that
    // decides, not the function.
    const actor = { level: 5, vitMod: 3, classBonus: { ref: 0, fort: 2, will: 0 } };
    const spiralAt = (step) =>
      breakThreshold({ fort: computeDefences({ ...actor, breakStep: step }).fort });

    assert.equal(spiralAt(0), 20);
    assert.equal(spiralAt(1), 19);
    assert.equal(spiralAt(4), 10);
  });
});

/* -------------------------------------------------------------------------- */

describe("§4.3 HP / MP by class", () => {
  test("single-class level 1 is the base grant plus the modifier", () => {
    assert.equal(hpMax([{ name: "warrior", levels: 1 }], 2), 32);   // 30 + 2
    assert.equal(mpMax([{ name: "mage", levels: 1 }], 3), 15);      // 12 + 3
  });

  test("per-level gains also add the modifier every level", () => {
    // Warrior 3: (30+2) + 2 * (6+2) = 32 + 16 = 48
    assert.equal(hpMax([{ name: "warrior", levels: 3 }], 2), 48);
  });

  test("multiclass charges each level to its own class", () => {
    // Warrior 1 (first) = 30+2 ; Rogue 2 = 2*(5+2)=14  → 46
    const classes = [{ name: "warrior", levels: 1 }, { name: "rogue", levels: 2 }];
    assert.equal(hpMax(classes, 2), 46);
  });

  test("negative Vit does not produce a negative maximum", () => {
    assert.ok(hpMax([{ name: "mage", levels: 1 }], -5) >= 0);
  });

  test("unknown class throws rather than silently returning 0", () => {
    assert.throws(() => hpMax([{ name: "nonesuch", levels: 1 }], 0), /Unknown class/);
  });
});

describe("§4.3 / A9 class defence bonuses on multiclass", () => {
  const classes = [{ name: "warrior", levels: 3 }, { name: "rogue", levels: 2 }];

  test("default: granted on the first class only", () => {
    assert.deepEqual(classDefenceBonuses(classes), { ref: 0, fort: 2, will: 1 });
  });

  test("setting enabled: both classes grant", () => {
    assert.deepEqual(classDefenceBonuses(classes, true), { ref: 2, fort: 3, will: 1 });
  });
});

/* -------------------------------------------------------------------------- */

describe("§4.4 / A8 hero points", () => {
  test("tiers at 1 / 6 / 11 / 16", () => {
    assert.equal(heroPointMax(1), 1);
    assert.equal(heroPointMax(5), 1);
    assert.equal(heroPointMax(6), 2);
    assert.equal(heroPointMax(11), 3);
    assert.equal(heroPointMax(16), 4);
    assert.equal(heroPointMax(20), 4);
  });

  test("A8: Heroic stacks ON TOP of the cap, so it still helps at level 16+", () => {
    assert.equal(heroPointMax(16, 2), 6);
    assert.equal(heroPointMax(1, 1), 2);
  });
});

/* -------------------------------------------------------------------------- */

describe("§4.5 skill modifiers", () => {
  test("half level, attribute, trained, focus", () => {
    assert.equal(skillModifier({ level: 5, attrMod: 3, trained: true }), 2 + 3 + 5);
    assert.equal(skillModifier({ level: 5, attrMod: 3, trained: false }), 2 + 3);
    assert.equal(skillModifier({ level: 4, attrMod: 0, focus: 2 }), 2 + 2);
  });

  test("armour check penalty SUBTRACTS when it applies", () => {
    const withPenalty = skillModifier({
      level: 2, attrMod: 2, armourCheckPenalty: 5, appliesArmourPenalty: true
    });
    const without = skillModifier({
      level: 2, attrMod: 2, armourCheckPenalty: 5, appliesArmourPenalty: false
    });
    assert.equal(without - withPenalty, 5, "penalty must reduce, never increase");
    assert.ok(withPenalty < without);
  });

  test("a negative penalty is rejected outright — this was the rev1 sign bug", () => {
    assert.throws(
      () => skillModifier({ armourCheckPenalty: -5, appliesArmourPenalty: true }),
      /positive magnitude/
    );
  });

  test("break penalty applies to skills too", () => {
    assert.equal(skillModifier({ level: 2, attrMod: 0, breakStep: 2 }), 1 - 2);
  });

  /**
   * Read from the "Number of Trained Skills" table (book p.35). Four of these
   * were null and the function threw rather than guess; all six are now known.
   */
  test("trained-skill count is the class base plus Int modifier", () => {
    assert.equal(trainedSkillCount("rogue", 2), 10, "rogue 8 + 2");
    assert.equal(trainedSkillCount("bard", 2), 8, "bard 6 + 2");
    assert.equal(trainedSkillCount("ranger", 0), 6);
    assert.equal(trainedSkillCount("warrior", 0), 6);
    assert.equal(trainedSkillCount("mage", 3), 7, "mage 4 + 3");
    assert.equal(trainedSkillCount("initiate", 0), 4);
  });

  test("half-elves get one more", () => {
    assert.equal(trainedSkillCount("warrior", 0, true), 7);
  });

  test("an unknown class still throws rather than guessing", () => {
    assert.throws(() => trainedSkillCount("archmage", 2), /Unknown class/);
  });
});

describe("§7 passive perception (A4, resolved)", () => {
  test("10 + Perception, per the printed sheet", () => {
    assert.equal(passivePerception(7), 17);
    assert.equal(passivePerception(0), 10);
  });
});

/* -------------------------------------------------------------------------- */

describe("§4.6 bulk and speed", () => {
  test("limits derive from the Str SCORE, not the modifier", () => {
    assert.deepEqual(bulkLimits(14), { max: 19, overMax: 24 });
  });

  test("encumbrance thresholds", () => {
    assert.equal(encumbranceState(10, 14), "none");
    assert.equal(encumbranceState(20, 14), "encumbered");
    assert.equal(encumbranceState(25, 14), "overencumbered");
    assert.equal(encumbranceState(19, 14), "none", "at the limit is not yet encumbered");
  });

  test("speed penalties are ADDITIVE, not multiplicative", () => {
    assert.equal(speedAfterPenalties(8, [0.25]), 6);

    // Base 16 is chosen deliberately: it is a speed where the two readings
    // actually diverge after flooring. Additive gives 16 × (1 − ½) = 8;
    // chaining ×¾ twice gives 16 × 0.5625 = 9. Many bases (8, 12) floor to the
    // same answer under both and would make this assertion vacuous.
    assert.equal(speedAfterPenalties(16, [0.25, 0.25]), 8, "additive");
    assert.equal(rd(16 * 0.75 * 0.75), 9, "multiplicative — what we must NOT do");
  });

  test("speed floors at 0", () => {
    assert.equal(speedAfterPenalties(6, [1.5]), 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("§5.4 weapon sizing", () => {
  test("relative size selects the skill", () => {
    assert.equal(wieldCategory("medium", "medium"), "oneHanded");
    assert.equal(wieldCategory("medium", "large"), "twoHanded");
    assert.equal(wieldCategory("medium", "small"), "light");
    assert.equal(wieldCategory("medium", "tiny"), "light");
    assert.equal(wieldCategory("medium", "huge"), "unusable");
  });

  test("the SAME weapon differs by wielder — why this is never stored on the item", () => {
    assert.equal(wieldCategory("small", "medium"), "twoHanded");
    assert.equal(wieldCategory("medium", "medium"), "oneHanded");
    assert.equal(wieldCategory("large", "medium"), "light");
  });

  test("one category smaller offers a choice; two or more does not", () => {
    assert.ok(lightWeaponAllowsChoice("medium", "small"));
    assert.ok(!lightWeaponAllowsChoice("medium", "tiny"));
  });

  test("REGRESSION: ranged weapons are not routed to 1-Handed", () => {
    assert.equal(wieldCategory("medium", "medium", "bows"), "ranged");
    assert.equal(wieldCategory("medium", "medium", "crossbows"), "ranged");
    assert.equal(wieldCategory("medium", "medium", "swords"), "oneHanded");
  });

  test("size still gates usability for ranged weapons", () => {
    assert.equal(wieldCategory("tiny", "large", "bows"), "unusable");
  });

  test("only a derived two-handed wield doubles Str", () => {
    assert.equal(strDamageMultiplier("twoHanded"), 2);
    assert.equal(strDamageMultiplier("oneHanded"), 1);
    assert.equal(strDamageMultiplier("light"), 1);
  });
});

/* -------------------------------------------------------------------------- */

describe("§5.5 damage mitigation pipeline", () => {
  test("immunity zeroes and short-circuits", () => {
    const r = applyDamageMitigation({ total: 40, immunity: true, dr: 5 });
    assert.equal(r.final, 0);
    assert.ok(r.immune);
    assert.ok(r.secondaryEffectsNegated);
  });

  test("weakness multiplies by 1.5 and FLOORS", () => {
    assert.equal(applyDamageMitigation({ total: 7, weakness: true, isHit: true }).preDR, 10);
    assert.equal(applyDamageMitigation({ total: 9, weakness: true, isHit: true }).preDR, 13);
  });

  test("weakness is applied BEFORE resistance", () => {
    const r = applyDamageMitigation({ total: 10, weakness: true, resistance: true });
    assert.equal(r.preDR, 7);   // floor(10*1.5)=15 → floor(15/2)=7
  });

  test("resistance negates secondary effects", () => {
    assert.ok(applyDamageMitigation({ total: 10, resistance: true }).secondaryEffectsNegated);
    assert.ok(!applyDamageMitigation({ total: 10 }).secondaryEffectsNegated);
  });

  test("DR subtracts, and unaspected bypasses it entirely", () => {
    assert.equal(applyDamageMitigation({ total: 10, dr: 4 }).final, 6);
    assert.equal(applyDamageMitigation({ total: 10, dr: 4, type: "unaspected" }).final, 10);
  });

  test("a successful hit always deals at least 1", () => {
    assert.equal(applyDamageMitigation({ total: 3, dr: 20, isHit: true }).final, 1);
  });

  test("both taps are exposed for the A1 setting", () => {
    const r = applyDamageMitigation({ total: 20, dr: 6 });
    assert.equal(r.preDR, 20);
    assert.equal(r.postDR, 14);
  });

  test("A1: the pre/post-DR choice changes whether a Break step happens", () => {
    const r = applyDamageMitigation({ total: 20, dr: 6 });
    const threshold = 17;
    assert.equal(exceedsBreakThreshold(r, threshold, false), true,  "pre-DR 20 > 17");
    assert.equal(exceedsBreakThreshold(r, threshold, true),  false, "post-DR 14 < 17");
  });

  test("meet-it-beat-it: Threshold must be EXCEEDED, not merely met", () => {
    const r = applyDamageMitigation({ total: 17, dr: 0 });
    assert.equal(exceedsBreakThreshold(r, 17, true), false);
    assert.equal(exceedsBreakThreshold(r, 16, true), true);
  });
});

/* -------------------------------------------------------------------------- */

describe("§13 rest and second wind", () => {
  test("recovery scales with hours, capped at 8", () => {
    assert.equal(restRecovery({ attrMod: 2, level: 3, hours: 8 }), 40);
    assert.equal(restRecovery({ attrMod: 2, level: 3, hours: 30 }), 40, "no reward past 8h");
  });

  test("a negative modifier cannot drain HP", () => {
    assert.equal(restRecovery({ attrMod: -3, level: 1, hours: 8 }), 0);
  });

  test("persistent conditions block rest entirely", () => {
    assert.equal(restRecovery({ attrMod: 5, level: 5, hours: 8, blocked: true }), 0);
  });

  test("second wind heals the better of Vit score and a quarter of max HP", () => {
    assert.equal(secondWindHeal(14, 40), 14);
    assert.equal(secondWindHeal(8, 60), 15);
  });

  test("second wind is unusable above half max HP", () => {
    assert.ok(canUseSecondWind(20, 40));
    assert.ok(!canUseSecondWind(21, 40));
  });

  test("healing stops at the maximum and reports what was wasted", () => {
    const r = resolveHealing({ amount: 12, current: 34, max: 40 });
    assert.equal(r.newHp, 40);
    assert.equal(r.applied, 6);
    assert.equal(r.wasted, 6, "the half that vanished is the interesting half");
  });

  test("healing a zombified target damages it instead, ignoring the maximum", () => {
    const r = resolveHealing({ amount: 12, current: 34, max: 40, becomesDamage: true });
    assert.equal(r.inverted, true);
    assert.equal(r.newHp, 22);
    assert.equal(r.wasted, 0, "nothing is wasted when the heal is a wound");
  });

  test("inverted healing floors at 0 rather than going negative", () => {
    assert.equal(resolveHealing({ amount: 50, current: 8, max: 40, becomesDamage: true }).newHp, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("block — the shield reaction (book p.109)", () => {
  test("shield class follows size RELATIVE to the wielder", () => {
    // Medium wielder: tiny is two down, small one down, medium level, large one up.
    assert.deepEqual(shieldSkillOptions("medium", "medium"), ["oneHanded"]);
    assert.deepEqual(shieldSkillOptions("medium", "small"), ["lightWeapon", "oneHanded"],
      "a light shield may use either skill");
    assert.deepEqual(shieldSkillOptions("medium", "tiny"), ["lightWeapon"],
      "two sizes down MUST use Light Weapon");
    assert.deepEqual(shieldSkillOptions("medium", "large"), ["twoHanded"]);
  });

  test("Strength 15 lets a heavy shield use the 1-Handed skill instead", () => {
    assert.deepEqual(shieldSkillOptions("medium", "large", { strScore: 14 }), ["twoHanded"]);
    assert.deepEqual(shieldSkillOptions("medium", "large", { strScore: 15 }),
      ["twoHanded", "oneHanded"]);
  });

  test("the classes shift with the wielder, not with the shield alone", () => {
    // A large shield is a STANDARD shield for a large creature.
    assert.deepEqual(shieldSkillOptions("large", "large"), ["oneHanded"]);
    assert.deepEqual(shieldSkillOptions("small", "medium"), ["twoHanded"]);
  });

  test("a shield two or more sizes larger is unusable", () => {
    assert.deepEqual(shieldSkillOptions("tiny", "medium"), []);
  });

  test("the first block of a turn takes no cumulative penalty", () => {
    const m = blockModifiers({ skillMod: 7, shieldBonus: 2, previousBlocks: 0 });
    assert.equal(m.total, 9);
    assert.ok(!m.parts.some((p) => p.label === "LASTARC.Mod.repeatBlock"));
  });

  test("each earlier block costs a further −5 when proficient", () => {
    assert.equal(blockModifiers({ skillMod: 7, previousBlocks: 1 }).total, 2);
    assert.equal(blockModifiers({ skillMod: 7, previousBlocks: 2 }).total, -3);
  });

  /**
   * The direction here is the whole point. An earlier draft of the spec had
   * Shield Proficiency "capping the cumulative penalty at a flat −5", which
   * makes the proficiency a downgrade for anyone who blocks twice. The book has
   * it the other way round: −5 each is normal, and lacking the proficiency
   * doubles it to −10 each AND adds a flat −5 on top.
   */
  test("lacking Shield Proficiency doubles the repeat rate AND costs a flat −5", () => {
    const first = blockModifiers({ skillMod: 7, previousBlocks: 0, proficient: false });
    assert.equal(first.total, 2, "flat −5 applies even on the first block");

    const second = blockModifiers({ skillMod: 7, previousBlocks: 1, proficient: false });
    assert.equal(second.total, -8, "−5 flat and −10 for the earlier block");

    const proficientSecond = blockModifiers({ skillMod: 7, previousBlocks: 1 });
    assert.ok(proficientSecond.total > second.total,
      "proficiency must never be worse than its absence");
  });

  test("the two penalties are separate parts, so the card can name them", () => {
    const m = blockModifiers({ skillMod: 7, previousBlocks: 2, proficient: false });
    const labels = m.parts.map((p) => p.label);
    assert.ok(labels.includes("LASTARC.Mod.nonProficientShield"));
    assert.ok(labels.includes("LASTARC.Mod.repeatBlock"));
  });

  test("a tie goes to the ATTACKER — the block must beat, not meet", () => {
    assert.equal(resolveBlock({ blockTotal: 18, attackTotal: 17 }).blocked, true);
    assert.equal(resolveBlock({ blockTotal: 17, attackTotal: 17 }).blocked, false,
      "the rest of this system is meet-it-beat-it; this one is not");
    assert.equal(resolveBlock({ blockTotal: 16, attackTotal: 17 }).blocked, false);
  });
});

/* -------------------------------------------------------------------------- */

describe("§8 initiative — inverted", () => {
  test("Improved Initiative steps the die DOWN, floored at d3", () => {
    assert.equal(improvedInitiativeDie("d12"), "d10");
    assert.equal(improvedInitiativeDie("d12", 3), "d6");
    assert.equal(improvedInitiativeDie("d4", 5), "d3", "floors at d3");
  });

  test("LOWEST initiative acts first", () => {
    const order = [
      { name: "slow", initiative: 9, agiScore: 18 },
      { name: "fast", initiative: 2, agiScore: 10 }
    ].sort(compareTurnOrder);
    assert.equal(order[0].name, "fast");
  });

  test("ties break on higher Agi SCORE", () => {
    const order = [
      { name: "lowAgi", initiative: 4, agiScore: 11 },
      { name: "highAgi", initiative: 4, agiScore: 17 }
    ].sort(compareTurnOrder);
    assert.equal(order[0].name, "highAgi");
  });
});

/* -------------------------------------------------------------------------- */

describe("§11 technick grants", () => {
  test("empty input yields a fully-formed zero object", () => {
    const g = aggregateGrants([]);
    assert.deepEqual(g.defences, { ref: 0, fort: 0, will: 0 });
    assert.equal(g.heroPoints, 0);
    assert.equal(g.recoveryMinorActions, null);
    assert.deepEqual(g.skills, {});
  });

  test("numeric payloads sum across items", () => {
    const g = aggregateGrants([
      { defences: { ref: 1, fort: 0, will: 0 }, heroPoints: 1 },
      { defences: { ref: 2, fort: 1, will: 0 }, breakThreshold: 5 }
    ]);
    assert.equal(g.defences.ref, 3);
    assert.equal(g.defences.fort, 1);
    assert.equal(g.breakThreshold, 5);
    assert.equal(g.heroPoints, 1);
  });

  test("repeatable technicks stack — three copies give three steps", () => {
    const improvedInit = { initiativeSteps: 1 };
    const g = aggregateGrants([improvedInit, improvedInit, improvedInit]);
    assert.equal(g.initiativeSteps, 3);
  });

  test("recoveryMinorActions takes the MINIMUM, not the sum", () => {
    // Shake it Off lowers a requirement. Holding it twice must not lower the
    // Recovery action to one minor action, let alone to zero.
    const shakeItOff = { recoveryMinorActions: 2 };
    const g = aggregateGrants([shakeItOff, shakeItOff]);
    assert.equal(g.recoveryMinorActions, 2);
  });

  test("skill grants merge per skill key", () => {
    const g = aggregateGrants([
      { skills: [{ key: "stealth", focus: 2 }] },
      { skills: [{ key: "stealth", bonus: 1 }, { key: "athletics", trained: true }] }
    ]);
    assert.deepEqual(g.skills.stealth, { focus: 2, bonus: 1, trained: false });
    assert.equal(g.skills.athletics.trained, true);
  });

  test("null and malformed entries are skipped rather than throwing", () => {
    assert.doesNotThrow(() => aggregateGrants([null, undefined, {}, { skills: [{}] }]));
  });
});

describe("§11 prerequisites", () => {
  const actor = {
    attributes: { str: 14, agi: 12, int: 10 },
    characterLevel: 5,
    classLevel: 3,
    technicks: new Set(["precise-shot"]),
    talents: new Set([]),
    trainedSkills: new Set(["acrobatics", "stealth"])
  };

  test("all satisfied", () => {
    const r = checkPrerequisites(
      { attributes: { str: 13 }, characterLevel: 4, technicks: ["precise-shot"] }, actor
    );
    assert.ok(r.met);
    assert.deepEqual(r.unmet, []);
  });

  test("reports EVERY unmet requirement, not just the first", () => {
    const r = checkPrerequisites({
      attributes: { str: 18, agi: 16 },
      characterLevel: 9,
      technicks: ["dual-wield-i"],
      trainedSkills: ["smithing"]
    }, actor);

    assert.ok(!r.met);
    assert.equal(r.unmet.length, 5, `got: ${r.unmet.join(" | ")}`);
  });

  test("empty prerequisites are trivially met", () => {
    assert.ok(checkPrerequisites({}, actor).met);
    assert.ok(checkPrerequisites(undefined, actor).met);
  });

  test("a missing attribute counts as 0, not as satisfied", () => {
    const r = checkPrerequisites({ attributes: { chr: 13 } }, actor);
    assert.ok(!r.met);
  });

  test("accepts arrays as well as Sets for owned technicks", () => {
    const arrayActor = { ...actor, technicks: ["precise-shot"] };
    assert.ok(checkPrerequisites({ technicks: ["precise-shot"] }, arrayActor).met);
  });
});

/* -------------------------------------------------------------------------- */

describe("config integrity", () => {
  test("every skill's governing attribute exists", () => {
    for (const [key, skill] of Object.entries(LASTARC.allSkills)) {
      assert.ok(LASTARC.attributes[skill.attr], `${key} references unknown attribute ${skill.attr}`);
    }
  });

  test("attribute display order covers every attribute exactly once", () => {
    assert.deepEqual(
      [...LASTARC.attributeOrder].sort(),
      Object.keys(LASTARC.attributes).sort()
    );
  });

  test("creature and object size tables cover the same sizes", () => {
    assert.deepEqual(
      Object.keys(LASTARC.sizes).sort(),
      Object.keys(LASTARC.objectSizes).sort()
    );
  });

  test("the two size tables are genuinely different and must stay separate", () => {
    assert.notEqual(LASTARC.sizes.fine.mod, LASTARC.objectSizes.fine.refMod);
  });

  test("break penalty table is the expected non-linear shape", () => {
    assert.equal(LASTARC.breakPenalties.length, 6);
    assert.equal(LASTARC.breakPenalties[5], null);
  });
});

/* -------------------------------------------------------------------------- */

describe("skill adjustment breakdown", () => {
  /**
   * REGRESSION GUARD, and the reason the column exists.
   *
   * The sheet prints ½Level, Attribute, Trained, Focus and Bonus. Before the
   * adjustment column, a level-5 character at Break step 2 showed a row reading
   * "2 + 1" that totalled +1 — the −2 was applied and invisible, which reads as
   * a broken sheet rather than as a death spiral.
   *
   * This pins the invariant the sheet relies on:
   *
   *   total = ½Level + attrMod + shownTrained + focus + misc + adjustment
   */
  const invariant = (skill, { level, attrMod, breakStep }) => {
    const breakPenalty = breakPenaltyOrZero(breakStep);
    const adjustment = skillAdjustmentParts(skill, breakPenalty)
      .reduce((sum, p) => sum + p.value, 0);

    const shown =
      rd(level / 2)
      + attrMod
      + (skill.trained ? LASTARC.trainedBonus : 0)
      + skill.focus
      + skill.misc
      + adjustment;

    const actual = skillModifier({
      level,
      attrMod,
      trained: skill.trained || skill.grantedTrained,
      focus: skill.focus + (skill.grantedFocus ?? 0),
      technicks: skill.technicks ?? 0,
      misc: skill.misc,
      armourCheckPenalty: skill.armourCheckPenalty ?? 0,
      appliesArmourPenalty: (skill.armourCheckPenalty ?? 0) > 0,
      breakStep
    });

    return { shown, actual };
  };

  test("the visible columns plus the adjustment equal the real total", () => {
    const { shown, actual } = invariant(
      { trained: false, focus: 0, misc: 0, armourCheckPenalty: 0 },
      { level: 5, attrMod: 1, breakStep: 2 }
    );
    assert.equal(shown, actual);
    assert.equal(actual, 1, "the case seen on the live sheet: 2 + 1 − 2");
  });

  test("holds with every term at once", () => {
    const skill = {
      trained: true, focus: 2, misc: 1,
      technicks: 3, grantedFocus: 1, grantedTrained: false,
      armourCheckPenalty: 4
    };
    const { shown, actual } = invariant(skill, { level: 7, attrMod: 2, breakStep: 3 });
    assert.equal(shown, actual);
  });

  test("granted training is itemised, since its checkbox stays unticked", () => {
    const skill = { trained: false, focus: 0, misc: 0, grantedTrained: true };
    const parts = skillAdjustmentParts(skill, 0);
    assert.deepEqual(
      parts.map((p) => p.label),
      ["LASTARC.Mod.grantedTrained"],
      "a +2 with no ticked box must be explained or it looks like it came from nowhere"
    );
    const { shown, actual } = invariant(skill, { level: 1, attrMod: 0, breakStep: 0 });
    assert.equal(shown, actual);
  });

  test("the armour check penalty is negated — it is stored as a magnitude", () => {
    const parts = skillAdjustmentParts({ armourCheckPenalty: 4 }, 0);
    assert.deepEqual(parts, [{ label: "LASTARC.Mod.armourCheck", value: -4 }]);
  });

  test("an unbroken, unequipped, ungranted skill has nothing to explain", () => {
    assert.deepEqual(skillAdjustmentParts({ trained: true, focus: 3 }, 0), []);
  });

  test("signed() uses a real minus so columns align", () => {
    assert.equal(signed(3), "+3");
    assert.equal(signed(0), "+0");
    assert.equal(signed(-2), "−2");
    assert.notEqual(signed(-2), "-2");
  });
});


/* -------------------------------------------------------------------------- */

describe("wield category to weapon skill mapping", () => {
  /**
   * REGRESSION GUARD. These are two different vocabularies. The wield category
   * for a small weapon is `light`; the SKILL is `lightWeapon`. Looking the skill
   * up by wield category resolved to undefined and the attack rolled with no
   * skill bonus at all — a bare d20 for every rogue, silently.
   */
  test("every wield category maps to a real weapon skill", () => {
    const categories = ["oneHanded", "twoHanded", "light", "ranged", "unarmed"];
    for (const cat of categories) {
      const key = weaponSkillFor(cat);
      assert.ok(
        key in LASTARC.weaponSkills,
        `wield category "${cat}" maps to "${key}", which is not a weapon skill`
      );
    }
  });

  test("light maps to lightWeapon, not to itself", () => {
    assert.equal(weaponSkillFor("light"), "lightWeapon");
  });

  test("throws rather than returning a default", () => {
    // The bug being guarded against was a silent zero, so an unknown category
    // must be loud.
    assert.throws(() => weaponSkillFor("unusable"), /No weapon skill maps/);
    assert.throws(() => weaponSkillFor(undefined), /No weapon skill maps/);
  });

  test("every category wieldCategory can return is mapped", () => {
    // Drive it from the real function rather than a hand-copied list, so a new
    // category added there cannot slip past this test.
    const sizes = LASTARC.sizeOrder;
    const produced = new Set();
    for (const a of sizes) {
      for (const w of sizes) {
        for (const c of [null, "bows"]) {
          const cat = wieldCat(a, w, c);
          if (cat !== "unusable") produced.add(cat);
        }
      }
    }
    for (const cat of produced) {
      assert.doesNotThrow(
        () => weaponSkillFor(cat),
        `wieldCategory can return "${cat}" but nothing maps it to a skill`
      );
    }
  });
});


/* -------------------------------------------------------------------------- */

describe("§5.6 Injury & Dismemberment (A7, resolved)", () => {
  /**
   * The resolution that unblocked this. The chart is NOT three mutually
   * exclusive bands — the book says "rolling the % shown, OR LESS, will impose
   * the listed effect", so each row is an independent threshold on one roll and
   * they stack. Read as exclusive bands, dismemberment would be a 15% outcome;
   * read correctly it is 10% and 5% independently, and 91–100 is unharmed.
   */
  test("a low roll imposes every effect it reaches, not just one", () => {
    const ids = resolveInjuryRoll(3).map((r) => r.id);
    assert.deepEqual(ids, ["severedArm", "severedLeg", "injury"],
      "3 is ≤5, ≤10 and ≤90, so all three apply");
  });

  test("a middling roll imposes only what it reaches", () => {
    assert.deepEqual(resolveInjuryRoll(8).map((r) => r.id), ["severedLeg", "injury"]);
    assert.deepEqual(resolveInjuryRoll(50).map((r) => r.id), ["injury"]);
  });

  test("91-100 is unharmed — the 'gap' is the escape", () => {
    assert.deepEqual(resolveInjuryRoll(91), []);
    assert.deepEqual(resolveInjuryRoll(100), []);
  });

  test("the boundaries are inclusive — 'the % shown, or less'", () => {
    assert.ok(resolveInjuryRoll(90).some((r) => r.id === "injury"));
    assert.ok(resolveInjuryRoll(10).some((r) => r.id === "severedLeg"));
    assert.ok(resolveInjuryRoll(5).some((r) => r.id === "severedArm"));
    assert.ok(!resolveInjuryRoll(11).some((r) => r.id === "severedLeg"));
  });

  test("results come back worst first", () => {
    const rolled = resolveInjuryRoll(1);
    assert.equal(rolled[0].id, "severedArm", "the rarest outcome leads");
  });

  test("both dismemberment statuses are registered and permanent", () => {
    for (const id of ["severedLeg", "severedArm"]) {
      assert.ok(LASTARC.allStatusIds.includes(id), `${id} not registered`);
      assert.equal(LASTARC.statusEffects[id].permanent, true,
        "a missing limb is not cleared by rest");
    }
  });
});
