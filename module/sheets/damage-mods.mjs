/**
 * Weakness, resistance and immunity as comma boxes (#53).
 *
 * These are `ArrayField`s of damage-type keys, and the damage pipeline reads
 * them off WHATEVER it is applying damage to:
 *
 *     const mods = D.effectiveDamageMods(sys.damageMods ?? {}, statuses);
 *
 * A statblock had three boxes for them from the start. A CHARACTER had none —
 * so a character's resistances and immunities were honoured by the arithmetic
 * and could not be entered anywhere. A race granting fire resistance, or an
 * accessory granting immunity to poison, had no home; the GM had to remember it
 * and adjust every roll by hand.
 *
 * Found by the first run of the Quench suite, which had been asserting this for
 * months with nobody to hear it.
 *
 * ── Shared, not copied ──────────────────────────────────────────────────────
 *
 * The NPC sheet already had the unpack and the repack, and the obvious move was
 * to paste them into the character sheet. That is exactly what #44 was about:
 * two sheets each holding their own copy of one decision, free to drift. The
 * validation in particular must not diverge — a typo'd damage type silently
 * dropped on one sheet and warned about on the other would be worse than either
 * behaviour alone.
 */

import { LASTARC } from "../config.mjs";

/** The three keys, in the order the sheets show them. */
export const DAMAGE_MOD_KEYS = Object.freeze(["weakness", "resistance", "immunity"]);

/**
 * The stored arrays as editable text.
 *
 * Read from the PREPARED system data rather than `_source`: these are authored
 * inputs that derivation never assigns, so there is no ratchet to avoid here —
 * unlike the attribute and skill boxes, which must come from `_source`.
 */
export function damageModTexts(sys) {
  const out = {};
  for (const key of DAMAGE_MOD_KEYS) {
    out[`${key}Text`] = (sys?.damageMods?.[key] ?? []).join(", ");
  }
  return out;
}

/**
 * Parse one comma box into valid keys plus whatever was not recognised.
 *
 * Pure, so the parsing and the validation are unit tested without Foundry —
 * the half most likely to be wrong is what counts as a damage type, and that
 * needs to be checkable.
 *
 * Lower-cased and trimmed, because "Fire, ICE " is what people actually type.
 *
 * @returns {{valid: string[], unknown: string[]}}
 */
export function parseDamageMods(raw) {
  if (typeof raw !== "string") return { valid: [], unknown: [] };

  const parsed = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    valid: parsed.filter((t) => LASTARC.allDamageTypes.includes(t)),
    /**
     * Reported rather than silently dropped. A misspelt type that vanishes on
     * submit reads as the box not saving, and the player retypes it forever.
     */
    unknown: parsed.filter((t) => !LASTARC.allDamageTypes.includes(t))
  };
}

/**
 * Repack the three boxes in a submit payload, warning about anything unknown.
 *
 * Mutates and returns `submit`, matching what both sheets already did.
 */
export function repackDamageMods(submit) {
  for (const key of DAMAGE_MOD_KEYS) {
    const path = `system.damageMods.${key}`;
    const raw = submit[path];
    if (typeof raw !== "string") continue;

    const { valid, unknown } = parseDamageMods(raw);
    if (unknown.length) {
      ui.notifications?.warn(
        game.i18n.format("LASTARC.Warning.UnknownDamageType", { types: unknown.join(", ") })
      );
    }
    submit[path] = valid;
  }
  return submit;
}
