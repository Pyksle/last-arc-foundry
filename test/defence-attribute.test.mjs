/**
 * Substituting the attribute a defence is calculated from (#69).
 *
 * The request was for "an option to select what stat to use for defenses under
 * new tecnicks" — a general mechanism rather than one hardcoded swap. The
 * worked example given was a technick offering Intelligence in place of
 * Agility for Reflex, gated behind an attribute prerequisite, and carrying one
 * further condition: the armour cap applies to the substituted bonus too.
 *
 * That condition is the whole design. The substitution changes WHICH
 * attribute fills the slot and nothing else — the slot keeps the armour cap,
 * the flat-footed denial and the incapacitation floor, because those are
 * properties of Reflex rather than of Agility. Every test here exists to pin
 * one of those down, since the tempting implementation (swap the number in at
 * the end) quietly drops all three.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LASTARC } from "../module/config.mjs";
import {
  computeDefences,
  substituteDefenceMod,
  resolveDefenceSubstitutes,
  aggregateGrants,
  hasGrantPayload
} from "../module/derivation.mjs";

describe("#69 substituteDefenceMod picks the modifier that fills the slot", () => {
  test("no offer leaves the slot's own attribute alone", () => {
    assert.equal(substituteDefenceMod(3, null), 3);
    assert.equal(substituteDefenceMod(3, undefined), 3);
  });

  test("\"you MAY use\" means the character never takes the worse of the two", () => {
    // Int is better: the point of the technick.
    assert.equal(substituteDefenceMod(-2, 5), 5);
    // Agi is better: the technick is permissive, so it simply goes unused.
    assert.equal(substituteDefenceMod(6, 2), 6);
  });

  test("a non-numeric offer is ignored rather than poisoning the slot", () => {
    // Math.max with undefined is NaN, which would silently wreck Reflex,
    // Threshold and every comparison downstream.
    assert.equal(substituteDefenceMod(4, NaN), 4);
    assert.ok(Number.isFinite(substituteDefenceMod(4, NaN)));
  });
});

describe("#69 a substituted Reflex keeps every rule the slot already had", () => {
  /** Armoured, so the cap is live; Int well clear of Agi so the swap matters. */
  const actor = {
    level: 4,
    agiMod: 0,
    vitMod: 2,
    mndMod: 1,
    classBonus: { ref: 2, fort: 1, will: 1 },
    armour: { refBonus: 4, maxAgiBonus: 1 },
    technicks: { ref: 0, fort: 0, will: 0 }
  };

  test("the armour cap still applies — the requested technick says so outright", () => {
    const d = computeDefences({ ...actor, substituteMods: { ref: 5 } });

    // Int +5 meets maxAgiBonus 1, exactly as an Agi +5 would have.
    const capped = computeDefences({ ...actor, agiMod: 5 });
    assert.equal(d.ref, capped.ref);

    // And the cap is genuinely biting: uncapped this would be four higher.
    const uncapped = computeDefences({
      ...actor, armour: { refBonus: 4, maxAgiBonus: Infinity }, substituteMods: { ref: 5 }
    });
    assert.equal(uncapped.ref - d.ref, 4);
  });

  test("flat-footed still denies it — it is the Reflex bonus, whatever fed it", () => {
    const open = computeDefences({ ...actor, substituteMods: { ref: 5 } });
    const caught = computeDefences({
      ...actor, substituteMods: { ref: 5 }, agiDenied: true
    });
    assert.ok(caught.ref < open.ref, "a substituted bonus survived being caught unaware");

    // Denied, the substitution is worth nothing at all.
    assert.equal(caught.ref, computeDefences({ ...actor, agiDenied: true }).ref);
  });

  test("the helpless floor still applies", () => {
    const d = computeDefences({
      ...actor, substituteMods: { ref: 5 }, incapacitated: true
    });
    // −5 floor, then a negative applies in full past any cap.
    assert.equal(d.ref, computeDefences({ ...actor, agiMod: -5, incapacitated: true }).ref);
  });

  test("a NEGATIVE default still applies in full when no offer beats it", () => {
    // §4.1: caps and denial remove the bonus, never the penalty.
    const d = computeDefences({ ...actor, agiMod: -3, substituteMods: { ref: -4 } });
    assert.equal(d.ref, computeDefences({ ...actor, agiMod: -3 }).ref);
  });

  test("Fortitude and Will substitute through the same door", () => {
    const fort = computeDefences({ ...actor, substituteMods: { fort: 6 } });
    assert.equal(fort.fort, computeDefences({ ...actor, vitMod: 6 }).fort);

    const will = computeDefences({ ...actor, substituteMods: { will: 6 } });
    assert.equal(will.will, computeDefences({ ...actor, mndMod: 6 }).will);
  });

  test("an empty substituteMods changes nothing", () => {
    assert.deepEqual(
      computeDefences({ ...actor, substituteMods: {} }),
      computeDefences(actor)
    );
  });
});

describe("#69 offers travel from items to the actor", () => {
  test("aggregateGrants collects one offer per slot, without duplicates", () => {
    const out = aggregateGrants([
      { defenceAttribute: { ref: "int", fort: "", will: "" } },
      { defenceAttribute: { ref: "int", fort: "str", will: "" } },
      { defenceAttribute: { ref: "chr", fort: "", will: "" } }
    ]);

    assert.deepEqual(out.defenceAttribute.ref, ["int", "chr"]);
    assert.deepEqual(out.defenceAttribute.fort, ["str"]);
    assert.deepEqual(out.defenceAttribute.will, []);
  });

  test("items granting nothing leave the slots empty", () => {
    const out = aggregateGrants([{ defences: { ref: 2 } }, null]);
    assert.deepEqual(out.defenceAttribute, { ref: [], fort: [], will: [] });
  });

  test("two offers for one defence resolve to the better one", () => {
    const mods = { str: 1, vit: 0, agi: 0, int: 4, mnd: 2, chr: -1 };
    const picked = resolveDefenceSubstitutes({ ref: ["chr", "int"] }, mods);
    assert.equal(picked.ref, 4);
  });

  test("a slot with no offer resolves to null, not to zero", () => {
    // null reads downstream as "keep the usual attribute". Zero would read as
    // an offer of +0, which would beat a negative Agility and silently make
    // every armoured character slightly harder to hit.
    const picked = resolveDefenceSubstitutes({}, { int: 4 });
    assert.deepEqual(picked, { ref: null, fort: null, will: null });
  });

  test("an unknown attribute key is dropped rather than becoming NaN", () => {
    const picked = resolveDefenceSubstitutes({ ref: ["zz"] }, { int: 4 });
    assert.equal(picked.ref, null);
  });
});

describe("#69 the Grants panel knows a substitution is a payload", () => {
  test("a substitution alone counts, even though it adds no number", () => {
    assert.equal(hasGrantPayload({ defenceAttribute: { ref: "int" } }), true);
  });

  test("blank slots do not count", () => {
    assert.equal(
      hasGrantPayload({ defenceAttribute: { ref: "", fort: "", will: "" } }),
      false
    );
  });
});

describe("#69 the config names a default for every defence", () => {
  test("each slot maps to a real attribute", () => {
    for (const [slot, attr] of Object.entries(LASTARC.defenceAttributes)) {
      assert.ok(LASTARC.attributes[attr], `${slot} defaults to unknown attribute ${attr}`);
    }
  });

  test("the defaults are the book's", () => {
    assert.deepEqual(LASTARC.defenceAttributes, { ref: "agi", fort: "vit", will: "mnd" });
  });
});
