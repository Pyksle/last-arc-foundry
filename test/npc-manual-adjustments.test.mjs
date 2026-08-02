/**
 * Curses a statblock cannot apply to itself (#45).
 *
 * The GM's call was that halving Withering's and Dim's maxima by hand is fine —
 * curses are rare and GM-applied. That decision stands and this does not
 * reverse it.
 *
 * What it fixes is that the omission was SILENT. Applying Withering to a
 * monster lights an icon and moves no number, which from the GM's seat is
 * indistinguishable from the "declared and does nothing" defect this project
 * keeps producing. Sharper still because the same curse on a PLAYER halves the
 * maximum automatically — so the GM's own experiment contradicts itself
 * depending on who they cursed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { aggregateStatuses } from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));

describe("§45 the note appears exactly when there is something to do", () => {
  test("a clean statblock gets no note", () => {
    assert.deepEqual(LASTARC.npcManualAdjustments(aggregateStatuses([])), []);
  });

  test("withering asks for max HP, dim for max MP", () => {
    const w = LASTARC.npcManualAdjustments(aggregateStatuses(["withering"]));
    assert.equal(w.length, 1);
    assert.equal(w[0].path, "resources.hp.max");

    const d = LASTARC.npcManualAdjustments(aggregateStatuses(["dim"]));
    assert.equal(d.length, 1);
    assert.equal(d[0].path, "resources.mp.max");
  });

  test("both at once asks for both", () => {
    assert.equal(LASTARC.npcManualAdjustments(aggregateStatuses(["withering", "dim"])).length, 2);
  });

  test("a status with an unrelated payload asks for nothing", () => {
    assert.deepEqual(LASTARC.npcManualAdjustments(aggregateStatuses(["exhaustion"])), []);
  });
});

describe("§45 the note tells the truth about what is unapplied", () => {
  /**
   * The guard that matters. If the NPC model is ever taught to apply one of
   * these, the note becomes a lie that tells the GM to halve an already-halved
   * number — a worse outcome than the silence it replaced.
   */
  test("every listed payload really is unapplied by the NPC model", () => {
    const npc = read("module/data/npc.mjs");
    const body = npc.slice(npc.indexOf("prepareDerivedData()"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    for (const [key, { path }] of Object.entries(LASTARC.npcUnappliedPayloads)) {
      assert.ok(!body.includes(`statuses.${key}`),
        `npc.mjs applies ${key}, so telling the GM to apply it by hand would ` +
        "double it — remove it from npcUnappliedPayloads");
      assert.doesNotMatch(body, new RegExp(`${path.replace(/\./g, "\\.")}\\s*=`),
        `npc.mjs assigns ${path}, which is a printed input (rule 4)`);
    }
  });

  /**
   * ...and the mirror. These are listed as NPC-only problems because a
   * character handles them automatically. If that ever stopped being true the
   * note would be describing an asymmetry that no longer exists.
   */
  test("a character really does apply them automatically", () => {
    const character = read("module/data/character.mjs");
    for (const key of Object.keys(LASTARC.npcUnappliedPayloads)) {
      assert.ok(character.includes(`statuses.${key}`),
        `character.mjs no longer applies ${key} either — this is not an NPC ` +
        "problem any more and the note is misleading");
    }
  });
});

describe("§45 the note is actually reachable", () => {
  const sheet = read("module/sheets/npc-sheet.mjs");
  const template = read("templates/actor/npc-sheet.hbs");

  test("the sheet puts it in context", () => {
    assert.match(sheet, /context\.manualAdjustments\s*=\s*LASTARC\.npcManualAdjustments\(/,
      "npc-sheet.mjs never computes it, so the template renders nothing");
  });

  test("the template renders it", () => {
    assert.match(template, /\{\{#if manualAdjustments\}\}/,
      "the context key is computed and never used — the exact shape of defect " +
      "this project produces most");
    assert.match(template, /\{\{localize this\.hint\}\}/);
  });

  test("every hint has a string", () => {
    for (const { hint } of Object.values(LASTARC.npcUnappliedPayloads)) {
      assert.ok(lang[hint], `${hint} is missing from lang/en.json`);
    }
    assert.ok(lang["LASTARC.NpcManual.title"]);
  });

  test("each hint names the curse it belongs to", () => {
    // "Adjust something by hand" with no subject is useless when two are live
    // at once. Each line has to say which curse it is answering.
    for (const [key, { hint }] of Object.entries(LASTARC.npcUnappliedPayloads)) {
      const carriers = Object.entries(LASTARC.curses)
        .filter(([, def]) => def[key] != null)
        .map(([id]) => id);
      assert.ok(carriers.length, `nothing carries ${key} any more`);
      // The localised STRING, not the key — the key is an identifier and would
      // pass or fail on how it happens to be spelled.
      const text = lang[hint];
      const named = carriers.some((id) => text.toLowerCase().includes(id.toLowerCase()));
      assert.ok(named,
        `"${text}" does not name any of the curses that cause it (${carriers.join(", ")})`);
    }
  });
});
