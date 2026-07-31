/**
 * Pure derivation math for Last Arc: Tactics Analogue.
 *
 * FOUNDRY-FREE BY DESIGN. Every function here takes plain values and returns
 * plain values, so the whole of §4 and §5.5 can be unit-tested under `node
 * --test` without a Foundry install. The TypeDataModel classes in module/data/
 * are thin wrappers that marshal `this` into these calls.
 *
 * Spec references are to last-arc-foundry-system-spec.md (rev2).
 */

import { LASTARC } from "./config.mjs";

/* -------------------------------------------------------------------------- */
/*  Rounding (§1)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Universal round-down (§1).
 *
 * `Math.floor` is correct here INCLUDING for negatives — floor(-2.5) is -3, i.e.
 * further from zero. That is what "always round down" means and it is not the
 * same as truncation, which would give -2. Attribute modifiers for scores below
 * 10 are the common case, so this distinction is load-bearing: a score of 7 must
 * give -2 (floor(-1.5)), not -1.
 */
export const rd = Math.floor;

/* -------------------------------------------------------------------------- */
/*  Attributes (§2)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {number} score
 * @param {boolean} clamp  Apply the stated −5..+5 ceiling (§15 A3).
 * @returns {number}
 */
export function attributeModifier(score, clamp = true) {
  const mod = rd((score - 10) / 2);
  if (!clamp) return mod;
  const { min, max } = LASTARC.attributeModifierClamp;
  return Math.min(max, Math.max(min, mod));
}

/* -------------------------------------------------------------------------- */
/*  Break Gauge (§6)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Penalty for a Break Gauge step.
 *
 * SIGN CONVENTION (§6 rev2): `step` runs 0..5 and HIGHER IS WORSE.
 *
 * Returns `null` at step 5 — the creature is unconscious/disabled/destroyed and
 * is not rolling. Callers that need a number should use
 * `breakPenaltyOrZero()` and handle the incapacitated case explicitly; silently
 * coercing null to 0 reads as "no penalty", which is the opposite of the truth.
 *
 * @returns {number|null}
 */
export function breakPenalty(step) {
  const s = clampStep(step);
  return LASTARC.breakPenalties[s];
}

/** As `breakPenalty`, but returns 0 when incapacitated. For display only. */
export function breakPenaltyOrZero(step) {
  return breakPenalty(step) ?? 0;
}

export function clampStep(step) {
  const s = Number.isFinite(step) ? Math.trunc(step) : 0;
  return Math.min(LASTARC.BREAK_STEP_MAX, Math.max(LASTARC.BREAK_STEP_MIN, s));
}

export function isIncapacitated(step) {
  return clampStep(step) >= LASTARC.BREAK_STEP_MAX;
}

/**
 * Worsen the gauge by `n` steps (damage over Threshold, Sprint failure, etc).
 * Never write `step + 1` at a call site — go through here so the convention
 * stays in one place.
 */
export function worsenStep(step, n = 1) {
  return clampStep(clampStep(step) + n);
}

/**
 * Improve the gauge by `n` steps (a Recovery action).
 *
 * Floors at `persistentSteps`, NOT at 0 — recovery cannot clear persistent
 * conditions (§6). Each persistent step has its own named clearance requirement.
 */
export function improveStep(step, n = 1, persistentSteps = 0) {
  const floor = clampStep(persistentSteps);
  return Math.max(floor, clampStep(step) - n);
}

/** Invariant from §6 rev2: persistentSteps ≤ step. Enforce on every write. */
export function reconcilePersistent(step, persistentSteps) {
  const s = clampStep(step);
  const p = clampStep(persistentSteps);
  return { step: Math.max(s, p), persistentSteps: p };
}

/* -------------------------------------------------------------------------- */
/*  Defences (§4.1)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the Agility contribution to Reflex.
 *
 * Three interacting rules, in this order:
 *   1. A NEGATIVE agiMod always applies in full — armour caps and "denied"
 *      states remove the BONUS, never the penalty.
 *   2. `agiDenied` (flat-footed / pinned / helpless) zeroes a positive bonus.
 *   3. `maxAgiBonus` is a hard per-armour cap. Defaults to Infinity when
 *      unarmoured — `Math.min(x, undefined)` is NaN, which would silently
 *      poison Reflex, Threshold, and every comparison downstream.
 */
export function agiContributionToRef(agiMod, { maxAgiBonus = Infinity, agiDenied = false } = {}) {
  if (agiMod < 0) return agiMod;
  if (agiDenied) return 0;
  const cap = Number.isFinite(maxAgiBonus) ? maxAgiBonus : Infinity;
  return Math.min(agiMod, cap);
}

/**
 * Apply the unconscious/helpless Agi and Mnd override (§4.1 rev2).
 *
 * This is an OVERRIDE, not an addend. At 0 HP §5.6 makes a character
 * unconscious AND prone AND helpless simultaneously, and §10 independently
 * states helpless treats Agi as −5. Adding each occurrence reaches −10 or −15.
 * `Math.min(mod, -5)` is idempotent, so applying it twice is harmless.
 */
export function applyIncapacitationOverride(mod, incapacitated) {
  return incapacitated ? Math.min(mod, -5) : mod;
}

/**
 * Compute all three defences.
 *
 * Order matters and is fixed here: attribute mods → incapacitation override →
 * break penalty → defences. Threshold then reads the FINISHED Fortitude, which
 * is what makes the §4.2 death spiral automatic.
 *
 * @returns {{ref:number, fort:number, will:number, breakPenalty:number}}
 */
export function computeDefences({
  level = 1,
  agiMod = 0,
  vitMod = 0,
  mndMod = 0,
  classBonus = { ref: 0, fort: 0, will: 0 },
  armour = { refBonus: 0, maxAgiBonus: Infinity },
  sizeMod = 0,
  technicks = { ref: 0, fort: 0, will: 0 },
  misc = { ref: 0, fort: 0, will: 0 },
  breakStep = 0,
  agiDenied = false,
  incapacitated = false
} = {}) {
  const effAgi = applyIncapacitationOverride(agiMod, incapacitated);
  const effMnd = applyIncapacitationOverride(mndMod, incapacitated);

  // At step 5 the creature is not rolling; use the step-4 penalty for display so
  // the sheet shows a coherent number rather than NaN.
  const bp = breakPenalty(breakStep) ?? LASTARC.breakPenalties[LASTARC.BREAK_STEP_MAX - 1];

  const agiToRef = agiContributionToRef(effAgi, {
    maxAgiBonus: armour?.maxAgiBonus ?? Infinity,
    agiDenied
  });

  return {
    breakPenalty: bp,
    ref:  10 + level + agiToRef + (classBonus.ref  ?? 0) + (armour?.refBonus ?? 0)
             + sizeMod + (technicks.ref  ?? 0) + (misc.ref  ?? 0) + bp,
    // Fortitude takes NO incapacitation override — §4.1 applies the −5 floor to
    // Agi (Reflex) and Mnd (Will) only. Vitality is used as-is.
    fort: 10 + level + vitMod + (classBonus.fort ?? 0)
             + (technicks.fort ?? 0) + (misc.fort ?? 0) + bp,
    will: 10 + level + effMnd + (classBonus.will ?? 0)
             + (technicks.will ?? 0) + (misc.will ?? 0) + bp
  };
}

/* -------------------------------------------------------------------------- */
/*  Break Threshold (§4.2)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * breakThreshold = fortDefence + sizeBonus + technicks + itemBonus
 *
 * MUST be derived live from the already-penalised Fortitude, never cached. The
 * death spiral — break step lowers defences, which lowers Fort, which lowers
 * Threshold, which makes the next break easier — is supposed to fall out of the
 * derivation rather than being scripted.
 *
 * Size bonus applies from Large up; Medium and smaller get nothing.
 */
export function breakThreshold({ fort = 10, size = "medium", technicks = 0, itemBonus = 0 } = {}) {
  const sizeBonus = LASTARC.sizes[size]?.threshold ?? 0;
  return fort + sizeBonus + technicks + itemBonus;
}

/* -------------------------------------------------------------------------- */
/*  HP / MP (§4.3)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resource maximum across one or more classes.
 *
 * The level-1 grant comes from the FIRST class taken; every level after that
 * (in any class) uses that class's per-level value. Both terms add the governing
 * attribute modifier at every level, per §4.3's "+Vit / +Mnd = the modifier".
 *
 * @param {Array<{name:string, levels:number}>} classes  Ordered; [0] is the first class.
 * @param {number} attrMod  Vit for HP, Mnd for MP.
 * @param {"hp"|"mp"} kind
 */
export function resourceMax(classes, attrMod, kind = "hp") {
  if (!classes?.length) return 0;

  const first = LASTARC.classes[classes[0].name];
  if (!first) throw new Error(`Unknown class: ${classes[0].name}`);

  const baseKey = kind === "hp" ? "hp1" : "mp1";
  const perKey = kind === "hp" ? "hpPer" : "mpPer";

  // Level 1 of the first class.
  let total = first[baseKey] + attrMod;

  // Every subsequent level, charged to whichever class granted it.
  for (const [i, entry] of classes.entries()) {
    const cls = LASTARC.classes[entry.name];
    if (!cls) throw new Error(`Unknown class: ${entry.name}`);
    const levelsAfterFirst = i === 0 ? entry.levels - 1 : entry.levels;
    total += levelsAfterFirst * (cls[perKey] + attrMod);
  }

  return Math.max(0, total);
}

export const hpMax = (classes, vitMod) => resourceMax(classes, vitMod, "hp");
export const mpMax = (classes, mndMod) => resourceMax(classes, mndMod, "mp");

/**
 * Class defence bonuses, granted once at class level 1 (§4.3).
 *
 * §15 A9: §4.3 and A5 disagree about whether a second class re-grants these.
 * `regrantOnMulticlass` exposes the choice; default false is A5's reading.
 */
export function classDefenceBonuses(classes, regrantOnMulticlass = false) {
  const out = { ref: 0, fort: 0, will: 0 };
  if (!classes?.length) return out;
  const sources = regrantOnMulticlass ? classes : classes.slice(0, 1);
  for (const entry of sources) {
    const cls = LASTARC.classes[entry.name];
    if (!cls) throw new Error(`Unknown class: ${entry.name}`);
    out.ref += cls.ref;
    out.fort += cls.fort;
    out.will += cls.will;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Hero Points (§4.4)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * max = min(4, 1 + tier bonuses) + Heroic technick instances
 *
 * §15 A8: the cap binds the level-derived portion only. The level term already
 * reaches exactly 4 at level 16, so capping AFTER adding Heroic would make the
 * technick a no-op for high-level characters.
 */
export function heroPointMax(level = 1, heroicTechnicks = 0) {
  const tiers = 1 + (level >= 6 ? 1 : 0) + (level >= 11 ? 1 : 0) + (level >= 16 ? 1 : 0);
  return Math.min(4, tiers) + heroicTechnicks;
}

/* -------------------------------------------------------------------------- */
/*  Skills (§4.5)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * skillMod = ½level + attrMod + trained + focus + technicks + misc
 *            − armourCheckPenalty + breakPenalty
 *
 * `armourCheckPenalty` is a POSITIVE magnitude and is subtracted (§4.5 rev2).
 * Passing a negative here would ADD to the skill, which was the bug in rev1.
 */
export function skillModifier({
  level = 1,
  attrMod = 0,
  trained = false,
  focus = 0,
  technicks = 0,
  misc = 0,
  armourCheckPenalty = 0,
  appliesArmourPenalty = false,
  breakStep = 0
} = {}) {
  if (armourCheckPenalty < 0) {
    throw new Error(
      "armourCheckPenalty must be a positive magnitude — see §4.5 rev2. " +
      `Received ${armourCheckPenalty}.`
    );
  }
  const bp = breakPenalty(breakStep) ?? LASTARC.breakPenalties[LASTARC.BREAK_STEP_MAX - 1];
  return rd(level / 2)
    + attrMod
    + (trained ? LASTARC.trainedBonus : 0)
    + focus
    + technicks
    + misc
    - (appliesArmourPenalty ? armourCheckPenalty : 0)
    + bp;
}

/**
 * Format a modifier with an explicit sign: 3 -> "+3", -2 -> "−2", 0 -> "+0".
 *
 * Uses a real minus sign (U+2212) rather than a hyphen so numbers line up in the
 * tabular-figure font the sheet uses. Shared by the `lasignal` Handlebars helper
 * and by tooltip strings built in JS, so the two can never drift.
 */
export function signed(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}

/**
 * The terms that land in a skill total WITHOUT a printed column of their own.
 *
 * The sheet prints ½Level, Attribute, Trained, Focus and Bonus. It does not
 * print the Break Gauge penalty, the armour check penalty, technick bonuses, or
 * training and focus that arrived as GRANTS rather than as ticked boxes. Before
 * this existed a broken character's row read "2 + 1" and totalled +1, which
 * reads as a bug rather than as a death spiral.
 *
 * Returns labelled parts rather than a number so the tooltip can itemise them.
 * Values are signed as they apply: the armour check penalty is stored as a
 * positive magnitude (§4.5 rev2) and is negated here.
 *
 * @returns {Array<{label:string, value:number}>} non-zero terms only
 */
export function skillAdjustmentParts(skill = {}, breakPenalty = 0) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  add("LASTARC.Mod.technicks", skill.technicks ?? 0);
  add("LASTARC.Mod.grantedFocus", skill.grantedFocus ?? 0);
  // Granted training is a real +2 with an UNTICKED box, so it needs its own line
  // or the row appears to gain 2 from nowhere.
  add("LASTARC.Mod.grantedTrained", skill.grantedTrained ? LASTARC.trainedBonus : 0);
  add("LASTARC.Mod.armourCheck", -(skill.armourCheckPenalty ?? 0));
  add("LASTARC.Mod.break", breakPenalty);

  return parts;
}

/**
 * Number of trained skills = class base + Int modifier (+1 for half-elves).
 *
 * Throws rather than guessing when the class base is unknown — four of the six
 * are still null in config pending Phase 5 ingestion, and a silent default would
 * produce plausible-but-wrong character builds.
 */
export function trainedSkillCount(className, intMod = 0, halfElf = false) {
  const cls = LASTARC.classes[className];
  if (!cls) throw new Error(`Unknown class: ${className}`);
  if (cls.trainedSkills === null) {
    throw new Error(
      `Trained-skill count for "${className}" is not yet known — it must be read ` +
      `from the class tables (book pp.34–55) during Phase 5 ingestion. ` +
      `Only rogue (8) and warrior (6) are given in §4.5.`
    );
  }
  return Math.max(0, cls.trainedSkills + intMod + (halfElf ? 1 : 0));
}

/** Passive Perception (§7 rev2) — resolved against the printed sheet, p.263. */
export function passivePerception(perceptionSkillMod) {
  return 10 + perceptionSkillMod;
}

/* -------------------------------------------------------------------------- */
/*  Technicks & talents (§11)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sum the numeric payloads of every technick, talent, and accessory an actor
 * carries into a single object the derivation can consume.
 *
 * Repeatable technicks (Skill Focus, Improved Initiative, …) are counted once
 * per owned instance, which is the whole point of `repeatable` — the caller
 * passes N copies and they add up.
 *
 * `recoveryMinorActions` is a MINIMUM rather than a sum: Shake it Off reduces
 * the Recovery action to two minors, and holding it twice does not reduce it to
 * one. Anything that lowers a requirement takes the best value, not the total.
 *
 * @param {Array<object>} grantsList  `system.grants` from each contributing item.
 */
export function aggregateGrants(grantsList = []) {
  const out = {
    defences: { ref: 0, fort: 0, will: 0 },
    breakThreshold: 0,
    heroPoints: 0,
    initiativeSteps: 0,
    speed: 0,
    secondWindUses: 0,
    recoveryMinorActions: null,
    skills: {}
  };

  for (const g of grantsList) {
    if (!g) continue;

    out.defences.ref += g.defences?.ref ?? 0;
    out.defences.fort += g.defences?.fort ?? 0;
    out.defences.will += g.defences?.will ?? 0;
    out.breakThreshold += g.breakThreshold ?? 0;
    out.heroPoints += g.heroPoints ?? 0;
    out.initiativeSteps += g.initiativeSteps ?? 0;
    out.speed += g.speed ?? 0;
    out.secondWindUses += g.secondWindUses ?? 0;

    if (g.recoveryMinorActions != null) {
      out.recoveryMinorActions = out.recoveryMinorActions === null
        ? g.recoveryMinorActions
        : Math.min(out.recoveryMinorActions, g.recoveryMinorActions);
    }

    for (const s of g.skills ?? []) {
      if (!s?.key) continue;
      const acc = (out.skills[s.key] ??= { focus: 0, bonus: 0, trained: false });
      acc.focus += s.focus ?? 0;
      acc.bonus += s.bonus ?? 0;
      acc.trained ||= !!s.trained;
    }
  }

  return out;
}

/**
 * Check a technick or talent's prerequisites against an actor.
 *
 * Returns every unmet requirement rather than short-circuiting on the first, so
 * the level-up UI can show the full picture instead of making the player
 * discover them one at a time.
 *
 * Note §11: prerequisites may be satisfied AT THE SAME LEVEL the technick is
 * taken, so callers validating a pending selection should pass the post-selection
 * snapshot, not the current one.
 *
 * @returns {{met: boolean, unmet: string[]}}
 */
export function checkPrerequisites(prereqs = {}, actor = {}) {
  const unmet = [];

  const attributes = actor.attributes ?? {};
  const technicks = toSet(actor.technicks);
  const talents = toSet(actor.talents);
  const trained = toSet(actor.trainedSkills);

  for (const [key, required] of Object.entries(prereqs.attributes ?? {})) {
    const have = attributes[key] ?? 0;
    if (have < required) unmet.push(`${key} ${required} (have ${have})`);
  }

  if (prereqs.characterLevel && (actor.characterLevel ?? 0) < prereqs.characterLevel) {
    unmet.push(`character level ${prereqs.characterLevel}`);
  }
  if (prereqs.classLevel && (actor.classLevel ?? 0) < prereqs.classLevel) {
    unmet.push(`class level ${prereqs.classLevel}`);
  }

  for (const slug of prereqs.technicks ?? []) {
    if (!technicks.has(slug)) unmet.push(`technick: ${slug}`);
  }
  for (const slug of prereqs.talents ?? []) {
    if (!talents.has(slug)) unmet.push(`talent: ${slug}`);
  }
  for (const key of prereqs.trainedSkills ?? []) {
    if (!trained.has(key)) unmet.push(`trained in ${key}`);
  }

  return { met: unmet.length === 0, unmet };
}

function toSet(v) {
  if (v instanceof Set) return v;
  return new Set(Array.isArray(v) ? v : []);
}

/* -------------------------------------------------------------------------- */
/*  Statuses & curses (§12)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Collapse a set of active status ids into a single mechanical payload.
 *
 * Multipliers COMPOUND rather than summing — withering and a hypothetical second
 * halving effect give ¼ max HP, not zero. Summing multipliers is the intuitive
 * mistake and produces a max HP of 0, which is instant death rather than a
 * penalty.
 *
 * `supersedes` handles the one documented overlap: helpless does not stack with
 * prone, so an actor with both gets helpless's numbers only.
 *
 * @param {Iterable<string>} statusIds
 * @returns {object} aggregated payload
 */
export function aggregateStatuses(statusIds = []) {
  const ids = new Set(statusIds);

  // Resolve supersession before reading any numbers off the losers.
  for (const id of [...ids]) {
    const def = LASTARC.statusEffects[id] ?? LASTARC.curses[id];
    for (const loser of def?.supersedes ?? []) ids.delete(loser);
  }

  const out = {
    active: ids,
    defences: { ref: 0, fort: 0, will: 0 },
    attackPenalty: 0,
    agiDenied: false,
    agiOverride: null,
    noActions: false,
    noReactions: false,
    speedZero: false,
    speedReduction: 0,
    blocksFlying: false,
    blocksRecovery: false,
    blocksNaturalHealing: false,
    currentHpBecomesMax: false,
    maxHpMultiplier: 1,
    maxMpMultiplier: 1,
    stripsResistances: false,
    stripsImmunities: false,
    weakToAll: false,
    blocksD20Reroll: false,
    rerollKeepLower: false,
    blocksSkills: new Set(),
    bonusDamageDice: {},
    enablesCoupDeGrace: false,
    incomingAttackBonus: 0
  };

  for (const id of ids) {
    const def = LASTARC.statusEffects[id] ?? LASTARC.curses[id];
    if (!def) continue;

    for (const key of ["ref", "fort", "will"]) {
      out.defences[key] += def.defences?.[key] ?? 0;
    }

    out.attackPenalty += def.attackPenalty ?? 0;
    out.incomingAttackBonus += def.incomingAttackBonus ?? 0;
    out.speedReduction += def.speedReduction ?? 0;

    out.agiDenied ||= !!def.agiDenied;
    out.noActions ||= !!def.noActions;
    out.noReactions ||= !!def.noReactions;
    out.speedZero ||= !!def.speedZero;
    out.blocksFlying ||= !!def.blocksFlying;
    out.blocksRecovery ||= !!def.blocksRecovery;
    out.blocksNaturalHealing ||= !!def.blocksNaturalHealing;
    out.currentHpBecomesMax ||= !!def.currentHpBecomesMax;
    out.stripsResistances ||= !!def.stripsResistances;
    out.stripsImmunities ||= !!def.stripsImmunities;
    out.weakToAll ||= !!def.weakToAll;
    out.blocksD20Reroll ||= !!def.blocksD20Reroll;
    out.rerollKeepLower ||= !!def.rerollKeepLower;
    out.enablesCoupDeGrace ||= !!def.enablesCoupDeGrace;

    if (def.agiOverride != null) {
      out.agiOverride = out.agiOverride === null
        ? def.agiOverride
        : Math.min(out.agiOverride, def.agiOverride);
    }

    // Compound, do not sum.
    out.maxHpMultiplier *= def.maxHpMultiplier ?? 1;
    out.maxMpMultiplier *= def.maxMpMultiplier ?? 1;

    for (const key of def.blocksSkills ?? []) out.blocksSkills.add(key);

    for (const [type, dice] of Object.entries(def.bonusDamageDice ?? {})) {
      out.bonusDamageDice[type] = (out.bonusDamageDice[type] ?? 0) + dice;
    }
  }

  return out;
}

/**
 * Resolve the effective damage-type modifiers after statuses.
 *
 * Agony strips resistances and immunities and makes the creature weak to
 * everything, which is why this cannot be read straight off the actor.
 */
export function effectiveDamageMods(base = {}, statuses = {}) {
  if (statuses.weakToAll) {
    return {
      weakness: [...LASTARC.allDamageTypes],
      resistance: [],
      immunity: [],
      dr: base.dr ?? 0
    };
  }
  return {
    weakness: base.weakness ?? [],
    resistance: statuses.stripsResistances ? [] : (base.resistance ?? []),
    immunity: statuses.stripsImmunities ? [] : (base.immunity ?? []),
    dr: base.dr ?? 0
  };
}

/**
 * Pick between two rolled results according to the reroll kind (§12).
 *
 * These three are deliberately separate rather than a single "reroll" concept:
 *   - `second` is a player-elected gamble and keeps the new result even if worse
 *   - `higher` is a benefit granted when a racial trait and a talent stack
 *   - `lower` is the misfortune penalty
 *
 * Conflating `second` with `higher` would silently upgrade a gamble into a
 * guaranteed improvement.
 */
export function resolveReroll(original, rerolled, kind) {
  switch (kind) {
    case "second": return rerolled;
    case "higher": return Math.max(original, rerolled);
    case "lower": return Math.min(original, rerolled);
    default: throw new Error(`Unknown reroll kind: ${kind}`);
  }
}

/**
 * May this actor spend a hero point to reroll a d20?
 *
 * Misfortune explicitly forbids rerolling d20s, and §12 flags that this
 * interacts with hero points specifically.
 */
export function canRerollD20(statuses = {}) {
  return !statuses.blocksD20Reroll;
}

/* -------------------------------------------------------------------------- */
/*  Bulk & movement (§4.6)                                                     */
/* -------------------------------------------------------------------------- */

export function bulkLimits(strScore) {
  return { max: 5 + strScore, overMax: 10 + strScore };
}

export function encumbranceState(bulkValue, strScore) {
  const { max, overMax } = bulkLimits(strScore);
  if (bulkValue > overMax) return "overencumbered";
  if (bulkValue > max) return "encumbered";
  return "none";
}

/**
 * Apply speed penalties ADDITIVELY as fractions of base speed (§4.6 rev2).
 *
 * Two ×3/4 effects give 1 − (¼ + ¼) = ×½, not ×⁹⁄₁₆. Chaining multiplications
 * is the intuitive implementation and the wrong one.
 *
 * @param {number} base
 * @param {number[]} reductionFractions  e.g. [0.25] for an encumbered ×3/4.
 */
export function speedAfterPenalties(base, reductionFractions = []) {
  const totalReduction = reductionFractions.reduce((a, b) => a + b, 0);
  return Math.max(0, rd(base * (1 - totalReduction)));
}

/* -------------------------------------------------------------------------- */
/*  Weapon sizing (§5.4)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which weapon skill applies, derived from wielder size vs weapon size.
 *
 * Computed dynamically, never stored on the weapon — it materially changes what
 * a character can wield, and the same weapon behaves differently for a Small
 * versus a Large character.
 *
 * §5.4 rev2: ranged categories are exempt. Applied literally the size table
 * routes a bow to "1-Handed" (a bow is the wielder's own size category); bows
 * and crossbows always use the Ranged skill, and size gates usability only.
 *
 * @returns {"light"|"oneHanded"|"twoHanded"|"ranged"|"unusable"}
 */
export function wieldCategory(actorSize, weaponSize, weaponCategory = null) {
  const a = LASTARC.sizeOrder.indexOf(actorSize);
  const w = LASTARC.sizeOrder.indexOf(weaponSize);
  if (a < 0) throw new Error(`Unknown actor size: ${actorSize}`);
  if (w < 0) throw new Error(`Unknown weapon size: ${weaponSize}`);

  const delta = w - a; // positive = weapon is larger than wielder

  if (delta >= 2) return "unusable";
  if (weaponCategory && LASTARC.rangedWeaponCategories.has(weaponCategory)) return "ranged";
  if (delta === 1) return "twoHanded";
  if (delta === 0) return "oneHanded";
  if (delta === -1) return "light";      // may use 1-Handed OR Light Weapon
  return "light";                         // two+ smaller: MUST use Light Weapon
}

/**
 * Map a derived wield category to the weapon SKILL key it rolls against.
 *
 * These two vocabularies are not the same and must not be assumed to be. The
 * wield category for a small weapon is `light`; the skill is `lightWeapon`.
 * `sys.skills[wieldCategory]` therefore resolved to undefined and the attack
 * silently rolled with NO skill bonus — every light-weapon attack in the game,
 * which is to say every rogue, was rolling a bare d20.
 *
 * Throws on anything unmapped rather than returning a default, because the
 * failure mode this replaces was exactly a silent zero.
 */
export function weaponSkillFor(wieldCat) {
  const key = {
    oneHanded: "oneHanded",
    twoHanded: "twoHanded",
    light: "lightWeapon",
    ranged: "ranged",
    unarmed: "unarmed"
  }[wieldCat];

  if (!key) throw new Error(`No weapon skill maps to wield category "${wieldCat}".`);
  return key;
}

/** True when the wielder may choose between 1-Handed and Light Weapon (§5.4). */
export function lightWeaponAllowsChoice(actorSize, weaponSize) {
  const a = LASTARC.sizeOrder.indexOf(actorSize);
  const w = LASTARC.sizeOrder.indexOf(weaponSize);
  return w - a === -1;
}

/** Str multiplier on melee damage — keyed off the DERIVED category, not a grip toggle. */
export function strDamageMultiplier(wieldCat) {
  return wieldCat === "twoHanded" ? 2 : 1;
}

/* -------------------------------------------------------------------------- */
/*  Damage pipeline (§5.5)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Apply mitigation to a rolled damage total.
 *
 * Order is fixed by §5.5 rev2: immunity → weakness → resistance → DR → min 1.
 * Weakness floors explicitly so a non-integer total never reaches the Threshold
 * comparison, where 10 vs 10.5 against a Threshold of 10 decides whether a Break
 * step happens.
 *
 * Returns both taps so the caller can honour `breakThresholdUsesPostDR` (§15 A1)
 * without recomputing.
 */
export function applyDamageMitigation({
  total = 0,
  type = "blunt",
  weakness = false,
  resistance = false,
  immunity = false,
  dr = 0,
  isHit = true
} = {}) {
  if (immunity) {
    return { final: 0, preDR: 0, postDR: 0, immune: true, secondaryEffectsNegated: true };
  }

  let t = total;
  if (weakness) t = rd(t * 1.5);
  if (resistance) t = rd(t / 2);

  const preDR = t;

  if (!LASTARC.drBypassing.has(type)) t = t - dr;

  if (isHit) t = Math.max(1, t);
  else t = Math.max(0, t);

  return {
    final: t,
    preDR,
    postDR: t,
    immune: false,
    // Resistance also negates secondary effects of that damage type (§5.5).
    secondaryEffectsNegated: resistance
  };
}

/**
 * Does this damage instance break the target's gauge?
 * @param {boolean} usePostDR  The `breakThresholdUsesPostDR` setting (§15 A1).
 */
export function exceedsBreakThreshold({ preDR, postDR }, threshold, usePostDR = true) {
  const compared = usePostDR ? postDR : preDR;
  return compared > threshold;
}

/* -------------------------------------------------------------------------- */
/*  Rest (§13)                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Recovery from rest, with both §13 rev2 clamps: hours cap at 8 (more yields
 * nothing extra) and the per-hour term floors at 0 (a low-Vit level-1 character
 * must not lose HP by sleeping).
 */
export function restRecovery({ attrMod = 0, level = 1, hours = 8, blocked = false } = {}) {
  if (blocked) return 0;
  return Math.max(0, attrMod + level) * Math.min(hours, 8);
}

/** Second Wind heals max(vitScore, ¼ maxHP); unusable above half max HP (§13). */
export function secondWindHeal(vitScore, maxHp) {
  return Math.max(vitScore, rd(maxHp / 4));
}

export function canUseSecondWind(currentHp, maxHp) {
  return currentHp <= rd(maxHp / 2);
}

/* -------------------------------------------------------------------------- */
/*  Initiative (§8)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Improved Initiative steps the die DOWN the ladder, because LOWEST acts first.
 * Stackable; floors at d3.
 */
export function improvedInitiativeDie(baseDie, steps = 1) {
  const ladder = LASTARC.initiativeDieLadder;
  const i = ladder.indexOf(baseDie);
  if (i < 0) throw new Error(`Unknown initiative die: ${baseDie}`);
  return ladder[Math.min(ladder.length - 1, i + steps)];
}

/**
 * Ascending initiative comparator (§8): lowest result acts first, ties broken by
 * higher Agi SCORE (not modifier), then coin flip.
 *
 * Foundry sorts descending by default. This must be wired into
 * `Combat.prototype._sortCombatants` rather than worked around by storing a
 * negated initiative — a negated value surfaces wrong in the tracker UI and to
 * every module that reads it.
 */
export function compareInitiative(a, b) {
  if (a.initiative !== b.initiative) return a.initiative - b.initiative;
  if (a.agiScore !== b.agiScore) return b.agiScore - a.agiScore;
  return 0;
}
