/**
 * Toad, helpless, and the three payload keys that carried them (#46).
 *
 * `agiOverride`, `noEquipmentBenefit` and `treatedAsSize` were declared,
 * aggregated, and read by nothing. The GM's ruling on #46 gave the formula
 * they were always meant to produce:
 *
 *     Reflex under Toad = 7 + Character Level + Class Bonus + Technicks
 *
 * which is base 10, Agi treated as −5, the toad's own Tiny +2, and no armour.
 * The formula is asserted directly below rather than being re-derived here —
 * a test that recomputes the implementation's arithmetic proves only that the
 * implementation equals itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  aggregateStatuses,
  computeDefences,
  applyAgiOverride,
  printedRefWithAgiOverride,
  printedReflex,
  effectiveSize
} from "../module/derivation.mjs";

describe("§12 toad rebuilds Reflex rather than penalising it", () => {
  /** A character who is armoured, agile and Large — so every removed term is
   *  non-zero and a term left in by mistake shows up as a wrong number. */
  const actor = {
    level: 6,
    agiMod: 4,
    vitMod: 2,
    mndMod: 3,
    classBonus: { ref: 3, fort: 2, will: 1 },
    armour: { refBonus: 5, maxAgiBonus: 2 },
    sizeMod: LASTARC.sizes.large.mod,
    technicks: { ref: 2, fort: 0, will: 0 }
  };

  const toad = aggregateStatuses(["toad"]);

  test("the GM's formula, to the number", () => {
    const size = effectiveSize("large", toad.treatedAsSize);
    const d = computeDefences({
      ...actor,
      sizeMod: LASTARC.sizes[size].mod,
      misc: toad.defences,
      agiOverride: toad.agiOverride,
      noEquipmentBenefit: toad.noEquipmentBenefit
    });

    // 7 + level + class bonus + technicks. Nothing else.
    assert.equal(d.ref, 7 + actor.level + actor.classBonus.ref + actor.technicks.ref);
    assert.equal(d.ref, 7 + 6 + 3 + 2);
  });

  test("Agility, armour and the character's own size are all gone", () => {
    const size = effectiveSize("large", toad.treatedAsSize);
    const args = {
      ...actor,
      sizeMod: LASTARC.sizes[size].mod,
      misc: toad.defences,
      agiOverride: toad.agiOverride,
      noEquipmentBenefit: toad.noEquipmentBenefit
    };
    const base = computeDefences(args).ref;

    // Change each removed input and demand the answer does not move.
    assert.equal(computeDefences({ ...args, agiMod: -3 }).ref, base, "Agility still reaching Reflex");
    assert.equal(
      computeDefences({ ...args, armour: { refBonus: 99, maxAgiBonus: 0 } }).ref, base,
      "armour still reaching Reflex"
    );
  });

  test("Fortitude and Will take a flat −10, which Reflex must NOT also take", () => {
    const clean = computeDefences({ ...actor, misc: { ref: 0, fort: 0, will: 0 } });
    const size = effectiveSize("medium", toad.treatedAsSize);
    const cursed = computeDefences({
      ...actor,
      sizeMod: LASTARC.sizes[size].mod,
      misc: toad.defences,
      agiOverride: toad.agiOverride,
      noEquipmentBenefit: toad.noEquipmentBenefit
    });

    assert.equal(clean.fort - cursed.fort, 10);
    assert.equal(clean.will - cursed.will, 10);

    // The regression this guards: toad shipped carrying `defences.ref: -10` as
    // well. With the rebuild in place that would charge the transformation
    // twice, and the GM's formula would come out 10 low.
    assert.equal(toad.defences.ref, 0, "toad must not ALSO carry a flat Reflex penalty");
  });

  test("treatedAsSize replaces the size, it does not modify it", () => {
    assert.equal(effectiveSize("large", "tiny"), "tiny");
    assert.equal(effectiveSize("large", null), "large", "no status, no change");
    assert.equal(effectiveSize("large", "nonesuch"), "large", "an unknown size is ignored");
  });
});

describe("§10 agiOverride applies to a hand-applied helpless", () => {
  const actor = { level: 3, agiMod: 3, vitMod: 0, mndMod: 0 };
  const helpless = aggregateStatuses(["helpless"]);

  test("Agility goes from its real value to −5, not merely to zero", () => {
    const clean = computeDefences(actor);
    const denied = computeDefences({ ...actor, agiDenied: true });
    const overridden = computeDefences({
      ...actor, agiDenied: helpless.agiDenied, agiOverride: helpless.agiOverride
    });

    // The bug: helpless on an upright creature only ever reached `agiDenied`,
    // which zeroes a positive bonus. +3 became 0 instead of −5.
    assert.equal(clean.ref - denied.ref, 3, "agiDenied alone only removes the bonus");
    assert.equal(clean.ref - overridden.ref, 8, "the override must reach −5");
  });

  test("it is a floor, so it never IMPROVES a worse Agility", () => {
    assert.equal(applyAgiOverride(-8, -5), -8);
    assert.equal(applyAgiOverride(3, -5), -5);
    assert.equal(applyAgiOverride(3, null), 3, "no override, no change");
  });

  test("applying it twice is the same as applying it once", () => {
    // §5.6 puts unconscious + helpless on a creature at 0 HP simultaneously,
    // and the incapacitation floor is the same operation. Reaching −10 or −15
    // by stacking them is the failure this shape prevents.
    const once = applyAgiOverride(4, -5);
    assert.equal(applyAgiOverride(once, -5), once);
  });

  test("the stored Agility is never touched — the GM's stated requirement", () => {
    const attributes = { agi: { mod: 4 } };
    computeDefences({ ...actor, agiMod: attributes.agi.mod, agiOverride: -5 });
    assert.equal(attributes.agi.mod, 4, "derivation must not write back to the attribute");
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The wiring, not the arithmetic.
 *
 * All three keys were already correct as a rule and correct in the table; what
 * was missing was any call site passing them in. That is the defect class this
 * project produces most often — right code, starved of its inputs — so the
 * derivation tests above are not sufficient on their own.
 *
 * Source-level because the models need Foundry to instantiate.
 */
describe("§ the models actually feed the new keys in", () => {
  const read = (p) =>
    readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

  const strip = (src) => {
    const i = src.indexOf("prepareDerivedData()");
    assert.ok(i > -1, "no prepareDerivedData");
    return src.slice(i).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  };

  const character = strip(read("module/data/character.mjs"));
  const npc = strip(read("module/data/npc.mjs"));

  test("the character model passes all three to the derivation", () => {
    for (const key of ["agiOverride", "noEquipmentBenefit", "treatedAsSize"]) {
      assert.match(character, new RegExp(`statuses\\.${key}`),
        `character.mjs never reads statuses.${key}, so it is inert on a player`);
    }
  });

  test("both the live and the flat-footed Reflex get them", () => {
    // Two computeDefences calls, and only patching the first leaves a
    // flat-footed Reflex that is better than the live one under Toad.
    const calls = character.match(/computeDefences\(\{[\s\S]*?\}\)/g) ?? [];
    assert.ok(calls.length >= 2, "expected a live and a flat-footed computation");
    for (const [i, call] of calls.entries()) {
      assert.match(call, /agiOverride/, `computeDefences call ${i + 1} omits agiOverride`);
    }
  });

  test("Break Threshold reads the EFFECTIVE size, not the printed one", () => {
    // Threshold takes a size bonus from Large up. A Large character under Toad
    // keeping their +5 Threshold would be the same rule-4 mistake in a new place.
    assert.match(character, /size:\s*effSize/,
      "breakThreshold is still reading details.size, so Toad leaves the Threshold alone");
  });

  test("the NPC model computes Reflex through the shared helper", () => {
    // A bare text match was the first version of this guard, and it passed
    // with the branch mutated to `if (false)` — the name was still there. So
    // the branch moved INTO printedReflex, where a test can reach it, and what
    // is left here is a single unconditional call with nothing to invert.
    assert.match(npc, /printedReflex\(\{/,
      "npc.mjs does not call printedReflex, so statuses stop reaching Reflex");
    assert.ok(!/if \(statuses\.agi(Denied|Override)\)/.test(npc),
      "the status branches belong in printedReflex, where they are reachable " +
      "from a test — an inline `if` here cannot be mutation-checked");
  });
});

describe("§ a printed statblock under agiOverride", () => {
  test("the printed Agility is backed out and replaced, not merely denied", () => {
    // Reflex 17 on a creature with Agi +3: the +3 comes out, −5 goes in.
    assert.equal(printedRefWithAgiOverride(17, 3, -5), 9);
  });

  test("a creature with negative Agility still drops to −5", () => {
    assert.equal(printedRefWithAgiOverride(17, -2, -5), 14);
  });

  test("no override leaves the printed number exactly alone", () => {
    assert.equal(printedRefWithAgiOverride(17, 3, null), 17);
  });

  test("the three rules apply in the right order", () => {
    const base = { printed: 17, agiMod: 3, breakPenalty: 0, statusDefence: 0 };

    assert.deepEqual(printedReflex(base), { value: 17, flatFooted: 14 },
      "untouched, and flat-footed strips the +3");

    assert.equal(printedReflex({ ...base, agiDenied: true }).value, 14,
      "denied means the live Reflex IS the flat-footed one");

    // The ordering bug this exists to catch: agiOverride applied INSTEAD of
    // agiDenied rather than after it. Helpless must be worse than flat-footed,
    // never better.
    const helpless = printedReflex({ ...base, agiDenied: true, agiOverride: -5 });
    assert.equal(helpless.value, 9);
    assert.ok(helpless.value < printedReflex({ ...base, agiDenied: true }).value,
      "helpless must be easier to hit than merely flat-footed");
  });

  test("a printed flat-footed value cannot exceed the overridden live one", () => {
    // Statblocks print their own flat-footed Reflex, and it can be generous.
    // Left alone it would say the creature is HARDER to hit flat-footed than
    // it is while helpless.
    const r = printedReflex({
      printed: 17, flatFootedBase: 16, agiMod: 3, agiOverride: -5
    });
    assert.ok(r.flatFooted <= r.value, `${r.flatFooted} > ${r.value}`);
  });

  test("the break penalty and status modifiers ride on top of both", () => {
    const r = printedReflex({
      printed: 17, agiMod: 3, breakPenalty: -2, statusDefence: -10
    });
    assert.equal(r.value, 5);
    assert.equal(r.flatFooted, 2);
  });

  test("it agrees with what a character with the same parts would get", () => {
    // The two models compute Reflex by different routes (sum vs printed
    // total), and the whole class of bug in CLAUDE.md §10 is those routes
    // disagreeing. Build a character, print its total, and demand the NPC
    // path lands on the same number.
    const parts = { level: 4, agiMod: 3, vitMod: 0, mndMod: 0 };
    const printed = computeDefences(parts).ref;

    const asCharacter = computeDefences({ ...parts, agiDenied: true, agiOverride: -5 }).ref;
    const asStatblock = printedRefWithAgiOverride(printed, parts.agiMod, -5);

    assert.equal(asStatblock, asCharacter,
      "a monster and a character with identical numbers must land on the same Reflex");
  });
});
