/**
 * Rerolls granted by technicks, talents and racial traits (#48).
 *
 * The GM: "there are certain talents, technicks, and racial traits that allow
 * for the rerolling of a roll. Would it be possible to add two checkboxes for
 * mechanical effects inside of the technicks?"
 *
 * Both semantics already existed in `resolveReroll` and were read by nothing
 * but the hero point — so this is plumbing, and plumbing is precisely where
 * this project loses things. Every link in the chain is checked: the item can
 * store it, the sheet can tick it, the actor aggregates it, the card offers it,
 * and the handler spends it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { aggregateGrants, resolveReroll } from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const chat = read("module/chat.mjs");
const heroPoints = read("module/dice/hero-points.mjs");
const itemSheet = read("module/sheets/item-sheet.mjs");
const itemTemplate = read("templates/item/item-sheet.hbs");
const character = read("module/data/character.mjs");
const lang = JSON.parse(read("lang/en.json"));

describe("§48 which kinds a trait may grant", () => {
  test("the grantable kinds are a subset of the real ones", () => {
    for (const kind of LASTARC.grantableRerollKinds) {
      assert.ok(LASTARC.rerollKinds.includes(kind), `${kind} is not a reroll kind at all`);
    }
  });

  /**
   * `lower` is the MISFORTUNE penalty — reroll and keep the worse. An item
   * granting it would be handing a character a curse, so it is deliberately
   * not grantable even though it is a perfectly real reroll kind.
   */
  test("the penalty kind is not grantable", () => {
    assert.ok(!LASTARC.grantableRerollKinds.includes("lower"),
      "a trait can grant `lower`, which means an item can curse its owner");
    assert.equal(resolveReroll(18, 4, "lower"), 4, "...and it really is a penalty");
  });
});

describe("§48 a grant survives the trip from item to actor", () => {
  test("a ticked kind reaches the aggregate, an unticked one does not", () => {
    const g = aggregateGrants([
      { __source: "ZZ trait", reroll: { second: true, higher: false, usesPerRest: 2 } },
      { __source: "ZZ inert", reroll: { second: false, higher: false, usesPerRest: 3 } }
    ]);
    assert.equal(g.rerolls.length, 1, "an untouched trait must grant nothing");
    assert.deepEqual(g.rerolls[0], { kind: "second", usesPerRest: 2, source: "ZZ trait" });
  });

  test("one trait can grant both kinds", () => {
    const g = aggregateGrants([
      { __source: "ZZ both", reroll: { second: true, higher: true, usesPerRest: 1 } }
    ]);
    assert.deepEqual(g.rerolls.map((r) => r.kind), ["second", "higher"]);
  });

  /**
   * A LIST rather than a count. A player with two reroll traits needs to tell
   * them apart at the table — they may have different semantics — and
   * "Reroll ×2" says nothing about which is which.
   */
  test("each grant carries the name of the trait that gave it", () => {
    const g = aggregateGrants([
      { __source: "ZZ knack", reroll: { second: true, usesPerRest: 0 } },
      { __source: "ZZ boon", reroll: { higher: true, usesPerRest: 1 } }
    ]);
    assert.deepEqual(g.rerolls.map((r) => r.source), ["ZZ knack", "ZZ boon"]);
  });

  test("no grants means an empty list, not undefined", () => {
    assert.deepEqual(aggregateGrants([]).rerolls, []);
    assert.deepEqual(aggregateGrants([{ hp: 3 }]).rerolls, []);
  });

  test("the character model surfaces them for the card to read", () => {
    assert.match(character, /this\.rerollGrants = grants\.rerolls;/,
      "the aggregate never reaches `system`, so the chat card would have to " +
      "walk the item list itself — a second implementation waiting to disagree");
    assert.match(character, /__source: item\.name/,
      "grants are not tagged with their item, so no button can be named");
  });
});

describe("§48 every link of the chain is connected", () => {
  test("the item sheet builds a checkbox per grantable kind", () => {
    assert.match(itemSheet, /LASTARC\.grantableRerollKinds\.map\(/,
      "the checkboxes are hand-listed, so a kind can be grantable in the " +
      "schema and untickable on the sheet — issue #32, twice");
    assert.match(itemTemplate, /name="system\.grants\.reroll\.\{\{this\.key\}\}"/,
      "the generated checkboxes do not bind to the grants schema");
    assert.match(itemTemplate, /name="system\.grants\.reroll\.usesPerRest"/);
  });

  test("the card offers one button per grant", () => {
    assert.match(chat, /function offerGrantedRerolls\(/, "no offer is built at all");
    assert.match(chat, /offerGrantedRerolls\(message, element\);/,
      "the offer exists and the render hook never calls it");
    assert.match(chat, /actor\.system\?\.rerollGrants/,
      "the button does not read the actor's grants");
  });

  test("the action is dispatched to a handler", () => {
    assert.match(chat, /case "lastarcGrantedReroll": return await onGrantedReroll\(/,
      "the button is emitted and nothing handles the click");
  });

  test("the rebuilt card comes from the shared chain", () => {
    const fn = chat.slice(chat.indexOf("async function onGrantedReroll"));
    assert.match(fn.slice(0, 1600), /rebuildAfterReroll\(actor, flags, result\.keptRoll\)/,
      "a granted reroll must rebuild its card like a hero point does, or an " +
      "attack loses its damage button and a check loses its verdict");
  });

  test("no hero point is spent", () => {
    const fn = chat.slice(chat.indexOf("async function onGrantedReroll"),
      chat.indexOf("function offerBlock"));
    assert.ok(!/heroPointReroll|canSpendHeroPoint|HERO_SPEND/.test(fn),
      "a granted reroll must not touch hero points — being free is the point");
  });
});

describe("§48 the reroll maths is shared, not reimplemented", () => {
  test("the free reroll keeps the die resolveReroll chose", () => {
    // Under "keep the better" the winner is frequently the ORIGINAL. Returning
    // the new roll regardless prints a total the dice never produced — every
    // time the reroll fails to improve, which is most of them.
    assert.match(heroPoints, /export async function rerollWithoutCost\(/);
    const fn = heroPoints.slice(heroPoints.indexOf("export async function rerollWithoutCost"));
    assert.match(fn.slice(0, 900), /kept === rerolled \? reroll : originalRoll/,
      "the kept roll does not follow resolveReroll's choice");
    assert.match(fn.slice(0, 900), /new Roll\("1d20 \+ @mod", \{ mod \}\)/,
      "the free reroll is a naked d20, so its total is a bare die face");
  });

  test("it applies the kind it was given", () => {
    assert.equal(resolveReroll(18, 4, "second"), 4, "second: the new die stands");
    assert.equal(resolveReroll(18, 4, "higher"), 18, "higher: the original wins");
    assert.equal(resolveReroll(4, 18, "higher"), 18);
  });
});

describe("§48 one d20 gets one second chance", () => {
  test("either kind of reroll closes the roll to the other", () => {
    // The flags are separate because the resources are, but the GATE is
    // shared: having only the hero point respect it let a granted reroll be
    // followed by a bought one on the same die.
    const hero = chat.slice(chat.indexOf("function offerHeroReroll"),
      chat.indexOf("function offerGrantedRerolls"));
    const granted = chat.slice(chat.indexOf("function offerGrantedRerolls"),
      chat.indexOf("async function onGrantedReroll"));

    assert.match(hero, /flags\.heroRerolled \|\| flags\.rerolled/,
      "a granted reroll does not stop a hero point being spent afterwards");
    assert.match(granted, /flags\.rerolled \|\| flags\.heroRerolled/,
      "a hero point reroll does not stop a granted one being used afterwards");
  });

  test("using one stamps the message", () => {
    assert.match(chat, /setFlag\("last-arc", "rerolled", true\)/,
      "nothing marks the roll as rerolled, so the button never goes away");
  });
});

describe("§48 strings exist for everything the buttons say", () => {
  test("each grantable kind has a label and a tooltip", () => {
    for (const kind of LASTARC.grantableRerollKinds) {
      assert.ok(lang[`LASTARC.RerollKind.${kind}`], `no label for ${kind}`);
      assert.ok(lang[`LASTARC.Tooltip.RerollKind.${kind}`], `no tooltip for ${kind}`);
    }
  });

  test("the offer and its result have strings", () => {
    for (const key of ["LASTARC.Reroll.Offer", "LASTARC.Reroll.OfferTooltip",
      "LASTARC.Reroll.Applied", "LASTARC.Field.GrantsReroll", "LASTARC.Field.RerollUses"]) {
      assert.ok(lang[key], `${key} is missing from lang/en.json`);
    }
  });

  test("the button names the trait rather than the mechanic", () => {
    // "Reroll — Grassrunner" is usable at a table; "Reroll (keep the better)"
    // twice over is not, when a character has two such traits.
    assert.match(lang["LASTARC.Reroll.Offer"], /\{source\}/,
      "the button does not name its source, so two grants look identical");
  });
});
