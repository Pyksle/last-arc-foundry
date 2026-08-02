/**
 * Misfortune rerolls and keeps the lower (§12).
 *
 * The status does two things and only one was implemented:
 *
 *   1. reroll all attacks and skill checks, keep the LOWER result
 *   2. cannot spend a hero point to reroll a d20
 *
 * (2) was honoured. (1) was not, anywhere — seven bare `new Roll("1d20 + @mod")`
 * call sites, none of which knew about it. Misfortune, one of Chapter 12's
 * harsher conditions, amounted to "no hero point rerolls".
 *
 * It HALF-worked, which is why it survived. A player under Misfortune who tried
 * to reroll got the correct refusal and reasonably concluded the status worked.
 * Half-working is the state that fools people.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keptRoll, rollsWithMisfortune } from "../module/dice/d20.mjs";
import { skillTotalOf } from "../module/derivation.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (d) => readdirSync(join(root, d), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);

describe("§12 Misfortune keeps the worse roll", () => {
  test("the lower natural is kept", () => {
    assert.equal(keptRoll(18, 4), "second");
    assert.equal(keptRoll(4, 18), "first");
    assert.equal(keptRoll(11, 11), "first", "a tie may keep either; the values are equal");
  });

  /**
   * The NATURAL, not the total. With an identical modifier they order the same,
   * but the natural is what auto-hit and auto-miss read — keeping the wrong one
   * would let a natural 20 survive a status whose purpose is to take it away.
   */
  test("a natural 20 does not survive Misfortune", () => {
    assert.equal(keptRoll(20, 3), "second");
  });

  test("it reads the flag off either actor model", () => {
    assert.equal(rollsWithMisfortune({ system: { statuses: { rerollKeepLower: true } } }), true);
    assert.equal(rollsWithMisfortune({ system: { statuses: {} } }), false);
    assert.equal(rollsWithMisfortune(undefined), false);
  });
});

describe("§ every d20 check goes through the shared roller", () => {
  /**
   * The guard that stops a seventh call site appearing. A bare `new Roll("1d20"`
   * anywhere outside the roller is a check Misfortune cannot reach.
   */
  const EXCUSED = {
    "module/dice/d20.mjs": "the roller itself",
    "module/dice/hero-points.mjs":
      "the hero point REROLL — a replacement die for an existing check, not a " +
      "new check. Misfortune blocks it outright via blocksD20Reroll rather " +
      "than doubling it."
  };

  test("no bare d20 roll outside the shared roller", () => {
    const stray = [];
    for (const file of walk("module").filter((f) => f.endsWith(".mjs") && !f.includes("quench"))) {
      if (EXCUSED[file]) continue;
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/new Roll\(\s*["'`]1d20/.test(src)) stray.push(file);
    }
    assert.deepEqual(stray, [],
      "these roll a d20 without going through rollCheckD20, so Misfortune " +
      "cannot reach them:\n  " + stray.join("\n  "));
  });

  test("the roller is actually used by the check pipelines", () => {
    for (const file of [
      "module/dice/rolls.mjs", "module/dice/attack.mjs",
      "module/dice/magic.mjs", "module/dice/block.mjs", "module/combat.mjs"
    ]) {
      assert.match(read(file), /rollCheckD20\(/, `${file} does not use the shared roller`);
    }
  });

  /**
   * An attribute check is deliberately exempt: the rule as recorded in config
   * says "attacks and skill checks". Excluded rather than assumed in, and
   * raised on #46 for the table to correct.
   */
  test("attribute checks are exempted explicitly, not by omission", () => {
    assert.match(read("module/dice/rolls.mjs"), /misfortuneApplies:\s*false/,
      "rollAttribute must state that it is exempt, so the exemption is a " +
      "decision rather than a call site somebody forgot");
  });
});

describe("§ one shape-aware skill lookup, shared", () => {
  test("it reads a character's keyed rows and a statblock's array", () => {
    assert.equal(skillTotalOf({ stealth: { total: 7 } }, "stealth"), 7);
    assert.equal(skillTotalOf([{ key: "stealth", value: 5 }], "stealth"), 5);
    assert.equal(skillTotalOf([{ key: "athletics", value: 5 }], "stealth"), 0);
    assert.equal(skillTotalOf(undefined, "stealth"), 0);
  });

  /**
   * The bug this closes: `rollSurprise` read `skills.stealth.total`, which a
   * statblock does not have, so every monster ambushed at +0 — while the
   * defenders' passive Perception ten lines below was shape-aware from the
   * start.
   */
  test("surprise Stealth uses it", () => {
    const fn = read("module/combat.mjs").match(/export async function rollSurprise[\s\S]*?\n\}/)[0];
    assert.match(fn, /skillTotalOf\(/,
      "rollSurprise reads a character-only skill path, so monsters ambush at +0");
    assert.doesNotMatch(fn, /skills\?\.stealth\?\.total/);
  });

  test("block.mjs uses the shared one rather than its own copy", () => {
    const src = read("module/dice/block.mjs");
    assert.match(src, /skillTotalOf\(/);
    assert.doesNotMatch(src, /Array\.isArray\(skills\)/,
      "block.mjs still carries a private copy of the shape logic");
  });
});
