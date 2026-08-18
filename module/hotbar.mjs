/**
 * Dragging an action to the macro bar (issue #68).
 *
 * "My players have requested the ability to drag attacks and other actions
 * onto the quick bar so they can do their common actions without opening their
 * sheet." A fighter's whole turn is one weapon and one movement; opening a
 * 900-pixel sheet to click the same row every round is the kind of friction
 * that makes people stop using the VTT's automation at all.
 *
 * ── What the macro stores, and what it does not ────────────────────────────
 *
 * It stores IDS, and resolves the actor when it RUNS. Baking the actor into the
 * macro would break the two cases a table actually hits: an unlinked token's
 * actor is a different document from the sidebar one (CLAUDE.md §7), so a macro
 * made from the sidebar would roll for the template and change nothing on the
 * board; and a player who drags a spell wants it to work for whichever of their
 * tokens is selected, not the one that happened to be open.
 *
 * Foundry-free: the payload shape, the command text and the resolution ORDER
 * are all decided here and unit tested. `last-arc.mjs` registers the hook.
 */

/** The drag payload this system puts on the DataTransfer. */
export const HOTBAR_TYPE = "lastarc.itemAction";

/**
 * Is this something we dropped, and is it complete?
 *
 * Checked field by field rather than by `type` alone: a half-built payload
 * produces a macro that silently does nothing when clicked, which is worse
 * than refusing the drop and letting Foundry fall through to its own handling.
 */
export function isItemActionDrop(data) {
  return !!data
    && data.type === HOTBAR_TYPE
    && typeof data.itemId === "string" && data.itemId.length > 0
    && typeof data.action === "string" && data.action.length > 0
    && (typeof data.actorId === "string" || typeof data.tokenId === "string");
}

/**
 * The payload a dragged row carries.
 *
 * The token id is recorded when there is one, because that is the document the
 * roll must run against for an unlinked token. The actor id is recorded too, as
 * the fallback for a macro used when that token is not on the current scene.
 */
export function buildDragData({ actorId = null, tokenId = null, itemId, action, name = "", img = "" }) {
  return {
    type: HOTBAR_TYPE,
    actorId, tokenId, itemId, action,
    // Carried only so the macro can be named and iconed without a lookup at
    // drop time; nothing reads them when it runs.
    name, img
  };
}

/**
 * The command a hotbar macro runs.
 *
 * Deliberately a one-liner into the public API rather than an inlined copy of
 * the roll: a macro's text is FROZEN at the moment it is created, so anything
 * expressed here stops receiving fixes the day it is dragged. Every rule stays
 * behind `game.lastarc.rollItemMacro`, which is code that ships.
 */
export function macroCommand({ actorId, tokenId, itemId }) {
  return `game.lastarc.rollItemMacro(${JSON.stringify({ actorId, tokenId, itemId })}, event);`;
}

/**
 * Which actor a macro should roll for, given what it stored and what is
 * selected right now.
 *
 * ORDER IS THE WHOLE RULE. The controlled token wins, so a player with three
 * summons can drag one macro and use it for whichever is selected; then the
 * token the macro was made from, if it is still on the scene; then the actor.
 *
 * Pure, taking plain lookups, so the precedence is testable without Foundry —
 * it is the part that will be wrong silently, because every branch returns
 * something that looks like an actor.
 *
 * @param {object} stored  `{actorId, tokenId}` from the macro
 * @param {object} world   `{controlledTokenActor, tokenActor, actor}` lookups
 */
export function resolveMacroActor(stored = {}, world = {}) {
  const { controlledTokenActor = null, tokenActor = null, actor = null } = world;
  if (controlledTokenActor) return controlledTokenActor;
  if (stored.tokenId && tokenActor) return tokenActor;
  return actor ?? null;
}

/**
 * A stable name for the macro, so dragging the same action twice reuses the
 * slot's macro instead of littering the directory with duplicates.
 */
export function macroName({ name = "", action = "" }) {
  return `${name || "Action"} (${action})`;
}
