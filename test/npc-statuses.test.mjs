/**
 * Statuses apply to monsters too.
 *
 * They did not. `aggregateStatuses` was wired into character derivation
 * (task 18) and never into the NPC model, so every DERIVED consequence was
 * inert on a statblock:
 *
 *   - Exhaustion's −10 to all three defences did nothing to a boss
 *   - Toad's −10 to defences, attacks and skills did nothing
 *   - Grabbed's −2 to attacks did nothing
 *   - Sleep, Petrify, Pinned and Helpless did not deny Agility
 *
 * The damning part is the affordance: the NPC sheet carries the whole status
 * palette, so a GM could click any of the thirty-three onto a monster, watch
 * the icon appear on its token, and get no arithmetic whatsoever.
 *
 * It survived because HALF the feature genuinely worked. `applyDamage` and
 * `rollHealing` read `target.statuses` directly rather than through a data
 * model, so bonus damage dice, resistance-stripping and healing inversion were
 * correct on monsters all along. Testing those and concluding "statuses work on
 * NPCs" is exactly the mistake available here.
 *
 * These are source-level assertions because the models need Foundry to
 * instantiate. They check that the NPC model CONSULTS the aggregate — the
 * arithmetic itself is covered by the derivation tests, which are shared.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LASTARC } from "../module/config.mjs";
import * as D from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const npc = read("module/data/npc.mjs");
const character = read("module/data/character.mjs");
const attack = read("module/dice/attack.mjs");

/** The body of a model's prepareDerivedData, comments stripped. */
function derived(src) {
  const i = src.indexOf("prepareDerivedData()");
  assert.ok(i > -1, "no prepareDerivedData");
  return src.slice(i).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("§ statuses reach a statblock, not just a character", () => {
  test("both models aggregate the actor's statuses", () => {
    for (const [name, src] of [["npc", npc], ["character", character]]) {
      assert.match(derived(src), /aggregateStatuses\(/,
        `${name}.mjs never reads its statuses, so every derived consequence of ` +
        "a status is inert on it");
    }
  });

  test("status defence penalties reach an NPC's defences", () => {
    const body = derived(npc);
    for (const key of LASTARC.opposableDefences) {
      // Reflex is the exception and deliberately so: it has three interacting
      // status rules (agiDenied, agiOverride, and the rider below) and is
      // computed whole by `printedReflex` so that every branch is reachable
      // from a test. An inline `if` here could be mutated to `if (false)` with
      // this scan none the wiser — that happened, see toad-defences.test.mjs.
      // What is checked instead is that the aggregate is handed to the helper.
      const pattern = key === "ref"
        ? /printedReflex\(\{[^}]*statusDefence:\s*statuses\.defences\.ref/
        : new RegExp(`defences\\.${key}\\.value\\s*=[^;]*statuses\\.defences\\.${key}`);

      assert.match(body, pattern,
        `an NPC's ${key} ignores status penalties — Exhaustion's −10 does nothing`);
    }
  });

  /**
   * A character picks this up through its derived skill total. A statblock's
   * attack bonus is PRINTED, so it has to be added at the roll or it is lost.
   */
  test("status attack penalties reach an NPC's attack roll", () => {
    assert.match(attack, /statusPenalty/,
      "npcAttackModifiers has no status penalty, so a grabbed monster attacks " +
      "at its full printed bonus");
    assert.match(attack, /statusPenalty:\s*sys\.statuses\?\.attackPenalty/,
      "the penalty is declared but rollNpcAttack never supplies it");
  });

  test("a status that denies Agility flat-foots the monster", () => {
    assert.match(derived(npc), /statuses\.agiDenied/,
      "a sleeping or petrified monster keeps its full Reflex");
  });

  test("noActions makes a monster incapacitated", () => {
    assert.match(derived(npc), /statuses\.noActions/,
      "a petrified or unconscious monster is not treated as incapacitated");
  });

  test("speed statuses reach an NPC's movement", () => {
    const body = derived(npc);
    assert.match(body, /statuses\.speedZero/, "a grabbed monster still moves");
    assert.match(body, /statuses\.speedMultiplier/, "a slowed monster moves at full speed");
  });

  /**
   * The payloads that CANNOT be applied to a statblock, recorded with the
   * reason so the omission is a decision rather than an oversight the next
   * person has to rediscover.
   *
   * `hp.max`, `mp.max`, `movement.fly` and `movement.hover` are AUTHORED inputs
   * on an NPC — the sheet has a box for each. Writing them in
   * `prepareDerivedData` would store the GM's number and show a different one
   * back, which is CLAUDE.md rule 4 and has shipped twice. On a character these
   * are derived, which is why the same statuses are safe there.
   *
   * `test/derived-binding.test.mjs` caught this the moment it was written, on
   * the person adding the feature.
   */
  test("the maxima and flight stay authored, and nothing writes them", () => {
    const body = derived(npc);
    assert.doesNotMatch(body, /resources\.hp\.max\s*=/,
      "hp.max has an input on the NPC sheet; derivation must not assign it");
    assert.doesNotMatch(body, /resources\.mp\.max\s*=/,
      "mp.max has an input on the NPC sheet; derivation must not assign it");
    assert.doesNotMatch(body, /movement\.fly\s*=/,
      "movement.fly has an input on the NPC sheet; derivation must not assign it");
    assert.doesNotMatch(body, /movement\.hover\s*=/,
      "movement.hover has an input on the NPC sheet; derivation must not assign it");
  });

  /**
   * The half that always worked, pinned so a future refactor cannot quietly
   * route it through a data model and break monsters.
   */
  test("damage and healing read statuses off the target directly", () => {
    assert.match(attack, /aggregateStatuses\(\[\.\.\.\(target\.statuses/,
      "applyDamage must read the target's statuses without going through a " +
      "data model, or it stops working on one of the two actor types");
    assert.match(read("module/dice/healing.mjs"), /target\.statuses/);
  });

  test("the statuses this fix covers really do carry those payloads", () => {
    // Guards the guard: if these payloads moved, the assertions above would
    // still pass while testing nothing anyone can feel.
    assert.equal(D.aggregateStatuses(["exhaustion"]).defences.fort, -10);
    assert.equal(D.aggregateStatuses(["grabbed"]).attackPenalty, -2);
    assert.equal(D.aggregateStatuses(["slowed"]).speedMultiplier, 0.5);
    assert.equal(D.aggregateStatuses(["sleep"]).agiDenied, true);
  });
});
