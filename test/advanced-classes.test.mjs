/**
 * Classes as documents, so advanced classes can exist at all.
 *
 * Every class number used to come from `LASTARC.classes`, and the character's
 * class field was `choices: Object.keys(LASTARC.classes)`. That pairing is what
 * capped the game at six classes: whatever a GM authored, a character could not
 * name it. The full release adds dozens of advanced classes, and they belong to
 * a book this repo cannot redistribute — so the numbers have to come from
 * documents the GM authors, with the shipped six as the fallback.
 *
 * The rules an advanced class needs that a base class does not:
 *
 *   - it grants its defence bonus even as a second class, because the book
 *     states that bonus at the advanced class's OWN first level;
 *   - it has no level-1 HP/MP grant, because the earliest one can be taken is
 *     character level 8, so it is never the first class;
 *   - it does not set the initiative die, because none of them print one.
 *
 * All three are invisible to a test that only checks the totals went up.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  classSlug,
  normaliseShippedClass,
  normaliseClassItem,
  buildClassCatalogue,
  resolveClass,
  classOptions
} from "../module/class-source.mjs";
import { hpMax, mpMax, classDefenceBonuses, trainedSkillCount } from "../module/derivation.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** A GM-authored advanced class, in the shape a `class` item stores. */
const zzAdvanced = {
  type: "class",
  name: "ZZ Advanced",
  system: {
    slug: "zz-advanced",
    hp: { first: 24, perLevel: 5 },
    mp: { first: 6, perLevel: 3 },
    initiativeDie: "d4",
    defences: { ref: 2, fort: 0, will: 4 },
    trainedSkills: 0,
    isAdvanced: true
  }
};

/** The same, but a base class — for the override cases. */
const zzWarrior = {
  type: "class",
  name: "ZZ Warrior",
  system: {
    slug: "warrior",
    hp: { first: 99, perLevel: 9 },
    mp: { first: 1, perLevel: 1 },
    initiativeDie: "d20",
    defences: { ref: 7, fort: 7, will: 7 },
    trainedSkills: 1,
    isAdvanced: false
  }
};

describe("a class name resolves to one stat block", () => {
  test("slugs normalise the same way from either side", () => {
    assert.equal(classSlug("Blade Dancer"), "blade-dancer");
    assert.equal(classSlug("blade dancer"), "blade-dancer");
    assert.equal(classSlug("  Fell  Knight!  "), "fell-knight");
    assert.equal(classSlug(""), "");
  });

  test("the shipped table normalises without inventing numbers", () => {
    const w = normaliseShippedClass(LASTARC.classes.warrior);
    assert.equal(w.hpFirst, LASTARC.classes.warrior.hp1);
    assert.equal(w.hpPer, LASTARC.classes.warrior.hpPer);
    assert.equal(w.initDie, LASTARC.classes.warrior.initDie);
    assert.deepEqual(w.defences,
      { ref: LASTARC.classes.warrior.ref, fort: LASTARC.classes.warrior.fort,
        will: LASTARC.classes.warrior.will });
    assert.equal(w.isAdvanced, false, "nothing the system ships is an advanced class");
  });

  /**
   * `trainedSkills: null` means "not read in from the book yet" and must stay
   * null. Coerced to 0 it becomes a silent, plausible, wrong allowance — which
   * is the whole reason `trainedSkillCount` throws on it (issue #34).
   */
  test("an unset trained-skill allowance is not coerced to zero", () => {
    assert.equal(normaliseShippedClass({ trainedSkills: null }).trainedSkills, null);
    assert.equal(normaliseShippedClass({}).trainedSkills, 0);
  });

  test("an authored class item normalises to the same shape", () => {
    const a = normaliseClassItem(zzAdvanced);
    assert.equal(a.hpPer, 5);
    assert.equal(a.mpPer, 3);
    assert.equal(a.initDie, "d4");
    assert.deepEqual(a.defences, { ref: 2, fort: 0, will: 4 });
    assert.equal(a.isAdvanced, true);
    assert.equal(a.label, "ZZ Advanced", "a GM-authored class has no localisation key");
  });

  test("the shipped six are all still reachable", () => {
    const cat = buildClassCatalogue();
    for (const key of Object.keys(LASTARC.classes)) {
      assert.ok(resolveClass(key, cat), `${key} stopped resolving`);
    }
  });

  test("an authored class is reachable and a missing one is null", () => {
    const cat = buildClassCatalogue({ world: [zzAdvanced] });
    assert.ok(resolveClass("zz-advanced", cat));
    assert.equal(resolveClass("zz-nonexistent", cat), null);
    assert.equal(resolveClass("", cat), null);
  });

  /**
   * A stored name is normally already a catalogue key, because the dropdown is
   * the only thing that writes it. This is for the one that was not: a
   * hand-edited world, or an import that kept the printed name.
   */
  test("a stored name that is not already a slug still resolves", () => {
    const cat = buildClassCatalogue({ world: [zzAdvanced] });
    assert.ok(resolveClass("ZZ Advanced", cat), "a printed class name did not resolve");
    assert.ok(resolveClass("Warrior", cat), "a capitalised shipped class did not resolve");
  });

  test("a class item falls back to its name when the slug is blank", () => {
    const cat = buildClassCatalogue({ world: [{ ...zzAdvanced, system: { ...zzAdvanced.system, slug: "" } }] });
    assert.ok(resolveClass("zz-advanced", cat), "the name did not stand in for a blank slug");
  });

  /**
   * Order is the whole point of the catalogue. An actor's own copy beats the
   * world's, and both beat the shipped table — otherwise a GM cannot correct a
   * class for their table, which is the reason the numbers moved out of config.
   */
  test("owned beats world beats shipped", () => {
    const shipped = resolveClass("warrior", buildClassCatalogue());
    assert.equal(shipped.hpFirst, LASTARC.classes.warrior.hp1);

    const world = resolveClass("warrior", buildClassCatalogue({ world: [zzWarrior] }));
    assert.equal(world.hpFirst, 99, "a world class item did not override the shipped table");

    const owned = resolveClass("warrior", buildClassCatalogue({
      world: [zzWarrior],
      owned: [{ ...zzWarrior, system: { ...zzWarrior.system, hp: { first: 50, perLevel: 5 } } }]
    }));
    assert.equal(owned.hpFirst, 50, "the actor's own class item did not win");
  });

  test("non-class items in the list are ignored", () => {
    const cat = buildClassCatalogue({ world: [{ type: "weapon", name: "warrior", system: {} }] });
    assert.equal(resolveClass("warrior", cat).hpFirst, LASTARC.classes.warrior.hp1,
      "a weapon named like a class rewrote the class");
  });

  /**
   * The early-sorting fixture is the whole test. This asserted that the last
   * option was the advanced one, using a fixture slugged `zz-advanced` — which
   * sorts last alphabetically anyway, so the assertion held with the grouping
   * removed entirely and vouched for nothing. Caught by mutation, not by review.
   */
  test("the dropdown lists everything, base classes first, advanced marked", () => {
    const early = { ...zzAdvanced, name: "AAA probe",
      system: { ...zzAdvanced.system, slug: "aaa-probe" } };
    const opts = classOptions(buildClassCatalogue({ world: [early, zzAdvanced] }));
    const values = opts.map((o) => o.value);
    assert.ok(values.includes("zz-advanced"), "an authored class was not offered");
    assert.ok(values.includes("aaa-probe"));

    const firstAdvanced = opts.findIndex((o) => o.isAdvanced);
    assert.ok(firstAdvanced > 0, "an advanced class was listed before every base class");
    assert.ok(opts.slice(firstAdvanced).every((o) => o.isAdvanced),
      "an advanced class was interleaved with the base ones");
    assert.equal(opts[firstAdvanced].value, "aaa-probe",
      "the alphabetical tie-break within the advanced group was lost");
  });
});

describe("an advanced class earns its levels without a level-1 grant", () => {
  const cat = () => buildClassCatalogue({ world: [zzAdvanced] });
  const split = [{ name: "warrior", levels: 7 }, { name: "zz-advanced", levels: 3 }];

  test("HP is the base class's opening plus per-level from both", () => {
    // warrior: 30 first + 6 x 6 remaining; advanced: 5 x 3. Vit +0 throughout.
    assert.equal(hpMax(split, 0, cat()), 30 + 6 * 6 + 3 * 5);
  });

  test("MP likewise", () => {
    assert.equal(mpMax(split, 0, cat()), 6 + 6 * 2 + 3 * 3);
  });

  /**
   * A malformed list can put an advanced class first. It must not read the
   * class item's level-1 field — the schema gives that a default like any other
   * number, so a base class's opening hit points would be handed to a class
   * that has none — and it must not produce NaN, which silently poisons the
   * Break Gauge, the Threshold and every comparison downstream.
   */
  test("an advanced class first falls back to per-level, never NaN", () => {
    const only = hpMax([{ name: "zz-advanced", levels: 3 }], 0, cat());
    assert.ok(Number.isFinite(only), "an advanced class first produced a non-number");
    assert.equal(only, 5 * 3, "it borrowed a level-1 grant it is not entitled to");
  });

  test("an unresolvable class throws rather than guessing", () => {
    assert.throws(() => hpMax([{ name: "zz-deleted", levels: 3 }], 0, cat()),
      /Unknown class/);
  });
});

describe("an advanced class always grants its defence bonus", () => {
  const cat = () => buildClassCatalogue({ world: [zzAdvanced] });

  /**
   * The `regrantOnMulticlass` argument is the A5 argument about a second BASE
   * class. An advanced class is not that argument: every one of them prints its
   * bonus at its own 1st level, and it is the only defence bonus that class
   * will ever give. Gated on the setting, a GM reading A5 strictly would get
   * advanced classes that silently grant nothing.
   */
  test("even as a second class, with the multiclass regrant off", () => {
    const got = classDefenceBonuses(
      [{ name: "warrior", levels: 7 }, { name: "zz-advanced", levels: 3 }], false, cat());
    assert.deepEqual(got, {
      ref: LASTARC.classes.warrior.ref + 2,
      fort: LASTARC.classes.warrior.fort + 0,
      will: LASTARC.classes.warrior.will + 4
    });
  });

  test("a second BASE class still obeys the setting", () => {
    const classes = [{ name: "warrior", levels: 7 }, { name: "mage", levels: 3 }];
    assert.deepEqual(classDefenceBonuses(classes, false, cat()),
      { ref: LASTARC.classes.warrior.ref,
        fort: LASTARC.classes.warrior.fort,
        will: LASTARC.classes.warrior.will },
      "a second base class regranted while the setting was off");
    assert.notDeepEqual(classDefenceBonuses(classes, true, cat()),
      classDefenceBonuses(classes, false, cat()),
      "the setting stopped doing anything");
  });

  test("the bonus is not double-counted when it is also first", () => {
    const got = classDefenceBonuses([{ name: "zz-advanced", levels: 3 }], false, cat());
    assert.deepEqual(got, { ref: 2, fort: 0, will: 4 });
  });
});

describe("the trained-skill allowance comes from the same catalogue", () => {
  test("an authored class reports its own number", () => {
    const cat = buildClassCatalogue({ world: [zzWarrior] });
    assert.equal(trainedSkillCount("warrior", 0, false, cat), 1,
      "the shipped allowance was used instead of the authored one");
  });

  test("an unset allowance still refuses to guess", () => {
    const cat = buildClassCatalogue({ shipped: { zzUnset: { trainedSkills: null } } });
    assert.throws(() => trainedSkillCount("zzUnset", 0, false, cat), /not set/);
  });
});

describe("the character can actually name an advanced class", () => {
  const model = read("module/data/character.mjs");

  /**
   * This is the defect, not a style point. `choices: Object.keys(LASTARC.classes)`
   * meant the schema rejected any class the system did not ship, so a GM could
   * author a Dragoon and no character could ever be one.
   */
  test("the class name is no longer restricted to the shipped six", () => {
    const block = model.slice(model.indexOf("classes: new fields.ArrayField"),
                              model.indexOf("resources: new fields.SchemaField"));
    assert.ok(!/choices:/.test(block),
      "the class name still has a choices list, so authored classes are unusable");
  });

  /** Retired: read by nothing, and the wrong shape — levels are taken IN an
   *  advanced class, so it is another entry rather than a label on a base one. */
  test("the dead advanced free-text field is gone everywhere", () => {
    assert.ok(!/advanced: new fields\.StringField/.test(model), "still in the schema");
    assert.ok(!/system\.classes\.\{\{this\.index\}\}\.advanced/
      .test(read("templates/actor/character-header.hbs")), "still an input on the sheet");
    assert.ok(!/advanced: null/.test(read("module/sheets/character-sheet.mjs")),
      "the add-class handler still writes it");
    assert.ok(!/LASTARC\.Field\.AdvancedClass"/.test(read("lang/en.json")),
      "the label for the removed box is still shipped");
  });

  test("every consumer reads the resolved catalogue, not the config table", () => {
    for (const call of ["D.hpMax(", "D.mpMax(", "D.classDefenceBonuses(", "D.trainedSkillCount("]) {
      const at = model.indexOf(call);
      assert.notEqual(at, -1, `${call} vanished`);
      assert.ok(/classes\s*\)|catalogue\s*\)/.test(model.slice(at, at + 200)),
        `${call} is not being handed the catalogue`);
    }
    assert.ok(!/LASTARC\.classes\[this\.classes\[0\]\.name\]/.test(model),
      "the initiative die still reaches straight into the shipped table");
  });
});
