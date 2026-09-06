/**
 * Tactical Guard and Careful Shot — the declared trades that buy Reflex.
 *
 * Every other trade is over when the roll is: you take the penalty, you get the
 * damage, done. These two are a STANCE. The book says the penalty and the bonus
 * both "remain until the start of your next turn", so what you bought outlasts
 * the attack that bought it, and the price does too — a reaction attack made
 * before your turn comes round again is still made at the penalty you chose.
 *
 * Held as a temporary Active Effect, for the three reasons Fight Defensively is
 * (see `fight-defensively.mjs`): the bonus has to reach an input slot rather
 * than a derived one, "until the start of your next turn" is a duration and
 * durations expire on their own now, and a GM can see and suspend an effect.
 *
 * ONE AT A TIME. Declaring a stance clears whatever was standing, so a fighter
 * who swings twice in a turn pays for the second declaration rather than for
 * both at once, and a character cannot hold Tactical Guard's bonus and Careful
 * Shot's simultaneously by alternating weapons. The book does not say this in
 * so many words; it also never contemplates holding two, and summing them is
 * the reading that hands out a bonus nobody wrote down.
 */

import * as D from "./derivation.mjs";

const SYSTEM_ID = "last-arc";
export const FLAG = "declaredStance";

/**
 * The stance currently in force, or null.
 *
 * A DISABLED effect does not count — expiry disables rather than deletes, so
 * yesterday's stance is still on the sheet and must not still be charged for.
 */
export function currentStance(actor) {
  const effect = [...(actor?.effects ?? [])].find(
    (e) => !e.disabled && e.getFlag?.(SYSTEM_ID, FLAG));
  if (!effect) return null;
  const { key = null, points = 0 } = effect.getFlag(SYSTEM_ID, FLAG) ?? {};
  return { id: effect.id, key, points: Math.max(0, Number(points) || 0) };
}

/**
 * The attack penalty a standing stance costs, already signed.
 *
 * Zero when nothing is standing. Unlike Fight Defensively there is no opposed
 * exemption: the book exempts blocks and parries from fighting defensively and
 * says nothing of the kind here, and inventing the exemption would be inventing
 * the rule.
 */
export function stancePenalty(actor) {
  return -(currentStance(actor)?.points ?? 0);
}

/** Remove whatever stance is standing. Returns true when one was cleared. */
async function clearStance(actor) {
  const stance = currentStance(actor);
  if (!stance) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", [stance.id]);
  return true;
}

/**
 * Declare `points` on `spec`, replacing any standing stance.
 *
 * The caller has already clamped the points against the character's level —
 * this clamps them again, because the form's `max` is a courtesy and the rule
 * is enforced where the number is spent.
 *
 * @returns {Promise<ActiveEffect|null>} null when nothing was declared
 */
export async function declareStance(actor, { spec = null, points = 0, level = 1 } = {}) {
  const { ref } = D.reflexTradeStance(points, { level, spec });
  await clearStance(actor);
  if (!spec || ref <= 0) return null;

  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("LASTARC.DeclaredStance.Name", {
      trade: game.i18n.localize(`LASTARC.TechnickFlag.${spec.key}`),
      points: ref
    }),
    changes: [{
      key: "system.defences.ref.misc",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: String(ref),
      priority: 20
    }],
    // One round — the same "until the start of your next turn" the election
    // next door uses, and the same lifecycle disables it at the boundary.
    duration: { rounds: 1, startRound: game.combat?.round, startTurn: game.combat?.turn },
    flags: { [SYSTEM_ID]: { [FLAG]: { key: spec.key, points: ref } } }
  }]);

  return effect ?? null;
}

/** Every trade of any kind, for the dialog's picker. */
export function tradeChoices(kind, hasFlag) {
  return D.declaredTradesFor(kind, hasFlag).map((t) => ({
    key: t.key,
    label: `LASTARC.TechnickFlag.${t.key}`,
    buys: t.buys
  }));
}
