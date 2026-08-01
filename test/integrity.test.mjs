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
  return ["templates/actor", "templates/item", "templates/chat"].flatMap((rel) =>
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

    // Performance outcome vocabularies (issue #13). These are option lists the
    // item sheet builds from config, so a missing label shows up as a blank
    // <option> rather than an error.
    for (const table of [
      LASTARC.performanceBonusScopes,
      LASTARC.performanceDamageScopes,
      LASTARC.performancePenaltyScopes,
      LASTARC.performanceEffectTags,
      LASTARC.performSpecialisations,
      LASTARC.performanceKinds
    ]) {
      for (const entry of Object.values(table)) check(entry.label);
    }

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

  test("every status and curse has a name string", () => {
    const missing = LASTARC.allStatusIds
      .map((id) => `LASTARC.Status.${id}`)
      .filter((k) => !(k in lang));
    assert.deepEqual(missing, [], `statuses would show a raw key: ${missing.join(", ")}`);
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
  test("every data-action in a SHEET template is declared in DEFAULT_OPTIONS.actions", () => {
    const declared = new Set([
      ...[...sheetSource.matchAll(/(\w+):\s*LastArcCharacterSheet\.#on/g)].map((m) => m[1]),
      ...[...npcSheetSource.matchAll(/(\w+):\s*LastArcNpcSheet\.#on/g)].map((m) => m[1]),
      ...[...itemSheetSource.matchAll(/(\w+):\s*LastArcItemSheet\.#on/g)].map((m) => m[1])
    ]);
    assert.ok(declared.size > 0, "failed to parse any declared actions — check the regex");

    const missing = [];
    for (const { name, source } of templates) {
      // Chat cards are not sheets: their buttons go through the delegated
      // listener in chat.mjs, checked separately below.
      if (name.startsWith("templates/chat/")) continue;
      for (const m of source.matchAll(/data-action="([^"]+)"/g)) {
        if (!declared.has(m[1])) missing.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], `undeclared sheet actions:\n  ${missing.join("\n  ")}`);
  });

  test("every data-action in a CHAT template is handled by the chat listener", () => {
    const chatSource = readFileSync(join(root, "module/chat.mjs"), "utf8");
    const handled = new Set(
      [...chatSource.matchAll(/case\s+"(lastarc\w+)":/g)].map((m) => m[1])
    );
    assert.ok(handled.size > 0, "failed to parse any chat handlers — check the regex");

    const missing = [];
    for (const { name, source } of templates) {
      if (!name.startsWith("templates/chat/")) continue;
      for (const m of source.matchAll(/data-action="([^"]+)"/g)) {
        if (!handled.has(m[1])) missing.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], `unhandled chat actions:\n  ${missing.join("\n  ")}`);
  });

  /**
   * The mirror of the test above, and the one that matters more.
   *
   * "Every button has a handler" catches a dead button. This catches a handler
   * no button reaches — a working feature with no way in, which is how the
   * item-creation gap survived a full build and two review passes. Nothing was
   * broken; it just could not be got at.
   */
  test("every declared action is reachable from some template", () => {
    const used = new Set(
      templates.flatMap(({ source }) =>
        [...source.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]))
    );

    const unreachable = [];
    for (const [src, cls] of [
      [sheetSource, "LastArcCharacterSheet"],
      [npcSheetSource, "LastArcNpcSheet"],
      [itemSheetSource, "LastArcItemSheet"]
    ]) {
      for (const [, action] of src.matchAll(new RegExp(`(\\w+):\\s*${cls}\\.#on`, "g"))) {
        if (!used.has(action)) unreachable.push(`${cls}.${action}`);
      }
    }

    assert.deepEqual(unreachable, [], `actions no template exposes:\n  ${unreachable.join("\n  ")}`);
  });

  test("every declared action has a matching private handler", () => {
    for (const [src, cls] of [
      [sheetSource, "LastArcCharacterSheet"],
      [npcSheetSource, "LastArcNpcSheet"],
      [itemSheetSource, "LastArcItemSheet"]
    ]) {
      for (const [, action, handler] of src.matchAll(new RegExp(`(\\w+):\\s*${cls}\\.#on(\\w+)`, "g"))) {
        assert.ok(
          src.includes(`static async #on${handler}(`),
          `${cls} action "${action}" points at #on${handler}, which is not defined`
        );
      }
    }
  });

  /**
   * The gap that made the system unusable, and the test that should have
   * existed from the start.
   *
   * Every mechanical subsystem was wired and tested, but no sheet had a button
   * that CREATED anything. The only route in was the sidebar Items directory
   * plus a drag — which works, and which no player finds — while the
   * empty-state copy pointed at compendium packs that ship empty by design.
   * Nothing was broken in a way any existing test could see: the data models
   * were right, the panels rendered, the drop handler worked. There was simply
   * no way to get to any of it.
   *
   * These four tests together assert the whole chain: a subtype is declared, it
   * belongs to a creation group, some template offers that group, and the panel
   * it lands in will actually display it.
   */
  test("every declared Item subtype can be created from some sheet", () => {
    const creatable = new Set(Object.values(LASTARC.itemCreationGroups).flat());
    const unreachable = Object.keys(systemJson.documentTypes.Item)
      .filter((sub) => !creatable.has(sub));

    assert.deepEqual(unreachable, [], `Item subtypes with no way to create them in the UI: ` +
      `${unreachable.join(", ")}. Add each to a group in LASTARC.itemCreationGroups.`);
  });

  test("every data-group in a template is a real creation group", () => {
    const groups = new Set(Object.keys(LASTARC.itemCreationGroups));
    const bad = [];
    for (const { name, source } of templates) {
      for (const m of source.matchAll(/data-group="([^"]+)"/g)) {
        if (!groups.has(m[1])) bad.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(bad, [], `data-group values with no matching group:\n  ${bad.join("\n  ")}`);
  });

  test("every creation group is offered by some template", () => {
    const offered = new Set(
      templates.flatMap(({ source }) =>
        [...source.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1]))
    );
    const unoffered = Object.keys(LASTARC.itemCreationGroups).filter((g) => !offered.has(g));

    assert.deepEqual(unoffered, [], `creation groups no template exposes: ${unoffered.join(", ")}. ` +
      `A group with no button is a subtype nobody can make.`);
  });

  test("every subtype has a panel that will display it once created", () => {
    // A subtype reaches the character sheet's inventory only if it carries a
    // numeric `bulk`; everything else needs an explicit branch in
    // #prepareItems. Creating something that then fails to appear is worse
    // than not offering to create it.
    const branched = new Set(["spell", "performance", "technick", "talent",
                              "feature", "race", "class"]);
    const physical = new Set(LASTARC.physicalItemTypes);

    const homeless = Object.keys(systemJson.documentTypes.Item)
      .filter((sub) => !branched.has(sub) && !physical.has(sub));

    assert.deepEqual(homeless, [], `subtypes that would be created but never render: ` +
      `${homeless.join(", ")}. Give each a branch in #prepareItems or a bulk field.`);

    // And the branch set must correspond to real code, not to this list.
    for (const sub of branched) {
      assert.ok(
        new RegExp(`item\\.type === "${sub}"`).test(sheetSource),
        `#prepareItems claims to branch on "${sub}" but character-sheet.mjs never tests for it`
      );
    }
  });

  test("physicalItemTypes is the single source of truth for what carries bulk", () => {
    // item-sheet.mjs held its own PHYSICAL_TYPES copy of this list. Two lists
    // that must agree and are never compared will eventually disagree.
    const inSheet = itemSheetSource.match(/PHYSICAL_TYPES\s*=\s*new Set\(\[([^\]]+)\]/s);
    if (!inSheet) return;   // already collapsed onto config — nothing to compare

    const listed = [...inSheet[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, [...LASTARC.physicalItemTypes].sort(),
      "item-sheet.mjs PHYSICAL_TYPES has drifted from LASTARC.physicalItemTypes");
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
    // Handlebars/Foundry builtins; we must not assume anything beyond these.
    // `formInput` and `formGroup` are Foundry's, registered by the core
    // handlebars module — they are how a schema field becomes the right
    // control, and the only practical way to get a <prose-mirror> editor.
    const builtin = new Set([
      "localize", "if", "else", "unless", "each", "with", "log", "lookup",
      "formInput", "formGroup", "formField"
    ]);

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

describe("status assets", () => {
  /**
   * REGRESSION GUARD. registerStatusEffects() points every status at
   * assets/status/<id>.svg. Those files did not exist at first, so every status
   * badge on every token was a broken image — invisible in code review and
   * obvious the moment anyone played.
   */
  test("every status has an icon file on disk", () => {
    const icons = new Set(
      readdirSync(join(root, "assets/status")).filter((f) => f.endsWith(".svg"))
    );
    const missing = LASTARC.allStatusIds.filter((id) => !icons.has(`${id}.svg`));
    assert.deepEqual(missing, [], `statuses with no icon: ${missing.join(", ")}`);
  });

  test("no orphan icons for statuses that no longer exist", () => {
    const icons = readdirSync(join(root, "assets/status"))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace(".svg", ""));
    const orphans = icons.filter((id) => !LASTARC.allStatusIds.includes(id));
    assert.deepEqual(orphans, [], `icons with no status: ${orphans.join(", ")}`);
  });

  test("icons are self-contained SVG with no external references", () => {
    for (const file of readdirSync(join(root, "assets/status"))) {
      const svg = readFileSync(join(root, "assets/status", file), "utf8");
      assert.ok(svg.startsWith("<svg"), `${file} is not an SVG`);
      assert.ok(!/<image|href=|url\(/i.test(svg), `${file} references an external asset`);
      // currentColor lets Foundry tint the badge; a hardcoded fill would not.
      assert.ok(svg.includes("currentColor"), `${file} should use currentColor`);
    }
  });

  /**
   * REGRESSION GUARD. `applyDamage` called toggleStatusEffect("unconscious"),
   * but registration REPLACES CONFIG.statusEffects wholesale — so core's
   * `unconscious` did not survive and the id resolved to nothing. Foundry
   * answers an unknown id with a thrown "Invalid status ID", meaning every
   * character who actually hit 0 HP in play would have blown up mid-turn.
   *
   * Nothing in the unit suite could see it: the id only exists as a string
   * literal handed to a Foundry API. This scans for those literals instead.
   */
  test("every status id used in code is a registered status", () => {
    const sources = readdirSync(join(root, "module"), { recursive: true })
      .filter((f) => typeof f === "string" && f.endsWith(".mjs"))
      .map((f) => ({ name: f, source: readFileSync(join(root, "module", f), "utf8") }));

    const bad = [];
    for (const { name, source } of sources) {
      for (const m of source.matchAll(/toggleStatusEffect\??\.?\(\s*["'`]([^"'`]+)["'`]/g)) {
        if (!LASTARC.allStatusIds.includes(m[1])) bad.push(`${name}: "${m[1]}"`);
      }
    }
    assert.deepEqual(bad, [], `unregistered status ids passed to Foundry: ${bad.join(", ")}`);
  });
});

describe("templates compile", () => {
  /**
   * A malformed Handlebars template throws only at render time, which in a
   * normal workflow means "the sheet is blank in Foundry". With no Foundry here,
   * compiling every template is the cheapest way to catch that.
   */
  test("every .hbs file is valid Handlebars", async () => {
    const Handlebars = (await import("handlebars")).default;
    for (const { name, source } of templates) {
      assert.doesNotThrow(() => Handlebars.compile(source), `${name} failed to compile`);
    }
  });

  test("renderTemplate paths referenced in JS exist on disk", () => {
    const names = new Set(templates.map((t) => t.name));
    const sources = [entrySource, sheetSource, npcSheetSource, itemSheetSource,
                     readFileSync(join(root, "module/chat.mjs"), "utf8"),
                     readFileSync(join(root, "module/dice/attack.mjs"), "utf8")];

    for (const src of sources) {
      for (const m of src.matchAll(/"systems\/last-arc\/(templates\/[^"]+\.hbs)"/g)) {
        assert.ok(names.has(m[1]), `referenced template does not exist: ${m[1]}`);
      }
    }
  });
});

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

  /**
   * Release plumbing, which failed silently for the whole of 0.1.0.
   *
   * Foundry decides an update exists by fetching the `manifest` URL and
   * comparing that file's `version` to the installed one. The version was never
   * bumped, so every commit was served correctly and reported as "no update
   * available" — nothing errored anywhere, and the only symptom was a user
   * looking at an old version number and wondering why.
   */
  test("the download URL points at an asset for THIS version", () => {
    const { version, download } = systemJson;

    assert.match(version, /^\d+\.\d+\.\d+$/, `version "${version}" is not semver`);

    // A download that does not name the version cannot have been rebuilt for
    // it, and installs will silently receive a different build.
    assert.ok(
      download.includes(version),
      `download URL does not mention version ${version}:\n  ${download}\n` +
      `Bump both together, then run: node tools/build-release.mjs`
    );

    // GitHub's source archives wrap everything in a top-level directory and
    // always serve the current branch, so the tag in the URL means nothing.
    assert.ok(
      !download.includes("/archive/refs/"),
      `download points at a GitHub source archive:\n  ${download}\n` +
      `Those nest the system inside a folder and ignore the requested version. ` +
      `Attach a built zip to a release instead.`
    );
  });

  test("the manifest URL serves the current branch, not a tag", () => {
    // The manifest must always describe the LATEST version, or Foundry can
    // never learn that a newer one exists. It is the one URL that should not
    // be pinned.
    assert.match(
      systemJson.manifest,
      /raw\.githubusercontent\.com\/.+\/main\/system\.json$/,
      `manifest should be the system.json on main: ${systemJson.manifest}`
    );
  });

  test("the release build includes everything the system loads at runtime", () => {
    const build = readFileSync(join(root, "tools/build-release.mjs"), "utf8");
    const included = [...build.matchAll(/^\s+"([\w.]+)",?$/gm)].map((m) => m[1]);

    // Every path system.json tells Foundry to load must be in the archive, or
    // the published system is broken in a way no local test can see.
    const needed = new Set([
      ...systemJson.esmodules.map((p) => p.split("/")[0]),
      ...systemJson.styles.map((p) => p.split("/")[0]),
      ...(systemJson.languages ?? []).map((l) => l.path.split("/")[0])
    ]);

    const absent = [...needed].filter((d) => !included.includes(d));
    assert.deepEqual(absent, [], `build-release.mjs would omit: ${absent.join(", ")}`);
  });

  /**
   * THE SYSTEM DECLARES NO COMPENDIUM PACKS, AND MUST NOT.
   *
   * It used to declare ten empty ones — Races, Spells, Bestiary and so on —
   * meant as a home for content each table hand-authors from its own copy of
   * the book. That destroyed people's work.
   *
   * A system's packs live INSIDE the system folder, and Foundry replaces that
   * whole folder when it updates a system. So every release wiped everything
   * anyone had put in them, and the empty packs were an invitation to put work
   * exactly where it would be destroyed. Reported after a playtest as "when we
   * update, all of the compendium things we make get overwritten", which is
   * precisely what happened, seven releases running.
   *
   * Hand-authored content belongs in a WORLD compendium (Compendium tab →
   * Create Compendium), which lives in the world folder and is never touched by
   * a system update. See the README.
   *
   * This test inverts the one it replaces, which asserted the packs existed.
   */
  test("the system declares NO compendium packs — updates destroy them", () => {
    assert.deepEqual(systemJson.packs ?? [], [],
      "A system pack lives in the system folder, which Foundry replaces on " +
      "update, taking every document in it. Content goes in a WORLD compendium.");
  });

  test("generated compendium content is still gitignored (§17)", () => {
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


/* -------------------------------------------------------------------------- */

describe("no orphaned exports", () => {
  /**
   * THE SYSTEMIC GUARD. Every serious bug in this project so far has had the
   * same shape: a pure function, written correctly, unit tested, and never
   * wired to Foundry.
   *
   *   - `isFlatFooted` was right; nothing ever applied the status, so the
   *     surprise round did not exist.
   *   - the initiative die logic was right; the override sat on the wrong
   *     class, so rolling initiative threw.
   *   - the whole magic system was modelled and had no pipeline at all.
   *
   * Unit tests cannot see this, because the function they test is correct. So
   * this checks the one thing they cannot: that somebody CALLS it.
   *
   * A function here is not necessarily a bug — some are genuinely public API,
   * and some are pending a UI. But every one must be named below with a reason,
   * so "we forgot" and "we decided" stop looking identical.
   */
  const ALLOWED = new Map([
    // Genuinely public surface / analysis helpers, not wiring gaps.
    ["explodingDieEV", "analysis helper: expected value of an exploding die, used when tuning"],

    // Written against rules that exist, awaiting the feature that calls them.
    ["rollSurprise", "GM-invoked surprise resolution; needs a tracker button"],
    ["joinCombat", "joining mid-combat; needs a tracker button"],
    ["useFreeAction", "free actions are not yet surfaced in the action tracker"],
    ["sequenceComplete", "banked Recovery/Aim completion is not consumed anywhere yet"],
    ["surpriseActions", "surprise-round action limits are not enforced yet"],
    ["holderPriority", "Hold Turn ordering helper, not yet needed by the tracker"],
    ["initiativeDieFor", "die lookup superseded by the derived actor value"]
  ]);

  test("every exported function is called somewhere, or explained", () => {
    const files = readdirSync(join(root, "module"), { recursive: true })
      .filter((f) => typeof f === "string" && f.endsWith(".mjs"))
      .map((f) => ({
        name: f,
        source: readFileSync(join(root, "module", f), "utf8")
      }));

    const corpus = files.map((f) => f.source).join("\n");

    const orphans = [];
    for (const { name, source } of files) {
      for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
        const fn = m[1];
        // One occurrence means the definition and nothing else.
        const uses = [...corpus.matchAll(new RegExp(`\\b${fn}\\b`, "g"))].length;
        if (uses <= 1 && !ALLOWED.has(fn)) orphans.push(`${name}: ${fn}`);
      }
    }

    assert.deepEqual(orphans, [],
      `exported but never called — wire them, or add them to ALLOWED with a reason:\n  ` +
      orphans.join("\n  "));
  });

  test("the allowlist has no stale entries", () => {
    // An allowlisted function that HAS been wired should leave the list, or the
    // list slowly becomes a place bugs hide.
    const files = readdirSync(join(root, "module"), { recursive: true })
      .filter((f) => typeof f === "string" && f.endsWith(".mjs"))
      .map((f) => readFileSync(join(root, "module", f), "utf8"))
      .join("\n");

    const stale = [];
    for (const fn of ALLOWED.keys()) {
      const uses = [...files.matchAll(new RegExp(`\\b${fn}\\b`, "g"))].length;
      if (uses === 0) stale.push(`${fn} (no longer exists)`);
      else if (uses > 1) stale.push(`${fn} (now wired — remove from ALLOWED)`);
    }

    assert.deepEqual(stale, [], `stale allowlist entries:\n  ` + stale.join("\n  "));
  });
});


/* -------------------------------------------------------------------------- */

describe("declared options are all implemented", () => {
  /**
   * The orphan guard catches a function that exists and is never called. It
   * structurally CANNOT catch a declared option with no function at all —
   * `HERO_SPEND.BONUS_ROLL` sat in the enum from the start with nothing behind
   * it, and because the constant was referenced by the enum itself, nothing
   * flagged it. Three of the four hero point spends were unreachable and the
   * count looked like two.
   *
   * This closes that gap: every value in a "kinds of thing you can do" enum must
   * be reachable from somewhere in module/.
   */
  const moduleSources = readdirSync(join(root, "module"), { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".mjs"))
    .map((f) => readFileSync(join(root, "module", f), "utf8"))
    .join("\n");

  test("every hero point spend kind is consumed by real code", async () => {
    const { HERO_SPEND } = await import("../module/dice/hero-points.mjs");

    const unreachable = [];
    for (const [name, value] of Object.entries(HERO_SPEND)) {
      // Count references to the CONSTANT, ignoring its own declaration.
      const uses = [...moduleSources.matchAll(
        new RegExp(`HERO_SPEND\\.${name}\\b`, "g")
      )].length;
      if (uses === 0) unreachable.push(`${name} ("${value}")`);
    }

    assert.deepEqual(unreachable, [],
      `hero point spends declared but never used:\n  ${unreachable.join("\n  ")}`);
  });

  /**
   * Behavioural, not a source scan. An earlier version looked for each id as a
   * quoted literal, which is wrong for options looked up dynamically by key —
   * it reported four working High Arcana as dead. Asking whether calling it
   * DOES anything is both stricter and correct.
   */
  test("every High Arcana actually does something when applied", async () => {
    const { applyHighArcana } = await import("../module/dice/magic.mjs");

    const baseline = { range: 6, durationTurns: 3, mndMod: 3, isSingleTarget: true };
    const inert = [];

    for (const id of LASTARC.highArcanaIds) {
      const before = applyHighArcana(null, baseline);
      const after = applyHighArcana(id, baseline);

      const changed =
        after.range !== before.range ||
        after.durationTurns !== before.durationTurns ||
        after.extraTargets !== before.extraTargets ||
        after.notes.length > 0;

      // `adamant` and `intensified` act inside castSpell rather than here, so
      // they are allowed to be inert in this function specifically.
      if (!changed && !["adamant", "intensified"].includes(id)) inert.push(id);
    }

    assert.deepEqual(inert, [],
      `High Arcana that are selectable but do nothing: ${inert.join(", ")}`);
  });

  test("adamant and intensified are handled in the casting pipeline itself", () => {
    const src = readFileSync(join(root, "module/dice/magic.mjs"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const id of ["adamant", "intensified"]) {
      assert.match(src, new RegExp(`["'\`]${id}["'\`]`),
        `${id} changes the roll or the dice, so castSpell must name it`);
    }
  });
});
