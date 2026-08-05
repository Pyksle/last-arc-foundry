/**
 * Sheet-side wiring for per-reader panel layout (issues #54 and #55).
 *
 * The arithmetic lives in the Foundry-free `sheet-layout.mjs` and is unit tested
 * there. This file is the adapter, and it is shared by both actor sheets for the
 * same reason `reorder.mjs` is: two copies of "which panel am I, and where does
 * it go" would drift, and the failure mode of drift is one sheet quietly losing
 * a feature the other keeps.
 *
 * ── The first user flag in this system ─────────────────────────────────────
 *
 * Everything else here writes to a Combatant, an Item, an Actor or a
 * ChatMessage. This writes to `game.user`, and that is the whole design:
 *
 *   A reader may hold only OBSERVER on a sheet they still want to tidy. An
 *   actor flag needs OWNER, so tidying would fail with "User X lacks permission
 *   to update Actor Y" — the console noise 0.44.1 was spent removing, back in
 *   the reader's face for the crime of collapsing a panel.
 *
 *   A GM opening a player's sheet would otherwise reshuffle what that player
 *   sees. Layout is a preference, not a property of the character.
 *
 *   Every collapse would be a document update, and a document update re-renders
 *   the sheet on EVERY connected client. #55 asks for scroll position to be
 *   kept; re-rendering is precisely what throws it away.
 *
 * Nothing here ever re-renders. A click changes the DOM directly and the flag
 * catches up afterwards.
 *
 * ── setFlag merges ──────────────────────────────────────────────────────────
 *
 * The stored shape is `sheetLayout: { <actorId>: {order, collapsed, locked} }`,
 * which is the exact shape that cost a playtest week in #53. Merging is what we
 * want at the top level — another character's arrangement must survive — but it
 * also applies INSIDE each entry, so a write that omits `collapsed` keeps the
 * old `collapsed`. Every write below therefore states every key, and the one
 * place a value must genuinely disappear calls `unsetFlag`.
 */

import { LASTARC } from "../config.mjs";
import * as L from "../sheet-layout.mjs";

const SYSTEM_ID = "last-arc";
const FLAG = "sheetLayout";

/* -------------------------------------------------------------------------- */
/*  Storage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Layouts written but not yet acknowledged by the server.
 *
 * These sheets are `submitOnChange`, so ANY field edited anywhere re-renders
 * the whole thing. A reader who folds a panel away and immediately types in a
 * box starts that re-render inside the round trip of the `setFlag` — and
 * `_onRender` would then read a flag that has not caught up and helpfully open
 * the panel back up.
 *
 * That is issue #28's shape exactly: the proficiency ticks that vanished
 * between mousedown and click, lost to a re-render that read stale state. The
 * fix there was to stop rendering from the wrong source; the fix here is the
 * same in miniature — read what we just wrote until the write lands.
 */
const PENDING = new Map();

function saved(actorId) {
  return PENDING.get(actorId)
    ?? game.user?.getFlag(SYSTEM_ID, `${FLAG}.${actorId}`)
    ?? null;
}

/**
 * Write one actor's layout, stating every key.
 *
 * The flag key is NOT dotted here. `setFlag` builds `{flags: {scope: {key: v}}}`
 * and leaves the expansion of a dotted key to the update pipeline; nesting the
 * actor id inside the value instead is one less thing to be right about, and it
 * merges exactly the same way.
 */
async function store(actorId, patch) {
  const now = saved(actorId) ?? {};
  const next = {
    order: patch.order ?? now.order ?? [],
    collapsed: patch.collapsed ?? now.collapsed ?? [],
    // `??` and not `||`: unlocking writes `false`, which is the whole point.
    locked: patch.locked ?? now.locked ?? true
  };
  PENDING.set(actorId, next);
  try {
    await game.user.setFlag(SYSTEM_ID, FLAG, { [actorId]: next });
  } finally {
    // Cleared either way. On success `getFlag` now returns this; on failure the
    // sheet should go back to telling the truth rather than showing a layout
    // that was never stored.
    PENDING.delete(actorId);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/*  Reading the sheet                                                          */
/* -------------------------------------------------------------------------- */

/** The panels actually on screen, by section id. */
function panelsOf(sheet) {
  const found = new Map();
  for (const el of sheet.element?.querySelectorAll(".la-panel[data-section]") ?? []) {
    found.set(el.dataset.section, el);
  }
  return found;
}

function canonicalFor(type) {
  return (LASTARC.sheetSections[type] ?? []).map((s) => s.id);
}

function currentLayout(sheet, type, present) {
  return L.resolveLayout({
    saved: saved(sheet.document.id),
    canonical: canonicalFor(type),
    present
  });
}

/**
 * The section labels, for `_prepareContext`.
 *
 * The title partial looks the label up from here rather than being handed one,
 * so `LASTARC.sheetSections` is the single place a panel is named and a section
 * with no label is a test failure rather than an empty cartouche.
 */
export function sectionLabels(type) {
  return Object.fromEntries((LASTARC.sheetSections[type] ?? []).map((s) => [s.id, s.label]));
}

/* -------------------------------------------------------------------------- */
/*  Applying it                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Foundry disables every form control on a sheet the reader cannot edit.
 *
 * `DocumentSheetV2#_onRender` calls `_toggleDisabled(true)` whenever
 * `isEditable` is false, and that walks `form.elements` — which, per spec,
 * includes every `<button>`. The sheet's tag IS the form, so this reaches the
 * whole body.
 *
 * Correct for everything else on the sheet and wrong for these four. Folding a
 * panel away is not an edit to the character; it is an edit to how one reader
 * looks at it, stored on that reader. An OBSERVER is precisely the person this
 * feature was built for — somebody who wants to tidy a statblock they cannot
 * change — and leaving Foundry's blanket disable in place would have made every
 * control here dead for them, silently, with no notification and nothing in the
 * console. The #46 failure, delivered by inheritance.
 *
 * Re-enabled AFTER `super._onRender`, which is where the blanket disable runs.
 */
function reEnable(root) {
  for (const el of root.querySelectorAll(
    '[data-action="toggleSection"], [data-action="toggleLayoutLock"], [data-action="resetLayout"]'
  )) el.disabled = false;
}

/**
 * Push the stored layout onto the rendered sheet.
 *
 * Called from `_onRender`, and again after every change, so there is exactly one
 * routine that decides what the sheet looks like.
 *
 * Ordering MOVES THE NODES rather than setting CSS `order` on a flex column.
 * The flex version is a smaller diff and it is wrong: `order` reorders the
 * painting and nothing else, so the tab sequence and the screen-reader order
 * keep the original arrangement. A reader who put Spells at the top would find
 * Tab still walking them through Attributes first — which is the whole feature,
 * not working, for exactly the readers least able to work around it.
 *
 * The moves are minimal. Each panel is placed after its predecessor only when
 * it is not already there, so a re-render with an unchanged arrangement touches
 * nothing, and a single arrow click moves one node. That matters because the
 * Biography panel holds a `prose-mirror`, and moving a live custom element in
 * the DOM is not free.
 */
export function applyLayout(sheet, type) {
  const root = sheet.element;
  if (!root) return null;

  const panels = panelsOf(sheet);
  const layout = currentLayout(sheet, type, [...panels.keys()]);

  root.classList.toggle("is-layout-unlocked", !layout.locked);
  reEnable(root);

  const toggle = root.querySelector('[data-action="toggleLayoutLock"]');
  if (toggle) {
    const key = layout.locked ? "LASTARC.Layout.Arrange" : "LASTARC.Layout.Done";
    toggle.textContent = game.i18n.localize(key);
    toggle.dataset.tooltip = game.i18n.localize(
      layout.locked ? "LASTARC.Tooltip.Arrange" : "LASTARC.Tooltip.Done"
    );
  }

  let previous = null;
  for (const row of layout.rows) {
    const el = panels.get(row.id);
    if (!el) continue;   // the Actions panel, out of combat

    // The first panel is never moved, so the run stays wherever the panels
    // already are — below the statblock's identity header, which is a sibling
    // and must not be displaced.
    if (previous && previous.nextElementSibling !== el) previous.after(el);
    previous = el;

    el.classList.toggle("is-collapsed", row.collapsed);

    const head = el.querySelector('[data-action="toggleSection"]');
    if (head) head.setAttribute("aria-expanded", String(!row.collapsed));

    // Disabled, not hidden. A gap where a control used to be is more confusing
    // than a control that is plainly unavailable — the rule the row arrows
    // already follow.
    const up = el.querySelector('[data-action="moveSection"][data-direction="up"]');
    const down = el.querySelector('[data-action="moveSection"][data-direction="down"]');
    if (up) up.disabled = row.isFirst;
    if (down) down.disabled = row.isLast;
  }

  return layout;
}

/* -------------------------------------------------------------------------- */
/*  Scroll position (#55, second sentence)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where each sheet was scrolled to when it last re-rendered.
 *
 * `PARTS.body.scrollable = [""]` has been declared on both actor sheets since
 * they were written, and it has never done anything. The empty selector means
 * "the part root", which is `<div class="la-body">` — and `.la-body` has no
 * `overflow` rule anywhere. The element that actually scrolls is
 * `.window-content`, an ANCESTOR of the part, which a part-scoped selector
 * cannot reach. So Foundry has been faithfully saving and restoring a
 * `scrollTop` that is permanently 0.
 *
 * Nobody noticed because it only bites on re-render — and these sheets are
 * `submitOnChange`, so they re-render on every keystroke that commits. Editing
 * anything near the bottom of a long sheet threw the reader back to the top.
 * "Please ensure that collapses and scroll position are retained" was reported
 * against collapsing; this is the rest of it.
 *
 * Not fixed by giving `.la-body` its own `overflow`: that would make the sheet
 * body a second nested scroller, and a definite-height flex column full of
 * panels is the exact geometry that collapses a `prose-mirror` (CLAUDE.md 8).
 * Remembering the number around the render is smaller and touches no layout.
 */
const SCROLL = new WeakMap();

export function rememberScroll(sheet) {
  const content = sheet.element?.querySelector(".window-content");
  if (content) SCROLL.set(sheet, content.scrollTop);
}

export function restoreScroll(sheet) {
  const top = SCROLL.get(sheet);
  const content = sheet.element?.querySelector(".window-content");
  // 0 is not worth restoring, and skipping it keeps a first render from
  // fighting anything else that wants to scroll the fresh sheet.
  if (content && top) content.scrollTop = top;
}

/* -------------------------------------------------------------------------- */
/*  The three gestures                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Collapse or expand one section (#55).
 *
 * The DOM changes FIRST and the flag write is awaited afterwards. Not an
 * optimisation: the sheet is never re-rendered, so the scroll position is not
 * merely restored — it is never disturbed. "Please ensure that collapses and
 * scroll position are retained between collapses if possible" is answered by
 * there being nothing to retain.
 */
export async function toggleSection(sheet, type, target) {
  const id = target.dataset.section;
  const panel = target.closest(".la-panel");
  const now = saved(sheet.document.id) ?? {};

  const collapsed = L.toggleCollapsed(now.collapsed ?? [], id);
  const isCollapsed = collapsed.includes(id);

  panel?.classList.toggle("is-collapsed", isCollapsed);
  target.setAttribute("aria-expanded", String(!isCollapsed));

  await store(sheet.document.id, { collapsed });
}

/**
 * Move one section one place (#54).
 *
 * The move is computed against what is RENDERED, so a click always moves the
 * panel past something the reader can see. Out of combat the Actions panel is
 * absent, and swapping with it would be a click that did nothing.
 */
export async function moveSection(sheet, type, target) {
  const id = target.dataset.section;
  const present = [...panelsOf(sheet).keys()];
  const layout = currentLayout(sheet, type, present);

  const next = L.moveSection(layout.order, id, target.dataset.direction, present);
  if (!next) return;   // already at that end of what is on screen

  await store(sheet.document.id, { order: next });
  applyLayout(sheet, type);

  /**
   * Follow the panel. A section moved past a tall neighbour can land off the
   * bottom of the viewport, and a control whose effect you cannot see is
   * indistinguishable from one that did nothing. `nearest` leaves the scroll
   * alone when the panel is already visible, which is the common case.
   */
  target.closest(".la-panel")?.scrollIntoView({ block: "nearest" });
}

/** Take the catch off, or put it back on (#54). */
export async function toggleLayoutLock(sheet, type) {
  const now = saved(sheet.document.id) ?? {};
  await store(sheet.document.id, { locked: now.locked === false });
  applyLayout(sheet, type);
}

/**
 * Put the sheet back the way it ships.
 *
 * `unsetFlag`, not a write of the defaults: `setFlag` merges, so writing
 * `{order: [], collapsed: []}` over a stored entry would clear the arrays but
 * leave the entry behind, and a later `locked` would be read from a corpse.
 * Removing the key outright means `resolveLayout` falls back to DEFAULT_LAYOUT,
 * which is the definition of "the way it ships".
 */
export async function resetLayout(sheet, type) {
  // Drop the optimistic copy first, or a re-render mid-round-trip would restore
  // the arrangement this is removing.
  PENDING.delete(sheet.document.id);
  await game.user.unsetFlag(SYSTEM_ID, `${FLAG}.${sheet.document.id}`);
  applyLayout(sheet, type);
}
