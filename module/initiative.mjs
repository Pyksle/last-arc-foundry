/**
 * Initiative (§8).
 *
 * ⚠ INVERTED. Initiative is a class-specific DIE, not a d20, no modifiers are
 * added by default, and the LOWEST result acts first. Ties break on the higher
 * Agility SCORE (not modifier), then a coin flip.
 *
 * ── Why there is a separate turn-order key ──────────────────────────────────
 *
 * Hold Turn "permanently reorders the tracker for the rest of combat. Not a
 * one-round delay." That means turn order genuinely diverges from the rolled
 * initiative: a combatant who rolled 3 and held is now after the one who rolled
 * 5, and stays there next round. A comparator reading `initiative` alone cannot
 * express that.
 *
 * So each combatant carries a `turnOrder` key, seeded from its initiative roll
 * and mutated by holds. The DISPLAYED initiative stays the rolled die, which is
 * what §8 warns about — negating or fudging the visible value surfaces wrong in
 * the tracker UI and to every module that reads it.
 *
 * The pure functions here are Foundry-free and unit tested; the wiring lives in
 * combat.mjs.
 */

import { LASTARC } from "./config.mjs";

/**
 * Ascending comparator: lowest turn order acts first.
 *
 * Falls back to the initiative roll when no explicit order has been assigned,
 * so a combatant added before any hold still sorts sensibly.
 */
export function compareTurnOrder(a, b) {
  const oa = a.turnOrder ?? a.initiative ?? Infinity;
  const ob = b.turnOrder ?? b.initiative ?? Infinity;
  if (oa !== ob) return oa - ob;

  // Ties: higher Agility SCORE goes first (§8).
  const aa = a.agiScore ?? 0;
  const ab = b.agiScore ?? 0;
  if (aa !== ab) return ab - aa;

  return 0;   // still tied — the caller flips a coin
}

/** Sort a combatant list into turn order. Does not mutate the input. */
export function sortCombatants(combatants) {
  return [...combatants].sort(compareTurnOrder);
}

/**
 * Combatants still exactly tied after initiative and Agility.
 *
 * Surfaced rather than silently broken by document id, because §8 says the tie
 * is settled by a coin flip — a real decision someone should make, not an
 * arbitrary stable sort the GM never sees.
 */
export function unresolvedTies(combatants) {
  const groups = new Map();
  for (const c of combatants) {
    const key = `${c.turnOrder ?? c.initiative}|${c.agiScore ?? 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * New turn-order value for a combatant who holds, deferring to the next one.
 *
 * Placed midway between the combatant it defers to and whoever follows, so the
 * holder lands immediately after — and stays there, because the value persists.
 *
 * Returns null when there is nobody to defer to (the holder is already last),
 * in which case holding is a no-op rather than an error.
 *
 * @param {Array} combatants  Any order; sorted internally.
 * @param {string} holderId
 * @returns {number|null}
 */
export function holdTurnOrder(combatants, holderId) {
  const sorted = sortCombatants(combatants);
  const index = sorted.findIndex((c) => c.id === holderId);
  if (index < 0 || index >= sorted.length - 1) return null;

  const deferTo = sorted[index + 1];
  const after = sorted[index + 2];

  const deferToOrder = deferTo.turnOrder ?? deferTo.initiative;
  if (!after) return deferToOrder + 1;

  const afterOrder = after.turnOrder ?? after.initiative;
  return (deferToOrder + afterOrder) / 2;
}

/**
 * Order in which multiple holders may choose to act (§8).
 *
 * Highest Agility first, then the SMALLEST initiative die — a d4 character is
 * quicker than a d12 one in this system, so "smallest die" means "fastest",
 * which is the opposite of the usual intuition.
 */
export function holderPriority(holders) {
  const dieSize = (d) => Number(String(d ?? "d20").replace(/^d/, "")) || 20;
  return [...holders].sort((a, b) => {
    const agi = (b.agiScore ?? 0) - (a.agiScore ?? 0);
    if (agi !== 0) return agi;
    return dieSize(a.initiativeDie) - dieSize(b.initiativeDie);
  });
}

/**
 * Turn order for a combatant joining mid-encounter (§8).
 *
 * They roll their die and act after the combatant with the current HIGHEST
 * initiative finishes — i.e. at the end of the round, regardless of what they
 * rolled.
 */
export function joinCombatOrder(combatants) {
  if (!combatants.length) return 0;
  const highest = Math.max(
    ...combatants.map((c) => c.turnOrder ?? c.initiative ?? 0)
  );
  return highest + 1;
}

/**
 * Group initiative (§8, a GM option the book recommends).
 *
 * The GM rolls ONCE for a group using the LARGEST initiative die among its
 * members — the group moves at the speed of its slowest member, which is why
 * this is the largest die rather than the smallest.
 */
export function groupInitiativeDie(members) {
  const dieSize = (d) => Number(String(d ?? "d4").replace(/^d/, "")) || 4;
  let largest = "d4";
  for (const m of members) {
    if (dieSize(m.initiativeDie) > dieSize(largest)) largest = m.initiativeDie;
  }
  return largest;
}

/**
 * Should this combatant be flat-footed right now (§8)?
 *
 * Three independent triggers: they have not yet acted in round 1, they cannot
 * detect the attacker, or they are surprised.
 *
 * NOTE the second one is per ATTACKER, which is why `detectsAttacker` is a
 * parameter rather than actor state — see `surpriseAwareness` below.
 */
export function isFlatFooted({
  round = 1,
  hasActed = false,
  surprised = false,
  detectsAttacker = true
} = {}) {
  if (surprised) return true;
  if (!detectsAttacker) return true;
  return round <= 1 && !hasActed;
}

/**
 * Resolve surprise awareness for every attacker/defender PAIR (§8).
 *
 * This is the subtle part: awareness is decided by comparing each defender's
 * Passive Perception against each ATTACKER'S Stealth check individually. A
 * defender can therefore be flat-footed against one ambusher and not another,
 * so flat-footed is not a global flag on the actor.
 *
 * @param {Array<{id, stealth}>} attackers
 * @param {Array<{id, passivePerception}>} defenders
 * @returns {Map<string, Set<string>>} defenderId → set of attacker ids they FAILED to notice
 */
export function surpriseAwareness(attackers, defenders) {
  const unnoticed = new Map();
  for (const d of defenders) {
    const missed = new Set();
    for (const a of attackers) {
      // Meet it, beat it: passive perception must reach the Stealth result.
      if ((d.passivePerception ?? 0) < (a.stealth ?? 0)) missed.add(a.id);
    }
    unnoticed.set(d.id, missed);
  }
  return unnoticed;
}

/**
 * How many actions a surprised combatant gets in the surprise round (§8).
 *
 * Attackers act fully. A surprised combatant who rolled LOWER than all
 * attackers gets one action of any type and is flat-footed until their next
 * turn; one who did not gets nothing.
 */
export function surpriseActions({ isAttacker, initiative, attackerInitiatives = [] }) {
  if (isAttacker) return { actions: "full", flatFooted: false };

  const lowerThanAll = attackerInitiatives.length > 0
    && attackerInitiatives.every((i) => initiative < i);

  return lowerThanAll
    ? { actions: 1, flatFooted: true }
    : { actions: 0, flatFooted: true };
}

/** Initiative die for an actor, honouring Improved Initiative steps. */
export function initiativeDieFor({ className, bonusSteps = 0, fallback = "d10" }) {
  const base = LASTARC.classes[className]?.initDie ?? fallback;
  const ladder = LASTARC.initiativeDieLadder;
  const i = ladder.indexOf(base);
  if (i < 0) return base;
  return ladder[Math.min(ladder.length - 1, i + bonusSteps)];
}
