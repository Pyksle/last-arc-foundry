/**
 * Exploding dice (§5.3).
 *
 * ANY damage die that rolls its maximum triggers an additional die of the same
 * type. Explosions can themselves explode, unbounded. This applies to all damage
 * dice, including hero-point bonus d6s.
 *
 * Backstab-style effects use a variant where each exploding die generates **two**
 * additional dice rather than one.
 *
 * ── Why this is hand-rolled rather than using Foundry's `x` modifier ─────────
 *
 * Foundry's built-in explode handles the k=1 case fine but supports neither a
 * per-explosion multiplier nor a total-dice cap, and we need both. Rather than
 * maintain two code paths — built-in for normal, custom for doubled — everything
 * goes through one implementation. Dice are still rolled through Foundry's `Roll`
 * so its RNG and any dice-display modules behave normally.
 *
 * ── Why the guard is on TOTAL dice, not recursion depth ─────────────────────
 *
 * With k=2 this is a BRANCHING process, not a chain: generation g can hold up to
 * 2^g dice, so a depth cap of 100 permits 2^100 rolls. The process terminates
 * almost surely only while k/faces < 1 — for k=2 that means d4 and up are safe
 * (mean offspring 0.5), d3 is safe (0.67), and d2 is exactly critical (1.0),
 * i.e. infinite expected duration. Nothing in the demo produces a d2 damage die,
 * but any future effect that steps die sizes down could, so the guard is
 * unconditional.
 */

import { LASTARC } from "../config.mjs";

/**
 * @typedef {object} ExplodeResult
 * @property {Array<{result:number, exploded:boolean, generation:number}>} results
 * @property {number}  total
 * @property {number}  diceRolled
 * @property {boolean} capped     True if MAX_DICE was hit and the cascade was cut short.
 */

/**
 * Pure exploding-dice resolution.
 *
 * Takes an injectable RNG so the whole cascade — including the cap and the
 * doubled variant — is deterministically testable without Foundry.
 *
 * @param {object} options
 * @param {number} options.faces
 * @param {number} options.count       Initial dice.
 * @param {number} [options.multiplier] Dice generated per explosion (k). 1 = normal.
 * @param {number} [options.maxDice]
 * @param {(faces:number)=>number} options.rng  Returns an integer in [1, faces].
 * @returns {ExplodeResult}
 */
export function explodeDice({
  faces,
  count,
  multiplier = 1,
  maxDice = LASTARC.maxDicePerRoll,
  rng
}) {
  if (!Number.isInteger(faces) || faces < 2) {
    throw new Error(`explodeDice: faces must be an integer >= 2, got ${faces}`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`explodeDice: count must be a non-negative integer, got ${count}`);
  }

  const results = [];
  let total = 0;
  let capped = false;

  // Breadth-first by generation, so `generation` is meaningful for display:
  // generation 0 is the weapon's own dice, 1+ are explosions.
  let pending = count;
  let generation = 0;

  while (pending > 0) {
    let nextPending = 0;

    for (let i = 0; i < pending; i++) {
      if (results.length >= maxDice) {
        capped = true;
        break;
      }
      const value = rng(faces);
      const exploded = value === faces;
      results.push({ result: value, exploded, generation });
      total += value;
      if (exploded) nextPending += multiplier;
    }

    if (capped) break;
    pending = nextPending;
    generation++;
  }

  return { results, total, diceRolled: results.length, capped };
}

/**
 * Expected value of a single exploding die: `avg / (1 - k/N)`.
 *
 * Present so the test suite can check the sampled mean against the closed form
 * rather than against numbers copied from the spec — if the implementation and
 * the formula ever disagree, that is worth knowing.
 */
export function explodingDieEV(faces, multiplier = 1) {
  const ratio = multiplier / faces;
  if (ratio >= 1) return Infinity;   // critical or supercritical: no finite mean
  return ((faces + 1) / 2) / (1 - ratio);
}

/** Parse "3d6" / "d8" / "2d10" into {count, faces}. Returns null if not a dice term. */
export function parseDiceTerm(formula) {
  const m = /^\s*(\d*)d(\d+)\s*$/i.exec(String(formula ?? ""));
  if (!m) return null;
  return { count: m[1] === "" ? 1 : Number(m[1]), faces: Number(m[2]) };
}

/* -------------------------------------------------------------------------- */
/*  Foundry integration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Roll `count` dice of `faces` through Foundry, exploding per the rules above.
 *
 * Foundry references are confined to the function body so this module stays
 * importable by the plain-node test suite.
 *
 * @returns {Promise<ExplodeResult>}
 */
export async function rollExplodingDice({
  faces,
  count,
  multiplier = 1,
  maxDice = LASTARC.maxDicePerRoll
}) {
  const results = [];
  let total = 0;
  let capped = false;

  let pending = count;
  let generation = 0;

  while (pending > 0) {
    const room = maxDice - results.length;
    if (room <= 0) { capped = true; break; }

    const toRoll = Math.min(pending, room);
    if (toRoll < pending) capped = true;

    const roll = new Roll(`${toRoll}d${faces}`);
    await roll.evaluate();

    let nextPending = 0;
    for (const r of roll.dice[0]?.results ?? []) {
      const exploded = r.result === faces;
      results.push({ result: r.result, exploded, generation });
      total += r.result;
      if (exploded) nextPending += multiplier;
    }

    if (capped) break;
    pending = nextPending;
    generation++;
  }

  if (capped) {
    console.warn(
      `Last Arc | Exploding dice hit the ${maxDice}-die cap on ${count}d${faces} ` +
      `(multiplier ${multiplier}). Cascade truncated.`
    );
  }

  return { results, total, diceRolled: results.length, capped };
}

/**
 * Roll a full damage expression: dice with explosions, plus flat modifiers.
 *
 * @param {object} options
 * @param {string} options.diceFormula   e.g. "2d6"
 * @param {number} [options.critMultiplier] Multiplies the DICE COUNT, not the
 *   result. §5.1: a critical doubles the WEAPON's damage dice; Triple Crit makes
 *   it ×3. Bonus dice from talents and technicks are not multiplied unless the
 *   effect says so, which is why they are rolled separately by the caller.
 * @param {number} [options.explosionMultiplier]
 * @param {number} [options.flat]
 */
export async function rollDamageDice({
  diceFormula,
  critMultiplier = 1,
  explosionMultiplier = 1,
  flat = 0,
  maxDice = LASTARC.maxDicePerRoll
}) {
  const parsed = parseDiceTerm(diceFormula);
  if (!parsed) {
    // Not a simple NdF — fall back to Foundry's parser so odd formulas still
    // work, at the cost of no explosion handling. Warn rather than fail silently.
    console.warn(`Last Arc | "${diceFormula}" is not a simple dice term; explosions not applied.`);
    const roll = new Roll(String(diceFormula || "0"));
    await roll.evaluate();
    return { results: [], total: roll.total + flat, diceRolled: 0, capped: false, fallback: true };
  }

  const outcome = await rollExplodingDice({
    faces: parsed.faces,
    count: parsed.count * critMultiplier,
    multiplier: explosionMultiplier,
    maxDice
  });

  return { ...outcome, total: outcome.total + flat, flat };
}
