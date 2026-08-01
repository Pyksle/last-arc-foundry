/**
 * Sheet-side wiring for manual item ordering (issue #9).
 *
 * The index arithmetic lives in the Foundry-free `item-order.mjs` and is unit
 * tested there. This file is the adapter: it remembers what each panel looked
 * like when it was last rendered, and turns an arrow click into a write.
 *
 * Shared by the character and NPC sheets for the same reason `item-creation.mjs`
 * is: two copies of "which list am I in and where am I in it" would drift, and
 * the failure mode of drift here is one panel's arrows quietly doing nothing.
 */

import { moveInOrder, sortUpdates } from "../item-order.mjs";

/**
 * Panel → ordered item ids, per sheet instance.
 *
 * A WeakMap rather than a field on the sheet: the two sheet classes are
 * unrelated, a private field cannot be shared between them, and a public one
 * would be a new piece of ApplicationV2 surface for no benefit. Entries vanish
 * with the sheet.
 */
const ORDERS = new WeakMap();

/**
 * Stamp each row with its position and record the order for `moveItem`.
 *
 * `isFirst` / `isLast` exist so the arrows at the ends of a list can be
 * DISABLED rather than silently refusing — a control that answers a click by
 * not moving reads as broken, which is the complaint this feature came from. A
 * one-row panel gets both flags and both arrows are dead, which is correct:
 * there is nowhere to go.
 *
 * @param {Application} sheet
 * @param {Record<string, Array<{id: string}>>} panels panel name → rendered rows
 */
export function markOrder(sheet, panels) {
  const order = {};
  for (const [panel, rows] of Object.entries(panels)) {
    order[panel] = rows.map((r) => r.id);
    rows.forEach((row, i) => {
      row.panel = panel;
      row.isFirst = i === 0;
      row.isLast = i === rows.length - 1;
    });
  }
  ORDERS.set(sheet, order);
}

/**
 * Move an item one place within its panel.
 *
 * Renumbers the WHOLE panel rather than swapping two `sort` values, because
 * everything starts at sort 0 and swapping two zeroes changes nothing — the
 * list would have refused to reorder until each item had been touched some
 * other way first. The first move repairs the group permanently.
 *
 * @param {Application} sheet
 * @param {HTMLElement} target the clicked arrow
 */
export async function moveItem(sheet, target) {
  const { itemId, panel, direction } = target.dataset;
  const order = ORDERS.get(sheet)?.[panel];

  if (!order) {
    console.error(
      `Last Arc | moveItem: no rendered panel called "${panel}". ` +
      `The button's data-panel must match a key passed to markOrder().`
    );
    return;
  }

  const next = moveInOrder(order, itemId, direction);
  if (!next) return;   // already at that end

  await sheet.document.updateEmbeddedDocuments("Item", sortUpdates(next));
}
