/**
 * Using a consumable — the Foundry half of `consumables.mjs`.
 *
 * "Use Item from Inventory: You may use an item directly from your inventory,
 * such as a potion, poison, etc. This provokes a counterattack." A PRIMARY
 * action, and the provocation is the part nobody remembers at the table —
 * which is the argument for automating it rather than printing it on a card.
 *
 * ── Who it lands on ────────────────────────────────────────────────────────
 *
 * The TARGET if one is selected, otherwise the user. Both are real: the book's
 * own worked example has a character "chugging a potion to get 10 HP back",
 * and a party's commonest use of a Health Potion is pouring it into someone who
 * just hit 0 HP and went unconscious at the bottom of the Break Gauge.
 *
 * Deciding by target selection rather than by a dialog keeps the plain case at
 * one click, which is the whole complaint this feature answers.
 */

import { LASTARC } from "../config.mjs";
import * as CONS from "../consumables.mjs";
import { rollHealing } from "./healing.mjs";
import { rollDamageDice } from "./explode.mjs";
import { negatesSecondaryEffects, describeNegatedRider } from "../status-guard.mjs";
import * as CB from "../combat.mjs";

/**
 * Use one charge of a consumable.
 *
 * @param {Actor} actor   whoever is spending the action
 * @param {Item}  item
 * @param {object} [options]
 * @param {Actor} [options.target]     defaults to `actor`
 * @param {Combatant} [options.combatant]
 */
export async function useConsumable(actor, item, options = {}) {
  const sys = item.system ?? {};

  if (actor.system?.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  /**
   * Gated BEFORE the action is spent and before anything provokes. An empty
   * bottle must not cost a primary action and a counterattack.
   */
  const check = CONS.canUseConsumable(sys);
  if (!check.usable) {
    ui.notifications?.warn(game.i18n.format(check.reason, { item: item.name }));
    return null;
  }

  const target = options.target ?? actor;
  const effects = CONS.consumableEffects(sys);

  /**
   * Pay for it, and provoke.
   *
   * `useItemFromInventory` has sat in the action catalogue with the right slot
   * and the right `provokes` flag since the economy was written, and nothing
   * had ever called it — the other half of the orphan this feature closes.
   */
  const combatant = options.combatant
    ?? game.combat?.getCombatantByActor?.(actor.id)
    ?? null;

  let counter = null;
  if (combatant) {
    const spent = await CB.spendAction(combatant, "useItemFromInventory");
    if (!spent) return null;   // unaffordable; spendAction has already warned
    counter = await CB.resolveCounterattacks(combatant, "useItemFromInventory");
  }

  /* -- what it does -------------------------------------------------------- */

  const result = { item: item.name, target: target.name, counter, effects };

  if (effects.healing) {
    result.healed = await rollHealing(target, {
      formula: effects.healing,
      sourceName: item.name,
      sourceImg: item.img,
      healer: actor
    });
  }

  if (effects.mpRestore) {
    result.restored = await restoreMana(target, effects.mpRestore);
  }

  /**
   * Damage is ROLLED but never applied here — a grenade is thrown at someone,
   * and which someone is a ruling. The card carries an Apply button, exactly as
   * a weapon's damage does; auto-applying would be the one path in this system
   * that decides a target's HP without being asked (issue #19).
   */
  if (effects.damage) {
    const rolled = await rollDamageDice({
      diceFormula: effects.damage, critMultiplier: 1, explosionMultiplier: 1, flat: 0
    });
    result.damage = { ...rolled, damageType: sys.damageType || "unaspected" };
  }

  if (effects.status && LASTARC.allStatusIds.includes(effects.status)) {
    // A thrown flask is a source with an aspect, so the same §5.5 clause
    // applies to its rider as to a spell's — see `negatesSecondaryEffects`.
    const { negated, reason } = negatesSecondaryEffects(
      target, sys.damageType, { dealsDamage: !!effects.damage }
    );
    if (negated) {
      result.statusNegated = { status: effects.status, reason, damageType: sys.damageType };
    } else {
      await target.toggleStatusEffect?.(effects.status, { active: true });
      result.statusApplied = effects.status;
    }
  }

  /* -- spend the charge ---------------------------------------------------- */

  const next = CONS.useConsumable(sys);
  await item.update({
    "system.uses.value": next.uses.value,
    "system.quantity": next.quantity
  });
  result.remaining = { uses: next.uses, quantity: next.quantity, spent: next.spent };

  await postConsumableCard({ actor, item, target, result });
  return result;
}

/**
 * Restore mana, clamped, with the overflow reported.
 *
 * Lives here rather than in `healing.mjs` because that module is about HP and
 * its card says so. An Ether is not a heal.
 */
async function restoreMana(target, formula) {
  const rolled = await rollDamageDice({
    diceFormula: formula, critMultiplier: 1, explosionMultiplier: 1, flat: 0
  });

  const mp = target.system?.resources?.mp;
  if (!mp) return null;

  const out = CONS.resolveManaRestore({
    amount: rolled.total, current: mp.value, max: mp.max
  });
  await target.update({ "system.resources.mp.value": out.newMp });

  return { ...out, rolled: rolled.total, formula, dice: rolled.results ?? [] };
}

async function postConsumableCard({ actor, item, target, result }) {
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/consumable-card.hbs",
    {
      actorId: actor.id,
      name: item.name,
      img: item.img,
      typeLabel: game.i18n.localize(
        `LASTARC.ConsumableType.${item.system.consumableType}`
      ),
      targetName: target.name,
      // Only worth saying when it is not simply the user.
      onSomeoneElse: target.id !== actor.id,

      effectText: result.effects.effect,
      restored: result.restored,
      damage: result.damage
        ? {
          total: result.damage.total,
          formula: result.effects.damage,
          typeLabel: `LASTARC.DamageType.${result.damage.damageType}`,
          damageType: result.damage.damageType
        }
        : null,
      statusLabel: result.statusApplied
        ? game.i18n.localize(`LASTARC.Status.${result.statusApplied}`)
        : null,
      // The rider the target's resistance or immunity stopped (#57). Said out
      // loud, because a condition that silently fails to appear looks exactly
      // like a condition the system forgot.
      statusNegatedLabel: describeNegatedRider(result.statusNegated),

      /**
       * Nothing mechanical to resolve — a scroll, or a poison whose application
       * is a ruling. Said out loud rather than posting a blank card, so the
       * table knows the software has deliberately left it to them.
       */
      inert: result.effects.inert,

      remaining: result.remaining,
      exhausted: result.remaining.spent,
      counterattacked: !!result.counter?.provoked
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: {
      "last-arc": {
        type: "consumable",
        actorId: actor.id,
        itemId: item.id,
        // The Apply Damage button routes through the same handler a weapon's
        // damage does, so it needs the same shape.
        ...(result.damage
          ? { damage: result.damage.total, damageType: result.damage.damageType }
          : {})
      }
    }
  });
}
