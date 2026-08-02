/**
 * The status palette and the token must agree (#47).
 *
 * The GM reported a Werewolf token wearing blind, severedArm and severedLeg
 * while the sheet's palette showed all three unlit — so they clicked to
 * "reapply" them, and the token ended up with more icons than before.
 *
 * Two separate faults produce exactly that, and the fix has to survive either
 * being the real one, because neither can be reproduced outside Foundry:
 *
 *   1. TWO DOCUMENTS. An unlinked token's actor is not the sidebar actor
 *      (CLAUDE.md §7), and NPCs are unlinked by default here. A monster opened
 *      from the Actors directory is the TEMPLATE; nothing on any token shows
 *      in its palette and toggling there reaches no creature on the board.
 *   2. ASYMMETRIC TOGGLING. `toggleStatusEffect` turns a status ON
 *      unconditionally but turns it OFF only by matching an effect whose
 *      status set is exactly `{id}`. Anything not of that shape survives,
 *      still draws a token icon, and can be applied again on top.
 *
 * (2) is what makes the pile grow, so that is what is fixed outright; (1) is
 * made visible rather than silently confusing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const palette = read("module/sheets/status-palette.mjs");
const template = read("templates/actor/status-palette.hbs");
const lang = JSON.parse(read("lang/en.json"));

describe("§47 turning a status off removes every copy", () => {
  test("the toggle deletes all effects carrying the id", () => {
    assert.match(palette, /filter\(\(e\) => e\.statuses\?\.has\?\.\(id\)\)/,
      "the palette still delegates removal to toggleStatusEffect, which only " +
      "matches an effect whose status set is exactly {id} — anything else " +
      "survives and keeps drawing an icon");
    assert.match(palette, /deleteEmbeddedDocuments\("ActiveEffect"/,
      "nothing is deleted, so duplicates already on a token can never be cleared");
  });

  test("turning one ON is still the standard Foundry path", () => {
    // A second mechanism for APPLYING a status would be a second thing to keep
    // in step with derivation, which is the whole reason this module exists.
    assert.match(palette, /toggleStatusEffect\(id, \{ active: true \}\)/,
      "applying must go through toggleStatusEffect, explicitly active");
  });

  test("removal is checked before application, or the pile only grows", () => {
    const fn = palette.slice(palette.indexOf("export async function toggleStatus"));
    assert.ok(fn.indexOf("deleteEmbeddedDocuments") < fn.indexOf("toggleStatusEffect(id"),
      "the apply path runs first, so a status that is already on gets a " +
      "second copy instead of being removed");
  });
});

describe("§47 the palette counts copies rather than collapsing them", () => {
  test("it reads the effects, not only the statuses Set", () => {
    // `Actor#statuses` is a Set: it can say "on" and cannot say "on twice",
    // and it is rebuilt from ACTIVE effects, so a suppressed one draws a token
    // icon while the palette believes the status is off.
    assert.match(palette, /for \(const effect of actor\?\.effects \?\? \[\]\)/,
      "counting from actor.statuses alone cannot see duplicates");
  });

  test("a single copy shows no badge", () => {
    assert.match(palette, /> 1 \? counts\.get\(id\) : null/,
      "a bare 1 on every active status would be noise across 33 buttons");
  });

  test("the template renders the count", () => {
    assert.match(template, /\{\{#if this\.count\}\}/,
      "the count is computed and never shown");
    assert.match(template, /la-status__dupes/);
  });
});

describe("§47 a template statblock says it is a template", () => {
  test("the flag is computed", () => {
    assert.match(palette, /context\.statusesAreTemplate/,
      "a sidebar NPC gives no hint that its palette cannot reflect any token");
  });

  test("it is only true for an unlinked base actor", () => {
    // A LINKED actor's sheet and token are one document, and a token's own
    // sheet is the creature itself. Warning on either would be wrong.
    assert.match(palette, /actor\?\.isToken === false/,
      "a token's own sheet must not be called a template");
    assert.match(palette, /prototypeToken\?\.actorLink === false/,
      "a linked actor shares one document with its token and needs no warning");
  });

  test("the template shows it and the string exists", () => {
    assert.match(template, /\{\{#if statusesAreTemplate\}\}/);
    assert.ok(lang["LASTARC.Note.StatusesTemplateOnly"]);
    assert.ok(lang["LASTARC.Note.StatusDuplicates"]);
  });

  test("the warning names the way out", () => {
    // "This is a template" without "open the token's sheet" leaves the GM
    // knowing they are stuck and not how to proceed.
    assert.match(lang["LASTARC.Note.StatusesTemplateOnly"], /token/i,
      "the warning must point at the token's own sheet");
  });
});
