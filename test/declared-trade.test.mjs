/**
 * Declared trades — "take up to a −N penalty for an equal bonus" (#79).
 *
 * A FAMILY: four talents in the book share the wording, the duration and the
 * level scaling, differing only in what the penalty buys. Only the melee
 * attack → melee damage one is implemented, and the arithmetic lives here so
 * the other three inherit it rather than each arriving with a copy.
 *
 * Two things make this more than an addition. The bonus is DOUBLED for a
 * two-handed grip, which the system already knows without being told — the
 * wield category is derived from actor and weapon size and has been stamped on
 * every attack card since damage needed it. And the penalty must stay
 * distinguishable from a situational one: a card that recorded only a total
 * could not tell a declared trade from standing in the dark, and would pay out
 * bonus damage for the darkness.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  declaredTradeCap, tradeDamageBonus, declaredTradeFor
} from "../module/derivation.mjs";
import { attackModifiers, weaponAttackProfile } from "../module/dice/attack.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

describe("§ the cap rises with level", () => {
  test("one point at first level", () => {
    assert.equal(declaredTradeCap(1), 1);
    assert.equal(declaredTradeCap(3), 1);
  });

  /** "At 4th level, and every 4 levels thereafter, the limit increases by 1." */
  test("a point at 4th and every fourth level after", () => {
    assert.equal(declaredTradeCap(4), 2);
    assert.equal(declaredTradeCap(7), 2);
    assert.equal(declaredTradeCap(8), 3);
    assert.equal(declaredTradeCap(12), 4);
    assert.equal(declaredTradeCap(16), 5);
  });

  test("and stops at five", () => {
    assert.equal(declaredTradeCap(20), LASTARC.declaredTradeMax);
    assert.equal(declaredTradeCap(99), LASTARC.declaredTradeMax);
  });

  /** A level of 0 or nonsense is a character sheet mid-edit, not a rule. */
  test("a missing level still allows the first point", () => {
    assert.equal(declaredTradeCap(0), 1);
    assert.equal(declaredTradeCap(), 1);
    assert.equal(declaredTradeCap(-5), 1);
  });
});

describe("§ what the trade buys", () => {
  const melee = LASTARC.declaredTrades.mightyStrikes;

  test("one for one in one hand", () => {
    assert.equal(tradeDamageBonus(3, { spec: melee, twoHanded: false, level: 12 }), 3);
  });

  test("two for one in two", () => {
    assert.equal(tradeDamageBonus(3, { spec: melee, twoHanded: true, level: 12 }), 6);
  });

  /**
   * Clamped where it is SPENT, not merely where it is entered. The dialog's
   * `max` is a courtesy; a stale card, an edited flag or a level lost to a
   * rebuild must not pay out more than the character is entitled to.
   */
  test("more than the level allows is clamped, not honoured", () => {
    assert.equal(tradeDamageBonus(5, { spec: melee, twoHanded: false, level: 1 }), 1);
    assert.equal(tradeDamageBonus(5, { spec: melee, twoHanded: true, level: 1 }), 2,
      "the doubling applied to an unclamped number");
  });

  test("a negative or fractional declaration buys nothing", () => {
    assert.equal(tradeDamageBonus(-3, { spec: melee, level: 20 }), 0);
    assert.equal(tradeDamageBonus(0, { spec: melee, level: 20 }), 0);
    assert.equal(tradeDamageBonus(2.9, { spec: melee, level: 20 }), 2);
  });

  test("no trade is no bonus, in either grip", () => {
    assert.equal(tradeDamageBonus(0, { spec: melee, twoHanded: true, level: 20 }), 0);
    assert.equal(tradeDamageBonus(), 0);
  });
});

describe("§ the attack pays for it", () => {
  const base = { skillMod: 8, weaponAtkBonus: 0, proficient: true };

  test("the penalty lands on the attack roll", () => {
    const none = attackModifiers({ ...base, trade: 0 });
    const three = attackModifiers({ ...base, trade: 3 });
    assert.equal(none.total - three.total, 3, "the trade cost the attack nothing");
  });

  /**
   * ITS OWN PART. The damage roll has to tell a declared trade from a penalty
   * for cover or darkness — folded into the situational total, standing in the
   * dark would buy bonus damage.
   */
  test("it is an itemised part of its own, not folded into the situational", () => {
    const mods = attackModifiers({ ...base, trade: 2, situational: -4 });
    const labels = mods.parts.map((p) => p.label);
    assert.ok(labels.includes("LASTARC.Mod.declaredTrade"),
      "the trade has no line of its own on the card");
    const trade = mods.parts.find((p) => p.label === "LASTARC.Mod.declaredTrade");
    assert.equal(trade.value, -2, "the trade's own line does not carry its own value");
  });

  test("no trade adds no line", () => {
    const labels = attackModifiers({ ...base, trade: 0 }).parts.map((p) => p.label);
    assert.ok(!labels.includes("LASTARC.Mod.declaredTrade"));
  });

  test("it reaches the attack through the profile", () => {
    const profile = (trade) => weaponAttackProfile({
      actorSize: "medium", level: 8, strMod: 2, agiMod: 1,
      skills: { oneHanded: { total: 7 } }, category: "swords",
      weaponSize: "medium", proficientCategories: ["swords"], trade
    });
    assert.equal(profile(0).attack.total - profile(2).attack.total, 2);
  });
});

describe("§ the other two trades", () => {
  const { planOfAttack, amplification } = LASTARC.declaredTrades;

  /** Ranged buys damage one for one, and never doubles. */
  test("a ranged trade pays one for one, whatever the grip", () => {
    assert.equal(tradeDamageBonus(3, { spec: planOfAttack, level: 12 }), 3);
    assert.equal(tradeDamageBonus(3, { spec: planOfAttack, level: 12, twoHanded: true }), 3,
      "a bow doubled the trade because the wield category said two-handed");
  });

  test("…and still respects the level cap", () => {
    assert.equal(tradeDamageBonus(5, { spec: planOfAttack, level: 1 }), 1);
    assert.equal(declaredTradeCap(1, planOfAttack.cap), 1);
    assert.equal(declaredTradeCap(16, planOfAttack.cap), 5);
  });

  /**
   * The spell trade is the odd one: twice the rate, and a ceiling of 5 at every
   * level. A first-level caster may spend all five.
   */
  test("the spell trade doubles and does not scale", () => {
    assert.equal(tradeDamageBonus(5, { spec: amplification, level: 1 }), 10,
      "a level-1 caster was capped as though the limit scaled");
    assert.equal(tradeDamageBonus(3, { spec: amplification, level: 20 }), 6);
    assert.equal(declaredTradeCap(1, amplification.cap), 5);
    assert.equal(declaredTradeCap(20, amplification.cap), 5);
  });

  test("more than five is still five, at any level", () => {
    assert.equal(tradeDamageBonus(9, { spec: amplification, level: 20 }), 10);
  });

  /** Two-handed doubling is a melee rule and must not leak. */
  test("the spell trade ignores the grip entirely", () => {
    assert.equal(tradeDamageBonus(2, { spec: amplification, twoHanded: true, level: 1 }), 4);
    assert.equal(tradeDamageBonus(2, { spec: amplification, twoHanded: false, level: 1 }), 4);
  });

  /**
   * This used to fall back to the melee trade "so existing callers keep their
   * meaning", and that default was a bug as soon as a second trade existed: a
   * character holding only the melee talent, shooting a bow, looked up the
   * ranged trade, got nothing, and was paid at the melee rate anyway.
   */
  test("no trade means no bonus, never a default one", () => {
    assert.equal(tradeDamageBonus(3, { level: 12 }), 0);
    assert.equal(tradeDamageBonus(3, { spec: null, level: 12, twoHanded: true }), 0);
  });
});

describe("§ the trade is chosen by the roll, not by the talent", () => {
  const has = (...flags) => (f) => flags.includes(f);

  test("a melee attack finds the melee trade and nothing else", () => {
    assert.equal(declaredTradeFor("melee", has("mightyStrikes"))?.key, "mightyStrikes");
    assert.equal(declaredTradeFor("ranged", has("mightyStrikes")), null,
      "a melee trade was offered on a ranged attack");
    assert.equal(declaredTradeFor("spell", has("mightyStrikes")), null);
  });

  test("a ranged attack finds the ranged one", () => {
    assert.equal(declaredTradeFor("ranged", has("planOfAttack"))?.key, "planOfAttack");
    assert.equal(declaredTradeFor("melee", has("planOfAttack")), null);
  });

  test("a spell finds the spell one", () => {
    assert.equal(declaredTradeFor("spell", has("amplification"))?.key, "amplification");
    assert.equal(declaredTradeFor("melee", has("amplification")), null);
  });

  test("a character with none of them is offered nothing", () => {
    for (const kind of ["melee", "ranged", "spell"]) {
      assert.equal(declaredTradeFor(kind, has()), null);
      assert.equal(declaredTradeFor(kind), null, "a missing predicate offered a trade");
    }
  });

  test("a character with all three gets the right one each time", () => {
    const all = has("mightyStrikes", "planOfAttack", "amplification");
    assert.equal(declaredTradeFor("melee", all).key, "mightyStrikes");
    assert.equal(declaredTradeFor("ranged", all).key, "planOfAttack");
    assert.equal(declaredTradeFor("spell", all).key, "amplification");
  });

  test("the spec carries its own rate and ceiling", () => {
    const t = declaredTradeFor("spell", has("amplification"));
    assert.equal(tradeDamageBonus(4, { spec: t, level: 1 }), 8);
  });
});

describe("§ the two-handed doubling reads what the system already knew", () => {
  /**
   * No new field records whether a weapon is two-handed. `wieldCategory` has
   * derived it from actor and weapon size since before this existed, and the
   * attack card has stamped it since damage could not resolve without it.
   */
  test("a larger weapon resolves as two-handed for a medium wielder", () => {
    const p = weaponAttackProfile({
      actorSize: "medium", weaponSize: "large", category: "swords",
      skills: { twoHanded: { total: 7 } }, proficientCategories: ["swords"]
    });
    assert.equal(p.wield, "twoHanded",
      "the doubling has nothing to read, so a new field would be needed after all");
  });

  test("…and the same weapon is one-handed for something larger", () => {
    const p = weaponAttackProfile({
      actorSize: "large", weaponSize: "large", category: "swords",
      skills: { oneHanded: { total: 7 } }, proficientCategories: ["swords"]
    });
    assert.equal(p.wield, "oneHanded",
      "a greatsword in a giant's hand must not double the trade");
  });

  test("the damage side doubles on the resolved wield, not the weapon's size", () => {
    assert.equal(tradeDamageBonus(2, { spec: LASTARC.declaredTrades.mightyStrikes, twoHanded: true, level: 20 }), 4);
    assert.equal(tradeDamageBonus(2, { spec: LASTARC.declaredTrades.mightyStrikes, twoHanded: false, level: 20 }), 2);
  });
});

describe("§ the wiring the maths cannot hold", () => {
  const attack = read("module/dice/attack.mjs");
  const chat = read("module/chat.mjs");

  test("the card records the trade so damage can pay it", () => {
    const start = attack.indexOf('type: "attack"');
    const flags = attack.slice(start, attack.indexOf("\n      }", start));
    assert.match(flags, /\n\s*trade,\n/,
      "the attack charges for a trade the damage roll can never find");
  });

  /**
   * The damage card renders `terms.parts`. A bonus that reached only the total
   * would print a sum whose own working does not add up to it — and the card
   * shows its arithmetic precisely so the table can check it.
   */
  test("the bonus is itemised, not only totalled", () => {
    const fn = attack.slice(attack.indexOf("export async function rollDamage"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /parts: \[\s*\.\.\.profile\.damage\.parts,/,
      "the trade is added to the total and not to the breakdown, so the card " +
      "prints a sum that does not add up");
    assert.match(body, /label: "LASTARC\.Mod\.declaredTrade", value: tradeBonus/);
    assert.match(body, /flat: profile\.damage\.flat \+ tradeBonus/,
      "the itemised copy and the total disagree");
  });

  test("the damage button reads it back off the card", () => {
    assert.match(chat, /trade: flags\.trade \?\? 0/,
      "the damage roll ignores what the attack already paid for");
  });

  /**
   * The doubling must consult the resolved wield OR a weapon that declares
   * itself two-handed for this purpose — the book has a gauntlet that doubles
   * an unarmed strike, and an unarmed strike is not two-handed.
   */
  test("the doubling reads the wield and the weapon's override", () => {
    const fn = attack.slice(attack.indexOf("export async function rollDamage"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /tradeDamageBonus\(/, "the trade is never spent on damage");
    assert.match(body, /wield === "twoHanded"/, "the grip is not consulted");
    assert.match(body, /tradeCountsAsTwoHanded/,
      "gear that doubles an unarmed strike cannot say so");
  });

  /** Clamped again at the roll, against the character's own level. */
  test("rollAttack clamps the declared number against the level", () => {
    const at = attack.indexOf("export async function rollAttack");
    const fn = attack.slice(at, attack.indexOf("\n}", at));
    assert.match(fn, /declaredTradeCap\(/,
      "a hand-edited dialog could declare any number it liked");
  });

  /**
   * The lookup is by the KIND of roll now, not by naming one talent — so a
   * melee trade is never offered on a bow and a new row in the table needs no
   * branch here.
   */
  test("the prompt offers the trade that matches the roll, if any", () => {
    const actions = read("module/item-actions.mjs");
    assert.match(actions, /const kind = isRanged \? "ranged" : "melee";/,
      "the attack prompt is not choosing a trade by the kind of attack");
    assert.match(actions, /declaredTradesFor\(kind,/,
      "the prompt must ask for ALL of this kind — a character can hold two");
    assert.match(actions, /declaredTradeFor\("spell"/,
      "a caster is never offered a trade");
    assert.match(actions, /hasTechnickFlag\(actor, flag\)/,
      "every character is offered a trade, which is a rule they do not have");
  });

  /** One row per talent, and the three differ in exactly four ways. */
  test("the table says how each trade differs", () => {
    const { mightyStrikes, planOfAttack, amplification } = LASTARC.declaredTrades;
    assert.equal(mightyStrikes.on, "melee");
    assert.equal(mightyStrikes.doubleTwoHanded, true);

    assert.equal(planOfAttack.on, "ranged");
    assert.ok(!planOfAttack.doubleTwoHanded,
      "a bow is drawn with two hands and the book gives it no doubling");

    assert.equal(amplification.on, "spell");
    assert.equal(amplification.cap, 5, "its ceiling does not scale with level");
    assert.equal(amplification.multiplier, 2, "it buys damage at twice the rate");
  });
});
