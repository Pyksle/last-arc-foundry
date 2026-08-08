/**
 * Two reachability rules the existing guards cannot see, both from issue #32.
 *
 * A playtester reported that weapons had no damage type and that Weapon Finesse
 * did nothing. Those look like two bugs. They are one, twice: an ArrayField of
 * fixed choices that no template offered any way to change.
 *
 *   weapon.damageType — the field, its `choices` list, its reader in
 *     `rollDamage` and its label on the attack row all existed. No input did, so
 *     every weapon in every world sat on the schema's initial `["slashing"]` and
 *     the resistance rules the field exists to serve were unreachable.
 *   technick.flags — `context.flagOptions` was built by the item sheet, complete
 *     with a `selected` flag per entry, and NO TEMPLATE RENDERED IT. Six
 *     mechanical flags including weaponFinesse could not be switched on, so the
 *     Agi-for-Str branch in `buildDamageTerms` was dead code.
 *
 * WHY NOTHING CAUGHT THEM. The Quench field-coverage suite walks `leafPaths` and
 * skips ArrayFields, so neither field was ever asked about — and Quench needs a
 * live licensed Foundry, so it does not run in CI regardless. The orphan-export
 * guard only sees exported functions, and `flagOptions` is a context key. The
 * derived-binding guard only looks at inputs that DO exist. Every guard passed a
 * sheet with an unusable field on it.
 *
 * These run in `node --test` with no Foundry, so they run on every commit.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LASTARC } from "../module/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Every sheet template and every sheet class, so actor fields count too. */
function slurp(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? slurp(`${dir}/${e.name}`) : [read(`${dir}/${e.name}`)]);
}
const allTemplates = slurp("templates").join("\n");
const allSheets = slurp("module/sheets").join("\n");

/* -------------------------------------------------------------------------- */
/*  A field the player cannot pick from                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every `x: new fields.ArrayField(new fields.StringField({choices: ...}))`.
 *
 * Narrowed to arrays whose elements carry `choices` on purpose. A free-text
 * array (`features`, `senses`, `smithingComponents`) is a different and much
 * milder problem — it degrades to a comma box, and an empty one is a legitimate
 * state. An array of CHOICES is a fixed menu the rules engine reads by key: if
 * the player cannot open the menu, the mechanic behind every key is dead.
 */
function choiceArrays() {
  const out = [];
  for (const file of readdirSync(join(root, "module/data"))) {
    if (!file.endsWith(".mjs")) continue;
    const src = read(`module/data/${file}`);

    let cls = "?";
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const c = lines[i].match(/^export class (\w+)/);
      if (c) cls = c[1];

      const m = lines[i].match(/^\s*(\w+):\s*new fields\.ArrayField\(\s*(.*)$/);
      if (!m) continue;

      /**
       * The ELEMENT must be a StringField carrying choices — the declaration
       * immediately inside the ArrayField, whether on this line or the next.
       *
       * Not a looser search across the whole declaration: `classes` is an
       * ArrayField of SchemaField whose `name` subfield has choices, and a
       * three-line window read that as a choice array. It is an array of rows
       * with its own editor, which is a different shape with a different fix,
       * and flagging it would have taught the next person to widen the excuse
       * list rather than to look.
       */
      // Comments and blank lines sit between the ArrayField and its element
      // often enough that ignoring them is not optional — adding one to
      // items.mjs blinded this extractor, and only its own self-test noticed.
      let j = i;
      let element = (m[2] || "").trim();
      while (!element || element.startsWith("//") || element.startsWith("*")) {
        element = (lines[++j] ?? "").trim();
        if (j > i + 4) break;
      }
      if (!/^new fields\.StringField\(\{[^}]*choices:/.test(element)) continue;

      out.push({ file, cls, field: m[1] });
    }
  }
  return out;
}

/**
 * The template region that renders a given data model.
 *
 * SEARCHING THE WHOLE TEMPLATE IS NOT GOOD ENOUGH, and this guard shipped with
 * that hole before it was caught. One sheet serves all seventeen item subtypes
 * from `{{#if}}` blocks, and `damageType` is a field on FOUR of them. The spell,
 * ammunition and consumable blocks each had a `name="system.damageType"` select;
 * the weapon block had none. A search for the field name anywhere in the file
 * found the spell's select and pronounced the weapon reachable — so the guard
 * written for issue #32 would have passed the release that caused issue #32.
 *
 * Verified the only way that means anything: by running it against v0.15.0 and
 * watching it name both fields.
 */
const SECTIONS = {
  LastArcWeaponData: ['(laeq itemType "weapon")'],
  // Technicks and talents share one data model and one template block, which
  // the sheet selects with a computed flag rather than a type comparison.
  LastArcTechnickData: ["isTechnick"]
};

/** Text of every `{{#if <guard>}}…{{/if}}`, brace-matched rather than greedy. */
function blocksFor(template, guard) {
  const open = `{{#if ${guard}}}`;
  // The whole tag, not just its sigil, so a block's end index lands after the
  // closing `}}` and the extracted region is a complete template fragment.
  const tag = /\{\{~?([#/])[\s\S]*?\}\}/g;
  const out = [];

  let idx = 0;
  while ((idx = template.indexOf(open, idx)) !== -1) {
    let depth = 1;
    tag.lastIndex = idx + open.length;
    let m;
    while (depth > 0 && (m = tag.exec(template))) {
      depth += m[1] === "#" ? 1 : -1;
    }
    const end = depth === 0 ? tag.lastIndex : template.length;
    out.push(template.slice(idx, end));
    idx = end;
  }
  return out;
}

/**
 * Which array field each toggle action writes.
 *
 * The button carries only `data-key`; nothing in the markup names the path. So
 * the action is matched to its handler through DEFAULT_OPTIONS, and the handler
 * to its field through the `#toggleInArray` call — otherwise a button wired to
 * the wrong action would read as reachable.
 */
function toggleActions() {
  const map = {};
  const declared = allSheets.matchAll(/(\w+):\s*\w+\.#(on\w+)/g);
  for (const [, action, handler] of declared) {
    const body = allSheets.match(
      new RegExp(`static async #${handler}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}`)
    );
    const field = body?.[1].match(/#toggleInArray\(\s*"([^"]+)"/);
    if (field) map[action] = field[1];
  }
  return map;
}

/**
 * Can a player change this field, on the sheet that actually renders it?
 *
 * Three mechanisms count, because the codebase legitimately uses all three:
 * a direct binding, a row editor's indexed binding, and a toggle-button action
 * routed through `#toggleInArray`.
 */
function reachable(cls, field) {
  const guards = SECTIONS[cls];
  if (!guards) return { ok: false, why: `no SECTIONS entry for ${cls} — add one` };

  const region = guards
    .flatMap((g) => blocksFor(allTemplates, g))
    .join("\n");

  if (!region) return { ok: false, why: `no template block renders ${cls}` };

  if (region.includes(`name="system.${field}"`)) return { ok: true };
  if (new RegExp(`name="system\\.${field}\\.\\{\\{`).test(region)) return { ok: true };

  for (const [action, written] of Object.entries(toggleActions())) {
    if (written === field && region.includes(`data-action="${action}"`)) return { ok: true };
  }

  return { ok: false, why: "a fixed menu with no way to open it" };
}

describe("every array of fixed choices can actually be chosen from", () => {
  test("the extractor finds the arrays it is meant to police", () => {
    const found = choiceArrays().map((f) => `${f.cls}.${f.field}`);

    // If this drops to zero the suite below passes vacuously, which is how a
    // guard silently stops guarding.
    assert.ok(found.length >= 2, `expected at least two choice arrays, found: ${found.join(", ")}`);
    assert.ok(found.includes("LastArcWeaponData.damageType"), found.join(", "));
    assert.ok(found.includes("LastArcTechnickData.flags"), found.join(", "));
  });

  test("each one has an input, a row editor, or a toggle", () => {
    const unreachable = choiceArrays()
      .map((f) => ({ ...f, verdict: reachable(f.cls, f.field) }))
      .filter(({ verdict }) => !verdict.ok)
      .map(({ cls, field, verdict }) => `${cls}.${field} — ${verdict.why}`);

    assert.deepEqual(unreachable, [],
      "these fields constrain the player to a list of choices and then offer no " +
      "control to choose one, so every mechanic keyed off them is dead:\n  " +
      unreachable.join("\n  "));
  });

  test("the reachability check is scoped to the right template block", () => {
    assert.ok(reachable("LastArcWeaponData", "damageType").ok);
    assert.ok(reachable("LastArcTechnickData", "flags").ok);

    // The hole this guard shipped with: `damage` and `damageType` inputs exist
    // in the spell and ammunition blocks, and must not vouch for the weapon.
    assert.ok(!reachable("LastArcWeaponData", "school").ok,
      "a field bound only in another subtype's block must not count as reachable");
    assert.ok(!reachable("LastArcWeaponData", "zzNotAFieldAnywhere").ok);
    assert.ok(!reachable("LastArcUnmappedData", "anything").ok);
  });

  test("the block matcher stops at the matching close tag", () => {
    const tpl = '{{#if A}}one{{#each x}}two{{/each}}three{{/if}}after{{#if A}}four{{/if}}';
    assert.deepEqual(blocksFor(tpl, "A"), [
      "{{#if A}}one{{#each x}}two{{/each}}three{{/if}}",
      "{{#if A}}four{{/if}}"
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*  A switch that does nothing                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every technick flag must have something that reads it.
 *
 * This became load-bearing the moment the flags picker shipped. Before it, an
 * unread flag was merely unused; now it is a labelled, tickable control that
 * changes nothing — worse than the dead field, because it looks deliberate and
 * a player will build a character around it.
 *
 * Three were removed rather than rendered when the picker was built:
 * `shieldProficiency` (the real switch is `proficiencies.shields`),
 * `hardyAndHearty` (removes a Second Wind cap that issue #10 deleted), and
 * `brawler` (needs threatened-area detection the system has no token data for).
 */
describe("no decoy technick flags", () => {
  const readers = ["module/dice/attack.mjs", "module/dice/magic.mjs",
                   "module/derivation.mjs", "module/action-economy.mjs",
                   "module/combat.mjs",
                   // Dodge gates a whole reaction rather than modifying a roll,
                   // so it is read where that reaction lives (#50).
                   "module/dice/dodge.mjs",
                   // Shield Expert changes the rate of the Block reaction's
                   // cumulative penalty, and is read where that reaction lives
                   // for the same reason (#59). This file's absence from the
                   // list is what caught the flag on its first run, which is
                   // the guard working: a flag nothing reads is a switch that
                   // does nothing, and Block was simply not somewhere it had
                   // ever occurred to anyone to look.
                   "module/dice/block.mjs",
                   // The study flags are counted during derivation rather than
                   // tested for in a dice pipeline — they gate how many spells
                   // and performances may be known, not a roll.
                   "module/data/character.mjs",
                   // Quick Reload changes which action slot pays for a reload
                   // rather than modifying any roll, so it is read where
                   // reloading lives.
                   "module/dice/ammunition.mjs"].map(read).join("\n");

  test("every flag in the picker is read by the rules engine", () => {
    const decoys = LASTARC.technickFlags.filter((f) => !readers.includes(`"${f}"`));

    assert.deepEqual(decoys, [],
      "these flags are offered on the technick sheet and no code reads them, so " +
      "ticking one does nothing:\n  " + decoys.join("\n  "));
  });

  test("the flags that were cut stay cut until something reads them", () => {
    for (const cut of ["shieldProficiency", "hardyAndHearty", "brawler"]) {
      assert.ok(!LASTARC.technickFlags.includes(cut),
        `${cut} is back in the picker — it needs a reader first, or players get ` +
        "a switch that does nothing");
    }
  });

  /**
   * A flag is unconditional once ticked, and most of the book's are not:
   * Backstab doubles exploding dice when you backstab, not on every javelin
   * throw for the rest of the session. The system cannot evaluate the
   * condition, so the player switches the technick off — and every consumer
   * has to honour that, or the switch is decoration.
   *
   * Source-level assertions because the flag reader needs a live Foundry
   * document, as does `#aggregateGrants`.
   *
   * The name is matched loosely on purpose. This test failed when `hasFlag`
   * became `hasTechnickFlag`, which is the right outcome — but a regex that
   * silently matched NOTHING would have passed while asserting nothing at all,
   * so the match is asserted before it is read.
   */
  test("a switched-off technick contributes neither flags nor grants", () => {
    for (const file of ["module/dice/attack.mjs", "module/dice/magic.mjs"]) {
      const found = read(file).match(/function has\w*Flag\([\s\S]*?\n\}/);
      assert.ok(found, `${file}: no flag-reading helper found — this test has ` +
        "lost its target and is asserting nothing");
      assert.match(found[0], /active\s*!==\s*false/,
        `${file}: the flag reader ignores the suspend switch, so switching a ` +
        "technick off on the sheet would not stop its flag applying");
    }

    // Anchored on the DEFINITION: `#aggregateGrants()` also appears as a call
    // inside prepareDerivedData, and matching that swallowed the rest of the
    // method and tested the wrong 200 lines.
    const grants = read("module/data/character.mjs")
      .match(/\n {2}#aggregateGrants\(\)\s*\{[\s\S]*?\n {2}\}/)[0];
    assert.match(grants, /active === false/,
      "a suspended technick still contributes its grants, so the switch would " +
      "suspend half its payload and leave the rest running");
  });

  test("the switch is reachable from the technick row and the item sheet", () => {
    assert.match(allTemplates, /data-action="toggleTechnickActive"/,
      "no switch on the character sheet row — an item sheet round trip between " +
      "two attacks is not something anybody will do twice");
    assert.match(allSheets, /toggleTechnickActive: LastArcCharacterSheet\.#onToggleTechnickActive/);
    assert.ok(allTemplates.includes('name="system.active"'),
      "the field needs a real input on the item sheet too");
  });

  test("every flag has both a label and a hint for its tooltip", () => {
    const lang = JSON.parse(read("lang/en.json"));
    const missing = LASTARC.technickFlags.flatMap((f) => [
      `LASTARC.TechnickFlag.${f}`, `LASTARC.TechnickFlagHint.${f}`
    ]).filter((k) => !(k in lang));

    assert.deepEqual(missing, [], `flags would render a raw key: ${missing.join(", ")}`);
  });
});

/* -------------------------------------------------------------------------- */
/*  Row fields nobody can fill in                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every subfield of an array-of-rows needs an indexed input somewhere.
 *
 * The Quench suite has a check like this. It has NEVER RUN — it needs a
 * licensed Foundry and a live world, so it cannot run in CI, and a guard that
 * has never executed is a guard nobody should be trusting. Four fields on
 * `npc.attacks` proved it: `reach`, `range`, `count` and `notes` were declared
 * on the schema with no input and no reader, dead at both ends since the NPC
 * sheet was written. `count` is a creature's MULTIATTACK — the number of times
 * an ogre swings — and it could not be recorded at all.
 *
 * This is the same rule in plain node, so it runs on every commit.
 */
function rowFields() {
  const out = [];
  for (const file of readdirSync(join(root, "module/data"))) {
    if (!file.endsWith(".mjs")) continue;
    const lines = read(`module/data/${file}`).split("\n");

    /**
     * Enclosing SchemaFields, so the array's FULL path is known.
     *
     * Not cosmetic. The matcher used to allow any prefix before the array name,
     * and a technick's `grants.skills[]` rows were therefore vouched for by the
     * CHARACTER SHEET's `system.skills.{{key}}.focus` — a different model, a
     * different array, the same last two path segments. Three of that row's four
     * fields read as reachable when none of them was, and only `bonus` (whose
     * name happens to collide with nothing) was reported. Recording the prefix
     * is what makes the match mean what it says.
     */
    /**
     * Shared sub-schemas are factored into helper functions and mounted under a
     * field name at the call site — `grants: grantsSchema()`. A line-based walk
     * cannot see across that boundary, so `grants.skills[]` presented itself as
     * a bare `skills[]` and collided with the character sheet's own skills.
     * Resolve the mount point first, then use it while inside the helper.
     */
    const mounts = {};
    for (const [, field, fn] of read(`module/data/${file}`)
      .matchAll(/^\s*(\w+):\s*(\w+Schema)\(\)/gm)) mounts[fn] = field;

    const stack = [];
    let helper = null;
    for (let i = 0; i < lines.length; i++) {
      if (/^export class /.test(lines[i])) { stack.length = 0; helper = null; }

      const fn = lines[i].match(/^function (\w+Schema)\(/);
      if (fn) { stack.length = 0; helper = mounts[fn[1]] ?? null; }

      const s = lines[i].match(/^(\s*)(\w+):\s*new fields\.SchemaField\(\{\s*$/);
      if (s) {
        const depth = s[1].length;
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        stack.push({ name: s[2], depth });
        continue;
      }

      const m = lines[i].match(/^(\s*)(\w+):\s*new fields\.ArrayField\(\s*$/);
      if (!m) continue;
      if (!/new fields\.SchemaField\(\{/.test(lines[i + 1] ?? "")) continue;

      const depth = m[1].length;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const path = [helper, ...stack.map((x) => x.name), m[2]].filter(Boolean).join(".");

      /**
       * Walk the row's own schema, stopping at its closing brace.
       *
       * A SchemaField INSIDE a row opens a subpath rather than being a leaf.
       * Flattening it reported the spell outcome's `onFail.damageMultiplier` as
       * a bare `damageMultiplier`, which matched no binding and was filed as a
       * real gap on #39 — a field that does not exist. The binding it was
       * looking for, `system.outcomes.N.onFail.damageMultiplier`, was there all
       * along. A guard that invents work is its own kind of false alarm.
       */
      const indent = (lines[i + 1].match(/^\s*/) || [""])[0].length;
      const inner = [];
      for (let j = i + 2; j < lines.length; j++) {
        const line = lines[j];
        if (new RegExp(`^\\s{${indent}}\\}`).test(line)) break;

        const f = line.match(/^(\s*)(\w+):\s*new fields\.(\w+)Field\(/);
        if (!f) continue;
        const d = f[1].length;
        while (inner.length && inner[inner.length - 1].depth >= d) inner.pop();

        if (f[3] === "Schema") { inner.push({ name: f[2], depth: d }); continue; }
        out.push({
          file, array: path,
          field: [...inner.map((x) => x.name), f[2]].join(".")
        });
      }
    }
  }
  return out;
}

describe("every row field has an input", () => {
  /**
   * Keyed by the array's FULL path, not the bare field name. A bare key excused
   * the same-named field on every model at once — `name` alone would have
   * silenced an unbound `name` on any row anywhere.
   */
  const EXCUSED = {
    // The Break Gauge persistent-source rows are built and cleared by a dialog
    // (`#onAddPersistent` / `#onClearPersistent`), never typed into a grid.
    "breakGauge.persistentSources.id": "ACTION — assigned when a persistent source is added by dialog",
    "breakGauge.persistentSources.label": "ACTION — chosen in the persistent-source dialog",
    "breakGauge.persistentSources.clearedBy": "ACTION — chosen in the persistent-source dialog",
    "breakGauge.persistentSources.fromInjury": "ACTION — set by the persistent-source dialog",

    /**
     * GENERATED — the four range-increment boxes are drawn by a loop, so their
     * input names end in `{{this.key}}` and this guard's regex, which expects a
     * literal leaf, cannot see them. They ARE reachable.
     *
     * Excusing a field because a guard cannot read it is how a gap hides, so
     * this is not a bare exemption: the schema keys and the editor's loop are
     * both generated from `LASTARC.rangeBands`, and
     * `test/npc-range-bands.test.mjs` asserts that the three lists — config,
     * schema and rendered inputs — are the same set. That is a stronger check
     * than the literal-name match it replaces, because it also catches a band
     * added to the config and forgotten everywhere else.
     */
    "attacks.rangeBands.pointBlank": "GENERATED — see npc-range-bands.test.mjs",
    "attacks.rangeBands.short": "GENERATED — see npc-range-bands.test.mjs",
    "attacks.rangeBands.mid": "GENERATED — see npc-range-bands.test.mjs",
    "attacks.rangeBands.long": "GENERATED — see npc-range-bands.test.mjs"

    /**
     * NOTHING ELSE. The four gaps this guard reported on its first run (#39)
     * are closed, and closing them meant three different answers rather than
     * three more editors:
     *
     *   grants.skills[] — a live mechanic with three consumers and no producer.
     *     Given the editor it was missing.
     *   race.traits[] — read by nothing, rendered by nothing. Deleted. A field
     *     with no reader does not need an input.
     *   outcomes[].damageMultiplier — never existed. This extractor was
     *     flattening `onFail.damageMultiplier`, which is bound; the guard
     *     invented the gap and it was filed as real.
     *
     * An empty excuse list is the point. Every entry above is an ACTION claim
     * that can be checked by opening the dialog it names.
     */
  };

  test("the extractor finds the row schemas", () => {
    const found = rowFields();
    assert.ok(found.length >= 10, `only found ${found.length}`);
    assert.ok(found.some((f) => f.array === "attacks" && f.field === "count"),
      "npc.attacks.count is the field this guard exists for");
  });

  /**
   * The extractor's own correctness, because both of its bugs were INVISIBLE in
   * its output — one hid three real gaps, the other invented one. A guard whose
   * reader is wrong reports confidently either way.
   */
  test("a row array reports its full path, including a helper's mount point", () => {
    const found = rowFields();

    // `grants.skills` lives in `grantsSchema()` and is mounted at `grants:`.
    // As a bare `skills` it collided with the CHARACTER sheet's own
    // `system.skills.{{key}}.focus` bindings, and three of its four fields
    // read as reachable when none of them was.
    assert.ok(found.some((f) => f.array === "grants.skills" && f.field === "bonus"),
      "grants.skills lost its mount point: " +
      found.filter((f) => f.field === "bonus").map((f) => f.array).join(", "));
    /**
     * The collision was real in both directions: an NPC legitimately HAS a bare
     * `skills` row array (a flat printed `{key, value}` list — characters and
     * NPCs keep skills in different shapes). So the assertion is not "no bare
     * skills anywhere", which would be false; it is that the technick's copy is
     * not one of them.
     */
    assert.deepEqual(
      found.filter((f) => f.array === "skills").map((f) => f.file),
      ["npc.mjs", "npc.mjs"],
      "a bare `skills` row array outside npc.mjs means a helper-mounted array " +
      "has lost its prefix and can be vouched for by the character sheet");
  });

  test("a nested schema inside a row keeps its subpath", () => {
    const found = rowFields();

    // Flattened, this was a `damageMultiplier` matching no binding — a gap that
    // did not exist, filed against #39 as though it did.
    assert.ok(found.some((f) => f.array === "outcomes" && f.field === "onFail.damageMultiplier"),
      "the spell outcome's onFail leaves are not being read at their own paths");
    assert.ok(!found.some((f) => f.array === "outcomes" && f.field === "damageMultiplier"),
      "a nested leaf is still being reported as a direct field of the row");
    // The nested schema itself is not a leaf and must not be asked for an input.
    assert.ok(!found.some((f) => f.field === "onFail"),
      "the SchemaField itself is being treated as a value");
  });

  test("no row field is unfillable", () => {
    const missing = rowFields()
      .filter(({ array, field }) => {
        if (EXCUSED[`${array}.${field}`]) return false;
        // The array's FULL path, anchored. Allowing an arbitrary prefix let one
        // model's binding vouch for another's — see the note on `rowFields`.
        return !new RegExp(`name="system\\.${array.replace(/\./g, "\\.")}\\.\\{\\{[^}]*\\}\\}\\.${field}"`)
          .test(allTemplates);
      })
      .map(({ file, array, field }) => `${file}: ${array}[].${field}`);

    assert.deepEqual(missing, [],
      "these are declared on a row schema and no template offers a way to type " +
      "into them, so the data can be stored and never entered:\n  " +
      missing.join("\n  "));
  });
});

/* -------------------------------------------------------------------------- */
/*  Shield Expert, and the reaction it modifies (#59)                          */
/* -------------------------------------------------------------------------- */

/**
 * A playtester reported "no place to add shield expert". They were right, and
 * the shape is the one this file was written for: the rule the talent modifies
 * was implemented, cumulative and correct, and no flag existed for a character
 * to say they had the talent — so the mechanic could only ever run at its
 * default rate.
 *
 * The generic guard above now covers the flag itself. These check the parts of
 * the wiring it cannot see: that the reaction reads it, and that the talent is
 * not quietly confused with the retired proficiency flag of a similar name.
 */
describe("Shield Expert is wired to the Block reaction", () => {
  test("block.mjs reads the flag", () => {
    const src = read("module/dice/block.mjs").replace(/\/\*[\s\S]*?\*\//g, "");
    /**
     * The READ and the HANDOFF in one assertion, deliberately. Checking them
     * separately passes a file that asks for the flag and then hands
     * `blockModifiers` a constant — which is a switch that does nothing, the
     * exact defect this file exists to catch, wearing the shape of a fix.
     */
    assert.match(src, /shieldExpert:\s*hasTechnickFlag\(actor,\s*"shieldExpert"\)/,
      "block.mjs must pass the flag it read to blockModifiers — reading it and " +
      "passing anything else leaves the rate fixed no matter what the character has");
  });

  /**
   * `shieldProficiency` is RETIRED and must stay retired: it is the yes/no
   * "may you use a shield", which lives on `proficiencies.shields` with its own
   * toggle. Reintroducing it as a flag would give the sheet two controls for
   * one fact, and the one that does nothing would look authoritative.
   */
  test("it has not been confused with the retired proficiency flag", () => {
    assert.ok(LASTARC.technickFlags.includes("shieldExpert"));
    assert.ok(!LASTARC.technickFlags.includes("shieldProficiency"));
    assert.ok(LASTARC.retiredTechnickFlags.includes("shieldProficiency"));
  });

  test("the reduced rate is a config value, not a number typed into the maths", () => {
    assert.equal(typeof LASTARC.shieldExpertBlockPenalty, "number");
    assert.ok(LASTARC.shieldExpertBlockPenalty < LASTARC.blockPenaltyPerBlock.proficient,
      "a talent that does not improve on the default rate is not a talent");
    assert.match(read("module/derivation.mjs"), /LASTARC\.shieldExpertBlockPenalty/);
  });

  test("the card can name the reduced rate", () => {
    const lang = JSON.parse(read("lang/en.json"));
    assert.ok("LASTARC.Mod.repeatBlockExpert" in lang,
      "the block card would print a raw key on every expert's repeat block");
  });
});
