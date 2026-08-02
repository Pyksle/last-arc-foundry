/**
 * Building and reading effects by hand (#20 slice C).
 *
 * Slice B taught performances to put a real Active Effect on every targeted
 * ally. Nothing could then SEE one: this system replaces Foundry's actor sheet,
 * and its effects tab went with it, so the only UI touching effects was the
 * status palette — which handles effects carrying a status id and nothing else.
 *
 * The consequences were concrete. A performance buff out of combat has no round
 * to count and, by design, "stays until removed", with nothing able to remove
 * it. An effect pointing at a derived path does nothing at all and the GM had
 * no way to find out which of theirs those were.
 *
 * ── What is guarded here ────────────────────────────────────────────────────
 *
 * The picker is the part that can rot quietly. It offers SCOPES, and a scope
 * that resolves to no paths would create an effect with no changes — one that
 * sits on the sheet looking healthy and does nothing, which is the exact defect
 * this whole issue exists to remove. So every offered scope is resolved and
 * checked, on both actor shapes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  customEffectTargets, scopeTargets, supportedTargetPaths,
  describeChange, effectRow, effectRows
} from "../module/effects.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));

/* ── the picker ────────────────────────────────────────────────────────────── */

describe("§20 every scope the builder offers actually lands somewhere", () => {
  for (const type of ["character", "npc"]) {
    test(`${type}: no offered scope resolves to nothing`, () => {
      for (const row of customEffectTargets(type)) {
        const { paths, reason } = scopeTargets(row.scope, type);
        assert.ok(paths.length,
          `"${row.scope}" is offered to a ${type} and resolves to no path ` +
          `(${reason ?? "no reason given"}) — the effect would be created with ` +
          "no changes and do nothing while looking fine");
      }
    });

    test(`${type}: every resolved path survives derivation`, () => {
      const safe = supportedTargetPaths(type);
      for (const row of customEffectTargets(type)) {
        for (const path of scopeTargets(row.scope, type).paths) {
          assert.ok(safe.has(path),
            `"${row.scope}" writes ${path}, which is not on the whitelist — ` +
            "an effect there is overwritten on the next prepare");
        }
      }
    });
  }

  /**
   * A statblock's skills are printed values in an ARRAY. An Active Effect can
   * only address an array by index, and an index shifts the moment the GM
   * reorders a row, so "+2 Athletics" would silently become "+2 to whatever is
   * third". Refusing to offer it is the honest answer.
   */
  test("a statblock is offered no skill scopes at all", () => {
    const groups = new Set(customEffectTargets("npc").map((r) => r.group));
    assert.ok(!groups.has("skill"), "an NPC picker lists individual skills");
    assert.ok(!groups.has("skillGroup"), "an NPC picker lists skill groups");
    assert.ok(groups.has("defence") && groups.has("attribute"),
      "...but defences and attributes do work on a statblock and must stay");
  });

  /**
   * `skillGroup` was declared in `LASTARC.effectTargetGroups` from the start
   * and nothing ever emitted one, so "+2 to all weapon skills" was a category
   * the config knew about and no UI could reach — the declared-and-unreachable
   * shape this project keeps producing.
   */
  test("every declared target group is actually emitted", () => {
    const emitted = new Set(customEffectTargets("character").map((r) => r.group));
    for (const key of Object.keys(LASTARC.effectTargetGroups)) {
      assert.ok(emitted.has(key),
        `the "${key}" group is declared in config and no picker row uses it`);
    }
  });

  test("a skill group expands to more than one path", () => {
    const { paths } = scopeTargets("weaponSkills", "character");
    assert.ok(paths.length > 1, "a group that expands to one skill is not a group");
    assert.ok(paths.every((p) => p.endsWith(".misc")));
  });

  test("every label the picker shows exists as a string", () => {
    for (const row of customEffectTargets("character")) {
      assert.ok(lang[row.label], `no string for ${row.label}`);
      assert.ok(lang[row.groupLabel], `no string for ${row.groupLabel}`);
    }
  });

  /**
   * Attributes went into `scopeTargets` rather than into a second resolver
   * beside the builder. Two answers to "which paths does this scope mean" is
   * how flat-footed ended up with two implementations of one rule (#37).
   */
  test("an attribute scope resolves the same on both shapes", () => {
    for (const type of ["character", "npc"]) {
      assert.deepEqual(scopeTargets("agi", type).paths, ["system.attributes.agi.value"]);
    }
  });

  test("a defence scope follows the target's shape, not the author's", () => {
    assert.deepEqual(scopeTargets("ref", "character").paths, ["system.defences.ref.misc"]);
    assert.deepEqual(scopeTargets("ref", "npc").paths, ["system.defences.ref.base"]);
  });
});

/* ── reading an effect back ────────────────────────────────────────────────── */

describe("§20 what a change says it does", () => {
  test("a known path is named, and signed the way the rest of the sheet signs", () => {
    const up = describeChange({ key: "system.skills.athletics.misc", mode: 2, value: "2" });
    assert.equal(up.label, "LASTARC.Skill.athletics");
    assert.equal(up.display, "+2");
    assert.ok(up.known);

    const down = describeChange({ key: "system.skills.athletics.misc", mode: 2, value: "-2" });
    assert.equal(down.display, "−2", "a penalty must use U+2212 like every other one");
  });

  test("OVERRIDE reads as an assignment, not as a bonus", () => {
    // Printing "+12" for a mode that REPLACES the value would be a lie in the
    // one direction a player cannot check by arithmetic.
    assert.equal(describeChange({ key: "system.attributes.str.value", mode: 5, value: 12 }).display,
      "= 12");
  });

  /**
   * THE LOAD-BEARING ONE. A change outside the whitelist is overwritten by
   * derivation on the next prepare and does nothing, silently. The panel is
   * where a GM looks to find out why a buff did nothing, so it has to say.
   */
  test("a change pointing at a derived path is flagged", () => {
    const bad = describeChange({ key: "system.resources.hp.max", mode: 2, value: 10 });
    assert.ok(bad.unsupported, "max HP is assigned by prepareDerivedData");
    assert.ok(!bad.known);
    assert.equal(bad.label, "system.resources.hp.max",
      "an unrecognised path is shown verbatim — the GM needs to see what it says");
  });

  test("a safe path is not flagged", () => {
    for (const key of ["system.skills.athletics.misc", "system.defences.will.misc",
      "system.defences.will.base", "system.attributes.str.value"]) {
      assert.ok(!describeChange({ key, mode: 2, value: 1 }).unsupported, key);
    }
  });

  /**
   * A flag or another module's namespace is somebody else's business. Marking
   * it inert would be this system claiming authority over paths it knows
   * nothing about.
   */
  test("a non-system path is left alone", () => {
    assert.ok(!describeChange({ key: "flags.other-module.thing", mode: 2, value: 1 }).unsupported);
  });

  /**
   * THE 0.25.0 BUG, SEEN FROM THE PANEL.
   *
   * A skill path is real on a character and absent on a statblock. Judged
   * against the union of both shapes — which is right for the create-time
   * warning, where the document may end up on either — a character-shaped
   * debuff sitting inert on a monster passes as healthy. That is exactly the
   * effect that shipped doing nothing, and the panel is now where a GM would
   * go to find out why.
   */
  test("a change is judged against the shape it is actually on", () => {
    const skill = { key: "system.skills.athletics.misc", mode: 2, value: 2 };
    assert.ok(!describeChange(skill, undefined, "character").unsupported,
      "a character genuinely has this slot");
    assert.ok(describeChange(skill, undefined, "npc").unsupported,
      "a statblock has no per-skill slot, so this effect does nothing on one");

    const npcDefence = { key: "system.defences.will.base", mode: 2, value: -2 };
    assert.ok(!describeChange(npcDefence, undefined, "npc").unsupported);
    assert.ok(describeChange(npcDefence, undefined, "character").unsupported,
      "a character's defence slot is `misc`; `base` is not its input");
  });

  test("with no shape stated it falls back to the union, as the warning does", () => {
    // `warnUnsupportedTargets` fires on a document that may be embedded in
    // either, and must not cry wolf about a legitimate statblock path.
    for (const key of ["system.skills.athletics.misc", "system.defences.will.base"]) {
      assert.ok(!describeChange({ key, mode: 2, value: 1 }).unsupported, key);
    }
  });

  test("the panel hands the actor's own type down", () => {
    assert.match(read("module/sheets/effect-panel.mjs"),
      /actorType:\s*actor\?\.type/,
      "the panel knows which actor it is on and is not using it, so a " +
      "character-shaped effect on a monster reads as healthy");
  });
});

describe("§20 an effect as a row", () => {
  const effect = (over = {}) => ({
    id: "zz", name: "ZZ ward", img: null, disabled: false,
    changes: [{ key: "system.defences.ref.misc", mode: 2, value: "1" }], ...over
  });

  test("one bad change is enough to flag the whole effect", () => {
    const row = effectRow(effect({
      changes: [
        { key: "system.defences.ref.misc", mode: 2, value: "1" },
        { key: "system.movement.value", mode: 2, value: "5" }
      ]
    }));
    assert.ok(row.unsupported, "the buff is partly inert and the row must say so");
    assert.deepEqual(row.changes.map((c) => c.unsupported), [false, true]);
  });

  test("a clean effect is not flagged", () => {
    assert.ok(!effectRow(effect()).unsupported);
  });

  /**
   * Conditions belong to the status palette, whose remove deletes EVERY effect
   * carrying that id — Foundry can end up with several, and issue #47 was
   * exactly that pile-up. One condition with two remove buttons that behave
   * differently would rebuild it.
   */
  test("statuses are the palette's, not the panel's", () => {
    const rows = effectRows([
      effect({ id: "a", isStatus: true }),
      effect({ id: "b", isStatus: false })
    ]);
    assert.deepEqual(rows.map((r) => r.id), ["b"]);
  });

  test("no effects is an empty list, not a crash", () => {
    assert.deepEqual(effectRows([]), []);
    assert.deepEqual(effectRow({}).changes, []);
  });
});

/* ── the panel is reachable ────────────────────────────────────────────────── */

describe("§20 the panel is wired to both sheets", () => {
  const partial = read("templates/actor/effects-panel.hbs");

  test("both actor templates include it", () => {
    for (const t of ["templates/actor/character-body.hbs", "templates/actor/npc-sheet.hbs"]) {
      assert.match(read(t), /\{\{>\s*laEffectsPanel\}\}/,
        `${t} does not render the effects panel, so half the actors in a world ` +
        "still have no way to see or remove a buff");
    }
  });

  test("and the partial is registered", () => {
    assert.match(read("module/last-arc.mjs"), /laEffectsPanel:/,
      "a partial a template uses and nobody registers is a THROW at render time");
  });

  /**
   * Both sheets must carry all four, or an effect can be created on a monster
   * and never removed from one. The integrity suite checks each action has a
   * handler and a button; what it cannot check is that the two sheets agree.
   */
  test("both sheets declare every action the panel emits", () => {
    const emitted = [...partial.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]);
    assert.ok(emitted.length >= 4, "the panel emits fewer actions than expected");

    for (const sheet of ["module/sheets/character-sheet.mjs", "module/sheets/npc-sheet.mjs"]) {
      const src = read(sheet);
      for (const action of new Set(emitted)) {
        assert.match(src, new RegExp(`\\b${action}:\\s*LastArc\\w+Sheet\\.#on`),
          `${sheet} has no "${action}" action`);
      }
    }
  });

  test("the handlers delegate rather than each sheet reimplementing them", () => {
    for (const sheet of ["module/sheets/character-sheet.mjs", "module/sheets/npc-sheet.mjs"]) {
      assert.match(read(sheet), /from "\.\/effect-panel\.mjs"/,
        `${sheet} does not use the shared panel module — this is #44 again`);
    }
  });

  test("the builder resolves the scope against the actor it is creating on", () => {
    // Resolving once from the author's side is what shipped in 0.25.0 and made
    // every debuff aimed at a monster write character paths and do nothing.
    assert.match(read("module/sheets/effect-panel.mjs"),
      /scopeTargets\(result\.scope,\s*actor\.type\)/,
      "the builder resolves paths without consulting the target's shape");
  });
});

/* ── two regressions worth pinning ─────────────────────────────────────────── */

describe("§20 things this panel surfaced", () => {
  /**
   * Spending a hero point to get BETTER drew the Exhaustion badge on the
   * token. The status glyphs are deliberately shape-coded for the two
   * colour-blind players at this table, which makes borrowing one for
   * something else worse here than it would be elsewhere.
   */
  test("the hero point defence boost does not wear a status icon", () => {
    /**
     * Comments stripped first, and this test failed until they were.
     *
     * The comment recording the fix quotes the path it replaced, so a raw scan
     * read the explanation as the defect. It is the mirror of the orphan
     * guard's problem in `integrity.test.mjs`: there, prose vouched FOR code
     * that was broken; here, prose convicted code that was fixed. Both come of
     * counting occurrences in a file rather than in the code.
     */
    const src = read("module/dice/hero-points.mjs")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
    const fn = src.slice(src.indexOf("export async function heroPointDefenceBoost"));
    assert.ok(!/assets\/status\//.test(fn.slice(0, 1200)),
      "a hero point BOOST is drawing a condition's glyph on the token");
  });

  /**
   * The preview harness kept its own hand-copied list of partials while its
   * comment claimed it followed `last-arc.mjs`. The effects panel proved
   * otherwise the moment it was added.
   */
  test("the preview harness reads its partials out of the source", () => {
    const src = read("tools/preview.mjs");
    assert.match(src, /readFileSync\(join\(root, "module\/last-arc\.mjs"\)/,
      "the harness keeps a second list of partials that can drift from the real one");
  });
});
