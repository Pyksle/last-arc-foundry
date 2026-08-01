/**
 * Situational modifiers (issue #16, v0).
 *
 * Every roll pipeline in this system has accepted a `situational` modifier
 * since it was written, and NOTHING has ever supplied one — not a single
 * caller, including Block. So the arithmetic was in place and unreachable, and
 * a player with a technick granting a bonus in some circumstance had no way to
 * apply it except to do the sum in their head and not tell anybody.
 *
 * WHY THIS IS A TYPED BOX AND NOT A LIST OF THE ACTOR'S TECHNICKS.
 *
 * The conditions the book attaches bonuses to are open-ended: a state the
 * target is in, a property of the spell you just cast, what your damage did
 * relative to a defence, whether you are trained in some skill. The system
 * cannot evaluate those. It remembers what you have SPENT this turn and what is
 * WRONG with you, and nothing else — there is no record of what you did, in
 * what order, or to whom, and no event log to rebuild one from.
 *
 * So it does not guess. The player states the number and why; the system does
 * the arithmetic and shows its work. Reading the modifiers off the actor's own
 * technicks is a convenience layer on top of this, not a replacement for it,
 * and it is deliberately not in v0 — the box covers every conditional modifier
 * in the book on the day it ships, including the ones nobody has modelled.
 */
/**
 * Ask for a modifier and a reason.
 *
 * @returns {Promise<{value:number, note:string}|null>} null if dismissed, which
 *   must cancel the roll rather than roll at +0 — a dismissed dialog is "I did
 *   not mean to do that", and rolling anyway spends the moment.
 */
export async function promptSituational({ title, rangeBands = null } = {}) {
  /**
   * The range band rides in this dialog rather than getting one of its own
   * (issue #36). Every shot is at SOME range, so a dedicated prompt would tax
   * every ranged attack ever made — where the damage-type picker only appears
   * when the weapon is genuinely ambiguous. Behind the same ALT gesture that
   * already means "this roll is not the default", it costs nothing.
   *
   * The distances are shown rather than just the band names, because the whole
   * point is that the player is reading a map and the system is not.
   */
  const bandRow = rangeBands ? `
      <label>
        <span>${game.i18n.localize("LASTARC.Range.Band")}</span>
        <select name="rangeBand">
          ${rangeBands.map((b) => {
            const span = b.from === 0 ? `0–${b.to}` : `${b.from}–${b.to}`;
            const pen = b.penalty ? ` ${b.penalty}` : "";
            return `<option value="${b.key}">${game.i18n.localize(b.label)} (${span})${pen}</option>`;
          }).join("")}
        </select>
      </label>` : "";

  const content = `
    <div class="la-situational">${bandRow}
      <label>
        <span>${game.i18n.localize("LASTARC.Situational.Value")}</span>
        <input type="number" name="value" value="0"${rangeBands ? "" : " autofocus"}>
      </label>
      <label>
        <span>${game.i18n.localize("LASTARC.Situational.Note")}</span>
        <input type="text" name="note"
               placeholder="${game.i18n.localize("LASTARC.Situational.NotePlaceholder")}">
      </label>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: title ?? game.i18n.localize("LASTARC.Situational.Title") },
    content,
    ok: {
      label: game.i18n.localize("LASTARC.Situational.Roll"),
      callback: (event, button) => ({
        value: Number(button.form.elements.value.value) || 0,
        note: button.form.elements.note.value.trim(),
        rangeBand: button.form.elements.rangeBand?.value ?? null
      })
    },
    rejectClose: false
  });

  return result ?? null;
}

/**
 * Roll options for a click, prompting only when ALT is held.
 *
 * Plain clicks stay exactly as fast as they were. Putting a dialog in front of
 * every roll would be a worse tax than the problem it solves — most rolls carry
 * no situational modifier at all.
 *
 * ALT rather than SHIFT: shift-click already means "cast/perform defensively"
 * on two of these buttons, and overloading it would make the same gesture do
 * different things depending on which panel you clicked in. Not CTRL either —
 * on macOS ctrl-click is a right-click.
 *
 * Returns null when the prompt was dismissed, which callers must treat as
 * "do not roll".
 */
export async function situationalOptions(event, { title, rangeBands = null } = {}) {
  if (!event?.altKey) return {};

  const picked = await promptSituational({ title, rangeBands });
  if (!picked) return null;

  return {
    situational: picked.value,
    // Shown in place of the generic "Situational" label when given, so the card
    // records WHY the number was there and the table can check it later.
    situationalNote: picked.note || null,
    rangeBand: picked.rangeBand
  };
}

/**
 * Label for a situational part on a chat card.
 *
 * Foundry's localize returns its input unchanged when the key is unknown, so a
 * free-text note passes through and a missing note falls back to the string
 * table. Centralised because three pipelines build this part.
 */
export function situationalLabel(note) {
  return note || "LASTARC.Mod.situational";
}

/** Suffix for a check label, e.g. "Acrobatics — climbing in the rain". */
export function situationalSuffix(note, value = 0) {
  if (!note && !value) return "";
  const sign = value > 0 ? `+${value}` : `${value}`;
  return note ? ` — ${note} ${sign}` : ` — ${sign}`;
}
