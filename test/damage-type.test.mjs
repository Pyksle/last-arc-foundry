/**
 * Which damage type an attack deals (issue #32).
 *
 * The fallbacks are the interesting part. Every one of them replaces a silent
 * `damageType[0] ?? "blunt"` that was scattered across the pipeline, and a wrong
 * answer here does not throw — it quietly applies the wrong resistance, which is
 * the failure the reporting playtester actually experienced.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { damageTypeChoice, resolveDamageType } from "../module/dice/damage-type.mjs";

describe("damage type resolution", () => {
  test("one declared type needs no decision", () => {
    assert.deepEqual(damageTypeChoice(["piercing"]), { type: "piercing" });
  });

  test("two types are a question for the player, not for [0]", () => {
    // The book prints "Piercing or Slashing" on most polearms. Taking the first
    // silently is what made the second entry decorative.
    assert.deepEqual(damageTypeChoice(["piercing", "slashing"]), {
      ask: ["piercing", "slashing"]
    });
  });

  test("an already-made choice settles it", () => {
    assert.deepEqual(damageTypeChoice(["piercing", "slashing"], "slashing"),
      { type: "slashing" });
  });

  test("a choice the weapon cannot deal is ignored, not trusted", () => {
    // Otherwise a stale flag on a re-rolled card could apply fire damage from a
    // sword, and the schema's `choices` would throw on the next prepare.
    assert.deepEqual(damageTypeChoice(["piercing", "slashing"], "fire"), {
      ask: ["piercing", "slashing"]
    });
  });

  test("no type ticked falls back to blunt rather than undefined", () => {
    assert.deepEqual(damageTypeChoice([]), { type: "blunt" });
    assert.deepEqual(damageTypeChoice(), { type: "blunt" });
    assert.deepEqual(damageTypeChoice(null), { type: "blunt" });
  });

  test("unknown strings are dropped before they reach the schema", () => {
    assert.deepEqual(damageTypeChoice(["zzfake"]), { type: "blunt" });
    assert.deepEqual(damageTypeChoice(["zzfake", "cold"]), { type: "cold" });
  });

  test("every physical type survives the round trip", async () => {
    for (const t of ["blunt", "piercing", "slashing", "fire", "unaspected"]) {
      assert.equal(await resolveDamageType([t], { prompt: false }), t);
    }
  });

  test("prompt:false takes the first rather than opening a dialog", async () => {
    // Counterattack resolution loops over every threatening creature; asking
    // there would stack one dialog per attacker on a player who initiated none
    // of them. Deliberate, and the only place it is allowed.
    assert.equal(
      await resolveDamageType(["piercing", "slashing"], { prompt: false }),
      "piercing"
    );
  });

  test("a chosen type still wins when prompting is off", async () => {
    assert.equal(
      await resolveDamageType(["piercing", "slashing"], { prompt: false, chosen: "slashing" }),
      "slashing"
    );
  });
});
