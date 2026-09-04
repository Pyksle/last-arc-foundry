/**
 * What a race actually grants (#79).
 *
 * The `race` item had eight fields. One was read. The other seven had inputs on
 * its sheet and no reader anywhere, so a GM could fill the whole form in and
 * change nothing — and the comment sitting above the last two said the rule out
 * loud ("a field with no reader does not need an input, it needs deleting")
 * while claiming those two were "what derivation actually consumes". Derivation
 * had never heard of them.
 *
 * Four were duplicates of character fields that already work. Two were
 * allowances and belong in `grants`, because a technick grants an extra trained
 * skill too. And one — the attribute cap — turned out to be dead on the
 * CHARACTER as well: a box on the most-used sheet in the system, enforcing
 * nothing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  aggregateGrants, hasGrantPayload, trainedSkillCount, overAttributeCap
} from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

describe("§ allowances are grants, not race fields", () => {
  test("they aggregate across traits", () => {
    const out = aggregateGrants([
      { trainedSkills: 1, bonusTechnicks: 1 },
      { trainedSkills: 2 }
    ]);
    assert.equal(out.trainedSkills, 3);
    assert.equal(out.bonusTechnicks, 1);
  });

  test("a trait granting neither contributes nothing", () => {
    const out = aggregateGrants([{}, null]);
    assert.equal(out.trainedSkills, 0);
    assert.equal(out.bonusTechnicks, 0);
  });

  /** An allowance is a payload: the Grants panel must not call it empty. */
  test("either one alone counts as a payload", () => {
    assert.equal(hasGrantPayload({ trainedSkills: 1 }), true);
    assert.equal(hasGrantPayload({ bonusTechnicks: 1 }), true);
    assert.equal(hasGrantPayload({ trainedSkills: 0, bonusTechnicks: 0 }), false);
  });

  test("the race item carries the same grants block as everything else", () => {
    const models = read("module/data/items.mjs");
    const at = models.indexOf("export class LastArcRaceData");
    const body = models.slice(at, models.indexOf("\n}", at));
    assert.match(body, /grants: grantsSchema\(\)/,
      "a race cannot grant what a technick can");
  });

  /**
   * The seven dead fields. Removing a field is safe — Foundry drops
   * unrecognised `system` keys during cleanData — but leaving one is not, and
   * this is the guard that says so.
   */
  test("the dead race fields are gone from the model and the sheet", () => {
    const models = read("module/data/items.mjs");
    const at = models.indexOf("export class LastArcRaceData");
    const body = models.slice(at, models.indexOf("\n}", at));
    // DECLARATIONS, not the words — the comment above them names every field
    // it retired, and a guard its own explanation trips is one people delete.
    for (const dead of ["attributeMods:", "attributeCaps:", "bonusTrainedSkills:",
                        "languages: new fields", "speed: new fields"]) {
      assert.ok(!body.includes(dead), `${dead} is still declared on the race item`);
    }
    const template = read("templates/item/item-sheet.hbs");
    for (const dead of ["system.attributeMods.", "system.attributeCaps.",
                        "system.bonusTrainedSkills"]) {
      assert.ok(!template.includes(dead), `${dead} still has an input`);
    }
  });
});

describe("§ no species is named in the maths", () => {
  const base = trainedSkillCount("rogue", 0, 0);

  test("a granted allowance raises the count", () => {
    assert.equal(trainedSkillCount("rogue", 0, 1), base + 1);
    assert.equal(trainedSkillCount("rogue", 0, 3), base + 3);
  });

  test("Intelligence still counts, and so does nothing", () => {
    assert.equal(trainedSkillCount("rogue", 2, 0), base + 2);
    assert.equal(trainedSkillCount("rogue", 0, 0), base);
  });

  test("a negative allowance cannot take skills away", () => {
    assert.equal(trainedSkillCount("rogue", 0, -5), base);
  });

  /**
   * A `half-elf` slug used to be tested in the character model and fed a
   * hardcoded +1. One species in the arithmetic meant the human racial that
   * grants the same thing did nothing at all.
   */
  test("half-elf is no longer special-cased anywhere", () => {
    // In CODE. Both files explain in prose what they stopped doing, which is
    // the note worth keeping — it is the identifier that must not come back.
    const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    assert.ok(!/halfElf|half-elf/.test(code("module/data/character.mjs")),
      "a species is still named in the character model");
    assert.ok(!/halfElf|half-elf/.test(code("module/derivation.mjs")),
      "a species is still named in the maths");
    assert.ok(!/halfElf/.test(read("templates/actor/character-body.hbs")),
      "the sheet still reads a field named for one species");
  });

  test("the model passes the granted allowance through", () => {
    assert.match(read("module/data/character.mjs"), /grants\.trainedSkills/,
      "the allowance is aggregated and then dropped");
  });
});

describe("§ the attribute cap finally does something", () => {
  test("over the cap is over the cap", () => {
    assert.equal(overAttributeCap(21, 20), true);
    assert.equal(overAttributeCap(20, 20), false, "at the cap is legal");
    assert.equal(overAttributeCap(19, 20), false);
  });

  /** A half-filled sheet must not report every attribute as illegal. */
  test("no cap stated is not a cap of zero", () => {
    assert.equal(overAttributeCap(18, 0), false);
    assert.equal(overAttributeCap(18), false);
    assert.equal(overAttributeCap(18, -1), false);
  });

  /**
   * REPORTED, never clamped. `value` is an input, and `prepareDerivedData`
   * writing a clamped number back would store the clamp and show the reader
   * the old one — the trap this codebase has shipped twice.
   */
  test("the model reports it and never writes the score back", () => {
    const model = read("module/data/character.mjs");
    assert.match(model, /attr\.overCap = D\.overAttributeCap\(/,
      "nothing computes whether an attribute is over its cap");
    assert.ok(!/attr\.value = /.test(model),
      "the derivation writes back over the attribute input, so the box will lie");
  });

  test("the sheet shows it where the cap is typed", () => {
    const body = read("templates/actor/character-body.hbs");
    const at = body.indexOf('name="system.attributes.{{this.key}}.cap"');
    assert.notEqual(at, -1, "the cap input is gone");
    const near = body.slice(at - 200, at + 400);
    assert.match(near, /this\.overCap/,
      "a score over the cap is stored, computed, and shown nowhere");
  });
});
