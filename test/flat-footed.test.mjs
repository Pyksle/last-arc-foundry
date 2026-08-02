/**
 * Flat-footed: one rule, one implementation (#37).
 *
 * `initiative.mjs` exported a correct, unit-tested `isFlatFooted` that nothing
 * called, while `combat.mjs` implemented a strict subset of the same rule
 * inline. Two implementations of one rule, and the tested one was not the one
 * that ran — so every test in `combat-turns.test.mjs` about flat-footed passed
 * while describing behaviour the table never saw.
 *
 * The GM's ruling closes the architectural half of it: the per attacker/defender
 * cases are applied BY HAND, because a Foundry status is one flag on the actor
 * and cannot express "flat-footed against Nim but not against Vera". That only
 * works if the lifecycle stops deleting hand-applied statuses, which it did at
 * every round boundary.
 *
 * ── Why this file drives the real hook ────────────────────────────────────────
 *
 * The other option was a source scan, and this project has been burnt by those
 * twice: one passed against an `if (false)`, and another was vouched for by a
 * comment. The lifecycle is the part that was wrong, so the lifecycle is what
 * gets exercised — a fake Foundry small enough to read in one screen, and the
 * genuine `updateCombat` handler registered onto it.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { isFlatFooted, flatFootedAtCombatStart } from "../module/initiative.mjs";
import { registerCombat, rollSurprise } from "../module/combat.mjs";

/* ── the pure rule ─────────────────────────────────────────────────────────── */

describe("§8 who is flat-footed when combat begins", () => {
  const roster = (...ids) => ids.map((id) => ({ id }));

  test("everyone who has not yet acted, in round 1", () => {
    const ids = flatFootedAtCombatStart(roster("a", "b", "c"), { round: 1, actingId: "a" });
    assert.deepEqual(ids, ["b", "c"]);
  });

  test("nobody, from round 2", () => {
    assert.deepEqual(flatFootedAtCombatStart(roster("a", "b"), { round: 2, actingId: "a" }), []);
  });

  /**
   * THE CASE THE TWO IMPLEMENTATIONS DISAGREED ON.
   *
   * The lifecycle's inline version was "everyone except whoever is acting", so
   * a creature caught by the surprise round which then won initiative was
   * flat-footed by the rule and not by the code. It is also the only case where
   * the difference is visible in round 1, which is the round every playtest so
   * far has exercised.
   */
  test("a surprised combatant is flat-footed even though it acts first", () => {
    const ids = flatFootedAtCombatStart(
      [{ id: "ambusher" }, { id: "guard", surprised: true }],
      { round: 1, actingId: "guard" }
    );
    assert.ok(ids.includes("guard"),
      "acting exempts you from the round-1 trigger, not from surprise");
    // The ambusher is on the list too, by the ordinary round-1 trigger — it has
    // not acted either. Only `guard` distinguishes the two implementations.
    assert.deepEqual(ids, ["ambusher", "guard"]);
  });

  test("surprise outlasts round 1", () => {
    const ids = flatFootedAtCombatStart(
      [{ id: "guard", surprised: true }], { round: 6, actingId: "guard" }
    );
    assert.deepEqual(ids, ["guard"]);
  });

  /**
   * Parity, so the wrapper cannot drift from the rule it exists to delegate to.
   * A wrapper that quietly stops agreeing with the function it wraps is the
   * same defect this issue is about, one level down.
   */
  test("it agrees with isFlatFooted on every combination", () => {
    for (const round of [1, 2, 7]) {
      for (const acting of [true, false]) {
        for (const surprised of [true, false]) {
          const got = flatFootedAtCombatStart(
            [{ id: "x", surprised }], { round, actingId: acting ? "x" : "other" }
          ).includes("x");
          const want = isFlatFooted({ round, hasActed: acting, surprised });
          assert.equal(got, want, `round ${round} acting ${acting} surprised ${surprised}`);
        }
      }
    }
  });

  /**
   * `detectsAttacker` is the per-pair trigger and is deliberately NOT automated
   * — the GM applies the status by hand for those. Pinned so that a later
   * attempt to wire it here has to argue with the ruling rather than slip past
   * it, because a global flag genuinely cannot represent a pair.
   */
  test("the per-attacker trigger is not decided here", () => {
    assert.deepEqual(
      flatFootedAtCombatStart([{ id: "x", detectsAttacker: false }], { round: 4 }), [],
      "a per-pair trigger must not become a global status behind the GM's back"
    );
  });
});

/* ── a fake Foundry, big enough for the lifecycle and no bigger ────────────── */

function fakeActor(statuses = []) {
  const set = new Set(statuses);
  return {
    statuses: set,
    system: { skills: {} },
    async toggleStatusEffect(id, { active } = {}) {
      if (active) set.add(id);
      else set.delete(id);
      return active;
    }
  };
}

function fakeCombatant(id, { actor = fakeActor(), initiative = 5 } = {}) {
  const flags = {};
  return {
    id, name: id, actor, initiative,
    getFlag: (_scope, key) => flags[key],
    async setFlag(_scope, key, value) { flags[key] = value; },
    async unsetFlag(_scope, key) { delete flags[key]; },
    flags
  };
}

/**
 * Installs the globals `registerCombat` touches, captures the hooks it
 * registers, and returns a driver for the three transitions the tracker makes.
 */
function harness(combatants) {
  const hooks = new Map();
  globalThis.Hooks = {
    on(name, fn) {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name).push(fn);
    }
  };
  globalThis.Combat = class {};
  globalThis.Combatant = class {};
  globalThis.game = { users: { activeGM: { isSelf: true } } };

  registerCombat();

  const combat = {
    combatants,
    round: 0,
    turn: null,
    get combatant() { return this.turn == null ? null : this.combatants[this.turn]; }
  };

  const fire = async (changed) => {
    for (const fn of hooks.get("updateCombat") ?? []) await fn(combat, changed);
  };

  return {
    combat,
    /** Who is carrying the status right now. */
    flatFooted: () => combatants.filter((c) => c.actor.statuses.has("flatFooted")).map((c) => c.id),
    async begin() {
      combat.round = 1;
      combat.turn = 0;
      await fire({ round: 1, turn: 0 });
    },
    async nextTurn() {
      combat.turn += 1;
      await fire({ turn: combat.turn });
    },
    async nextRound() {
      combat.round += 1;
      combat.turn = 0;
      await fire({ round: combat.round, turn: 0 });
    }
  };
}

/* ── the lifecycle ─────────────────────────────────────────────────────────── */

describe("§8 the round-1 rule, end to end", () => {
  /**
   * The constraint the issue set: this part works today and is what every
   * playtest so far has exercised, so the refactor must not move it.
   */
  test("combat begins with everyone but the acting combatant flat-footed", async () => {
    const h = harness([fakeCombatant("a"), fakeCombatant("b"), fakeCombatant("c")]);
    await h.begin();
    assert.deepEqual(h.flatFooted(), ["b", "c"]);
  });

  test("acting ends it, one combatant at a time", async () => {
    const h = harness([fakeCombatant("a"), fakeCombatant("b"), fakeCombatant("c")]);
    await h.begin();
    await h.nextTurn();
    assert.deepEqual(h.flatFooted(), ["c"]);
    await h.nextTurn();
    assert.deepEqual(h.flatFooted(), []);
  });

  test("by round 2 the trigger is spent", async () => {
    const h = harness([fakeCombatant("a"), fakeCombatant("b")]);
    await h.begin();
    await h.nextTurn();
    await h.nextRound();
    assert.deepEqual(h.flatFooted(), []);
  });

  /**
   * The safety net, and the only thing the round-boundary sweep is still for.
   * A GM who ends round 1 early leaves combatants holding a status whose
   * trigger has expired; they never took the turn that would have cleared it.
   */
  test("a round-1 status survives its owner never acting, and expires at round 2", async () => {
    const h = harness([fakeCombatant("a"), fakeCombatant("b"), fakeCombatant("c")]);
    await h.begin();
    assert.deepEqual(h.flatFooted(), ["b", "c"], "b and c have not acted");

    await h.nextRound();                       // the GM skips the rest of round 1
    assert.deepEqual(h.flatFooted(), [], "the round-1 trigger does not outlive round 1");
  });
});

describe("§8 a surprised combatant that wins initiative", () => {
  const ambush = () => {
    const guard = fakeCombatant("guard");
    guard.flags.surprised = true;
    return harness([guard, fakeCombatant("ambusher")]);
  };

  test("is flat-footed despite acting first", async () => {
    const h = ambush();
    await h.begin();
    assert.ok(h.flatFooted().includes("guard"),
      "the inline rule flat-footed everyone EXCEPT whoever acts, so this creature " +
      "walked into its own ambush at full Reflex");
  });

  test("keeps it through the turn the ambush was meant to cost", async () => {
    // §8: flat-footed "until their next turn". Clearing on the update that
    // starts combat would hand the Agility straight back.
    const h = ambush();
    await h.begin();
    assert.ok(h.flatFooted().includes("guard"));
  });

  test("and loses it when its next turn comes round", async () => {
    const h = ambush();
    await h.begin();
    await h.nextTurn();       // the ambusher
    await h.nextRound();      // round 2 opens on the guard
    assert.deepEqual(h.flatFooted(), []);
    assert.equal(h.combat.combatants[0].flags.surprised, undefined,
      "surprise ends where the GM asked it to, at the start of the creature's turn");
  });
});

describe("§37 a hand-applied flat-footed belongs to the GM", () => {
  /**
   * The ruling: "We can apply it on the fly for the instance cases where a
   * target is flat-footed to that specific character."
   *
   * The sweep used to clear the status from EVERY combatant at every round
   * boundary, which is indistinguishable from the round-1 rule only for as long
   * as nothing else can apply it. Under the ruling something else can — the GM —
   * and the lifecycle was deleting their ruling one round later.
   */
  test("it survives a round boundary", async () => {
    const h = harness([fakeCombatant("rogue"), fakeCombatant("guard")]);
    await h.begin();
    await h.nextTurn();
    await h.nextRound();
    assert.deepEqual(h.flatFooted(), [], "clean slate");

    // The rogue sneaks up on the guard mid-round-2; the GM clicks the status.
    const guard = h.combat.combatants[1];
    await guard.actor.toggleStatusEffect("flatFooted", { active: true });

    await h.nextRound();
    assert.deepEqual(h.flatFooted(), ["guard"],
      "the lifecycle cleared a status it did not apply — the GM's ruling lasted " +
      "until the next round tick and no longer");
  });

  test("and ends at the start of that creature's own turn", async () => {
    const h = harness([fakeCombatant("rogue"), fakeCombatant("guard")]);
    await h.begin();
    await h.nextTurn();

    const guard = h.combat.combatants[1];
    await guard.actor.toggleStatusEffect("flatFooted", { active: true });

    await h.nextRound();      // round 2, the rogue
    await h.nextTurn();       // the guard acts
    assert.deepEqual(h.flatFooted(), []);
  });

  test("the lifecycle only marks what the lifecycle applied", async () => {
    const h = harness([fakeCombatant("rogue"), fakeCombatant("guard")]);
    await h.begin();
    assert.equal(h.combat.combatants[1].flags.flatFootedRound1, true);

    await h.nextTurn();
    assert.equal(h.combat.combatants[1].flags.flatFootedRound1, undefined,
      "the mark has to go with the status, or the next sweep clears a hand-applied one");
  });
});

/* ── the ambush that reported itself and did nothing ───────────────────────── */

describe("§8 rollSurprise applies the status it reports", () => {
  before(() => {
    globalThis.Roll = class {
      constructor(formula, data = {}) { this.formula = formula; this.data = data; }
      async evaluate() {
        this.dice = [{ results: [{ result: 20 }] }];
        this.total = 20 + (this.data.mod ?? 0);
        return this;
      }
    };
  });

  /**
   * The loop ran over the plain `{id, name, passivePerception}` snapshots, which
   * carry no `actor` at all — so `d.actor?.toggleStatusEffect` short-circuited
   * on undefined every single time and nothing was ever applied, while the
   * `flatFooted` array it returns was still populated. The function reported an
   * ambush it had not carried out.
   *
   * It has never bitten anyone because nothing calls it yet: the missing tracker
   * button is what kept it quiet.
   */
  test("a defender who missed the ambusher really is flat-footed", async () => {
    const ambusher = fakeCombatant("ambusher");
    ambusher.actor.system.skills = { stealth: { total: 4 } };

    const guard = fakeCombatant("guard");
    guard.actor.system.skills = { perception: { passive: 8 } };

    const result = await rollSurprise([ambusher], [guard]);

    assert.deepEqual(result.flatFooted, ["guard"], "reported");
    assert.ok(guard.actor.statuses.has("flatFooted"), "...and actually applied");
  });

  test("and is marked surprised, so the trigger outlives round 1", async () => {
    const ambusher = fakeCombatant("ambusher");
    ambusher.actor.system.skills = { stealth: { total: 4 } };
    const guard = fakeCombatant("guard");
    guard.actor.system.skills = { perception: { passive: 8 } };

    await rollSurprise([ambusher], [guard]);
    assert.equal(guard.flags.surprised, true);
  });

  test("a defender who noticed is left alone", async () => {
    const ambusher = fakeCombatant("ambusher");
    ambusher.actor.system.skills = { stealth: { total: 0 } };
    const guard = fakeCombatant("guard");
    // Passive 30 beats the scripted natural 20; meet it or beat it.
    guard.actor.system.skills = { perception: { passive: 30 } };

    const result = await rollSurprise([ambusher], [guard]);
    assert.deepEqual(result.flatFooted, []);
    assert.ok(!guard.actor.statuses.has("flatFooted"));
    assert.equal(guard.flags.surprised, undefined);
  });
});
