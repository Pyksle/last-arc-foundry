/**
 * Action economy (§9).
 *
 * Each combatant has one PRIMARY, one SECONDARY and one MINOR action per turn,
 * usable in any order. Downgrades are one-directional:
 *
 *     primary  →  secondary  or  minor
 *     secondary →  minor
 *     minor    →  (cannot upgrade)
 *
 * So a turn yields at most three minor actions, by downgrading everything. That
 * ceiling is not trivia: Recovery costs three consecutive minors and Aim costs
 * two, so "can I complete a Recovery in one turn?" is answered by it.
 *
 * FOUNDRY-FREE. All of this is pure state transitions over a plain object, which
 * is what makes the interrupt rule testable — it is the part nobody tracks
 * correctly by hand and the part most likely to be implemented wrongly.
 */

import { LASTARC } from "./config.mjs";

/** Slot names, ordered from least to most flexible. */
export const SLOTS = ["minor", "secondary", "primary"];

/** What each slot can be spent as, including via downgrade. */
const SLOT_COVERS = {
  minor: ["minor"],
  secondary: ["secondary", "minor"],
  primary: ["primary", "secondary", "minor"]
};

/**
 * A fresh turn.
 *
 * `bankedFor` names what the banked minors are accumulating toward ("aim",
 * "recovery"). It is part of the state rather than inferred because banking two
 * minors toward Aim and then one toward Recovery is NOT a completed Recovery —
 * the sequence has to be consecutive AND consistent.
 */
export function createTurnState() {
  return {
    primary: true,
    secondary: true,
    minor: true,
    bankedMinors: 0,
    bankedFor: null,
    reactionUsed: false
  };
}

/** How many minor actions are still available this turn, counting downgrades. */
export function availableMinors(state) {
  return SLOTS.filter((slot) => state[slot]).length;
}

/** Could an action of this type still be paid for? */
export function canSpend(state, type) {
  if (type === "allOut") return state.primary && state.secondary && state.minor;
  return SLOTS.some((slot) => state[slot] && SLOT_COVERS[slot].includes(type));
}

/**
 * Which slot should pay for an action of this type.
 *
 * Always spends the LEAST flexible slot that can cover it. Paying for a minor
 * action out of the primary slot when the minor slot is free would silently
 * destroy the character's ability to act, and is the obvious wrong greedy
 * choice.
 *
 * @returns {string|null} slot name, or null if unaffordable
 */
export function slotFor(state, type) {
  for (const slot of SLOTS) {
    if (state[slot] && SLOT_COVERS[slot].includes(type)) return slot;
  }
  return null;
}

/**
 * Spend an action.
 *
 * Any action other than continuing the current banked sequence INTERRUPTS it
 * and resets progress to zero (§9). That includes reactions, which is the part
 * that makes this genuinely hard to track manually — a Block taken on someone
 * else's turn wipes a two-thirds-complete Recovery.
 *
 * @param {object} state
 * @param {object} options
 * @param {string} options.type       "primary" | "secondary" | "minor" | "allOut"
 * @param {string|null} [options.banks] Sequence this minor contributes to.
 * @returns {{state: object, ok: boolean, reason: string|null, slot: string|null}}
 */
export function spend(state, { type, banks = null } = {}) {
  if (!canSpend(state, type)) {
    return { state, ok: false, reason: "LASTARC.Action.Unaffordable", slot: null };
  }

  const next = { ...state };

  if (type === "allOut") {
    next.primary = next.secondary = next.minor = false;
    return { state: interrupt(next), ok: true, reason: null, slot: "allOut" };
  }

  const slot = slotFor(state, type);
  next[slot] = false;

  if (type === "minor" && banks) {
    // Continuing the same sequence extends it; switching sequences restarts it
    // at one rather than carrying the old progress over.
    next.bankedFor = banks;
    next.bankedMinors = state.bankedFor === banks ? state.bankedMinors + 1 : 1;
    return { state: next, ok: true, reason: null, slot };
  }

  return { state: interrupt(next), ok: true, reason: null, slot };
}

/**
 * Use a reaction.
 *
 * Reactions are once per triggering action and usable off-turn, and they
 * INTERRUPT any banked sequence. They do not consume a turn slot — a reaction is
 * not paid for out of the three actions.
 */
export function useReaction(state, { flatFooted = false } = {}) {
  if (flatFooted) {
    // Reactions are blocked entirely while flat-footed (§8, §12).
    return { state, ok: false, reason: "LASTARC.Action.NoReactionsFlatFooted" };
  }
  return { state: interrupt({ ...state, reactionUsed: true }), ok: true, reason: null };
}

/**
 * Use a free action.
 *
 * Unlimited at GM discretion, but NOT usable while flat-footed — with hero
 * points as the stated exception (§9).
 */
export function useFreeAction(state, { flatFooted = false, isHeroPoint = false } = {}) {
  if (flatFooted && !isHeroPoint) {
    return { state, ok: false, reason: "LASTARC.Action.NoFreeActionsFlatFooted" };
  }
  // A free action does not interrupt a banked sequence: the sequence requires
  // consecutive MINOR ACTIONS, and a free action is not one.
  return { state, ok: true, reason: null };
}

/** Clear banked progress. Exported because several callers need it directly. */
export function interrupt(state) {
  return { ...state, bankedMinors: 0, bankedFor: null };
}

/**
 * Is a banked sequence complete?
 *
 * @param {number} [required] Overridden by Shake it Off, which lowers Recovery
 *   from three minors to two.
 */
export function sequenceComplete(state, sequence, required) {
  if (state.bankedFor !== sequence) return false;
  const need = required ?? SEQUENCES[sequence]?.minors;
  if (!need) return false;
  return state.bankedMinors >= need;
}

/** Multi-turn minor-action sequences (§9). */
export const SEQUENCES = {
  aim: { minors: 2, label: "LASTARC.Action.Aim" },
  recovery: { minors: LASTARC.recoveryMinorActions, label: "LASTARC.Action.Recovery" }
};

/**
 * Does the turn state carry over across turns?
 *
 * The three slots refresh, but banked progress DOES NOT reset at end of turn —
 * §9 explicitly allows a sequence to span turns. Only an intervening action
 * breaks it. Resetting the bank here would quietly make Recovery a
 * single-turn-only action.
 */
export function beginTurn(state) {
  return {
    ...createTurnState(),
    bankedMinors: state?.bankedMinors ?? 0,
    bankedFor: state?.bankedFor ?? null
  };
}

/* -------------------------------------------------------------------------- */
/*  Action catalogue (§9)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Actions worth surfacing as first-class UI, by the slot they normally cost.
 *
 * `provokes` marks the ones that trigger a Counterattack. Forced movement never
 * provokes unless stated (§9), which is why movement is on the list but forced
 * displacement is not modelled here at all.
 */
export const ACTIONS = {
  // Primary
  attack: { slot: "primary" },
  castSpell: { slot: "primary", provokes: true, note: "unless cast defensively" },
  charge: { slot: "primary", noCombo: true },
  disarm: { slot: "primary", provokesOnFailure: true },
  grab: { slot: "primary", provokesOnFailure: true },
  grapple: { slot: "primary" },
  skillCheck: { slot: "primary" },
  aidAnother: { slot: "primary" },
  attackObject: { slot: "primary" },
  useItemFromInventory: { slot: "primary", provokes: true },
  fightDefensively: { slot: "primary" },

  // Secondary
  move: { slot: "secondary", provokesOnLeavingThreat: true },
  drawSheathe: { slot: "secondary", provokes: true, note: "sheathing provokes" },
  interact: { slot: "secondary", provokes: true },
  retrieveStored: { slot: "secondary", provokes: true },
  standUp: { slot: "secondary", provokes: true },
  crawl: { slot: "secondary" },
  reload: { slot: "secondary" },
  shift: { slot: "secondary" },
  juke: { slot: "secondary" },
  disengage: { slot: "secondary" },

  // Minor
  aim: { slot: "minor", banks: "aim" },
  recovery: { slot: "minor", banks: "recovery" },
  secondWind: { slot: "minor" },
  fallProne: { slot: "minor" },
  activateItem: { slot: "minor" },

  // All-out
  coupDeGrace: { slot: "allOut" },
  sprint: { slot: "allOut" },
  cleave: { slot: "allOut" },

  // Reactions
  block: { slot: "reaction" },
  counterattack: { slot: "reaction" },
  dodge: { slot: "reaction" },
  activateTrap: { slot: "reaction" },
  mountedEvasion: { slot: "reaction" }
};

/**
 * Things that provoke a Counterattack (§9).
 *
 * Ranged attacks in a threatened area and unarmed attacks without Brawler also
 * provoke; those depend on context the catalogue cannot express, so they are
 * checked by the caller against these flags.
 */
export function provokes(actionKey, { failed = false, leavingThreat = false, castDefensively = false } = {}) {
  const def = ACTIONS[actionKey];
  if (!def) return false;
  if (def.provokes) {
    if (actionKey === "castSpell" && castDefensively) return false;
    return true;
  }
  if (def.provokesOnFailure && failed) return true;
  if (def.provokesOnLeavingThreat && leavingThreat) return true;
  return false;
}
