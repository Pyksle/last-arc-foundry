/**
 * Dragging an action to the macro bar (#68).
 *
 * "My players have requested the ability to drag attacks and other actions onto
 * the quick bar so they can do their common actions without opening their
 * sheet."
 *
 * The shape this would fail in is known in advance, because it is the shape
 * every duplicated rule in this project has failed in: a macro that
 * reimplements the roll and then drifts from the sheet. So the guards below are
 * mostly about there being ONE implementation — the dispatcher both paths call
 * — and about the macro storing ids rather than a resolved actor, which is the
 * other way this breaks (an unlinked token's actor is a different document).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOTBAR_TYPE, isItemActionDrop, buildDragData, macroCommand,
  resolveMacroActor, macroName
} from "../module/hotbar.mjs";
import { ITEM_ACTIONS, rollableAction } from "../module/item-actions.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const lang = JSON.parse(read("lang/en.json"));

/* -------------------------------------------------------------------------- */

describe("§68 which items can be dragged", () => {
  test("the four rollable kinds map to their action", () => {
    assert.equal(rollableAction({ type: "weapon" }), "attack");
    assert.equal(rollableAction({ type: "spell" }), "cast");
    assert.equal(rollableAction({ type: "performance" }), "perform");
    assert.equal(rollableAction({ type: "consumable" }), "use");
  });

  test("anything that is not an action is not draggable", () => {
    for (const type of ["armour", "shield", "race", "class", "feature",
      "technick", "talent", "resourceItem", "mount"]) {
      assert.equal(rollableAction({ type }), null, `${type} is not an action`);
    }
    assert.equal(rollableAction(null), null);
    assert.equal(rollableAction({}), null);
  });

  /**
   * Every action the map names has to be one the dispatcher actually handles.
   * A row that drags and produces a macro that does nothing is worse than a row
   * that does not drag.
   */
  test("every mapped action has a branch in the dispatcher", () => {
    const src = read("module/item-actions.mjs");
    for (const action of new Set(Object.values(ITEM_ACTIONS))) {
      assert.ok(
        src.includes(`action === "${action}"`) || action === "use",
        `nothing in rollItemAction handles "${action}"`);
    }
    // `use` is the fall-through, so assert it explicitly rather than by regex.
    assert.match(src, /useConsumable\(actor, item/);
  });
});

describe("§68 the drop payload", () => {
  const good = buildDragData({
    actorId: "abc", tokenId: null, itemId: "xyz", action: "attack",
    name: "ZZ Blade", img: "x.png"
  });

  test("a complete payload is recognised", () => {
    assert.equal(good.type, HOTBAR_TYPE);
    assert.ok(isItemActionDrop(good));
  });

  /**
   * Checked field by field. A half-built payload makes a macro that silently
   * does nothing when clicked, which is worse than refusing the drop and
   * letting Foundry fall through to its own handling.
   */
  test("an incomplete one is refused rather than made into a dud macro", () => {
    for (const missing of ["itemId", "action"]) {
      const bad = { ...good, [missing]: "" };
      assert.ok(!isItemActionDrop(bad), `${missing} empty must be refused`);
    }
    assert.ok(!isItemActionDrop({ ...good, actorId: null, tokenId: null }),
      "with neither an actor nor a token there is nothing to resolve against");
    assert.ok(!isItemActionDrop(null));
    assert.ok(!isItemActionDrop({ type: "Item", uuid: "Item.abc" }),
      "another module's or core's drop must not be claimed");
  });

  test("a token-only payload is enough", () => {
    assert.ok(isItemActionDrop(buildDragData({
      tokenId: "tok", itemId: "xyz", action: "cast"
    })));
  });
});

describe("§68 the macro stores ids, not an actor", () => {
  /**
   * A macro's command text is FROZEN when it is created. Anything expressed in
   * it stops receiving fixes the day it is dragged, so the only safe content is
   * a call into code that still ships.
   */
  test("the command is a call into the public API, not an inlined roll", () => {
    const cmd = macroCommand({ actorId: "a", tokenId: null, itemId: "i" });
    assert.match(cmd, /game\.lastarc\.rollItemMacro\(/);
    assert.ok(!/rollAttack|castSpell|performItem|useConsumable/.test(cmd),
      "the macro inlines a roll, so it will drift from the sheet the moment " +
      "either changes");
    assert.match(cmd, /event/, "the macro must pass the click through, or " +
      "Alt and Shift do nothing from the bar");
  });

  test("the command round-trips the ids it was given", () => {
    const cmd = macroCommand({ actorId: "AAA", tokenId: "TTT", itemId: "III" });
    for (const id of ["AAA", "TTT", "III"]) assert.ok(cmd.includes(id), id);
  });

  test("the same action twice produces the same command, so macros are reused", () => {
    const a = macroCommand({ actorId: "a", tokenId: null, itemId: "i" });
    const b = macroCommand({ actorId: "a", tokenId: null, itemId: "i" });
    assert.equal(a, b, "a differing command would litter the directory with " +
      "a duplicate macro on every drag");
  });

  test("the name says what it does", () => {
    assert.equal(macroName({ name: "Longsword", action: "attack" }), "Longsword (attack)");
    assert.match(macroName({ action: "cast" }), /\(cast\)/);
  });
});

describe("§68 which actor a macro rolls for", () => {
  const A = { id: "sidebar" };
  const T = { id: "token" };
  const C = { id: "controlled" };

  /**
   * ORDER IS THE WHOLE RULE, and every branch returns something that looks like
   * an actor — so a wrong precedence is silent and rolls for the wrong
   * creature.
   */
  test("a controlled token wins over everything", () => {
    assert.equal(
      resolveMacroActor({ actorId: "x", tokenId: "y" },
        { controlledTokenActor: C, tokenActor: T, actor: A }), C);
  });

  test("then the token the macro was made from", () => {
    assert.equal(
      resolveMacroActor({ actorId: "x", tokenId: "y" },
        { controlledTokenActor: null, tokenActor: T, actor: A }), T);
  });

  test("then the actor it was dragged from", () => {
    assert.equal(
      resolveMacroActor({ actorId: "x", tokenId: null },
        { controlledTokenActor: null, tokenActor: null, actor: A }), A);
  });

  /**
   * The unlinked-token case (CLAUDE.md §7). If the macro recorded no token, the
   * stored actor is right; if it recorded one and that token is gone from the
   * scene, falling back to the actor is better than refusing — the sidebar
   * document is at least the same creature's template.
   */
  test("a recorded token that is not on the scene falls back to the actor", () => {
    assert.equal(
      resolveMacroActor({ actorId: "x", tokenId: "gone" },
        { controlledTokenActor: null, tokenActor: null, actor: A }), A);
  });

  test("nothing at all resolves to null rather than throwing", () => {
    assert.equal(resolveMacroActor({}, {}), null);
    assert.equal(resolveMacroActor(), null);
  });
});

describe("§68 the wiring", () => {
  const sheet = read("module/sheets/character-sheet.mjs");
  const entry = read("module/last-arc.mjs");

  test("the sheet makes rollable rows draggable and emits the payload", () => {
    assert.match(sheet, /row\.draggable = true/,
      "no row is draggable, so there is nothing to drop");
    assert.match(sheet, /addEventListener\("dragstart"/);
    assert.match(sheet, /buildDragData\(\{/,
      "the payload is hand-built rather than going through the shared builder");
    assert.match(sheet, /rollableAction\(item\)/,
      "every row would be draggable, including armour and race features");
  });

  /**
   * The token id has to be recorded at DRAG time: the sheet knows whether it is
   * showing a token's actor and the hotbar does not.
   */
  test("the drag records the token, not just the actor", () => {
    assert.match(sheet, /tokenId: this\.document\.token\?\.id/,
      "an unlinked token's macro would roll for the sidebar template instead " +
      "of the creature on the board");
  });

  test("the drop hook is registered and declines drops that are not ours", () => {
    assert.match(entry, /registerHotbarDrop\(\);/, "the hook is never registered");
    const hook = entry.match(/Hooks\.on\("hotbarDrop",[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(hook, "no hotbarDrop registration found");
    assert.match(hook, /if \(!isItemActionDrop\(data\)\) return;/,
      "returning false for a drop we do not understand would break every " +
      "other module's dragging");
    assert.match(hook, /return false;/,
      "without this Foundry makes a second, useless macro from the same drop");
  });

  test("the macro entry point is on the public API", () => {
    assert.match(entry, /rollItemMacro\b/);
    const api = entry.match(/game\.lastarc = \{[\s\S]*?\n  \};/)[0];
    assert.match(api, /rollItemMacro/,
      "the macro's command calls it by name, so it must be reachable there");
  });

  test("both failures are reported rather than silent", () => {
    for (const key of ["LASTARC.Hotbar.NoActor", "LASTARC.Hotbar.NoItem"]) {
      assert.ok(key in lang, `${key} would render as a raw key`);
    }
    assert.match(entry, /LASTARC\.Hotbar\.NoActor/);
    assert.match(entry, /LASTARC\.Hotbar\.NoItem/);
  });
});
