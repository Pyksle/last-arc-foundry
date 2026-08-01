/**
 * Manual ordering of the item lists on a sheet (issue #9).
 *
 * Foundry gives every embedded document a `sort` integer but never maintains it
 * for actor-owned items: nothing assigns it on creation and nothing reads it
 * back, so `actor.items` comes out in database order and a player has no way to
 * put their three attacks in the order they actually use them.
 *
 * FOUNDRY-FREE, so the index arithmetic — which is the part that goes wrong —
 * is unit tested rather than discovered in play. The rules it encodes:
 *
 *   - Ties keep their existing relative order. `Array#sort` is stable, so items
 *     that have never been moved stay in creation order rather than jumping
 *     about alphabetically the first time the list renders.
 *   - Moving off either end is a no-op, not a wrap-around. Wrapping looks like
 *     a misclick every time it happens.
 *   - A move renumbers the WHOLE group rather than swapping two values. New
 *     items and imported ones all arrive at sort 0, and swapping two zeroes
 *     changes nothing at all; renumbering makes the first move repair the
 *     group permanently.
 */

/**
 * Foundry's own spacing between sort keys (`CONST.SORT_INTEGER_DENSITY`).
 *
 * Hardcoded rather than imported so this module stays Foundry-free. The gap
 * matters because Foundry's drag-drop sorter interpolates between neighbours;
 * consecutive integers would leave it nowhere to land.
 */
export const SORT_STEP = 100000;

/**
 * Order a group of items for display.
 *
 * @param {Array<{sort?: number}>} items
 * @returns {Array} a new array; the input is not mutated
 */
export function orderBySort(items) {
  return [...items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

/**
 * Move one id one place within an ordered list of ids.
 *
 * @param {string[]} ids       current order
 * @param {string} id          the item being moved
 * @param {"up"|"down"} direction
 * @returns {string[]|null} the new order, or null if the move is impossible —
 *   the id is not in the list, or it is already at that end. Null means "do
 *   nothing", and is deliberately distinct from returning an unchanged array so
 *   the caller can skip a pointless database write.
 */
export function moveInOrder(ids, id, direction) {
  const from = ids.indexOf(id);
  if (from < 0) return null;

  const to = from + (direction === "up" ? -1 : 1);
  if (to < 0 || to >= ids.length) return null;

  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Sort values for an ordered list of ids, as Foundry update payloads.
 *
 * Starts at SORT_STEP rather than 0 so every ordered item outranks anything
 * still sitting at the default 0 — otherwise an item created after a reorder
 * would silently insert itself at the top of the list.
 */
export function sortUpdates(ids) {
  return ids.map((id, i) => ({ _id: id, sort: (i + 1) * SORT_STEP }));
}

/**
 * The sort value a newly created item should take to land at the end of its group.
 *
 * @param {Array<{sort?: number}>} siblings items already in the group
 */
export function nextSort(siblings) {
  const highest = siblings.reduce((max, s) => Math.max(max, s.sort ?? 0), 0);
  return highest + SORT_STEP;
}
