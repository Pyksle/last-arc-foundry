/**
 * Phase 4 tests: action economy and initiative ordering.
 *
 * The banked-minor interrupt rule (§9) gets the heaviest coverage here. It is
 * the rule nobody tracks correctly by hand, which is exactly why the system
 * automating it has to be right.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LASTARC } from "../module/config.mjs";
import {
  createTurnState,
  beginTurn,
  availableMinors,
  canSpend,
  slotFor,
  spend,
  useReaction,
  useFreeAction,
  interrupt,
  sequenceComplete,
  provokes,
  SEQUENCES,
  ACTIONS
} from "../module/action-economy.mjs";

import {
  compareTurnOrder,
  sortCombatants,
  unresolvedTies,
  holdTurnOrder,
  holderPriority,
  joinCombatOrder,
  groupInitiativeDie,
  isFlatFooted,
  surpriseAwareness,
  surpriseActions,
  initiativeDieFor
} from "../module/initiative.mjs";

/* -------------------------------------------------------------------------- */

describe("§9 action slots and downgrades", () => {
  test("a fresh turn has all three slots", () => {
    const s = createTurnState();
    assert.ok(s.primary && s.secondary && s.minor);
    assert.equal(availableMinors(s), 3);
  });

  test("downgrades are one-directional", () => {
    const s = createTurnState();
    assert.ok(canSpend(s, "primary"));
    assert.ok(canSpend(s, "secondary"));
    assert.ok(canSpend(s, "minor"));

    // Only the minor slot left: it cannot pay for anything bigger.
    const onlyMinor = { ...s, primary: false, secondary: false };
    assert.ok(canSpend(onlyMinor, "minor"));
    assert.ok(!canSpend(onlyMinor, "secondary"));
    assert.ok(!canSpend(onlyMinor, "primary"));
  });

  test("a minor action is paid from the LEAST flexible slot available", () => {
    // Spending the primary on a minor while the minor slot is free would
    // silently destroy the turn.
    assert.equal(slotFor(createTurnState(), "minor"), "minor");
    assert.equal(slotFor({ ...createTurnState(), minor: false }, "minor"), "secondary");
    assert.equal(
      slotFor({ ...createTurnState(), minor: false, secondary: false }, "minor"),
      "primary"
    );
  });

  test("a secondary action never consumes the primary while secondary is free", () => {
    assert.equal(slotFor(createTurnState(), "secondary"), "secondary");
  });

  test("maximum three minor actions per turn, via full downgrade", () => {
    let s = createTurnState();
    for (let i = 0; i < 3; i++) s = spend(s, { type: "minor" }).state;
    assert.equal(availableMinors(s), 0);
    assert.ok(!canSpend(s, "minor"));
  });

  test("all-out requires and consumes all three slots", () => {
    const s = createTurnState();
    assert.ok(canSpend(s, "allOut"));

    const spent = spend(s, { type: "allOut" }).state;
    assert.equal(availableMinors(spent), 0);

    const partial = { ...s, minor: false };
    assert.ok(!canSpend(partial, "allOut"));
  });

  test("an unaffordable action is refused with a reason, not silently dropped", () => {
    const empty = { ...createTurnState(), primary: false, secondary: false, minor: false };
    const r = spend(empty, { type: "minor" });
    assert.equal(r.ok, false);
    assert.ok(r.reason);
    assert.deepEqual(r.state, empty, "state must be unchanged on refusal");
  });
});

/* -------------------------------------------------------------------------- */

describe("§9 banked minor actions — the interrupt rule", () => {
  test("consecutive minors accumulate toward a sequence", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.equal(s.bankedMinors, 1);
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.equal(s.bankedMinors, 2);
  });

  test("a Recovery completes on the third consecutive minor", () => {
    let s = createTurnState();
    for (let i = 0; i < 3; i++) s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.ok(sequenceComplete(s, "recovery"));
  });

  test("Aim completes on the second", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "aim" }).state;
    assert.ok(!sequenceComplete(s, "aim"));
    s = spend(s, { type: "minor", banks: "aim" }).state;
    assert.ok(sequenceComplete(s, "aim"));
  });

  test("Shake it Off lowers the Recovery requirement to two", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.ok(!sequenceComplete(s, "recovery"));
    assert.ok(sequenceComplete(s, "recovery", 2), "with Shake it Off");
  });

  test("ANY other action interrupts the sequence", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.equal(s.bankedMinors, 2);

    s = spend(s, { type: "minor" }).state;    // a plain minor, banking nothing
    assert.equal(s.bankedMinors, 0);
    assert.equal(s.bankedFor, null);
  });

  test("REGRESSION: a REACTION interrupts it too", () => {
    // This is the one people miss. A Block taken on someone else's turn wipes a
    // two-thirds-complete Recovery.
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.equal(s.bankedMinors, 2);

    s = useReaction(s).state;
    assert.equal(s.bankedMinors, 0, "a reaction must break the sequence");
  });

  test("switching sequences restarts the count rather than carrying it over", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "aim" }).state;
    s = spend(s, { type: "minor", banks: "aim" }).state;
    assert.equal(s.bankedMinors, 2);

    s = spend(s, { type: "minor", banks: "recovery" }).state;
    assert.equal(s.bankedFor, "recovery");
    assert.equal(s.bankedMinors, 1, "two banked Aims are not two banked Recoveries");
  });

  test("a free action does NOT interrupt — the sequence needs consecutive MINORS", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    const after = useFreeAction(s);
    assert.ok(after.ok);
    assert.equal(after.state.bankedMinors, 1);
  });

  test("banked progress SURVIVES the turn boundary", () => {
    // §9 explicitly allows a sequence to span turns; only an intervening action
    // breaks it. Resetting on beginTurn would make Recovery single-turn-only.
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "recovery" }).state;
    s = spend(s, { type: "minor", banks: "recovery" }).state;

    const nextTurn = beginTurn(s);
    assert.equal(nextTurn.bankedMinors, 2, "progress must carry across turns");
    assert.equal(availableMinors(nextTurn), 3, "but slots refresh");

    const finished = spend(nextTurn, { type: "minor", banks: "recovery" }).state;
    assert.ok(sequenceComplete(finished, "recovery"));
  });

  test("an explicit interrupt clears everything", () => {
    let s = createTurnState();
    s = spend(s, { type: "minor", banks: "aim" }).state;
    s = interrupt(s);
    assert.equal(s.bankedMinors, 0);
    assert.equal(s.bankedFor, null);
  });
});

describe("§8/§9 flat-footed blocks reactions and free actions", () => {
  test("reactions are blocked entirely while flat-footed", () => {
    const r = useReaction(createTurnState(), { flatFooted: true });
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });

  test("free actions are blocked while flat-footed", () => {
    assert.equal(useFreeAction(createTurnState(), { flatFooted: true }).ok, false);
  });

  test("...except hero points, which are the stated exception", () => {
    const r = useFreeAction(createTurnState(), { flatFooted: true, isHeroPoint: true });
    assert.ok(r.ok);
  });
});

describe("§9 counterattack triggers", () => {
  test("moving out of a threatened square provokes", () => {
    assert.ok(provokes("move", { leavingThreat: true }));
    assert.ok(!provokes("move", { leavingThreat: false }));
  });

  test("casting provokes unless cast defensively", () => {
    assert.ok(provokes("castSpell"));
    assert.ok(!provokes("castSpell", { castDefensively: true }));
  });

  test("failed Disarm and Grab provoke; successful ones do not", () => {
    assert.ok(provokes("disarm", { failed: true }));
    assert.ok(!provokes("disarm", { failed: false }));
    assert.ok(provokes("grab", { failed: true }));
  });

  test("standing up, sheathing and retrieving all provoke", () => {
    for (const key of ["standUp", "drawSheathe", "retrieveStored", "useItemFromInventory"]) {
      assert.ok(provokes(key), `${key} should provoke`);
    }
  });

  test("attacking does not provoke", () => {
    assert.ok(!provokes("attack"));
  });

  test("an unknown action never provokes rather than throwing", () => {
    assert.equal(provokes("nonesuch"), false);
  });
});

/* -------------------------------------------------------------------------- */

describe("§8 initiative ordering", () => {
  const c = (id, turnOrder, agiScore = 10) => ({ id, turnOrder, agiScore });

  test("LOWEST acts first", () => {
    const order = sortCombatants([c("slow", 11), c("fast", 2), c("mid", 7)]);
    assert.deepEqual(order.map((x) => x.id), ["fast", "mid", "slow"]);
  });

  test("ties break on higher Agility SCORE", () => {
    const order = sortCombatants([c("low", 5, 11), c("high", 5, 18)]);
    assert.deepEqual(order.map((x) => x.id), ["high", "low"]);
  });

  test("falls back to the initiative roll when no turn order is set", () => {
    const order = sortCombatants([
      { id: "a", initiative: 9, agiScore: 10 },
      { id: "b", initiative: 3, agiScore: 10 }
    ]);
    assert.deepEqual(order.map((x) => x.id), ["b", "a"]);
  });

  test("genuine ties are surfaced rather than settled silently", () => {
    const ties = unresolvedTies([c("a", 5, 12), c("b", 5, 12), c("c", 8, 10)]);
    assert.equal(ties.length, 1);
    assert.equal(ties[0].length, 2);
  });

  test("no false tie when Agility differs", () => {
    assert.equal(unresolvedTies([c("a", 5, 12), c("b", 5, 14)]).length, 0);
  });
});

describe("§8 Hold Turn", () => {
  const roster = () => [
    { id: "a", turnOrder: 2, agiScore: 12 },
    { id: "b", turnOrder: 5, agiScore: 10 },
    { id: "c", turnOrder: 9, agiScore: 14 }
  ];

  test("holding places the combatant immediately after the next one", () => {
    const all = roster();
    const order = holdTurnOrder(all, "a");
    assert.ok(order > 5 && order < 9, `expected between b and c, got ${order}`);

    const updated = all.map((x) => (x.id === "a" ? { ...x, turnOrder: order } : x));
    assert.deepEqual(sortCombatants(updated).map((x) => x.id), ["b", "a", "c"]);
  });

  test("the reorder PERSISTS — it is not a one-round delay", () => {
    // The new order is a stored value, so re-sorting a later round yields the
    // same sequence without reapplying anything.
    const all = roster();
    const order = holdTurnOrder(all, "a");
    const updated = all.map((x) => (x.id === "a" ? { ...x, turnOrder: order } : x));

    const roundTwo = sortCombatants(updated).map((x) => x.id);
    const roundThree = sortCombatants(updated).map((x) => x.id);
    assert.deepEqual(roundTwo, ["b", "a", "c"]);
    assert.deepEqual(roundThree, ["b", "a", "c"]);
  });

  test("holding when last is a no-op rather than an error", () => {
    assert.equal(holdTurnOrder(roster(), "c"), null);
  });

  test("holding at the end of the list places you after the final combatant", () => {
    const two = [{ id: "a", turnOrder: 2 }, { id: "b", turnOrder: 5 }];
    const order = holdTurnOrder(two, "a");
    assert.ok(order > 5);
  });

  test("multiple holders act by highest Agility, then SMALLEST die", () => {
    // Smallest die means fastest in this system — the opposite of the usual
    // intuition, and worth pinning.
    const order = holderPriority([
      { id: "slowDie", agiScore: 14, initiativeDie: "d12" },
      { id: "fastDie", agiScore: 14, initiativeDie: "d4" },
      { id: "highAgi", agiScore: 18, initiativeDie: "d10" }
    ]);
    assert.deepEqual(order.map((x) => x.id), ["highAgi", "fastDie", "slowDie"]);
  });
});

describe("§8 joining and group initiative", () => {
  test("a late arrival acts after the current highest", () => {
    const existing = [{ id: "a", turnOrder: 2 }, { id: "b", turnOrder: 9 }];
    assert.ok(joinCombatOrder(existing) > 9);
  });

  test("joining an empty combat is safe", () => {
    assert.equal(joinCombatOrder([]), 0);
  });

  test("group initiative uses the LARGEST die among the group", () => {
    // The group moves at the pace of its slowest member.
    assert.equal(groupInitiativeDie([
      { initiativeDie: "d4" }, { initiativeDie: "d12" }, { initiativeDie: "d8" }
    ]), "d12");
  });

  test("Improved Initiative steps the die down from the class default", () => {
    assert.equal(initiativeDieFor({ className: "mage" }), "d12");
    assert.equal(initiativeDieFor({ className: "mage", bonusSteps: 2 }), "d8");
    assert.equal(initiativeDieFor({ className: "rogue", bonusSteps: 5 }), "d3");
  });
});

/* -------------------------------------------------------------------------- */

describe("§8 flat-footed triggers", () => {
  test("flat-footed before acting in round 1", () => {
    assert.ok(isFlatFooted({ round: 1, hasActed: false }));
    assert.ok(!isFlatFooted({ round: 1, hasActed: true }));
  });

  test("not flat-footed from round 2 onward merely for not having acted", () => {
    assert.ok(!isFlatFooted({ round: 2, hasActed: false }));
  });

  test("being unable to detect the attacker is its own trigger", () => {
    assert.ok(isFlatFooted({ round: 5, hasActed: true, detectsAttacker: false }));
  });

  test("surprise is its own trigger regardless of round", () => {
    assert.ok(isFlatFooted({ round: 9, hasActed: true, surprised: true }));
  });
});

describe("§8 surprise awareness is PER ATTACKER-DEFENDER PAIR", () => {
  const attackers = [
    { id: "sneaky", stealth: 24 },
    { id: "clumsy", stealth: 8 }
  ];
  const defenders = [{ id: "guard", passivePerception: 14 }];

  test("a defender can miss one attacker and notice another", () => {
    const map = surpriseAwareness(attackers, defenders);
    const missed = map.get("guard");
    assert.ok(missed.has("sneaky"), "24 beats passive 14");
    assert.ok(!missed.has("clumsy"), "8 does not");
  });

  test("meet it beat it — equal passive perception notices the attacker", () => {
    const map = surpriseAwareness([{ id: "x", stealth: 14 }], defenders);
    assert.ok(!map.get("guard").has("x"));
  });

  test("this is why flat-footed cannot be a single global flag", () => {
    const map = surpriseAwareness(attackers, defenders);
    const missed = map.get("guard");
    assert.equal(missed.size, 1);
    assert.notEqual(missed.size, attackers.length,
      "the defender is flat-footed against one attacker but not the other");
  });
});

describe("§8 surprise round actions", () => {
  test("attackers act fully", () => {
    const r = surpriseActions({ isAttacker: true, initiative: 7 });
    assert.equal(r.actions, "full");
    assert.equal(r.flatFooted, false);
  });

  test("a surprised combatant who rolled lower than ALL attackers gets one action", () => {
    const r = surpriseActions({ isAttacker: false, initiative: 2, attackerInitiatives: [5, 8] });
    assert.equal(r.actions, 1);
    assert.ok(r.flatFooted);
  });

  test("otherwise they get none", () => {
    const r = surpriseActions({ isAttacker: false, initiative: 6, attackerInitiatives: [5, 8] });
    assert.equal(r.actions, 0);
    assert.ok(r.flatFooted);
  });
});

/* -------------------------------------------------------------------------- */

describe("action catalogue integrity", () => {
  test("every action has a valid slot", () => {
    const valid = new Set(["primary", "secondary", "minor", "allOut", "reaction"]);
    for (const [key, def] of Object.entries(ACTIONS)) {
      assert.ok(valid.has(def.slot), `${key} has invalid slot "${def.slot}"`);
    }
  });

  test("every banking action names a real sequence", () => {
    for (const [key, def] of Object.entries(ACTIONS)) {
      if (!def.banks) continue;
      assert.ok(SEQUENCES[def.banks], `${key} banks unknown sequence "${def.banks}"`);
    }
  });

  test("Recovery's requirement matches the config constant", () => {
    assert.equal(SEQUENCES.recovery.minors, LASTARC.recoveryMinorActions);
  });

  test("only minor actions bank toward sequences", () => {
    for (const [key, def] of Object.entries(ACTIONS)) {
      if (def.banks) assert.equal(def.slot, "minor", `${key} banks but is not a minor action`);
    }
  });
});
