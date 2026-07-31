/**
 * Combat wiring (§8, §9).
 *
 * Replaces Foundry's default turn handling, which is wrong for this system in
 * two ways: it rolls d20 for initiative and it sorts descending. All the
 * decision logic lives in initiative.mjs and action-economy.mjs, both
 * Foundry-free and unit tested; this file is the adapter.
 */

import { LASTARC } from "./config.mjs";
import * as INIT from "./initiative.mjs";
import * as AE from "./action-economy.mjs";

const SYSTEM_ID = "last-arc";
const FLAG_ORDER = "turnOrder";
const FLAG_ACTIONS = "actions";
const FLAG_HELD = "held";

/* -------------------------------------------------------------------------- */
/*  Combatant helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Snapshot in the shape the pure comparators expect. */
function snapshot(combatant) {
  const sys = combatant.actor?.system ?? {};
  return {
    id: combatant.id,
    initiative: combatant.initiative,
    turnOrder: combatant.getFlag(SYSTEM_ID, FLAG_ORDER) ?? combatant.initiative,
    agiScore: sys.attributes?.agi?.total ?? 0,
    initiativeDie: sys.initiative?.effectiveDie ?? "d10"
  };
}

export function getTurnState(combatant) {
  return combatant.getFlag(SYSTEM_ID, FLAG_ACTIONS) ?? AE.createTurnState();
}

export async function setTurnState(combatant, state) {
  return combatant.setFlag(SYSTEM_ID, FLAG_ACTIONS, state);
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                               */
/* -------------------------------------------------------------------------- */

export function registerCombat() {
  /**
   * Ascending sort by the explicit turn-order key.
   *
   * Deliberately NOT solved by storing a negated initiative: that surfaces wrong
   * in the tracker UI and to every module that reads `combatant.initiative`.
   * The rolled die stays the displayed value; ordering is a separate key so Hold
   * Turn can permanently diverge from it.
   */
  Combat.prototype._sortCombatants = function (a, b) {
    const result = INIT.compareTurnOrder(snapshot(a), snapshot(b));
    // Stable fallback so the tracker does not jitter between renders. A genuine
    // tie is surfaced to the GM separately rather than silently settled here.
    return result || (a.id > b.id ? 1 : -1);
  };

  /**
   * Roll initiative with the actor's CLASS DIE, not a d20, and with no
   * modifiers by default (§8).
   */
  Combat.prototype._getInitiativeFormula = function (combatant) {
    return combatant?.actor?.system?.initiative?.effectiveDie ?? "1d10";
  };

  // Seed the ordering key whenever initiative is rolled.
  Hooks.on("updateCombatant", async (combatant, changed) => {
    if (!("initiative" in changed) || changed.initiative == null) return;
    if (combatant.getFlag(SYSTEM_ID, FLAG_HELD)) return;   // a hold owns the order
    await combatant.setFlag(SYSTEM_ID, FLAG_ORDER, changed.initiative);
  });

  // Fresh slots each turn — but banked minor progress survives, per §9.
  Hooks.on("combatTurn", async (combat) => {
    const combatant = combat.combatant;
    if (!combatant) return;
    await setTurnState(combatant, AE.beginTurn(getTurnState(combatant)));
  });

  Hooks.on("combatRound", async (combat) => {
    // Round 1 flat-footed lapses once a combatant has acted; from round 2 the
    // "has not yet acted" trigger no longer applies to anyone.
    if (combat.round <= 1) return;
    for (const c of combat.combatants) {
      if (c.actor?.statuses?.has("flatFooted")) {
        await c.actor.toggleStatusEffect?.("flatFooted", { active: false });
      }
    }
  });

  // Surface genuine ties for a coin flip rather than settling them invisibly.
  Hooks.on("renderCombatTracker", (app, element) => {
    const combat = game.combat;
    if (!combat?.combatants?.size) return;

    const ties = INIT.unresolvedTies([...combat.combatants].map(snapshot));
    if (!ties.length) return;

    console.debug(
      `Last Arc | ${ties.length} initiative tie(s) unresolved after Agility — ` +
      `§8 settles these with a coin flip.`
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  Hold Turn                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hold this combatant's turn, deferring to the next one.
 *
 * §8: this PERMANENTLY reorders the tracker for the rest of combat — it is not
 * a one-round delay. The new position persists because it is written to the
 * turn-order key rather than applied for a single round.
 */
export async function holdTurn(combatant) {
  const combat = combatant.parent;
  const all = [...combat.combatants].map(snapshot);

  const newOrder = INIT.holdTurnOrder(all, combatant.id);
  if (newOrder === null) {
    ui.notifications?.info(game.i18n.localize("LASTARC.Combat.HoldLast"));
    return null;
  }

  await combatant.setFlag(SYSTEM_ID, FLAG_ORDER, newOrder);
  await combatant.setFlag(SYSTEM_ID, FLAG_HELD, true);

  ChatMessage.create({
    content: `<p class="lastarc-applied"><strong>${combatant.name}</strong> — ` +
             `${game.i18n.localize("LASTARC.Combat.Held")}</p>`
  });

  await combat.setupTurns();
  return newOrder;
}

/**
 * Add a combatant mid-encounter (§8): they roll, then act after the current
 * highest-initiative combatant finishes.
 */
export async function joinCombat(combatant) {
  const combat = combatant.parent;
  const all = [...combat.combatants]
    .filter((c) => c.id !== combatant.id)
    .map(snapshot);

  await combat.rollInitiative([combatant.id]);
  await combatant.setFlag(SYSTEM_ID, FLAG_ORDER, INIT.joinCombatOrder(all));
  await combat.setupTurns();
}

/**
 * Roll group initiative (§8, GM option): one roll for the whole group, using the
 * LARGEST die among them — the group moves at the pace of its slowest member.
 */
export async function rollGroupInitiative(combatants) {
  if (!combatants.length) return null;

  const die = INIT.groupInitiativeDie(combatants.map(snapshot));
  const roll = new Roll(die.startsWith("d") ? `1${die}` : die);
  await roll.evaluate();

  const updates = combatants.map((c) => ({ _id: c.id, initiative: roll.total }));
  await combatants[0].parent.updateEmbeddedDocuments("Combatant", updates);

  await roll.toMessage({
    flavor: game.i18n.format("LASTARC.Combat.GroupInitiative", { die })
  });

  return roll.total;
}

/* -------------------------------------------------------------------------- */
/*  Action spending                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Spend an action for a combatant, honouring downgrades and the interrupt rule.
 *
 * @param {Combatant} combatant
 * @param {string} actionKey  Key into AE.ACTIONS.
 */
export async function spendAction(combatant, actionKey) {
  const def = AE.ACTIONS[actionKey];
  if (!def) throw new Error(`Unknown action: ${actionKey}`);

  const state = getTurnState(combatant);
  const flatFooted = combatant.actor?.statuses?.has("flatFooted") ?? false;

  if (def.slot === "reaction") {
    const result = AE.useReaction(state, { flatFooted });
    if (!result.ok) {
      ui.notifications?.warn(game.i18n.localize(result.reason));
      return null;
    }
    await setTurnState(combatant, result.state);
    return result;
  }

  const before = state.bankedMinors;
  const result = AE.spend(state, { type: def.slot, banks: def.banks ?? null });

  if (!result.ok) {
    ui.notifications?.warn(game.i18n.localize(result.reason));
    return null;
  }

  await setTurnState(combatant, result.state);

  // Tell the player when a sequence was broken. Silently zeroing two turns of
  // banked Recovery is the single most annoying way this could behave.
  if (before > 0 && result.state.bankedMinors === 0) {
    ui.notifications?.info(
      game.i18n.format("LASTARC.Action.SequenceInterrupted", { banked: before })
    );
  }

  return result;
}

/** Reset a combatant's turn state entirely, banked progress included. */
export async function resetActions(combatant) {
  await setTurnState(combatant, AE.createTurnState());
}
