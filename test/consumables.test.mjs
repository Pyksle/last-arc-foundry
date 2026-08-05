/**
 * Consumables — potions, ethers, grenades (book p.125, and the Use Item action).
 *
 * Reported from a playtest as "tracking potions was tough... I made a potion
 * item, made it consumable but I could not use it for a heal."
 *
 * That was exactly right and it was not a bug: THE FEATURE DID NOT EXIST.
 * `LastArcConsumableData` has carried `uses`, `healing`, `damage`,
 * `appliesStatus`, `effect` and `consumeOnUse` since the item models were
 * written, every one with an input on the item sheet, and NOTHING read any of
 * them. `ACTIONS.useItemFromInventory` sat in the catalogue with the right slot
 * and the right `provokes` flag and nothing called it. Two halves, present,
 * unjoined — the shape this project keeps producing.
 *
 * The tests below weight the places a reasonable implementation goes wrong:
 *
 *   1. CHARGES ARE NOT QUANTITY. Five potions at 1 use each is not one potion
 *      with five uses. Drinking one must take a bottle off the shelf.
 *   2. ETHERS EXIST. The book's potion table restores MP as often as HP, and
 *      the model had no field for it.
 *   3. IT PROVOKES. The book says so outright, and it is the half nobody
 *      remembers at the table.
 *   4. AN EMPTY ONE EXPLAINS ITSELF rather than going quietly inert.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { ACTIONS, provokes } from "../module/action-economy.mjs";
import {
  canUseConsumable, useConsumable, consumableEffects, resolveManaRestore
} from "../module/consumables.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));
const consume = read("module/dice/consume.mjs");
const sheet = read("module/sheets/character-sheet.mjs");
const body = read("templates/actor/character-body.hbs");

/* ── the gate ─────────────────────────────────────────────────────────────── */

describe("§ whether there is anything left to use", () => {
  test("a full potion is usable", () => {
    assert.deepEqual(canUseConsumable({ quantity: 3, uses: { value: 1, max: 1 } }),
      { usable: true, reason: null });
  });

  test("none carried is refused with its own reason", () => {
    const r = canUseConsumable({ quantity: 0, uses: { value: 1, max: 1 } });
    assert.equal(r.usable, false);
    assert.equal(r.reason, "LASTARC.Consumable.NoneLeft");
  });

  test("carried but out of charges is a DIFFERENT reason", () => {
    const r = canUseConsumable({ quantity: 2, uses: { value: 0, max: 3 } });
    assert.equal(r.usable, false);
    assert.equal(r.reason, "LASTARC.Consumable.NoCharges",
      "'you have none' and 'this one is empty' are different problems");
  });

  /**
   * A maximum of 0 means "not a charged item", not "no charges". A GM who
   * zeroes the track on a single-dose bomb means it has no track.
   */
  test("an uncharged item is usable while you carry one", () => {
    assert.equal(canUseConsumable({ quantity: 1, uses: { value: 0, max: 0 } }).usable, true);
  });

  test("every reason it can give is a real lang key", () => {
    for (const key of [...consume.matchAll(/"(LASTARC\.Consumable\.\w+)"/g)].map((m) => m[1])) {
      assert.ok(lang[key], `${key} is missing from en.json`);
    }
    assert.ok(lang["LASTARC.Consumable.NoneLeft"]);
    assert.ok(lang["LASTARC.Consumable.NoCharges"]);
  });
});

/* ── charges versus quantity ──────────────────────────────────────────────── */

describe("§ one use takes one bottle off the shelf", () => {
  /** THE mistake: five potions is not one potion with five doses. */
  test("drinking one of five leaves four, all full", () => {
    const out = useConsumable({ quantity: 5, uses: { value: 1, max: 1 }, consumeOnUse: true });
    assert.equal(out.quantity, 4);
    assert.equal(out.uses.value, 1, "the next bottle is a full bottle");
    assert.equal(out.opened, true);
  });

  test("a multi-charge item spends a charge and stays on the shelf", () => {
    const out = useConsumable({ quantity: 1, uses: { value: 3, max: 3 }, consumeOnUse: true });
    assert.equal(out.uses.value, 2);
    assert.equal(out.quantity, 1, "a wand with charges left is still a wand");
    assert.equal(out.opened, false);
  });

  test("emptying the last charge consumes that one and opens the next", () => {
    const out = useConsumable({ quantity: 2, uses: { value: 1, max: 3 }, consumeOnUse: true });
    assert.equal(out.quantity, 1);
    assert.equal(out.uses.value, 3, "the fresh one is full");
  });

  test("the very last one leaves nothing, and says so", () => {
    const out = useConsumable({ quantity: 1, uses: { value: 1, max: 1 }, consumeOnUse: true });
    assert.equal(out.quantity, 0);
    assert.equal(out.uses.value, 0, "an empty shelf cannot have charges on it");
    assert.equal(out.spent, true);
  });

  /** A reusable tool spends charges but is never taken off the shelf. */
  test("consumeOnUse false never reduces quantity", () => {
    const out = useConsumable({ quantity: 1, uses: { value: 1, max: 3 }, consumeOnUse: false });
    assert.equal(out.quantity, 1);
    assert.equal(out.uses.value, 0);
    assert.equal(out.spent, false);
  });

  test("an uncharged consumable is simply used up", () => {
    const out = useConsumable({ quantity: 3, uses: { value: 0, max: 0 }, consumeOnUse: true });
    assert.equal(out.quantity, 2);
  });

  test("nothing ever goes negative", () => {
    const out = useConsumable({ quantity: 0, uses: { value: 0, max: 1 }, consumeOnUse: true });
    assert.ok(out.quantity >= 0 && out.uses.value >= 0);
  });
});

/* ── what it does ─────────────────────────────────────────────────────────── */

describe("§ what a consumable actually does", () => {
  test("blank boxes are null, not empty strings", () => {
    const e = consumableEffects({ healing: "  ", damage: "", appliesStatus: "" });
    assert.equal(e.healing, null);
    assert.equal(e.damage, null);
    assert.equal(e.status, null);
  });

  test("an item with nothing mechanical is flagged inert, not silently blank", () => {
    assert.equal(consumableEffects({ effect: "The GM decides." }).inert, true);
    assert.equal(consumableEffects({ healing: "10" }).inert, false);
    assert.equal(consumableEffects({ mpRestore: "20" }).inert, false,
      "an Ether is not inert just because it heals no HP");
  });

  test("a Health Potion and an Ether are both representable", () => {
    assert.equal(consumableEffects({ healing: "10" }).healing, "10");
    assert.equal(consumableEffects({ mpRestore: "20" }).mpRestore, "20");
  });

  /**
   * The book's potion table restores MP as often as HP — Ether 5, Hi-Ether 20,
   * Mega-Ether 80 — and the model had only `healing`, so half that table could
   * not be entered at all.
   */
  test("the schema declares mpRestore, with an input", () => {
    const items = read("module/data/items.mjs");
    const model = items.slice(items.indexOf("class LastArcConsumableData"));
    assert.match(model.slice(0, model.indexOf("\nexport class")), /mpRestore:/);
    assert.match(read("templates/item/item-sheet.hbs"), /name="system\.mpRestore"/);
    assert.ok(lang["LASTARC.Field.MpRestore"]);
  });
});

describe("§ restoring mana clamps and reports the overflow", () => {
  test("it fills toward the maximum", () => {
    assert.deepEqual(resolveManaRestore({ amount: 5, current: 2, max: 20 }),
      { applied: 5, wasted: 0, newMp: 7 });
  });

  test("overflow is reported rather than silently dropped", () => {
    const r = resolveManaRestore({ amount: 80, current: 18, max: 20 });
    assert.equal(r.newMp, 20);
    assert.equal(r.applied, 2);
    assert.equal(r.wasted, 78, "'why did my Mega-Ether give me 2?' has to be answerable");
  });

  test("it never exceeds the maximum or goes backwards", () => {
    assert.equal(resolveManaRestore({ amount: 5, current: 20, max: 20 }).newMp, 20);
    assert.equal(resolveManaRestore({ amount: 0, current: 7, max: 20 }).newMp, 7);
  });
});

/* ── the action it costs ──────────────────────────────────────────────────── */

describe("§ Use Item from Inventory costs a primary and provokes", () => {
  test("the catalogue says so", () => {
    assert.equal(ACTIONS.useItemFromInventory.slot, "primary");
    assert.equal(provokes("useItemFromInventory"), true,
      "the book states it outright, and it is the half nobody remembers");
  });

  test("the pipeline spends it and resolves the counterattack", () => {
    assert.match(consume, /spendAction\(combatant, "useItemFromInventory"\)/);
    assert.match(consume, /resolveCounterattacks\(combatant, "useItemFromInventory"\)/);
  });

  /** An empty bottle must not cost a primary action AND a counterattack. */
  test("the emptiness gate comes before the action is spent", () => {
    const gate = consume.indexOf("canUseConsumable");
    const spend = consume.indexOf("spendAction(combatant");
    assert.ok(gate >= 0 && spend > gate);
  });

  test("a refused action stops the use entirely", () => {
    const at = consume.indexOf("spendAction(combatant");
    assert.match(consume.slice(at, at + 200), /if \(!spent\) return null/);
  });

  /**
   * Grenade damage is rolled and posted, never applied. Which creature it
   * lands on is a ruling, and this is the only place in the system that could
   * have decided a target's HP without being asked (issue #19).
   */
  test("damage is offered on the card, not applied", () => {
    assert.match(consume, /rollDamageDice/);
    assert.doesNotMatch(consume, /applyDamage\(/);
    assert.match(read("templates/chat/consumable-card.hbs"), /lastarcApplyDamage/);
  });
});

/* ── reachable ────────────────────────────────────────────────────────────── */

describe("§ the Use button is reachable and explains a refusal", () => {
  test("the action is declared, handled and rendered", () => {
    assert.match(sheet, /useItem: LastArcCharacterSheet\.#onUseItem/);
    assert.match(sheet, /static async #onUseItem\(/);
    assert.match(body, /data-action="useItem"/);
  });

  test("only consumables get one", () => {
    assert.match(sheet, /item\.type === "consumable"/);
  });

  /**
   * Shown and disabled WITH the reason, never merely absent. Three separate
   * bug reports in this project have now been "the button did nothing".
   */
  test("an unusable item is disabled with its reason on the tooltip", () => {
    const at = body.indexOf('data-action="useItem"');
    const btn = body.slice(body.lastIndexOf("<button", at), body.indexOf("</button>", at));
    assert.match(btn, /\{\{#unless this\.use\.usable\}\}disabled\{\{\/unless\}\}/);
    assert.match(btn, /data-tooltip="\{\{this\.use\.tooltip\}\}"/);
  });

  test("the card template exists and is what the pipeline renders", () => {
    assert.match(consume, /templates\/chat\/consumable-card\.hbs/);
    assert.ok(read("templates/chat/consumable-card.hbs").length > 0);
  });

  test("every consumable type has a label for the card", () => {
    for (const t of LASTARC.consumableTypes) {
      assert.ok(lang[`LASTARC.ConsumableType.${t}`], `LASTARC.ConsumableType.${t} is missing`);
    }
  });
});
