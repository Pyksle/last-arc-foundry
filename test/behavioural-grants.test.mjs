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

/**
 * SOLE_PAYLOADS IS A HAND-WRITTEN LIST, AND THAT IS THE HAZARD.
 *
 * The drift test below walks it, so a grants field added to the schema and
 * wired into `aggregateGrants` but forgotten in `hasGrantPayload` passes the
 * whole suite — which is EXACTLY the mechanism that produced the two
 * disagreeing `hasNumericGrants` copies this work removed. Verified: adding an
 * `mpRegen` field to both the schema and the aggregate, and to neither the
 * predicate nor this list, left the suite fully green while a technick granting
 * it would be labelled as granting nothing.
 *
 * So the list is checked against the schema itself. `grantsSchema()` cannot be
 * imported — `module/data/items.mjs` evaluates `foundry.data.fields` at load
 * and there is no Foundry here — so it is read out of the source.
 */
const GRANTS_LEAVES = (() => {
  const src = items.match(/function grantsSchema\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  const out = [];
  const stack = [];
  for (const line of src.split("\n")) {
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();

    const nested = line.match(/^\s*(\w+):\s*new fields\.(?:Schema|Array)Field\(/);
    if (nested) { stack.push({ name: nested[1], indent }); continue; }

    const leaf = line.match(/^\s*(\w+):\s*new fields\.(Number|Boolean|String)Field\(/);
    if (leaf) out.push([...stack.map((x) => x.name), leaf[1]].join("."));
  }
  return out;
})();

/**
 * Leaves that legitimately do NOT count as a payload, each with its reason.
 * An entry here is a claim about the rules, checkable by reading them.
 */
const NOT_A_PAYLOAD = {
  // The row's identity, not an effect. A row with a key and nothing else
  // changes nothing, which is why `hasGrantPayload` requires key AND a value.
  "skills.key": "names which skill the row is about; carries no effect itself",
  // Which skill the reroll is limited to. Without a reroll kind ticked there
  // is no reroll to scope, so this alone is inert — asserted below.
  "reroll.skill": "scopes a reroll; inert unless a reroll kind is also set"
};

describe("§ the drift guard covers the whole schema", () => {
  test("the schema parse finds the fields it is meant to police", () => {
    // Without this the checks below pass over an empty list, which is how a
    // guard silently stops guarding.
    assert.ok(GRANTS_LEAVES.length >= 15,
      `only found ${GRANTS_LEAVES.length} grants leaves: ${GRANTS_LEAVES.join(", ")}`);
    for (const expected of ["defences.ref", "hp", "recoveryMinorActions",
      "skills.trained", "reroll.skill"]) {
      assert.ok(GRANTS_LEAVES.includes(expected),
        `${expected} is missing, so the parse is not reading the real schema`);
    }
  });

  test("every schema leaf is either exercised or excused", () => {
    const covered = new Set([
      ...Object.keys(SOLE_PAYLOADS),
      ...Object.keys(NOT_A_PAYLOAD),
      // The reroll booleans are generated into SOLE_PAYLOADS from config, and
      // the schema declares them the same way, so they never appear by name.
      ...LASTARC.grantableRerollKinds.map((k) => `reroll.${k}`)
    ]);
    // `skills.focus` etc. are listed under their own names in SOLE_PAYLOADS.
    const missing = GRANTS_LEAVES.filter((leaf) => !covered.has(leaf));

    assert.deepEqual(missing, [],
      "these grants fields exist on the schema and no case below exercises " +
      "them, so `hasGrantPayload` could ignore one and the suite would stay " +
      `green: ${missing.join(", ")}. Add a SOLE_PAYLOADS entry, or an excuse ` +
      "in NOT_A_PAYLOAD saying why the field is not an effect.");
  });

  test("the excused leaves really are inert", () => {
    assert.equal(hasGrantPayload({ skills: [{ key: "athletics" }] }), false);
    assert.equal(hasGrantPayload({ reroll: { skill: "survival" } }), false);
  });
});

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
    /**
     * THE NEGATION IS PART OF THE ASSERTION. Without it, inverting the line —
     * so the note appears on exactly the items that DO grant numbers and hides
     * on the ones that do not — passes the whole suite. Verified by mutation.
     */
    assert.match(itemSheet,
      /context\.behaviouralGrants\s*=\s*context\.hasGrants\s*&&\s*!\s*D\.hasGrantPayload\(/,
      "the note must hang off hasGrants AND the negated predicate; dropping the " +
      "`!` shows the label on every item that actually grants something");

    /**
     * Read out of the GRANTING_TYPES DECLARATION, not searched for in the file.
     *
     * The first version of this matched `"technick"` anywhere in item-sheet.mjs
     * — and line 82 says `item.type === "technick" || item.type === "talent"`
     * for an unrelated reason, so both literals were present whether or not the
     * set held them. Deleting `technick` from GRANTING_TYPES removes the whole
     * Grants panel from the most-used granting subtype in the system, and the
     * suite stayed green. A guard satisfied by a line it is not about is not a
     * guard.
     */
    const declared = itemSheet.match(/GRANTING_TYPES\s*=\s*new Set\(\[([^\]]*)\]/)?.[1];
    assert.ok(declared, "GRANTING_TYPES is not a literal Set any more — this " +
      "guard has lost its target and would assert nothing");
    const inSet = [...declared.matchAll(/"([\w]+)"/g)].map((m) => m[1]);
    assert.deepEqual(inSet.sort(),
      ["accessory", "feature", "prostheticLimb", "talent", "technick"].sort(),
      "GRANTING_TYPES must name exactly the subtypes whose schema carries a " +
      "grants block — a missing one loses its whole Grants panel");
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
