/**
 * Chat-card actions must be reachable, and refusals must be visible.
 *
 * CLAUDE.md enforces both directions for SHEET actions: a declared action with
 * no button fails, because a feature nobody can reach is the defect this
 * project keeps producing. Chat actions had no such check, and the gap is not
 * theoretical — I searched the templates for the hero-point reroll button,
 * found nothing, and told the GM twice that the feature had never been built.
 *
 * It had. `offerHeroReroll` injects it at render time in JavaScript, so it
 * appears in no template and a template grep cannot see it. The reverse check
 * that exists for sheets would have answered the question in one run.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => readFileSync(root(p), "utf8");

const chat = read("module/chat.mjs");

/** Every action the dispatcher claims to handle. */
const handled = [...chat.matchAll(/case\s+"(lastarc[A-Za-z]+)"/g)].map((m) => m[1]);

/** chat.mjs with the dispatch switch removed, so a case cannot vouch for itself. */
const chatWithoutSwitch = chat.replace(/case\s+"lastarc[A-Za-z]+":[^\n]*\n/g, "");

const templates = readdirSync(root("templates/chat"))
  .filter((f) => f.endsWith(".hbs"))
  .map((f) => read(`templates/chat/${f}`))
  .join("\n");

describe("§ every chat action has something that emits it", () => {
  test("the dispatcher was found at all", () => {
    // A rename that broke this scan would otherwise make the suite below pass
    // vacuously — the failure mode this project produces most reliably.
    assert.ok(handled.length >= 5, `only found ${handled.length} chat actions`);
  });

  for (const action of handled) {
    test(`${action} is emitted somewhere`, () => {
      const emitted = templates.includes(action) || chatWithoutSwitch.includes(action);
      assert.ok(emitted,
        `${action} is handled but no template or injector produces it — ` +
        "the handler, and everything it calls, is unreachable");
    });
  }
});

describe("§ a temporary refusal is shown, not hidden", () => {
  const fn = chat.slice(
    chat.indexOf("function offerHeroReroll"),
    chat.indexOf("function offerBlock")
  );

  test("the reroll button is always appended, not conditionally", () => {
    // The bug behind #46's "the reroll UI doesn't exist": Misfortune blocked
    // the spend, the button was therefore never created, and the rule enforced
    // itself by making its own affordance disappear. A player cannot tell that
    // apart from an unimplemented feature — and did not.
    assert.ok(!/if \(canReroll\)/.test(fn),
      "the reroll button is still gated on being allowed; it must render " +
      "disabled with its reason instead");
    assert.match(fn, /disabled = !check\.allowed/,
      "a blocked spend must render as a disabled button, not vanish");
  });

  test("a blocked button explains itself rather than describing itself", () => {
    assert.match(fn, /check\.allowed \? tipKey : check\.reason/,
      "a disabled button must carry the refusal reason as its tooltip");
  });

  test("having no hero points at all is still silent", () => {
    // The one case where hiding is right: it would otherwise put a dead button
    // on every card for the rest of the campaign.
    assert.match(fn, /HeroPoint\.None/,
      "no-points must still return early rather than showing a permanent " +
      "dead button");
  });
});
