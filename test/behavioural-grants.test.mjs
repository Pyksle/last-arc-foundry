/**
 * The Grants panel says whether an empty block is empty ON PURPOSE.
 *
 * `hasNumericGrants` was computed by two data models — technick/talent and
 * feature — and read by nothing. Its own comment said what it was for:
 * "Surfaced so the sheet can label it instead of showing a row of zeroes." The
 * sheet never got that label, which is this project's most-repeated defect:
 * correct, and wired to nothing.
 *
 * So this is the wiring, and it checks the whole chain rather than the maths:
 * the predicate answers, the sheet asks it, the template branches on the answer
 * — and, the part that matters most, the INPUTS SURVIVE the branch. Hiding an
 * editor because it is currently empty is how a field becomes unauthorable, and
 * the flag's original framing ("instead of showing a row of zeroes") is exactly
 * the sentence somebody writes just before doing that.
 *
 * Two things the old flag got wrong, pinned below so a future copy cannot:
 * only the feature copy counted `hp`/`mp`/`dr`, and neither counted a granted
 * reroll.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { aggregateGrants, hasGrantPayload } from "../module/derivation.mjs";
import { renderedItemSheets } from "../tools/preview.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const itemSheet = read("module/sheets/item-sheet.mjs");
const itemTemplate = read("templates/item/item-sheet.hbs");
const items = read("module/data/items.mjs");
const css = read("styles/last-arc.css");
const lang = JSON.parse(read("lang/en.json"));

/** One block per numeric field, each carrying that field and nothing else. */
const SOLE_PAYLOADS = {
  "defences.ref": { defences: { ref: 1 } },
  "defences.fort": { defences: { fort: 1 } },
  "defences.will": { defences: { will: 1 } },
  breakThreshold: { breakThreshold: 5 },
  heroPoints: { heroPoints: 1 },
  initiativeSteps: { initiativeSteps: 1 },
  speed: { speed: 2 },
  secondWindUses: { secondWindUses: 1 },
  hp: { hp: 3 },
  mp: { mp: 3 },
  dr: { dr: 1 },
  recoveryMinorActions: { recoveryMinorActions: 2 },
  "skills.focus": { skills: [{ key: "athletics", focus: 1 }] },
  "skills.bonus": { skills: [{ key: "athletics", bonus: 2 }] },
  "skills.trained": { skills: [{ key: "athletics", trained: true }] },
  ...Object.fromEntries(LASTARC.grantableRerollKinds.map((kind) => [
    `reroll.${kind}`, { reroll: { [kind]: true } }
  ]))
};

describe("§ a grants block that carries nothing", () => {
  test("nothing at all is not a payload", () => {
    assert.equal(hasGrantPayload(undefined), false);
    assert.equal(hasGrantPayload(null), false);
    assert.equal(hasGrantPayload({}), false);
  });

  test("a block of zeroes is not a payload", () => {
    assert.equal(hasGrantPayload({
      defences: { ref: 0, fort: 0, will: 0 },
      breakThreshold: 0, heroPoints: 0, initiativeSteps: 0, speed: 0,
      secondWindUses: 0, hp: 0, mp: 0, dr: 0,
      recoveryMinorActions: null,
      reroll: { ...Object.fromEntries(LASTARC.grantableRerollKinds.map((k) => [k, false])), skill: "" },
      skills: []
    }), false);
  });

  /**
   * `aggregateGrants` skips a row with no key, so a row added and not yet
   * filled in gives the actor nothing. If it counted here, pressing Add Skill
   * Grant would change the label before a word had been typed.
   */
  test("an unfilled skill row is not a payload", () => {
    assert.equal(hasGrantPayload({ skills: [{ key: "", focus: 0, bonus: 0, trained: false }] }), false);
    assert.equal(hasGrantPayload({ skills: [{ key: "athletics", focus: 0, bonus: 0, trained: false }] }),
      false, "a skill named and left at zero still changes nothing");
  });

  /**
   * Scoping a reroll to a skill without ticking a kind grants no reroll —
   * `aggregateGrants` pushes an entry only when a kind is true.
   */
  test("a reroll scoped to a skill but not ticked is not a payload", () => {
    assert.equal(hasGrantPayload({ reroll: { skill: "survival" } }), false);
    assert.deepEqual(aggregateGrants([{ reroll: { skill: "survival" } }]).rerolls, []);
  });
});

describe("§ every field the block can hold counts as a payload", () => {
  for (const [what, grants] of Object.entries(SOLE_PAYLOADS)) {
    test(`${what} alone is a payload`, () => {
      assert.equal(hasGrantPayload(grants), true,
        `a trait whose only effect is ${what} would be labelled behavioural`);
    });
  }

  /**
   * The regressions by name. The technick copy of the old flag omitted the
   * three below, so a technick granting hit points was reported as having no
   * numeric payload at all — and nothing read it, so nothing said so.
   */
  test("hp, mp and dr count — the technick copy of the old flag missed all three", () => {
    for (const key of ["hp", "mp", "dr"]) {
      assert.equal(hasGrantPayload({ [key]: 3 }), true, `${key} is not counted`);
    }
  });

  test("a granted reroll counts — neither copy of the old flag counted one", () => {
    for (const kind of LASTARC.grantableRerollKinds) {
      assert.equal(hasGrantPayload({ reroll: { [kind]: true } }), true, `${kind} is not counted`);
    }
  });

  /**
   * The guard against the two drifting apart again. The whole reason this moved
   * out of the data models is that two copies of one question disagreed for as
   * long as they existed; the predicate and the aggregation must not repeat it.
   */
  test("the predicate and the aggregate agree about what does something", () => {
    const baseline = JSON.stringify(aggregateGrants([]));
    for (const [what, grants] of Object.entries(SOLE_PAYLOADS)) {
      const changed = JSON.stringify(aggregateGrants([grants])) !== baseline;
      assert.equal(hasGrantPayload(grants), changed,
        `${what}: the predicate says ${hasGrantPayload(grants)} and aggregation ` +
        `says ${changed} — one of them is lying to the reader`);
    }
    // ...and the empty cases move nothing either.
    for (const inert of [{}, { skills: [{ key: "" }] }, { reroll: { skill: "survival" } }]) {
      assert.equal(JSON.stringify(aggregateGrants([inert])), baseline);
      assert.equal(hasGrantPayload(inert), false);
    }
  });
});

describe("§ the label actually reaches the sheet", () => {
  test("the item sheet asks the predicate and puts the answer in the context", () => {
    assert.match(itemSheet, /hasGrantPayload\(/,
      "nothing calls hasGrantPayload, so the flag is orphaned again");
    assert.match(itemSheet, /context\.behaviouralGrants\s*=/,
      "the sheet computes no behaviouralGrants flag for the template to read");
  });

  /**
   * The point of moving it out of the data models. Five subtypes carry a
   * `grants` block; only technick/talent and feature ever computed the old
   * flag, so an accessory with no numbers would have gone unlabelled. The
   * sheet's own gate is the whole set.
   */
  test("it is asked for every subtype with a grants block, not just two", () => {
    assert.match(itemSheet, /context\.behaviouralGrants\s*=\s*context\.hasGrants\s*&&/,
      "the note must hang off hasGrants, which is the full granting set");
    for (const type of ["technick", "talent", "accessory", "prostheticLimb", "feature"]) {
      assert.match(itemSheet, new RegExp(`"${type}"`), `${type} is not in GRANTING_TYPES`);
    }
  });

  test("the old per-model flag is gone rather than left beside the new one", () => {
    assert.ok(!/this\.hasNumericGrants\s*=/.test(items),
      "a data model still computes hasNumericGrants — two answers to one question " +
      "is what put this defect in the file to begin with");
  });

  test("the template branches on it and the string exists", () => {
    assert.match(itemTemplate, /\{\{#if behaviouralGrants\}\}/,
      "the template never reads the flag, so the label still does not exist");
    assert.match(itemTemplate, /LASTARC\.Note\.BehaviouralGrants/);
    assert.ok(lang["LASTARC.Note.BehaviouralGrants"],
      "LASTARC.Note.BehaviouralGrants is missing from lang/en.json");
    assert.match(css, /\.la-note--behavioural\s*\{/,
      "the modifier class is applied in the template and styled nowhere");
  });
});

describe("§ the note does not take the editor with it", () => {
  /**
   * THE ONE THAT MATTERS. `tools/preview.mjs` renders every item type with
   * `behaviouralGrants: true`, so this is the panel in the state where the
   * label shows. Every input must still be there.
   *
   * A grants block can only ever be filled in from this panel. Gating it on
   * "does it already have something in it" would make a behavioural technick
   * permanently behavioural — the shape of #32 and #39, where a field existed,
   * worked, and had no way to be entered.
   */
  const INPUTS = [
    "system.grants.defences.ref",
    "system.grants.defences.fort",
    "system.grants.defences.will",
    "system.grants.breakThreshold",
    "system.grants.heroPoints",
    "system.grants.initiativeSteps",
    "system.grants.speed",
    "system.grants.secondWindUses",
    "system.grants.recoveryMinorActions",
    "system.grants.hp",
    "system.grants.mp",
    "system.grants.dr"
  ];

  for (const type of ["technick", "talent", "accessory", "prostheticLimb", "feature"]) {
    test(`${type}: the label shows and every input is still rendered`, () => {
      const html = renderedItemSheets[type];
      assert.ok(html, `no rendered ${type} sheet — has the subtype been renamed?`);
      assert.ok(html.includes(lang["LASTARC.Note.BehaviouralGrants"]),
        "the behavioural note does not render at all");

      const missing = INPUTS.filter((name) => !html.includes(`name="${name}"`));
      assert.deepEqual(missing, [], `hidden behind the behavioural note:\n  ${missing.join("\n  ")}`);

      for (const kind of LASTARC.grantableRerollKinds) {
        assert.ok(html.includes(`name="system.grants.reroll.${kind}"`),
          `the ${kind} reroll checkbox is hidden behind the behavioural note`);
      }
      assert.ok(html.includes('data-action="addSkillGrant"'),
        "Add Skill Grant is hidden behind the behavioural note");
    });
  }
});
