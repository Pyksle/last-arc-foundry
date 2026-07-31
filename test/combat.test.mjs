/**
 * Phase 2 tests: exploding dice, attack resolution, damage assembly.
 *
 * The exploding-dice tests use an injected RNG so the cascade, the doubled
 * variant, and the cap are all deterministic rather than statistical. Where a
 * statistical check IS the point (expected value), the sampled mean is compared
 * against the closed form rather than against numbers copied from the spec.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  explodeDice,
  explodingDieEV,
  parseDiceTerm
} from "../module/dice/explode.mjs";

import {
  resolveAttack,
  attackModifiers,
  buildDamageTerms,
  DUAL_WIELD_PENALTY
} from "../module/dice/attack.mjs";

/** RNG returning a scripted sequence, then repeating the final value. */
function scripted(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Deterministic PRNG (mulberry32) for statistical checks. */
function seeded(seed) {
  let a = seed >>> 0;
  return (faces) => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * faces) + 1;
  };
}

/* -------------------------------------------------------------------------- */

describe("§5.3 exploding dice — mechanics", () => {
  test("a non-max roll does not explode", () => {
    const r = explodeDice({ faces: 6, count: 1, rng: scripted([3]) });
    assert.equal(r.diceRolled, 1);
    assert.equal(r.total, 3);
    assert.equal(r.results[0].exploded, false);
  });

  test("a max roll spawns exactly one more die", () => {
    const r = explodeDice({ faces: 6, count: 1, rng: scripted([6, 2]) });
    assert.equal(r.diceRolled, 2);
    assert.equal(r.total, 8);
  });

  test("explosions cascade — an exploded die can explode again", () => {
    const r = explodeDice({ faces: 6, count: 1, rng: scripted([6, 6, 6, 1]) });
    assert.equal(r.diceRolled, 4);
    assert.equal(r.total, 19);
  });

  test("generation is tracked, so display can distinguish weapon dice from explosions", () => {
    const r = explodeDice({ faces: 6, count: 1, rng: scripted([6, 6, 1]) });
    assert.deepEqual(r.results.map((x) => x.generation), [0, 1, 2]);
  });

  test("every initial die can explode independently", () => {
    const r = explodeDice({ faces: 4, count: 3, rng: scripted([4, 4, 1, 2, 3]) });
    // Two of the three initial dice explode, spawning two more: 5 dice total.
    assert.equal(r.diceRolled, 5);
    assert.equal(r.total, 4 + 4 + 1 + 2 + 3);
  });

  test("DOUBLED variant spawns two dice per explosion, not one", () => {
    const normal = explodeDice({ faces: 6, count: 1, multiplier: 1, rng: scripted([6, 1]) });
    const doubled = explodeDice({ faces: 6, count: 1, multiplier: 2, rng: scripted([6, 1, 1]) });
    assert.equal(normal.diceRolled, 2);
    assert.equal(doubled.diceRolled, 3);
  });
});

describe("§5.3 exploding dice — the safety guard", () => {
  test("caps on TOTAL dice, not recursion depth", () => {
    // Every die rolls max forever. Without a cap this never terminates.
    const r = explodeDice({ faces: 6, count: 1, rng: () => 6, maxDice: 50 });
    assert.equal(r.capped, true);
    assert.equal(r.diceRolled, 50);
  });

  test("the doubled variant cannot exceed the cap either", () => {
    // k=2 with guaranteed explosions doubles every generation: 1,2,4,8,...
    // A DEPTH cap of 50 would permit 2^50 dice; a TOTAL cap holds at 50.
    const r = explodeDice({ faces: 6, count: 1, multiplier: 2, rng: () => 6, maxDice: 50 });
    assert.equal(r.capped, true);
    assert.equal(r.diceRolled, 50);
  });

  test("a d2 with k=2 is the critical case and must still terminate", () => {
    // Mean offspring is exactly 1.0 here — infinite expected duration. Nothing
    // in the demo produces this, but the guard must not depend on that.
    const r = explodeDice({ faces: 2, count: 1, multiplier: 2, rng: () => 2, maxDice: 200 });
    assert.equal(r.capped, true);
    assert.ok(r.diceRolled <= 200);
  });

  test("an ordinary roll is not flagged as capped", () => {
    const r = explodeDice({ faces: 6, count: 2, rng: scripted([3, 4]) });
    assert.equal(r.capped, false);
  });

  test("rejects nonsense die sizes rather than looping", () => {
    assert.throws(() => explodeDice({ faces: 1, count: 1, rng: () => 1 }), /faces/);
    assert.throws(() => explodeDice({ faces: 6, count: -1, rng: () => 1 }), /count/);
  });
});

describe("§5.3 exploding dice — expected values", () => {
  test("closed form matches the spec's table", () => {
    const round = (n) => Math.round(n * 100) / 100;
    assert.equal(round(explodingDieEV(4)), 3.33);
    assert.equal(round(explodingDieEV(6)), 4.2);
    assert.equal(round(explodingDieEV(8)), 5.14);
    assert.equal(round(explodingDieEV(12)), 7.09);

    assert.equal(round(explodingDieEV(4, 2)), 5);
    assert.equal(round(explodingDieEV(6, 2)), 5.25);
    assert.equal(round(explodingDieEV(8, 2)), 6);
    assert.equal(round(explodingDieEV(12, 2)), 7.8);
  });

  test("EV is infinite at and above the critical ratio", () => {
    assert.equal(explodingDieEV(2, 2), Infinity);
    assert.equal(explodingDieEV(4, 4), Infinity);
  });

  test("sampled mean converges on the closed form", () => {
    for (const [faces, multiplier] of [[6, 1], [8, 1], [6, 2]]) {
      const rng = seeded(12345 + faces * 7 + multiplier);
      const N = 20000;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += explodeDice({ faces, count: 1, multiplier, rng }).total;
      }
      const sampled = sum / N;
      const expected = explodingDieEV(faces, multiplier);
      assert.ok(
        Math.abs(sampled - expected) < expected * 0.05,
        `d${faces} k=${multiplier}: sampled ${sampled.toFixed(3)} vs expected ${expected.toFixed(3)}`
      );
    }
  });
});

describe("dice term parsing", () => {
  test("parses the usual shapes", () => {
    assert.deepEqual(parseDiceTerm("2d6"), { count: 2, faces: 6 });
    assert.deepEqual(parseDiceTerm("d8"), { count: 1, faces: 8 });
    assert.deepEqual(parseDiceTerm(" 10d12 "), { count: 10, faces: 12 });
  });

  test("returns null for anything that is not a bare dice term", () => {
    for (const bad of ["2d6+3", "", null, undefined, "sword", "1d6x"]) {
      assert.equal(parseDiceTerm(bad), null, `should reject: ${bad}`);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("§5.1 attack resolution", () => {
  const base = { total: 15, targetDefence: 18 };

  test("meet it, beat it", () => {
    assert.equal(resolveAttack({ natural: 10, total: 18, targetDefence: 18 }).hit, true);
    assert.equal(resolveAttack({ natural: 10, total: 17, targetDefence: 18 }).hit, false);
  });

  test("natural 20 hits regardless of the total", () => {
    const r = resolveAttack({ natural: 20, total: 3, targetDefence: 40 });
    assert.ok(r.hit);
    assert.ok(r.autoHit);
  });

  test("natural 1 misses regardless of the total", () => {
    const r = resolveAttack({ natural: 1, total: 99, targetDefence: 5 });
    assert.ok(!r.hit);
    assert.ok(r.autoMiss);
  });

  test("melee nat 20 grants a Combo; ranged nat 20 grants a Critical", () => {
    const melee = resolveAttack({ ...base, natural: 20, isMelee: true });
    assert.ok(melee.combo);
    assert.ok(!melee.critical);

    const ranged = resolveAttack({ ...base, natural: 20, isMelee: false });
    assert.ok(ranged.critical);
    assert.ok(!ranged.combo);
  });

  test("area attacks can neither crit nor combo", () => {
    const meleeArea = resolveAttack({ ...base, natural: 20, isMelee: true, isArea: true });
    const rangedArea = resolveAttack({ ...base, natural: 20, isMelee: false, isArea: true });
    assert.ok(!meleeArea.combo);
    assert.ok(!rangedArea.critical);
    assert.ok(meleeArea.hit, "still an auto-hit, just without the rider");
  });

  test("a charge cannot combo", () => {
    const r = resolveAttack({ ...base, natural: 20, isMelee: true, isCharge: true });
    assert.ok(!r.combo);
    assert.ok(r.hit);
  });

  test("REGRESSION: an auto-hit leaves the reaction window OPEN", () => {
    // Block and Dodge are opposed reactions, not defence comparisons, so a
    // natural 20 must not short-circuit them.
    const r = resolveAttack({ ...base, natural: 20 });
    assert.equal(r.reactionWindowOpen, true);
  });

  test("a miss closes the reaction window", () => {
    assert.equal(resolveAttack({ natural: 5, total: 8, targetDefence: 20 }).reactionWindowOpen, false);
  });
});

describe("§5.1 attack modifiers", () => {
  test("non-proficiency costs 5", () => {
    const a = attackModifiers({ skillMod: 7, proficient: true });
    const b = attackModifiers({ skillMod: 7, proficient: false });
    assert.equal(a.total - b.total, 5);
  });

  test("Dual Wield ranks reduce the two-weapon penalty to -10/-5/-2/0", () => {
    const at = (rank) => attackModifiers({ twoWeapon: true, dualWieldRank: rank }).total;
    assert.deepEqual([at(0), at(1), at(2), at(3)], DUAL_WIELD_PENALTY);
  });

  test("a rank beyond the table does not overflow", () => {
    assert.equal(attackModifiers({ twoWeapon: true, dualWieldRank: 99 }).total, 0);
  });

  test("flanking is melee-only and high ground is ranged-only", () => {
    assert.equal(attackModifiers({ flanking: true, isMelee: true }).total, 2);
    assert.equal(attackModifiers({ flanking: true, isMelee: false }).total, 0);
    assert.equal(attackModifiers({ highGround: true, isMelee: false }).total, 2);
    assert.equal(attackModifiers({ highGround: true, isMelee: true }).total, 0);
  });

  test("Precise Shot negates the shooting-into-melee penalty entirely", () => {
    assert.equal(attackModifiers({ shootingIntoMelee: true, isMelee: false }).total, -5);
    assert.equal(
      attackModifiers({ shootingIntoMelee: true, preciseShot: true, isMelee: false }).total, 0
    );
  });

  test("prone helps melee attackers and hinders ranged ones", () => {
    assert.equal(attackModifiers({ targetProne: true, isMelee: true }).total, 5);
    assert.equal(attackModifiers({ targetProne: true, isMelee: false }).total, -5);
  });

  test("modifiers are itemised for display, not just summed", () => {
    const r = attackModifiers({ skillMod: 7, proficient: false, flanking: true });
    assert.equal(r.total, 4);
    assert.equal(r.parts.length, 3);
    assert.ok(r.parts.every((p) => p.label && typeof p.value === "number"));
  });

  test("zero-valued modifiers are omitted from the breakdown", () => {
    assert.equal(attackModifiers({ skillMod: 0, situational: 0 }).parts.length, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("§5.2 damage assembly", () => {
  const base = { level: 7, strMod: 3, agiMod: 4 };

  test("melee adds half level and Strength", () => {
    const r = buildDamageTerms({ ...base, wieldCategory: "oneHanded" });
    assert.equal(r.flat, 3 + 3);        // half of 7 is 3, plus Str 3
    assert.equal(r.attribute, "str");
  });

  test("a derived two-handed wield doubles Strength", () => {
    const r = buildDamageTerms({ ...base, wieldCategory: "twoHanded" });
    assert.equal(r.flat, 3 + 6);
  });

  test("a one-handed weapon does NOT double Str just by being held in two hands", () => {
    // There is no grip parameter by design — the multiplier keys off the
    // derived wield category only.
    const oneHanded = buildDamageTerms({ ...base, wieldCategory: "oneHanded" });
    const light = buildDamageTerms({ ...base, wieldCategory: "light" });
    assert.equal(oneHanded.flat, 6);
    assert.equal(light.flat, 6);
  });

  test("ranged attacks get NO attribute modifier", () => {
    const r = buildDamageTerms({ ...base, isRanged: true });
    assert.equal(r.flat, 3);            // half level only
    assert.equal(r.attribute, null);
  });

  test("thrown weapons DO get the attribute despite being ranged", () => {
    const r = buildDamageTerms({ ...base, isRanged: true, isThrown: true, wieldCategory: "light" });
    assert.equal(r.attribute, "str");
    assert.equal(r.flat, 3 + 3);
  });

  test("Weapon Finesse substitutes Agility on eligible weapons only", () => {
    const lightFinesse = buildDamageTerms({
      ...base, wieldCategory: "light", weaponFinesse: true
    });
    assert.equal(lightFinesse.attribute, "agi");
    assert.equal(lightFinesse.flat, 3 + 4);

    // A one-handed weapon is not finesse-eligible.
    const oneHandedFinesse = buildDamageTerms({
      ...base, wieldCategory: "oneHanded", weaponFinesse: true
    });
    assert.equal(oneHandedFinesse.attribute, "str");
  });

  test("Finesse applies to thrown weapons regardless of wield category", () => {
    const r = buildDamageTerms({
      ...base, wieldCategory: "oneHanded", isThrown: true, weaponFinesse: true
    });
    assert.equal(r.attribute, "agi");
  });

  test("a broken weapon reduces damage", () => {
    const intact = buildDamageTerms({ ...base, wieldCategory: "oneHanded" });
    const broken = buildDamageTerms({ ...base, wieldCategory: "oneHanded", breakPenalty: -5 });
    assert.equal(intact.flat - broken.flat, 5);
  });

  test("terms are itemised for the chat card", () => {
    const r = buildDamageTerms({ ...base, wieldCategory: "twoHanded", damageBonus: 2 });
    assert.ok(r.parts.length >= 3);
    assert.equal(r.flat, r.parts.reduce((s, p) => s + p.value, 0));
  });
});
