/**
 * A type-gated block may only read fields the gated types actually have (#66).
 *
 * THE FAILURE THIS EXISTS FOR. Features were given mechanical flags (#64), and
 * the picker was rendered for them by widening the nearest gate in
 * `item-sheet.mjs` from `isTechnick` to `hasFlags`. That block also built the
 * whole PREREQUISITES context, and a feature has no `prerequisites` field — so
 * `sys.prerequisites.attributes` threw and NO FEATURE SHEET WOULD OPEN. Race
 * and class features are on every character in every world; it was reported
 * within hours of the release.
 *
 * WHY NOTHING CAUGHT IT, which is the part worth fixing:
 *
 *   - `npm test` never runs `_prepareContext`. The offline preview harness
 *     supplies a hand-written fixture — including `hasFlags: true` and
 *     `prereqAttributes` — so it renders the TEMPLATE against plausible data
 *     and never executes the sheet code that builds it.
 *   - Quench opens actor sheets but did not open one item sheet per subtype.
 *   - Every other guard is about reachability: whether a field has an input.
 *     This was the opposite — a field that does not exist, read anyway.
 *
 * So this reads the source rather than running it: for each type-gated block in
 * the item sheet, work out which subtypes reach it, and check every `sys.x` it
 * touches is declared on all of their data models.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const sheet = read("module/sheets/item-sheet.mjs");
const items = read("module/data/items.mjs");

/* -- which model serves which subtype -------------------------------------- */

const MODEL_OF = (() => {
  const map = items.match(/ITEM_DATA_MODELS\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  const out = {};
  for (const [, type, cls] of map.matchAll(/^\s*(\w+):\s*(LastArc\w+),?\s*$/gm)) out[type] = cls;
  return out;
})();

/** Top-level field names each model declares, `commonFields()` included. */
const FIELDS_OF = (() => {
  const common = (items.match(/function commonFields\(\)[\s\S]*?\n\}/)?.[0] ?? "")
    .matchAll(/^\s{4}(\w+):/gm);
  const shared = [...common].map((m) => m[1]);

  const out = {};
  for (const m of items.matchAll(/export class (LastArc\w+)[\s\S]*?static defineSchema\(\)\s*\{\s*return \{([\s\S]*?)\n {4}\};/g)) {
    const [, cls, body] = m;
    // Top-level keys only: six spaces of indent inside the returned object.
    out[cls] = new Set([...body.matchAll(/^ {6}(\w+):/gm)].map((x) => x[1]));
    if (body.includes("...commonFields()")) for (const f of shared) out[cls].add(f);
  }
  return out;
})();

/* -- the gates, and which subtypes reach each ------------------------------ */

/**
 * `isTechnick` and `hasFlags` are computed on the context, so their membership
 * is read out of their own assignments rather than restated here — restating it
 * is how a guard drifts from the thing it guards.
 */
function typesFor(gate) {
  if (gate.startsWith('item.type === "')) return [gate.match(/"(\w+)"/)[1]];

  const assign = sheet.match(new RegExp(`context\\.${gate}\\s*=\\s*([^;]+);`))?.[1];
  if (!assign) return null;

  const types = [...assign.matchAll(/item\.type === "(\w+)"/g)].map((m) => m[1]);
  // A gate may be defined in terms of another (`hasFlags = isTechnick || …`).
  for (const [, other] of assign.matchAll(/context\.(\w+)/g)) {
    const nested = typesFor(other);
    if (nested) types.push(...nested);
  }
  return types.length ? [...new Set(types)] : null;
}

/** Every `if (<gate>) { … }` block in `_prepareContext`, brace-matched. */
function gatedBlocks() {
  const out = [];
  const opener = /if \((?:context\.(\w+)|item\.type === "(\w+)")\)\s*\{/g;
  let m;
  while ((m = opener.exec(sheet))) {
    let depth = 1;
    let i = opener.lastIndex;
    while (i < sheet.length && depth > 0) {
      if (sheet[i] === "{") depth++;
      else if (sheet[i] === "}") depth--;
      i++;
    }
    out.push({
      gate: m[1] ?? `item.type === "${m[2]}"`,
      body: sheet.slice(opener.lastIndex, i - 1)
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */

describe("a type-gated block reads only fields those types have", () => {
  test("the parses find their targets", () => {
    // All three are the whole test; a silent empty parse would turn every
    // assertion below into a pass over nothing.
    assert.ok(Object.keys(MODEL_OF).length >= 15,
      `only mapped ${Object.keys(MODEL_OF).length} item subtypes`);
    assert.ok(FIELDS_OF.LastArcTechnickData?.has("prerequisites"),
      "the schema parse is not finding a technick's own fields");
    assert.ok(!FIELDS_OF.LastArcFeatureData?.has("prerequisites"),
      "a feature is being credited with prerequisites it does not have — the " +
      "parse is too loose and this guard would have missed #66");
    // The gates by NAME rather than a count — a count drifts every time a
    // subtype block is added or removed, and says nothing about whether the two
    // that matter were found.
    const gates = gatedBlocks().map((b) => b.gate);
    for (const expected of ["isTechnick", "hasFlags", 'item.type === "weapon"',
      'item.type === "race"', 'item.type === "spell"']) {
      assert.ok(gates.includes(expected),
        `the block scan missed ${expected} — found: ${gates.join(", ")}`);
    }
    assert.deepEqual(typesFor("hasFlags").sort(), ["feature", "talent", "technick"]);
    assert.deepEqual(typesFor("isTechnick").sort(), ["talent", "technick"]);
  });

  test("no gated block touches a field one of its types lacks", () => {
    const offenders = [];

    for (const { gate, body } of gatedBlocks()) {
      const types = typesFor(gate);
      if (!types) continue;                     // not a type gate

      // `sys.x` reads only. `sys.x?.y` and `sys.x.y` both count as reading `x`.
      const fields = new Set(
        [...body.matchAll(/\bsys\.(\w+)/g)].map((m) => m[1])
      );

      for (const type of types) {
        const model = MODEL_OF[type];
        const declared = FIELDS_OF[model];
        if (!declared) continue;
        for (const field of fields) {
          if (declared.has(field)) continue;
          offenders.push(`${gate} reads sys.${field}, absent on ${type} (${model})`);
        }
      }
    }

    assert.deepEqual(offenders, [],
      "these read a field the gated subtype's data model does not declare, so " +
      "`_prepareContext` throws and the sheet will not open at all:\n  " +
      offenders.join("\n  "));
  });

  /**
   * The specific pairing that broke, pinned so the two gates cannot be merged
   * again by someone reading them as the same question. They are not: a racial
   * has flags and no prerequisites.
   */
  test("prerequisites and flags stay separate gates", () => {
    const prereqBlock = gatedBlocks().find((b) => b.body.includes("sys.prerequisites"));
    assert.ok(prereqBlock, "nothing builds the prerequisites context any more");
    assert.equal(prereqBlock.gate, "isTechnick",
      "the prerequisites context is gated on something other than isTechnick; " +
      "features reach it and have no prerequisites field");

    const flagBlock = gatedBlocks().find((b) => b.body.includes("technickFlagOptions"));
    assert.ok(flagBlock, "nothing builds the flags picker any more");
    assert.equal(flagBlock.gate, "hasFlags",
      "the flags picker must reach features too, or #64's racials cannot be set");
  });
});
