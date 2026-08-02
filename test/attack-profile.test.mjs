/**
 * The sheet row and the dice must answer with the same number (issue #40).
 *
 * Reported as "the Wizard Wand shows +2 and rolls +13". The row was a SECOND
 * implementation of the attack decision, and by the time it was reported it had
 * drifted from the dice in four independent places:
 *
 *   1. staves route to Spellcraft in the dice (issue #36) and never did in the
 *      row, which is the reported +2 against +13;
 *   2. bows add Strength to damage in the dice (issue #36) and never did in the
 *      row, so every bow under-reported itself;
 *   3. Weapon Finesse substitutes Agility in the dice and never did in the row;
 *   4. the light-weapon choice took the BETTER skill in the row and the WORSE
 *      one in the dice.
 *
 * Every function involved was individually correct and individually tested.
 * That is precisely why the unit suite could not see this: there is no wrong
 * function here, only a second copy of a decision. So the fix is structural —
 * one `weaponAttackProfile` both halves call — and the tests below pin the
 * behaviour AND assert that the second copy has not grown back.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attackSkillKey, weaponAttackProfile } from "../module/dice/attack.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

/** A skill block shaped like the character model's derived rows. */
const sk = (map) => Object.fromEntries(
  Object.entries(map).map(([k, total]) => [k, { total }])
);

describe("§ issue #40: the row and the dice share one decision", () => {
  describe("which skill", () => {
    const skills = sk({
      spellcraft: 13, ranged: 2, oneHanded: 7, lightWeapon: 5, twoHanded: 6, unarmed: 1
    });

    test("a staff rolls Spellcraft, not the ranged skill", () => {
      // The reported case. `staves` is a RANGED category, so wield-based
      // routing lands on `ranged` and the category check has to come first.
      assert.equal(attackSkillKey({ wield: "ranged", category: "staves", skills }), "spellcraft");
    });

    test("a bow still rolls the ranged skill", () => {
      assert.equal(attackSkillKey({ wield: "ranged", category: "bows", skills }), "ranged");
    });

    test("a light weapon one size down takes whichever skill is higher", () => {
      // §5.4 gives the choice to the wielder with no rider on either answer.
      assert.equal(
        attackSkillKey({
          wield: "light", category: "daggers",
          actorSize: "medium", weaponSize: "small", skills
        }),
        "oneHanded", "One-Handed is 7 against Light Weapon's 5"
      );

      assert.equal(
        attackSkillKey({
          wield: "light", category: "daggers",
          actorSize: "medium", weaponSize: "small",
          skills: sk({ oneHanded: 3, lightWeapon: 9 })
        }),
        "lightWeapon"
      );
    });

    test("a light weapon two sizes down has no choice to make", () => {
      assert.equal(
        attackSkillKey({
          wield: "light", category: "daggers",
          actorSize: "large", weaponSize: "small", skills
        }),
        "lightWeapon", "the 1-Handed option is only open one size down"
      );
    });

    test("an unmapped wield category throws rather than defaulting", () => {
      // The failure this replaces was a silent zero: `sys.skills.light` was
      // undefined and every light-weapon attack rolled a bare d20.
      assert.throws(() => attackSkillKey({ wield: "nonsense", category: "swords", skills }));
    });
  });

  describe("the profile answers both halves at once", () => {
    const base = {
      actorSize: "medium", level: 10, strMod: 4, agiMod: 3,
      skills: sk({ spellcraft: 13, ranged: 2, oneHanded: 7, lightWeapon: 9, twoHanded: 6 }),
      proficientCategories: ["staves", "bows", "swords", "daggers"]
    };

    test("the wand's attack total is Spellcraft's, not the ranged skill's", () => {
      const p = weaponAttackProfile({ ...base, category: "staves", weaponSize: "medium" });
      assert.equal(p.skillKey, "spellcraft");
      assert.equal(p.attack.total, 13, "13 Spellcraft, proficient, no weapon bonus");
      assert.notEqual(p.attack.total, 2);
    });

    test("a bow's damage carries Strength", () => {
      const p = weaponAttackProfile({ ...base, category: "bows", weaponSize: "medium" });
      assert.equal(p.isMelee, false);
      assert.equal(p.damage.attribute, "str");
      assert.equal(p.damage.flat, 5 + 4, "half of level 10, plus Strength 4");
    });

    test("a crossbow's damage does not", () => {
      const p = weaponAttackProfile({
        ...base, category: "crossbows", weaponSize: "medium",
        proficientCategories: ["crossbows"]
      });
      assert.equal(p.damage.attribute, null);
      assert.equal(p.damage.flat, 5);
    });

    test("Weapon Finesse substitutes Agility in the row as well", () => {
      const light = { ...base, category: "daggers", weaponSize: "small" };
      assert.equal(weaponAttackProfile(light).damage.attribute, "str");
      assert.equal(
        weaponAttackProfile({ ...light, weaponFinesse: true }).damage.attribute, "agi"
      );
    });

    test("a non-proficient weapon takes −5 in the row", () => {
      const p = weaponAttackProfile({
        ...base, category: "swords", weaponSize: "medium", proficientCategories: []
      });
      assert.equal(p.proficient, false);
      assert.equal(p.attack.total, 7 - 5);
    });

    test("an unusable weapon reports itself instead of throwing", () => {
      // `weaponSkillFor` throws on an unmapped category by design, so the
      // profile has to short-circuit before reaching it — a sheet that throws
      // while rendering a row shows the player nothing at all.
      const p = weaponAttackProfile({
        ...base, actorSize: "small", category: "swords", weaponSize: "large"
      });
      assert.equal(p.unusable, true);
      assert.equal(p.skillKey, null);
      assert.equal(p.skillMod, 0);
    });

    test("situational modifiers are absent by design", () => {
      // A weapon has no cover and no flanking. Folding them in would make the
      // row lie in the other direction.
      const p = weaponAttackProfile({ ...base, category: "swords", weaponSize: "medium" });
      assert.deepEqual(p.attack.parts.map((x) => x.label), ["LASTARC.Mod.skill"]);
    });
  });

  /**
   * The structural half. Behaviour tests above prove the profile is right;
   * these prove nothing has quietly started answering the same question twice.
   */
  describe("no second copy of the decision", () => {
    const sheet = read("module/sheets/character-sheet.mjs");
    const row = sheet.match(/\n {2}#prepareAttacks\(sys\)\s*\{[\s\S]*?\n {2}\}/);

    test("the Attacks row is built from the shared profile", () => {
      assert.ok(row, "#prepareAttacks not found — this test has lost its target");
      assert.match(row[0], /weaponProfileFor\(/,
        "the Attacks row no longer calls the shared profile, which is how it " +
        "drifted from the dice in four places at once");
    });

    test("the row does no attack arithmetic of its own", () => {
      const body = row[0];
      for (const [pattern, what] of [
        [/wieldCategory\(/, "deriving its own wield category"],
        [/weaponSkillFor\(/, "mapping its own skill key"],
        [/lightWeaponAllowsChoice\(/, "resolving the light-weapon choice itself"],
        [/strDamageMultiplier\(/, "applying its own Strength multiplier"],
        [/attributes\.\w+\.mod/, "reading an attribute modifier directly"],
        [/proficiencies\.weapons/, "deciding proficiency itself"]
      ]) {
        assert.doesNotMatch(body, pattern,
          `the Attacks row is ${what}. Every term it shows must come from ` +
          "weaponAttackProfile, or the row and the dice can disagree again.");
      }
    });

    test("rollAttack takes its skill and proficiency from the profile too", () => {
      const roll = read("module/dice/attack.mjs")
        .match(/export async function rollAttack\([\s\S]*?\n\}/);
      assert.ok(roll, "rollAttack not found — this test has lost its target");
      assert.match(roll[0], /weaponProfileFor\(/,
        "rollAttack computes its own profile again, so the sheet can be right " +
        "and the dice wrong");
    });
  });
});
