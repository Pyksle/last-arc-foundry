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
