/**
 * Manual item ordering (issue #9).
 *
 * The interesting cases are all edges: moving off the end of a list, and the
 * fact that every item in a fresh world has sort 0, which makes a naive
 * two-value swap a no-op that looks exactly like a broken button.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  orderBySort,
  moveInOrder,
  sortUpdates,
  nextSort,
  SORT_STEP
} from "../module/item-order.mjs";

describe("ordering by sort", () => {
  test("orders ascending", () => {
    const items = [{ id: "c", sort: 300 }, { id: "a", sort: 100 }, { id: "b", sort: 200 }];
    assert.deepEqual(orderBySort(items).map((i) => i.id), ["a", "b", "c"]);
  });

  /**
   * Everything in a world that has never been reordered has sort 0. If ties
   * were broken by name the whole sheet would silently rearrange itself
   * alphabetically the first time it rendered, which is not what anybody asked
   * for and would look like data loss.
   */
  test("ties keep their existing order", () => {
    const items = [{ id: "zebra" }, { id: "apple" }, { id: "mango" }];
    assert.deepEqual(orderBySort(items).map((i) => i.id), ["zebra", "apple", "mango"]);
  });

  test("does not mutate the input", () => {
    const items = [{ id: "b", sort: 200 }, { id: "a", sort: 100 }];
    orderBySort(items);
    assert.equal(items[0].id, "b");
  });
});

describe("moving one place", () => {
  const ids = ["a", "b", "c"];

  test("up swaps with the previous entry", () => {
    assert.deepEqual(moveInOrder(ids, "b", "up"), ["b", "a", "c"]);
  });

  test("down swaps with the next entry", () => {
    assert.deepEqual(moveInOrder(ids, "b", "down"), ["a", "c", "b"]);
  });

  /**
   * Null rather than an unchanged copy, so the caller can skip the database
   * write entirely. Wrapping to the other end was the alternative and reads as
   * a misclick every time it happens.
   */
  test("moving off either end is refused, not wrapped", () => {
    assert.equal(moveInOrder(ids, "a", "up"), null);
    assert.equal(moveInOrder(ids, "c", "down"), null);
  });

  test("an unknown id is refused", () => {
    assert.equal(moveInOrder(ids, "nope", "up"), null);
  });

  test("a single-item list cannot move in either direction", () => {
    assert.equal(moveInOrder(["only"], "only", "up"), null);
    assert.equal(moveInOrder(["only"], "only", "down"), null);
  });
});

describe("writing sort values back", () => {
  /**
   * The whole panel is renumbered rather than two values being swapped. With
   * every item at sort 0, swapping two zeroes changes nothing — the list would
   * have refused to reorder until each item happened to be touched some other
   * way first.
   */
  test("renumbering gives every item a distinct, increasing sort", () => {
    const updates = sortUpdates(["a", "b", "c"]);
    assert.deepEqual(updates, [
      { _id: "a", sort: SORT_STEP },
      { _id: "b", sort: SORT_STEP * 2 },
      { _id: "c", sort: SORT_STEP * 3 }
    ]);
  });

  test("renumbering starts above the default of 0", () => {
    assert.ok(sortUpdates(["a"])[0].sort > 0,
      "an item still at sort 0 must not outrank a deliberately ordered one");
  });

  test("a round trip through renumbering preserves the moved order", () => {
    const moved = moveInOrder(["a", "b", "c"], "c", "up");
    const items = sortUpdates(moved).map((u) => ({ id: u._id, sort: u.sort }));
    assert.deepEqual(orderBySort(items).map((i) => i.id), ["a", "c", "b"]);
  });

  test("a new item lands after everything already there", () => {
    const siblings = [{ sort: SORT_STEP }, { sort: SORT_STEP * 2 }];
    assert.equal(nextSort(siblings), SORT_STEP * 3);
  });

  test("the first item in an empty list still gets a positive sort", () => {
    assert.equal(nextSort([]), SORT_STEP);
  });
});
