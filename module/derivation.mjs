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
 * Apply a status-driven Agility override (`agiOverride`) to the Reflex input.
 *
 * A FLOOR, not an assignment: `Math.min`. A creature whose Agi is already −8
 * does not improve to −5 by being knocked out, and applying two sources of the
 * override does not reach −10.
 *
 * This exists because `applyIncapacitationOverride` only fires when the actor
 * is at the bottom of the Break Gauge or on 0 HP. A GM ticking **helpless** by
 * hand on an otherwise upright creature got `agiDenied` alone, which merely
 * zeroes a positive bonus — so a helpless character with Agi +3 lost 3 points
 * of Reflex instead of 8. The status has carried `agiOverride: -5` since it was
 * written; nothing read it.
 *
 * Derived only. The stored Agility is untouched and returns the moment the
 * status clears — the requirement the GM stated on #46.
 */
export function applyAgiOverride(mod, agiOverride) {
  return agiOverride == null ? mod : Math.min(mod, agiOverride);
}

/**
 * Reflex for a PRINTED statblock under an `agiOverride`.
 *
 * A character's Reflex is a sum, so an override just changes one term. A
 * statblock prints a total, so the Agility baked into it has to be backed out
 * and replaced: `printed − agiMod + override`.
 *
 * That inherits the assumption `flatFootedBase` already makes — that the
 * printed number was built from the creature's own Agility. A statblock where
 * that is not true will be off by the discrepancy, which is a limit of printed
 * totals rather than of this function.
 *
 * Exported and tested rather than inlined in the NPC model, because a source
 * scan cannot tell a live branch from a dead one — the first version of this
 * guard passed against `if (false)`.
 */
export function printedRefWithAgiOverride(printed, agiMod, agiOverride) {
  if (agiOverride == null) return printed;
  return printed - agiMod + agiOverride;
}

/**
 * A statblock's live and flat-footed Reflex, statuses included.
 *
 * Whole rather than piecewise, so every branch is reachable from a test. Three
 * rules interact and their ORDER is the substance:
 *
 *   1. the Break penalty and any status defence modifier ride on the printed
 *      value, which is itself unbroken;
 *   2. `agiDenied` (flat-footed, asleep, pinned…) means the creature IS
 *      flat-footed, so its live Reflex becomes the flat-footed one;
 *   3. `agiOverride` (helpless, toad) is a bigger drop than being denied — Agi
 *      is treated as a fixed −5 rather than merely stripped of its bonus — so
 *      it applies AFTER (2), never instead of it. Getting this backwards makes
 *      a helpless monster easier to hit than a merely flat-footed one by
 *      exactly its Agility bonus, in the wrong direction.
 *
 * Deliberately NOT handled: `noEquipmentBenefit` and `treatedAsSize`. Both need
 * the armour bonus and size modifier as separable terms, and a printed total
 * has no terms — there is no honest way to subtract a component from a number
 * that never had components. Toad on a MONSTER is therefore partial, and Toad
 * on a CHARACTER is exact. Said plainly rather than approximated silently.
 *
 * @returns {{value: number, flatFooted: number}}
 */
export function printedReflex({
  printed = 10,
  flatFootedBase = null,
  agiMod = 0,
  breakPenalty = 0,
  statusDefence = 0,
  agiDenied = false,
  agiOverride = null
} = {}) {
  const rider = breakPenalty + statusDefence;

  let value = printed + rider;
  let flatFooted = (flatFootedBase ?? (printed - Math.max(0, agiMod))) + rider;

  if (agiDenied) value = flatFooted;

  if (agiOverride != null) {
    value = printedRefWithAgiOverride(printed + rider, agiMod, agiOverride);
    // A printed flatFootedBase can be higher than the overridden value; the
    // creature cannot be harder to hit flat-footed than it is upright.
    flatFooted = Math.min(flatFooted, value);
  }

  return { value, flatFooted };
}

/**
 * The size a creature counts as for defences and Break Threshold.
 *
 * Toad and its kin replace the creature's size outright (`treatedAsSize`)
 * rather than modifying it — a Large character turned into a toad is Tiny, not
 * "Large minus some". Falls back to the actor's own size.
 */
export function effectiveSize(baseSize, treatedAsSize = null) {
  return LASTARC.sizes[treatedAsSize] ? treatedAsSize : baseSize;
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
  incapacitated = false,
  agiOverride = null,
  noEquipmentBenefit = false
} = {}) {
  // Agi takes both floors. They are the same operation with different
  // triggers, and both are `Math.min`, so the order between them is irrelevant
  // and applying both twice is still harmless.
  //
  // Mnd takes only the incapacitation floor: the status key is `agiOverride`
  // and it means what it says. Nothing in the table overrides Mnd on its own.
  const effAgi = applyAgiOverride(
    applyIncapacitationOverride(agiMod, incapacitated), agiOverride
  );
  const effMnd = applyIncapacitationOverride(mndMod, incapacitated);

  // `noEquipmentBenefit` (toad) removes the armour entirely, not just its
  // bonus — the Agi cap goes too, because a cap that exists only by virtue of
  // wearing armour cannot outlive the armour. Under toad this is moot (Agi is
  // floored to −5, and a negative always applies in full past any cap), but a
  // future carrier of the key without an override would otherwise keep a
  // restriction from equipment it is no longer benefiting from.
  const effArmour = noEquipmentBenefit
    ? { refBonus: 0, maxAgiBonus: Infinity }
    : armour;

  // At step 5 the creature is not rolling; use the step-4 penalty for display so
  // the sheet shows a coherent number rather than NaN.
  const bp = breakPenalty(breakStep) ?? LASTARC.breakPenalties[LASTARC.BREAK_STEP_MAX - 1];

  const agiToRef = agiContributionToRef(effAgi, {
    maxAgiBonus: effArmour?.maxAgiBonus ?? Infinity,
    agiDenied
  });

  return {
    breakPenalty: bp,
    ref:  10 + level + agiToRef + (classBonus.ref  ?? 0) + (effArmour?.refBonus ?? 0)
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

/**
 * How many spells or performances a character may know (§10, book p.78).
 *
 * Arcane Study and Bardic Study each let you learn `1 + Int modifier` of the
 * relevant thing, and both may be taken more than once, "each time increasing
 * the maximum ... by 1+Int modifier (minimum 1)".
 *
 * THE MINIMUM IS PER TAKING, NOT ON THE TOTAL. A character with Int 8 (−1) who
 * takes Arcane Study twice knows 2 spells, not 0 — each taking floors at 1
 * before they are summed. Applying the floor to the total instead would give 1,
 * and would silently punish exactly the low-Int caster the floor exists to
 * protect.
 *
 * The base is zero on purpose: without the technick you may not learn spells at
 * all, so a character sheet that starts at some positive number is inventing a
 * permission the book does not give (issue #33).
 *
 * @param {number} takings  how many times the study technick is held
 * @param {number} intMod   the character's Intelligence modifier
 */
export function studyLimit(takings = 0, intMod = 0) {
  return Math.max(0, takings) * Math.max(1, 1 + intMod);
}

/**
 * The four range bands for a weapon, in squares (book p.103, issue #36).
 *
 * Derived from the weapon's SIZE rather than typed per weapon, because that is
 * how the book states it — one table, four rows. A thrown weapon uses the
 * `thrown` row whatever its own size.
 *
 * @returns {Array<{key:string, label:string, penalty:number, from:number, to:number}>}
 */
export function rangeBandsFor(size = "medium", { isThrown = false } = {}) {
  const row = LASTARC.rangeIncrements[isThrown ? "thrown" : size]
    ?? LASTARC.rangeIncrements.medium;

  let from = 0;
  return Object.entries(LASTARC.rangeBands).map(([key, band]) => {
    const to = row[key];
    const entry = { key, label: band.label, penalty: band.penalty, from, to };
    from = to + 1;
    return entry;
  });
}

/** The attack penalty for firing at a given band. Unknown bands cost nothing. */
export function rangeBandPenalty(bandKey) {
  return LASTARC.rangeBands[bandKey]?.penalty ?? 0;
}

/**
 * The range bands for a STATBLOCK attack, from its typed increments (#43).
 *
 * The same shape `rangeBandsFor` returns, so the prompt, the penalty lookup and
 * the card treat a monster's bow exactly as they treat a player's. Only the
 * SOURCE of the numbers differs: a character's come from the weapon's size via
 * the book's one table, a monster's are printed on its own page.
 *
 * Returns null when the GM has recorded nothing, so an attack that predates
 * this field — every attack in every world right now — does not start
 * interrupting a roll to ask a question with no answer.
 *
 * Bands are taken in order and STOP at the first unrecorded one: a creature
 * with a point-blank and a short increment and nothing beyond has a maximum
 * range, and offering it a "long" band would invent reach the page never gave
 * it.
 */
export function npcRangeBands(attack) {
  const typed = attack?.rangeBands;
  if (!typed) return null;

  let from = 0;
  const out = [];
  for (const [key, band] of Object.entries(LASTARC.rangeBands)) {
    const to = Number(typed[key]) || 0;
    if (to <= 0) break;
    out.push({ key, label: band.label, penalty: band.penalty, from, to });
    from = to + 1;
  }
  return out.length ? out : null;
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
 * Resolve the Injury & Dismemberment chart for a d% result (book p.170).
 *
 * Each row is an INDEPENDENT threshold, not a band — "rolling the % shown, or
 * less, will impose the listed effect" — so a low roll imposes several at once.
 * Returns every row the result triggered, worst first.
 *
 * Pure, so the outcome of a permanent maiming is testable without dice.
 */
export function resolveInjuryRoll(percentile) {
  return LASTARC.injuryTable
    .filter((row) => percentile <= row.threshold)
    .sort((a, b) => a.threshold - b.threshold);
}

/**
 * Spells a caster may know (§18.1, book p.140 — and p.78 for the gate).
 *
 * Learned from scrolls. If the Int modifier later rises the limit increases
 * RETROACTIVELY, which is why this is derived on every prepare rather than
 * stored — a stored count would silently go stale on an attribute increase.
 *
 * TAKES THE NUMBER OF ARCANE STUDY TECHNICKS, not just the modifier. It used to
 * be `1 + intMod` flat, which was wrong twice over (issue #33): it handed every
 * character a spell allowance whether or not they had the technick that grants
 * one, and it ignored that Arcane Study is explicitly repeatable, capping a
 * character at their first taking and discarding every one after it.
 *
 * Kept as its own function rather than calling `studyLimit` at the two sites,
 * because the two limits are independent — a character with both technicks
 * tracks each separately, and a shared helper invited exactly one pool.
 */
export function knownSpellLimit(arcaneStudyTakings = 0, intMod = 0) {
  return studyLimit(arcaneStudyTakings, intMod);
}

/**
 * Performances a character may know (§19.1, book p.156; gate on p.78).
 *
 * The same shape as spells but a different gate and a different source: the
 * Bardic Study technick rather than Arcane Study, and orchestral scores rather
 * than spell scrolls.
 */
export function knownPerformanceLimit(bardicStudyTakings = 0, intMod = 0) {
  return studyLimit(bardicStudyTakings, intMod);
}

/**
 * Number of trained skills = class base + Int modifier (+1 for half-elves).
 *
 * The half-elf bonus is the "Skilled" trait: they select one additional trained
 * skill at 1st level, from their class list.
 *
 * Throws rather than guessing when the class base is unknown, because a silent
 * default produces a plausible-but-wrong character build. It no longer throws
 * for a KNOWN class — this docstring and the message below both used to claim
 * that four of the six were still null pending ingestion, which stopped being
 * true once the class tables were read in. The stale claim outlived the
 * limitation and read exactly like a live constraint (issue #34).
 */
export function trainedSkillCount(className, intMod = 0, halfElf = false) {
  const cls = LASTARC.classes[className];
  if (!cls) throw new Error(`Unknown class: ${className}`);
  if (cls.trainedSkills === null) {
    throw new Error(
      `Trained-skill count for "${className}" is not set in LASTARC.classes. ` +
      `It must be read from the class tables (book p.35) before this class can ` +
      `report an allowance.`
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
    // Flat bonuses to the maxima and to damage reduction. Added late so an
    // amulet granting +10 HP is not multiplied by withering, which halves what
    // the class and Vitality gave you rather than what a trinket did.
    hp: 0,
    mp: 0,
    dr: 0,
    skills: {},
    /**
     * Rerolls granted by technicks, talents and races (#48).
     *
     * Kept as a LIST rather than summed, because each entry has to name its
     * source. A player with two reroll traits needs to know which button is
     * which — "Reroll (Grassrunner)" is usable at a table and "Reroll ×2" is
     * not, since the two may have different semantics and different limits.
     *
     * Each entry also carries the SKILL it is scoped to, or null for any roll.
     * The GM's examples are a class talent and a racial trait that each reroll
     * one named skill, so an unscoped grant is the exception rather than the
     * rule — and a grant that offered itself on every roll would be a quiet
     * upgrade to the trait.
     */
    rerolls: []
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
    out.hp += g.hp ?? 0;
    out.mp += g.mp ?? 0;
    out.dr += g.dr ?? 0;

    for (const kind of LASTARC.grantableRerollKinds) {
      if (g.reroll?.[kind]) {
        out.rerolls.push({
          kind,
          // Blank means any roll. A scoped grant must not offer itself on an
          // attack or on a different skill — the GM's traits reroll one named
          // skill each.
          skill: g.reroll.skill || null,
          source: g.__source ?? null
        });
      }
    }

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
    // A zero minimum is the absence of a requirement, not a requirement of
    // zero. Skipped rather than compared, so an entry left at 0 by a blank
    // form box cannot become a line in the unmet list (issue #15).
    if (!required) continue;
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
    skillPenalties: {},
    /**
     * Skills the creature cannot roll at all (silence). A Set, like `active`.
     *
     * This key was removed in 0.31.0 on the strength of my own claim that no
     * status carried it. `silence` did. The removal took out the default but
     * left the loop that writes to it, so aggregating silence called
     * `undefined.add(...)` and threw — inside `prepareDerivedData`, which takes
     * the actor down with it. Restored and, this time, actually read: see
     * `rollSkill`.
     */
    blocksSkills: new Set(),
    skillCheckPenalty: 0,
    damageRollPenalty: 0,
    healingBecomesDamage: false,
    noEquipmentBenefit: false,
    noAbilities: false,
    treatedAsSize: null,
    speedMinimum: 0,
    bonusDamageDice: {},
    incomingAttackBonus: 0,
    /**
     * Steps to move a reload UP the action ladder — a Severed Arm's "increase
     * the reload action by 1 step" (book p.170).
     *
     * `severedArm` has carried `reloadStepIncrease: 1` in the config since the
     * dismemberment table was transcribed, and until ammunition existed
     * NOTHING read it. It was the config half of an orphan: a rule written
     * down, correct, and wired to nothing. `reloadSlot` is the other half.
     */
    reloadStepIncrease: 0
  };

  for (const id of ids) {
    const def = LASTARC.statusEffects[id] ?? LASTARC.curses[id];
    if (!def) continue;

    for (const key of ["ref", "fort", "will"]) {
      out.defences[key] += def.defences?.[key] ?? 0;
    }

    out.attackPenalty += def.attackPenalty ?? 0;
    out.skillCheckPenalty += def.skillCheckPenalty ?? 0;
    out.damageRollPenalty += def.damageRollPenalty ?? 0;
    out.healingBecomesDamage ||= !!def.healingBecomesDamage;
    out.noEquipmentBenefit ||= !!def.noEquipmentBenefit;
    out.noAbilities ||= !!def.noAbilities;
    if (def.treatedAsSize) out.treatedAsSize = def.treatedAsSize;
    if (def.speedMinimum) out.speedMinimum = Math.max(out.speedMinimum, def.speedMinimum);

    // Per-skill penalties, e.g. slow's −10 to Acrobatics and Athletics. Summed
    // rather than replaced so two sources both land.
    for (const [skill, value] of Object.entries(def.skillPenalties ?? {})) {
      out.skillPenalties[skill] = (out.skillPenalties[skill] ?? 0) + value;
    }
    out.incomingAttackBonus += def.incomingAttackBonus ?? 0;
    out.speedReduction += def.speedReduction ?? 0;
    out.reloadStepIncrease += def.reloadStepIncrease ?? 0;

    out.agiDenied ||= !!def.agiDenied;
    out.noActions ||= !!def.noActions;
    out.noReactions ||= !!def.noReactions;
    out.speedZero ||= !!def.speedZero;
    out.blocksRecovery ||= !!def.blocksRecovery;
    out.blocksNaturalHealing ||= !!def.blocksNaturalHealing;
    out.currentHpBecomesMax ||= !!def.currentHpBecomesMax;
    out.stripsResistances ||= !!def.stripsResistances;
    out.stripsImmunities ||= !!def.stripsImmunities;
    out.weakToAll ||= !!def.weakToAll;
    out.blocksD20Reroll ||= !!def.blocksD20Reroll;
    out.rerollKeepLower ||= !!def.rerollKeepLower;

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
 * One actor's total in a named skill, whichever shape the actor keeps.
 *
 * A character stores skills as a keyed object of derived rows with a `total`; a
 * statblock stores a flat printed array of `{key, value}`. Reading the
 * character path against an NPC yields `undefined`, which becomes 0 — and a
 * silent 0 in a skill check looks exactly like a bad roll.
 *
 * `block.mjs` had this logic privately and correctly. `rollSurprise` did not,
 * and rolled every monster's ambush Stealth at +0 while reading the DEFENDERS'
 * passive Perception in a properly shape-aware way ten lines further down.
 * Shared so there is one answer.
 */
export function skillTotalOf(skills, key) {
  if (!skills) return 0;
  if (Array.isArray(skills)) return skills.find((s) => s.key === key)?.value ?? 0;
  return skills[key]?.total ?? 0;
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
/*  Block (book p.109)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Which weapon skills a shield's Block roll may use.
 *
 * The book names three classes of shield by size RELATIVE to the wielder, and
 * each names a skill rather than a bonus — Block is an opposed attack roll with
 * the shield, never a flat addition to Reflex:
 *
 *   one size smaller   → light shield: EITHER Light Weapon or 1-Handed
 *   two or more smaller→ light shield: Light Weapon only
 *   same size          → standard shield: 1-Handed
 *   one size larger    → heavy shield: 2-Handed, or 1-Handed at Str 15+
 *
 * Returns every legal option rather than one answer, because two of the four
 * rows are a genuine choice and the sheet should offer whichever the character
 * is actually better at. An empty list means the shield is unusable.
 *
 * @returns {string[]} skill keys, best-first is NOT implied — the caller ranks them
 */
export function shieldSkillOptions(wielderSize, shieldSize, { strScore = 0 } = {}) {
  const a = LASTARC.sizeOrder.indexOf(wielderSize);
  const s = LASTARC.sizeOrder.indexOf(shieldSize);
  if (a < 0) throw new Error(`Unknown wielder size: ${wielderSize}`);
  if (s < 0) throw new Error(`Unknown shield size: ${shieldSize}`);

  const delta = s - a;

  if (delta >= 2) return [];                       // nothing that big is a shield
  if (delta === 1) {
    return strScore >= LASTARC.heavyShieldStrWaiver
      ? ["twoHanded", "oneHanded"]
      : ["twoHanded"];
  }
  if (delta === 0) return ["oneHanded"];
  if (delta === -1) return ["lightWeapon", "oneHanded"];
  return ["lightWeapon"];
}

/**
 * Modifiers on a Block roll.
 *
 * Two separate penalties come from lacking Shield Proficiency and both apply:
 * a flat −5 on any check made with a shield, AND a doubled cumulative rate for
 * repeat blocks. They are listed as separate parts so the card can show which
 * is which — a player who sees a single −15 has no way to tell that half of it
 * would go away with a proficiency and half of it goes away next turn.
 *
 * `previousBlocks` counts blocks made SINCE THE BLOCKER'S LAST TURN STARTED,
 * not since the start of the round. Those differ for everyone but the current
 * combatant, which is precisely who is blocking.
 *
 * @returns {{total:number, parts:Array<{label:string, value:number}>}}
 */
export function blockModifiers({
  skillMod = 0,
  shieldBonus = 0,
  previousBlocks = 0,
  proficient = true,
  shieldExpert = false,
  situational = 0
} = {}) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  add("LASTARC.Mod.skill", skillMod);
  add("LASTARC.Mod.shield", shieldBonus);

  if (!proficient) add("LASTARC.Mod.nonProficientShield", -LASTARC.nonProficientShieldPenalty);

  const base = proficient
    ? LASTARC.blockPenaltyPerBlock.proficient
    : LASTARC.blockPenaltyPerBlock.nonProficient;

  /**
   * Shield Expert reduces the repeat-block rate to 2 (#59).
   *
   * A FLOOR, not an assignment. The talent reduces the penalty TO a fixed rate,
   * and a bare assignment would make it a penalty INCREASE the day someone
   * tunes the proficient rate below 2 — turning a talent into a downgrade,
   * which is the same inversion the note on `blockPenaltyPerBlock` records
   * against an earlier draft of the shield proficiency rule.
   *
   * It applies to a non-proficient blocker too. That is the literal reading of
   * "reduce ... to -2", it is still a reduction from 10, and the flat
   * non-proficiency penalty above is untouched either way — so the character
   * who somehow has the talent without the proficiency is still worse off than
   * one who has both.
   */
  const rate = shieldExpert ? Math.min(base, LASTARC.shieldExpertBlockPenalty) : base;

  /**
   * Labelled differently when the talent bit, so the card SAYS the talent
   * worked. A rate that silently drops from 5 to 2 is indistinguishable from
   * the system having got the arithmetic wrong — which is precisely how the
   * mitigation pipeline in #57 came to be reported as broken while being right.
   */
  add(rate === base ? "LASTARC.Mod.repeatBlock" : "LASTARC.Mod.repeatBlockExpert",
    -(Math.max(0, previousBlocks) * rate));

  add("LASTARC.Mod.situational", situational);

  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/**
 * Did the block stop the attack?
 *
 * "Should your attack beat the opposing check, it is treated as if it did not
 * beat your Ref Defence." BEAT, not meet — a tie goes to the attacker, which is
 * the opposite of the meet-it-beat-it rule used everywhere else in this system
 * and is the single most likely thing to be implemented wrongly here.
 */
export function resolveDodge({ dodgeTotal, attackTotal }) {
  /**
   * Same comparison as a Block, and stated separately rather than aliased.
   *
   * The technick wording is the same shape — the check must BEAT the attack
   * roll, so a tie goes to the attacker. Both are opposed reactions and both
   * invert the meet-it-or-beat-it rule used everywhere else in this system,
   * which makes this the single most likely line in either to be got wrong.
   *
   * Kept as its own function because the two reactions are not the same rule:
   * Block carries a cumulative penalty for repeat use, Dodge is capped at once
   * per turn, and a shared implementation would invite one rule's limit to be
   * "fixed" onto the other.
   */
  return { dodged: dodgeTotal > attackTotal, dodgeTotal, attackTotal };
}

export function resolveBlock({ blockTotal, attackTotal }) {
  return { blocked: blockTotal > attackTotal, blockTotal, attackTotal };
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
    return {
      final: 0, preDR: 0, postDR: 0, immune: true,
      rolled: total, weakened: false, resisted: false
    };
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
    /**
     * NO `secondaryEffectsNegated` HERE. It used to be returned — and read by
     * nothing, for as long as §5.5 has existed, which is half of what #57
     * reported.
     *
     * Wiring it up was the obvious repair and it is the wrong one, because this
     * function is on the wrong side of the clock. A spell's status rider is
     * applied when the SPELL RESOLVES; its damage is applied later, from a
     * button on the card, and may never be applied at all if the GM rules
     * otherwise. So the mitigation result does not exist yet at the moment the
     * rider has to be decided, and a flag on it could never have been the
     * mechanism.
     *
     * The rule lives in `status-guard.mjs#negatesSecondaryEffects`, which reads
     * the target's mods directly and can therefore answer at either time. One
     * rule, one implementation — a second copy here would be free to drift, and
     * the book's immunity/resistance asymmetry means the two would not even
     * agree in principle.
     */
    /**
     * What went IN, and which of the two multipliers fired.
     *
     * Carried out so the chat card can show the step. `preDR` is measured
     * AFTER weakness and resistance, so with no DR in play `preDR === postDR`
     * and the card's arithmetic line printed nothing at all: a 10 halved to 5
     * rendered as a bare "Took 5", indistinguishable from a roll of 5. That is
     * the half of #57 that made a correct pipeline look broken.
     */
    rolled: total,
    weakened: weakness,
    resisted: resistance
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

/**
 * Resolve a heal against what the target can actually receive.
 *
 * Returns every term the card needs to show its working (issue #11: "when
 * healing there is no calculation listed"). `wasted` is the part that hit the
 * maximum and vanished, which is the number a player wants when deciding
 * whether to spend the potion now or later — and the one a bare "+8" hides.
 *
 * `becomesDamage` is the zombified curse (§12): healing a zombified creature
 * deals that much unaspected damage instead. It is a full inversion, not a
 * reduction, so it short-circuits the maximum entirely — there is no cap on
 * being hurt.
 *
 * @returns {{applied:number, newHp:number, wasted:number, inverted:boolean}}
 */
export function resolveHealing({ amount = 0, current = 0, max = 0, becomesDamage = false } = {}) {
  const heal = Math.max(0, amount);

  if (becomesDamage) {
    const newHp = Math.max(0, current - heal);
    return { applied: current - newHp, newHp, wasted: 0, inverted: true };
  }

  const newHp = Math.min(max, current + heal);
  return { applied: newHp - current, newHp, wasted: heal - (newHp - current), inverted: false };
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

