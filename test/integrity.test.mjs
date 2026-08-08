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
  /**
   * Actions Foundry itself provides on `DocumentSheetV2`, which our sheets
   * inherit and must NOT redeclare.
   *
   * Verified against `client/applications/api/document-sheet.mjs` in v13:
   * `configureSheet`, `copyUuid`, `editImage`, `importDocument`. Only the ones
   * we actually use are listed — an unused entry here would be a hole.
   *
   * This list is why the portrait could not be changed for so long (#52). The
   * markup carried `data-edit="img"`, which is the ApplicationV1 convention;
   * V2 needs `data-action="editImage"` as well, and adding it correctly would
   * have failed this guard for looking undeclared. Better to name the core
   * actions than to leave the guard right and the sheet broken.
   */
  const CORE_ACTIONS = new Set(["editImage"]);

  /**
   * Every editable image carries BOTH halves of the V2 contract (#52).
   *
   * The portrait markup was `<img data-edit="img">` and nothing else, which is
   * the ApplicationV1 convention: V1 bound `img[data-edit]` in
   * `activateListeners`. ApplicationV2 does not. It dispatches the inherited
   * `editImage` action, reads `dataset.edit` for the path, and requires the
   * element to be an IMG — so half the contract silently did nothing, on all
   * three sheets, for the whole life of the project.
   *
   * Nothing could catch it: `data-edit` is not an action, so the wiring guard
   * never looked at it, and the failure is a click that does nothing rather
   * than an error. Reported by the GM, who could not change their portrait.
   */
  test("an editable image has both data-edit and data-action=editImage", () => {
    const broken = [];
    for (const { name, source } of templates) {
      if (name.startsWith("templates/chat/")) continue;
      for (const m of source.matchAll(/<img\b[^>]*>/g)) {
        const tag = m[0];
        const hasEdit = /data-edit=/.test(tag);
        const hasAction = /data-action="editImage"/.test(tag);
        if (hasEdit !== hasAction) {
          broken.push(`${name}: ${hasEdit ? "data-edit without the action" : "the action without data-edit"}`);
        }
      }
    }
    assert.deepEqual(broken, [],
      "ApplicationV2 needs both halves — one alone is a click that does nothing:\n  "
      + broken.join("\n  "));
  });

  /**
   * The blocked branch exists and says something useful (#52).
   *
   * `FILES_BROWSE` defaults to the TRUSTED role, so an ordinary PLAYER cannot
   * open a picker — and `FilePicker#browse()` RETURNS silently when the
   * permission is missing. No error, no notification, nothing in the console.
   * Verified in a live v13 world: GM works, player gets nothing at all.
   *
   * The system cannot grant the permission and must not try. What it can do is
   * stop the image claiming to be clickable and name what to ask the GM for —
   * a player cannot discover this on their own.
   */
  test("an image that cannot be edited explains itself", () => {
    for (const name of ["templates/actor/character-header.hbs",
      "templates/actor/npc-sheet.hbs", "templates/item/item-sheet.hbs"]) {
      const src = templates.find((t) => t.name === name)?.source ?? "";
      assert.match(src, /canBrowseFiles/,
        `${name} does not vary on whether this user can browse files`);
      assert.match(src, /LASTARC\.Tooltip\.EditImageBlocked/,
        `${name} leaves a blocked player with no explanation`);
    }
    for (const key of ["LASTARC.Tooltip.EditImage", "LASTARC.Tooltip.EditImageBlocked"]) {
      assert.ok(lang[key], `${key} is missing`);
    }
    assert.match(lang["LASTARC.Tooltip.EditImageBlocked"], /Configure Permissions/,
      "the tooltip must name where the GM changes it, or it is just a refusal");
  });

  test("every sheet that renders the flag also supplies it", () => {
    // A template branching on a context key nothing sets takes the FALSE branch
    // forever, which here would tell a GM they lack a permission they have.
    for (const src of [sheetSource, npcSheetSource, itemSheetSource]) {
      assert.match(src, /context\.canBrowseFiles = game\.user\?\.can\("FILES_BROWSE"\)/);
    }
  });

  test("at least one image on each sheet is editable at all", () => {
    // Guarding the guard: the check above is satisfied by a template with no
    // images whatsoever, which is how a portrait could go missing entirely.
    for (const name of ["templates/actor/character-header.hbs",
      "templates/actor/npc-sheet.hbs", "templates/item/item-sheet.hbs"]) {
      const src = templates.find((t) => t.name === name)?.source ?? "";
      assert.match(src, /data-action="editImage"/,
        `${name} offers no way to change the document image`);
    }
  });

  test("every data-action in a SHEET template is declared in DEFAULT_OPTIONS.actions", () => {
    const declared = new Set([
      ...CORE_ACTIONS,
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

  /**
   * This test used to require `currentColor` in every icon, on the stated
   * grounds that "currentColor lets Foundry tint the badge". That premise was
   * false and it is what produced issue #41: these files are fetched BY PATH as
   * token overlay images, so there is no cascade around them, no inherited
   * `color`, and nothing to tint. `currentColor` resolved to its initial value
   * — black — and black line art on a dark token cannot be seen.
   *
   * A test asserting the cause of a bug is worse than no test, because it
   * defends the bug. The colour rule now lives in test/theme.test.mjs, which
   * requires each file to state a colour of its own.
   *
   * What remains here is the part that was always right: an icon must not
   * depend on anything outside itself. `url(#…)` is an INTERNAL reference to
   * the file's own halo filter and is explicitly allowed — the old pattern
   * banned every `url(` and would have failed the fix.
   */
  test("icons are self-contained SVG with no external references", () => {
    for (const file of readdirSync(join(root, "assets/status"))) {
      const svg = readFileSync(join(root, "assets/status", file), "utf8");
      assert.ok(svg.startsWith("<svg"), `${file} is not an SVG`);

      for (const m of svg.matchAll(/\burl\(\s*['"]?([^'")]+)/gi)) {
        assert.ok(m[1].startsWith("#"),
          `${file} references an external asset: url(${m[1]})`);
      }
      for (const m of svg.matchAll(/\b(?:href|xlink:href|src)\s*=\s*"([^"]*)"/gi)) {
        assert.ok(m[1].startsWith("#"),
          `${file} references an external asset: ${m[1]}`);
      }
      assert.doesNotMatch(svg, /<image\b/i, `${file} embeds a raster image`);
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
    ["initiativeDieFor", "die lookup superseded by the derived actor value"],

    /**
     * `isFlatFooted` and `trainedSkillCount` both sat here and have both since
     * been wired, which is the staleness check below working as intended rather
     * than a courtesy. `isFlatFooted` left on issue #37: the lifecycle now
     * reaches it through `flatFootedAtCombatStart` instead of inlining a
     * narrower copy of the same rule.
     */
  ]);

  /**
   * Strip comments and string literals before counting uses.
   *
   * WITHOUT THIS THE GUARD IS VOUCHED FOR BY PROSE. It counted every occurrence
   * of the name anywhere in `module/`, so a function was protected from the
   * check by any comment that happened to mention it — including a comment
   * explaining why it was not wired, which is precisely what somebody writes
   * immediately before leaving it unwired.
   *
   * `trainedSkillCount` survived exactly that way (issue #34): defined in
   * derivation.mjs, called by nothing, and kept quiet by one line of prose in
   * config.mjs describing the state it was left in. This is the guard the
   * project leans on hardest, and the hole opened whenever anyone documented
   * an omission honestly.
   */
  const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, " ")     // block comments, including JSDoc
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")   // line comments, sparing "https://"
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")    // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");

  test("every exported function is called somewhere, or explained", () => {
    const files = readdirSync(join(root, "module"), { recursive: true })
      .filter((f) => typeof f === "string" && f.endsWith(".mjs"))
      .map((f) => ({
        name: f,
        source: readFileSync(join(root, "module", f), "utf8")
      }));

    const corpus = files.map((f) => codeOnly(f.source)).join("\n");

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

  test("a comment mentioning a function does not vouch for it", () => {
    // The regression itself. If this passes vacuously the guard is back to
    // trusting prose, and the next unwired export goes quiet again.
    const stripped = codeOnly(`
      /** talks about zzWidget in a block comment */
      // and zzWidget again in a line comment
      const msg = "zzWidget in a string";
      export function zzWidget() {}
    `);
    assert.equal([...stripped.matchAll(/\bzzWidget\b/g)].length, 1,
      "comments or strings are still being counted as uses");

    // ...and a real call still counts.
    assert.equal([...codeOnly("zzWidget();").matchAll(/\bzzWidget\b/g)].length, 1);
  });

  test("the allowlist has no stale entries", () => {
    // An allowlisted function that HAS been wired should leave the list, or the
    // list slowly becomes a place bugs hide.
    // Same comment-stripping as the guard above, and for the same reason: this
    // check counted prose too, so a comment naming an allowlisted function
    // reported it as "now wired" and demanded its removal from the list. The
    // two halves have to agree on what a use is, or they contradict each other.
    const files = readdirSync(join(root, "module"), { recursive: true })
      .filter((f) => typeof f === "string" && f.endsWith(".mjs"))
      .map((f) => codeOnly(readFileSync(join(root, "module", f), "utf8")))
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

/* -------------------------------------------------------------------------- */

/**
 * ISSUE #21. `proficiencies.weapons` and `proficiencies.armour` were read from
 * the first release and had no input anywhere, so every character was
 * non-proficient with every weapon — a permanent −5 on every attack — and with
 * every armour, applying the check penalty to every Str- and Agi-based skill.
 * Only `shields` had a checkbox.
 *
 * The Quench field-coverage guard is the test that catches this class of bug,
 * and it needs a live Foundry to render a sheet, so it had never been run
 * against these. This is the CI-runnable half: it cannot prove the controls
 * work, only that something claims to bind each path. That is exactly the
 * distance between a green suite and a working sheet, and it is enough to stop
 * a field being read by the maths while no player can set it.
 */
describe("issue #21 — every proficiency is reachable", () => {
  const bound = templates
    .flatMap(({ source }) => [...source.matchAll(/name="([^"]+)"/g)].map((m) => m[1]))
    .filter((n) => n.startsWith("system."))
    .map((n) => n.slice("system.".length));

  const body = templates.find((t) => t.name.endsWith("character-body.hbs")).source;

  /**
   * A path is reachable if a form control binds it OR an action button writes
   * it. The first version of this guard only understood bindings, which is why
   * it went red the moment the proficiency grid became buttons (#28) even
   * though the grid had just become MORE reliable. Same narrowness as the
   * ArrayField gap: a coverage test that knows one mechanism will confidently
   * report a hole in the other.
   */
  const boundOrWritten = (path) =>
    bound.some((b) => b === path || b.startsWith(path)) ||
    // A toggle for that group. The handler writes the path through a template
    // literal (`system.proficiencies.${prof}`), so searching the sheet source
    // for the literal string finds only `shields` and would wrongly report the
    // two array groups as unreachable. The write itself is pinned below.
    body.includes(`data-prof="${path.split(".").pop()}"`);

  for (const path of ["proficiencies.weapons", "proficiencies.armour", "proficiencies.shields"]) {
    test(`${path} has a control`, () => {
      assert.ok(boundOrWritten(path),
        `${path} is read by the maths and nothing on any sheet can set it`);
    });
  }

  test("a control is generated for every configured category", () => {
    /**
     * The row-building half moved to `sheet-rows.mjs` in #44 so the preview
     * harness could call it instead of keeping a second copy. The behavioural
     * assertion — one row per configured category, in config order — now lives
     * in test/sheet-rows.test.mjs, where it can call the function rather than
     * grep for it. What is left here is the TEMPLATE half, which is what this
     * test was really about: a toggle the player can click.
     */

    for (const prof of ["weapons", "armour", "shields"]) {
      assert.match(body, new RegExp(`data-prof="${prof}"`),
        `no toggle for ${prof} proficiency`);
    }
  });

  /**
   * ISSUE #28 REGRESSION GUARD. The grid shipped in 0.12.0 as bound checkboxes
   * repacked in `_prepareSubmitData`, and was reported as not staying selected
   * — intermittently, which is what a race looks like. This sheet submits on
   * every change, so a tick can be lost to the re-render between mousedown and
   * click; Second Wind hit the identical bug and was moved to buttons for the
   * identical reason. Nothing here may go back to a bound checkbox.
   */
  test("proficiencies are toggle buttons, not form checkboxes", () => {
    assert.doesNotMatch(body, /name="system\.proficiencies\./,
      "a bound checkbox on this sheet races submitOnChange; use data-action=\"toggleProficiency\"");
    assert.match(body, /data-action="toggleProficiency"/);
    assert.match(sheetSource, /toggleProficiency: LastArcCharacterSheet\.#onToggleProficiency/,
      "the action must be registered or the buttons do nothing");
  });

  test("the toggle writes the arrays directly", () => {
    assert.match(sheetSource, /system\.proficiencies\.\$\{prof\}/,
      "the handler must write the proficiency array itself, with no form round-trip");
  });
});


/* -------------------------------------------------------------------------- */

/**
 * ISSUE #28 — the ratchet.
 *
 * Reported as proficiencies granting a permanent, creeping +3 to Will Defence.
 * The proficiency toggles were innocent; they submitted the form repeatedly and
 * that was enough to expose this.
 *
 * `misc` and attribute values are the paths Active Effects are DELIBERATELY fed
 * into (CLAUDE.md: effects apply between prepareBaseData and prepareDerivedData,
 * so anything derived would overwrite them, and the misc slots exist to receive
 * them). An <input> rendering the PREPARED value therefore shows the number with
 * the effect already in it — and `submitOnChange` writes that back on the next
 * change to anything on the sheet. The effect then applies again on top of its
 * own result, every time, permanently.
 *
 * CLAUDE.md already states the rule for derived values, and it shipped twice
 * before this. This is the same rule with the wider boundary it always needed:
 * an input must render what is STORED, never what has been prepared.
 */
describe("issue #28 — inputs must render stored values", () => {
  const body = templates.find((t) => t.name.endsWith("character-body.hbs")).source;

  /** Paths an Active Effect is expected to feed, and so must not echo back. */
  const EFFECT_FED = [
    "system.defences.{{this.key}}.misc",
    "system.skills.{{this.key}}.misc",
    "system.attributes.{{this.key}}.value"
  ];

  for (const path of EFFECT_FED) {
    test(`${path} renders a source value`, () => {
      const re = new RegExp(
        `name="${path.replace(/[.{}]/g, "\\$&")}"\\s+value="\\{\\{this\\.(\\w+)\\}\\}"`
      );
      const m = body.match(re);
      assert.ok(m, `no input found for ${path}`);
      assert.match(m[1], /Input$/,
        `${path} renders "${m[1]}", which is the PREPARED value — it will be ` +
        `written back on the next submit and the effect will stack on itself`);
    });
  }

  test("the source values come from _source, not the prepared model", () => {
    assert.match(sheetSource, /this\.document\.system\._source/,
      "the sheet must still take a source snapshot to hand to the row builders");
    /**
     * The `*Input: src.…` assignments moved to `sheet-rows.mjs` (#44), and are
     * now checked by CALLING them: test/sheet-rows.test.mjs builds a fixture
     * whose stored and prepared values differ and asserts each input carries
     * the stored one. That catches `sys.` where `src.` was meant, which this
     * substring scan could only ever catch by spelling.
     */
    assert.match(readFileSync(join(root, "module/sheet-rows.mjs"), "utf8"),
      /valueInput: src\?\./,
      "attribute inputs no longer read the source snapshot");
  });
});

/* -------------------------------------------------------------------------- */

/**
 * A document subtype is not a schema field.
 *
 * `technick` and `talent` are separate Item subtypes served by ONE data model,
 * and that model also carried `kind: StringField({ initial: "technick",
 * choices: ["technick", "talent"] })`. The same fact written down twice, in a
 * place where the two copies were free to disagree — and they did, on every
 * talent anybody made through the UI. `defineSchema()` is static and the class
 * is shared, so a `talent` document cannot take a different `initial`; it got
 * `"technick"` and opened with a title bar reading "Talent" above a Kind
 * reading "Technick". The dropdown could then put the contradiction the other
 * way round on a technick just as easily.
 *
 * Nothing read it. Every rule that cares branches on `item.type`, which is
 * always present and cannot drift.
 *
 * The general shape is what is guarded here rather than the one field: a data
 * model shared by several subtypes, offering a choice list that IS the set of
 * subtypes it serves, has re-invented `type` as editable data.
 */
describe("a document subtype is not a schema field", () => {
  /** `{ ClassName: [subtype, …] }`, read off the registration map. */
  const servedBy = (() => {
    const map = itemsSource.match(/ITEM_DATA_MODELS\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
    const out = {};
    for (const [, subtype, cls] of map.matchAll(/^\s*(\w+):\s*(LastArc\w+),?\s*$/gm)) {
      (out[cls] ??= []).push(subtype);
    }
    return out;
  })();

  /** Everything one class declares, up to the next top-level `export`. */
  const bodyOf = (cls) => {
    const start = itemsSource.indexOf(`export class ${cls} `);
    if (start === -1) return "";
    const end = itemsSource.indexOf("\nexport ", start + 1);
    return itemsSource.slice(start, end === -1 ? undefined : end);
  };

  /** The values a `choices:` expression admits, or null if it is not literal. */
  const resolveChoices = (expr) => {
    const named = expr.match(/^LASTARC\.(\w+)$/);
    if (named) return Array.isArray(LASTARC[named[1]]) ? LASTARC[named[1]] : null;
    if (expr.startsWith("[")) return [...expr.matchAll(/["'](\w+)["']/g)].map((m) => m[1]);
    return null;
  };

  const sameSet = (a, b) =>
    a.length === b.length && a.every((v) => b.includes(v));

  /**
   * The parse is the whole test, so a regex that quietly stops matching would
   * turn every assertion below into a pass over an empty list.
   */
  test("the registration map parses and the shared models are found", () => {
    assert.equal(
      Object.values(servedBy).flat().length,
      Object.keys(systemJson.documentTypes.Item).length,
      "the ITEM_DATA_MODELS scan did not find one entry per declared subtype"
    );
    assert.deepEqual([...(servedBy.LastArcTechnickData ?? [])].sort(),
      ["talent", "technick"],
      "technicks and talents no longer share a data model — this guard's premise");
  });

  for (const [cls, subtypes] of Object.entries(servedBy)) {
    if (subtypes.length < 2) continue;

    test(`${cls} does not restate the ${subtypes.join("/")} split as a field`, () => {
      const offenders = [];
      for (const [, field, expr] of bodyOf(cls).matchAll(
        /(\w+):\s*new fields\.StringField\(\{[^}]*?choices:\s*(\[[^\]]*\]|[\w.]+)/g
      )) {
        const values = resolveChoices(expr.trim());
        if (values && sameSet(values, subtypes)) offenders.push(field);
      }
      assert.deepEqual(offenders, [],
        `${cls} serves ${subtypes.join(" and ")} and declares ${offenders.join(", ")} ` +
        `over exactly those values. A shared schema cannot vary its \`initial\` by ` +
        `subtype, so the field starts wrong for every subtype but the first and the ` +
        `sheet contradicts its own title bar. Branch on \`item.type\` instead.`);
    });
  }
});
