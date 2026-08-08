/**
 * Block — the shield reaction (book p.109, issue #12).
 *
 * A shield is not a flat bonus to Reflex in this system. Blocking is an OPPOSED
 * ATTACK ROLL made with the shield, using the weapon skill its size relative to
 * the wielder dictates, and beating the incoming roll makes the attack "treated
 * as if it did not beat your Ref Defence". That is available against anything
 * targeting Reflex — attacks, abilities and spells, including area effects.
 *
 * The rule that makes it interesting, and the reason this is worth automating:
 * blocking more than once before your next turn takes a CUMULATIVE penalty, so
 * the third block of a round is a very different proposition from the first,
 * and nobody tracks that by hand.
 *
 * The arithmetic lives in derivation.mjs and is unit tested. This file resolves
 * who is blocking with what, spends the reaction, and posts the card.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollCheckD20 } from "./d20.mjs";
import { getTurnState, setTurnState } from "../combat.mjs";
import * as AE from "../action-economy.mjs";
import { hasTechnickFlag } from "./attack.mjs";
import { describeCheck } from "./breakdown.mjs";

/**
 * The shield this actor would block with.
 *
 * Equipped only. An unequipped shield is in the pack, and a rule that let a
 * character block with a shield they are not holding would be invisible in play
 * until someone noticed the numbers were too good.
 */
export function equippedShield(actor) {
  return actor?.items?.find((i) => i.type === "shield" && i.system?.equipped) ?? null;
}

/**
 * Can this actor block right now, and if not, why not?
 *
 * Returns a reason key rather than a bare boolean so the refusal can be shown.
 * A Block button that is simply absent teaches nobody that they left their
 * shield unequipped.
 *
 * @returns {{allowed: boolean, reason: string|null, shield: Item|null, skillKey: string|null}}
 */
export function canBlock(actor) {
  const shield = equippedShield(actor);
  if (!shield) {
    return { allowed: false, reason: "LASTARC.Block.NoShield", shield: null, skillKey: null };
  }

  // Reactions are blocked entirely while flat-footed (§8, §12) — that is what
  // being caught unready means, and it is the whole value of a surprise round.
  if (actor.statuses?.has?.("flatFooted")) {
    return { allowed: false, reason: "LASTARC.Block.FlatFooted", shield, skillKey: null };
  }

  if (actor.system?.breakGauge?.incapacitated) {
    return { allowed: false, reason: "LASTARC.Block.Incapacitated", shield, skillKey: null };
  }

  const skillKey = bestShieldSkill(actor, shield);
  if (!skillKey) {
    return { allowed: false, reason: "LASTARC.Block.ShieldTooLarge", shield, skillKey: null };
  }

  return { allowed: true, reason: null, shield, skillKey };
}

/**
 * A skill total, from either actor shape.
 *
 * Characters keep skills as a keyed object of derived rows; NPCs keep a flat
 * array of printed `{key, value}` pairs (§3.2). Reading a character-shaped path
 * against an NPC yields undefined and silently rolls a bare d20 — the exact bug
 * that made every light-weapon attack in the game roll with no skill bonus, so
 * it is handled once here rather than assumed.
 */
const skillTotal = (actor, key) => D.skillTotalOf(actor.system?.skills, key);

/**
 * Is this actor proficient with shields?
 *
 * NPCs have no proficiency list and never will: a statblock's printed numbers
 * already include whatever training the creature has (§3.2). Treating a monster
 * as non-proficient would silently dock it 5 and double its repeat-block rate.
 */
function shieldProficient(actor) {
  const proficiencies = actor.system?.proficiencies;
  return proficiencies ? !!proficiencies.shields : true;
}

/**
 * The best skill this actor may use with this shield.
 *
 * Two of the four size rows are a genuine choice — a light shield may use
 * either Light Weapon or 1-Handed, and a heavy shield at Str 15+ may use
 * 1-Handed instead of 2-Handed — so the better of the legal options is taken
 * automatically. Making the player pick between two of their own skills every
 * time an arrow comes in is not a decision, it is a prompt.
 *
 * @returns {string|null} skill key, or null when the shield is unusable
 */
export function bestShieldSkill(actor, shield) {
  const sys = actor.system;
  const options = D.shieldSkillOptions(sys.details?.size ?? "medium", shield.system.size, {
    strScore: sys.attributes?.str?.total ?? 0
  });

  let best = null;
  let bestTotal = -Infinity;
  for (const key of options) {
    const total = skillTotal(actor, key);
    if (total > bestTotal) {
      best = key;
      bestTotal = total;
    }
  }
  return best;
}

/**
 * How many blocks this actor has already made since their last turn began.
 *
 * Zero outside combat: the penalty is defined against "the start of your next
 * turn", and with no initiative order there are no turns for it to count
 * against. Charging a penalty with no way to clear it would be worse than
 * charging none.
 */
export function previousBlocks(actor) {
  const combatant = game.combat?.getCombatantByActor?.(actor.id);
  if (!combatant) return 0;
  return getTurnState(combatant).blocksUsed ?? 0;
}

/**
 * Roll a Block against an incoming attack total.
 *
 * @param {Actor} actor            the defender
 * @param {object} options
 * @param {number} options.attackTotal   the roll being opposed
 * @param {string} [options.attackerName]
 * @param {string} [options.sourceMessageId] the attack card this answers
 * @param {number} [options.situational]
 */
export async function rollBlock(actor, {
  attackTotal, attackerName = null, sourceMessageId = null, situational = 0
} = {}) {
  const check = canBlock(actor);
  if (!check.allowed) {
    ui.notifications?.warn(game.i18n.localize(check.reason));
    return null;
  }

  const proficient = shieldProficient(actor);
  const used = previousBlocks(actor);

  const mods = D.blockModifiers({
    skillMod: skillTotal(actor, check.skillKey),
    shieldBonus: check.shield.system.blockBonus ?? 0,
    previousBlocks: used,
    proficient,
    /**
     * Shield Expert (#59). Read HERE rather than in derivation, for the reason
     * Dodge's technick is read in `dodge.mjs`: the flag needs the actor's items
     * and derivation is Foundry-free. It belongs to the reaction it modifies.
     */
    shieldExpert: hasTechnickFlag(actor, "shieldExpert"),
    situational
  });

  const { roll } = await rollCheckD20(actor, mods.total);

  const result = D.resolveBlock({ blockTotal: roll.total, attackTotal });

  // Spend the reaction and count the block. Both are recorded even on a failed
  // block: the attempt is what costs, and a failed block still raises the
  // penalty on the next one.
  const combatant = game.combat?.getCombatantByActor?.(actor.id);
  if (combatant) {
    const state = getTurnState(combatant);
    const spent = AE.useReaction(state, { flatFooted: false });
    await setTurnState(combatant, { ...spent.state, blocksUsed: used + 1 });
  }

  await postBlockCard({ actor, shield: check.shield, roll, mods, result, check, used, attackerName, sourceMessageId });

  return { roll, mods, result, skillKey: check.skillKey, previousBlocks: used };
}

/**
 * Re-post a Block after a reroll (#50).
 *
 * The same gap Dodge had, found because Dodge made it visible: a Block is an
 * opposed roll made with a weapon skill, so a trait rerolling that skill
 * applies — and the card declared neither which skill it used nor the modifier
 * it was rolled with. A scoped grant therefore never appeared, and an unscoped
 * one produced a bare pair of die faces with no verdict.
 *
 * Fixed alongside Dodge rather than after it. The two reactions answer the same
 * question with the same card shape, and letting one learn this while the other
 * did not is how the pair would drift.
 */
export async function repostBlockAfterReroll(actor, flags, roll) {
  if (flags?.type !== "block") return false;

  const result = D.resolveBlock({
    blockTotal: roll.total, attackTotal: flags.attackTotal ?? 0
  });

  await postBlockCard({
    actor,
    shield: { name: flags.shieldName ?? "", img: flags.shieldImg ?? "" },
    roll,
    mods: { total: flags.mod ?? 0, parts: flags.parts ?? [] },
    result,
    check: { skillKey: flags.skillKey },
    used: flags.previousBlocks ?? 0,
    attackerName: flags.attackerName ?? null,
    sourceMessageId: flags.blocksMessageId ?? null,
    rerolled: true
  });
  return true;
}

async function postBlockCard({
  actor, shield, roll, mods, result, check, used, attackerName, sourceMessageId,
  rerolled = false
}) {
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/block-card.hbs",
    {
      shieldName: shield.name,
      shieldImg: shield.img,
      skillLabel: game.i18n.localize(LASTARC.allSkills[check.skillKey]?.label ?? check.skillKey),
      total: roll.total,
      natural: roll.dice[0]?.results?.[0]?.result ?? 0,
      parts: mods.parts,
      breakdown: describeCheck(roll, mods.parts),
      blocked: result.blocked,
      attackTotal: result.attackTotal,
      attackerName,
      // Shown only once it bites. A "0 previous blocks" line on every card
      // would be noise; the line appearing is itself the warning.
      previousBlocks: used || null
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    flags: {
      "last-arc": {
        type: "block",
        actorId: actor.id,
        blocked: result.blocked,
        /** Which weapon skill the shield was rolled with, for scoped grants. */
        skillKey: check.skillKey ?? null,
        /** Enough to rebuild this card after a reroll — see the note above. */
        mod: mods.total, parts: mods.parts,
        attackTotal: result.attackTotal, attackerName,
        shieldName: shield.name, shieldImg: shield.img,
        previousBlocks: used,
        ...(rerolled ? { rerolled: true } : {}),
        // Names the attack card this answers, so that card can grey out its
        // Damage button on every client without anyone needing permission to
        // edit someone else's message.
        blocksMessageId: sourceMessageId
      }
    }
  });
}
