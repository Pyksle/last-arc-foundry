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
import {
  rd,
  signed,
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
  compareInitiative,
  aggregateGrants,
  checkPrerequisites
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

describe("§4.2 Break Threshold and the death spiral", () => {
  test("size bonus applies from Large up only", () => {
    assert.equal(breakThreshold({ fort: 20, size: "medium" }), 20);
    assert.equal(breakThreshold({ fort: 20, size: "small" }), 20);
    assert.equal(breakThreshold({ fort: 20, size: "large" }), 25);
    assert.equal(breakThreshold({ fort: 20, size: "colossal" }), 70);
  });

  test("THE DEATH SPIRAL: worsening the gauge lowers Threshold automatically", () => {
    const actor = { level: 5, vitMod: 3, classBonus: { ref: 0, fort: 2, will: 0 } };
    const thresholdAt = (step) =>
      breakThreshold({ fort: computeDefences({ ...actor, breakStep: step }).fort });

    const t0 = thresholdAt(0);
    const t1 = thresholdAt(1);
    const t3 = thresholdAt(3);
    const t4 = thresholdAt(4);

    assert.equal(t0, 20);
    assert.equal(t1, 19);
    assert.equal(t3, 15);
    assert.equal(t4, 10);

    assert.ok(t1 < t0 && t3 < t1 && t4 < t3,
      "each Break step must make the next one easier — this is the signature mechanic");
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

  test("trained-skill count throws for classes not yet ingested", () => {
    assert.equal(trainedSkillCount("rogue", 2), 10);
    assert.equal(trainedSkillCount("warrior", 0, true), 7);
    assert.throws(() => trainedSkillCount("bard", 2), /not yet known/);
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
    ].sort(compareInitiative);
    assert.equal(order[0].name, "fast");
  });

  test("ties break on higher Agi SCORE", () => {
    const order = [
      { name: "lowAgi", initiative: 4, agiScore: 11 },
      { name: "highAgi", initiative: 4, agiScore: 17 }
    ].sort(compareInitiative);
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
