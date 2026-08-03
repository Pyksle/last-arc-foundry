/**
 * Dodge — the Acrobatics reaction (issue #50).
 *
 * `ACTIONS.dodge = { slot: "reaction" }` sat in the action catalogue with no
 * roll, no button and no handler behind it, while the attack card told every
 * defender "you may still Block or Dodge" on every hit. Advertised and absent.
 *
 * ── The part that would have been got wrong ─────────────────────────────────
 *
 * `last-arc-foundry-system-spec.md` summarised the rule as "Dodge (Acrobatics
 * vs the attack roll)", which reads as something every character can do. The
 * book gates it three ways — the technick, light armour or none, and once per
 * turn — and building from the spec would have handed it to the whole table.
 * The gates get the heaviest coverage here for that reason: they are the part a
 * reasonable implementation omits.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import { resolveDodge } from "../module/derivation.mjs";
import * as AE from "../module/action-economy.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const lang = JSON.parse(read("lang/en.json"));
const dodge = read("module/dice/dodge.mjs");
const chat = read("module/chat.mjs");

/* ── the opposed roll ──────────────────────────────────────────────────────── */

describe("§50 beating the attack roll, not meeting it", () => {
  /**
   * The single most likely line in this feature to be wrong. Every DC in this
   * system is meet-it-or-beat-it; both opposed reactions invert that, and a tie
   * goes to the attacker.
   */
  test("a tie goes to the attacker", () => {
    assert.equal(resolveDodge({ dodgeTotal: 18, attackTotal: 18 }).dodged, false);
    assert.equal(resolveDodge({ dodgeTotal: 19, attackTotal: 18 }).dodged, true);
    assert.equal(resolveDodge({ dodgeTotal: 17, attackTotal: 18 }).dodged, false);
  });

  test("it agrees with Block, which is the same comparison", async () => {
    const { resolveBlock } = await import("../module/derivation.mjs");
    for (const [a, b] of [[10, 10], [11, 10], [9, 10], [0, 0], [-3, 2]]) {
      assert.equal(
        resolveDodge({ dodgeTotal: a, attackTotal: b }).dodged,
        resolveBlock({ blockTotal: a, attackTotal: b }).blocked,
        `${a} vs ${b}: the two reactions must resolve identically`
      );
    }
  });

  test("both totals come back, so the card can show its working", () => {
    const r = resolveDodge({ dodgeTotal: 21, attackTotal: 14 });
    assert.equal(r.dodgeTotal, 21);
    assert.equal(r.attackTotal, 14);
  });
});

/* ── the three gates ───────────────────────────────────────────────────────── */

describe("§50 the gates the spec left out", () => {
  test("it is a technick flag, not something everyone has", () => {
    assert.ok(LASTARC.technickFlags.includes("dodge"),
      "without the flag there is no way to say who has this technick, and the " +
      "reaction would be offered to every character in the world");
  });

  /**
   * ── These call `canDodge` rather than reading the source ──────────────────
   *
   * The first version of this suite scanned the file, and a mutation that
   * DELETED the technick gate outright passed every one of its tests: the
   * ordering check used `indexOf("NoTechnick")`, and a string that is no longer
   * there returns −1, which compares as "earliest". The guard was satisfied by
   * the absence of the thing it guarded.
   *
   * That gate is the whole point of the feature — without it every character in
   * the world can dodge — so it is exercised, not inspected.
   */
  const actor = ({ technick = true, armour = null, statuses = [], incapacitated = false } = {}) => ({
    items: [
      ...(technick ? [{ type: "technick", system: { flags: ["dodge"], active: true } }] : []),
      ...(armour ? [{ type: "armour", system: { equipped: true, type: armour } }] : [])
    ],
    statuses: new Set(statuses),
    system: { breakGauge: { incapacitated }, skills: {} }
  });

  test("no technick, no dodge", async () => {
    const { canDodge } = await import("../module/dice/dodge.mjs");
    globalThis.game = { combat: null };

    const r = canDodge(actor({ technick: false }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "LASTARC.Dodge.NoTechnick");
    assert.equal(r.hasTechnick, false, "the offer uses this to decide whether to draw at all");
  });

  test("a suspended technick grants nothing", async () => {
    const { canDodge } = await import("../module/dice/dodge.mjs");
    globalThis.game = { combat: null };

    const suspended = actor();
    suspended.items[0].system.active = false;
    assert.equal(canDodge(suspended).allowed, false,
      "a switched-off technick must not still grant its reaction");
  });

  test("the armour rule is enforced, both ways", async () => {
    const { canDodge } = await import("../module/dice/dodge.mjs");
    globalThis.game = { combat: null };

    assert.equal(canDodge(actor({ armour: null })).allowed, true, "unarmoured");
    assert.equal(canDodge(actor({ armour: "light" })).allowed, true, "light");

    for (const type of ["heavy", "mystic"]) {
      const r = canDodge(actor({ armour: type }));
      assert.equal(r.allowed, false, `${type} armour must refuse`);
      assert.equal(r.reason, "LASTARC.Dodge.Armour");
    }
  });

  test("unequipped armour does not count", async () => {
    const { canDodge } = await import("../module/dice/dodge.mjs");
    globalThis.game = { combat: null };

    const carrying = actor({ armour: "heavy" });
    carrying.items[1].system.equipped = false;
    assert.equal(canDodge(carrying).allowed, true,
      "heavy armour in the pack is not heavy armour worn");
  });

  test("flat-footed and incapacitated both refuse", async () => {
    const { canDodge } = await import("../module/dice/dodge.mjs");
    globalThis.game = { combat: null };

    assert.equal(canDodge(actor({ statuses: ["flatFooted"] })).reason, "LASTARC.Dodge.FlatFooted");
    assert.equal(canDodge(actor({ incapacitated: true })).reason, "LASTARC.Dodge.Incapacitated");
  });

  test("the technick is checked before any other refusal", async () => {
    // So a character without it never sees "you already dodged this turn" —
    // a message that would imply they could have.
    const { canDodge } = await import("../module/dice/dodge.mjs");
    globalThis.game = { combat: null };

    const worst = actor({ technick: false, armour: "heavy", statuses: ["flatFooted"] });
    assert.equal(canDodge(worst).reason, "LASTARC.Dodge.NoTechnick");
  });

  test("only light armour or none", async () => {
    // The REAL export, not a copy written here. A test asserting against its
    // own inline duplicate of the value it is checking proves only that the
    // duplicate exists — which is the fixture lie this project keeps finding.
    const { DODGE_ARMOUR_TYPES } = await import("../module/dice/dodge.mjs");

    assert.deepEqual([...DODGE_ARMOUR_TYPES], ["light"]);
    assert.ok(!DODGE_ARMOUR_TYPES.includes("heavy"),
      "the armour restriction is the condition a player will have forgotten, " +
      "so it must actually be enforced");
    assert.ok(!DODGE_ARMOUR_TYPES.includes("mystic"),
      "mystic is neither of the two categories the rule names; allowing it " +
      "would be a house rule invented in the code — raised on #50 instead");
    assert.ok(Object.isFrozen(DODGE_ARMOUR_TYPES));
  });

  test("only categories that actually exist in this system", () => {
    // Guarding the guard: a typo here would silently forbid dodging in every
    // armour, and the test above would still pass.
    assert.ok(Object.keys(LASTARC.armourTypes).includes("light"));
  });

  test("once per turn, and the cap is charged on a FAILED dodge too", () => {
    /**
     * The attempt is what costs. Charging only on success would let a
     * character dodge, miss, and dodge again — which is the cap not existing.
     *
     * Checked on the region between resolving the roll and posting the card,
     * so the assertion is about WHERE the write sits rather than merely that
     * the string appears somewhere in the file.
     */
    const body = dodge.slice(
      dodge.indexOf("const result = D.resolveDodge"),
      dodge.indexOf("await postDodgeCard")
    );
    assert.ok(body.includes("dodgeUsed: true"),
      "nothing records that the dodge happened, so it is not once per turn");
    assert.doesNotMatch(body, /result\.dodged/,
      "the once-per-turn cap is conditional on the dodge succeeding");
  });

  /**
   * The counter lives on the turn state, which `beginTurn` rebuilds from
   * scratch — so it clears itself. If that ever stopped being true, one dodge
   * would lock the technick off for the rest of the encounter.
   */
  test("the turn state genuinely forgets it at the start of a turn", () => {
    const used = { ...AE.createTurnState(), dodgeUsed: true, blocksUsed: 2 };
    assert.equal(AE.beginTurn(used).dodgeUsed, undefined,
      "a used dodge survives into the next turn, so the technick is once per combat");
  });

  test("banked progress still survives that reset", () => {
    // Guarding the guard: if beginTurn stopped preserving anything, the test
    // above would pass for the wrong reason.
    const s = { ...AE.createTurnState(), dodgeUsed: true, bankedMinors: 2, bankedFor: "recovery" };
    assert.equal(AE.beginTurn(s).bankedMinors, 2);
  });
});

/* ── the offer ─────────────────────────────────────────────────────────────── */

describe("§50 the button reaches the defender", () => {
  test("the offer is built and the render hook calls it", () => {
    assert.match(chat, /function offerDodge\(/, "no offer is built at all");
    assert.match(chat, /offerDodge\(message, element\);/,
      "the offer exists and nothing calls it — which is the whole defect this " +
      "issue is about, reproduced one level up");
  });

  test("the click is dispatched to a handler", () => {
    assert.match(chat, /case "lastarcDodge": return await onDodge\(/,
      "the button is emitted and nothing handles the click");
  });

  test("it is offered only against Reflex", () => {
    const fn = chat.slice(chat.indexOf("function offerDodge"), chat.indexOf("function markBlockedAttack"));
    assert.match(fn, /targetsDefence !== "ref"/,
      "a Will save would offer a Dodge, which nothing in the rules allows");
  });

  /**
   * Silent for a character without the technick, which is MOST of them. A
   * disabled Dodge button on every attack card for the rest of the campaign
   * would be worse than no button — that is the trade Block already makes for
   * the no-shield case.
   */
  test("no technick means no button, not a dead one", () => {
    const fn = chat.slice(chat.indexOf("function offerDodge"), chat.indexOf("function markBlockedAttack"));
    assert.match(fn, /if \(!check\.hasTechnick\) return;/);
  });

  test("but a recoverable refusal keeps the button and shows why", () => {
    const fn = chat.slice(chat.indexOf("function offerDodge"), chat.indexOf("function markBlockedAttack"));
    assert.match(fn, /button\.disabled = true;[\s\S]{0,120}dataset\.tooltip/,
      "wrong armour and already-dodged must be explained, not silently absent");
  });

  test("one reaction per attack — a Block already answered it", () => {
    const fn = chat.slice(chat.indexOf("function offerDodge"), chat.indexOf("function markBlockedAttack"));
    assert.match(fn, /if \(blockFor\(message\)\) return;/);
  });
});

describe("§50 a dodged attack behaves like a blocked one", () => {
  /**
   * The attack card greys its own Damage button from a LATER reaction message,
   * because the defender cannot write to the attacker's chat message. That
   * lookup matched `type === "block"` only, so a dodged attack would have kept
   * a live Damage button — the bug Block already solved, reintroduced for the
   * reaction added afterwards.
   */
  test("the lookup finds either reaction", () => {
    assert.match(chat, /const REACTION_TYPES = \["block", "dodge"\]/);
    const fn = chat.slice(chat.indexOf("function blockFor"), chat.indexOf("const negatedAttack"));
    assert.match(fn, /REACTION_TYPES\.includes\(f\?\.type\)/,
      "only a Block can answer an attack, so a dodged one keeps its Damage button");
  });

  test("and reads either outcome", () => {
    assert.match(chat, /f\?\.blocked \|\| f\?\.dodged/,
      "a successful dodge does not count as having stopped the attack");
  });

  test("the dodge card names the attack it answers", () => {
    assert.match(dodge, /blocksMessageId: sourceMessageId/,
      "without this the card cannot be matched back to its attack on any client");
  });
});

/* ── strings and the over-promise ──────────────────────────────────────────── */

describe("§50 what the cards say", () => {
  test("every string the reaction can show exists", () => {
    for (const key of ["LASTARC.Dodge.Offer", "LASTARC.Dodge.OfferTooltip",
      "LASTARC.Dodge.NoTechnick", "LASTARC.Dodge.Armour", "LASTARC.Dodge.FlatFooted",
      "LASTARC.Dodge.Incapacitated", "LASTARC.Dodge.AlreadyUsed",
      "LASTARC.Card.Dodge", "LASTARC.Card.Dodged", "LASTARC.Card.DodgeFailed",
      "LASTARC.Card.DodgeOncePerTurn",
      "LASTARC.TechnickFlag.dodge", "LASTARC.TechnickFlagHint.dodge"]) {
      assert.ok(lang[key], `${key} is missing from lang/en.json`);
    }
  });

  /**
   * The line that started this. It told every defender they could Dodge, on
   * every attack that beat a defence, for a reaction most of them have no
   * access to and which the system could not perform at all.
   */
  test("the reaction-window line no longer promises the defender anything", () => {
    const line = lang["LASTARC.Card.ReactionWindow"];
    assert.doesNotMatch(line, /target may still Block or Dodge/,
      "the card still tells every defender they may Dodge");
    assert.match(line, /may still answer/,
      "it should say a reaction is possible without naming abilities the " +
      "defender may not have");
  });
});

/* ── the guard that should have caught this ────────────────────────────────── */

describe("§50 a declared reaction is offered or explained", () => {
  /**
   * `ACTIONS.dodge` was declared with nothing behind it and no guard could see
   * it. The integrity suite has a check written for exactly this shape — after
   * three of four hero point spends turned out unreachable — but it covers
   * `HERO_SPEND` and the High Arcana list, not the action catalogue.
   *
   * Extending it needs care rather than a blanket rule: most of the 35 entries
   * are reference data consumed generically by `provokes()`, with the key
   * supplied by a caller. REACTIONS are the exception — a reaction has to be
   * offered to somebody or it cannot happen at all.
   */
  const OFFERED_ELSEWHERE = new Map([
    ["counterattack", "resolved automatically by resolveCounterattacks, not offered"],
    ["activateTrap", "traps are not modelled; there is nothing to activate"],
    ["mountedEvasion", "mounted and naval combat are not implemented"]
  ]);

  test("every reaction in the catalogue is reachable, or named with a reason", () => {
    const sources = ["module/chat.mjs", "module/combat.mjs", "module/dice/block.mjs",
      "module/dice/dodge.mjs"].map(read).join("\n");

    const unreachable = [];
    for (const [key, def] of Object.entries(AE.ACTIONS)) {
      if (def.slot !== "reaction") continue;
      if (OFFERED_ELSEWHERE.has(key)) continue;
      // A reaction is reachable if something offers or rolls it by name.
      const re = new RegExp(`(offer|roll|can)${key[0].toUpperCase()}${key.slice(1)}\\b`);
      if (!re.test(sources)) unreachable.push(key);
    }

    assert.deepEqual(unreachable, [],
      "these reactions are declared and nothing offers them, so they cannot " +
      "happen at all:\n  " + unreachable.join("\n  "));
  });

  test("the reasons stay honest — a wired reaction leaves the list", () => {
    const sources = ["module/chat.mjs", "module/dice/block.mjs", "module/dice/dodge.mjs"]
      .map(read).join("\n");
    for (const key of OFFERED_ELSEWHERE.keys()) {
      const re = new RegExp(`offer${key[0].toUpperCase()}${key.slice(1)}\\b`);
      assert.ok(!re.test(sources),
        `${key} is now offered — remove it from OFFERED_ELSEWHERE so the list ` +
        "does not become a place things hide");
    }
  });

  /**
   * The Quench fixture helpers must sit at MODULE scope.
   *
   * `withEncounter` was declared inside the `turn lifecycle` describe, so the
   * dodge batch — a sibling block — got a ReferenceError the moment it reached
   * for it. Nothing in `npm test` can catch that: none of `quench.mjs` executes
   * outside Foundry, and the integration suite has never been run. A scope
   * mistake in that file is invisible until the night someone finally runs it.
   */
  test("quench fixture helpers are shared, not trapped in one describe", () => {
    const quench = read("module/quench.mjs");
    for (const helper of ["withActor", "settle", "withEncounter"]) {
      assert.match(quench, new RegExp(`^(async )?function ${helper}\\(`, "m"),
        `${helper} is not declared at module scope, so any batch outside its ` +
        "own describe throws a ReferenceError the first time it is run");
    }
  });

  test("both wired reactions really are wired", () => {
    // Guarding the guard: if the regex stopped matching, the test above would
    // pass vacuously for every reaction at once.
    const sources = ["module/chat.mjs", "module/dice/block.mjs", "module/dice/dodge.mjs"]
      .map(read).join("\n");
    assert.match(sources, /offerBlock\b/);
    assert.match(sources, /offerDodge\b/);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * A reaction is a d20 CHECK, so traits that reroll that skill apply to it.
 *
 * Reported by the GM against 0.41.0: Dodge rolls Acrobatics, and a player whose
 * racial trait rerolls Acrobatics got no offer on the card. Two things were
 * missing, both on the flags.
 *
 *   1. `skillKey`. `offerGrantedRerolls` filters `!g.skill || g.skill ===
 *      flags.skillKey`, so a SCOPED grant compared against `undefined` and no
 *      button was drawn at all.
 *   2. `mod` and `attackTotal`. Without them the reroll could be offered and
 *      not resolved — `rebuildAfterReroll` walks a list of rebuilders, found
 *      none that owned the card, and fell through to a plain "original 9,
 *      rerolled 17" message. For a reaction that is worse than useless: the
 *      only question is whether the attack landed.
 *
 * BLOCK had exactly the same gap and is fixed in the same change. Dodge merely
 * made it visible, because the trait that found it is scoped to Acrobatics.
 */
describe("§50 a rerolled reaction rebuilds its verdict", () => {
  const block = read("module/dice/block.mjs");

  /**
   * The REPOST function's body, not the whole file.
   *
   * Three of these assertions first passed a mutation that gutted the rebuild,
   * because the phrases they searched for also occur in the ORIGINAL roll path
   * a hundred lines above — `rollBlock` returns `skillKey: check.skillKey`, and
   * `rollDodge` calls `resolveDodge({ dodgeTotal: roll.total …})`. Searching a
   * whole file for a phrase proves the phrase exists somewhere, which is not
   * the claim being made.
   */
  const repostOf = (src, name) => {
    const i = src.indexOf(`export async function repost${name}AfterReroll`);
    assert.ok(i > -1, `repost${name}AfterReroll does not exist`);
    return src.slice(i, src.indexOf("\nasync function post", i));
  };
  const dodgeRepost = repostOf(dodge, "Dodge");
  const blockRepost = repostOf(block, "Block");

  test("both cards name the skill they were rolled with", () => {
    // Scoped to the FLAGS block, not the file: `rollBlock` also returns a
    // `skillKey` in its result object, which is not the card's flag.
    const flagsOf = (src, type) => src.slice(src.indexOf(`type: "${type}"`),
      src.indexOf(`type: "${type}"`) + 900);
    assert.match(flagsOf(dodge, "dodge"), /skillKey: DODGE_SKILL/,
      "a scoped grant cannot recognise a Dodge, so no reroll button appears");
    assert.match(flagsOf(block, "block"), /skillKey: check\.skillKey/,
      "same for a Block, which is rolled with a weapon skill");
  });

  test("both carry what a rebuild needs", () => {
    for (const [name, src] of [["dodge", dodge], ["block", block]]) {
      assert.match(src, /attackTotal: result\.attackTotal/,
        `${name}: the reroll cannot be re-resolved without the attack total`);
      assert.match(src, /mod[,:]/,
        `${name}: without the modifier the reroll is a naked d20`);
    }
  });

  test("both are in the rebuild chain", () => {
    const fn = chat.slice(chat.indexOf("async function rebuildAfterReroll"));
    assert.match(fn.slice(0, 600), /repostBlockAfterReroll/);
    assert.match(fn.slice(0, 600), /repostDodgeAfterReroll/);
  });

  test("each rebuilder declines a card that is not its own", () => {
    // The chain relies on this: a rebuilder that claimed everything would stop
    // the ones after it ever running.
    assert.match(dodge, /if \(flags\?\.type !== "dodge"\) return false;/);
    assert.match(block, /if \(flags\?\.type !== "block"\) return false;/);
  });

  test("the rebuilt verdict is re-resolved, not carried over", () => {
    // The whole point: a reroll that turns a failure into a success has to say
    // so. Copying the old outcome would print the new number and the old word.
    assert.match(dodgeRepost, /resolveDodge\(\{\s*dodgeTotal: roll\.total/,
      "the rebuilt dodge card reuses the old verdict");
    assert.match(blockRepost, /resolveBlock\(\{\s*blockTotal: roll\.total/,
      "the rebuilt block card reuses the old verdict");
    for (const [name, body] of [["dodge", dodgeRepost], ["block", blockRepost]]) {
      assert.doesNotMatch(body, /flags\.(dodged|blocked)/,
        `${name}: the rebuild reads the stored outcome instead of re-resolving`);
    }
  });

  test("the rebuilt card is marked as already rerolled", () => {
    // Or every reroll button reappears on it and one reroll becomes as many as
    // the player has patience for — the bug fixed in #48 for skill checks.
    for (const [name, src] of [["dodge", dodge], ["block", block]]) {
      assert.match(src, /\.\.\.\(rerolled \? \{ rerolled: true \} : \{\}\)/,
        `${name}: the rebuilt card does not carry the reroll marker`);
    }
  });

  test("and still answers the same attack, so the strike-through survives", () => {
    for (const [name, src] of [["dodge", dodge], ["block", block]]) {
      assert.match(src, /sourceMessageId: flags\.blocksMessageId/,
        `${name}: the rebuilt card forgets which attack it answered, so a ` +
        "successful reroll would not grey the Damage button");
    }
  });

  test("the skill a Dodge names is a real one that grants can be scoped to", () => {
    assert.ok(LASTARC.allSkills[
      dodge.match(/DODGE_SKILL = "(\w+)"/)[1]
    ], "DODGE_SKILL is not a key in allSkills, so no grant could ever match it");
  });
});
