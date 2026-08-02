/**
 * d20 roll pipeline (§1, §5.1, §7).
 *
 * Core resolution is `1d20 + modifiers` vs a target number, MEET IT OR BEAT IT
 * (≥ succeeds). Two rules make this less generic than it looks:
 *
 *   - Natural 1 always fails and natural 20 always succeeds, but ONLY for
 *     weapon skills. Standard skills have no nat-1/nat-20 rule at all, so a
 *     shared "critical" concept would be wrong here.
 *   - Weapon skills cannot Take 10 or Take 20.
 */

import { LASTARC } from "../config.mjs";
import { rollCheckD20 } from "./d20.mjs";
import * as D from "../derivation.mjs";
import { situationalSuffix } from "./situational.mjs";

/**
 * @typedef {object} LastArcRollResult
 * @property {Roll}    roll
 * @property {number}  natural       The raw d20 face.
 * @property {number}  total
 * @property {boolean} isWeaponSkill
 * @property {boolean} autoSuccess   Nat 20 on a weapon skill.
 * @property {boolean} autoFail      Nat 1 on a weapon skill.
 * @property {boolean|null} success  null when no DC was supplied.
 */

/**
 * Roll a skill or attribute check.
 *
 * @param {Actor} actor
 * @param {string} skillKey  Key into LASTARC.allSkills.
 * @param {object} [options]
 * @param {number|null} [options.dc]
 * @param {number} [options.situational]
 */
export async function rollSkill(actor, skillKey, options = {}) {
  const { dc = null, situational = 0, situationalNote = null } = options;

  const cfg = LASTARC.allSkills[skillKey];
  if (!cfg) throw new Error(`Unknown skill: ${skillKey}`);

  const skill = actor.system.skills?.[skillKey];
  if (!skill) throw new Error(`Actor ${actor.name} has no skill "${skillKey}"`);

  // Lore and Perform are eight ordinary skills now (issue #35), so there is no
  // container to unwrap and no free-text specialisation name to resolve.
  const mod = skill.total;
  const label = game.i18n.localize(cfg.label);

  // Refuse to roll for an incapacitated actor rather than producing a number
  // that implies they acted.
  if (actor.system.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  // Silence stops Spellcraft, Persuasion and the audible Performs outright —
  // it is not a penalty, so there is no number to roll. Refuse for the same
  // reason as above: a total on the card implies the attempt was allowed.
  if (actor.system.statuses?.blocksSkills?.has(skillKey)) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.SkillBlocked", { name: actor.name, skill: label })
    );
    return null;
  }

  // A skill check has no itemised parts list, so the reason rides on the label:
  // "Acrobatics — footing is bad -2" rather than an unexplained total.
  return evaluateCheck({
    actor,
    label: label + situationalSuffix(situationalNote, situational),
    mod: mod + situational,
    dc,
    isWeaponSkill: !!cfg.weapon,
    flavourKey: "LASTARC.Roll.SkillCheck"
  });
}

/**
 * Roll a raw attribute check. These take the Break Gauge penalty (the printed
 * sheet's gauge is labelled "Attacks, Defences, Skills, & Attribute Checks")
 * but never the trained bonus or armour check penalty.
 */
export async function rollAttribute(actor, attrKey, options = {}) {
  const { dc = null, situational = 0, situationalNote = null } = options;

  const attr = actor.system.attributes?.[attrKey];
  if (!attr) throw new Error(`Unknown attribute: ${attrKey}`);

  const bp = D.breakPenaltyOrZero(actor.system.breakGauge?.step ?? 0);

  return evaluateCheck({
    actor,
    label: game.i18n.localize(LASTARC.attributes[attrKey].label)
      + situationalSuffix(situationalNote, situational),
    mod: attr.mod + bp + situational,
    dc,
    isWeaponSkill: false,
    // An attribute check is not a skill check — see evaluateCheck.
    misfortuneApplies: false,
    flavourKey: "LASTARC.Roll.AttributeCheck"
  });
}

/**
 * Shared d20 evaluation.
 *
 * @returns {Promise<LastArcRollResult>}
 */
export async function evaluateCheck({
  actor, label, mod, dc, isWeaponSkill, flavourKey, misfortuneApplies = true
}) {
  /**
   * Misfortune rerolls "attacks and skill checks" keeping the lower — the
   * config comment's wording, which does not mention ATTRIBUTE checks. They are
   * excluded rather than assumed in, and flagged on issue #46 for the table to
   * correct if Chapter 12 means otherwise.
   */
  const { roll, discardedNatural } =
    await rollCheckD20(actor, mod, { applies: misfortuneApplies });

  const natural = roll.dice[0]?.results?.[0]?.result ?? 0;

  // Nat 1 / nat 20 are WEAPON-SKILL ONLY (§1, §7). Applying them to standard
  // skills would be a house rule, not this system.
  const autoSuccess = isWeaponSkill && natural === 20;
  const autoFail = isWeaponSkill && natural === 1;

  let success = null;
  if (dc !== null && dc !== undefined) {
    if (autoSuccess) success = true;
    else if (autoFail) success = false;
    else success = roll.total >= dc;   // meet it, beat it
  }

  const flavour = game.i18n.format(flavourKey, { label });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: buildFlavour({ flavour, dc, success, autoSuccess, autoFail }),
    // Tagged so the hero-point reroll button can find its actor. The speaker
    // alone is not enough: it may name a token rather than the actor, and an
    // unlinked token's actor is a different document.
    flags: {
      "last-arc": {
        type: "check", actorId: actor.id, natural,
        /**
         * Everything needed to REBUILD this message after a reroll (#48).
         *
         * Attacks got their rebuilt card first and skill checks did not, so a
         * player who spent a point on a Perception check was handed a bare die
         * face and had to add their own modifier back — reported as slowing
         * play, which it plainly does.
         *
         * `mod` is the load-bearing one. Without it the reroll is a naked
         * `1d20`, and the number in the log is not the number that was rolled.
         */
        label, mod, dc: dc ?? null, isWeaponSkill: !!isWeaponSkill, flavourKey,
        misfortuneApplies
      }
    }
  });

  return { roll, natural, total: roll.total, isWeaponSkill, autoSuccess, autoFail, success };
}

/**
 * Re-post a skill or attribute check after a reroll (#48).
 *
 * The sibling of `repostAttackAfterReroll`. Both exist for the same reason: the
 * plain "original 4, rerolled 17" card is a record of the dice, not a usable
 * result. An attack needs its damage button back; a check needs its total and
 * its success line, or the player is doing the arithmetic the system just did.
 *
 * Success is RE-RESOLVED against the same DC, and the nat-1/nat-20 rules are
 * re-applied to the new die — for a weapon skill those override the totals
 * entirely, so carrying the old verdict over would be wrong in exactly the case
 * the reroll was bought for.
 *
 * Returns false when the message was not a check, so the caller can fall through.
 */
export async function repostCheckAfterReroll(actor, flags, roll) {
  if (flags?.type !== "check") return false;

  const natural = roll.dice?.[0]?.results?.[0]?.result ?? 0;
  const isWeaponSkill = !!flags.isWeaponSkill;
  const autoSuccess = isWeaponSkill && natural === 20;
  const autoFail = isWeaponSkill && natural === 1;
  const dc = flags.dc ?? null;

  let success = null;
  if (dc !== null) {
    if (autoSuccess) success = true;
    else if (autoFail) success = false;
    else success = roll.total >= dc;
  }

  const flavour = game.i18n.format(
    flags.flavourKey ?? "LASTARC.Roll.SkillCheck", { label: flags.label ?? "" }
  );

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: buildFlavour({ flavour, dc, success, autoSuccess, autoFail }),
    // Carries the same flags, minus the reroll marker: the rebuilt card is a
    // real check and anything that reads one must see it as such.
    flags: { "last-arc": { ...flags, natural } }
  });
  return true;
}

function buildFlavour({ flavour, dc, success, autoSuccess, autoFail }) {
  let out = flavour;
  if (dc !== null && dc !== undefined) {
    out += ` <span class="lastarc-dc">DC ${dc}</span>`;
  }
  if (autoSuccess) out += ` <span class="lastarc-auto lastarc-auto--good">${game.i18n.localize("LASTARC.Roll.AutoSuccess")}</span>`;
  else if (autoFail) out += ` <span class="lastarc-auto lastarc-auto--bad">${game.i18n.localize("LASTARC.Roll.AutoFail")}</span>`;
  else if (success === true) out += ` <span class="lastarc-result lastarc-result--good">${game.i18n.localize("LASTARC.Roll.Success")}</span>`;
  else if (success === false) out += ` <span class="lastarc-result lastarc-result--bad">${game.i18n.localize("LASTARC.Roll.Failure")}</span>`;
  return out;
}

/**
 * Take 10 / Take 20 (§7).
 *
 * Weapon skills may do neither. Returns null and warns rather than silently
 * falling back to a roll, which would hide the rule from the player.
 */
export function takeN(actor, skillKey, n) {
  const cfg = LASTARC.allSkills[skillKey];
  if (!cfg) throw new Error(`Unknown skill: ${skillKey}`);

  if (cfg.weapon) {
    ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.WeaponSkillTakeN"));
    return null;
  }
  return (actor.system.skills?.[skillKey]?.total ?? 0) + n;
}
