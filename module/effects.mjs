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

/**
 * CHARACTERS AND NPCS DO NOT HAVE THE SAME SHAPE, and an effect written for one
 * silently does nothing on the other.
 *
 * A character keeps skills as a keyed object of derived rows, each with a `misc`
 * input slot, and defences with a `misc` alongside the derived total. A
 * statblock keeps skills as a FLAT PRINTED ARRAY of `{key, value}` and defences
 * as an authored `base`. There is no `system.skills.athletics.misc` on an NPC to
 * write to.
 *
 * This shipped wrong in 0.25.0: enfeebling performances target ENEMIES, enemies
 * are usually NPCs, and every debuff wrote character paths onto a statblock and
 * did nothing at all — in the feature whose entire purpose is to stop effects
 * doing nothing silently. CLAUDE.md warns about exactly this and it still
 * happened, because the paths were resolved once from the performer's side
 * rather than per target.
 */
export const skillTarget = (key) => `system.skills.${key}.misc`;

/** A defence's writable slot, which is named differently on the two models. */
export const defenceTarget = (key, actorType = "character") =>
  actorType === "npc"
    ? `system.defences.${key}.base`
    : `system.defences.${key}.misc`;

/**
 * Can this actor type take a per-skill effect at all?
 *
 * A statblock's skills are printed values in an array. An Active Effect can
 * only address an array by INDEX, and an index shifts whenever the GM reorders
 * or inserts a row — so a "+2 to Athletics" effect would silently become "+2 to
 * whatever is third now". Refusing is the honest answer; the GM edits the
 * printed number.
 */
export const supportsSkillEffects = (actorType) => actorType !== "npc";

/**
 * Every path an effect may write, as flat rows for a picker.
 *
 * Built from the same config the sheets and the rules engine read, so a skill
 * added to `allSkills` becomes targetable without a second edit — the class of
 * omission that leaves a mechanic half-wired.
 */
export function effectTargets(actorType = "character") {
  const out = [];

  // Both models keep an attribute's `value` as the authored input.
  for (const [key, cfg] of Object.entries(LASTARC.attributes)) {
    out.push({
      path: `system.attributes.${key}.value`,
      label: cfg.label, group: "attribute"
    });
  }

  for (const key of LASTARC.opposableDefences) {
    out.push({
      path: defenceTarget(key, actorType),
      label: `LASTARC.Defence.${key}`, group: "defence"
    });
  }

  if (supportsSkillEffects(actorType)) {
    for (const [key, cfg] of Object.entries(LASTARC.allSkills)) {
      out.push({ path: skillTarget(key), label: cfg.label, group: "skill" });
    }
  }

  return out;
}

/**
 * The set of writable paths, for membership tests.
 *
 * Unioned across both actor types by default, because the create-time warning
 * fires on an ActiveEffect document that may be embedded in either and should
 * not cry wolf about a legitimate statblock path.
 */
export function supportedTargetPaths(actorType = null) {
  if (actorType) return new Set(effectTargets(actorType).map((t) => t.path));
  return new Set([
    ...effectTargets("character").map((t) => t.path),
    ...effectTargets("npc").map((t) => t.path)
  ]);
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
export function scopeTargets(scope, actorType = "character") {
  if (!scope) return { paths: [], reason: null };

  const unmappable = LASTARC.unmappableEffectScopes[scope];
  if (unmappable) return { paths: [], reason: unmappable };

  // Defence scopes. The slot is named differently per model.
  if (scope === "allDefences") {
    return {
      paths: LASTARC.opposableDefences.map((k) => defenceTarget(k, actorType)),
      reason: null
    };
  }
  if (LASTARC.opposableDefences.includes(scope)) {
    return { paths: [defenceTarget(scope, actorType)], reason: null };
  }

  /**
   * Every remaining scope is skill-shaped, and a statblock cannot take one —
   * its skills are printed values in an array with no per-skill slot to write.
   * Reported rather than resolved to nothing, so the card can say why an
   * enfeebling performance did less to a monster than to a player.
   */
  const skillish = LASTARC.allSkills[scope]
    || scope === "attacksAndSkills"
    || LASTARC.effectSkillGroups[scope];

  if (skillish && !supportsSkillEffects(actorType)) {
    return { paths: [], reason: "LASTARC.EffectTarget.noStatblockSkills" };
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

/**
 * Turn a performance's outcome into the `changes` an Active Effect carries.
 *
 * A performance can grant a bonus and impose a penalty in the same tier, and
 * they land on different scopes, so both are walked. A penalty is stored as a
 * POSITIVE magnitude — §4.5's convention, so that typing what the book prints
 * cannot accidentally make a hostile tier a gift — and is negated here, once,
 * at the only point that knows which it is.
 *
 * Anything unmappable comes back in `skipped` with its reason rather than being
 * dropped, because a buff that silently applies HALF of what the card promised
 * is worse than one that says which half it could not do.
 *
 * @returns {{changes: Array<{key:string,mode:number,value:number,priority:number}>,
 *            skipped: Array<{scope:string, reason:string, value:number}>}}
 */
export function performanceEffectChanges(outcome = {}, actorType = "character") {
  const changes = [];
  const skipped = [];

  const add = (scope, value) => {
    if (!scope || !value) return;
    const { paths, reason } = scopeTargets(scope, actorType);
    if (reason || !paths.length) {
      skipped.push({ scope, reason: reason ?? "LASTARC.EffectTarget.unknownScope", value });
      return;
    }
    for (const key of paths) {
      // ADD, never OVERRIDE: two performers each granting +1 should give +2,
      // and the `misc` slots are sums by construction. OVERRIDE would make the
      // second performance silently erase the first.
      changes.push({ key, mode: 2, value, priority: 20 });
    }
  };

  add(outcome.bonusScope, Number(outcome.skillBonus) || 0);
  // Stored positive, applied negative — see above.
  add(outcome.penaltyScope, -(Number(outcome.penalty) || 0));
  // Bonus damage has no field to land on; report it rather than lose it.
  if (outcome.bonusDamage && outcome.bonusDamageScope) {
    const { reason } = scopeTargets(outcome.bonusDamageScope, actorType);
    skipped.push({
      scope: outcome.bonusDamageScope,
      reason: reason ?? "LASTARC.EffectTarget.noDamageField",
      value: outcome.bonusDamage
    });
  }

  return { changes, skipped };
}

/**
 * The riders a performance granted, as scope/value pairs.
 *
 * Kept SEPARATE from the resolved changes and carried on the card, because
 * resolution depends on the TARGET's shape and the card is written before any
 * target is chosen. 0.25.0 resolved once from the performer's side and put the
 * paths on the card, which meant every debuff aimed at an NPC wrote character
 * paths and did nothing.
 */
export function performanceRiders(outcome = {}) {
  const out = [];
  if (outcome.bonusScope && Number(outcome.skillBonus)) {
    out.push({ scope: outcome.bonusScope, value: Number(outcome.skillBonus) });
  }
  if (outcome.penaltyScope && Number(outcome.penalty)) {
    out.push({ scope: outcome.penaltyScope, value: -Number(outcome.penalty) });
  }
  return out;
}

/** Resolve carried riders against one actor's shape. */
export function ridersToChanges(riders = [], actorType = "character") {
  const changes = [];
  const skipped = [];
  for (const { scope, value } of riders) {
    const { paths, reason } = scopeTargets(scope, actorType);
    if (reason || !paths.length) {
      skipped.push({ scope, reason: reason ?? "LASTARC.EffectTarget.unknownScope", value });
      continue;
    }
    for (const key of paths) changes.push({ key, mode: 2, value, priority: 20 });
  }
  return { changes, skipped };
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

/** Flag scope for effects this system creates, so it can find its own again. */
const FLAG = "last-arc";

/**
 * Anchor a round-counted duration to the current combat.
 *
 * `startRound` and `startTurn` have to be stated. Without them Foundry counts
 * from whenever it next notices, and a buff created on the performer's turn can
 * survive a full extra round — which for a one-round effect is a doubling.
 *
 * Returns an empty duration out of combat: `rounds` with no combat to measure
 * against is not a shorter effect, it is an unmeasured one.
 */
function buildDuration(rounds) {
  const combat = game.combat;
  if (!rounds || !combat) return {};
  return {
    rounds,
    startRound: combat.round,
    startTurn: combat.turn ?? 0
  };
}

/**
 * Put a performance's buff or debuff on a set of actors.
 *
 * REPLACES rather than stacks per source. Performing the same piece again is
 * one performance continuing, not two running at once — so an effect carrying
 * the same `sourceId` is removed first. Two DIFFERENT performances stack
 * normally, which is why `changes` use ADD mode and why this keys on the item
 * rather than on the performer.
 *
 * ONE ROUND, because Chapter 9 says so and the card has been saying so all
 * along: "allies gain +2 until the start of your next turn". Foundry measures a
 * round from the current combat time, so an effect created on the performer's
 * turn expires at the same initiative next round — the same instant.
 *
 * Outside combat there is no round to count, and Foundry leaves the effect in
 * place. That is the honest behaviour rather than a bug: "until your next turn"
 * has no meaning when nobody is taking turns, so it stays until removed.
 *
 * @returns {Promise<{applied: Actor[], failed: Array<{actor: Actor, error: string}>,
 *                     partial: Array<{actor: Actor, skipped: Array}>}>}
 */
export async function applyPerformanceEffect(actors, {
  name, img = null, sourceId = null, riders = [], rounds = 1
} = {}) {
  const applied = [];
  const failed = [];
  const partial = [];
  if (!riders.length) return { applied, failed, partial };

  for (const actor of actors ?? []) {
    try {
      /**
       * Resolved PER ACTOR. A character takes a skill bonus on
       * `skills.<key>.misc`; a statblock has no such slot, so the same rider
       * resolves to nothing there and is reported instead of vanishing.
       */
      const { changes, skipped } = ridersToChanges(riders, actor.type);
      if (skipped.length) partial.push({ actor, skipped });
      if (!changes.length) continue;

      const stale = actor.effects
        .filter((e) => e.getFlag?.(FLAG, "performanceId") === sourceId)
        .map((e) => e.id);
      if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale);

      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name,
        img: img || undefined,
        changes,
        duration: buildDuration(rounds),
        origin: sourceId ? `Item.${sourceId}` : undefined,
        flags: { [FLAG]: { performanceId: sourceId } }
      }]);
      applied.push(actor);
    } catch (err) {
      // One actor failing must not abandon the rest — a bard buffing four
      // allies should not lose three of them to one locked token.
      failed.push({ actor, error: err?.message ?? String(err) });
      console.error(`Last Arc | could not apply "${name}" to ${actor?.name}`, err);
    }
  }

  return { applied, failed, partial };
}
