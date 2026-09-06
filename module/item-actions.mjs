/**
 * "Roll this item" — one decision, one place (issue #68).
 *
 * Four item subtypes are rollable from a character sheet, and each has its own
 * dialog and its own idea of what a modifier key means: a weapon offers range
 * bands and ammunition, a spell and a performance offer Shift for defensive
 * use, a consumable asks nothing at all.
 *
 * That logic used to live in four private handlers on the character sheet,
 * which was fine while the sheet was the only way to roll. Dragging an item to
 * the macro bar is a SECOND way, and a macro that reimplemented any of it would
 * drift — a hotbar attack quietly skipping the target's prone bonus, say, which
 * is exactly the class of divergence `weaponAttackProfile` was written to end.
 *
 * So the sheet and the macro both call this. The sheet passes the click event
 * it already has; the macro passes a synthetic one carrying the modifier keys
 * the user held, so Alt still opens the situational dialog from the hotbar.
 */

import { LASTARC } from "./config.mjs";
import * as D from "./derivation.mjs";
import { hasTechnickFlag } from "./dice/attack.mjs";
import * as AMMO from "./ammunition.mjs";
import { rollAttack, defenceToBeat, targetConditions } from "./dice/attack.mjs";
import { castSpell, performItem } from "./dice/magic.mjs";
import { useConsumable } from "./dice/consume.mjs";
import { situationalOptions } from "./dice/situational.mjs";
import { ammoTrackingOn } from "./dice/ammunition.mjs";
import * as STANCE from "./declared-stance.mjs";

/**
 * Which action an item subtype answers to, or null when it is not rollable.
 *
 * The map is the single statement of what may be dragged to the bar; the drag
 * handler, the drop handler and the macro all ask it, so a subtype cannot
 * become draggable in one place and unrollable in another.
 */
export const ITEM_ACTIONS = Object.freeze({
  weapon: "attack",
  spell: "cast",
  performance: "perform",
  consumable: "use",
  spellScroll: "use",
  orchestralScore: "use"
});

export function rollableAction(item) {
  return ITEM_ACTIONS[item?.type] ?? null;
}

/**
 * Roll an item, whatever asked.
 *
 * @param {Actor} actor
 * @param {Item} item
 * @param {Event} event  the click, or a synthetic carrying altKey/shiftKey
 * @returns {Promise<boolean>} false when the user dismissed a dialog
 */
export async function rollItemAction(actor, item, event = {}) {
  const action = rollableAction(item);
  if (!actor || !item || !action) return false;

  const targeted = [...(game.user.targets ?? [])][0]?.actor;

  if (action === "attack") {
    /**
     * Ranged weapons get a range-band selector in the Alt-click dialog (issue
     * #36). Offered only when the weapon is actually ranged, so a swordsman is
     * never asked which increment they are swinging at.
     */
    const isRanged = LASTARC.rangedWeaponCategories.has(item.system.category);

    /**
     * Which trades this character may declare on THIS kind of attack. Looked up
     * by the roll rather than by asking each talent, so a melee trade is never
     * offered on a bow — and a list rather than one answer, because Mighty
     * Strikes and Tactical Guard are both melee and buy different things.
     */
    const kind = isRanged ? "ranged" : "melee";
    const available = D.declaredTradesFor(kind, (flag) => hasTechnickFlag(actor, flag));

    const extra = await situationalOptions(event, {
      rangeBands: isRanged
        ? D.rangeBandsFor(item.system.size, { isThrown: false })
        : null,
      // Only for a weapon that actually eats arrows, in a world that counts
      // them — which excludes staves, and excludes every table with tracking
      // switched off.
      ammoRounds: ammoTrackingOn() && AMMO.requiresAmmunition(item.system.category),
      /**
       * A trade box is shown only to a character who actually has one of these
       * talents — a box everyone sees is a rule everyone thinks they have.
       */
      tradeCap: (() => {
        const level = actor.system.details?.level ?? 1;
        // The most any of them allows. Each is clamped again against its own
        // cap where it is spent, so a generous `max` cannot buy anything.
        return Math.max(0, ...available.map((t) => D.declaredTradeCap(level, t.cap)));
      })(),
      // Named, so the dialog can ask WHICH when there is more than one.
      trades: STANCE.tradeChoices(kind, (flag) => hasTechnickFlag(actor, flag))
    });
    if (extra === null) return false;

    await rollAttack(actor, item, {
      ...extra,
      targetDefence: defenceToBeat(targeted),
      /**
       * The target's own condition — prone is +5 in melee and −5 at range,
       * helpless is +5. The character sheet did not supply these for as long as
       * both sheets existed, so a player attacking a downed creature was
       * quietly 5 short. One rule, and now genuinely one call site.
       */
      ...targetConditions(targeted),
      // Carried so the card can offer the target a Block (issue #12).
      target: targeted
    });
    return true;
  }

  if (action === "cast") {
    /** The spell trade buys damage with spellcraft, at twice the rate. */
    const spellTrade = D.declaredTradeFor("spell",
      (flag) => hasTechnickFlag(actor, flag));
    const extra = await situationalOptions(event, {
      tradeCap: spellTrade
        ? D.declaredTradeCap(actor.system.details?.level ?? 1, spellTrade.cap)
        : 0
    });
    if (extra === null) return false;
    await castSpell(actor, item, {
      ...extra,
      target: targeted,
      castDefensively: !!event.shiftKey,
      threatCount: event.shiftKey ? 1 : 0
    });
    return true;
  }

  if (action === "perform") {
    const extra = await situationalOptions(event);
    if (extra === null) return false;
    await performItem(actor, item, {
      ...extra,
      performDefensively: !!event.shiftKey,
      threatCount: event.shiftKey ? 1 : 0,
      // Enfeebling tiers are gated on beating a defence and can strip mana, so
      // a performance needs its target the same way a spell does (issue #13).
      target: targeted
    });
    return true;
  }

  // A consumable asks nothing, and lands on the user when nobody is targeted —
  // a party's commonest use of a potion is drinking it.
  await useConsumable(actor, item, { target: targeted ?? actor });
  return true;
}
