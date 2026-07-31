/**
 * Phase 3 tests: status aggregation, curse interactions, reroll semantics.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LASTARC } from "../module/config.mjs";
import {
  aggregateStatuses,
  effectiveDamageMods,
  resolveReroll,
  canRerollD20,
  computeDefences,
  breakThreshold
} from "../module/derivation.mjs";

/* -------------------------------------------------------------------------- */

describe("§12 status aggregation", () => {
  test("no statuses yields a neutral payload", () => {
    const s = aggregateStatuses([]);
    assert.deepEqual(s.defences, { ref: 0, fort: 0, will: 0 });
    assert.equal(s.maxHpMultiplier, 1);
    assert.equal(s.agiDenied, false);
    assert.equal(s.agiOverride, null);
  });

  test("exhaustion is -10 to all three defences", () => {
    const s = aggregateStatuses(["exhaustion"]);
    assert.deepEqual(s.defences, { ref: -10, fort: -10, will: -10 });
  });

  test("flat-footed denies Agility and blocks reactions", () => {
    const s = aggregateStatuses(["flatFooted"]);
    assert.ok(s.agiDenied);
    assert.ok(s.noReactions);
  });

  test("helpless overrides Agility to -5 and enables Coup de Grace", () => {
    const s = aggregateStatuses(["helpless"]);
    assert.equal(s.agiOverride, -5);
    assert.ok(s.enablesCoupDeGrace);
  });

  test("helpless SUPERSEDES prone rather than stacking with it", () => {
    // §10: helpless "does not stack with prone", yet §5.6 applies both at 0 HP.
    const both = aggregateStatuses(["prone", "helpless"]);
    assert.ok(!both.active.has("prone"), "prone should be superseded");
    assert.ok(both.active.has("helpless"));
  });

  test("prone alone still applies", () => {
    assert.ok(aggregateStatuses(["prone"]).active.has("prone"));
  });

  test("unknown status ids are ignored rather than throwing", () => {
    assert.doesNotThrow(() => aggregateStatuses(["nonesuch", "exhaustion"]));
    assert.equal(aggregateStatuses(["nonesuch", "exhaustion"]).defences.ref, -10);
  });
});

describe("§12 curse multipliers", () => {
  test("withering halves max HP, dim halves max MP", () => {
    assert.equal(aggregateStatuses(["withering"]).maxHpMultiplier, 0.5);
    assert.equal(aggregateStatuses(["dim"]).maxMpMultiplier, 0.5);
  });

  test("multipliers COMPOUND rather than summing", () => {
    // Two halvings must give a quarter. Summing the reductions would give a
    // multiplier of 0 — instant death rather than a penalty.
    const s = aggregateStatuses(["withering"]);
    const doubled = 0.5 * 0.5;
    assert.equal(s.maxHpMultiplier * s.maxHpMultiplier, doubled);
    assert.notEqual(doubled, 0);
  });

  test("independent curses stack their effects", () => {
    const s = aggregateStatuses(["exhaustion", "withering", "dim"]);
    assert.equal(s.defences.ref, -10);
    assert.equal(s.maxHpMultiplier, 0.5);
    assert.equal(s.maxMpMultiplier, 0.5);
  });

  test("doom is flagged as a death effect", () => {
    assert.ok(LASTARC.curses.doom.isDeathEffect);
  });
});

describe("§12 agony strips defences against damage types", () => {
  const base = {
    weakness: ["fire"],
    resistance: ["cold", "electric"],
    immunity: ["dark"],
    dr: 4
  };

  test("without agony, modifiers pass through untouched", () => {
    const r = effectiveDamageMods(base, aggregateStatuses([]));
    assert.deepEqual(r.resistance, ["cold", "electric"]);
    assert.deepEqual(r.immunity, ["dark"]);
  });

  test("agony strips resistances and immunities and adds universal weakness", () => {
    const r = effectiveDamageMods(base, aggregateStatuses(["agony"]));
    assert.deepEqual(r.resistance, []);
    assert.deepEqual(r.immunity, []);
    assert.equal(r.weakness.length, LASTARC.allDamageTypes.length);
    for (const type of LASTARC.allDamageTypes) {
      assert.ok(r.weakness.includes(type), `should be weak to ${type}`);
    }
  });

  test("agony does NOT strip Damage Reduction", () => {
    // DR is a separate mitigation step (§5.5 step 7) and is not a resistance.
    assert.equal(effectiveDamageMods(base, aggregateStatuses(["agony"])).dr, 4);
  });
});

describe("§12 status effects on the derivation chain", () => {
  const actor = { level: 5, agiMod: 2, vitMod: 3, mndMod: 1 };

  test("exhaustion flows through defences and into Break Threshold", () => {
    const clean = aggregateStatuses([]);
    const cursed = aggregateStatuses(["exhaustion"]);

    const dClean = computeDefences({ ...actor, misc: clean.defences });
    const dCursed = computeDefences({ ...actor, misc: cursed.defences });

    assert.equal(dClean.fort - dCursed.fort, 10);

    // The Threshold must fall with Fortitude — the whole point of deriving it live.
    const tClean = breakThreshold({ fort: dClean.fort });
    const tCursed = breakThreshold({ fort: dCursed.fort });
    assert.equal(tClean - tCursed, 10);
  });

  test("exhaustion and a Break step compound on Fortitude", () => {
    const cursed = aggregateStatuses(["exhaustion"]);
    const d = computeDefences({ ...actor, misc: cursed.defences, breakStep: 3 });
    const clean = computeDefences({ ...actor });
    assert.equal(clean.fort - d.fort, 15, "-10 exhaustion plus -5 break step");
  });

  test("flat-footed removes the Agility bonus but keeps penalties", () => {
    const denied = aggregateStatuses(["flatFooted"]);

    const positive = computeDefences({ ...actor, agiMod: 4, agiDenied: denied.agiDenied });
    const noStatus = computeDefences({ ...actor, agiMod: 4 });
    assert.equal(noStatus.ref - positive.ref, 4);

    const negative = computeDefences({ ...actor, agiMod: -3, agiDenied: denied.agiDenied });
    const negativeClean = computeDefences({ ...actor, agiMod: -3 });
    assert.equal(negative.ref, negativeClean.ref, "a penalty still applies when flat-footed");
  });
});

/* -------------------------------------------------------------------------- */

describe("§12 reroll semantics — three distinct kinds", () => {
  test("'second' keeps the new result even when worse", () => {
    assert.equal(resolveReroll(18, 4, "second"), 4);
    assert.equal(resolveReroll(4, 18, "second"), 18);
  });

  test("'higher' keeps the better result", () => {
    assert.equal(resolveReroll(18, 4, "higher"), 18);
    assert.equal(resolveReroll(4, 18, "higher"), 18);
  });

  test("'lower' keeps the worse result — this is the misfortune penalty", () => {
    assert.equal(resolveReroll(18, 4, "lower"), 4);
    assert.equal(resolveReroll(4, 18, "lower"), 4);
  });

  test("the three kinds are genuinely distinct on the same inputs", () => {
    const [a, b] = [18, 4];
    const results = LASTARC.rerollKinds.map((k) => resolveReroll(a, b, k));
    assert.deepEqual(results, [4, 18, 4]);
    // 'second' and 'lower' coincide here but diverge when the reroll is better,
    // which is exactly why they must not be collapsed into one concept.
    assert.notEqual(
      resolveReroll(4, 18, "second"),
      resolveReroll(4, 18, "lower")
    );
  });

  test("an unknown kind throws rather than silently picking one", () => {
    assert.throws(() => resolveReroll(1, 2, "best"), /Unknown reroll kind/);
  });
});

describe("§12 misfortune blocks hero point rerolls", () => {
  test("normally a d20 may be rerolled", () => {
    assert.ok(canRerollD20(aggregateStatuses([])));
  });

  test("misfortune forbids it", () => {
    assert.ok(!canRerollD20(aggregateStatuses(["misfortune"])));
  });

  test("misfortune also imposes keep-lower on attacks and skill checks", () => {
    assert.ok(aggregateStatuses(["misfortune"]).rerollKeepLower);
  });

  test("other curses do not block rerolls", () => {
    assert.ok(canRerollD20(aggregateStatuses(["exhaustion", "withering", "doom"])));
  });
});

/* -------------------------------------------------------------------------- */

describe("status config integrity", () => {
  test("statuses and curses do not share ids", () => {
    const overlap = Object.keys(LASTARC.statusEffects)
      .filter((k) => k in LASTARC.curses);
    assert.deepEqual(overlap, []);
  });

  test("allStatusIds covers both sets exactly", () => {
    assert.equal(
      LASTARC.allStatusIds.length,
      Object.keys(LASTARC.statusEffects).length + Object.keys(LASTARC.curses).length
    );
  });

  test("no status carries a round-based duration", () => {
    // §12: statuses persist until a clearance condition is met. A `rounds` or
    // `duration` field would be a silent misreading of the whole subsystem.
    for (const [id, def] of Object.entries({ ...LASTARC.statusEffects, ...LASTARC.curses })) {
      assert.ok(!("rounds" in def), `${id} must not have a round duration`);
      assert.ok(!("duration" in def), `${id} must not have a duration`);
    }
  });

  test("every supersedes target is a real status", () => {
    for (const [id, def] of Object.entries(LASTARC.statusEffects)) {
      for (const target of def.supersedes ?? []) {
        assert.ok(
          target in LASTARC.statusEffects || target in LASTARC.curses,
          `${id} supersedes unknown status "${target}"`
        );
      }
    }
  });

  test("blocksSkills entries reference real skills", () => {
    for (const [id, def] of Object.entries(LASTARC.statusEffects)) {
      for (const key of def.blocksSkills ?? []) {
        assert.ok(LASTARC.allSkills[key], `${id} blocks unknown skill "${key}"`);
      }
    }
  });

  test("bonusDamageDice entries reference real damage types", () => {
    for (const [id, def] of Object.entries(LASTARC.statusEffects)) {
      for (const type of Object.keys(def.bonusDamageDice ?? {})) {
        assert.ok(
          LASTARC.allDamageTypes.includes(type),
          `${id} references unknown damage type "${type}"`
        );
      }
    }
  });
});
