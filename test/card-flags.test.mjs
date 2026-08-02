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

const chat = read("module/chat.mjs");
const attack = read("module/dice/attack.mjs");

/**
 * Every module that builds a chat card and stamps flags onto it.
 *
 * This used to be `attack.mjs` alone, and the performance card's flags were
 * therefore reported as unwritten the moment they were added (issue #20). The
 * escape hatch below existed for exactly that case — a prose note saying "some
 * other card writes this" — and a prose note is not a check. Reading every
 * writer means the guard verifies the claim instead of accepting it.
 */
const WRITERS = [
  "module/dice/attack.mjs",
  "module/dice/magic.mjs",
  "module/dice/block.mjs",
  "module/dice/healing.mjs",
  "module/dice/share-item.mjs"
];

/**
 * Keys written into any `"last-arc": { … }` flag block.
 *
 * Brace-counted rather than matched by indentation: the blocks sit at different
 * depths in different files, and a fixed `\n\s{6}\}` silently found nothing in
 * the ones that did not happen to match.
 */
function writtenFlags() {
  const out = new Set();

  for (const file of WRITERS) {
    const src = read(file);
    let i = -1;
    while ((i = src.indexOf('"last-arc":', i + 1)) !== -1) {
      const open = src.indexOf("{", i);
      if (open === -1) continue;

      let depth = 0;
      let end = open;
      for (; end < src.length; end++) {
        if (src[end] === "{") depth++;
        else if (src[end] === "}" && --depth === 0) break;
      }

      const block = src.slice(open + 1, end);
      // Top-level keys only — a nested object's keys are not flags themselves.
      let d = 0;
      for (const line of block.split("\n")) {
        const m = d === 0 && line.match(/^\s*([A-Za-z][\w]*)\s*[,:]/);
        if (m) out.add(m[1]);
        d += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      }
    }
  }

  return out;
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
      rerolled: "stamped onto a message by a technick-granted reroll (#48) — a " +
        "separate marker from heroRerolled because they are separate resources",
      skillKey: "written by the CHECK card in dice/rolls.mjs. Its absence on an " +
        "attack is load-bearing: a reroll grant scoped to one skill matches on " +
        "this, so an attack having none is what keeps it off attack cards",
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
