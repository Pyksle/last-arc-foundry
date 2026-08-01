/**
 * A chat card must carry everything the buttons on it will read back.
 *
 * THE DEFECT THIS EXISTS FOR. A playtester reported that crossbows were adding
 * Strength to damage after v0.18.0 supposedly fixed exactly that. The rule was
 * right; the plumbing was not. `postAttackCard` never wrote `wield` or
 * `isMelee` into the message flags, and `onRollDamage` read them as
 * `flags.wield ?? "oneHanded"` and `flags.isMelee ?? true`.
 *
 * So EVERY damage roll launched from a chat card resolved as a one-handed melee
 * swing, whatever had actually been rolled:
 *
 *   - crossbows and staves added Strength, because the melee branch ran
 *   - bows added it too, by the wrong route, and looked correct by accident
 *   - two-handed weapons silently lost their doubled Strength
 *   - Weapon Finesse could never fire — eligibility tests the wield category,
 *     and it was always "oneHanded"
 *
 * The attack roll itself was correct throughout, which is why it presented as a
 * damage bug rather than a plumbing one, and why unit tests could not see it:
 * `buildDamageTerms` was given wrong inputs and did the right thing with them.
 *
 * Writing this guard immediately found two more of the same shape in the same
 * flag block — `attackOptions` and `comboDepth`, both read, neither written.
 *
 * `?? default` on a value read from a document is the tell. It cannot
 * distinguish "absent because this is an old card" from "absent because nobody
 * ever wrote it", and it turns the second into plausible arithmetic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const attack = read("module/dice/attack.mjs");
const chat = read("module/chat.mjs");

/** Keys written into the `"last-arc"` flag block of an attack card. */
function writtenFlags() {
  // `\n}` alone stops at the destructured parameter list's `}) {`, which puts a
  // brace in column zero. The function's real close is a brace ALONE on a line.
  const fn = attack.match(/async function postAttackCard\([\s\S]*?\n\}(?:\n|$)/)[0];
  const block = fn.match(/"last-arc":\s*\{([\s\S]*?)\n\s{6}\}/)[1];
  return new Set(
    [...block.matchAll(/^\s{8}([A-Za-z][\w]*)\s*[,:]/gm)].map((m) => m[1])
  );
}

/** Keys read back off a message's flags anywhere in the chat listener. */
function readFlags() {
  return new Set([...chat.matchAll(/\bflags\.([A-Za-z][\w]*)/g)].map((m) => m[1]));
}

describe("attack card flags round-trip", () => {
  test("the extractors see a real flag block", () => {
    const written = writtenFlags();
    assert.ok(written.size >= 8, `only found: ${[...written].join(", ")}`);
    assert.ok(written.has("outcome"), [...written].join(", "));
    assert.ok(readFlags().size >= 8);
  });

  test("every flag the chat listener reads is one the card writes", () => {
    const written = writtenFlags();

    /**
     * Flags belonging to OTHER card types, written where those cards are built.
     * Each needs a home, or it is the same bug with a different name.
     */
    const ELSEWHERE = {
      blocksMessageId: "written by the Block card in dice/block.mjs",
      heroRerolled: "stamped onto a message by the hero point reroll",
      type: "written by every card builder, not just attacks",
      actorId: "written by every card builder"
    };

    const missing = [...readFlags()]
      .filter((k) => !written.has(k) && !ELSEWHERE[k])
      .map((k) => `flags.${k} is read in chat.mjs and never written to an attack card`);

    assert.deepEqual(missing, [],
      "these reads will silently take their `??` default forever, which is not a " +
      "missing feature but wrong arithmetic that looks right:\n  " + missing.join("\n  "));
  });

  test("the attack that was rolled is the attack damage resolves", () => {
    // The two specific keys behind the crossbow report. Named explicitly so
    // that removing them fails loudly rather than shrinking the set above.
    const written = writtenFlags();
    assert.ok(written.has("wield"), "wield is not on the card; damage cannot know the grip");
    assert.ok(written.has("isMelee"), "isMelee is not on the card; damage cannot know if it was ranged");
  });

  test("a Combo can repeat the attack it came from", () => {
    const written = writtenFlags();
    assert.ok(written.has("attackOptions"),
      "a Combo would drop every modifier the original attack carried");
    assert.ok(written.has("comboDepth"),
      "every Combo would believe it was the first, so the chain cap never engages");
  });

  test("options are sanitised before they go into a flag", () => {
    // A target is an Actor document. Storing one yields something that is not
    // an Actor when it comes back, which fails later and far from here.
    assert.match(attack, /function sanitiseAttackOptions/);
    assert.match(attack, /attackOptions:\s*sanitiseAttackOptions\(options\)/);
  });

  test("an absent flag is reported rather than silently defaulted", () => {
    // Old cards genuinely lack these, so the fallback stays — but it must say
    // so. A silent default is what made this invisible for a whole day.
    const fn = chat.match(/async function onRollDamage\([\s\S]*?\n\}(?:\n|$)/)[0];
    assert.match(fn, /console\.warn/,
      "onRollDamage falls back without telling anyone the card was incomplete");
  });
});
