/**
 * Tactical Guard and Careful Shot — the two declared trades that buy Reflex.
 *
 * Deferred twice for want of duration-bound state, and built on the expiry
 * machinery that landed with Fight Defensively. What makes them different from
 * the three trades already here is that they do not finish with the roll: the
 * penalty AND the bonus last until the start of the declarer's next turn, so
 * the price is charged again on every attack made in between.
 *
 * The tests that matter most are the ones about NOT paying twice. A trade that
 * both applies a penalty to the roll declaring it and leaves a standing penalty
 * behind would charge that roll for the same choice at both ends, and the total
 * would look plausible — which is how it would ship.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as D from "../module/derivation.mjs";
import { LASTARC } from "../module/config.mjs";
import { attackModifiers } from "../module/dice/attack.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const guard = LASTARC.declaredTrades.tacticalGuard;
const shot = LASTARC.declaredTrades.carefulShot;
const strikes = LASTARC.declaredTrades.mightyStrikes;

describe("§ the two new rows say what they buy", () => {
  test("Tactical Guard is melee, Careful Shot is ranged", () => {
    assert.equal(guard.on, "melee");
    assert.equal(shot.on, "ranged");
  });

  test("both buy Reflex, and neither doubles two-handed", () => {
    assert.equal(guard.buys, "reflex");
    assert.equal(shot.buys, "reflex");
    // The doubling belongs to a damage trade. Two hands do not make a stance
    // twice as defensive, and the book attaches no such rider.
    assert.equal(guard.doubleTwoHanded, undefined);
    assert.equal(shot.doubleTwoHanded, undefined);
  });

  test("the ceiling is the book's: 1, rising every four levels, capped at 5", () => {
    assert.deepEqual(
      [1, 3, 4, 8, 12, 16, 20, 30].map((l) => D.declaredTradeCap(l, guard.cap)),
      [1, 1, 2, 3, 4, 5, 5, 5]
    );
  });
});

describe("§ the penalty and the bonus are the same number", () => {
  test("equal and opposite", () => {
    assert.deepEqual(
      D.reflexTradeStance(3, { level: 8, spec: guard }),
      { ref: 3, attackPenalty: -3 }
    );
  });

  test("clamped against the level, not trusted from the form", () => {
    assert.deepEqual(
      D.reflexTradeStance(5, { level: 1, spec: guard }),
      { ref: 1, attackPenalty: -1 }
    );
  });

  test("nothing declared buys nothing", () => {
    assert.deepEqual(D.reflexTradeStance(0, { level: 8, spec: guard }),
      { ref: 0, attackPenalty: 0 });
  });

  test("a damage trade does not go through this door", () => {
    // Mighty Strikes buys damage. Asking this function for its stance must
    // answer "none" rather than quietly handing out a Reflex bonus too.
    assert.deepEqual(D.reflexTradeStance(3, { level: 8, spec: strikes }),
      { ref: 0, attackPenalty: 0 });
  });
});

describe("§ a reflex trade pays no damage", () => {
  /**
   * The reported shape of this class of bug: `tradeDamageBonus` paid out for
   * ANY spec it was handed, so routing Tactical Guard through the same field
   * would have bought Reflex and damage with one penalty.
   */
  test("Tactical Guard adds nothing to the damage roll", () => {
    assert.equal(D.tradeDamageBonus(3, { twoHanded: true, level: 8, spec: guard }), 0);
  });

  test("Careful Shot adds nothing either", () => {
    assert.equal(D.tradeDamageBonus(3, { level: 8, spec: shot }), 0);
  });

  test("and Mighty Strikes still does", () => {
    assert.equal(D.tradeDamageBonus(3, { twoHanded: true, level: 8, spec: strikes }), 6);
  });
});

describe("§ which trade, when a character holds two of a kind", () => {
  const both = (f) => ["mightyStrikes", "tacticalGuard"].includes(f);
  const onlyGuard = (f) => f === "tacticalGuard";

  test("all of them are offered", () => {
    assert.deepEqual(D.declaredTradesFor("melee", both).map((t) => t.key),
      ["mightyStrikes", "tacticalGuard"]);
  });

  test("a ranged roll is never offered a melee trade", () => {
    assert.deepEqual(D.declaredTradesFor("ranged", both), []);
  });

  test("the declared one wins", () => {
    assert.equal(D.declaredTradeFor("melee", both, "tacticalGuard").key, "tacticalGuard");
    assert.equal(D.declaredTradeFor("melee", both, "mightyStrikes").key, "mightyStrikes");
  });

  test("an unstated choice falls back to the first available", () => {
    // Cards written before the key existed carry none, and their holder had
    // only one trade to declare — so the first is the one they declared.
    assert.equal(D.declaredTradeFor("melee", both).key, "mightyStrikes");
    assert.equal(D.declaredTradeFor("melee", onlyGuard).key, "tacticalGuard");
  });

  test("a key the character does not hold is ignored, not obeyed", () => {
    // A hand-edited card must not conjure a talent. Falling back beats
    // honouring a claim the actor cannot support.
    assert.equal(D.declaredTradeFor("melee", onlyGuard, "mightyStrikes").key,
      "tacticalGuard");
  });

  test("no trade at all is still null", () => {
    assert.equal(D.declaredTradeFor("melee", () => false, "tacticalGuard"), null);
  });
});

describe("§ the roll is never billed twice for one choice", () => {
  test("the declaration and the standing stance are separate lines", () => {
    const { parts, total } = attackModifiers({ skillMod: 5, trade: 3, stance: -2 });
    const labels = parts.map((p) => p.label);
    assert.ok(labels.includes("LASTARC.Mod.declaredTrade"));
    assert.ok(labels.includes("LASTARC.Mod.declaredStance"));
    assert.equal(total, 0, "+5 skill, −3 declared, −2 standing");
  });

  test("no stance means no line", () => {
    const { parts } = attackModifiers({ skillMod: 5, trade: 3 });
    assert.ok(!parts.some((p) => p.label === "LASTARC.Mod.declaredStance"));
  });

  test("rollAttack clears the standing stance before it profiles", () => {
    /**
     * The ordering IS the fix, and it is invisible from either half. If the
     * profile is built first it reads the stance this declaration is about to
     * replace, and the roll pays `trade` and `stance` for the same choice.
     */
    const attack = read("module/dice/attack.mjs");
    const clear = attack.indexOf("if (declaringStance) await STANCE.declareStance(actor, { spec: null });");
    const profile = attack.indexOf("const profile = weaponProfileFor(actor, weapon, {");
    assert.ok(clear > 0, "the pre-roll clear is gone");
    assert.ok(profile > 0);
    assert.ok(clear < profile,
      "the old stance is being cleared AFTER the profile read it, so the " +
      "declaring roll is charged for both");
  });

  test("and raises the new one only after the roll", () => {
    const attack = read("module/dice/attack.mjs");
    const roll = attack.indexOf("const { roll, discardedNatural } = await rollCheckD20");
    const raise = attack.indexOf("const stance = declaringStance");
    assert.ok(raise > roll,
      "the stance is going up before the d20, so the attack that declared it " +
      "would be charged twice");
  });
});

describe("§ the stance is wired to something", () => {
  const stance = read("module/declared-stance.mjs");
  const attack = read("module/dice/attack.mjs");
  const actions = read("module/item-actions.mjs");
  const situational = read("module/dice/situational.mjs");
  const chat = read("module/chat.mjs");
  const lang = JSON.parse(read("lang/en.json"));

  test("it writes to an input slot, not a derived one", () => {
    // CLAUDE.md §3: derivation assigns `defences.ref.total` on every prepare,
    // so an effect on that path is overwritten between the two hooks.
    assert.match(stance, /key: "system\.defences\.ref\.misc"/);
    assert.ok(!/key: "system\.defences\.ref\.total"/.test(stance));
  });

  test("it expires on its own", () => {
    assert.match(stance, /duration: \{ rounds: 1/);
  });

  test("a disabled effect is not a standing stance", () => {
    // Expiry disables rather than deletes, so reading it back without this
    // check charges the penalty for ever.
    assert.match(stance, /!e\.disabled/);
  });

  test("the attack profile reads the penalty", () => {
    assert.match(attack, /stance: STANCE\.stancePenalty\(actor\)/);
    assert.match(attack, /if \(stance\) add\("LASTARC\.Mod\.declaredStance", stance\)/);
  });

  test("the dialog offers the choice, and the card records it", () => {
    assert.match(actions, /trades: STANCE\.tradeChoices\(kind,/);
    assert.match(situational, /<select name="tradeKey">/);
    assert.match(attack, /tradeKey: tradeSpec\?\.key \?\? null/);
    assert.match(chat, /tradeKey: flags\.tradeKey \?\? null/);
  });

  test("every string it renders exists", () => {
    for (const key of ["LASTARC.TechnickFlag.tacticalGuard",
      "LASTARC.TechnickFlagHint.tacticalGuard",
      "LASTARC.TechnickFlag.carefulShot",
      "LASTARC.TechnickFlagHint.carefulShot",
      "LASTARC.DeclaredStance.Name", "LASTARC.Mod.declaredStance",
      "LASTARC.Situational.TradeKind", "LASTARC.Situational.TradeAmount",
      "LASTARC.Situational.TradeReflex"]) {
      assert.ok(lang[key], `${key} is missing`);
    }
  });

  test("the amount box says what the points buy", () => {
    // "Trade for damage" over a Tactical Guard box describes the wrong bargain.
    assert.match(situational, /LASTARC\.Situational\.TradeReflex/);
    assert.match(situational, /trades\[0\]\?\.buys === "reflex"/);
  });
});
