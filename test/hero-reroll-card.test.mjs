/**
 * A hero-point reroll has to leave the player able to finish the attack (#48).
 *
 * The reroll worked and posted a card saying so — but that card carried no
 * attack flags, so it had no Roll Damage button and no Block offer. A player
 * who spent a hero point to turn a miss into a hit could see the hit and not
 * resolve it. The GM reported it as the reroll "not creating a new card".
 *
 * Two things had to be true and neither was:
 *
 *   1. the kept roll must be a REAL roll carrying the attack's modifier, not a
 *      bare `1d20` whose total is just the die face;
 *   2. the rebuilt card must RE-RESOLVE hit-or-miss, because changing that
 *      outcome is the entire reason the point was spent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveReroll } from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const heroPoints = read("module/dice/hero-points.mjs");
const attack = read("module/dice/attack.mjs");
const chat = read("module/chat.mjs");

describe("§48 the reroll is rolled with the attack's modifier", () => {
  test("heroPointReroll takes a mod and applies it to the die", () => {
    assert.match(heroPoints, /export async function heroPointReroll\([^)]*mod = 0/s,
      "heroPointReroll does not accept the modifier, so its total is a bare " +
      "die face and cannot be compared against a defence");
    assert.match(heroPoints, /new Roll\("1d20 \+ @mod", \{ mod \}\)/,
      "the reroll is still a naked 1d20");
  });

  test("it returns the winning roll, not just the winning number", () => {
    assert.match(heroPoints, /keptRoll:/,
      "without the kept ROLL the caller cannot rebuild a card: it has a number " +
      "but no dice to attach to the message");
  });

  /**
   * `resolveReroll` decides by NATURAL, and the winner may be the original.
   * Returning the reroll regardless would show a total the dice never produced
   * whenever the original won — which is every "keep higher" that fails.
   */
  test("keeping the original means keeping the original's roll", () => {
    assert.match(heroPoints, /kept === rerolled \? reroll : originalRoll/,
      "the kept roll must follow resolveReroll's choice, not default to the reroll");

    // The semantics that choice depends on, pinned here so the mapping above
    // stays meaningful.
    assert.equal(resolveReroll(18, 4, "second"), 4, "second: the new die stands");
    assert.equal(resolveReroll(18, 4, "higher"), 18, "higher: the original wins");
    assert.equal(resolveReroll(4, 18, "lower"), 4, "lower: the original wins");
  });

  test("the chat handler passes the original roll's modifier", () => {
    assert.match(chat, /heroPointReroll\(actor, original, \{ mod: flags\.mods\?\.total \?\? 0 \}\)/,
      "the reroll is made with no modifier, so an attack rebuilt from it would " +
      "compare a bare die face against a defence");
  });
});

describe("§48 the rebuilt card is a real attack card", () => {
  test("the attack card stores its modifiers so one can be rebuilt", () => {
    const flagBlock = attack.slice(attack.indexOf('type: "attack"'));
    assert.match(flagBlock.slice(0, 2000), /^[\s\S]*?\bmods,/,
      "mods is not on the attack card's flags, so a reroll has no modifier " +
      "total and no itemised parts to rebuild with");
  });

  test("the outcome is recomputed, never carried over", () => {
    const fn = attack.slice(
      attack.indexOf("export async function repostAttackAfterReroll"),
      attack.indexOf("async function postAttackCard")
    );
    assert.ok(fn.length, "repostAttackAfterReroll is missing");
    assert.match(fn, /resolveAttack\(\{/,
      "the rebuilt card reuses the old outcome — the reroll was bought " +
      "precisely to change hit-or-miss, and a natural 20 or 1 on the new die " +
      "has to mean what it always means");
    assert.ok(!/outcome:\s*flags\.outcome/.test(fn),
      "the stored outcome must not be reused");
  });

  test("it refuses rather than half-rendering a card", () => {
    const fn = attack.slice(
      attack.indexOf("export async function repostAttackAfterReroll"),
      attack.indexOf("async function postAttackCard")
    );
    assert.match(fn, /if \(flags\?\.type !== "attack"\) return false;/,
      "a skill check would be rebuilt as an attack");
    assert.match(fn, /if \(!weapon && !attack\) return false;/,
      "a weapon or statblock row deleted between roll and reroll would render " +
      "a card with no name and no damage");
  });

  test("the chat handler actually calls it", () => {
    assert.match(chat, /await repostAttackAfterReroll\(actor, flags, result\.keptRoll\);/,
      "the rebuild exists and nothing invokes it — the exact defect shape " +
      "this project produces most");
  });
});
