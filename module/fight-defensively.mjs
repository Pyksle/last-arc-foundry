/**
 * Fight Defensively (#86).
 *
 * A standing election made as part of an attack, worth a Reflex bonus until the
 * start of your next turn. It is held as a temporary Active Effect rather than
 * a flag, for three reasons:
 *
 *   1. The bonus has to reach `defences.ref.misc`, which is the input slot
 *      derivation reads and never assigns — the only kind of path an effect can
 *      usefully write (CLAUDE.md §3).
 *   2. "Until the start of your next turn" is a duration, and durations expire
 *      on their own now.
 *   3. It shows up on the effects panel, where a GM can see it, suspend it or
 *      remove it like anything else. A hidden flag would be a rule the table
 *      cannot inspect.
 */

import { LASTARC } from "./config.mjs";
import * as D from "./derivation.mjs";

const SYSTEM_ID = "last-arc";
export const FLAG = "fightDefensively";

/** Is this character trained in the skill that improves the election? */
export function acrobaticsTrained(actor) {
  return !!actor?.system?.skills?.acrobatics?.trained;
}

/**
 * The election currently in force, or null.
 *
 * A DISABLED effect does not count. Expiry disables rather than deletes, so the
 * effect is still on the sheet the round after it ran out — reading it as live
 * would hand back a bonus the character no longer has.
 */
export function currentElection(actor) {
  const effect = [...(actor?.effects ?? [])].find(
    (e) => !e.disabled && e.getFlag?.(SYSTEM_ID, FLAG));
  if (!effect) return null;
  const { noAttacks = false } = effect.getFlag(SYSTEM_ID, FLAG) ?? {};
  return { id: effect.id, noAttacks };
}

/**
 * The attack penalty in force, for the attack pipeline to itemise.
 *
 * Zero unless the character is fighting defensively AND still attacking. The
 * book exempts opposed rolls made to block or parry, so the caller says whether
 * this is one — only it knows.
 */
export function attackPenalty(actor, { opposed = false } = {}) {
  const election = currentElection(actor);
  if (!election || opposed) return 0;
  return D.fightDefensivelyBonus({
    noAttacks: election.noAttacks, acrobatics: acrobaticsTrained(actor)
  }).attackPenalty;
}

/**
 * Turn the election on, off, or from one kind to the other.
 *
 * Toggling to the SAME kind clears it, so the button a player pressed by
 * mistake is undone by pressing it again — the gesture every other toggle on
 * this sheet already has.
 */
export async function setElection(actor, { noAttacks = false } = {}) {
  const election = currentElection(actor);

  if (election) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", [election.id]);
    if (election.noAttacks === noAttacks) return null;
  }

  const { ref } = D.fightDefensivelyBonus({
    noAttacks, acrobatics: acrobaticsTrained(actor)
  });

  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(
      noAttacks ? "LASTARC.FightDefensively.NoAttacks" : "LASTARC.FightDefensively.Attacking"),
    changes: [{
      key: "system.defences.ref.misc",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: String(ref),
      priority: 20
    }],
    /**
     * ONE ROUND. "Until the start of your next turn" is what the book says, and
     * a round is the closest thing Foundry counts — the lifecycle disables it
     * at the boundary, which is the same moment.
     */
    duration: { rounds: 1, startRound: game.combat?.round, startTurn: game.combat?.turn },
    flags: { [SYSTEM_ID]: { [FLAG]: { noAttacks } } }
  }]);

  return effect ?? null;
}
