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
import * as D from "../derivation.mjs";

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
 * @param {string|null} [options.subskill]  Name of a Lore/Perform specialisation.
 */
export async function rollSkill(actor, skillKey, options = {}) {
  const { dc = null, situational = 0, subskill = null } = options;

  const cfg = LASTARC.allSkills[skillKey];
  if (!cfg) throw new Error(`Unknown skill: ${skillKey}`);

  const skill = actor.system.skills?.[skillKey];
  if (!skill) throw new Error(`Actor ${actor.name} has no skill "${skillKey}"`);

  // A sub-skilled parent (Lore, Perform) is a container — roll the named
  // specialisation, which is trained separately from its siblings.
  let mod = skill.total;
  let label = game.i18n.localize(cfg.label);
  if (subskill && cfg.subskilled) {
    const sub = skill.subskills?.find((s) => s.name === subskill);
    if (!sub) throw new Error(`Unknown ${skillKey} specialisation: ${subskill}`);
    mod = sub.total;
    label = `${label} (${subskill})`;
  }

  // Refuse to roll for an incapacitated actor rather than producing a number
  // that implies they acted.
  if (actor.system.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  return evaluateCheck({
    actor,
    label,
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
  const { dc = null, situational = 0 } = options;

  const attr = actor.system.attributes?.[attrKey];
  if (!attr) throw new Error(`Unknown attribute: ${attrKey}`);

  const bp = D.breakPenaltyOrZero(actor.system.breakGauge?.step ?? 0);

  return evaluateCheck({
    actor,
    label: game.i18n.localize(LASTARC.attributes[attrKey].label),
    mod: attr.mod + bp + situational,
    dc,
    isWeaponSkill: false,
    flavourKey: "LASTARC.Roll.AttributeCheck"
  });
}

/**
 * Shared d20 evaluation.
 *
 * @returns {Promise<LastArcRollResult>}
 */
export async function evaluateCheck({ actor, label, mod, dc, isWeaponSkill, flavourKey }) {
  const roll = new Roll("1d20 + @mod", { mod });
  await roll.evaluate();

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
    flags: { "last-arc": { type: "check", actorId: actor.id, natural } }
  });

  return { roll, natural, total: roll.total, isWeaponSkill, autoSuccess, autoFail, success };
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
