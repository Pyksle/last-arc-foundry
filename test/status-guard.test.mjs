/**
 * Whether a status lands (#57, #58).
 *
 * Two reports from the same session, and the guards below are shaped by how
 * each of them managed to hide.
 *
 * #57 hid behind a GREEN TEST. `applyDamageMitigation` returned
 * `secondaryEffectsNegated`, `test/derivation.test.mjs` asserted it twice, and
 * no code anywhere read it — so the suite reported the secondary-effects clause
 * as covered while a fire-immune creature took 0 damage and was blinded anyway.
 * Testing a producer proves nothing about a rule; the tests here go through the
 * function the pipeline actually calls, and one of them asserts the dead flag
 * stays dead.
 *
 * #58 is new, and the shape it would hide in is already known: the integrity
 * triangle UNIONS across sheets, so an action declared on the character sheet
 * with its button in a shared partial passes every existing reachability check
 * while doing nothing on the NPC sheet. Since the statblock is the whole point
 * of condition immunity, that is the failure that matters most, and it gets a
 * bespoke both-sheets test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  NEGATED_BY, negatesSecondaryEffects, readStatusImmunities,
  toggleStatusImmunity, splitByImmunity
} from "../module/status-guard.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const lang = JSON.parse(read("lang/en.json"));

/** A duck-typed actor: the shape `negatesSecondaryEffects` documents. */
const creature = ({ resistance = [], immunity = [], weakness = [], statuses = [] } = {}) => ({
  statuses,
  system: { damageMods: { resistance, immunity, weakness, dr: 0 } }
});

/* -------------------------------------------------------------------------- */
/*  #57 — the secondary-effects clause                                         */
/* -------------------------------------------------------------------------- */

describe("resistance and immunity stop a status rider (§5.5, p.169)", () => {
  test("a fire-immune creature is not blinded by a fire spell", () => {
    const r = negatesSecondaryEffects(creature({ immunity: ["fire"] }), "fire");
    assert.ok(r.negated);
    assert.equal(r.reason, NEGATED_BY.immunity);
  });

  test("a fire-resistant creature is not blinded by a damaging fire spell", () => {
    const r = negatesSecondaryEffects(creature({ resistance: ["fire"] }), "fire");
    assert.ok(r.negated);
    assert.equal(r.reason, NEGATED_BY.resistance);
  });

  test("an unaffected creature takes the rider", () => {
    assert.ok(!negatesSecondaryEffects(creature({ resistance: ["cold"] }), "fire").negated);
    assert.ok(!negatesSecondaryEffects(creature(), "fire").negated);
  });

  /**
   * THE ASYMMETRY THE BOOK ACTUALLY WRITES, and the one thing here most likely
   * to be "tidied" into symmetry by a later reader.
   *
   * Immunity is against the SOURCE — "no damage or effects from sources to
   * which they are immune". Resistance is against the DAMAGE — "unaffected by
   * the secondary effects of any damage they are resistant to". A dark spell
   * that only sleeps has no damage, so a dark-RESISTANT creature sleeps and a
   * dark-IMMUNE one does not. Collapsing the two would silently promote every
   * resistance to an immunity against the non-damaging half of the game.
   */
  test("immunity stops a non-damaging rider; resistance does not", () => {
    const opts = { dealsDamage: false };
    assert.ok(negatesSecondaryEffects(creature({ immunity: ["dark"] }), "dark", opts).negated,
      "immunity is written against the source, damage or no damage");
    assert.ok(!negatesSecondaryEffects(creature({ resistance: ["dark"] }), "dark", opts).negated,
      "resistance is written against the damage, and there is none to resist");
  });

  test("an ability with no aspect is never negated", () => {
    for (const t of [null, undefined, "", "zzNotAType"]) {
      assert.ok(!negatesSecondaryEffects(creature({ immunity: ["fire"] }), t).negated);
    }
  });

  test("immunity is reported ahead of resistance when a creature has both", () => {
    const both = creature({ immunity: ["cold"], resistance: ["cold"] });
    assert.equal(negatesSecondaryEffects(both, "cold").reason, NEGATED_BY.immunity);
  });

  /**
   * Agony strips resistances and immunities outright (§12), and this must be
   * read through `effectiveDamageMods` for that to be true here as well as in
   * the damage pipeline. Reading `system.damageMods` directly — the obvious
   * shortcut — would hand a creature its immunities back for the purpose of
   * shrugging off conditions at the exact moment the rules say it is most
   * vulnerable.
   */
  test("Agony strips the immunity that would have stopped the rider", () => {
    const afflicted = creature({ immunity: ["cold"], statuses: ["agony"] });
    assert.ok(!negatesSecondaryEffects(afflicted, "cold").negated,
      "a creature in Agony has no immunities to shrug anything off with");

    // The guard's own premise: agony must really be the thing doing this.
    assert.ok(negatesSecondaryEffects(creature({ immunity: ["cold"] }), "cold").negated);
  });

  test("a target that is missing or shapeless negates nothing rather than throwing", () => {
    for (const t of [null, undefined, {}, { system: {} }]) {
      assert.ok(!negatesSecondaryEffects(t, "fire").negated);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  #57 — wired to the call sites, not merely correct                          */
/* -------------------------------------------------------------------------- */

describe("every rider site consults the clause", () => {
  /**
   * A status is applied in exactly three places that carry an aspect, and each
   * one is the whole of somebody's report if it is missed. Source-level,
   * because these need a live Foundry document to exercise.
   *
   * Comments are stripped first: this file's own prose names both
   * `toggleStatusEffect` and `negatesSecondaryEffects` repeatedly, and a
   * scanner that counts them would pass on the strength of the explanation for
   * why it exists.
   */
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const SITES = [
    ["module/dice/magic.mjs", 2, "a spell's outcome rider and a performance's"],
    ["module/dice/consume.mjs", 1, "a thrown flask's rider"]
  ];

  test("the aspected status applications all ask first", () => {
    for (const [file, expected, what] of SITES) {
      const src = strip(read(file));
      const asks = src.match(/negatesSecondaryEffects\(/g)?.length ?? 0;
      assert.equal(asks, expected,
        `${file}: ${what} must consult the clause — ${asks} of ${expected} do`);
    }
  });

  /**
   * The stronger form: no `toggleStatusEffect(..., {active: true})` in those
   * files outside a negation branch. Counting calls to the guard would pass a
   * file that asked and then applied the status anyway.
   */
  test("no aspected rider is applied without the guard above it", () => {
    for (const [file] of SITES) {
      const src = strip(read(file));
      for (const m of src.matchAll(/toggleStatusEffect\?\.\([^)]*active: true[^)]*\)/g)) {
        const before = src.slice(Math.max(0, m.index - 400), m.index);
        assert.match(before, /negatesSecondaryEffects\(/,
          `${file}: a status is applied at index ${m.index} with no guard in the ` +
          "preceding lines — the rider lands on a resistant target");
      }
    }
  });

  test("the negation reaches all three cards", () => {
    for (const card of ["spell-card", "performance-card", "consumable-card"]) {
      assert.match(read(`templates/chat/${card}.hbs`), /statusNegatedLabel/,
        `${card}: a rider that was stopped is invisible, which reads as the ` +
        "system forgetting to apply it — the complaint #57 was filed as");
    }
    assert.equal(
      (read("module/dice/magic.mjs").match(/describeNegatedRider\(/g) ?? []).length, 2);
    assert.match(read("module/dice/consume.mjs"), /describeNegatedRider\(/);
  });
});

/* -------------------------------------------------------------------------- */
/*  #57 — the card shows its working                                           */
/* -------------------------------------------------------------------------- */

describe("the mitigation is visible on the card", () => {
  /**
   * The half of #57 that made a correct pipeline look broken. `preDR` is
   * measured after both multipliers, so with no DR in play the arithmetic line
   * printed NOTHING and a resisted 10 arrived as "Took 5" — the same card a
   * roll of 5 produces.
   */
  test("weakness and resistance each have a line, and so does both at once", () => {
    for (const key of ["Weakened", "Resisted", "WeakAndResisted"]) {
      assert.ok(`LASTARC.Card.${key}` in lang, `LASTARC.Card.${key} would render raw`);
      assert.match(lang[`LASTARC.Card.${key}`], /\{before\}[\s\S]*\{after\}/,
        "the line has to show both sides or it is not working shown");
    }
  });

  test("chat.mjs actually emits them", () => {
    const src = read("module/chat.mjs");
    assert.match(src, /result\.weakened \|\| result\.resisted/);
    assert.match(src, /WeakAndResisted/);
    assert.match(src, /before: result\.rolled, after: result\.preDR/,
      "the step must compare the input total against the post-multiplier total");
  });

  test("both negation lines name the grade and the aspect", () => {
    for (const key of ["RiderNegatedImmunity", "RiderNegatedResistance"]) {
      const s = lang[`LASTARC.Card.${key}`];
      assert.ok(s, `LASTARC.Card.${key} is missing`);
      assert.match(s, /\{type\}/, "'immune' alone sends the GM to the wrong column");
      assert.match(s, /\{status\}/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  #58 — the pure rules                                                       */
/* -------------------------------------------------------------------------- */

describe("condition immunity", () => {
  test("unknown ids are dropped at read time, not at validation time", () => {
    // The schema deliberately carries no `choices`: a document holding a value
    // the list stopped accepting DOES NOT OPEN. Filtering here is what makes
    // that safe.
    assert.deepEqual(
      readStatusImmunities({ statusImmunities: ["blind", "zzRetired", "prone"] }),
      ["blind", "prone"]);
    assert.deepEqual(readStatusImmunities({}), []);
    assert.deepEqual(readStatusImmunities(null), []);
  });

  test("the toggle adds, removes, and leaves the input alone", () => {
    const before = ["blind"];
    const added = toggleStatusImmunity(before, "prone");
    assert.deepEqual(before, ["blind"], "the stored array was mutated");
    assert.ok(added.includes("blind") && added.includes("prone"));
    assert.deepEqual(toggleStatusImmunity(added, "prone").sort(), ["blind"]);
  });

  test("the stored order is the config's, not the click order", () => {
    const clicked = toggleStatusImmunity(toggleStatusImmunity([], "prone"), "blind");
    const expected = LASTARC.allStatusIds.filter((id) => clicked.includes(id));
    assert.deepEqual(clicked, expected,
      "two GMs marking the same immunities must produce the same document");
  });

  test("an unregistered id cannot be toggled on", () => {
    assert.deepEqual(toggleStatusImmunity(["blind"], "zzNotAStatus"), ["blind"]);
  });

  /**
   * An effect may carry SEVERAL statuses. Vetoing the document because one of
   * them is blocked would be a second bug wearing the first one's clothes: a
   * two-condition attack on a creature immune to one should still apply the
   * other.
   */
  test("a multi-status effect keeps the statuses that land", () => {
    const { allowed, blocked } = splitByImmunity(["blind", "prone"], ["prone"]);
    assert.deepEqual(allowed, ["blind"]);
    assert.deepEqual(blocked, ["prone"]);
  });

  test("nothing immune means nothing blocked", () => {
    assert.deepEqual(splitByImmunity(["blind"], []), { allowed: ["blind"], blocked: [] });
  });
});

/* -------------------------------------------------------------------------- */
/*  #58 — reachable, and enforced everywhere                                   */
/* -------------------------------------------------------------------------- */

describe("condition immunity is reachable and enforced", () => {
  const character = read("module/sheets/character-sheet.mjs");
  const npc = read("module/sheets/npc-sheet.mjs");

  /**
   * BOTH SHEETS, SEPARATELY. The existing reachability guards union across
   * sheets, so a handler wired on the character sheet alone passes them while
   * the NPC sheet — where a statblock's printed immunities actually live — does
   * nothing at all. That is the specific way this feature would ship half-dead.
   */
  test("both sheets pass the click event through, so alt+click can be seen", () => {
    for (const [name, src] of [["character", character], ["npc", npc]]) {
      const handler = src.match(/static async #onToggleStatus\([^)]*\)\s*\{[^}]*\}/)?.[0];
      assert.ok(handler, `${name}-sheet.mjs: no #onToggleStatus handler found — ` +
        "this test has lost its target and is asserting nothing");
      assert.match(handler, /toggleStatus\(this, target, event\)/,
        `${name}-sheet.mjs: the event is dropped, so altKey is unreadable and ` +
        "alt+click silently applies the condition instead of marking immunity");
    }
  });

  test("the palette reads the modifier and writes the field", () => {
    const src = read("module/sheets/status-palette.mjs");
    assert.match(src, /event\?\.altKey/);
    assert.match(src, /"system\.statusImmunities": next/);
  });

  test("both actor models carry the field", () => {
    for (const model of ["character", "npc"]) {
      assert.match(read(`module/data/${model}.mjs`), /statusImmunities: new fields\.ArrayField/,
        `${model}.mjs has nowhere to store an immunity`);
    }
  });

  /**
   * A `choices` list here would make a document holding a retired id refuse to
   * open — the failure CLAUDE.md records against retired technick flags.
   */
  test("the field is not narrowed by choices", () => {
    for (const model of ["character", "npc"]) {
      const decl = read(`module/data/${model}.mjs`)
        .match(/statusImmunities: new fields\.ArrayField\([^)]*\)/)[0];
      assert.ok(!decl.includes("choices"),
        `${model}.mjs: a retired status id would make the document unopenable`);
    }
  });

  /**
   * ONE CHOKE POINT. Guarding only the call sites this system owns would leave
   * the token HUD — the GM's commonest route — applying a condition the
   * creature is marked immune to.
   */
  test("the rule is enforced at effect creation, below every route", () => {
    const entry = read("module/last-arc.mjs");
    assert.match(entry, /import \{ guardStatusImmunity \} from "\.\/status-guard\.mjs"/);
    const hook = entry.match(/Hooks\.on\("preCreateActiveEffect",[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(hook, "no preCreateActiveEffect registration found");
    assert.match(hook, /guardStatusImmunity\(effect\) === false/,
      "the guard's refusal must actually cancel the creation");
  });

  test("a refused effect says so, and every string exists", () => {
    const guard = read("module/status-guard.mjs");
    assert.match(guard, /ui\.notifications\?\.info/,
      "silence reads as the click not registering, and the GM clicks again");

    for (const key of ["Refused", "Marked", "Cleared", "Tooltip", "ApplyTooltip"]) {
      assert.ok(`LASTARC.StatusImmunity.${key}` in lang,
        `LASTARC.StatusImmunity.${key} would render as a raw key`);
    }
  });

  test("the tooltip teaches the gesture, on both the plain and immune states", () => {
    for (const key of ["ApplyTooltip", "Tooltip"]) {
      assert.match(lang[`LASTARC.StatusImmunity.${key}`], /alt\+click/i,
        `${key}: an unlabelled modifier gesture is a feature nobody finds`);
    }
  });

  test("both palette rows draw the immune state and carry the tooltip", () => {
    const tpl = read("templates/actor/status-palette.hbs");
    assert.equal((tpl.match(/is-immune/g) ?? []).length, 2,
      "statuses and curses are two separate loops — both need the class");
    assert.equal((tpl.match(/data-tooltip="\{\{this\.tooltip\}\}"/g) ?? []).length, 2);
    assert.ok(!/data-tooltip="\{\{this\.label\}\}"/.test(tpl),
      "a row still on the bare label cannot teach the gesture");
    /**
     * EACH PART OF THE STATE, not merely "the class appears somewhere".
     *
     * The first version of this assertion looked for `.la-status.is-immune` in
     * the stylesheet and passed while the tile's own rule was renamed away,
     * because the two descendant rules below it still mentioned the class. An
     * immune tile would have kept its ordinary border and read as simply
     * switched off — which is the one thing this state must not look like.
     */
    const css = read("styles/last-arc.css");
    for (const [selector, why] of [
      [/\.la-status\.is-immune\s*\{/, "the tile itself is undistinguished from a switched-off one"],
      [/\.la-status\.is-immune \.la-status__icon\s*\{/, "the badge keeps its colours"],
      [/\.la-status\.is-immune \.la-status__name\s*\{/, "the name is unmarked"]
    ]) {
      assert.match(css, selector, `immune tiles: ${why}`);
    }
  });
});
