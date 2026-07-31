/**
 * Static integrity checks across config, templates, and localisation.
 *
 * There is no Foundry install in this environment, so the usual way these bugs
 * surface — a sheet rendering "LASTARC.Skill.foo" as literal text, or a button
 * that silently does nothing — is not available to us. These tests substitute
 * for that by cross-referencing the files directly.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
const systemJson = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));

function readTemplates() {
  return ["templates/actor", "templates/item"].flatMap((rel) =>
    readdirSync(join(root, rel))
      .filter((f) => f.endsWith(".hbs"))
      .map((f) => ({ name: `${rel}/${f}`, source: readFileSync(join(root, rel, f), "utf8") }))
  );
}

const templates = readTemplates();
const sheetSource = readFileSync(join(root, "module/sheets/character-sheet.mjs"), "utf8");
const npcSheetSource = readFileSync(join(root, "module/sheets/npc-sheet.mjs"), "utf8");
const itemSheetSource = readFileSync(join(root, "module/sheets/item-sheet.mjs"), "utf8");
const entrySource = readFileSync(join(root, "module/last-arc.mjs"), "utf8");
const itemsSource = readFileSync(join(root, "module/data/items.mjs"), "utf8");

/* -------------------------------------------------------------------------- */

describe("localisation coverage", () => {
  test("every label referenced by config exists in en.json", () => {
    const missing = [];

    const check = (key) => {
      if (typeof key === "string" && key.startsWith("LASTARC.") && !(key in lang)) {
        missing.push(key);
      }
    };

    for (const a of Object.values(LASTARC.attributes)) { check(a.label); check(a.abbr); }
    for (const s of Object.values(LASTARC.allSkills)) check(s.label);
    for (const c of Object.values(LASTARC.classes)) check(c.label);
    for (const s of Object.values(LASTARC.sizes)) check(s.label);

    assert.deepEqual(missing, [], `missing localisation keys: ${missing.join(", ")}`);
  });

  test("every {{localize \"...\"}} literal in templates exists in en.json", () => {
    const missing = [];
    for (const { name, source } of templates) {
      for (const m of source.matchAll(/localize\s+["']([^"']+)["']/g)) {
        if (!(m[1] in lang)) missing.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], `dangling localisation keys:\n  ${missing.join("\n  ")}`);
  });

  test("every status effect has a name string", () => {
    const ids = entrySource.match(/const statuses = \[([\s\S]*?)\];/)?.[1] ?? "";
    const missing = [...ids.matchAll(/"([a-zA-Z]+)"/g)]
      .map((m) => `LASTARC.Status.${m[1]}`)
      .filter((k) => !(k in lang));
    assert.deepEqual(missing, []);
  });

  test("every registered setting has both a name and a hint", () => {
    const missing = [];
    for (const m of entrySource.matchAll(/"(LASTARC\.Setting\.[^"]+)"/g)) {
      if (!(m[1] in lang)) missing.push(m[1]);
    }
    assert.deepEqual(missing, []);
  });

  /**
   * The item sheet assembles localisation keys from config values at runtime
   * (`LASTARC.DamageType.${k}`), so the template-literal scan above cannot see
   * them. Enumerate the config lists directly instead.
   */
  test("programmatically-built option labels all exist", () => {
    const expect = (prefix, keys) => keys.map((k) => `${prefix}.${k}`);

    const required = [
      ...expect("LASTARC.Availability", Object.keys(LASTARC.availability)),
      ...expect("LASTARC.WeaponCategory", LASTARC.weaponCategories),
      ...expect("LASTARC.ArmourType", Object.keys(LASTARC.armourTypes)),
      ...expect("LASTARC.DamageType", LASTARC.allDamageTypes),
      ...expect("LASTARC.School", LASTARC.spellSchools),
      ...expect("LASTARC.TechnickFlag", LASTARC.technickFlags),
      ...Object.values(LASTARC.wieldLabels)
    ];

    const missing = required.filter((k) => !(k in lang));
    assert.deepEqual(missing, [], `missing option labels:\n  ${missing.join("\n  ")}`);
  });

  test("every declared document subtype has a TYPES label", () => {
    const missing = [];
    for (const [doc, subtypes] of Object.entries(systemJson.documentTypes)) {
      for (const sub of Object.keys(subtypes)) {
        const key = `TYPES.${doc}.${sub}`;
        if (!(key in lang)) missing.push(key);
      }
    }
    assert.deepEqual(missing, [], `Foundry shows the raw key without these: ${missing.join(", ")}`);
  });
});

/* -------------------------------------------------------------------------- */

describe("sheet registration", () => {
  /**
   * REGRESSION GUARD. Phase 1 unregistered Foundry's core ActorSheet but
   * registered a replacement only for `character`, so NPC actors had no sheet
   * at all and simply would not open. Unregistering the core sheet obliges us to
   * cover every subtype we declare.
   */
  test("every declared subtype has a registered sheet", () => {
    for (const doc of ["Actor", "Item"]) {
      const unregisters = entrySource.includes(`unregisterSheet(${doc}, "core"`);
      if (!unregisters) continue;

      for (const sub of Object.keys(systemJson.documentTypes[doc])) {
        // Either named in an explicit types array, or covered by the wildcard
        // registration that spreads ITEM_DATA_MODELS.
        const named = new RegExp(`types:\\s*\\[[^\\]]*"${sub}"`).test(entrySource);
        const viaModels = doc === "Item"
          && entrySource.includes("types: Object.keys(ITEM_DATA_MODELS)")
          && new RegExp(`^\\s*${sub}:`, "m").test(itemsSource);

        assert.ok(
          named || viaModels,
          `${doc} subtype "${sub}" has no registered sheet, but the core sheet was unregistered — ` +
          `documents of this type will not open`
        );
      }
    }
  });

  test("every declared Item subtype has a data model", () => {
    const missing = Object.keys(systemJson.documentTypes.Item)
      .filter((sub) => !new RegExp(`^\\s*${sub}:\\s*LastArc`, "m").test(itemsSource));
    assert.deepEqual(missing, [], `Item subtypes with no TypeDataModel: ${missing.join(", ")}`);
  });
});

describe("sheet wiring", () => {
  test("every data-action in a template is declared in DEFAULT_OPTIONS.actions", () => {
    const declared = new Set([
      ...[...sheetSource.matchAll(/(\w+):\s*LastArcCharacterSheet\.#on/g)].map((m) => m[1]),
      ...[...npcSheetSource.matchAll(/(\w+):\s*LastArcNpcSheet\.#on/g)].map((m) => m[1])
    ]);
    assert.ok(declared.size > 0, "failed to parse any declared actions — check the regex");

    const missing = [];
    for (const { name, source } of templates) {
      for (const m of source.matchAll(/data-action="([^"]+)"/g)) {
        if (!declared.has(m[1])) missing.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], `undeclared sheet actions:\n  ${missing.join("\n  ")}`);
  });

  test("every declared action has a matching private handler", () => {
    for (const [src, cls] of [
      [sheetSource, "LastArcCharacterSheet"],
      [npcSheetSource, "LastArcNpcSheet"]
    ]) {
      for (const [, action, handler] of src.matchAll(new RegExp(`(\\w+):\\s*${cls}\\.#on(\\w+)`, "g"))) {
        assert.ok(
          src.includes(`static async #on${handler}(`),
          `${cls} action "${action}" points at #on${handler}, which is not defined`
        );
      }
    }
  });

  test("template paths declared in PARTS exist on disk", () => {
    const names = templates.map((t) => t.name);
    for (const src of [sheetSource, npcSheetSource, itemSheetSource]) {
      for (const m of src.matchAll(/template:\s*"systems\/last-arc\/(templates\/[^"]+)"/g)) {
        assert.ok(names.includes(m[1]), `PARTS references missing template: ${m[1]}`);
      }
    }
  });

  test("custom Handlebars helpers used in templates are registered", () => {
    const registered = new Set(
      [...entrySource.matchAll(/Handlebars\.registerHelper\("(\w+)"/g)].map((m) => m[1])
    );
    // Helpers Foundry provides itself; we must not assume anything beyond these.
    const builtin = new Set(["localize", "if", "unless", "each", "with", "log", "lookup"]);

    const missing = [];
    const seen = new Set();
    for (const { name, source: raw } of templates) {
      // Strip {{!-- --}} comments first: prose inside them contains parenthesised
      // phrases like "(book p.263)" that the subexpression pattern would
      // otherwise report as an unregistered helper named "book".
      const source = raw.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

      // Two call sites: block/inline `{{helper arg}}` and the subexpression form
      // `(helper arg)` used inside {{#if ...}}. Most of this sheet's helper use
      // is the second kind, so checking only the first would be near-vacuous.
      const patterns = [/\{\{#?\s*([a-z][a-zA-Z]*)\s/g, /\(\s*([a-z][a-zA-Z]*)\s/g];
      for (const pattern of patterns) {
        for (const m of source.matchAll(pattern)) {
          const helper = m[1];
          seen.add(helper);
          if (!registered.has(helper) && !builtin.has(helper)) missing.push(`${name}: ${helper}`);
        }
      }
    }
    assert.deepEqual(missing, [], `unregistered helpers:\n  ${missing.join("\n  ")}`);

    // Guard against the check silently passing because the regexes matched
    // nothing at all.
    for (const expected of ["lasignal", "laeq", "localize"]) {
      assert.ok(seen.has(expected), `expected to find ${expected} in templates — regex may be wrong`);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("system.json manifest", () => {
  test("declares both actor subtypes, matching CONFIG registration", () => {
    assert.deepEqual(Object.keys(systemJson.documentTypes.Actor).sort(), ["character", "npc"]);
    assert.ok(entrySource.includes("CONFIG.Actor.dataModels.character"));
    assert.ok(entrySource.includes("CONFIG.Actor.dataModels.npc"));
  });

  test("grid uses RECTILINEAR diagonals — movement costs 2 per diagonal (§10)", () => {
    // CONST.GRID_DIAGONALS.RECTILINEAR. Range measurement uses ALTERNATING_1 and
    // is implemented separately; this field governs movement only.
    assert.equal(systemJson.grid.diagonals, 3);
    assert.equal(systemJson.grid.distance, 1, "distances are in squares, not feet");
  });

  test("token bars point at real resource paths", () => {
    assert.equal(systemJson.primaryTokenAttribute, "resources.hp");
    assert.equal(systemJson.secondaryTokenAttribute, "resources.mp");
  });

  test("esmodule and stylesheet entries exist on disk", () => {
    for (const rel of [...systemJson.esmodules, ...systemJson.styles]) {
      assert.doesNotThrow(() => readFileSync(join(root, rel)), `missing: ${rel}`);
    }
  });

  test("compendium packs are declared but ship EMPTY (§17)", () => {
    assert.ok(systemJson.packs.length > 0);
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    assert.ok(
      gitignore.split("\n").some((l) => l.trim() === "packs/"),
      "packs/ must be gitignored — generated compendium content is not ours to distribute"
    );
  });

  test("the rulebook PDF and the spec are gitignored", () => {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    assert.ok(gitignore.includes("*.pdf"));
    assert.ok(gitignore.includes("last-arc-foundry-system-spec.md"));
  });
});
