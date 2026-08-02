/**
 * Display rows shared by the sheets and the preview harness (issue #44).
 *
 * FOUNDRY-FREE, like `derivation.mjs`. Nothing here touches `game`, `CONFIG` or
 * a document — a row builder takes the actor's `system`, its `_source`, and a
 * `localize` function, and returns plain objects.
 *
 * WHY THIS EXISTS. `tools/preview.mjs` cannot call `_prepareContext`: the sheet
 * classes extend `ActorSheetV2` and need Foundry to instantiate. So the harness
 * built its render context BY HAND — a second, independent copy of every
 * display decision, sitting in the tool used to verify the first one.
 *
 * It drifted, and it drifted in the SAFE direction, which is why nobody caught
 * it: the fixture's attack rows predated the skill-label column, and
 * `weaponProficiencies`, `armourProficiencies` and `statuses` were missing
 * outright, so those panels rendered as empty boxes in every preview ever
 * taken. A reviewer sees an empty panel and cannot tell "not wired up" from
 * "not in this fixture" — and telling those two apart is the whole reason the
 * tool exists.
 *
 * A guard now asserts the fixture supplies every key the sheets assign, which
 * catches a MISSING key. It cannot catch a key whose VALUE is built differently
 * in the two places, and that was the original defect. One implementation is
 * the only thing that can.
 *
 * `localize` is injected rather than imported because it is the single reason
 * these could not already be pure. The sheet passes Foundry's; the harness
 * passes its own stub; a test passes the identity function and reads the keys.
 */

import { LASTARC } from "./config.mjs";
import * as D from "./derivation.mjs";

/** A `localize` that returns the key, for callers that only need the shape. */
export const identityLocalize = (key) => key;

/**
 * Weapon and armour proficiency toggles.
 *
 * Checkboxes rather than a comma box: both are closed sets, and asking a player
 * to type `bludgeons` correctly to stop losing 5 from every attack is a trap.
 */
export function proficiencyRows(sys) {
  const weapons = sys.proficiencies?.weapons ?? [];
  const armour = sys.proficiencies?.armour ?? [];
  return {
    weaponProficiencies: LASTARC.weaponCategories.map((key) => ({
      key,
      label: `LASTARC.WeaponCategory.${key}`,
      active: weapons.includes(key)
    })),
    armourProficiencies: Object.keys(LASTARC.armourTypes).map((key) => ({
      key,
      label: `LASTARC.ArmourType.${key}`,
      active: armour.includes(key)
    }))
  };
}

/**
 * Attributes in PRINTED order (§2 rev2), not object-key order.
 *
 * The `*Input` values come from `_source` rather than the prepared data:
 * attributes are the commonest Active Effect target of all, and binding an
 * input to the post-effect value would store the buffed number the moment the
 * player touched anything else on the sheet.
 */
export function attributeRows(sys, src) {
  return LASTARC.attributeOrder.map((key) => ({
    key,
    label: LASTARC.attributes[key].label,
    abbr: LASTARC.attributes[key].abbr,
    ...sys.attributes[key],
    valueInput: src?.attributes?.[key]?.value ?? 0,
    racialModInput: src?.attributes?.[key]?.racialMod ?? 0,
    capInput: src?.attributes?.[key]?.cap ?? null
  }));
}

/**
 * One skill row, with the five printed columns plus the gathered adjustment.
 *
 * The printed columns do NOT account for everything in the total: the Break
 * Gauge penalty, the armour check penalty, technick bonuses and granted
 * training all land in the score without a column of their own. That made the
 * sheet look broken — a row could show 2 + 1 and total +1 — so everything
 * unprinted is gathered into one `adjustment` column with an itemised tooltip.
 *
 *   total = halfLevel + attrMod + trainedShown + focus + misc + adjustment
 */
export function skillRow(key, cfg, sys, src, localize = identityLocalize) {
  const s = sys.skills[key];
  const parts = D.skillAdjustmentParts(s, sys.breakGauge?.penalty);
  const adjustment = parts.reduce((sum, p) => sum + p.value, 0);

  return {
    key,
    label: cfg.label,
    attr: cfg.attr,
    attrAbbr: LASTARC.attributes[cfg.attr].abbr,
    isWeaponSkill: !!cfg.weapon,
    /**
     * `trained` stays the PLAYER's own value, because the checkbox writes it.
     * Binding a control to a derived value is CLAUDE.md rule 4 and has shipped
     * twice; a box that stores one number and shows another is worse than none.
     *
     * `grantedTrained` rides alongside so the row can SAY the skill is trained
     * without the checkbox lying about what it holds (issue #43).
     */
    trained: s.trained,
    grantedTrained: !!s.grantedTrained,
    grantedFocus: s.grantedFocus ?? 0,
    grantedBonus: s.technicks ?? 0,
    focus: s.focus,
    misc: s.misc,
    miscInput: src?.skills?.[key]?.misc ?? 0,
    total: s.total,
    appliesArmourPenalty: s.appliesArmourPenalty,
    halfLevel: D.rd((sys.details?.level ?? 1) / 2),
    attrMod: sys.attributes[cfg.attr].mod,
    adjustment,
    hasAdjustment: adjustment !== 0,
    adjustmentTooltip: parts.length
      ? parts.map((p) => `${localize(p.label)} ${D.signed(p.value)}`).join(" · ")
      : localize("LASTARC.Tooltip.NoAdjustments")
  };
}

/** Standard skills and weapon skills, each as display rows. */
export function skillRows(sys, src, localize = identityLocalize) {
  return {
    skills: Object.entries(LASTARC.skills).map(([k, c]) => skillRow(k, c, sys, src, localize)),
    weaponSkills: Object.entries(LASTARC.weaponSkills)
      .map(([k, c]) => skillRow(k, c, sys, src, localize))
  };
}

/**
 * The Break Gauge track, one cell per step.
 *
 * Steps run 0→5 as the character gets WORSE and the penalties at those steps
 * are a different sequence entirely — `null` at the end is unconscious, not
 * "no penalty".
 */
export function breakTrackRows(sys, localize = identityLocalize) {
  return LASTARC.breakPenalties.map((penalty, step) => ({
    step,
    penalty,
    isCurrent: step === sys.breakGauge.step,
    isPassed: step < sys.breakGauge.step,
    isPersistent: step > 0 && step <= sys.breakGauge.persistentSteps,
    isTerminal: penalty === null,
    label: penalty === null
      ? localize("LASTARC.Break.Unconscious")
      : penalty === 0
        ? localize("LASTARC.Break.Normal")
        : `−${Math.abs(penalty)}`
  }));
}

/**
 * One checkbox per Second Wind use (issue #10).
 *
 * `max` is DERIVED — Extra Second Wind grants more — so the row grows and
 * shrinks with the build rather than being a fixed pair of boxes.
 */
export function secondWindPips(sys, format = (key) => key) {
  const wind = sys.resources.secondWind;
  return Array.from({ length: wind.max }, (_, index) => ({
    index,
    spent: index < wind.used,
    label: format("LASTARC.Resource.SecondWindUseN", { n: index + 1 })
  }));
}

/**
 * The three defences.
 *
 * `miscInput` comes from `_source` for the same reason the attributes do:
 * everything else on the row is assigned by `prepareDerivedData` on every
 * prepare, and only `misc` is the player's to type.
 */
export function defenceRows(sys, src) {
  return LASTARC.opposableDefences.map((key) => ({
    key,
    label: `LASTARC.Defence.${key}`,
    ...sys.defences[key],
    miscInput: src?.defences?.[key]?.misc ?? 0
  }));
}

/* -------------------------------------------------------------------------- */
/*  NPC variants                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The statblock forms of two rows above, kept HERE rather than in the NPC sheet.
 *
 * CLAUDE.md §10: characters and NPCs have genuinely different shapes, and these
 * two are the difference made concrete. Putting them beside their character
 * counterparts means the divergence is one screen apart and deliberate, instead
 * of being two files apart and looking like an oversight.
 *
 * The rows that are NOT different — the Break Gauge track and the gauge
 * percentages — are shared outright. Both sheets had byte-identical copies of
 * them, which is a change to one silently missing the other.
 */

/**
 * A statblock's attributes carry no `*Input` fields.
 *
 * A character's do, because an Active Effect must not be written back on the
 * next submit. A statblock's scores are typed directly and there is nothing
 * derived to protect them from — so adding the inputs here would be cargo
 * cult, and omitting them from the character sheet would be the bug rule 4
 * exists for.
 */
export function npcAttributeRows(sys) {
  return LASTARC.attributeOrder.map((key) => ({
    key,
    label: LASTARC.attributes[key].label,
    abbr: LASTARC.attributes[key].abbr,
    ...sys.attributes[key]
  }));
}

/**
 * A statblock's defences show `base` — the PRINTED, unbroken number — beside
 * the live value.
 *
 * A character's show the `misc` slot the player types into. The two sheets are
 * answering different questions: "what does the page say, and what is it now?"
 * against "what did I add, and what did that make?".
 */
export function npcDefenceRows(sys) {
  return LASTARC.opposableDefences.map((key) => ({
    key,
    label: `LASTARC.Defence.${key}`,
    value: sys.defences[key].value,
    base: sys.defences[key].base
  }));
}

/**
 * Gauge fill percentages.
 *
 * Computed here rather than in CSS because both need a divide-by-zero guard and
 * a clamp: a character with 0 max MP must not produce `NaN%`, and temporary HP
 * can push the current value above the maximum.
 */
export function gaugePercent(value, max) {
  return max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
}

/* -------------------------------------------------------------------------- */
/*  Item sheet choice lists (#44)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every `<select>`'s options on the item sheet, all derived from config.
 *
 * Extracted for the same reason as the actor rows, and found the same way: the
 * preview fixture was missing THIRTY-NINE of the item sheet's context keys, so
 * every item-sheet preview ever taken rendered its dropdowns EMPTY. I had
 * looked straight at an empty `<select name="system.size">` earlier tonight and
 * read it as a fixture detail rather than as the tool lying.
 *
 * Pure config-to-options mapping, so there is nothing here worth two copies.
 */
export function itemChoiceOptions() {
  return {
    availabilityOptions: Object.keys(LASTARC.availability)
      .map((k) => ({ value: k, label: `LASTARC.Availability.${k}` })),
    sizeOptions: sizeOptions(),
    weaponCategoryOptions: LASTARC.weaponCategories
      .map((k) => ({ value: k, label: `LASTARC.WeaponCategory.${k}` })),
    armourTypeOptions: Object.keys(LASTARC.armourTypes)
      .map((k) => ({ value: k, label: `LASTARC.ArmourType.${k}` })),
    damageTypeOptions: LASTARC.allDamageTypes
      .map((k) => ({ value: k, label: `LASTARC.DamageType.${k}` })),
    schoolOptions: LASTARC.spellSchools
      .map((k) => ({ value: k, label: `LASTARC.School.${k}` })),
    skillOptions: Object.keys(LASTARC.allSkills)
      .map((k) => ({ value: k, label: LASTARC.allSkills[k].label })),
    castingTimeOptions: Object.entries(LASTARC.castingTimes)
      .map(([k, v]) => ({ value: k, label: v.label })),
    performSpecOptions: Object.keys(LASTARC.performSpecialisations)
      .map((k) => ({ value: k, label: `LASTARC.PerformSpec.${k}` })),
    performanceKindOptions: Object.keys(LASTARC.performanceKinds)
      .map((k) => ({ value: k, label: `LASTARC.PerformanceKind.${k}` })),
    classKeyOptions: Object.entries(LASTARC.classes)
      .map(([k, c]) => ({ value: k, label: c.label })),
    technickKindOptions: LASTARC.technickKinds
      .map((k) => ({ value: k, label: `LASTARC.TechnickKind.${k}` })),
    shieldSizeOptions: Object.keys(LASTARC.shieldDamage)
      .map((k) => ({ value: k, label: LASTARC.sizes[k]?.label ?? k })),
    consumableTypeOptions: LASTARC.consumableTypes
      .map((k) => ({ value: k, label: `LASTARC.ConsumableType.${k}` })),
    featureCategoryOptions: LASTARC.featureCategories
      .map((k) => ({ value: k, label: `LASTARC.FeatureCategory.${k}` })),
    prostheticSiteOptions: LASTARC.prostheticSites
      .map((k) => ({ value: k, label: `LASTARC.Prosthetic.${k}` })),
    // The ladder, not LASTARC.initiativeDice — that maps non-player CATEGORIES
    // to a die, which is a different table. Labels are the die faces
    // themselves, so they need no localisation.
    initiativeDieOptions: LASTARC.initiativeDieLadder
      .map((d) => ({ value: d, label: d })),
  };
}

/**
 * The performance sheet's four scope pickers (#44).
 *
 * Each leads with a BLANK entry, because a scope once set must be clearable —
 * a select with no empty option is a one-way door.
 *
 * Extracted for the same reason as the rest, and found the same way: I stubbed
 * these as `[]` in the fixture an hour ago and the preview rendered two empty
 * dropdowns. That is precisely the lie this issue is about, reproduced by me
 * while fixing it. A stub in a fixture is a second implementation that always
 * disagrees.
 */
/**
 * Damage types as options.
 *
 * `localize` is passed rather than assumed because the two sheets disagree:
 * the NPC sheet localises at build time and renders `{{this.label}}` raw, the
 * item sheet leaves keys and renders `{{localize this.label}}`. Sharing the
 * BUILDER without forcing a convention keeps both templates rendering exactly
 * what they render today — unifying the convention is a separate change, and
 * one that needs both templates edited in the same breath.
 */
export function damageTypeOptions(localize = identityLocalize) {
  return LASTARC.allDamageTypes.map((k) => ({
    value: k, label: localize(`LASTARC.DamageType.${k}`)
  }));
}

/**
 * Statuses as options, blank first.
 *
 * The blank entry is the "no rider" case and must be selectable: without it a
 * field once set could never be cleared. Both sheets build this identically,
 * down to the blank label.
 */
export function statusOptions(localize = identityLocalize) {
  return [
    { value: "", label: localize("LASTARC.Attack.NoStatus") },
    ...LASTARC.allStatusIds.map((id) => ({ value: id, label: localize(`LASTARC.Status.${id}`) }))
  ];
}

/** The two ethos axes. Labels stay keys — both sheets render them localised. */
export function ethosOptions() {
  return {
    ethosPurityOptions: LASTARC.ethosPurity.map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` })),
    ethosMoralityOptions: LASTARC.ethosMorality.map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` }))
  };
}

/** High Arcana, whose labels live on the config entry rather than by key. */
export function highArcanaOptions(localize = identityLocalize) {
  return LASTARC.highArcanaIds.map((id) => ({
    value: id, label: localize(LASTARC.highArcana[id].label)
  }));
}

/** Technick flags, with the item's own selections marked. */
export function technickFlagOptions(chosen = []) {
  return LASTARC.technickFlags.map((f) => ({
    value: f,
    label: `LASTARC.TechnickFlag.${f}`,
    hint: `LASTARC.TechnickFlagHint.${f}`,
    selected: chosen.includes(f)
  }));
}

/**
 * Creature sizes as `{value, label}` options.
 *
 * The last decision that was still written out four times — both actor sheets,
 * the item sheet's option block, and the preview fixture — all identical, and
 * each one edit from disagreeing with the others. There are TWO size tables in
 * this system (creatures and objects) and they are not the same, so a picker
 * built from the wrong one is a plausible mistake to make once and impossible
 * to notice four times.
 */
export function sizeOptions() {
  return LASTARC.sizeOrder.map((k) => ({ value: k, label: LASTARC.sizes[k].label }));
}

/**
 * The "which defence does this oppose?" picker, blank entry first.
 *
 * `LASTARC.opposableDefences`, not a `["ref","fort","will"]` literal — the
 * literal appeared in four places across this codebase and each was one edit
 * away from disagreeing with the others.
 */
export function opposedDefenceOptions(localize = identityLocalize) {
  return [
    { value: "", label: localize("LASTARC.Field.NoOpposedDefence") },
    ...LASTARC.opposableDefences.map((k) => ({ value: k, label: `LASTARC.Defence.${k}` }))
  ];
}

export function performanceScopeOptions(localize = identityLocalize) {
  const options = (table, blankLabel) => [
    { value: "", label: localize(blankLabel) },
    ...Object.entries(table).map(([value, cfg]) => ({ value, label: cfg.label }))
  ];
  return {
    bonusScopeOptions: options(LASTARC.performanceBonusScopes, "LASTARC.Field.NoScope"),
    damageScopeOptions: options(LASTARC.performanceDamageScopes, "LASTARC.Field.NoScope"),
    penaltyScopeOptions: options(LASTARC.performancePenaltyScopes, "LASTARC.Field.NoScope"),
    effectTagOptions: options(LASTARC.performanceEffectTags, "LASTARC.Field.NoEffectTag")
  };
}
