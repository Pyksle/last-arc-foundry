/**
 * Proficiency a trait confers (#75).
 *
 * Reported as "when you are trained in weapon proficiency knives you are still
 * being held accountable for the −5". The attack maths was never wrong: given
 * `["knives"]` it drops the penalty correctly. What was wrong is that nothing
 * could put "knives" in that list except a human ticking a box on a different
 * panel — so the Weapon Proficiency technick a player writes down was inert,
 * and the two halves of the character sheet disagreed with nothing to reconcile
 * them.
 *
 * The union has to stay DERIVED. `proficiencies` is three inputs, and
 * `prepareDerivedData` assigning to an input stores the computed value and
 * shows the reader the old one back — the trap that has shipped twice here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateGrants, hasGrantPayload, effectiveProficiencies
} from "../module/derivation.mjs";
import { weaponAttackProfile } from "../module/dice/attack.mjs";
import { proficiencyRows, grantProficiencyRows } from "../module/sheet-rows.mjs";
import { LASTARC } from "../module/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const grant = (proficiencies) => ({ proficiencies });

describe("§ the aggregate unions what traits confer", () => {
  test("weapons and armour combine across traits", () => {
    const out = aggregateGrants([
      grant({ weapons: ["knives"], armour: ["light"] }),
      grant({ weapons: ["swords"], armour: ["heavy"] })
    ]);
    assert.deepEqual(out.proficiencies.weapons, ["knives", "swords"]);
    assert.deepEqual(out.proficiencies.armour, ["light", "heavy"]);
  });

  /**
   * Proficiency is yes-or-no per category, so two technicks naming knives make
   * a character no more proficient than one does. A count would be a number
   * nothing reads and everything could disagree about.
   */
  test("the same category twice is still one entry", () => {
    const out = aggregateGrants([grant({ weapons: ["knives"] }), grant({ weapons: ["knives"] })]);
    assert.deepEqual(out.proficiencies.weapons, ["knives"]);
  });

  test("shields is an OR across traits", () => {
    assert.equal(aggregateGrants([grant({ shields: false }), grant({ shields: true })])
      .proficiencies.shields, true);
    assert.equal(aggregateGrants([grant({}), grant({})]).proficiencies.shields, false);
  });

  test("a trait granting nothing contributes nothing", () => {
    const out = aggregateGrants([{}, null, grant({})]);
    assert.deepEqual(out.proficiencies, { weapons: [], armour: [], shields: false });
  });
});

describe("§ the Grants panel does not call it empty", () => {
  /**
   * A proficiency adds no NUMBER, and the panel tells the reader an empty block
   * is empty on purpose. Miss this and it prints that reassurance on the very
   * technick whose inertness produced the report.
   */
  test("each kind alone is a payload", () => {
    assert.equal(hasGrantPayload(grant({ weapons: ["knives"] })), true);
    assert.equal(hasGrantPayload(grant({ armour: ["heavy"] })), true);
    assert.equal(hasGrantPayload(grant({ shields: true })), true);
  });

  test("an empty proficiency block is still empty", () => {
    assert.equal(hasGrantPayload(grant({ weapons: [], armour: [], shields: false })), false);
  });
});

describe("§ the penalty the report was about", () => {
  const skills = { lightWeapon: { total: 8 } };
  const profile = (proficientCategories) => weaponAttackProfile({
    actorSize: "medium", level: 4, strMod: 2, agiMod: 3, skills,
    category: "knives", weaponSize: "small", proficientCategories
  });

  test("a knife is a light weapon either way", () => {
    assert.equal(profile([]).wield, "light");
    assert.equal(profile([]).skillKey, "lightWeapon");
    assert.equal(profile(["knives"]).skillKey, "lightWeapon",
      "proficiency must not change which skill is rolled");
  });

  test("proficiency removes the −5 and nothing else", () => {
    const without = profile([]);
    const with_ = profile(["knives"]);
    assert.equal(with_.attack.total - without.attack.total, 5);
    assert.ok(without.attack.parts.some((p) => p.label === "LASTARC.Mod.nonProficient"));
    assert.ok(!with_.attack.parts.some((p) => p.label === "LASTARC.Mod.nonProficient"),
      "the penalty survived being proficient");
  });
});

describe("§ the picker says where a tick came from", () => {
  const sys = (ticked, granted) => ({
    proficiencies: { weapons: ticked, armour: [], shields: false },
    grants: { proficiencies: { weapons: granted, armour: [], shields: false } }
  });
  const weapon = (rows, key) => rows.weaponProficiencies.find((r) => r.key === key);

  test("a granted proficiency reads as active", () => {
    const rows = proficiencyRows(sys([], ["knives"]));
    assert.equal(weapon(rows, "knives").active, true);
  });

  /**
   * Marked, not silently ticked. A box that turns itself on and cannot be
   * turned off is indistinguishable from a bug unless it names who did it.
   */
  test("…and says it was granted", () => {
    const rows = proficiencyRows(sys([], ["knives"]));
    assert.equal(weapon(rows, "knives").granted, true);
    assert.equal(weapon(rows, "swords").active, false);
    assert.equal(weapon(rows, "swords").granted, false);
  });

  /** One a player ticked themselves is theirs, and stays un-marked. */
  test("a tick the player set is not labelled as granted", () => {
    const rows = proficiencyRows(sys(["knives"], []));
    assert.equal(weapon(rows, "knives").active, true);
    assert.equal(weapon(rows, "knives").granted, false);
  });

  test("ticked AND granted is not marked, because unticking still leaves it", () => {
    const rows = proficiencyRows(sys(["knives"], ["knives"]));
    assert.equal(weapon(rows, "knives").granted, false);
  });

  test("the trait's own picker offers the same closed sets", () => {
    const rows = grantProficiencyRows({ weapons: ["knives"], armour: [] });
    assert.deepEqual(rows.grantWeaponProficiencies.map((r) => r.key), LASTARC.weaponCategories);
    assert.deepEqual(rows.grantArmourProficiencies.map((r) => r.key),
      Object.keys(LASTARC.armourTypes));
    assert.equal(rows.grantWeaponProficiencies.find((r) => r.key === "knives").selected, true);
  });
});

describe("§ the union of ticked and granted", () => {
  const ticked = { weapons: ["knives"], armour: ["light"], shields: false };
  const granted = { weapons: ["swords"], armour: ["heavy"], shields: true };

  /**
   * Every kind, both directions. The first version of this union dropped
   * granted ARMOUR and the suite stayed green, because the guard was reading
   * the weapons line — so each kind is asserted from both sides on purpose.
   */
  test("the player's own ticks survive", () => {
    const out = effectiveProficiencies(ticked, granted);
    assert.ok(out.weapons.includes("knives"), "a ticked weapon was dropped");
    assert.ok(out.armour.includes("light"), "a ticked armour was dropped");
    assert.equal(effectiveProficiencies({ shields: true }, {}).shields, true);
  });

  test("what traits grant survives", () => {
    const out = effectiveProficiencies(ticked, granted);
    assert.ok(out.weapons.includes("swords"), "a granted weapon was dropped");
    assert.ok(out.armour.includes("heavy"), "a granted armour was dropped");
    assert.equal(out.shields, true, "a granted shield proficiency was dropped");
  });

  test("holding one both ways lists it once", () => {
    const both = { weapons: ["knives"], armour: ["light"] };
    const out = effectiveProficiencies(both, both);
    assert.deepEqual(out.weapons, ["knives"]);
    assert.deepEqual(out.armour, ["light"]);
  });

  test("neither side set means nothing, not undefined", () => {
    assert.deepEqual(effectiveProficiencies(), { weapons: [], armour: [], shields: false });
  });
});

describe("§ the wiring the maths cannot hold", () => {
  const model = read("module/data/character.mjs");

  /**
   * Derived, never written back. `proficiencies` is three inputs; assigning to
   * one in prepareDerivedData stores the computed value and shows the reader
   * the old one — CLAUDE.md's trap #4, which has shipped here twice.
   */
  test("the union is a separate path, not written over the ticks", () => {
    assert.match(model, /this\.effectiveProficiencies\s*=/,
      "there is no derived union at all");
    assert.ok(!/this\.proficiencies\.(weapons|armour|shields)\s*=/.test(model),
      "the derivation writes back over an input, so the checkboxes will lie");
  });

  test("the model computes it with the shared helper, not its own set maths", () => {
    assert.match(model, /D\.effectiveProficiencies\(/,
      "three kinds unioned inline is three chances to drop one silently");
  });

  /** All four consumers, or the technick works in some places and not others. */
  test("every consumer reads the union", () => {
    assert.match(read("module/dice/attack.mjs"),
      /effectiveProficiencies\?\.weapons/, "attacks still read the raw ticks");
    assert.match(read("module/dice/block.mjs"),
      /effectiveProficiencies/, "Block still reads the raw ticks");
    assert.match(model, /effectiveProficiencies\.armour\.includes/,
      "the armour check penalty still reads the raw ticks");
    assert.match(read("module/sheet-rows.mjs"),
      /grants\?\.proficiencies/, "the picker cannot show a granted tick");
  });
});
