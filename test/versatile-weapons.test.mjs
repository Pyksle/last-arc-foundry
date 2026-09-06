/**
 * Issue #92: a battle axe that says it may be held in one hand or two.
 *
 * Reported as "battle axe needed to have its size changed to qualify as 2H
 * despite the box being checked". Both halves of that are worth keeping:
 *
 *   - the box that WAS checked is `tradeCountsAsTwoHanded`, which doubles a
 *     declared trade and nothing else. It is the right field for a gauntlet
 *     and the wrong one for an axe, and it was the only thing on the sheet
 *     that mentioned two hands, so reaching for it was reasonable;
 *   - the workaround that DID work — declaring the axe a size larger — is
 *     worse than the bug. Size is relative to the wielder, so it makes the axe
 *     two-handed for everyone and unusable by anyone smaller.
 *
 * A dozen weapons in the errata carry this. The choice is a GRIP, not a skill
 * preference, and the tests below exist mostly to pin that distinction: the
 * light-weapon choice next door resolves to whichever skill is higher because
 * neither answer has a rider, and this one must not, because two hands double
 * Strength on damage and double a Mighty Strikes trade.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as D from "../module/derivation.mjs";
import { LASTARC } from "../module/config.mjs";
import { weaponAttackProfile } from "../module/dice/attack.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const sk = (map) => Object.fromEntries(
  Object.entries(map).map(([k, total]) => [k, { total }])
);

/** Medium wielder, medium axe, Str +4 — the reported character's shape. */
const axe = (over = {}) => weaponAttackProfile({
  actorSize: "medium",
  weaponSize: "medium",
  category: "axes",
  strMod: 4,
  skills: sk({ oneHanded: 6, twoHanded: 6, lightWeapon: 3 }),
  ...over
});

describe("§ #92: where the choice exists", () => {
  test("only at the wielder's own size", () => {
    assert.equal(D.versatileAllowsChoice("medium", "medium", true), true);
    assert.equal(D.versatileAllowsChoice("medium", "large", true), false,
      "already two-handed by size — nothing to choose");
    assert.equal(D.versatileAllowsChoice("medium", "small", true), false,
      "already a light-weapon choice — a different rule");
  });

  test("and only when the weapon says so", () => {
    assert.equal(D.versatileAllowsChoice("medium", "medium", false), false);
  });

  test("an unknown size is not a choice", () => {
    // `wieldCategory` throws on these; this one is asked speculatively by the
    // item sheet for a weapon with no actor, so it must answer rather than throw.
    assert.equal(D.versatileAllowsChoice("enormous", "medium", true), false);
    assert.equal(D.versatileAllowsChoice("medium", "enormous", true), false);
  });
});

describe("§ #92: the grip is stated, never inferred", () => {
  test("a versatile weapon is one-handed until the wielder says otherwise", () => {
    assert.equal(
      D.wieldCategory("medium", "medium", "axes", { versatile: true }),
      "oneHanded",
      "ticking versatile must not silently double everyone's Strength"
    );
  });

  test("stating the grip makes it two-handed", () => {
    assert.equal(
      D.wieldCategory("medium", "medium", "axes", { versatile: true, grip: "twoHanded" }),
      "twoHanded"
    );
  });

  test("a grip on a weapon that is not versatile is ignored", () => {
    // The same mis-fire guard the light-weapon preference has: a preference
    // left on a weapon, or copied between characters, must not route an attack
    // through a grip the rule does not allow.
    assert.equal(
      D.wieldCategory("medium", "medium", "axes", { grip: "twoHanded" }),
      "oneHanded"
    );
  });

  test("a grip cannot make a large weapon one-handed", () => {
    assert.equal(
      D.wieldCategory("medium", "large", "axes", { versatile: true, grip: "oneHanded" }),
      "twoHanded",
      "versatility adds an option, it does not remove the size table's answer"
    );
  });

  test("ranged and unarmed categories are untouched", () => {
    assert.equal(
      D.wieldCategory("medium", "medium", "bows", { versatile: true, grip: "twoHanded" }),
      "ranged");
    assert.equal(
      D.wieldCategory("medium", "medium", "knuckles", { versatile: true, grip: "twoHanded" }),
      "unarmed");
  });
});

describe("§ #92: the grip reaches the damage, not just the skill", () => {
  /**
   * The half-fix this guards against: resolving the choice at `attackSkillKey`
   * would route the attack through the Two-Handed skill and leave
   * `buildDamageTerms` reading `oneHanded`, paying the axe its two-handed
   * attack bonus and its one-handed damage. That looks right on the sheet.
   */
  test("one-handed adds Strength once", () => {
    const p = axe({ versatile: true });
    assert.equal(p.wield, "oneHanded");
    assert.equal(p.skillKey, "oneHanded");
    assert.equal(p.damage.flat, 4, "Str +4 once");
  });

  test("two-handed adds it twice", () => {
    const p = axe({ versatile: true, wieldSkill: "twoHanded" });
    assert.equal(p.wield, "twoHanded");
    assert.equal(p.skillKey, "twoHanded", "and rolls the Two-Handed skill");
    assert.equal(p.damage.flat, 8, "Str +4 doubled — the whole point of the grip");
  });

  test("the size workaround still behaves as it did", () => {
    // The GM's existing battle axe is a size larger. Nothing here may change
    // under it — worlds are live and the fix must not re-stat their weapons.
    const p = axe({ weaponSize: "large" });
    assert.equal(p.wield, "twoHanded");
    assert.equal(p.damage.flat, 8);
  });
});

describe("§ #92: the reported symptom — a trade doubled by the grip", () => {
  /**
   * Mighty Strikes doubles per point when the attack resolved two-handed. This
   * is what the GM was actually chasing, and it is why the grip had to land in
   * the wield category rather than beside it.
   */
  // The shipped spec, not a copy of it — a hand-written literal here would go
  // on passing after the config stopped agreeing with it.
  const spec = LASTARC.declaredTrades.mightyStrikes;
  const paid = (profile) => D.tradeDamageBonus(2, {
    twoHanded: profile.wield === "twoHanded", level: 5, spec
  });

  test("one-handed pays the single rate", () => {
    assert.equal(paid(axe({ versatile: true })), 2);
  });

  test("the versatile two-handed grip pays double", () => {
    assert.equal(paid(axe({ versatile: true, wieldSkill: "twoHanded" })), 4);
  });

  test("an unticked weapon with a stale grip pays the single rate", () => {
    assert.equal(paid(axe({ wieldSkill: "twoHanded" })), 2);
  });
});

describe("§ #92: the control is reachable", () => {
  const model = read("module/data/items.mjs");
  const template = read("templates/item/item-sheet.hbs");
  const sheet = read("module/sheets/item-sheet.mjs");
  const lang = JSON.parse(read("lang/en.json"));

  test("the weapon declares it", () => {
    assert.match(model, /versatile: new fields\.BooleanField/);
  });

  test("the template has a box for it", () => {
    assert.match(template, /name="system\.versatile"/);
  });

  test("the grip is offered in the picker", () => {
    // Widening the schema's `choices` without widening the select would leave
    // the grip unauthorable — the exact shape of issue #32.
    assert.match(model, /choices: \["", "lightWeapon", "oneHanded", "twoHanded"\]/);
    const options = sheet.slice(sheet.indexOf("context.wieldSkillOptions"));
    assert.match(options.slice(0, options.indexOf("];")), /value: "twoHanded"/);
  });

  test("the sheet passes the grip to the readout", () => {
    // Otherwise the derived line says "1-Handed, ×1 Str" under a weapon the
    // dice will swing in both hands.
    const call = sheet.slice(sheet.indexOf("context.wieldCategory ="));
    assert.match(call.slice(0, 220), /versatile: sys\.versatile, grip: sys\.wieldSkill/);
  });

  test("the profile passes it to the wield category", () => {
    const attack = read("module/dice/attack.mjs");
    assert.match(attack, /wieldCategory\(actorSize, weaponSize, category, \{\s*versatile, grip: wieldSkill/);
    assert.match(attack, /versatile: !!weapon\.system\.versatile/);
  });

  test("its label and tooltip exist", () => {
    for (const key of ["LASTARC.Field.Versatile", "LASTARC.Tooltip.Versatile",
      "LASTARC.Derived.VersatileChoice"]) {
      assert.ok(lang[key], `${key} is missing`);
    }
  });
});
