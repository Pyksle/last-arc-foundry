/**
 * The one place a d20 gets rolled for a check (§12 Misfortune).
 *
 * Misfortune does TWO things, and only one of them was implemented:
 *
 *   1. the afflicted creature rerolls all attacks and skill checks and keeps
 *      the LOWER result;
 *   2. it cannot spend a hero point to reroll a d20.
 *
 * (2) was honoured. (1) was not, anywhere — there were seven bare
 * `new Roll("1d20 + @mod")` call sites and none of them knew about it. So
 * Misfortune, which is meant to be one of the harsher conditions in Chapter 12,
 * amounted to "you may not spend hero points" and nothing else.
 *
 * It half-worked, which is why it survived: a player under Misfortune who tried
 * to reroll got the correct refusal and reasonably concluded the status was
 * implemented.
 *
 * The LOWER NATURAL is what is kept, not the lower total. With an identical
 * modifier the two are the same number, but the natural is what auto-hit and
 * auto-miss read, and keeping the wrong one would make a natural 20 survive a
 * status whose whole purpose is to take it away.
 */

/**
 * Which of two naturals a Misfortune roll keeps.
 *
 * Pure, and separated from the rolling so it can be tested without Foundry.
 * Ties keep the first, which is arbitrary and harmless — the values are equal.
 *
 * @returns {"first"|"second"}
 */
export function keptRoll(firstNatural, secondNatural) {
  return secondNatural < firstNatural ? "second" : "first";
}

/** Is this actor rolling twice and keeping the worse? Works on both models. */
export function rollsWithMisfortune(actor) {
  return !!actor?.system?.statuses?.rerollKeepLower;
}

/**
 * Roll `1d20 + mod` for a check, honouring Misfortune.
 *
 * Returns the KEPT roll under the same shape a bare `new Roll` produced, so
 * every call site's downstream code — natural extraction, totals, the `rolls`
 * array on the chat message — is unchanged.
 *
 * @param {Actor} actor
 * @param {number} mod
 * @param {object} [options]
 * @param {boolean} [options.applies]  false for rolls Misfortune does not touch
 * @returns {Promise<{roll: Roll, discardedNatural: number|null}>}
 */
export async function rollCheckD20(actor, mod, { applies = true } = {}) {
  const first = new Roll("1d20 + @mod", { mod });
  await first.evaluate();

  if (!applies || !rollsWithMisfortune(actor)) {
    return { roll: first, discardedNatural: null };
  }

  const second = new Roll("1d20 + @mod", { mod });
  await second.evaluate();

  const natOf = (r) => r.dice[0]?.results?.[0]?.result ?? 0;
  const keepSecond = keptRoll(natOf(first), natOf(second)) === "second";

  return {
    roll: keepSecond ? second : first,
    // Surfaced so the card can say the roll was halved rather than the player
    // wondering why a 19 became a 4.
    discardedNatural: natOf(keepSecond ? first : second)
  };
}
