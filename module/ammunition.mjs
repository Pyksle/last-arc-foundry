/**
 * Ammunition (book p.102), and the two systems the book offers for it.
 *
 * FOUNDRY-FREE. Every decision about what a shot costs and what is left lives
 * here, so it can be tested without a server — which matters more than usual,
 * because the two systems disagree about what "how much ammo do I have" even
 * means and the wrong one silently gives infinite arrows.
 *
 * ── The two systems ─────────────────────────────────────────────────────────
 *
 * COUNTED (`units`) is the default text: ammunition is bought in stacks of 10
 * and you spend units. It pairs with Ammunition Recovery — half of what you
 * spent in an encounter, rounded down, comes back at the end of it.
 *
 * THE AMMO DIE (`die`) is the book's own optional replacement. A stack is a
 * d12 rather than a number. Each shot you roll it, and on a 1 the die drops one
 * step: d12 → d10 → d8 → d6 → d4. Roll a 1 on the d4 and you are down to your
 * last piece. Spending more than one unit in a shot widens the window that
 * shrinks the die — 2 units shrink on 1–2, 3 or more on 1–3 — so Volley eats a
 * stack far faster than the same number of counted shots would suggest.
 *
 * A THIRD system is the one most tables actually use, and it is the default
 * here: `off`. Nobody is made to track anything they did not ask to track.
 *
 * ── Why the die is not just a smaller number ────────────────────────────────
 *
 * It is tempting to model the die as "roughly N units left" and reuse the
 * counting path. It is not that. The die has no expected value the player is
 * entitled to, recovery does not apply to it (looting steps it up instead), and
 * a d12 stack can die in three shots. Modelling it as a count would produce a
 * number the rules never promise and that the table would then argue with.
 */

import { LASTARC } from "./config.mjs";

/* -------------------------------------------------------------------------- */
/*  Tracking modes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The world setting's three values.
 *
 * `off` is first and is the default everywhere. Ammunition tracking is the
 * kind of rule a table adopts deliberately; switching it on for everyone
 * because the system now supports it would be a tax nobody agreed to pay.
 */
export const AMMO_MODES = Object.freeze(["off", "units", "die"]);

/* -------------------------------------------------------------------------- */
/*  The ammo die                                                               */
/* -------------------------------------------------------------------------- */

/** The die ladder, SMALLEST FIRST so index arithmetic reads as up and down. */
export const AMMO_DIE_LADDER = Object.freeze(["d4", "d6", "d8", "d10", "d12"]);

/**
 * Below the ladder sit two states that are not dice.
 *
 * `last` is the book's "you are reduced to your last piece of ammo" — one shot
 * remaining, and it is spent outright rather than gambled for. `empty` is what
 * that shot leaves behind. Both are stored in the same field as a die size
 * because they are the same fact: how much of this stack is left.
 */
export const AMMO_LAST_PIECE = "last";
export const AMMO_EMPTY = "empty";

/** Every value the stored field accepts, fullest first for a select. */
export const AMMO_DIE_STATES = Object.freeze([
  ...[...AMMO_DIE_LADDER].reverse(), AMMO_LAST_PIECE, AMMO_EMPTY
]);

/** The roll formula for a state, or null when there is nothing to roll. */
export function ammoDieFormula(die) {
  return AMMO_DIE_LADDER.includes(die) ? `1${die}` : null;
}

/** One step down the ladder. Off the bottom of the ladder is the last piece. */
export function shrinkAmmoDie(die) {
  const i = AMMO_DIE_LADDER.indexOf(die);
  if (i > 0) return AMMO_DIE_LADDER[i - 1];
  if (i === 0) return AMMO_LAST_PIECE;
  return AMMO_EMPTY;
}

/**
 * One step UP — "looting ammo increases your die by 1 step".
 *
 * Capped at d12, which is what a bought stack gives you. The book names no step
 * above it, and letting loot compound past the maximum stack would make looting
 * strictly better than shopping.
 */
export function growAmmoDie(die) {
  if (die === AMMO_EMPTY) return AMMO_LAST_PIECE;
  if (die === AMMO_LAST_PIECE) return AMMO_DIE_LADDER[0];
  const i = AMMO_DIE_LADDER.indexOf(die);
  if (i < 0) return die;
  return AMMO_DIE_LADDER[Math.min(i + 1, AMMO_DIE_LADDER.length - 1)];
}

/**
 * The roll at or below which the die shrinks.
 *
 * 1 unit shrinks on a 1, 2 units on 1–2, three or more on 1–3. Note that the
 * window does NOT keep widening past three: Volley's five arrows and Rapid
 * Shot's two are both covered by the same ceiling.
 */
export function shrinkThreshold(units = 1) {
  const n = Math.trunc(Number(units) || 1);
  return Math.min(3, Math.max(1, n));
}

/**
 * Fire once against the ammo die.
 *
 * @param {object} o
 * @param {string} o.die    current state
 * @param {number} o.roll   the ammo die's result; ignored on the last piece
 * @param {number} o.units  units this shot costs
 * @returns {{die: string, shrank: boolean, fired: boolean, threshold: number}}
 */
export function consumeAmmoDie({ die, roll = null, units = 1 } = {}) {
  if (die === AMMO_EMPTY) return { die: AMMO_EMPTY, shrank: false, fired: false, threshold: 0 };

  // The last piece is not gambled for. It is one arrow; you either have it or
  // you do not, and firing it leaves the quiver empty.
  if (die === AMMO_LAST_PIECE) {
    return { die: AMMO_EMPTY, shrank: true, fired: true, threshold: 0 };
  }

  const threshold = shrinkThreshold(units);
  const value = Number(roll);
  const shrank = Number.isFinite(value) && value >= 1 && value <= threshold;
  return { die: shrank ? shrinkAmmoDie(die) : die, shrank, fired: true, threshold };
}

/* -------------------------------------------------------------------------- */
/*  Which weapons care                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Does a weapon of this category need ammunition to attack?
 *
 * Bows and crossbows, and nothing else. STAVES ARE THE TRAP: they are in
 * `rangedWeaponCategories`, they roll at range, and they are the one ranged
 * category the book explicitly exempts — "staves do not require ammo to use
 * technicks and abilities such as Rapid Shot". Asking "is it ranged?" here
 * would have every wizard's wand jam on an empty quiver.
 */
export function requiresAmmunition(category) {
  return LASTARC.ammunitionCategories.has(category);
}

/* -------------------------------------------------------------------------- */
/*  Reloading                                                                  */
/* -------------------------------------------------------------------------- */

/** Action slots a reload can cost, cheapest first. */
export const RELOAD_SLOTS = Object.freeze(["minor", "secondary", "primary"]);

/**
 * What a reload costs this character.
 *
 * Secondary by default. The Quick Reload technick makes it a minor; a Severed
 * Arm "increase[s] the reload action by 1 step", which is the same ladder run
 * the other way. Having both is a wash, and that falls out of the arithmetic
 * rather than needing a rule of its own.
 *
 * Clamped at both ends. Nothing in the demo stacks two step increases, but a
 * GM hand-applying something could, and a reload that costs more than a primary
 * action has no representation — it would silently become "cannot reload",
 * which is a much bigger ruling than this function is entitled to make.
 */
export function reloadSlot({ quickReload = false, stepIncrease = 0 } = {}) {
  const base = RELOAD_SLOTS.indexOf("secondary");
  const i = base - (quickReload ? 1 : 0) + (Math.trunc(Number(stepIncrease)) || 0);
  return RELOAD_SLOTS[Math.min(RELOAD_SLOTS.length - 1, Math.max(0, i))];
}

/**
 * What a reload moves, without performing it.
 *
 * Switching ammunition type RETURNS the loaded rounds to stock rather than
 * destroying them. The book forbids mixing types in one weapon, which is a
 * reason to unload the bolts — not a reason for them to cease to exist. A
 * player swapping to Black Bolts to blind something, and finding their eight
 * ordinary bolts gone, would be right to be annoyed.
 *
 * @param {object} o
 * @param {"units"|"die"} o.mode
 * @param {number|null} o.capacity   null for a bow: nothing to fill
 * @param {number} o.loaded          rounds currently in the weapon
 * @param {string|null} o.currentAmmoId
 * @param {string} o.ammoId          what is being loaded
 * @param {number} o.stock           units available of the new type
 */
export function reloadPlan({
  mode = "units", capacity = null, loaded = 0, currentAmmoId = null, ammoId = null, stock = 0
} = {}) {
  const switching = !!currentAmmoId && currentAmmoId !== ammoId;

  // A bow has no magazine. "Reloading" it is choosing which quiver to draw
  // from, which moves nothing.
  if (capacity == null) return { loaded: 0, drawn: 0, returned: 0, switching };

  const returned = switching ? Math.max(0, loaded) : 0;
  const start = switching ? 0 : Math.max(0, loaded);
  const room = Math.max(0, capacity - start);

  // Under the die there is no count to draw down — the stack is the die, and
  // the magazine simply fills.
  const drawn = mode === "die" ? room : Math.min(room, Math.max(0, Math.trunc(stock) || 0));

  return { loaded: start + drawn, drawn, returned, switching };
}

/* -------------------------------------------------------------------------- */
/*  Firing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * May this attack be paid for?
 *
 * Returns a lang key rather than a sentence so the caller can warn in the
 * player's language, and so the reasons are enumerable by a test.
 *
 * @param {object} o
 * @param {"off"|"units"|"die"} o.mode
 * @param {boolean} o.requiresAmmo
 * @param {boolean} o.selected     is an ammunition item chosen at all
 * @param {number|null} o.capacity
 * @param {number} o.loaded
 * @param {number} o.stock
 * @param {string} o.die
 * @param {number} o.units         units this shot costs
 */
export function ammoCheck({
  mode = "off", requiresAmmo = false, selected = false,
  capacity = null, loaded = 0, stock = 0, die = AMMO_EMPTY, units = 1
} = {}) {
  if (mode === "off" || !requiresAmmo) return { ok: true, reason: null };
  if (!selected) return { ok: false, reason: "LASTARC.Ammo.NoneSelected" };

  /**
   * The die is checked BEFORE the magazine, in both directions.
   *
   * Under the die, the die is the whole supply — an empty die means there is
   * no ammunition anywhere, and a magazine cannot hold what you do not own. So
   * an exhausted die stops the shot even with rounds notionally loaded, and
   * `ammoSpend` empties the magazine when the die runs out so the sheet never
   * shows rounds that cannot be fired.
   */
  if (mode === "die" && die === AMMO_EMPTY) return { ok: false, reason: "LASTARC.Ammo.Empty" };

  // The magazine is a property of the crossbow, not of how the table counts
  // stock, so it gates the shot under either system.
  if (capacity != null) {
    if (loaded <= 0) return { ok: false, reason: "LASTARC.Ammo.NeedsReload" };
    if (loaded < units) return { ok: false, reason: "LASTARC.Ammo.NotEnoughLoaded" };
  } else if (mode === "units" && stock < units) {
    return { ok: false, reason: "LASTARC.Ammo.NotEnough" };
  }

  return { ok: true, reason: null };
}

/**
 * What firing costs, as the state AFTER the shot.
 *
 * Pure: the caller supplies the ammo die's roll rather than this rolling one,
 * because a function that reaches for a random number is a function no test can
 * pin down.
 *
 * @returns {{loaded: number, stock: number, die: string, spent: number,
 *            shrank: boolean, threshold: number, exhausted: boolean}}
 */
export function ammoSpend({
  mode = "off", requiresAmmo = false, capacity = null,
  loaded = 0, stock = 0, die = AMMO_EMPTY, dieRoll = null, units = 1
} = {}) {
  const state = {
    loaded, stock, die, spent: 0, shrank: false, threshold: 0, exhausted: false
  };
  if (mode === "off" || !requiresAmmo) return state;

  const cost = Math.max(1, Math.trunc(Number(units) || 1));
  state.spent = cost;

  if (capacity != null) state.loaded = Math.max(0, loaded - cost);

  if (mode === "units") {
    // With a magazine the stock was already drawn down at reload time; without
    // one the shot comes straight out of the quiver.
    if (capacity == null) state.stock = Math.max(0, stock - cost);
    return state;
  }

  const rolled = consumeAmmoDie({ die, roll: dieRoll, units: cost });
  state.die = rolled.die;
  state.shrank = rolled.shrank;
  state.threshold = rolled.threshold;
  state.exhausted = rolled.die === AMMO_EMPTY;
  // Nothing left to have loaded. Said here rather than left to the UI so the
  // magazine readout cannot outlive the supply that filled it.
  if (state.exhausted) state.loaded = 0;
  return state;
}

/* -------------------------------------------------------------------------- */
/*  Recovery                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ammunition Recovery: half of what was spent, rounded down, PER TYPE.
 *
 * Per type is the whole difficulty. Summing the encounter's spend and halving
 * once is both wrong and generous — three Fire Arrows and three Wooden Arrows
 * recover one of each, not three of whichever the player names.
 *
 * Applies to the counted system only. Under the ammo die the book replaces this
 * with looting, which steps the die up; `growAmmoDie` is that rule.
 *
 * @param {Record<string, number>} spent  units spent, keyed by ammunition id
 * @returns {Record<string, number>} units recovered, omitting the zeroes
 */
export function ammoRecovered(spent = {}) {
  const out = {};
  for (const [key, units] of Object.entries(spent ?? {})) {
    const n = Math.floor((Number(units) || 0) / 2);
    if (n > 0) out[key] = n;
  }
  return out;
}
