/**
 * One-line "show your working" strings for chat cards (issue #11).
 *
 * Reported as "when hovering over output we need a display of what was rolled
 * and the modifiers included from said check/roll". The cards already showed
 * each modifier as its own chip with its own tooltip, but nothing anywhere said
 * what the DIE showed, so the total could not be checked against its parts —
 * the one thing a player wants when a number looks wrong.
 *
 * Shared rather than written per card. Four pipelines post totals (attack,
 * spell, damage, block) and a breakdown that exists on three of them is worse
 * than none, because its absence on the fourth reads as "this one has nothing
 * to show".
 */

import * as D from "../derivation.mjs";

/**
 * "d20 14 +7 Spellcraft −2 Break = 19"
 *
 * @param {Roll} roll   an evaluated `1d20 + @mod` roll
 * @param {Array<{label: string, value: number}>} parts
 */
export function describeCheck(roll, parts = []) {
  const natural = roll?.dice?.[0]?.results?.[0]?.result ?? 0;
  const bits = parts.map((p) => `${D.signed(p.value)} ${game.i18n.localize(p.label)}`);
  return `d20 ${natural}${bits.length ? ` ${bits.join(" ")}` : ""} = ${roll?.total ?? 0}`;
}

/**
 * "2d6 (4, 5) +6 = 15"
 *
 * Lists the individual faces because damage dice in this system EXPLODE, and an
 * exploding total that cannot be traced back to its dice reads as a bug. The
 * flat half is summarised rather than itemised — the parts chips beside it name
 * each term, and repeating them here made the line too long to read at a glance.
 *
 * @param {object} result the return of `rollDamageDice`, plus optional `terms`
 */
export function describeDamage(result) {
  if (!result) return null;

  const faces = (result.results ?? []).map((r) => r.result);
  const flat = result.terms?.flat ?? result.flat ?? 0;

  const dicePart = faces.length
    ? `${faces.length}d (${faces.join(", ")})`
    : game.i18n.localize("LASTARC.Card.NoDice");

  const raw = faces.reduce((s, f) => s + f, 0) + flat;
  const sum = `${dicePart}${flat ? ` ${D.signed(flat)}` : ""}`;

  // A hit always deals at least 1 (§5.5 step 8), so a broken weapon with a
  // large penalty can end below its own arithmetic. Say so rather than print a
  // sum that does not add up — an unexplained mismatch reads as a bug, and this
  // one would appear exactly when a player is already unhappy about the number.
  if (raw !== result.total) {
    return `${sum} = ${raw} → ${result.total} ${game.i18n.localize("LASTARC.Card.MinimumDamage")}`;
  }

  return `${sum} = ${result.total}`;
}
