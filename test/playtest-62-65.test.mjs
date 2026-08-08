/**
 * Four reports from one session (#62–#65), and they are four different shapes.
 *
 *   #62 two homebrew weapon categories with no home — guns and knuckles.
 *   #63 a rule that WAS implemented, decided automatically, and could not be
 *       overridden. The complaint was not "this is wrong", it was "there is no
 *       way to modify how an item is going to roll".
 *   #64 a racial the sheet could not record at all — the #59 shape again, and
 *       one an earlier audit had already predicted.
 *   #65 a field that exists on the statblock and on the race item and nowhere
 *       on the character, so players had nothing to type into.
 *
 * The guards below are shaped by how each would hide. Three of the four are
 * reachability, which is this project's recurring defect, so each new control is
 * asserted to exist on the sheet that actually renders it rather than anywhere
 * in the template tree.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  wieldCategory, weaponSkillFor, secondWindHeal, resilientSecondWindBonus
} from "../module/derivation.mjs";
import { attackSkillKey } from "../module/dice/attack.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const lang = JSON.parse(read("lang/en.json"));
const itemTemplate = read("templates/item/item-sheet.hbs");
const characterBody = read("templates/actor/character-body.hbs");

/* -------------------------------------------------------------------------- */
/*  #62 — guns and knuckles                                                    */
/* -------------------------------------------------------------------------- */

describe("§62 two homebrew weapon categories", () => {
  test("both are offered, so a proficiency can be ticked for them", () => {
    for (const cat of ["guns", "knuckles"]) {
      assert.ok(LASTARC.weaponCategories.includes(cat),
        `${cat} is not a weapon category, so no weapon can be authored in it`);
      assert.ok(`LASTARC.WeaponCategory.${cat}` in lang,
        `${cat} would render as a raw key in the picker`);
    }
  });

  /**
   * "Guns use the same attack format as crossbows." Three separate memberships
   * decide that, and missing any one leaves a gun half-crossbow: the skill it
   * rolls, whether size can make it two-handed, and whether it spends ammo.
   */
  test("a gun behaves as a crossbow does", () => {
    assert.ok(LASTARC.rangedWeaponCategories.has("guns"));
    assert.ok(LASTARC.ammunitionCategories.has("guns"),
      "a gun that never spends a shot is not a crossbow in any useful sense");

    // Size must not reroute it, exactly as it does not reroute a crossbow.
    for (const size of ["tiny", "small", "medium", "large"]) {
      assert.equal(wieldCategory("medium", size, "guns"), "ranged", `size ${size}`);
    }
    assert.equal(weaponSkillFor(wieldCategory("medium", "small", "guns")), "ranged");
  });

  /**
   * "Knuckles use the unarmed attack skill roll." Unarmed is a real skill and a
   * real wield category here, so this is routing rather than new machinery —
   * and the routing must survive every size, because knuckles are worn.
   */
  test("knuckles roll Unarmed whatever the wielder's size", () => {
    for (const [actor, weapon] of [
      ["medium", "small"], ["medium", "medium"], ["small", "small"], ["large", "medium"]
    ]) {
      assert.equal(wieldCategory(actor, weapon, "knuckles"), "unarmed",
        `${actor} wielder, ${weapon} knuckles`);
    }
    assert.equal(weaponSkillFor("unarmed"), "unarmed");
  });

  test("they do not become ranged, and guns do not become unarmed", () => {
    assert.ok(!LASTARC.rangedWeaponCategories.has("knuckles"));
    assert.ok(!LASTARC.unarmedWeaponCategories.has("guns"));
  });

  /**
   * The size table still gates usability. A weapon two or more categories
   * larger than its wielder is unusable, and neither exemption may smuggle one
   * past that — the check runs first for exactly this reason.
   */
  test("neither exemption bypasses the unusable gate", () => {
    assert.equal(wieldCategory("small", "large", "guns"), "unusable");
    assert.equal(wieldCategory("small", "large", "knuckles"), "unusable");
  });
});

/* -------------------------------------------------------------------------- */
/*  #63 — the light-weapon skill choice                                        */
/* -------------------------------------------------------------------------- */

describe("§63 the wielder may pick the light-weapon skill", () => {
  const skills = { lightWeapon: { total: 12 }, oneHanded: { total: 4 } };
  const light = { wield: "light", actorSize: "medium", weaponSize: "small", skills };

  test("automatic still means the better of the two", () => {
    assert.equal(attackSkillKey({ ...light }), "lightWeapon");
    assert.equal(attackSkillKey({ ...light, preferred: "" }), "lightWeapon");
  });

  /**
   * The whole report. A player may want the LOWER skill — a technick, a granted
   * reroll or a talent can be scoped to one of the two, and then the better raw
   * number is the worse attack.
   */
  test("a stated preference wins, even when it is the lower skill", () => {
    assert.equal(attackSkillKey({ ...light, preferred: "oneHanded" }), "oneHanded");
    assert.equal(attackSkillKey({ ...light, preferred: "lightWeapon" }), "lightWeapon");
  });

  /**
   * Inert where the rules give no choice. A weapon two or more sizes smaller
   * MUST use Light Weapon, so a preference for 1-Handed carried over from
   * another weapon must not route the attack through a skill the rule forbids.
   */
  test("it cannot override a case the rules do not leave open", () => {
    assert.equal(
      attackSkillKey({ ...light, weaponSize: "tiny", preferred: "oneHanded" }),
      "lightWeapon", "a two-sizes-smaller weapon has no choice to express");
    assert.equal(
      attackSkillKey({ wield: "twoHanded", skills, preferred: "lightWeapon" }),
      "twoHanded");
    assert.equal(
      attackSkillKey({ wield: "ranged", skills, preferred: "oneHanded" }), "ranged");
  });

  test("a preference outside the two falls back rather than being obeyed", () => {
    for (const junk of ["spellcraft", "unarmed", "zzNotASkill", null, undefined]) {
      assert.equal(attackSkillKey({ ...light, preferred: junk }), "lightWeapon",
        `${junk} must not become the attack skill`);
    }
  });

  test("Spellcraft weapons still outrank everything", () => {
    assert.equal(
      attackSkillKey({ ...light, category: "staves", preferred: "oneHanded" }),
      "spellcraft");
  });

  /**
   * REACHABLE, and on the weapon block specifically. The item sheet serves
   * seventeen subtypes from `{{#if}}` blocks, so a select anywhere in the file
   * proves nothing about the one the wielder opens.
   */
  test("the control is on the weapon block and the profile reads it", () => {
    const weaponBlock = itemTemplate.slice(
      itemTemplate.indexOf('(laeq itemType "weapon")'),
      itemTemplate.indexOf('(laeq itemType "armour")'));
    assert.match(weaponBlock, /name="system\.wieldSkill"/,
      "the field exists on the schema and the weapon block offers no way to set it");
    assert.match(read("module/sheets/item-sheet.mjs"), /wieldSkillOptions/);
    assert.match(read("module/dice/attack.mjs"),
      /wieldSkill: weapon\.system\.wieldSkill/,
      "the adapter never passes the stored preference, so setting it does nothing");
    for (const key of ["LASTARC.Field.WieldSkill", "LASTARC.WieldSkill.auto"]) {
      assert.ok(key in lang, `${key} would render as a raw key`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  #64 — Resilient                                                            */
/* -------------------------------------------------------------------------- */

describe("§64 Resilient adds to a Second Wind", () => {
  test("5 plus half level, rounded down", () => {
    assert.equal(resilientSecondWindBonus(1), 5);
    assert.equal(resilientSecondWindBonus(2), 6);
    assert.equal(resilientSecondWindBonus(3), 6);
    assert.equal(resilientSecondWindBonus(10), 10);
    assert.equal(resilientSecondWindBonus(11), 10);
  });

  /**
   * ADDED AFTER the max, not folded into it. Inside the `Math.max` the bonus
   * would do nothing for any character whose quarter-HP already exceeded it,
   * which past low levels is nearly everyone — the mechanic would look
   * implemented and be inert exactly where it matters.
   */
  test("it adds to the heal rather than competing with it", () => {
    const base = secondWindHeal(14, 60);          // max(14, 15) = 15
    assert.equal(base, 15);
    assert.equal(secondWindHeal(14, 60, 8), 23,
      "the bonus was swallowed by the max instead of added to it");
    assert.equal(secondWindHeal(14, 60, 0), base);
  });

  test("no bonus leaves the old behaviour exactly as it was", () => {
    for (const [vit, hp] of [[10, 20], [14, 60], [8, 100], [20, 4]]) {
      assert.equal(secondWindHeal(vit, hp), Math.max(vit, Math.floor(hp / 4)));
    }
  });

  test("a negative bonus cannot reduce a Second Wind", () => {
    assert.equal(secondWindHeal(14, 60, -100), 15);
  });

  /**
   * The flag has to be offered and read, or this is #59 all over again: a
   * mechanic that is correct and has no way to be declared.
   */
  test("the flag is offered, labelled, and read by the character model", () => {
    assert.ok(LASTARC.technickFlags.includes("resilient"));
    for (const key of ["LASTARC.TechnickFlag.resilient", "LASTARC.TechnickFlagHint.resilient"]) {
      assert.ok(key in lang, `${key} would render as a raw key`);
    }
    const character = read("module/data/character.mjs").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(character, /flags\?\.includes\("resilient"\)/,
      "nothing reads the flag, so ticking it does nothing");
    assert.match(character, /resilientSecondWindBonus\(level\)/,
      "the bonus must scale with level — a constant would be wrong at every " +
      "level but the one it was typed at");
    assert.match(character, /active !== false/,
      "a switched-off item still contributes the bonus");
  });

  test("the amount is config, not a number typed into the maths", () => {
    assert.equal(typeof LASTARC.resilientSecondWindBase, "number");
    assert.match(read("module/derivation.mjs"), /LASTARC\.resilientSecondWindBase/);
  });
});

/* -------------------------------------------------------------------------- */
/*  #65 — senses                                                               */
/* -------------------------------------------------------------------------- */

describe("§65 a character can record their senses", () => {
  test("the field exists and mirrors the statblock's", () => {
    assert.match(read("module/data/character.mjs"),
      /senses: new fields\.StringField/,
      "characters still have nowhere to write darkvision down");
    assert.match(read("module/data/npc.mjs"), /senses: new fields\.StringField/,
      "the two actor types have drifted to different shapes for one question");
  });

  test("there is an input for it on the character sheet", () => {
    assert.match(characterBody, /name="system\.details\.senses"/,
      "the field is storable and unauthorable, which is the defect it was " +
      "reported as");
  });

  /**
   * The race's senses are SHOWN, not written into the box. Derivation assigns
   * on every prepare, so a derived value with an input stores the number and
   * shows the old one back — that has shipped twice in this project already.
   */
  test("race senses are a readout beside the box, never written into it", () => {
    assert.match(read("module/sheets/character-sheet.mjs"), /context\.raceSenses/);
    assert.match(characterBody, /\{\{#if raceSenses\}\}/);
    assert.ok(!/system\.details\.senses"\s+value="\{\{raceSenses/.test(characterBody),
      "the race's senses are being used as the input's value, so anything the " +
      "player types is overwritten on the next prepare");
    assert.ok("LASTARC.Note.RaceSenses" in lang);
  });

  test("the sheet reads race items rather than the free-text race name", () => {
    const sheet = read("module/sheets/character-sheet.mjs");
    const block = sheet.slice(sheet.indexOf("context.raceSenses"), sheet.indexOf("context.raceSenses") + 300);
    assert.match(block, /type === "race"/,
      "details.race is a typed-in name and carries no senses; the senses live " +
      "on the race ITEM");
  });
});

/* -------------------------------------------------------------------------- */

describe("§ nothing here shipped as game content", () => {
  /**
   * Two of these came from homebrew and two from printed rules, and the
   * temptation with all four is to paste the entry that justifies them. The
   * content policy is absolute: mechanics yes, prose no.
   */
  test("no new lang string quotes the rulebook", () => {
    for (const key of ["LASTARC.TechnickFlagHint.resilient",
      "LASTARC.Note.WieldSkillOnlyLight", "LASTARC.Note.RaceSenses",
      "LASTARC.WeaponCategory.guns", "LASTARC.WeaponCategory.knuckles"]) {
      assert.ok(lang[key].length < 160, `${key} is long enough to be a quotation`);
    }
  });

  test("the compendium packs are still empty", () => {
    assert.deepEqual(JSON.parse(read("system.json")).packs, []);
  });
});
