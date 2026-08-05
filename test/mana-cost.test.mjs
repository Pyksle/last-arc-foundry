/**
 * Mana: who spends it, and what a sheet says when it will not let you act.
 *
 * Reported from a playtest as "Floofers couldn't perform" — an NPC bard whose
 * Perform button did nothing at all.
 *
 * THE CAUSE. Performances do NOT cost mana: Chapter 9 never mentions it, no
 * performance name carries the parenthetical cost every spell name has, and an
 * earlier pass removed `mpCost` from the performance schema for exactly that
 * reason. Both sheets went on reading the field anyway. `undefined` is what
 * they got, and `mp >= undefined` is FALSE for every value of mp — so every
 * performance row was unaffordable forever. The statblock template then
 * rendered that as a `disabled` button; the character sheet's equivalent row
 * had no disabled attribute, so a PC could still perform. Hence a bug that
 * looked like it belonged to NPC sheets, because it did.
 *
 * THE NEAR-MISS, recorded because the next reader will be tempted the same way.
 * Reading the sheets' leftover affordability check, the obvious conclusion is
 * that `performItem` forgot to charge — and on playtest day a mana gate and a
 * deduction were duly written into it. That would have invented a cost the
 * rules do not have. The schema's own comment caught it.
 *
 * THE OTHER HALF. A refusal must still be legible where one is real: a spell
 * the caster cannot afford now disables WITH the reason on it, rather than
 * going quietly inert. That is the #46 rule, which this project keeps relearning.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { magicRowCost } from "../module/sheet-rows.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));
const magic = read("module/dice/magic.mjs");
const entry = read("module/last-arc.mjs");
const charTpl = read("templates/actor/character-body.hbs");
const npcTpl = read("templates/actor/npc-sheet.hbs");

/** A stand-in for game.i18n, so the helper stays Foundry-free. */
const i18n = {
  localize: (k) => `«${k}»`,
  format: (k, d) => (lang[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(d[n]))
};

describe("§ affordability, and saying why not", () => {
  test("enough mana is affordable and keeps the ordinary tooltip", () => {
    const r = magicRowCost(2, 5, "Floofers", "LASTARC.Tooltip.Perform", i18n);
    assert.equal(r.affordable, true);
    assert.equal(r.costTooltip, "«LASTARC.Tooltip.Perform»");
  });

  test("exactly enough is enough — it is a floor, not a margin", () => {
    assert.equal(magicRowCost(5, 5, "X", "K", i18n).affordable, true);
    assert.equal(magicRowCost(6, 5, "X", "K", i18n).affordable, false);
  });

  test("a free performance is affordable at zero mana", () => {
    // The commonest statblock in the world: 0 MP, and a 0-cost ability.
    assert.equal(magicRowCost(0, 0, "X", "K", i18n).affordable, true);
  });

  /**
   * The whole point. The tooltip has to name the numbers, because the button
   * is disabled and there is nothing else on screen to read.
   */
  test("too little mana explains itself with both numbers", () => {
    const r = magicRowCost(2, 0, "Floofers", "LASTARC.Tooltip.Perform", i18n);
    assert.equal(r.affordable, false);
    assert.match(r.costTooltip, /Floofers/);
    assert.match(r.costTooltip, /\b2\b/, "must state the cost");
    assert.match(r.costTooltip, /\b0\b/, "must state what they actually have");
    assert.notEqual(r.costTooltip, "«LASTARC.Tooltip.Perform»");
  });

  test("it reuses the casting pipeline's own string rather than a near-duplicate", () => {
    assert.ok(lang["LASTARC.Warning.NotEnoughMana"]);
    assert.match(magic, /LASTARC\.Warning\.NotEnoughMana/);
    assert.equal(
      Object.keys(lang).filter((k) => /NotEnoughM(ana|p)\b/i.test(k)).length, 1,
      "one shortage, one sentence");
  });

  test("missing or junk numbers never make a row look affordable by accident", () => {
    assert.equal(magicRowCost(3, undefined, "X", "K", i18n).affordable, false);
    assert.equal(magicRowCost(3, null, "X", "K", i18n).affordable, false);
    assert.equal(magicRowCost(undefined, 0, "X", "K", i18n).affordable, true);
  });
});

describe("§ a performance costs no mana, and nothing may pretend otherwise", () => {
  const perform = magic.slice(magic.indexOf("export async function performItem"));
  const body = perform.slice(0, perform.indexOf("\nexport "));

  /**
   * THE BUG, and the near-miss.
   *
   * Chapter 9 never mentions mana, and no performance name carries the
   * parenthetical cost every spell name has — so an earlier pass removed
   * `mpCost` from the performance schema on purpose. Both sheets kept reading
   * it. `undefined` is what they got, and `mp >= undefined` is FALSE for every
   * value of mp, so every performance row computed as unaffordable forever.
   *
   * On the statblock that meant a permanently disabled button. On the character
   * sheet the same row had no `disabled` attribute, so it worked. Hence the
   * report: an NPC could not perform and a PC could, which is exactly the
   * asymmetry these tests now pin down.
   *
   * The near-miss: reading the sheets' leftover check, the obvious conclusion
   * is that the pipeline forgot to charge — and a mana gate and deduction were
   * duly added on playtest day. The schema comment caught it. These tests exist
   * so the next reader is caught by something louder than a comment.
   */
  test("the performer's mana is never touched", () => {
    assert.doesNotMatch(body, /actor\.update\(\{\s*"system\.resources\.mp\.value"/,
      "performances do not cost mana (Chapter 9); this is the symmetry with " +
      "castSpell that keeps inviting a wrong fix");
    assert.doesNotMatch(body, /available < cost/);
  });

  /**
   * The target's mana IS drained by an enfeebling tier. Asserted so the guard
   * above cannot be "fixed" by deleting the wrong write.
   */
  test("but an enfeebling tier still drains its TARGET", () => {
    assert.match(body, /target\.update\(\{ "system\.resources\.mp\.value"/);
  });

  test("the schema really does not declare a cost", () => {
    const items = read("module/data/items.mjs");
    const model = items.slice(items.indexOf("class LastArcPerformanceData"));
    const schema = model.slice(0, model.indexOf("\nexport class"));
    assert.doesNotMatch(schema, /^\s*mpCost:/m,
      "if performances ever gain a cost, both sheets and performItem change too");
  });

  test("casting is unaffected — spells still cost and still gate", () => {
    const cast = magic.slice(magic.indexOf("export async function castSpell"));
    assert.match(cast, /available < cost/);
    assert.match(cast, /system\.resources\.mp\.value/);
  });
});

/**
 * The generalisable guard: a row may not compute affordability from a field
 * its schema does not declare. That is the shape of this defect, and it is
 * silent — `undefined` in a comparison is simply false, forever.
 */
describe("§ no performance row invents a cost", () => {
  const sheets = {
    character: read("module/sheets/character-sheet.mjs"),
    npc: read("module/sheets/npc-sheet.mjs")
  };
  const templates = { character: charTpl, npc: npcTpl };

  /**
   * Handlebars comments are STRIPPED before any of this is scanned.
   *
   * The first version of these assertions failed on the word "disabled"
   * appearing inside the comment that explains why nothing is disabled — a
   * guard defeated by the note recording its own fix. That has now happened
   * three times in this repo, on three different suites.
   */
  const strip = (s) => s.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

  /** Just the Perform button, so the reorder arrows' own `disabled` is not in scope. */
  function performButton(tpl) {
    const panel = strip(tpl.slice(tpl.indexOf("la-panel--performances")));
    const block = panel.slice(0, panel.indexOf("la-panel__add"));
    const at = block.indexOf('data-action="performItem"');
    assert.ok(at > 0, "no Perform button in the performances panel");
    const open = block.lastIndexOf("<button", at);
    return block.slice(open, block.indexOf("</button>", at));
  }

  for (const [name, tpl] of Object.entries(templates)) {
    test(`${name}: the Perform button carries no cost and can never be disabled`, () => {
      const btn = performButton(tpl);
      assert.doesNotMatch(btn, /mpCost/,
        "a cost the schema does not have renders blank and reads as a bug");
      assert.doesNotMatch(btn, /affordable/,
        "affordability against a missing field is false forever — this is what " +
        "disabled every statblock's Perform button");
      assert.doesNotMatch(btn, /\bdisabled\b/,
        "nothing about a performance can make it unaffordable");
    });
  }

  test("the button extractor is really looking at a button", () => {
    // A regex that matched nothing would make all three assertions above pass.
    for (const tpl of Object.values(templates)) {
      assert.match(performButton(tpl), /^<button[\s\S]*performItem/);
    }
  });

  /**
   * JS comments stripped for the same reason the Handlebars ones are: the note
   * explaining that this row must not read `mpCost` contains the word
   * `mpCost`, and without this the guard fails on its own documentation. That
   * is now three separate suites in this repo defeated by the comment
   * recording their fix.
   */
  const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  test("neither sheet reads mpCost when building a performance row", () => {
    for (const [name, src] of Object.entries(sheets)) {
      const at = src.indexOf('=== "performance"');
      assert.ok(at > 0, `${name}: no performance branch found`);
      const branch = stripJs(src.slice(at, src.indexOf("});", at) + 3));

      // The slice must still contain the row, or this proves nothing.
      assert.match(branch, /specialisation/, `${name}: branch slice looks empty`);

      assert.doesNotMatch(branch, /mpCost/,
        `${name} builds a performance row from a field the schema does not declare`);
      assert.doesNotMatch(branch, /affordable/,
        `${name} still computes affordability for a performance`);
    }
  });

  /**
   * The two sheets must AGREE about whether a performance can be refused. They
   * did not, and the disagreement was invisible until an NPC tried to sing:
   * the statblock's button was disabled and the character's was not.
   */
  test("both sheets treat a performance identically", () => {
    const [a, b] = Object.values(templates).map((t) =>
      /\bdisabled\b/.test(performButton(t)));
    assert.equal(a, b, "one sheet disabling what the other allows is the whole bug");
    assert.equal(a, false);
  });
});

/**
 * SPELLS still cost mana, still gate, and now say so when they refuse.
 */
describe("§ a spell that cannot be paid for explains itself", () => {
  const templates = { character: charTpl, npc: npcTpl };
  const strip = (s) => s.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

  for (const [name, tpl] of Object.entries(templates)) {
    test(`${name}: the Cast button carries the reason, not a fixed label`, () => {
      const panel = strip(tpl.slice(tpl.indexOf("la-panel--spells")));
      const block = panel.slice(0, panel.indexOf("la-panel__add"));
      assert.match(block, /data-tooltip="\{\{this\.costTooltip\}\}"/,
        "the tooltip must be the per-row reason, not a constant");
      assert.match(block, /\{\{#unless this\.affordable\}\}disabled\{\{\/unless\}\}/,
        "an unaffordable spell disables — with the reason on it");
    });
  }

  test("both spell rows are built by the one shared helper", () => {
    const sheets = read("module/sheets/character-sheet.mjs")
      + read("module/sheets/npc-sheet.mjs");
    assert.equal((sheets.match(/magicRowCost\(/g) ?? []).length, 2,
      "one spell row per sheet, and nothing else");
    assert.doesNotMatch(sheets, /affordable:\s*\(?.*>=.*mpCost/,
      "no sheet may compute affordability itself — that is how the two drifted");
  });
});

describe("§ raising a maximum on a creature at full keeps it full", () => {
  const hook = entry.slice(entry.indexOf('Hooks.on("preUpdateActor"'));
  const body = hook.slice(0, hook.indexOf("\n  });") + 6);

  /**
   * `createActor` cannot serve a statblock: an NPC's maxima are printed numbers
   * typed in afterwards, so at creation `mp.max` is 0 and that hook's `max > 0`
   * condition is never true.
   */
  test("it covers both pools, not just the one that was reported", () => {
    assert.match(body, /\["hp", "mp"\]/,
      "a monster stuck at 10 of 60 HP is the same bug as a bard stuck at 0 MP");
  });

  test("full is the condition, so a wounded creature is left alone", () => {
    assert.match(body, /current\.value !== current\.max/);
  });

  test("only upward — lowering a maximum must not heal anybody", () => {
    assert.match(body, /newMax <= current\.max/);
  });

  test("an explicit value in the same update wins", () => {
    assert.match(body, /system\.resources\.\$\{key\}\.value`\) != null\) continue/);
  });

  /**
   * `preUpdate` mutates the pending write on the client already making it, so
   * it needs no GM guard — and the hook sweep in combat-turns.test.mjs
   * deliberately exempts `pre*` for exactly this reason. Asserted so that
   * exemption stays earned.
   */
  test("it is a preUpdate, so it rides along instead of chasing with a second write", () => {
    assert.match(entry, /Hooks\.on\("preUpdateActor"/);
    assert.doesNotMatch(body, /actor\.update\(/,
      "a second write here would race the GM's own and need a client guard");
  });
});
