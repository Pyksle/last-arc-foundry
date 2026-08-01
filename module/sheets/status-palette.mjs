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

/** Rows for one group of ids, marked with whether the actor currently has each. */
function paletteRows(actor, ids) {
  const active = actor.statuses ?? new Set();
  return ids.map((id) => ({
    id,
    active: active.has(id),
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
  context.statusPalette = paletteRows(actor, Object.keys(LASTARC.statusEffects));
  context.cursePalette = paletteRows(actor, Object.keys(LASTARC.curses));
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
  await sheet.document.toggleStatusEffect(id);
}
