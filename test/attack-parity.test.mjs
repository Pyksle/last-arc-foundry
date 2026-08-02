/**
 * Both attackers get the same rules.
 *
 * `situationalModifiers` is shared: monsters take flanking, cover and a prone
 * target exactly as players do, and it was written that way deliberately so a
 * modifier added once could never apply to only half the combatants.
 *
 * The MODIFIERS were shared. The CALL SITES were not. `targetProne` and
 * `targetHelpless` were supplied by the NPC sheet and not by the character
 * sheet, so for as long as both sheets have existed:
 *
 *   - a monster attacking a prone player got +5 in melee
 *   - a player attacking a prone monster got nothing
 *   - a player attacking a HELPLESS monster got nothing, and `applyDamage`
 *     applies helpless automatically at 0 HP, so every attack against a downed
 *     creature was quietly 5 short
 *
 * Nothing could see it. `situationalModifiers` is correct and unit tested; the
 * defect was one caller not asking. Same family as issue #40 — one rule, two
 * call sites, one of them wired.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const attack = read("module/dice/attack.mjs");

/** The options object a sheet hands to its roll function. */
function attackOptions(file, fn) {
  const src = read(file);
  const i = src.indexOf(`await ${fn}(`);
  assert.ok(i > -1, `${file}: no call to ${fn} — this test has lost its target`);
  const block = src.slice(i, src.indexOf("\n    });", i));
  return new Set([...block.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]));
}

/**
 * Options derived from the TARGET rather than from the attacker or the moment.
 *
 * Read from `situationalModifiers`' own parameter list, so a new target-derived
 * modifier joins this check automatically instead of needing to be remembered.
 */
function targetDerivedParams() {
  const params = attack.match(/export function situationalModifiers\(\{([\s\S]*?)\}\s*=\s*\{\}\)/)[1];
  return [...params.matchAll(/^\s*(target\w+)\s*=/gm)].map((m) => m[1]);
}

describe("§ a player and a monster attack under the same rules", () => {
  test("there are target-derived modifiers to check", () => {
    const params = targetDerivedParams();
    assert.ok(params.length >= 2, `only found: ${params.join(", ")}`);
    assert.ok(params.includes("targetProne"), params.join(", "));
    assert.ok(params.includes("targetHelpless"), params.join(", "));
  });

  test("both sheets supply every target-derived modifier", () => {
    const character = attackOptions("module/sheets/character-sheet.mjs", "rollAttack");
    const npc = attackOptions("module/sheets/npc-sheet.mjs", "rollNpcAttack");

    const missing = [];
    for (const param of targetDerivedParams()) {
      if (!character.has(param)) missing.push(`character-sheet does not pass ${param}`);
      if (!npc.has(param)) missing.push(`npc-sheet does not pass ${param}`);
    }

    assert.deepEqual(missing, [],
      "a modifier every combatant should take is being asked for by only one " +
      "of them:\n  " + missing.join("\n  "));
  });

  test("both sheets resolve the target's defence the same way", () => {
    for (const [file, fn] of [
      ["module/sheets/character-sheet.mjs", "rollAttack"],
      ["module/sheets/npc-sheet.mjs", "rollNpcAttack"]
    ]) {
      assert.ok(attackOptions(file, fn).has("targetDefence"), `${file}: no targetDefence`);
      assert.ok(attackOptions(file, fn).has("target"),
        `${file}: no target, so the card cannot offer a Block`);
    }
  });

  /**
   * The modifiers themselves, pinned. If the values move, the guard above would
   * still pass while both sheets agreed on the wrong number.
   */
  test("the shared modifiers are the ones the book states", async () => {
    const { situationalModifiers } = await import("../module/dice/attack.mjs");
    const val = (opts) => situationalModifiers(opts).reduce((s, p) => s + p.value, 0);

    assert.equal(val({ targetProne: true, isMelee: true }), 5, "prone in melee");
    assert.equal(val({ targetProne: true, isMelee: false }), -5, "prone at range");
    assert.equal(val({ targetHelpless: true }), 5, "helpless");
  });
});
