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
                   "module/combat.mjs"].map(read).join("\n");

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
   * Source-level assertions because `hasFlag` is module-private and
   * `#aggregateGrants` needs a live Foundry document to call.
   */
  test("a switched-off technick contributes neither flags nor grants", () => {
    for (const file of ["module/dice/attack.mjs", "module/dice/magic.mjs"]) {
      const body = read(file).match(/function hasFlag\([\s\S]*?\n\}/)[0];
      assert.match(body, /active\s*!==\s*false/,
        `${file}: hasFlag ignores the suspend switch, so switching a technick ` +
        "off on the sheet would not stop its flag applying");
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
