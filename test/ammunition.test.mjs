/**
 * Ammunition (book p.102).
 *
 * Two tracking systems that answer the same question differently, plus a third
 * — off — that is the default and must stay the default. The tests below are
 * weighted toward the places a reasonable implementation goes wrong:
 *
 *   1. STAVES. They are ranged, they roll at range, and they are exempt by
 *      name. Reading "is it ranged?" instead of consulting the list makes every
 *      wand jam on an empty quiver.
 *   2. THE DIE IS NOT A COUNT. It shrinks on a roll, not on a subtraction, and
 *      the window widens with the units spent — so Volley's five arrows are far
 *      more dangerous to a stack than five separate shots.
 *   3. RECOVERY IS PER TYPE. Summing the encounter's spend and halving once is
 *      both wrong and generous.
 *   4. THE RELOAD LADDER RUNS BOTH WAYS. Quick Reload takes it down a step and
 *      a Severed Arm takes it up one, and having both must be a wash.
 *   5. OFF MEANS OFF. A world that never opted in must not have a single shot
 *      refused, a single quantity moved, or a single control drawn.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import * as D from "../module/derivation.mjs";
import * as AMMO from "../module/ammunition.mjs";
import * as AE from "../module/action-economy.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));
const store = read("module/dice/ammunition.mjs");
const attack = read("module/dice/attack.mjs");
const sheet = read("module/sheets/character-sheet.mjs");
const body = read("templates/actor/character-body.hbs");

/* ── which weapons care ────────────────────────────────────────────────────── */

describe("§102 only bows and crossbows spend ammunition", () => {
  test("bows and crossbows do", () => {
    assert.ok(AMMO.requiresAmmunition("bows"));
    assert.ok(AMMO.requiresAmmunition("crossbows"));
  });

  /**
   * The trap. A staff is in `rangedWeaponCategories`, uses the ranged
   * increments and rolls at distance — and the book exempts it by name:
   * "staves do not require ammo to use technicks and abilities such as Rapid
   * Shot". Anything that asks "is it ranged?" gets this wrong.
   */
  test("staves do NOT, though they are ranged", () => {
    assert.ok(LASTARC.rangedWeaponCategories.has("staves"),
      "if staves stop being ranged this test is no longer testing the trap");
    assert.equal(AMMO.requiresAmmunition("staves"), false);
  });

  test("melee categories do not", () => {
    for (const category of ["swords", "axes", "knives", "polearms", "bludgeons"]) {
      assert.equal(AMMO.requiresAmmunition(category), false, category);
    }
  });

  test("the ammunition list is a strict subset of the ranged list", () => {
    for (const category of LASTARC.ammunitionCategories) {
      assert.ok(LASTARC.rangedWeaponCategories.has(category),
        `${category} spends ammunition but is not a ranged category`);
    }
    assert.ok(LASTARC.ammunitionCategories.size < LASTARC.rangedWeaponCategories.size,
      "if the two lists ever match, deriving one from the other becomes tempting " +
      "and staves lose their exemption");
  });

  test("an unknown category needs nothing", () => {
    assert.equal(AMMO.requiresAmmunition("trebuchets"), false);
    assert.equal(AMMO.requiresAmmunition(undefined), false);
  });
});

/* ── the ammo die ──────────────────────────────────────────────────────────── */

describe("§102 the ammo die shrinks a step at a time", () => {
  test("the ladder runs d12 down to d4", () => {
    assert.deepEqual([...AMMO.AMMO_DIE_LADDER], ["d4", "d6", "d8", "d10", "d12"]);
  });

  test("each step down is the next size, not the next number", () => {
    assert.equal(AMMO.shrinkAmmoDie("d12"), "d10");
    assert.equal(AMMO.shrinkAmmoDie("d10"), "d8");
    assert.equal(AMMO.shrinkAmmoDie("d8"), "d6");
    assert.equal(AMMO.shrinkAmmoDie("d6"), "d4");
  });

  /** "When you roll a 1 on an ammo die of a d4, you are reduced to your last piece." */
  test("below a d4 is the last piece, not a d2 and not empty", () => {
    assert.equal(AMMO.shrinkAmmoDie("d4"), AMMO.AMMO_LAST_PIECE);
    assert.notEqual(AMMO.shrinkAmmoDie("d4"), AMMO.AMMO_EMPTY);
  });

  test("a 1 shrinks the die and anything else leaves it alone", () => {
    assert.equal(AMMO.consumeAmmoDie({ die: "d12", roll: 1 }).die, "d10");
    for (const roll of [2, 3, 7, 12]) {
      const out = AMMO.consumeAmmoDie({ die: "d12", roll });
      assert.equal(out.die, "d12", `rolled ${roll}`);
      assert.equal(out.shrank, false);
    }
  });

  /**
   * "If you would use 2 units of ammo in an attack, your die is reduced on a
   * 1 or 2; while using 3 or more units of ammo in an attack, reduces it on
   * a 1-3." The ceiling is the load-bearing half — Volley spends FIVE and the
   * window must not widen to 5.
   */
  test("spending more widens the window, and stops widening at three", () => {
    assert.equal(AMMO.shrinkThreshold(1), 1);
    assert.equal(AMMO.shrinkThreshold(2), 2);
    assert.equal(AMMO.shrinkThreshold(3), 3);
    assert.equal(AMMO.shrinkThreshold(5), 3, "Volley spends five and still shrinks on 1-3");
    assert.equal(AMMO.shrinkThreshold(99), 3);
  });

  test("Rapid Shot's two units shrink the die on a 2", () => {
    assert.equal(AMMO.consumeAmmoDie({ die: "d10", roll: 2, units: 2 }).die, "d8");
    assert.equal(AMMO.consumeAmmoDie({ die: "d10", roll: 2, units: 1 }).die, "d10");
  });

  test("Volley's five units shrink the die on a 3 but not a 4", () => {
    assert.equal(AMMO.consumeAmmoDie({ die: "d8", roll: 3, units: 5 }).die, "d6");
    assert.equal(AMMO.consumeAmmoDie({ die: "d8", roll: 4, units: 5 }).die, "d8");
  });

  /** The last piece is one arrow. You do not roll to see whether you still have it. */
  test("the last piece is spent outright, whatever the roll would have been", () => {
    const out = AMMO.consumeAmmoDie({ die: AMMO.AMMO_LAST_PIECE, roll: 12 });
    assert.equal(out.die, AMMO.AMMO_EMPTY);
    assert.equal(out.fired, true);
  });

  test("an empty stack fires nothing", () => {
    const out = AMMO.consumeAmmoDie({ die: AMMO.AMMO_EMPTY, roll: 1 });
    assert.equal(out.fired, false);
    assert.equal(out.die, AMMO.AMMO_EMPTY);
  });

  test("a missing roll never shrinks the die by accident", () => {
    for (const roll of [null, undefined, NaN, 0]) {
      assert.equal(AMMO.consumeAmmoDie({ die: "d8", roll }).shrank, false, String(roll));
    }
  });

  test("only die states have a formula to roll", () => {
    assert.equal(AMMO.ammoDieFormula("d8"), "1d8");
    assert.equal(AMMO.ammoDieFormula(AMMO.AMMO_LAST_PIECE), null);
    assert.equal(AMMO.ammoDieFormula(AMMO.AMMO_EMPTY), null);
  });
});

describe("§102 looting steps the die back up", () => {
  test("one step up the ladder", () => {
    assert.equal(AMMO.growAmmoDie("d4"), "d6");
    assert.equal(AMMO.growAmmoDie("d10"), "d12");
  });

  test("it recovers the two states below the ladder in order", () => {
    assert.equal(AMMO.growAmmoDie(AMMO.AMMO_EMPTY), AMMO.AMMO_LAST_PIECE);
    assert.equal(AMMO.growAmmoDie(AMMO.AMMO_LAST_PIECE), "d4");
  });

  /**
   * Capped, because a bought stack is a d12 and the book names no step above
   * it. Uncapped, looting would be strictly better than shopping.
   */
  test("a full stack cannot be looted higher", () => {
    assert.equal(AMMO.growAmmoDie("d12"), "d12");
  });

  test("shrinking and looting are inverses in the middle of the ladder", () => {
    for (const die of ["d6", "d8", "d10", "d12"]) {
      assert.equal(AMMO.growAmmoDie(AMMO.shrinkAmmoDie(die)), die, die);
    }
  });
});

/* ── the reload ladder ─────────────────────────────────────────────────────── */

describe("§102 what a reload costs", () => {
  test("a secondary action by default", () => {
    assert.equal(AMMO.reloadSlot(), "secondary");
  });

  test("Quick Reload makes it a minor", () => {
    assert.equal(AMMO.reloadSlot({ quickReload: true }), "minor");
  });

  /** Severed Arm: "increase the reload action by 1 step" (book p.170). */
  test("a severed arm makes it a primary", () => {
    assert.equal(AMMO.reloadSlot({ stepIncrease: 1 }), "primary");
  });

  test("having both is a wash", () => {
    assert.equal(AMMO.reloadSlot({ quickReload: true, stepIncrease: 1 }), "secondary");
  });

  /**
   * Clamped rather than allowed to fall off either end. Running past `primary`
   * has no representation and would silently become "cannot reload at all",
   * which is a far bigger ruling than this function may make.
   */
  test("it clamps at both ends", () => {
    assert.equal(AMMO.reloadSlot({ stepIncrease: 5 }), "primary");
    assert.equal(AMMO.reloadSlot({ quickReload: true, stepIncrease: -5 }), "minor");
  });

  test("every slot it can return is a real action slot", () => {
    for (const slot of AMMO.RELOAD_SLOTS) {
      assert.ok(AE.SLOTS.includes(slot), `${slot} is not an action-economy slot`);
    }
  });

  /**
   * The config half of this rule has existed since the dismemberment table was
   * transcribed and was read by NOTHING — the exact orphan shape this project
   * keeps producing. It is aggregated now, so the value reaches `reloadSlot`.
   */
  test("severedArm's reloadStepIncrease reaches the aggregate", () => {
    assert.equal(LASTARC.statusEffects.severedArm.reloadStepIncrease, 1,
      "the config entry this whole path exists to read");
    assert.equal(D.aggregateStatuses(["severedArm"]).reloadStepIncrease, 1);
    assert.equal(D.aggregateStatuses([]).reloadStepIncrease, 0);
  });

  test("the reload action is priced as a secondary in the catalogue", () => {
    assert.equal(AE.ACTIONS.reload.slot, "secondary");
  });
});

/* ── firing: the gate ──────────────────────────────────────────────────────── */

const BOW = { mode: "units", requiresAmmo: true, selected: true, capacity: null, stock: 10 };
const XBOW = { mode: "units", requiresAmmo: true, selected: true, capacity: 5, loaded: 5, stock: 20 };

describe("§102 the gate on firing", () => {
  test("tracking off never refuses anything", () => {
    const out = AMMO.ammoCheck({ ...BOW, mode: "off", stock: 0, selected: false });
    assert.equal(out.ok, true);
  });

  test("a weapon that needs no ammunition is never refused", () => {
    const out = AMMO.ammoCheck({ ...BOW, requiresAmmo: false, stock: 0, selected: false });
    assert.equal(out.ok, true);
  });

  test("a bow with arrows fires", () => {
    assert.equal(AMMO.ammoCheck(BOW).ok, true);
  });

  test("a bow with an empty quiver does not", () => {
    const out = AMMO.ammoCheck({ ...BOW, stock: 0 });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "LASTARC.Ammo.NotEnough");
  });

  test("a bow cannot fire five arrows it does not have", () => {
    assert.equal(AMMO.ammoCheck({ ...BOW, stock: 4, units: 5 }).ok, false);
    assert.equal(AMMO.ammoCheck({ ...BOW, stock: 5, units: 5 }).ok, true);
  });

  test("nothing chosen is its own reason, not 'empty'", () => {
    const out = AMMO.ammoCheck({ ...BOW, selected: false });
    assert.equal(out.reason, "LASTARC.Ammo.NoneSelected");
  });

  /** The magazine, not the pack, is what an empty crossbow is short of. */
  test("an unloaded crossbow says reload, even with a full quiver", () => {
    const out = AMMO.ammoCheck({ ...XBOW, loaded: 0, stock: 999 });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "LASTARC.Ammo.NeedsReload");
  });

  test("a partly loaded crossbow cannot Volley", () => {
    const out = AMMO.ammoCheck({ ...XBOW, loaded: 2, units: 5 });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "LASTARC.Ammo.NotEnoughLoaded");
  });

  test("under the die an exhausted stack stops the shot", () => {
    const out = AMMO.ammoCheck({
      mode: "die", requiresAmmo: true, selected: true, capacity: null, die: AMMO.AMMO_EMPTY
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "LASTARC.Ammo.Empty");
  });

  /**
   * Under the die the die is the whole supply, so an exhausted stack stops the
   * shot even when the magazine notionally holds rounds — you cannot have
   * loaded what you do not own. `ammoSpend` keeps the two consistent by
   * emptying the magazine when the die runs out.
   */
  test("under the die an exhausted stack beats a loaded magazine", () => {
    const out = AMMO.ammoCheck({
      mode: "die", requiresAmmo: true, selected: true,
      capacity: 15, loaded: 8, die: AMMO.AMMO_EMPTY
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "LASTARC.Ammo.Empty");
  });

  test("under the die the quiver's count is irrelevant", () => {
    const out = AMMO.ammoCheck({
      mode: "die", requiresAmmo: true, selected: true, capacity: null, stock: 0, die: "d6"
    });
    assert.equal(out.ok, true, "the die is the stock; the number beside it is not read");
  });

  test("every reason it can give is a real lang key", () => {
    const reasons = [...store.matchAll(/"(LASTARC\.Ammo\.[A-Za-z]+)"/g)].map((m) => m[1]);
    const pure = [...read("module/ammunition.mjs").matchAll(/"(LASTARC\.Ammo\.[A-Za-z]+)"/g)]
      .map((m) => m[1]);
    assert.ok(pure.length >= 5, "the refusal reasons should be in the pure module");
    for (const key of new Set([...reasons, ...pure])) {
      assert.ok(lang[key], `${key} is used but missing from lang/en.json`);
    }
  });
});

/* ── firing: the spend ─────────────────────────────────────────────────────── */

describe("§102 what firing costs", () => {
  test("tracking off moves nothing at all", () => {
    const out = AMMO.ammoSpend({ ...BOW, mode: "off", units: 3 });
    assert.equal(out.stock, 10);
    assert.equal(out.spent, 0);
  });

  test("a weapon that needs no ammunition moves nothing", () => {
    const out = AMMO.ammoSpend({ ...BOW, requiresAmmo: false, units: 3 });
    assert.equal(out.stock, 10);
    assert.equal(out.spent, 0);
  });

  test("a bow draws straight out of the quiver", () => {
    assert.equal(AMMO.ammoSpend({ ...BOW, units: 1 }).stock, 9);
    assert.equal(AMMO.ammoSpend({ ...BOW, units: 5 }).stock, 5);
  });

  /**
   * The stock was drawn down when the magazine was filled. Taking from both
   * would charge a crossbowman twice for every bolt.
   */
  test("a crossbow draws from the magazine and NOT from the pack again", () => {
    const out = AMMO.ammoSpend({ ...XBOW, units: 1 });
    assert.equal(out.loaded, 4);
    assert.equal(out.stock, 20, "the pack was already charged at reload time");
  });

  test("neither count can go negative", () => {
    assert.equal(AMMO.ammoSpend({ ...BOW, stock: 1, units: 5 }).stock, 0);
    assert.equal(AMMO.ammoSpend({ ...XBOW, loaded: 1, units: 5 }).loaded, 0);
  });

  test("under the die the quiver count is left alone and the die rolls", () => {
    const out = AMMO.ammoSpend({
      mode: "die", requiresAmmo: true, capacity: null, stock: 10, die: "d8", dieRoll: 1, units: 1
    });
    assert.equal(out.stock, 10, "counting is not what the die system does");
    assert.equal(out.die, "d6");
    assert.equal(out.shrank, true);
  });

  test("under the die a crossbow still empties its magazine", () => {
    const out = AMMO.ammoSpend({
      mode: "die", requiresAmmo: true, capacity: 5, loaded: 3, die: "d8", dieRoll: 5, units: 1
    });
    assert.equal(out.loaded, 2);
    assert.equal(out.die, "d8");
  });

  /**
   * A magazine that outlives the supply that filled it would let a player keep
   * firing rounds they no longer own — and the sheet would show them a count
   * the gate refuses to honour.
   */
  test("running the stack out empties the magazine with it", () => {
    const out = AMMO.ammoSpend({
      mode: "die", requiresAmmo: true, capacity: 15, loaded: 9,
      die: AMMO.AMMO_LAST_PIECE, dieRoll: 1, units: 1
    });
    assert.equal(out.exhausted, true);
    assert.equal(out.loaded, 0);
  });

  test("the units spent are reported, for recovery", () => {
    assert.equal(AMMO.ammoSpend({ ...BOW, units: 2 }).spent, 2);
    assert.equal(AMMO.ammoSpend({ ...BOW, units: 0 }).spent, 1, "a shot always costs at least one");
  });
});

/* ── reloading ─────────────────────────────────────────────────────────────── */

describe("§102 reloading moves units into the magazine", () => {
  test("an empty crossbow fills to capacity", () => {
    const plan = AMMO.reloadPlan({ mode: "units", capacity: 15, loaded: 0, ammoId: "a", stock: 40 });
    assert.equal(plan.loaded, 15);
    assert.equal(plan.drawn, 15);
  });

  test("it cannot draw more than the pack holds", () => {
    const plan = AMMO.reloadPlan({ mode: "units", capacity: 15, loaded: 0, ammoId: "a", stock: 4 });
    assert.equal(plan.loaded, 4);
    assert.equal(plan.drawn, 4);
  });

  test("reloading the same type tops it up rather than starting over", () => {
    const plan = AMMO.reloadPlan({
      mode: "units", capacity: 15, loaded: 10, currentAmmoId: "a", ammoId: "a", stock: 40
    });
    assert.equal(plan.drawn, 5);
    assert.equal(plan.loaded, 15);
    assert.equal(plan.returned, 0);
  });

  /**
   * "You must load the same type of ammunition into a weapon and cannot mix
   * different ammunition types." That forbids MIXING — it does not destroy the
   * bolts you take out. A player swapping to Black Bolts and losing eight
   * ordinary ones would be right to be annoyed.
   */
  test("switching type returns the loaded rounds instead of binning them", () => {
    const plan = AMMO.reloadPlan({
      mode: "units", capacity: 15, loaded: 8, currentAmmoId: "a", ammoId: "b", stock: 40
    });
    assert.equal(plan.returned, 8);
    assert.equal(plan.switching, true);
    assert.equal(plan.loaded, 15, "the magazine is refilled from scratch with the new type");
  });

  test("switching conserves the total", () => {
    const before = { packA: 40, packB: 40, loadedA: 8 };
    const plan = AMMO.reloadPlan({
      mode: "units", capacity: 15, loaded: before.loadedA,
      currentAmmoId: "a", ammoId: "b", stock: before.packB
    });
    const afterA = before.packA + plan.returned;
    const afterB = before.packB - plan.drawn;
    assert.equal(afterA + afterB + plan.loaded, before.packA + before.packB + before.loadedA);
  });

  /** The die is the supply, so there is no count to draw down — it simply fills. */
  test("under the die the magazine fills without spending a count", () => {
    const plan = AMMO.reloadPlan({ mode: "die", capacity: 15, loaded: 0, ammoId: "a", stock: 0 });
    assert.equal(plan.loaded, 15);
  });

  /**
   * A bow has no magazine. The book's Reload action is worded "ranged weapons
   * WITH CAPACITY", and nocking an arrow is part of firing — so choosing which
   * quiver to draw from moves nothing.
   */
  test("a bow has nothing to load", () => {
    const plan = AMMO.reloadPlan({ mode: "units", capacity: null, ammoId: "a", stock: 40 });
    assert.equal(plan.drawn, 0);
    assert.equal(plan.returned, 0);
  });

  test("the reload path charges an action only for a weapon with capacity", () => {
    const body = store.slice(store.indexOf("export async function reloadWeapon"));
    const guard = body.indexOf("if (capacity != null)");
    const spend = body.indexOf("spendAction(combatant");
    assert.ok(guard >= 0 && spend > guard,
      "the spendAction call must sit inside the capacity guard, or picking a " +
      "quiver for a bow would cost a secondary action the book never charges");
  });

  test("a refused reload does not still fill the magazine", () => {
    const body = store.slice(store.indexOf("export async function reloadWeapon"));
    const refusal = body.indexOf("if (!spent) return null;");
    const write = body.indexOf("setLoadedAmmo(weapon, { ammoId: chosenId");
    assert.ok(refusal >= 0 && write > refusal,
      "the magazine must only be written after the action was successfully paid for");
  });
});

/* ── recovery ──────────────────────────────────────────────────────────────── */

describe("§102 Ammunition Recovery halves per type", () => {
  test("half, rounded down", () => {
    assert.deepEqual(AMMO.ammoRecovered({ a: 6 }), { a: 3 });
    assert.deepEqual(AMMO.ammoRecovered({ a: 7 }), { a: 3 });
  });

  test("one spent recovers nothing, and is omitted rather than reported as zero", () => {
    assert.deepEqual(AMMO.ammoRecovered({ a: 1 }), {});
    assert.deepEqual(AMMO.ammoRecovered({ a: 0 }), {});
  });

  /**
   * "When multiple ammo types are used, recover 1/2 of each type." Summing
   * first and halving once is both wrong and generous: three Fire Arrows and
   * three Wooden Arrows recover one of EACH, not three of whichever the player
   * names.
   */
  test("each type is halved separately", () => {
    assert.deepEqual(AMMO.ammoRecovered({ fire: 3, wooden: 3 }), { fire: 1, wooden: 1 });
    const summed = Math.floor((3 + 3) / 2);
    assert.notEqual(1 + 1, summed, "halving the sum would hand back three, not two");
  });

  test("nothing spent recovers nothing", () => {
    assert.deepEqual(AMMO.ammoRecovered({}), {});
    assert.deepEqual(AMMO.ammoRecovered(), {});
  });

  /**
   * The #53 merge, one layer down. `setFlag` on an object merges key by key,
   * so writing `{}` over a tally LEAVES the tally — and the recovery would be
   * claimable again after every subsequent encounter, compounding.
   */
  test("the encounter tally is UNSET, never overwritten with an empty object", () => {
    const body = store.slice(store.indexOf("export async function recoverAmmunition"));
    assert.match(body, /unsetFlag\(SYSTEM_ID, FLAG_SPENT\)/,
      "clearing the tally must unset the flag; setFlag merges and would keep it");
    assert.doesNotMatch(body, /setFlag\(SYSTEM_ID, FLAG_SPENT, \{\s*\}\)/);
  });

  test("recovery is offered only under the counted system", () => {
    // Under the die the book replaces recovery with looting, so a Recover
    // button there could only ever hand back zero.
    assert.match(store, /if \(ammoMode\(\) !== "units"\) return;/);
    assert.match(sheet, /ammoMode\(\) === "units"/);
  });
});

/* ── off means off ─────────────────────────────────────────────────────────── */

describe("§102 a world that never opted in is untouched", () => {
  test("off is the first mode and the registered default", () => {
    assert.equal(AMMO.AMMO_MODES[0], "off");
    const entry = read("module/last-arc.mjs");
    const block = entry.slice(entry.indexOf('game.settings.register(SYSTEM_ID, "ammoTracking"'));
    assert.match(block.slice(0, 400), /default: "off"/,
      "switching this on by default would change every existing bow and crossbow " +
      "in worlds whose players never asked for it");
  });

  test("every mode has a label", () => {
    for (const mode of AMMO.AMMO_MODES) {
      assert.ok(lang[`LASTARC.AmmoMode.${mode}`], `LASTARC.AmmoMode.${mode} is missing`);
    }
    assert.ok(lang["LASTARC.Setting.ammoTracking.name"]);
    assert.ok(lang["LASTARC.Setting.ammoTracking.hint"]);
  });

  test("every die state has a label", () => {
    for (const state of AMMO.AMMO_DIE_STATES) {
      assert.ok(lang[`LASTARC.AmmoDie.${state}`], `LASTARC.AmmoDie.${state} is missing`);
    }
  });

  test("every reload slot has a label, for the button's tooltip", () => {
    for (const slot of AMMO.RELOAD_SLOTS) {
      assert.ok(lang[`LASTARC.Slot.${slot}`], `LASTARC.Slot.${slot} is missing`);
    }
  });

  /** The sheet must draw no ammunition control at all while tracking is off. */
  test("the sheet returns no ammo readout when tracking is off", () => {
    const fn = sheet.slice(sheet.indexOf("#attackAmmo(weapon, mode)"));
    assert.match(fn.slice(0, 300), /mode === "off"[^\n]*return null/,
      "an off world must not be able to tell from the sheet that this exists");
  });

  test("the template draws the reload control only when there is an ammo readout", () => {
    const panel = body.slice(body.indexOf('class="la-panel la-panel--attacks"'));
    const block = panel.slice(0, panel.indexOf("la-panel__add"));
    const guard = block.indexOf("{{#if this.ammo}}");
    const button = block.indexOf('data-action="reloadWeapon"');
    assert.ok(guard >= 0 && button > guard);
  });

  test("the attack pipeline gates before it rolls", () => {
    const fn = attack.slice(attack.indexOf("export async function rollAttack"));
    const check = fn.indexOf("checkAmmo(actor, weapon");
    const roll = fn.indexOf("await rollCheckD20(actor");
    assert.ok(check >= 0 && roll > check,
      "an attack that has already rolled cannot be un-rolled; the refusal has to " +
      "come first or a dry crossbow still burns a d20 and a Combo");
  });

  /**
   * The gate lives in `rollAttack`, not in the sheets that call it. This file
   * has already shipped the other bug once: `targetConditions` was implemented
   * centrally and wired into one of the two sheets, so players got no bonus
   * against prone targets for as long as both sheets existed.
   */
  test("the gate is in the pipeline, not in a sheet", () => {
    assert.match(attack, /checkAmmo\(actor, weapon/);
    assert.doesNotMatch(sheet, /checkAmmo\(/,
      "a sheet-side gate is one of two call sites and the other will be forgotten");
  });
});

/* ── wiring ────────────────────────────────────────────────────────────────── */

describe("§102 the controls are reachable", () => {
  test("every action the sheet declares has a button and a handler", () => {
    for (const action of ["reloadWeapon", "recoverAmmo", "lootAmmo"]) {
      assert.match(sheet, new RegExp(`${action}: LastArcCharacterSheet\\.#on`),
        `${action} is not in DEFAULT_OPTIONS.actions`);
      assert.match(sheet, new RegExp(`static async #on${action[0].toUpperCase()}${action.slice(1)}\\(`),
        `${action} has no handler`);
    }
    assert.match(body, /data-action="reloadWeapon"/);
    assert.match(body, /data-action="recoverAmmo"/);
    assert.match(body, /data-action="lootAmmo"/);
  });

  test("the recovery card's button is dispatched by the chat listener", () => {
    const chat = read("module/chat.mjs");
    const card = read("templates/chat/ammo-recovery-card.hbs");
    assert.match(card, /data-action="lastarcRecoverAmmo"/);
    assert.match(chat, /case "lastarcRecoverAmmo":/);
  });

  test("the ammo die has an editor on the item sheet", () => {
    const template = read("templates/item/item-sheet.hbs");
    assert.match(template, /name="system\.ammoDie"/);
    assert.ok(lang["LASTARC.Field.AmmoDie"]);
  });

  /**
   * "Every 10 units of ammunition weighs 1/10 bulk." `quantity` counts arrows,
   * not stacks, so the per-unit figure is a hundredth. At 0.1 a forty-arrow
   * quiver weighed as much as two suits of armour.
   */
  test("ten units weigh a tenth of a bulk", () => {
    const items = read("module/data/items.mjs");
    const block = items.slice(items.indexOf("class LastArcAmmunitionData"));
    const match = /physicalFields\(\{ bulk: ([\d.]+) \}\)/.exec(block);
    assert.ok(match, "the ammunition model should still set its own bulk default");
    assert.equal(Number(match[1]) * 10, 0.1);
  });
});
