/**
 * Ranged weapon groups (issue #36).
 *
 * The reported bug was "crossbows add Strength to damage". The truth was worse
 * and quieter: `buildDamageTerms` added an attribute only on the melee branch,
 * so NO ranged weapon added one. Crossbows were right by accident and every bow
 * in play was short its Strength modifier, permanently, with nothing on the card
 * to show a term was missing.
 *
 * The weapon groups define these as two different things, not one rule with an
 * exception — bows "rely on the wielder's strength", crossbows "do not utilize
 * strength". Testing them together is the point: fixing either alone leaves the
 * other wrong, which is how this shipped.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDamageTerms, situationalModifiers } from "../module/dice/attack.mjs";
import { rangeBandsFor, rangeBandPenalty } from "../module/derivation.mjs";
import { LASTARC } from "../module/config.mjs";

const base = { level: 1, strMod: 4, agiMod: 2, isRanged: true };

describe("§ ranged weapons: which groups use Strength", () => {
  test("a bow adds the wielder's Strength", () => {
    const t = buildDamageTerms({ ...base, rangedUsesStrength: true });
    assert.equal(t.attribute, "str");
    assert.ok(t.parts.some((p) => p.value === 4), JSON.stringify(t.parts));
  });

  test("a crossbow adds no attribute at all", () => {
    const t = buildDamageTerms({ ...base, rangedUsesStrength: false });
    assert.equal(t.attribute, null);
    assert.ok(!t.parts.some((p) => p.value === 4), JSON.stringify(t.parts));
  });

  test("a staff adds no attribute either", () => {
    // "There is no attribute-based damage modifier for attacks made with staves."
    assert.equal(buildDamageTerms({ ...base, rangedUsesStrength: false }).attribute, null);
  });

  test("a bow's Strength is never doubled", () => {
    // The ×2 belongs to the melee sizing rule for a weapon a category above the
    // wielder. A two-handed longbow is not that rule.
    const t = buildDamageTerms({ ...base, rangedUsesStrength: true, wieldCategory: "twoHanded" });
    assert.ok(t.parts.some((p) => p.value === 4), "doubled the bow's Strength");
    assert.ok(!t.parts.some((p) => p.value === 8), "doubled the bow's Strength");
  });

  test("melee is untouched by any of this", () => {
    const t = buildDamageTerms({ ...base, isRanged: false });
    assert.equal(t.attribute, "str");
  });

  test("the config says which groups are which", () => {
    assert.ok(LASTARC.strengthRangedCategories.has("bows"));
    assert.ok(!LASTARC.strengthRangedCategories.has("crossbows"));
    assert.ok(!LASTARC.strengthRangedCategories.has("staves"));

    // Staves are ranged, which is what gives them the critical rather than the
    // melee combo — the two ride on the same flag in resolveAttack.
    for (const g of ["bows", "crossbows", "staves"]) {
      assert.ok(LASTARC.rangedWeaponCategories.has(g), `${g} should be ranged`);
    }
    assert.ok(LASTARC.spellcraftWeaponCategories.has("staves"));
  });
});

describe("§ range increments (p.103)", () => {
  test("bands come from the weapon's size, not from typed numbers", () => {
    const medium = rangeBandsFor("medium");
    assert.deepEqual(medium.map((b) => [b.key, b.from, b.to, b.penalty]), [
      ["pointBlank", 0, 20, 0],
      ["short", 21, 40, -2],
      ["mid", 41, 60, -5],
      ["long", 61, 80, -10]
    ]);
  });

  test("a thrown weapon uses the thrown row whatever its own size", () => {
    const thrown = rangeBandsFor("large", { isThrown: true });
    assert.equal(thrown[0].to, 6);
    assert.equal(thrown[3].to, 12);
  });

  test("large weapons reach much further at the top band", () => {
    assert.equal(rangeBandsFor("large")[3].to, 240);
    assert.equal(rangeBandsFor("small")[3].to, 40);
  });

  test("an unknown size falls back rather than producing undefined bands", () => {
    const bands = rangeBandsFor("zzfake");
    assert.equal(bands.length, 4);
    assert.ok(bands.every((b) => Number.isFinite(b.to)));
  });

  test("point-blank costs nothing and the rest cost the printed penalty", () => {
    assert.equal(rangeBandPenalty("pointBlank"), 0);
    assert.equal(rangeBandPenalty("short"), -2);
    assert.equal(rangeBandPenalty("mid"), -5);
    assert.equal(rangeBandPenalty("long"), -10);
  });

  test("an absent band costs nothing — a plain click must not be penalised", () => {
    assert.equal(rangeBandPenalty(null), 0);
    assert.equal(rangeBandPenalty(undefined), 0);
    assert.equal(rangeBandPenalty("zzfake"), 0);
  });

  test("the band reaches the attack roll as a labelled part", () => {
    const parts = situationalModifiers({ isMelee: false, rangeBand: "mid" });
    assert.ok(parts.some((p) => p.value === -5), JSON.stringify(parts));

    // And a melee swing is never asked, so it never carries one.
    assert.deepEqual(situationalModifiers({ isMelee: true }), []);
  });
});
