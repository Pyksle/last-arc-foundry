/**
 * Unit tests for the casting resolver (§18).
 *
 * The single most important property under test is a NEGATIVE one: a spell must
 * never acquire attack mechanics. The book is explicit that spells are not
 * attacks and are unaffected by anything that interacts with attacks, and the
 * natural way to build casting — reuse `resolveAttack` — violates that on the
 * first line.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LASTARC } from "../module/config.mjs";
import {
  knownSpellLimit,
  manaCost,
  defensiveCastingPenalty,
  selectOutcome,
  resolveOpposed,
  decayTicks,
  counterattackDisruptsCasting,
  defensivePerformPenalty,
  performancesDisplacedBy
} from "../module/dice/magic.mjs";

describe("§18.1 known spells", () => {
  test("known spells is 1 + Int modifier", () => {
    assert.equal(knownSpellLimit(0), 1);
    assert.equal(knownSpellLimit(3), 4);
  });

  test("a punishing Int floors at zero rather than going negative", () => {
    assert.equal(knownSpellLimit(-3), 0);
  });
});

describe("§18.5 mana cost and High Arcana", () => {
  test("a plain casting costs its printed MP", () => {
    assert.equal(manaCost(6), 6);
  });

  test("High Arcana doubles the cost", () => {
    assert.equal(manaCost(6, { highArcana: "distant" }), 12);
  });

  /**
   * The book states the order explicitly. Reducing first would make a −2 item
   * worth −4 on an enhanced spell, which is precisely what the rule forbids.
   */
  test("reduction applies AFTER the doubling, not before", () => {
    assert.equal(manaCost(6, { highArcana: "distant", reduction: 2 }), 10);
    assert.notEqual(manaCost(6, { highArcana: "distant", reduction: 2 }), 8);
  });

  test("cost never goes negative", () => {
    assert.equal(manaCost(2, { reduction: 99 }), 0);
  });
});

describe("§18.4 casting defensively", () => {
  test("the penalty is per threatening creature, not a flat −5", () => {
    assert.equal(defensiveCastingPenalty(1), -5);
    assert.equal(defensiveCastingPenalty(3), -15);
  });

  test("no threats, no penalty", () => {
    assert.equal(defensiveCastingPenalty(0), 0);
  });

  test("Combat Casting collapses multiple threats to a single −5", () => {
    assert.equal(defensiveCastingPenalty(4, { combatCasting: true }), -5);
  });

  test("a counterattack beating Break Threshold destroys the casting", () => {
    assert.equal(counterattackDisruptsCasting(20, 19), true);
    assert.equal(counterattackDisruptsCasting(19, 19), false, "must BEAT it");
  });
});

describe("§18.6 outcome selection", () => {
  const tiered = [
    { dc: 15, damage: "2d6" },
    { dc: 20, damage: "3d6" },
    { dc: 25, damage: "4d6" },
    { dc: 30, damage: "5d6" }
  ];

  test("picks the highest tier the check reached", () => {
    assert.equal(selectOutcome(tiered, 27).damage, "4d6");
  });

  test("meet it, beat it — exactly the DC achieves that tier", () => {
    assert.equal(selectOutcome(tiered, 25).damage, "4d6");
  });

  test("below the lowest DC achieves nothing — the book's 'if any'", () => {
    assert.equal(selectOutcome(tiered, 14), null);
  });

  test("a check far above the top tier does not overshoot past it", () => {
    assert.equal(selectOutcome(tiered, 99).damage, "5d6");
  });

  test("an untiered row applies regardless of the roll", () => {
    const opposed = [{ dc: null, opposedDefence: "fort", status: "silence" }];
    assert.equal(selectOutcome(opposed, 3).status, "silence");
  });

  test("no outcomes at all yields null rather than throwing", () => {
    assert.equal(selectOutcome([], 20), null);
  });
});

describe("§18.7 higher-level target bonus", () => {
  const row = { dc: null, opposedDefence: "fort" };
  const ctx = (targetLevel, casterLevel = 5) => ({
    checkTotal: 20,
    targetDefences: { fort: 18 },
    casterLevel,
    targetLevel,
    higherLevelTargetBonus: 5
  });

  test("a higher-level target gets the +5 to its defence", () => {
    const r = resolveOpposed(row, ctx(9));
    assert.equal(r.bonusApplied, 5);
    assert.equal(r.defence, 23);
    assert.equal(r.beat, false, "20 no longer reaches 23");
  });

  test("an equal-level target gets nothing — it must be HIGHER", () => {
    const r = resolveOpposed(row, ctx(5));
    assert.equal(r.bonusApplied, 0);
    assert.equal(r.defence, 18);
    assert.equal(r.beat, true);
  });

  test("a lower-level target gets nothing", () => {
    assert.equal(resolveOpposed(row, ctx(2)).bonusApplied, 0);
  });

  test("a row with no opposed defence is not an opposed check at all", () => {
    const r = resolveOpposed({ dc: 20 }, ctx(9));
    assert.equal(r.opposed, false);
    assert.equal(r.beat, true, "nothing to beat, so it lands");
  });
});

describe("§18.7 damage over time", () => {
  test("ticks are fractions of the INITIAL damage, not of the previous tick", () => {
    assert.deepEqual(decayTicks(20, [0.5, 0.25]), [
      { turnsAhead: 1, amount: 10 },
      { turnsAhead: 2, amount: 5 }
    ]);
  });

  test("each tick floors", () => {
    assert.deepEqual(decayTicks(7, [0.5]), [{ turnsAhead: 1, amount: 3 }]);
  });

  test("no schedule means no ticks", () => {
    assert.deepEqual(decayTicks(20, []), []);
  });
});

describe("spells are NOT attacks", () => {
  /**
   * REGRESSION GUARD for the chapter's defining constraint. The obvious
   * implementation reuses the attack pipeline, which would silently grant
   * spells natural-20 Combos, Criticals, and every attack technick flag —
   * including doubledExplosions, which would roughly double spell damage.
   */
  test("the casting module does not import the attack resolver", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(new URL("../module/dice/magic.mjs", import.meta.url), "utf8");
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    assert.doesNotMatch(src, /\bresolveAttack\b/,
      "casting must not resolve through the attack pipeline");
    assert.doesNotMatch(src, /\battackModifiers\b/,
      "attack modifiers must not apply to spells");
    assert.doesNotMatch(src, /\bbuildDamageTerms\b/,
      "spell damage is the printed dice, with no Strength or half-level term");

    // applyDamage is the ONE legitimate shared function: mitigation and the
    // Break Threshold belong to the damage, not to how it was caused.
    assert.match(src, /applyDamage/,
      "spell damage must still respect DR, resistances and Break Threshold");
  });

  test("no attack technick flag is consulted when casting", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(new URL("../module/dice/magic.mjs", import.meta.url), "utf8");

    // Strip comments first. The file's own docblock names these flags in order
    // to explain why they must NOT be used, and scanning raw source would flag
    // the explanation as the violation.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const flag of ["tripleCrit", "doubledExplosions", "weaponFinesse", "preciseShot"]) {
      assert.doesNotMatch(src, new RegExp(`["'\`]${flag}["'\`]`),
        `${flag} interacts with attacks and must not reach a spell`);
    }
  });

  test("explosion and crit multipliers are pinned to 1 at the call site", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../module/dice/magic.mjs", import.meta.url), "utf8");
    assert.match(src, /critMultiplier:\s*1/);
    assert.match(src, /explosionMultiplier:\s*1/);
  });
});

describe("§18.5 config corrections", () => {
  test("there are five schools, and High Arcana is not one of them", () => {
    assert.equal(LASTARC.spellSchools.length, 5);
    assert.deepEqual(LASTARC.spellSchools, ["black", "blue", "green", "red", "white"]);
    assert.ok(!LASTARC.spellSchools.includes("highArcana"));
  });

  test("High Arcana are modelled separately as metamagic", () => {
    assert.equal(LASTARC.highArcanaIds.length, 6);
    for (const id of ["adamant", "distant", "enlarged", "intensified", "lingering", "multi"]) {
      assert.ok(LASTARC.highArcana[id], `missing High Arcana: ${id}`);
    }
  });

  test("every casting time maps to a real action slot", () => {
    for (const [key, cfg] of Object.entries(LASTARC.castingTimes)) {
      assert.ok(cfg.slot, `${key} has no slot`);
    }
  });

  test("statuses referenced by Chapter 8 spells all exist", () => {
    // An unregistered id throws at toggle time — the `unconscious` bug again.
    for (const id of ["zombified", "slowed", "incorporeal", "charmed",
                      "silence", "petrify", "blind", "paralysis", "disease"]) {
      assert.ok(LASTARC.allStatusIds.includes(id), `spell status not registered: ${id}`);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("§19 performances", () => {
  test("the defensive penalty depends on specialisation, not a flat −5", () => {
    // Assuming symmetry with casting would overcharge a dancer by more than
    // double, which is the whole reason specialisation is a mechanical field.
    assert.equal(defensivePerformPenalty(1, "instrument"), -5);
    assert.equal(defensivePerformPenalty(1, "dance"), -2);
    assert.equal(defensivePerformPenalty(1, "oratory"), -2);
  });

  test("it is per threatening creature, like casting", () => {
    assert.equal(defensivePerformPenalty(3, "instrument"), -15);
    assert.equal(defensivePerformPenalty(3, "dance"), -6);
  });

  test("no threats, no penalty", () => {
    assert.equal(defensivePerformPenalty(0, "instrument"), 0);
  });

  /**
   * A creature carries at most ONE allied and ONE enemy performance, and a new
   * one displaces only its own side. Modelling this as a single slot would
   * cancel an enemy's debuff every time an ally played — a large, invisible
   * buff to the party.
   */
  test("an allied performance displaces only the previous ALLIED one", () => {
    const active = [
      { id: "ally-song", fromAlly: true },
      { id: "enemy-dirge", fromAlly: false }
    ];
    assert.deepEqual(performancesDisplacedBy(active, true), ["ally-song"]);
  });

  test("an enemy performance displaces only the previous ENEMY one", () => {
    const active = [
      { id: "ally-song", fromAlly: true },
      { id: "enemy-dirge", fromAlly: false }
    ];
    assert.deepEqual(performancesDisplacedBy(active, false), ["enemy-dirge"]);
  });

  test("both sides can be active at once", () => {
    const active = [{ id: "ally-song", fromAlly: true }];
    assert.deepEqual(performancesDisplacedBy(active, false), [],
      "an enemy performance must not cancel an allied one");
  });

  test("performances have no mana cost in the schema", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../module/data/items.mjs", import.meta.url), "utf8");
    const block = src
      .slice(src.indexOf("class LastArcPerformanceData"), src.indexOf("class LastArcRaceData"))
      // Comments stripped: the docblock explains why there is no mpCost, and
      // scanning raw source matches the explanation as the violation. Third
      // time this has bitten — see also the two scans in magic.test.mjs above.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    assert.doesNotMatch(block, /mpCost/,
      "Chapter 9 never mentions MP and no performance name carries a cost");
  });

  test("performing provokes, and performing defensively does not", () => {
    assert.equal(LASTARC.performSpecialisations.instrument.defensivePenalty, -5);
    assert.equal(LASTARC.performSpecialisations.dance.defensivePenalty, -2);
  });
});
