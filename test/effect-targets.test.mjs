/**
 * Active Effect targets that actually survive derivation (issue #20).
 *
 * THE INVARIANT. Foundry applies Active Effects BETWEEN `prepareBaseData` and
 * `prepareDerivedData`. Every path the second one assigns is overwritten in
 * memory before anyone reads it, so an effect pointing there does nothing —
 * silently, with the effect still listed on the sheet and its icon still on the
 * token. Forty paths in the character model are written after that point, and
 * they are the obvious ones: maximum HP, defence totals, damage reduction,
 * speed, Break Threshold.
 *
 * So the whitelist in `LASTARC.effectTargets` is a load-bearing claim about the
 * data model, and a claim can go stale. The first test below re-derives the
 * written set FROM THE SOURCE on every run and fails if any offered target has
 * become one of them.
 *
 * This is the same rule as CLAUDE.md's "never give a derived value an input",
 * seen from the other side: a derived value must never be offered as somewhere
 * to write.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LASTARC } from "../module/config.mjs";
import {
  effectTargets, supportedTargetPaths, scopeTargets, skillGroupTargets,
  unsupportedChanges, skillTarget, defenceTarget
} from "../module/effects.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

/**
 * Every property assigned at or after `prepareDerivedData`, as `a.b.c` suffixes.
 *
 * Read from source rather than by running the model, because the model needs
 * Foundry. Deliberately over-collects: the private helpers below
 * `prepareDerivedData` all run in the same phase, and a loop variable
 * (`skill.total = …`) is a write to `system.skills.<key>.total` even though the
 * literal path never appears.
 */
function writtenAfterEffects(file) {
  const src = read(file);
  const i = src.indexOf("prepareDerivedData()");
  assert.ok(i > -1, `${file}: no prepareDerivedData — this test has lost its target`);

  const body = src.slice(i)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const out = new Set();
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*(?:\.[\w$]+)+)\s*=(?!=)/g)) {
    const parts = m[1].split(".");
    // Drop the receiver (`this`, `skill`, `atk`) and keep the property tail,
    // which is what a target path ends with.
    out.add(parts.slice(1).join("."));
  }
  return out;
}

describe("§ issue #20: an effect target must survive prepareDerivedData", () => {
  const written = writtenAfterEffects("module/data/character.mjs");

  test("the extractor finds the writes it is meant to police", () => {
    // If this collapses to nothing, every assertion below passes vacuously —
    // which is how a guard stops guarding without anyone noticing.
    assert.ok(written.size >= 20, `only found ${written.size} writes`);
    for (const known of ["resources.hp.max", "defences.ref.value", "damageMods.dr"]) {
      assert.ok(written.has(known), `expected ${known} among the derived writes`);
    }
  });

  /**
   * The test this file exists for.
   */
  test("no offered target is overwritten by derivation", () => {
    const clashes = effectTargets()
      .map((t) => ({ ...t, tail: t.path.replace(/^system\./, "") }))
      .filter((t) => {
        // A skill target is `skills.<key>.misc`; derivation writes `skill.misc`
        // through a loop variable, so compare on the final property in the
        // context of its container as well as the full tail.
        const leaf = t.tail.split(".").slice(-1)[0];
        const container = t.tail.split(".").slice(-2).join(".");
        return written.has(t.tail) || written.has(container) || written.has(leaf);
      })
      .map((t) => `${t.path} — derivation assigns it, so an effect here is silently discarded`);

    assert.deepEqual(clashes, [], clashes.join("\n  "));
  });

  test("the obvious wrong targets are NOT offered", () => {
    const ok = supportedTargetPaths();
    for (const path of [
      "system.resources.hp.max", "system.resources.mp.max",
      "system.defences.ref.value", "system.defences.fort.value",
      "system.damageMods.dr", "system.movement.value",
      "system.breakGauge.threshold", "system.details.level"
    ]) {
      assert.ok(!ok.has(path),
        `${path} is offered as an effect target and derivation overwrites it`);
    }
  });

  test("the input slots ARE offered", () => {
    const ok = supportedTargetPaths();
    assert.ok(ok.has("system.skills.athletics.misc"));
    assert.ok(ok.has("system.defences.will.misc"));
    assert.ok(ok.has("system.attributes.str.value"));
    // One row per skill, defence and attribute, so nothing is quietly dropped.
    assert.equal(
      effectTargets().length,
      Object.keys(LASTARC.allSkills).length
        + LASTARC.opposableDefences.length
        + Object.keys(LASTARC.attributes).length
    );
  });

  test("every target carries a label key that exists", () => {
    const lang = JSON.parse(read("lang/en.json"));
    const missing = effectTargets()
      .filter((t) => !(t.label in lang))
      .map((t) => `${t.path} → ${t.label}`);
    assert.deepEqual(missing, [], `unlocalised effect targets:\n  ${missing.join("\n  ")}`);
  });
});

describe("§ issue #20: the book's scopes resolve onto real paths", () => {
  test("a defence scope hits the misc slot, not the total", () => {
    assert.deepEqual(scopeTargets("will").paths, ["system.defences.will.misc"]);
    assert.deepEqual(scopeTargets("allDefences").paths,
      LASTARC.opposableDefences.map(defenceTarget));
  });

  test("a named skill scope resolves", () => {
    assert.deepEqual(scopeTargets("spellcraft").paths, [skillTarget("spellcraft")]);
  });

  test("weapon skills expand to the five weapon skills", () => {
    const paths = scopeTargets("weaponSkills").paths;
    assert.equal(paths.length, 5, paths.join(", "));
    assert.ok(paths.includes(skillTarget("lightWeapon")));
  });

  /**
   * Chapter 9 defines this by exclusion, so it is resolved by the rule rather
   * than listed — a list would silently stop covering a skill added later.
   */
  test("general skills exclude weapon skills, Alchemy, Smithing and Spellcraft", () => {
    const paths = new Set(scopeTargets("generalSkills").paths);
    for (const excluded of ["alchemy", "smithing", "spellcraft", "oneHanded", "ranged"]) {
      assert.ok(!paths.has(skillTarget(excluded)), `${excluded} must not be a general skill`);
    }
    assert.ok(paths.has(skillTarget("perception")));
    assert.ok(paths.size > 10, `only ${paths.size} general skills`);
  });

  test("attacksAndSkills covers both halves", () => {
    const paths = new Set(scopeTargets("attacksAndSkills").paths);
    assert.ok(paths.has(skillTarget("oneHanded")), "weapon skills missing");
    assert.ok(paths.has(skillTarget("perception")), "general skills missing");
  });

  /**
   * The honest half. These two are conditional on something no field records,
   * and applying them flatly would be WRONG rather than incomplete — a Reflex
   * bonus that only counts against spells, written to `defences.ref.misc`,
   * would also apply against every sword swing.
   */
  test("the unmappable scopes return no paths AND a reason", () => {
    for (const scope of ["refVsSpells", "refVsAttacks", "melee", "ranged"]) {
      const { paths, reason } = scopeTargets(scope);
      assert.deepEqual(paths, [], `${scope} must not resolve to a flat effect`);
      assert.ok(reason, `${scope} must explain itself rather than vanish`);
      assert.ok(reason in JSON.parse(read("lang/en.json")), `${reason} is not localised`);
    }
  });

  test("every performance scope is either mappable or explained", () => {
    const all = [
      ...Object.keys(LASTARC.performanceBonusScopes),
      ...Object.keys(LASTARC.performanceDamageScopes),
      ...Object.keys(LASTARC.performancePenaltyScopes)
    ];
    const silent = all.filter((s) => {
      const { paths, reason } = scopeTargets(s);
      return paths.length === 0 && !reason;
    });
    assert.deepEqual(silent, [],
      "these scopes resolve to nothing and say nothing, so a performance " +
      `carrying one would drop it without trace:\n  ${silent.join("\n  ")}`);
  });

  test("an unknown scope is reported rather than silently ignored", () => {
    const { paths, reason } = scopeTargets("zzNotAScope");
    assert.deepEqual(paths, []);
    assert.ok(reason, "an unrecognised scope must surface, not vanish");
  });
});

describe("§ issue #20: unsupported targets are detected", () => {
  test("a derived path is flagged", () => {
    assert.deepEqual(
      unsupportedChanges([{ key: "system.resources.hp.max", value: 10 }]),
      ["system.resources.hp.max"]
    );
  });

  test("a typo is flagged too", () => {
    // Enumerating every wrong path is impossible, so anything off the
    // whitelist is reported — a misspelled slot is exactly as silent.
    assert.deepEqual(
      unsupportedChanges([{ key: "system.skills.athletics.misk", value: 2 }]),
      ["system.skills.athletics.misk"]
    );
  });

  test("a supported path is not flagged", () => {
    assert.deepEqual(unsupportedChanges([{ key: skillTarget("athletics"), value: 2 }]), []);
  });

  test("non-system paths are left alone", () => {
    // Flags and other namespaces belong to modules; second-guessing them here
    // would produce warnings nobody can act on.
    assert.deepEqual(unsupportedChanges([{ key: "flags.foo.bar", value: 1 }]), []);
    assert.deepEqual(unsupportedChanges([{ key: "name", value: "x" }]), []);
  });

  test("malformed changes do not throw", () => {
    assert.deepEqual(unsupportedChanges(), []);
    assert.deepEqual(unsupportedChanges([null, {}, { key: 5 }]), []);
  });

  test("an unknown skill group yields nothing rather than throwing", () => {
    assert.deepEqual(skillGroupTargets("zzNope"), []);
  });
});
