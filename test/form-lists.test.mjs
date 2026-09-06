/**
 * The boxes that stand in for something the schema cannot bind to (#87).
 *
 * Reported as "languages don't save between sessions". They never saved at all,
 * and neither did eight other fields: senses, languages, fits and features on
 * items, all three prerequisite lists, the decay fractions, and the zero
 * dropping on prerequisite attributes.
 *
 * One cause for every one of them. `super._prepareSubmitData` ends with
 * `document.validate({changes, clean: true})`, and cleaning DELETES every key
 * the schema does not declare — a `*Text` box is exactly such a key. Both
 * sheets then read that cleaned object looking for the box. There was nothing
 * there, so the branch never ran, and the box accepted typing and dropped it.
 *
 * The unit suite could not see it: the repacking lives where only Foundry runs.
 * That is why these helpers are Foundry-free now.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  repackTextLists, repackNumberList, repackAttributeMap
} from "../module/sheets/form-lists.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const form = (object) => ({ object });

describe("§ comma boxes become the arrays they stand for", () => {
  test("a list is split, trimmed and written to the document path", () => {
    const submit = {};
    repackTextLists(form({ "system.details.languagesText": " Common , Elven ,Dwarven " }),
      submit, { "system.details.languagesText": "system.details.languages" });
    assert.deepEqual(submit.system.details.languages, ["Common", "Elven", "Dwarven"]);
  });

  /**
   * NESTED, not dotted. The submit object super returns is expanded — Foundry's
   * own subclasses write `submitData.text.markdown` — so a dotted key would sit
   * beside the real data and be ignored.
   */
  test("it writes a nested path, not a dotted key", () => {
    const submit = {};
    repackTextLists(form({ "system.sensesText": "Darkvision" }),
      submit, { "system.sensesText": "system.senses" });
    assert.deepEqual(submit, { system: { senses: ["Darkvision"] } });
    assert.equal(submit["system.senses"], undefined,
      "a dotted key would be ignored by the update");
  });

  test("empty entries and stray commas are dropped", () => {
    const submit = {};
    repackTextLists(form({ "a.bText": " , Common ,, " }), submit, { "a.bText": "a.b" });
    assert.deepEqual(submit.a.b, ["Common"]);
  });

  test("an empty box clears the list rather than leaving it", () => {
    const submit = {};
    repackTextLists(form({ "a.bText": "" }), submit, { "a.bText": "a.b" });
    assert.deepEqual(submit.a.b, [], "clearing the box could not clear the field");
  });

  /** A box that was not on this form must not clear the field behind it. */
  test("a box absent from the form is left alone", () => {
    const submit = { system: { senses: ["kept"] } };
    repackTextLists(form({}), submit, { "system.sensesText": "system.senses" });
    assert.deepEqual(submit.system.senses, ["kept"]);
  });

  test("it never reads the submit object", () => {
    const submit = { "system.details.languagesText": "Should, Be, Ignored" };
    repackTextLists(form({}), submit,
      { "system.details.languagesText": "system.details.languages" });
    assert.equal(submit.system, undefined,
      "reading the submit object is the whole bug — it has been cleaned by then");
  });

  test("several boxes repack in one pass", () => {
    const submit = {};
    repackTextLists(form({ "system.sensesText": "Scent", "system.featuresText": "Reach" }),
      submit, { "system.sensesText": "system.senses", "system.featuresText": "system.features" });
    assert.deepEqual(submit.system, { senses: ["Scent"], features: ["Reach"] });
  });
});

describe("§ the decay fractions", () => {
  test("non-negative numbers are kept, in order", () => {
    const submit = {};
    const r = repackNumberList(form({ "system.decayText": "1, 0.5, 0" }),
      submit, "system.decayText", "system.damageOverTime");
    assert.deepEqual(submit.system.damageOverTime, [1, 0.5, 0]);
    assert.equal(r.rejected, 0);
  });

  test("nonsense and negatives are dropped and counted", () => {
    const submit = {};
    const r = repackNumberList(form({ "system.decayText": "1, -2, banana, 3" }),
      submit, "system.decayText", "system.damageOverTime");
    assert.deepEqual(submit.system.damageOverTime, [1, 3]);
    assert.equal(r.rejected, 2, "the caller cannot warn about what it is not told");
  });

  test("a box absent from the form reports nothing at all", () => {
    const submit = {};
    assert.equal(repackNumberList(form({}), submit, "system.decayText", "x"), null);
    assert.deepEqual(submit, {});
  });
});

describe("§ attribute maps are rebuilt wholesale", () => {
  const boxes = {
    "p.attributes.str": "13", "p.attributes.vit": "0", "p.attributes.agi": ""
  };

  /**
   * A PREREQUISITE OF 0 IS NOT A REQUIREMENT. Keeping the zeros put six phantom
   * lines on every technick shared to chat (issue #15) — a fix that has been
   * inert ever since, because it read the cleaned submit object too.
   */
  test("zeros are dropped when the caller asks", () => {
    const submit = {};
    repackAttributeMap(form(boxes), submit, "p.attributes", { dropZero: true });
    assert.deepEqual(submit.p.attributes, { str: 13 });
  });

  /** A racial modifier of 0 and no racial modifier are different things. */
  test("…and kept when it does not", () => {
    const submit = {};
    repackAttributeMap(form(boxes), submit, "p.attributes", { dropZero: false });
    assert.deepEqual(submit.p.attributes, { str: 13, vit: 0 });
  });

  test("a blank box removes its key rather than storing nothing", () => {
    const submit = {};
    repackAttributeMap(form(boxes), submit, "p.attributes");
    assert.ok(!("agi" in submit.p.attributes),
      "a dotted path cannot express removal, which is why this rebuilds");
  });

  test("no boxes on the form leaves the map alone", () => {
    const submit = { p: { attributes: { str: 9 } } };
    repackAttributeMap(form({}), submit, "p.attributes");
    assert.deepEqual(submit.p.attributes, { str: 9 });
  });
});

describe("§ neither sheet reads the cleaned object again", () => {
  for (const sheet of ["module/sheets/item-sheet.mjs",
                       "module/sheets/character-sheet.mjs"]) {
    test(`${sheet.split("/").pop()} repacks from the form data`, () => {
      const src = read(sheet);
      const at = src.indexOf("_prepareSubmitData(event, form, formData, updateData) {");
      assert.notEqual(at, -1, "the handler is gone");
      const fn = src.slice(at, src.indexOf("\n  }", at));

      assert.match(fn, /LISTS\.repack/,
        "the sheet repacks by hand again instead of through the shared helpers");
      assert.ok(!/submit\[["'`]system\./.test(fn),
        "the sheet is reading a flat key out of the cleaned submit object — " +
        "validation deleted it, so the branch never runs");
      assert.ok(!/Object\.keys\(submit\)/.test(fn),
        "the sheet is scanning the cleaned submit object for form keys");
    });
  }
});
