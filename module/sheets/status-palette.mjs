/**
 * Status palette shared by the character and NPC sheets (issue #17).
 *
 * The statuses themselves were never the problem: they are registered in
 * `CONFIG.statusEffects`, their payloads are wired into derivation, and the
 * whole set is covered by tests. What was missing was any way to APPLY one
 * without a token on a scene — reported as "status effects are not available
 * to be placed on characters".
 *
 * Everything here goes through `Actor#toggleStatusEffect`, which is the same
 * call the token HUD makes. Deliberately so: a second mechanism for putting a
 * status on an actor would be a second thing to keep in step with derivation,
 * and the point of the exercise is that there is exactly one.
 */
import { LASTARC } from "../config.mjs";

/**
 * How many effects on this actor carry each status id.
 *
 * `Actor#statuses` is a Set, so it answers "is this on?" and cannot answer "is
 * this on TWICE?". Counting from the effects themselves is what makes the
 * duplicates in #47 visible instead of collapsing them into a single `true`.
 *
 * Reading `effects` also catches an effect whose status never reached the Set —
 * the Set is rebuilt from ACTIVE effects on every prepare, so a suppressed or
 * malformed one draws an icon on the token while the palette believes the
 * status is off. That gap is what let the GM re-apply and re-apply.
 */
function statusCounts(actor) {
  const counts = new Map();
  for (const effect of actor?.effects ?? []) {
    for (const id of effect.statuses ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  // Belt and braces: anything Foundry considers applied is on, even if we
  // somehow failed to see the effect carrying it.
  for (const id of actor?.statuses ?? []) {
    if (!counts.has(id)) counts.set(id, 1);
  }
  return counts;
}

/** Rows for one group of ids, marked with whether the actor currently has each. */
function paletteRows(actor, ids, counts) {
  return ids.map((id) => ({
    id,
    active: (counts.get(id) ?? 0) > 0,
    // Surfaced so a token that has silently accumulated three copies of the
    // same status says so, rather than looking identical to one copy. `count`
    // is only set when it is worth showing — a bare 1 on every active status
    // would be noise on 33 buttons.
    count: (counts.get(id) ?? 0) > 1 ? counts.get(id) : null,
    label: game.i18n.localize(`LASTARC.Status.${id}`),
    // Read off CONFIG rather than rebuilt from the id, so the palette cannot
    // drift from the icons the token HUD shows for the same status.
    img: CONFIG.statusEffects.find((s) => s.id === id)?.img ?? ""
  }));
}

/**
 * Stamp `statusPalette` and `cursePalette` onto a sheet context.
 *
 * Curses are separated because they carry a different stacking rule — distinct
 * curses stack, duplicates do not — and one undifferentiated grid of 33 icons
 * communicated none of that.
 */
export function markStatuses(context, actor) {
  const counts = statusCounts(actor);
  context.statusPalette = paletteRows(actor, Object.keys(LASTARC.statusEffects), counts);
  context.cursePalette = paletteRows(actor, Object.keys(LASTARC.curses), counts);

  /**
   * An unlinked token's actor is a DIFFERENT DOCUMENT (CLAUDE.md §7), and NPCs
   * are unlinked by default in this system. So a GM who opens a monster from
   * the Actors sidebar is looking at the template, not at the creature on the
   * board: its palette shows none of the statuses on the token, and toggling
   * one here changes nothing the players can see.
   *
   * That is a reasonable design, but it is invisible, and it produces exactly
   * the report on #47 — icons on the token, nothing lit on the sheet. Say so
   * rather than letting the GM conclude the palette is broken.
   */
  context.statusesAreTemplate = !!(
    actor?.isToken === false && actor?.prototypeToken?.actorLink === false
  );
  return context;
}

/**
 * Toggle the clicked status on the sheet's actor.
 *
 * Checked against the registered ids before the call: Foundry throws "Invalid
 * status id" for anything it does not know, and a typo in the markup would
 * surface as an exception in the console rather than as a button that visibly
 * does nothing.
 */
export async function toggleStatus(sheet, target) {
  const id = target.dataset.status;
  if (!LASTARC.allStatusIds.includes(id)) {
    console.warn(`Last Arc | "${id}" is not a registered status id; nothing toggled.`);
    return;
  }

  const actor = sheet.document;

  /**
   * Turning a status OFF deletes every effect carrying it, not just the one
   * Foundry would match (#47).
   *
   * `toggleStatusEffect` turns a status off by finding the effect whose status
   * set is exactly `{id}`. Anything that does not match that shape survives —
   * and then still draws an icon on the token. The GM reported a token wearing
   * three statuses the sheet insisted were off, and clicking to "reapply" made
   * it worse, because applying is unconditional while removing is choosy.
   *
   * Deleting everything that carries the id makes one click clear the pile,
   * including duplicates already accumulated before this fix, and makes the
   * button's meaning honest: after clicking it off, the status is off.
   */
  const carrying = (actor.effects ?? []).filter((e) => e.statuses?.has?.(id));
  if (carrying.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", carrying.map((e) => e.id));
    return;
  }

  await actor.toggleStatusEffect(id, { active: true });
}
