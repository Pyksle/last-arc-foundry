/**
 * Active Effect targeting (issue #20).
 *
 * THE PROBLEM THIS SOLVES. Foundry applies Active Effects between
 * `prepareBaseData` and `prepareDerivedData`. Everything this system derives —
 * defence totals, maximum HP and MP, damage reduction, Break Threshold, speed —
 * is assigned in the second, so an effect pointing at one of those is
 * overwritten in memory before anyone sees it. No error, no warning, no change
 * to the number.
 *
 * Forty paths are written after effects apply. They are the obvious ones. A GM
 * building "+10 max HP for an hour" reaches for `system.resources.hp.max`, gets
 * nothing, and has no way to find out why.
 *
 * So this module keeps a WHITELIST of paths that survive derivation — the input
 * slots (`misc`, `racialMod`, an attribute's `value`) that exist precisely to
 * receive outside modifiers — resolves the book's group scopes onto them, and
 * makes an unsupported target say so out loud at the moment it is created.
 *
 * Foundry-free apart from the notification call, so the resolution logic is
 * unit tested.
 */

import { LASTARC } from "./config.mjs";

/* -------------------------------------------------------------------------- */
/*  Pure                                                                       */
/* -------------------------------------------------------------------------- */

/** `system.skills.athletics.misc` — the slot derivation reads and never writes. */
export const skillTarget = (key) => `system.skills.${key}.misc`;

/** `system.defences.ref.misc`. */
export const defenceTarget = (key) => `system.defences.${key}.misc`;

/**
 * Every path an effect may write, as flat rows for a picker.
 *
 * Built from the same config the sheets and the rules engine read, so a skill
 * added to `allSkills` becomes targetable without a second edit — the class of
 * omission that leaves a mechanic half-wired.
 */
export function effectTargets() {
  const out = [];

  for (const [key, cfg] of Object.entries(LASTARC.attributes)) {
    out.push({
      path: `system.attributes.${key}.value`,
      label: cfg.label, group: "attribute"
    });
  }

  for (const key of LASTARC.opposableDefences) {
    out.push({
      path: defenceTarget(key),
      label: `LASTARC.Defence.${key}`, group: "defence"
    });
  }

  for (const [key, cfg] of Object.entries(LASTARC.allSkills)) {
    out.push({ path: skillTarget(key), label: cfg.label, group: "skill" });
  }

  return out;
}

/** The set of writable paths, for membership tests. */
export function supportedTargetPaths() {
  return new Set(effectTargets().map((t) => t.path));
}

/**
 * Expand a named skill group into the paths it covers.
 *
 * Returns `[]` for an unknown key rather than throwing: a performance authored
 * against a scope this system does not model should degrade to "nothing was
 * applied", which the caller reports, not to a broken sheet.
 */
export function skillGroupTargets(groupKey) {
  const group = LASTARC.effectSkillGroups[groupKey];
  if (!group) return [];
  return group.members().map(skillTarget);
}

/**
 * Turn one of the book's scopes into the paths an effect should write.
 *
 * Handles the performance bonus and penalty scopes, since those are the ones
 * with a payload waiting to be applied. Anything in `unmappableEffectScopes`
 * returns an empty list AND a reason, so the caller can print why rather than
 * dropping it silently — the distinction between "no effect" and "not
 * automatable" is the whole point.
 *
 * @returns {{paths: string[], reason: string|null}}
 */
export function scopeTargets(scope) {
  if (!scope) return { paths: [], reason: null };

  const unmappable = LASTARC.unmappableEffectScopes[scope];
  if (unmappable) return { paths: [], reason: unmappable };

  // Defence scopes.
  if (scope === "allDefences") {
    return { paths: LASTARC.opposableDefences.map(defenceTarget), reason: null };
  }
  if (LASTARC.opposableDefences.includes(scope)) {
    return { paths: [defenceTarget(scope)], reason: null };
  }

  // A single named skill, e.g. `spellcraft`.
  if (LASTARC.allSkills[scope]) return { paths: [skillTarget(scope)], reason: null };

  // Skill groups, including the compound one.
  if (scope === "attacksAndSkills") {
    return {
      paths: [...skillGroupTargets("weaponSkills"), ...skillGroupTargets("generalSkills")],
      reason: null
    };
  }
  const group = skillGroupTargets(scope);
  if (group.length) return { paths: group, reason: null };

  return { paths: [], reason: "LASTARC.EffectTarget.unknownScope" };
}

/**
 * Which of an effect's changes point somewhere derivation will overwrite.
 *
 * Anything outside the whitelist is reported, not just paths known to be
 * overwritten. A typo (`system.skills.athletics.misk`) is equally silent and
 * equally worth catching, and enumerating every wrong path is impossible.
 *
 * `system.` paths only — an effect on a flag or another namespace is somebody
 * else's business and must not be second-guessed here.
 */
export function unsupportedChanges(changes = []) {
  const ok = supportedTargetPaths();
  return (changes ?? [])
    .map((c) => c?.key)
    .filter((key) => typeof key === "string" && key.startsWith("system.") && !ok.has(key));
}

/* -------------------------------------------------------------------------- */
/*  Foundry-facing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Warn when an effect is created or edited against a path that cannot work.
 *
 * A warning rather than a refusal. A module or a future field could make a path
 * meaningful, and blocking an effect the GM deliberately wrote would be the
 * system overruling the table. Being loud is enough — the failure this replaces
 * is entirely silent.
 */
export function warnUnsupportedTargets(effect) {
  const bad = unsupportedChanges(effect?.changes);
  if (!bad.length) return;

  ui.notifications?.warn(
    game.i18n.format("LASTARC.Warning.EffectTargetUnsupported", {
      name: effect?.name ?? effect?.label ?? "",
      paths: bad.join(", ")
    })
  );
  console.warn(
    `Last Arc | "${effect?.name}" writes ${bad.join(", ")}. Active Effects apply `
    + "BEFORE prepareDerivedData, so any path derivation assigns is overwritten "
    + "on the next prepare. Target an input slot instead — see LASTARC.effectTargets.",
    effect
  );
}
