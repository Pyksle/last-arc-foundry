/**
 * Dodge — the Acrobatics reaction (issue #50).
 *
 * An Acrobatics check against an incoming attack roll. Beat it and the attack
 * is treated as if it had not beaten your Reflex Defence — the same negation a
 * Block produces, reached a different way.
 *
 * ── Why this is not simply "Block without the shield" ───────────────────────
 *
 * `ACTIONS.dodge = { slot: "reaction" }` had sat in the action catalogue since
 * the economy was written, with no roll, no button and no handler behind it,
 * while the attack card told every defender "you may still Block or Dodge" on
 * every hit. Advertised and absent.
 *
 * The project spec compounded it, summarising the rule as "Dodge (Acrobatics vs
 * the attack roll)" — which reads as something every character can do. The book
 * gates it three ways, and two of those are the kind of thing nobody tracks by
 * hand, which is the argument for automating it at all:
 *
 *   1. the DODGE TECHNICK, so most characters cannot do it;
 *   2. LIGHT ARMOUR OR NONE — a defender who put on heavy armour this morning
 *      loses the ability and will not remember mid-combat;
 *   3. ONCE PER TURN, a hard cap rather than Block's cumulative penalty.
 *
 * That last difference is why this file does not share an implementation with
 * `block.mjs`. Two reactions, two limits; merging them would invite one rule's
 * limit to be "fixed" onto the other.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollCheckD20 } from "./d20.mjs";
import { getTurnState, setTurnState } from "../combat.mjs";
import * as AE from "../action-economy.mjs";
import { hasTechnickFlag } from "./attack.mjs";
import { describeCheck } from "./breakdown.mjs";

/** The skill a Dodge is made with. Named once so nothing has to guess. */
export const DODGE_SKILL = "acrobatics";

/**
 * Armour categories a dodging character may be wearing.
 *
 * The technick says light armour or none. `mystic` is a third category in this
 * system and is deliberately NOT included: it is neither of the two the rule
 * names, so allowing it would be a house rule invented here.
 *
 * It is the debatable one, though — mystic armour has no maximum Agility cap,
 * making it the least encumbering thing a character can wear, so a table could
 * reasonably rule the other way. Raised on #50 rather than decided quietly.
 */
export const DODGE_ARMOUR_TYPES = Object.freeze(["light"]);

/** The armour this actor is actually wearing, or null. */
export function equippedArmour(actor) {
  return actor?.items?.find((i) => i.type === "armour" && i.system?.equipped) ?? null;
}

/**
 * Has this actor already dodged since their turn began?
 *
 * False outside combat: "once per turn" has no meaning where nobody is taking
 * turns, and a counter with no way to clear it would lock the technick off for
 * the rest of the session after one use. The same reasoning as Block's repeat
 * penalty, which likewise counts only inside an encounter.
 */
export function dodgedThisTurn(actor) {
  const combatant = game.combat?.getCombatantByActor?.(actor.id);
  if (!combatant) return false;
  return !!getTurnState(combatant).dodgeUsed;
}

/**
 * Can this actor dodge right now, and if not, why not?
 *
 * Returns a REASON rather than a bare boolean, as `canBlock` does. A button
 * that is merely absent teaches nobody that they are in the wrong armour — and
 * the armour restriction is exactly the condition a player will have forgotten.
 *
 * @returns {{allowed: boolean, reason: string|null, hasTechnick: boolean}}
 */
export function canDodge(actor) {
  const hasTechnick = hasTechnickFlag(actor, "dodge");
  const no = (reason) => ({ allowed: false, reason, hasTechnick });

  // Checked first so every other refusal is only ever shown to someone who
  // actually has the technick. `hasTechnick` is returned separately because the
  // caller uses it to decide whether to draw a button at all.
  if (!hasTechnick) return no("LASTARC.Dodge.NoTechnick");

  const armour = equippedArmour(actor);
  if (armour && !DODGE_ARMOUR_TYPES.includes(armour.system?.type)) {
    return no("LASTARC.Dodge.Armour");
  }

  // Reactions are unavailable entirely while flat-footed (§8) — that is what
  // being caught unready means, and it is the whole value of a surprise round.
  if (actor.statuses?.has?.("flatFooted")) return no("LASTARC.Dodge.FlatFooted");

  if (actor.system?.breakGauge?.incapacitated) return no("LASTARC.Dodge.Incapacitated");

  if (dodgedThisTurn(actor)) return no("LASTARC.Dodge.AlreadyUsed");

  return { allowed: true, reason: null, hasTechnick };
}

/**
 * Roll a Dodge against an incoming attack total.
 *
 * @param {Actor} actor
 * @param {object} options
 * @param {number} options.attackTotal      the roll being opposed
 * @param {string} [options.attackerName]
 * @param {string} [options.sourceMessageId] the attack card this answers
 * @param {number} [options.situational]
 */
export async function rollDodge(actor, {
  attackTotal, attackerName = null, sourceMessageId = null, situational = 0
} = {}) {
  const check = canDodge(actor);
  if (!check.allowed) {
    ui.notifications?.warn(game.i18n.localize(check.reason));
    return null;
  }

  /**
   * Shape-aware, because a statblock keeps skills as a flat printed array while
   * a character keeps a keyed object of derived rows. Reading the character
   * path against an NPC yields undefined and silently becomes 0 — the bug that
   * made every light-weapon attack roll a bare d20, and monsters in this book
   * do carry the Dodge technick.
   */
  const skillMod = D.skillTotalOf(actor.system?.skills, DODGE_SKILL);

  const parts = [
    { label: LASTARC.allSkills[DODGE_SKILL].label, value: skillMod }
  ];
  if (situational) parts.push({ label: "LASTARC.Mod.situational", value: situational });
  const total = parts.reduce((sum, p) => sum + p.value, 0);

  // A Dodge is an Acrobatics CHECK, so Misfortune applies to it (§12) — which
  // `rollCheckD20` handles, and a bare `new Roll` would not.
  const { roll } = await rollCheckD20(actor, total);

  const result = D.resolveDodge({ dodgeTotal: roll.total, attackTotal });

  /**
   * Spend the reaction and burn the turn's dodge, on a FAILURE too.
   *
   * The attempt is what costs. Charging only on success would let a character
   * dodge, miss, and dodge again — which is the once-per-turn cap not existing.
   */
  const combatant = game.combat?.getCombatantByActor?.(actor.id);
  if (combatant) {
    const state = getTurnState(combatant);
    const spent = AE.useReaction(state, { flatFooted: false });
    await setTurnState(combatant, { ...spent.state, dodgeUsed: true });
  }

  await postDodgeCard({
    actor, roll, mod: total, parts, result, attackerName, sourceMessageId
  });

  return { roll, parts, total, result };
}

/**
 * Re-post a Dodge after a reroll (#50, reported by the GM).
 *
 * A Dodge is an Acrobatics CHECK, so a trait that rerolls Acrobatics applies to
 * it — and Tree's does. Two things were missing and both are on the card's
 * flags: `skillKey`, without which a SCOPED grant never matched and no button
 * appeared at all; and `mod` plus `attackTotal`, without which the reroll could
 * be offered but not resolved.
 *
 * That second half is the same lesson as #48. `rebuildAfterReroll` walks a list
 * of rebuilders and, finding none that owned this card, fell through to the
 * plain "original 9, rerolled 17" message — a record of the dice with no
 * verdict. For a reaction that is worse than useless: the whole question is
 * whether the attack landed, and the player would have to compare against a
 * number on someone else's card by hand.
 */
export async function repostDodgeAfterReroll(actor, flags, roll) {
  if (flags?.type !== "dodge") return false;

  const result = D.resolveDodge({
    dodgeTotal: roll.total, attackTotal: flags.attackTotal ?? 0
  });

  await postDodgeCard({
    actor, roll,
    mod: flags.mod ?? 0,
    parts: flags.parts ?? [],
    result,
    attackerName: flags.attackerName ?? null,
    sourceMessageId: flags.blocksMessageId ?? null,
    rerolled: true
  });
  return true;
}

async function postDodgeCard({
  actor, roll, mod, parts, result, attackerName, sourceMessageId, rerolled = false
}) {
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/dodge-card.hbs",
    {
      skillLabel: game.i18n.localize(LASTARC.allSkills[DODGE_SKILL].label),
      total: roll.total,
      natural: roll.dice[0]?.results?.[0]?.result ?? 0,
      parts,
      breakdown: describeCheck(roll, parts),
      dodged: result.dodged,
      attackTotal: result.attackTotal,
      attackerName
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    flags: {
      "last-arc": {
        type: "dodge",
        actorId: actor.id,
        dodged: result.dodged,
        /**
         * WHICH skill this was, so a trait that rerolls one named skill can
         * recognise it (#48's scoping). Without it a scoped grant compares
         * against `undefined` and no button is drawn — reported by the GM on a
         * character whose racial trait rerolls Acrobatics.
         */
        skillKey: DODGE_SKILL,
        /**
         * Everything needed to REBUILD this card after a reroll. `mod` is the
         * load-bearing one: without it the reroll is a naked d20 and its total
         * is not the number that gets compared to the attack.
         */
        mod, parts, attackTotal: result.attackTotal, attackerName,
        ...(rerolled ? { rerolled: true } : {}),
        /**
         * Named the same as Block's, so one lookup finds either reaction.
         * A dodged attack has to grey its own Damage button on every client,
         * and the defender cannot write to the attacker's chat message — so
         * each client reaches the answer from the log instead.
         */
        blocksMessageId: sourceMessageId
      }
    }
  });
}
