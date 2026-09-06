/**
 * "You may use your Spellcraft check in place of a Medicine check."
 *
 * Seven talents in the demo and errata say some version of this — Spellcraft
 * for Deception, for Medicine, for Survival; Pilot for Stealth; Deception for
 * Acrobatics when tumbling; Survival for Medicine — and none of them could be
 * recorded at all. A character holding one had a skill row that was simply
 * wrong and a GM adjusting the number by hand every time it came up.
 *
 * It is NOT the defence-attribute substitution that shipped in 0.53.0. That one
 * swaps the ATTRIBUTE feeding a derived defence. This swaps the whole skill:
 * the substitute's own total is rolled, carrying its own training, focus and
 * armour check penalty, because that is what "use your Spellcraft check" means.
 * Grafting Medicine's training onto a Spellcraft roll would be a third rule
 * nobody wrote down.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as D from "../module/derivation.mjs";
import * as ROWS from "../module/sheet-rows.mjs";
import { LASTARC } from "../module/config.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const skills = {
  medicine: { total: 3 },
  spellcraft: { total: 9 },
  deception: { total: 4 },
  acrobatics: { total: 7 }
};
const spellForMedicine = { use: "spellcraft", insteadOf: "medicine", source: "ZZ trait" };

describe("§ the permission is never taken at a loss", () => {
  test("a better substitute answers the check", () => {
    const got = D.resolveSkillCheck("medicine", skills, [spellForMedicine]);
    assert.equal(got.key, "spellcraft");
    assert.equal(got.total, 9);
    assert.equal(got.via, spellForMedicine);
  });

  test("a worse one is ignored", () => {
    // "You MAY use" — the same reading `substituteDefenceMod` gives the same
    // wording. A permission that made a character worse would be a trap.
    const got = D.resolveSkillCheck("acrobatics", skills,
      [{ use: "deception", insteadOf: "acrobatics" }]);
    assert.equal(got.key, "acrobatics");
    assert.equal(got.total, 7);
    assert.equal(got.via, null);
  });

  test("a tie keeps the skill that was asked for", () => {
    // Renaming the roll for no gain would put "(via Spellcraft)" on a card for
    // nothing, and make a reroll scoped to Medicine stop matching.
    const level = { medicine: { total: 5 }, spellcraft: { total: 5 } };
    assert.equal(D.resolveSkillCheck("medicine", level, [spellForMedicine]).key, "medicine");
  });

  test("the best of several offers wins", () => {
    const got = D.resolveSkillCheck("medicine", skills, [
      { use: "deception", insteadOf: "medicine" },
      spellForMedicine
    ]);
    assert.equal(got.key, "spellcraft");
  });
});

describe("§ a substitution only answers its own check", () => {
  test("it does not fire on a different skill", () => {
    assert.equal(D.resolveSkillCheck("deception", skills, [spellForMedicine]).via, null);
  });

  test("and it does not run backwards", () => {
    // "Spellcraft in place of Medicine" is not "Medicine in place of
    // Spellcraft". Reading the pair as symmetric would hand out a second trait.
    const got = D.resolveSkillCheck("spellcraft",
      { spellcraft: { total: 1 }, medicine: { total: 8 } }, [spellForMedicine]);
    assert.equal(got.key, "spellcraft");
    assert.equal(got.total, 1);
  });

  test("a half-authored row does nothing", () => {
    for (const half of [{ use: "spellcraft" }, { insteadOf: "medicine" }, {}]) {
      assert.equal(D.resolveSkillCheck("medicine", skills, [half]).via, null);
    }
  });

  test("a skill standing in for itself does nothing", () => {
    assert.equal(
      D.resolveSkillCheck("medicine", skills,
        [{ use: "medicine", insteadOf: "medicine" }]).via,
      null);
  });

  test("no offers at all is the ordinary case", () => {
    const got = D.resolveSkillCheck("medicine", skills, []);
    assert.deepEqual(got, { key: "medicine", total: 3, via: null });
  });
});

describe("§ a blocked substitute is not offered", () => {
  /**
   * Silence stops Spellcraft outright — it is not a penalty, there is no number
   * to roll. A trait that let a silenced caster launder Spellcraft through
   * Medicine would make the status stop mattering.
   */
  test("Silence takes the substitution with it", () => {
    const got = D.resolveSkillCheck("medicine", skills, [spellForMedicine],
      { blocked: new Set(["spellcraft"]) });
    assert.equal(got.key, "medicine");
    assert.equal(got.total, 3);
  });

  test("blocking something else changes nothing", () => {
    const got = D.resolveSkillCheck("medicine", skills, [spellForMedicine],
      { blocked: new Set(["deception"]) });
    assert.equal(got.key, "spellcraft");
  });

  test("the named skill's own gate is left where it was", () => {
    // This function can only ever WITHHOLD a substitution. Refusing the roll
    // outright is `rollSkill`'s job and is unchanged, so a substitution can
    // never permit a check that was already refused.
    const rolls = code(read("module/dice/rolls.mjs"));
    assert.match(rolls, /blocksSkills\?\.has\(skillKey\)/,
      "the named skill's block check is gone, so substitution now permits rolls "
      + "the status was refusing");
  });
});

describe("§ the substitute brings its own numbers", () => {
  test("its total, not the named skill's, with its own training and penalty", () => {
    // `skillModifier` has already folded training, focus and the armour check
    // penalty into each total, so using the substitute's total is exactly
    // "use your Spellcraft check" and nothing has to be recombined.
    const got = D.resolveSkillCheck("medicine",
      { medicine: { total: 3 }, spellcraft: { total: 11 } }, [spellForMedicine]);
    assert.equal(got.total, 11);
  });

  test("an NPC's flat skill array reads too", () => {
    // NPCs keep `{key, value}` rows rather than derived objects (CLAUDE.md 10),
    // and `skillTotalOf` is the one reader that knows both shapes.
    const npc = [{ key: "medicine", value: 2 }, { key: "spellcraft", value: 6 }];
    assert.equal(D.resolveSkillCheck("medicine", npc, [spellForMedicine]).total, 6);
  });
});

describe("§ the grant travels from the item to the actor", () => {
  const aggregate = (grants) => D.aggregateGrants(grants);

  test("a complete pair is collected, with its source", () => {
    const out = aggregate([{
      skillSubstitution: { use: "spellcraft", insteadOf: "medicine" },
      __source: "ZZ trait", __sourceId: "abc123"
    }]);
    assert.deepEqual(out.skillSubstitutions, [{
      use: "spellcraft", insteadOf: "medicine", source: "ZZ trait", sourceId: "abc123"
    }]);
  });

  test("a half-filled pair is dropped rather than guessed at", () => {
    for (const sub of [{ use: "spellcraft" }, { insteadOf: "medicine" },
      { use: "medicine", insteadOf: "medicine" }]) {
      assert.deepEqual(aggregate([{ skillSubstitution: sub }]).skillSubstitutions, []);
    }
  });

  test("two traits both arrive, rather than one overwriting the other", () => {
    const out = aggregate([
      { skillSubstitution: { use: "spellcraft", insteadOf: "medicine" } },
      { skillSubstitution: { use: "pilot", insteadOf: "stealth" } }
    ]);
    assert.equal(out.skillSubstitutions.length, 2);
  });

  test("an actor with no traits gets an empty list, not undefined", () => {
    assert.deepEqual(aggregate([]).skillSubstitutions, []);
  });

  test("it counts as a payload, so the Grants panel does not call it empty", () => {
    // #69's lesson: a grant that adds no NUMBER is still very much a payload,
    // and an "empty on purpose" note over one is a lie.
    assert.equal(
      D.hasGrantPayload({ skillSubstitution: { use: "spellcraft", insteadOf: "medicine" } }),
      true);
    assert.equal(D.hasGrantPayload({ skillSubstitution: { use: "spellcraft" } }), false);
  });
});

describe("§ the wiring", () => {
  const rolls = code(read("module/dice/rolls.mjs"));
  const rows = code(read("module/sheet-rows.mjs"));
  const character = code(read("module/data/character.mjs"));
  const template = read("templates/item/item-sheet.hbs");
  const body = read("templates/actor/character-body.hbs");
  const css = read("styles/last-arc.css");
  const lang = JSON.parse(read("lang/en.json"));

  test("the actor carries the list", () => {
    assert.match(character, /this\.skillSubstitutions = grants\.skillSubstitutions/);
  });

  test("rolling a skill resolves it", () => {
    assert.match(rolls, /D\.resolveSkillCheck\(\s*skillKey, actor\.system\.skills/);
    assert.match(rolls, /const mod = chosen\.total/,
      "the roll still uses the named skill's own total");
  });

  test("Take N resolves it too", () => {
    // Otherwise taking 10 on a check you may make with a better skill is
    // quietly the worse route, which nothing in the book says.
    const fn = rolls.slice(rolls.indexOf("export function takeN"));
    assert.match(fn.slice(0, fn.indexOf("\n}")), /resolveSkillCheck\(/);
  });

  test("the card names both skills", () => {
    assert.match(rolls, /LASTARC\.Roll\.SkillVia/);
    assert.ok(lang["LASTARC.Roll.SkillVia"].includes("{skill}"));
    assert.ok(lang["LASTARC.Roll.SkillVia"].includes("{via}"));
  });

  test("the reroll scope follows the skill actually rolled", () => {
    assert.match(rolls, /skillKey: chosen\.key/,
      "a grant scoped to Spellcraft must offer itself on a check Spellcraft answered");
  });

  test("the skill row says so before the roll", () => {
    /**
     * BUILT, not grepped for. Asserting that `substitutedBy:` appears in the
     * source passed with the function returning null unconditionally — a guard
     * that read the shape of the row and never its value.
     *
     * `skillRow` is Foundry-free, so it can just be called.
     */
    const sys = {
      skills: {
        medicine: { total: 3, trained: false, focus: 0, misc: 0 },
        spellcraft: { total: 9, trained: true, focus: 0, misc: 0 }
      },
      skillSubstitutions: [{ use: "spellcraft", insteadOf: "medicine", source: "ZZ trait" }],
      attributes: { int: { mod: 2 }, mnd: { mod: 1 }, vit: { mod: 0 } },
      details: { level: 4 },
      breakGauge: { penalty: 0 }
    };
    const cfg = LASTARC.allSkills.medicine;
    const row = ROWS.skillRow("medicine", cfg, sys, null);

    assert.ok(row.substitutedBy, "the row does not mention the substitution at all");
    assert.equal(row.substitutedBy.key, "spellcraft");
    assert.equal(row.substitutedBy.total, 9);
    assert.equal(row.substitutedBy.source, "ZZ trait");
    assert.equal(row.total, 3, "the row's own total must still be the skill's own");

    // And a skill with no substitution says nothing.
    const plain = ROWS.skillRow("spellcraft", LASTARC.allSkills.spellcraft, sys, null);
    assert.equal(plain.substitutedBy, null);
  });

  test("the row's marker is rendered and styled", () => {
    assert.match(body, /\{\{#if this\.substitutedBy\}\}/);
    assert.match(css, /\.la-skill__via \{/);
    assert.ok(lang["LASTARC.Tooltip.SkillVia"]);
  });

  test("both ends are authorable", () => {
    // A field with no input is this project's signature defect. Two selects,
    // because a row with one end filled in is dropped by the aggregator.
    assert.match(template, /name="system\.grants\.skillSubstitution\.use"/);
    assert.match(template, /name="system\.grants\.skillSubstitution\.insteadOf"/);
    for (const key of ["LASTARC.Field.SubstituteUse", "LASTARC.Field.SubstituteInsteadOf",
      "LASTARC.Field.NoSubstitution", "LASTARC.Tooltip.SkillSubstitution"]) {
      assert.ok(lang[key], `${key} is missing`);
    }
  });
});
