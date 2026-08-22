/**
 * Beast Shape (Druid).
 *
 * The arithmetic is small and two pieces of it are dangerous.
 *
 * The revert cost is the only rule in this system that can put a player
 * character on 0 hit points as a matter of bookkeeping rather than combat, and
 * the book is explicit that it does NOT kill. A caller that treated it like a
 * killing blow would end a character on a subtraction.
 *
 * And the two halves have to agree: taking a form adds the beast's maximum to
 * both pools, returning subtracts it. A druid who took no damage in between
 * must come back exactly as they left. That round trip is the property worth
 * pinning, because either half can drift on its own and look reasonable.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

import {
  formAllowance, transformCost, levelBonus, formDuration,
  transformResult, revertResult, expiryRound, isActiveForm, readBeast
} from "../module/beast-shape.mjs";

describe("§ what a form costs and grants", () => {
  test("a druid knows 1 + Int modifier forms", () => {
    assert.equal(formAllowance(0), 1);
    assert.equal(formAllowance(3), 4);
  });

  /** A talent that lets you know none of the thing it teaches is not a reading. */
  test("a poor Intelligence still leaves one form", () => {
    assert.equal(formAllowance(-2), 1);
    assert.equal(formAllowance(-9), 1);
  });

  test("transforming costs twice the beast's level", () => {
    assert.equal(transformCost(4), 8);
    assert.equal(transformCost(0), 0);
  });

  /** A statblock nobody finished reads level 0, which must not cost −4 MP. */
  test("a nonsense level never refunds mana", () => {
    assert.equal(transformCost(-2), 0);
  });

  test("the bonus is the level gap", () => {
    assert.equal(levelBonus(10, 4), 6);
    assert.equal(levelBonus(10, 10), 0);
  });

  /**
   * Taking a form stronger than you is allowed — it is only harder to learn.
   * The book grants a bonus for exceeding the beast; it imposes no penalty for
   * falling short, and a negative here would quietly subtract from defences,
   * skills and damage at once.
   */
  test("a stronger beast is not a penalty", () => {
    assert.equal(levelBonus(4, 10), 0);
  });

  test("the form lasts 5 + Vit modifier turns, but at least one", () => {
    assert.equal(formDuration(0), 5);
    assert.equal(formDuration(3), 8);
    assert.equal(formDuration(-9), 1, "an ability that costs mana to do nothing");
  });
});

describe("§ taking a form", () => {
  const base = {
    hp: 40, mp: 20, hpMax: 60, mpMax: 24,
    beastMaxHp: 30, beastMaxMp: 6, beastLevel: 4, druidLevel: 10, vitMod: 2
  };

  test("both pools gain the beast's maximum, and the cost comes out of mana", () => {
    const r = transformResult(base);
    assert.equal(r.cost, 8);
    assert.equal(r.hp, 70, "current HP gains the beast's maximum");
    assert.equal(r.mp, 20 - 8 + 6, "mana pays the cost, then gains the beast's");
    assert.equal(r.hpMax, 90);
    assert.equal(r.mpMax, 30);
    assert.equal(r.bonus, 6);
    assert.equal(r.duration, 7);
  });

  /**
   * The cost comes out of the druid's OWN mana before the beast's is added.
   * The other order lets a druid with nothing become anything at all by
   * spending the mana of the creature they have not become yet.
   */
  test("the beast's mana cannot pay for becoming the beast", () => {
    const broke = transformResult({ ...base, mp: 4 });
    assert.equal(broke.affordable, false,
      "4 MP paid an 8 MP cost using the 6 MP the form had not granted yet");
  });

  test("exactly enough is enough", () => {
    assert.equal(transformResult({ ...base, mp: 8 }).affordable, true);
    assert.equal(transformResult({ ...base, mp: 7 }).affordable, false);
  });
});

describe("§ giving it back", () => {
  test("the beast's maxima come off both pools", () => {
    const r = revertResult({ hp: 70, mp: 18, beastMaxHp: 30, beastMaxMp: 6 });
    assert.equal(r.hp, 40);
    assert.equal(r.mp, 12);
    assert.equal(r.lostHp, 30);
    assert.equal(r.lostMp, 6);
    assert.equal(r.unconscious, false);
  });

  /**
   * The rule that makes this dangerous: the loss is the beast's MAXIMUM,
   * whatever the pool holds by then. A form that took a beating comes off the
   * druid's own hit points.
   */
  test("damage taken in the form is paid for by the druid", () => {
    const r = revertResult({ hp: 35, mp: 0, beastMaxHp: 30, beastMaxMp: 6 });
    assert.equal(r.hp, 5, "the beating was charged to the beast's share only");
  });

  /**
   * The book says unconscious, explicitly. This is the only place in the system
   * where 0 HP arrives as arithmetic rather than as a blow, and a caller that
   * read it as a killing blow would end a character on a bookkeeping step.
   */
  test("reaching zero this way does not kill", () => {
    const r = revertResult({ hp: 30, mp: 0, beastMaxHp: 30, beastMaxMp: 0 });
    assert.equal(r.hp, 0);
    assert.equal(r.unconscious, true);
  });

  test("overshooting zero still floors at zero, and still does not kill", () => {
    const r = revertResult({ hp: 10, mp: 2, beastMaxHp: 30, beastMaxMp: 6 });
    assert.equal(r.hp, 0);
    assert.equal(r.mp, 0, "mana cannot go negative either");
    assert.equal(r.unconscious, true);
  });

  /**
   * The two halves have to agree. Take a form, take no damage, give it back —
   * the druid is exactly where they started, minus the mana it cost. Either
   * half can drift alone and still look reasonable; this is what catches it.
   */
  test("a round trip with no damage returns the druid to where they began", () => {
    const start = { hp: 40, mp: 20, hpMax: 60, mpMax: 24 };
    const beast = { beastMaxHp: 30, beastMaxMp: 6, beastLevel: 4 };
    const there = transformResult({ ...start, ...beast, druidLevel: 10, vitMod: 0 });
    const back = revertResult({ hp: there.hp, mp: there.mp, ...beast });

    assert.equal(back.hp, start.hp, "hit points did not survive the round trip");
    assert.equal(back.mp, start.mp - there.cost,
      "the only thing that should be missing is the mana it cost");
    assert.equal(back.unconscious, false);
  });
});

describe("§ how long it lasts, and which form it is", () => {
  /**
   * Rounds, not a per-turn countdown. A druid takes one turn per round, so the
   * expiry is knowable the moment they transform — no hook firing on every
   * combatant, and nothing to lose when a turn is skipped.
   */
  test("the expiry is the round the last turn falls in", () => {
    assert.equal(expiryRound(3, 5), 7, "five turns starting this one ends on round 7");
    assert.equal(expiryRound(1, 1), 1, "a one-turn form ends the round it began");
  });

  test("outside combat there is no round to name", () => {
    assert.equal(expiryRound(null, 5), null);
    assert.equal(expiryRound(0, 5), null);
  });

  /**
   * A form is identified by the actor it points at. Names break the moment two
   * beasts share one, and indices break as soon as a form is removed from the
   * middle of the list.
   */
  test("the active form is matched by pointer, not by name or position", () => {
    assert.equal(isActiveForm({ uuid: "Actor.a", name: "ZZ prowler" }, "Actor.a"), true);
    assert.equal(isActiveForm({ uuid: "Actor.a", name: "ZZ prowler" }, "Actor.b"), false);
    assert.equal(isActiveForm({ uuid: "" }, ""), false, "no form is not every form");
    assert.equal(isActiveForm({}, "Actor.a"), false);
  });
});

describe("§ reading a beast", () => {
  test("it takes level and both maxima off a statblock", () => {
    const r = readBeast({
      details: { level: 4 },
      resources: { hp: { max: 30 }, mp: { max: 6 } },
      defences: { will: { value: 17, base: 15 } }
    });
    assert.deepEqual(r, { level: 4, maxHp: 30, maxMp: 6, will: 17 });
  });

  /**
   * A half-entered statblock reads as zeroes rather than throwing. The druid
   * gets a form that costs nothing and grants nothing, which is visibly wrong
   * on the sheet — where a thrown error would just be a panel that never drew.
   */
  test("an empty statblock reads as zeroes, not an exception", () => {
    assert.deepEqual(readBeast({}), { level: 0, maxHp: 0, maxMp: 0, will: 10 });
    assert.deepEqual(readBeast(), { level: 0, maxHp: 0, maxMp: 0, will: 10 });
  });

  test("it falls back to the printed Will when nothing derived it", () => {
    assert.equal(readBeast({ defences: { will: { base: 15 } } }).will, 15);
  });
});

describe("§ the decisions the maths cannot hold", () => {
  const read = (p) => readFileSync(join(root, p), "utf8");
  const model = read("module/data/character.mjs");
  const actions = read("module/beast-shape-actions.mjs");

  /**
   * The combined maximum is DERIVED from the active form, never written.
   * `resources.hp.max` is assigned on every prepare, so a stored combined
   * maximum is overwritten before anybody sees it — the trap in the character
   * model's own docstring, and the reason the FORM is what gets stored.
   */
  test("the combined maximum is derived from the active form", () => {
    assert.match(model, /resources\.hp\.max \+= .*beastMaxHp/,
      "the beast's hit points are not being added to the derived maximum");
    assert.match(model, /resources\.mp\.max \+= .*beastMaxMp/);

    const at = model.indexOf("resources.hp.max += ");
    const assigned = model.lastIndexOf("this.resources.hp.max = D.hpMax", at);
    assert.ok(assigned !== -1 && assigned < at,
      "the beast's share is added before the class maximum is computed, so the " +
      "assignment wipes it");
  });

  /**
   * Deliberate: only defences could be expressed as an effect on an NPC — skills
   * are a flat printed array and damage lives per attack — and a third of a
   * bonus applied is worse than none, because a player who sees their Reflex
   * move assumes their skills moved too. The form also points at the GM's
   * bestiary entry, one document shared by every token of that creature.
   */
  test("no Active Effect is applied for the level bonus", () => {
    assert.ok(!/createEmbeddedDocuments\(\s*["']ActiveEffect/.test(actions),
      "an effect is being written for a bonus only a third of which can be applied");
    assert.ok(!/effects\.(create|add)/.test(actions));
    assert.match(actions, /shared by every token/,
      "the reason this is deliberate is not written down, so somebody will 'fix' it");
  });

  /**
   * The refund must equal the loan. Read the maxima back off the FORM entry and
   * a GM who corrects a statblock mid-encounter changes what the druid gets
   * back, moving their hit points with an edit nobody made to them.
   */
  test("the revert cost comes from the active form, not the form list", () => {
    const revert = actions.slice(actions.indexOf("export async function revertForm"));
    const body = revert.slice(0, revert.indexOf("\n}"));
    assert.match(body, /active\.beastMaxHp/);
    assert.match(body, /active\.beastMaxMp/);
    assert.ok(!/forms\.find|forms\[/.test(body),
      "the refund is being read from the form list, where a statblock edit reaches it");
  });

  test("forgetting the form you are wearing reverts first", () => {
    const forget = actions.slice(actions.indexOf("export async function forgetForm"));
    const body = forget.slice(0, forget.indexOf("\n}"));
    assert.match(body, /revertForm\(/,
      "deleting the active form would strand its maxima on the character forever");
  });
});
