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
  locked: true,
  profiles: Object.freeze([]),
  active: null
});

/**
 * Saved arrangements a reader can swap between (#93).
 *
 * "If I could make my own tabs/folders to swap between when we're in combat or
 * out of combat that would be cool." Not tabs in the end: a tab hides what is
 * not in it, and this sheet's panels are already collapsible, orderable and
 * sometimes absent. A PROFILE is a snapshot of the arrangement the reader has
 * already built — the order and what is folded away — under a name, and
 * swapping applies it. Nothing is hidden that could not already be folded, and
 * a profile saved before a panel shipped still places that panel correctly,
 * because applying one goes back through `normaliseOrder`.
 *
 * An ARRAY, for the reason `collapsed` is one and #53 is cited above: `setFlag`
 * merges objects key by key, so deleting a profile from a map would leave it
 * exactly where it was. Arrays are replaced wholesale.
 */
export const MAX_PROFILES = 8;

/** Longest name the picker can show without the select going elastic. */
export const MAX_PROFILE_NAME = 24;

/** Trim, collapse runs of whitespace, cap the length. "" means unusable. */
export function normaliseProfileName(name = "") {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PROFILE_NAME);
}

/** Case-insensitively, because "Combat" and "combat" are one profile to a reader. */
export function findProfile(profiles = [], name) {
  const wanted = normaliseProfileName(name).toLowerCase();
  if (!wanted) return null;
  return profiles.find((p) => normaliseProfileName(p?.name).toLowerCase() === wanted) ?? null;
}

/**
 * Save the current arrangement under a name.
 *
 * Overwrites a profile of the same name IN PLACE rather than appending, so
 * re-saving "Combat" after nudging a panel updates it where it sits instead of
 * adding a second row the picker cannot tell apart.
 *
 * @returns {Array|null} a new array, or null when the name is unusable or the
 *   list is full and this would be a new entry
 */
export function saveProfile(profiles = [], name, { order = [], collapsed = [] } = {}) {
  const clean = normaliseProfileName(name);
  if (!clean) return null;

  const entry = { name: clean, order: [...order], collapsed: [...collapsed] };
  const at = profiles.findIndex(
    (p) => normaliseProfileName(p?.name).toLowerCase() === clean.toLowerCase());

  if (at >= 0) {
    const next = [...profiles];
    next[at] = entry;
    return next;
  }
  if (profiles.length >= MAX_PROFILES) return null;
  return [...profiles, entry];
}

/** Drop one by name. Returns a new array, unchanged when there was no match. */
export function deleteProfile(profiles = [], name) {
  const wanted = normaliseProfileName(name).toLowerCase();
  return profiles.filter(
    (p) => normaliseProfileName(p?.name).toLowerCase() !== wanted);
}

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

  /**
   * `active` names the profile last APPLIED, and is cleared by any subsequent
   * move or collapse — the picker would otherwise claim to be showing "Combat"
   * over an arrangement the reader has since changed. An unrecognised name
   * reads as none, so deleting the active profile leaves no dangling label.
   */
  const profiles = (flag.profiles ?? []).filter((p) => normaliseProfileName(p?.name));
  // Resolved to the PROFILE'S OWN spelling, not the stored one. Names match
  // case-insensitively, so "downtime" must select the row called "Downtime" —
  // matching on the raw string leaves the picker with nothing highlighted.
  const found = findProfile(profiles, flag.active);
  const active = found ? normaliseProfileName(found.name) : null;

  return {
    // Anything other than an explicit `false` is locked, so a flag written by
    // an older version — or a half-written one — errs towards not moving.
    locked: flag.locked !== false,
    order,
    profiles: profiles.map((p) => ({
      name: normaliseProfileName(p.name),
      isActive: normaliseProfileName(p.name) === active
    })),
    active,
    // The picker is worth drawing at all only once something is in it, and the
    // Save button only once the reader is arranging.
    canSave: profiles.length < MAX_PROFILES,
    rows: order.map((id, index) => ({
      id,
      index,
      collapsed: collapsed.has(id),
      isFirst: id === first,
      isLast: id === last
    }))
  };
}
