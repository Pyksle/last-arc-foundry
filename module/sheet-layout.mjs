/**
 * Per-reader arrangement of a sheet's panels (issues #54 and #55).
 *
 * FOUNDRY-FREE. The index arithmetic and the merge rules live here so they can
 * be unit tested, exactly as `item-order.mjs` holds the arithmetic behind the
 * within-a-panel arrows.
 *
 * Two requests from the same playtest, and they are one feature:
 *
 *   #54 "sections could be rearranged by players per sheet … having a lock to
 *        prevent accidental moving of these sections would probably be wise"
 *   #55 "collapsing the performance header would make it so I don't have that
 *        wasted space that I have to scroll through"
 *
 * ── Whose arrangement is it? ────────────────────────────────────────────────
 *
 * The READER'S, not the actor's. Stored against the user, keyed by actor id.
 *
 * Storing it on the actor was the obvious thing and is wrong three times over.
 * A player may hold only OBSERVER on a sheet they still want to tidy, and
 * writing an actor flag needs OWNER — so the tidy would fail with a permission
 * error, which is precisely the console noise 0.44.1 was spent removing. It
 * would also mean a GM opening a player's sheet reshuffles what that player
 * sees. And every collapse would be a document update, which re-renders the
 * sheet on every connected client.
 *
 * ── Why an array and not a map ──────────────────────────────────────────────
 *
 * `collapsed` is an ARRAY of ids rather than `{spells: true}` because `setFlag`
 * MERGES: a key left out of an object is retained, not cleared, so expanding a
 * panel by omitting it would do nothing at all. Arrays are replaced wholesale.
 * This is the same trap that ate the Dodge reaction in #53 and the ammunition
 * spend tally in 0.44.0; it is written down here so it is not learnt a fourth
 * time.
 */

/**
 * A sheet nobody has touched: canonical order, nothing collapsed, LOCKED.
 *
 * Locked by default because the request was about accidents. An unlocked sheet
 * shows a pair of arrows on every panel, and a player who never wanted to
 * rearrange anything would be given nineteen new chances to do it by mistake.
 */
export const DEFAULT_LAYOUT = Object.freeze({
  order: Object.freeze([]),
  collapsed: Object.freeze([]),
  locked: true
});

/**
 * Reconcile a saved order with the sections the system currently ships.
 *
 * Two things go wrong here and both are silent, which is why this is a named
 * function with its own tests rather than three lines inside the sheet:
 *
 *   A section that no longer exists must be DROPPED. Otherwise it holds a slot
 *   in the order forever and the arrows appear to skip a beat.
 *
 *   A section that is NEW must appear at the position the sheet was designed
 *   with — immediately after whichever of its canonical predecessors the reader
 *   still has — not appended to the end. Appending is the tempting one-liner
 *   and it is a slow disaster: every panel added after this release would land
 *   at the bottom of the sheet of every player who had ever touched the layout,
 *   below Biography, and they would report it as the panel being missing.
 *
 * @param {string[]} saved      the reader's order, possibly stale
 * @param {string[]} canonical  ids the sheet ships, in designed order
 * @returns {string[]} a new array; neither input is mutated
 */
export function normaliseOrder(saved = [], canonical = []) {
  const known = new Set(canonical);
  const placed = new Set();
  const out = [];

  for (const id of saved) {
    // Unknown ids are retired sections; duplicates are a corrupted flag. Both
    // are dropped rather than trusted.
    if (!known.has(id) || placed.has(id)) continue;
    placed.add(id);
    out.push(id);
  }

  for (let i = 0; i < canonical.length; i++) {
    const id = canonical[i];
    if (placed.has(id)) continue;

    /**
     * Anchor to the nearest canonical predecessor the reader actually kept,
     * walking backwards. `at` stays 0 when there is none, which puts a new
     * first section first — where it was designed to be.
     */
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(canonical[j]);
      if (k >= 0) { at = k + 1; break; }
    }

    out.splice(at, 0, id);
    placed.add(id);
  }

  return out;
}

/**
 * Move one section one place.
 *
 * Not `moveInOrder` from `item-order.mjs`, which swaps with the literal
 * neighbour. Sections differ in one way that matters: some are not on the sheet
 * right now. The Actions panel renders only during combat, and out of combat a
 * swap with it would be a click that visibly did nothing — the #46 complaint,
 * which this project has now had three times. So the swap partner is the
 * nearest neighbour that is actually RENDERED, and the absent ones keep their
 * slots and reappear where they were.
 *
 * @param {string[]} order
 * @param {string} id
 * @param {"up"|"down"} direction
 * @param {string[]|null} present ids currently on the sheet; null means all are
 * @returns {string[]|null} the new order, or null for "nothing to do" — off the
 *   end, or an id that is not in the order at all. Null rather than an
 *   unchanged copy so the caller can skip the write.
 */
export function moveSection(order = [], id, direction, present = null) {
  const from = order.indexOf(id);
  if (from < 0) return null;

  const step = direction === "up" ? -1 : 1;
  const rendered = present ? new Set(present) : null;

  let to = from + step;
  while (to >= 0 && to < order.length && rendered && !rendered.has(order[to])) {
    to += step;
  }
  if (to < 0 || to >= order.length) return null;

  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Collapse or expand one section.
 *
 * @param {string[]} collapsed
 * @param {string} id
 * @param {boolean|null} force  explicit state, or null to flip
 * @returns {string[]} a new array, deduplicated
 */
export function toggleCollapsed(collapsed = [], id, force = null) {
  const set = new Set(collapsed);
  const next = force === null ? !set.has(id) : !!force;

  if (next) set.add(id);
  else set.delete(id);

  return [...set];
}

/**
 * Everything the sheet needs to draw itself, from the saved flag and the
 * sections currently on screen.
 *
 * `isFirst` / `isLast` are computed against the RENDERED sections, so the
 * arrows that would do nothing are the ones that get disabled. Disabled and
 * visible, not hidden: a control that answers a click by not moving reads as
 * broken, and the arrows inside a panel already work this way.
 *
 * @param {object} [args]
 * @param {object} [args.saved]        the stored flag for this actor
 * @param {string[]} [args.canonical]  ids the sheet ships, in designed order
 * @param {string[]|null} [args.present] ids currently rendered
 */
export function resolveLayout({ saved = null, canonical = [], present = null } = {}) {
  const flag = saved ?? DEFAULT_LAYOUT;
  const order = normaliseOrder(flag.order ?? [], canonical);
  const collapsed = new Set(flag.collapsed ?? []);

  const visible = present ? order.filter((id) => present.includes(id)) : order;
  const first = visible[0] ?? null;
  const last = visible[visible.length - 1] ?? null;

  return {
    // Anything other than an explicit `false` is locked, so a flag written by
    // an older version — or a half-written one — errs towards not moving.
    locked: flag.locked !== false,
    order,
    rows: order.map((id, index) => ({
      id,
      index,
      collapsed: collapsed.has(id),
      isFirst: id === first,
      isLast: id === last
    }))
  };
}
