/**
 * The turn lifecycle is waited for, never guessed at.
 *
 * The combat batch passed five runs out of five on its own and failed about one
 * FULL run in three — a different test each time, which is what a timing race
 * looks like and what a real defect does not. Seventeen turn changes were
 * followed by `settle()`, a fixed 300ms that was true when the suite was short
 * and stopped being true as it grew: a loaded Foundry takes longer to finish
 * the document writes a turn change kicks off.
 *
 * These guards exist because the fix is one somebody could undo without
 * noticing — a new test written the old way passes on a quiet machine.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const quench = readFileSync(
  fileURLToPath(new URL("../module/quench.mjs", import.meta.url)), "utf8");
const lines = quench.split("\n");

/** Every line that advances or starts an encounter, with the line after it. */
function turnChanges() {
  const out = [];
  for (const [i, line] of lines.entries()) {
    if (!/await \w+\.(startCombat|nextTurn|nextRound)\(\)/.test(line)) continue;
    out.push({
      n: i + 1,
      line: line.trim(),
      prev: (lines[i - 1] ?? "").trim(),
      next: (lines[i + 1] ?? "").trim()
    });
  }
  return out;
}

describe("§ the barrier is used, and used everywhere", () => {
  /** Without this the checks below pass over an empty list. */
  test("the scan finds the helpers themselves", () => {
    const found = turnChanges();
    assert.ok(found.length >= 1 && found.length <= 3,
      "expected only the helper bodies to change a turn directly, found " +
      found.map((f) => `${f.n}: ${f.line}`).join(" | "));
  });

  /**
   * The whole fix. A raw `nextTurn()` in a test is the old bug returning, and
   * it will pass on the machine of whoever writes it.
   */
  test("no test advances a turn without the barrier", () => {
    /**
     * The three helpers arm the listener on the line BEFORE the transition —
     * they have to, or the write has already fired by the time anything is
     * listening. Everything else is a test doing it by hand.
     */
    const raw = turnChanges().filter((f) => !/turnSettled/.test(f.prev));
    assert.deepEqual(raw.map((f) => `${f.n}: ${f.line}`), [],
      "these change the turn and do not wait for the lifecycle — use " +
      "startEncounter / advanceTurn / advanceRound instead");
  });

  test("no turn change is followed by a fixed sleep", () => {
    const guessed = turnChanges().filter((f) => /await settle\(/.test(f.next));
    assert.deepEqual(guessed.map((f) => `${f.n}: ${f.line}`), [],
      "a stopwatch is back where a barrier belongs");
  });
});

describe("§ the barrier waits for the right thing", () => {
  const body = quench.slice(quench.indexOf("function turnSettled"),
                            quench.indexOf("\n}", quench.indexOf("function turnSettled")));

  /**
   * ARMED BEFORE THE TRANSITION. The first version polled for the incoming
   * combatant having fresh action slots — which, after a turn or two, it
   * already had from its own last turn. The condition was true the instant it
   * was asked, so the barrier waited for nothing and turned one flaky test into
   * a different one.
   */
  test("it listens for the write rather than polling for the state", () => {
    assert.match(body, /Hooks\.on\("updateCombatant"/,
      "the barrier polls state again, which is true before the write lands");
    assert.match(body, /changed\?\.flags\?\.\[SYSTEM_ID\]\?\.actions/,
      "it is not keyed on the lifecycle's final write");
    assert.ok(!/until\(/.test(body), "polling is back");
  });

  /**
   * The listener must be armed BEFORE the transition, or the write has already
   * fired by the time anything is listening. `advanceBy` does it for the two
   * that go through it; `startEncounter` does its own.
   */
  test("the transition is never started before the listener is armed", () => {
    for (const [helper, call] of [["startEncounter", "startCombat"],
                                  ["advanceBy", "move()"]]) {
      const at = quench.indexOf(`async function ${helper}`);
      assert.notEqual(at, -1, `${helper} is gone`);
      const fn = quench.slice(at, quench.indexOf("\n}", at));
      assert.ok(fn.indexOf("turnSettled") < fn.indexOf(call),
        `${helper} starts the transition before listening, so it can miss the write`);
      assert.match(fn, /await done;/, `${helper} never waits`);
    }
  });

  /**
   * The document has to have MOVED, not just written. Waiting only for the
   * write let the barrier return with `nextTurn` still in flight, the next call
   * landed on top of it, and a test asking for round 2 got round 1.
   */
  test("advancing waits for the encounter to actually move", () => {
    const at = quench.indexOf("async function advanceBy");
    const fn = quench.slice(at, quench.indexOf("\n}", at));
    assert.match(fn, /const from = position\(combat\)/, "nothing records where it started");
    assert.match(fn, /until\(\(\) => position\(combat\) !== from/,
      "the barrier returns without confirming the turn moved");
  });

  /** A lifecycle that never runs must fail the assertion, not hang the suite. */
  test("it gives up rather than hanging", () => {
    assert.match(body, /setTimeout\(finish/,
      "a lifecycle that never fires would hang the whole run");
    assert.match(body, /Hooks\.off\("updateCombatant"/,
      "the listener is never removed, so every later turn resolves a stale wait");
  });
});
