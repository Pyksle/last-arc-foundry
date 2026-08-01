/**
 * Which damage type an attack deals (issue #32).
 *
 * The book's weapon tables routinely print two — "Piercing or Slashing" is on
 * most polearms and several swords — because which one you use is the player's
 * call and it matters against a resistance. The schema modelled this correctly
 * from the start, as an ArrayField with the note "May list several; the wielder
 * picks at roll time".
 *
 * Nothing ever asked. `rollDamage` took `damageType[0]`, so the second entry was
 * decorative, and since the field had NO INPUT the first entry was always the
 * schema's initial value. Every weapon in every world dealt slashing, and the
 * resistances the field exists to serve could not be exercised at all.
 *
 * The choice lives here rather than at the three call sites for the same reason
 * `buildDamageTerms` owns the Agi-or-Str question: so "which type is this?" has
 * exactly one answer in the codebase, including the fallback when a weapon has
 * no type ticked.
 */

import { LASTARC } from "../config.mjs";

/**
 * Resolve the damage type without asking anybody.
 *
 * Pure, so the fallback rules are unit-testable — they are the part that will
 * be wrong quietly. Returns `{ask}` when only a human can decide.
 *
 * @param {string[]} types  the weapon's declared types
 * @param {string|null} chosen  a type already picked, e.g. by a previous prompt
 * @returns {{type:string}|{ask:string[]}}
 */
export function damageTypeChoice(types = [], chosen = null) {
  // Unknown strings are dropped rather than trusted: `choices` on the schema
  // means a bad value throws on the next prepare, and a weapon that cannot be
  // opened is a worse outcome than a weapon that deals blunt.
  const list = (types ?? []).filter((t) => LASTARC.allDamageTypes.includes(t));

  if (chosen && list.includes(chosen)) return { type: chosen };

  // No type ticked is a legitimate state — the box starts empty on a
  // hand-authored weapon — and blunt is the least surprising default: it is
  // what an improvised object does, and it is the one physical type no
  // creature in the demo resists.
  if (list.length === 0) return { type: "blunt" };
  if (list.length === 1) return { type: list[0] };

  return { ask: list };
}

/**
 * Ask which of several types is being used.
 *
 * @returns {Promise<string|null>} null if dismissed, which must cancel the roll
 *   rather than silently pick the first — silently picking the first is the bug
 *   this whole module exists to remove.
 */
export async function promptDamageType(types, { weaponName = "" } = {}) {
  const options = types
    .map((t) => `<option value="${t}">${game.i18n.localize(`LASTARC.DamageType.${t}`)}</option>`)
    .join("");

  const content = `
    <div class="la-situational">
      <p class="la-note">${game.i18n.format("LASTARC.DamageTypePrompt.Hint", { weapon: weaponName })}</p>
      <label>
        <span>${game.i18n.localize("LASTARC.Field.DamageType")}</span>
        <select name="damageType" autofocus>${options}</select>
      </label>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("LASTARC.DamageTypePrompt.Title") },
    content,
    ok: {
      label: game.i18n.localize("LASTARC.DamageTypePrompt.Roll"),
      callback: (event, button) => button.form.elements.damageType.value
    },
    rejectClose: false
  });

  return result ?? null;
}

/**
 * The whole question, prompting only when it cannot be settled from the data.
 *
 * @param {string[]} types
 * @param {object} [options]
 * @param {string|null} [options.chosen]  a type already decided
 * @param {boolean} [options.prompt]  false to take the first rather than ask —
 *   used by counterattack resolution, which loops over every attacker and would
 *   otherwise stack a dialog per attack in the middle of someone else's turn.
 * @param {string} [options.weaponName]
 * @returns {Promise<string|null>} null only when a prompt was dismissed
 */
export async function resolveDamageType(types, { chosen = null, prompt = true, weaponName = "" } = {}) {
  const decision = damageTypeChoice(types, chosen);
  if (decision.type) return decision.type;
  if (!prompt) return decision.ask[0];

  return await promptDamageType(decision.ask, { weaponName });
}
