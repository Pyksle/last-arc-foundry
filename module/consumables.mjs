/**
 * Consumables — potions, ethers, poisons, scrolls, grenades (book p.125, §9).
 *
 * FOUNDRY-FREE. What one use costs, and whether there is anything left to use.
 *
 * ── Why this did not exist ──────────────────────────────────────────────────
 *
 * `LastArcConsumableData` has carried `uses`, `healing`, `damage`, `damageType`,
 * `appliesStatus`, `effect` and `consumeOnUse` since the item models were
 * written, and every one of them has an input on the item sheet. Nothing read
 * any of them. `ACTIONS.useItemFromInventory` sat in the action catalogue with
 * the right slot and the right `provokes` flag, and nothing called it either.
 *
 * So a player could author a Health Potion perfectly — name, cost, bulk, "10"
 * in the healing box — and then had no way to drink it. Reported from a
 * playtest as "tracking potions was tough": the item existed, the number was
 * right there, and the software did nothing with it. Both halves of the feature
 * were present and nothing joined them, which is the defect this project keeps
 * producing and the reason the integrity suite hunts orphaned exports.
 *
 * ── Charges versus quantity ─────────────────────────────────────────────────
 *
 * Two different numbers, and conflating them is the obvious mistake:
 *
 *   `quantity` — how many of the thing you carry. Five potions.
 *   `uses`     — charges within ONE of them. A wand with three castings.
 *
 * A potion is the degenerate case: quantity 5, uses 1/1. Drinking one has to
 * take a bottle off the shelf, not leave five bottles each mysteriously empty.
 */

/**
 * Can this be used right now, and if not, why not?
 *
 * A REASON rather than a bare boolean, for the same reason Dodge and Block
 * return one: a button that is merely dead teaches nobody anything. That
 * lesson has now cost this project three separate bug reports (#46, the
 * statblock Perform button, and this).
 *
 * @param {object} item
 * @param {number} item.quantity
 * @param {{value: number, max: number}} item.uses
 * @returns {{usable: boolean, reason: string|null}}
 */
export function canUseConsumable({ quantity = 0, uses = {} } = {}) {
  const held = Math.trunc(Number(quantity) || 0);
  if (held <= 0) return { usable: false, reason: "LASTARC.Consumable.NoneLeft" };

  const max = Math.trunc(Number(uses.max) || 0);
  const value = Math.trunc(Number(uses.value) || 0);

  /**
   * `max` of 0 means "not a charged item" rather than "no charges". The schema
   * defaults both to 1, but a GM who zeroes the maximum on a one-shot bomb
   * means it has no charge track, not that it is unusable forever.
   */
  if (max > 0 && value <= 0) return { usable: false, reason: "LASTARC.Consumable.NoCharges" };

  return { usable: true, reason: null };
}

/**
 * What one use costs, as the state AFTER it.
 *
 * `consumeOnUse: false` is a REUSABLE item — an alchemy kit, a focus. It still
 * spends a charge if it has a charge track, but the object itself is never
 * taken off the shelf.
 *
 * @returns {{uses: {value: number, max: number}, quantity: number,
 *            opened: boolean, spent: boolean}}
 *   `opened` — a fresh one was broken into, so quantity dropped.
 *   `spent`  — that was the last of them.
 */
export function useConsumable({ quantity = 0, uses = {}, consumeOnUse = true } = {}) {
  const max = Math.max(0, Math.trunc(Number(uses.max) || 0));
  const held = Math.max(0, Math.trunc(Number(quantity) || 0));
  let value = Math.max(0, Math.trunc(Number(uses.value) || 0));

  if (max > 0) value = Math.max(0, value - 1);

  let nextQuantity = held;
  let opened = false;

  /**
   * Exhausting the charges finishes THIS one. Whether the object survives is
   * `consumeOnUse` — a wand out of charges is still a wand.
   *
   * `max === 0` (uncharged) consumes one outright, which is what a thrown
   * grenade or a single-dose vial does.
   */
  if (consumeOnUse && (max === 0 || value === 0)) {
    nextQuantity = Math.max(0, held - 1);
    opened = true;
    // Still carrying more? The next one is full. Otherwise the track reads
    // empty, which is honest: there is nothing there to have charges.
    value = nextQuantity > 0 ? max : 0;
  }

  return {
    uses: { value, max },
    quantity: nextQuantity,
    opened,
    spent: consumeOnUse && nextQuantity <= 0
  };
}

/**
 * What a use actually does, resolved from the item's fields.
 *
 * Split out so the caller does not have to know which combination of blank
 * boxes means "this item does nothing mechanical" — a scroll or a poison
 * carries only prose, and that has to reach the card rather than producing an
 * empty result nobody can act on.
 */
export function consumableEffects({
  healing = "", mpRestore = "", damage = "", appliesStatus = "", effect = ""
} = {}) {
  const text = (v) => String(v ?? "").trim();
  return {
    healing: text(healing) || null,
    mpRestore: text(mpRestore) || null,
    damage: text(damage) || null,
    status: text(appliesStatus) || null,
    effect: text(effect) || null,
    // Nothing the software can resolve. The card still posts, because the
    // table is what resolves it.
    inert: !text(healing) && !text(mpRestore) && !text(damage) && !text(appliesStatus)
  };
}

/**
 * Restoring mana, clamped to the maximum.
 *
 * The mirror of `resolveHealing`, and it reports the waste for the same reason
 * that one does: "why did my Mega-Ether only give me 12?" is a question about
 * the ceiling, and a card that does not show the overflow cannot answer it.
 */
export function resolveManaRestore({ amount = 0, current = 0, max = 0 } = {}) {
  const restore = Math.max(0, Math.trunc(Number(amount) || 0));
  const from = Math.max(0, Number(current) || 0);
  const ceiling = Math.max(0, Number(max) || 0);

  const newMp = Math.min(ceiling, from + restore);
  return { applied: newMp - from, wasted: restore - (newMp - from), newMp };
}
