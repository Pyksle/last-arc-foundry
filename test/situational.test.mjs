/**
 * Situational modifiers (issue #16, v0).
 *
 * The label helpers are the whole Foundry-free surface of this feature; the
 * prompt and the wiring need a live sheet. What is worth pinning here is that a
 * typed reason survives onto the card, because the alternative — a modifier
 * appearing in a total with nothing saying why — is the thing that makes a
 * table stop trusting the numbers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { situationalLabel, situationalSuffix } from "../module/dice/situational.mjs";

describe("§16 situational modifiers", () => {
  test("a typed reason becomes the part label", () => {
    assert.equal(situationalLabel("higher ground"), "higher ground");
  });

  test("no reason falls back to the string table", () => {
    assert.equal(situationalLabel(null), "LASTARC.Mod.situational");
    assert.equal(situationalLabel(""), "LASTARC.Mod.situational");
  });

  test("a check label carries the reason and a signed number", () => {
    assert.equal(situationalSuffix("bad footing", -2), " — bad footing -2");
    assert.equal(situationalSuffix("charging", 2), " — charging +2");
  });

  test("a modifier with no reason still shows the number", () => {
    assert.equal(situationalSuffix(null, 2), " — +2");
  });

  /**
   * Alt-clicking, entering nothing and pressing Roll must not decorate the
   * label with a meaningless "+0" — that reads as a modifier that was applied.
   */
  test("an empty modifier adds nothing to the label", () => {
    assert.equal(situationalSuffix(null, 0), "");
    assert.equal(situationalSuffix("", 0), "");
  });
});
