/**
 * Effects that run out, damage reduction that can be granted, and fighting
 * defensively (#86, #88).
 *
 * The three issues are one gap. FOUNDRY DOES NOT STOP APPLYING AN EXPIRED
 * EFFECT — it counts the duration down, reports `remaining: 0`, and goes on
 * adding the bonus. Verified on a live actor before any of this was written: a
 * one-round +5 to Reflex was still there in round 3. So the rounds box on the
 * Add Effect dialog had been decorative since it shipped, and every temporary
 * buff in every world using this system was permanent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { fightDefensivelyBonus } from "../module/derivation.mjs";
import {
  effectsToExpire, scopeTargets, drTarget, supportedTargetPaths, customEffectTargets
} from "../module/effects.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const fx = (o) => ({ id: "e1", disabled: false, remaining: null, autoExpired: false, ...o });

describe("§ what has run out", () => {
  test("a finished duration is picked up", () => {
    assert.deepEqual(effectsToExpire([fx({ remaining: 0 })]), ["e1"]);
    assert.deepEqual(effectsToExpire([fx({ remaining: -1 })]), ["e1"]);
  });

  test("one still running is left alone", () => {
    assert.deepEqual(effectsToExpire([fx({ remaining: 1 })]), []);
  });

  /** No duration is not an expired duration — most effects last until removed. */
  test("an effect with no duration is never expired", () => {
    assert.deepEqual(effectsToExpire([fx({ remaining: null })]), []);
    assert.deepEqual(effectsToExpire([fx({ remaining: undefined })]), []);
  });

  test("one already switched off is not switched off again", () => {
    assert.deepEqual(effectsToExpire([fx({ remaining: 0, disabled: true })]), []);
  });

  /**
   * A GM who switches an expired effect back on — because the table ruled the
   * spell lasts — must not have it switched off again at the next boundary,
   * for as long as they keep trying.
   */
  test("one this system already expired is left to the GM", () => {
    assert.deepEqual(effectsToExpire([fx({ remaining: 0, autoExpired: true })]), []);
  });

  test("it reports every expired effect, not just the first", () => {
    assert.deepEqual(
      effectsToExpire([fx({ id: "a", remaining: 0 }), fx({ id: "b", remaining: 1 }),
                       fx({ id: "c", remaining: 0 })]),
      ["a", "c"]);
  });

  test("nothing at all is not an error", () => {
    assert.deepEqual(effectsToExpire([]), []);
    assert.deepEqual(effectsToExpire(), []);
    assert.deepEqual(effectsToExpire([null, undefined]), []);
  });
});

describe("§ damage reduction can be granted (#88)", () => {
  /**
   * A character's `dr` is DERIVED — armour plus grants — so an effect written
   * there is overwritten on the next prepare. A statblock's is a printed number
   * nobody derives, so it takes the effect directly.
   */
  test("the slot depends on which model is being buffed", () => {
    assert.equal(drTarget("character"), "system.damageMods.drMisc");
    assert.equal(drTarget("npc"), "system.damageMods.dr");
  });

  test("the scope resolves to that slot on both", () => {
    assert.deepEqual(scopeTargets("dr", "character").paths, ["system.damageMods.drMisc"]);
    assert.deepEqual(scopeTargets("dr", "npc").paths, ["system.damageMods.dr"]);
  });

  test("it is offered in the picker for both", () => {
    for (const type of ["character", "npc"]) {
      assert.ok(customEffectTargets(type).some((r) => r.scope === "dr"),
        `${type} cannot be granted temporary damage reduction`);
    }
  });

  /** The whitelist is what stops an effect being written where it is erased. */
  test("a character's derived dr is still refused", () => {
    assert.ok(!supportedTargetPaths("character").has("system.damageMods.dr"),
      "an effect on the derived total would vanish on the next prepare");
    assert.ok(supportedTargetPaths("character").has("system.damageMods.drMisc"));
  });

  test("the derivation actually reads the slot", () => {
    assert.match(read("module/data/character.mjs"),
      /damageMods\.dr = Math\.max\(0, armour\.dr \+ grants\.dr \+ this\.damageMods\.drMisc\)/,
      "the slot exists and nothing adds it, which is a box that does nothing");
  });
});

describe("§ fighting defensively (#86)", () => {
  const cfg = LASTARC.fightDefensively;

  test("the book's four numbers", () => {
    assert.equal(fightDefensivelyBonus({}).ref, 2);
    assert.equal(fightDefensivelyBonus({ noAttacks: true }).ref, 5);
    assert.equal(fightDefensivelyBonus({ acrobatics: true }).ref, 5);
    assert.equal(fightDefensivelyBonus({ noAttacks: true, acrobatics: true }).ref, 10);
  });

  test("attacking on costs every attack roll", () => {
    assert.equal(fightDefensivelyBonus({}).attackPenalty, cfg.attackPenalty);
    assert.equal(fightDefensivelyBonus({ acrobatics: true }).attackPenalty, cfg.attackPenalty);
  });

  /**
   * ZERO, not −5. There are no attacks left for it to apply to, and reporting
   * one would put a line on a card for a roll the character has given up.
   */
  test("electing no attacks costs nothing, because there are none", () => {
    assert.equal(fightDefensivelyBonus({ noAttacks: true }).attackPenalty, 0);
    assert.equal(fightDefensivelyBonus({ noAttacks: true, acrobatics: true }).attackPenalty, 0);
  });

  test("the numbers come from the config, not from the function", () => {
    assert.equal(fightDefensivelyBonus({}).ref, cfg.ref.untrained);
    assert.equal(fightDefensivelyBonus({ noAttacks: true, acrobatics: true }).ref,
      cfg.refNoAttacks.trained);
  });
});

describe("§ the wiring the maths cannot hold", () => {
  const combat = read("module/combat.mjs");
  const fd = read("module/fight-defensively.mjs");
  const attack = read("module/dice/attack.mjs");

  test("the lifecycle switches expired effects off", () => {
    // The CALL, not the definition. Without `await` this matched the function's
    // own signature, so deleting the call left the guard green — Quench caught
    // it and this did not, which is the wrong way round for a source guard.
    assert.match(combat, /await expireFinishedEffects\(combat\);/,
      "nothing expires anything, so every duration is decorative");
    assert.match(combat, /EFFECTS\.effectsToExpire\(/);
    assert.match(combat, /disabled: true/,
      "an expired effect is deleted rather than disabled, taking its wording " +
      "and the GM's chance to overrule with it");
  });

  /** Expiry disables; a disabled effect must not still grant the election. */
  test("a disabled election is not in force", () => {
    assert.match(fd, /!e\.disabled && e\.getFlag\?\.\(SYSTEM_ID, FLAG\)/,
      "an expired Fight Defensively would keep paying out for the rest of combat");
  });

  test("the attack pipeline itemises the penalty", () => {
    assert.match(attack, /add\("LASTARC\.Mod\.fightDefensively", fightDefensively\)/,
      "the penalty is applied invisibly, or not at all");
    assert.match(attack, /fightDefensively: FD\.attackPenalty\(actor\)/,
      "the profile never asks whether the character is fighting defensively");
  });

  /** The book exempts opposed rolls made to block or parry. */
  test("an opposed roll is exempt", () => {
    assert.match(fd, /if \(!election \|\| opposed\) return 0;/,
      "blocking and parrying are being charged a penalty the book exempts");
  });

  test("pressing the election already in force clears it", () => {
    assert.match(fd, /if \(election\.noAttacks === noAttacks\) return null;/,
      "the button cannot be un-pressed, which every other toggle here can");
  });
});
