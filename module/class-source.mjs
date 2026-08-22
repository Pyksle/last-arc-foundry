/**
 * Where a class's numbers come from.
 *
 * They used to come from `LASTARC.classes` and nowhere else, so the only
 * classes a character could take were the six the system ships. That was fine
 * while six was the whole list. It is not fine now: the full release adds
 * dozens of advanced classes, they belong to a book that is not ours to
 * redistribute, and a GM may reasonably want to homebrew one. So a class is a
 * DOCUMENT the GM authors — exactly like a spell, a technick or a weapon — and
 * the shipped table is the fallback for the six that were already there.
 *
 * Resolution order, first match wins:
 *
 *   1. a `class` item on the actor
 *   2. a `class` item in the world
 *   3. `LASTARC.classes`
 *
 * That order is what makes this backward compatible. Every character in every
 * existing world stores `{name: "warrior"}`, which still resolves through step
 * 3 untouched; a GM who authors a class item slugged `warrior` overrides it for
 * their table without the system having an opinion about it.
 *
 * Foundry-free on purpose. The callers hand in plain objects, so the whole
 * resolution order is unit tested rather than discovered in a live world.
 */

import { LASTARC } from "./config.mjs";

/** What every consumer downstream reads. Both input shapes normalise to this. */
function canonical({
  label = "", hpFirst = 0, hpPer = 0, mpFirst = 0, mpPer = 0,
  initDie = "d10", ref = 0, fort = 0, will = 0,
  trainedSkills = 0, isAdvanced = false
} = {}) {
  return Object.freeze({
    label, hpFirst, hpPer, mpFirst, mpPer, initDie,
    defences: Object.freeze({ ref, fort, will }),
    trainedSkills, isAdvanced
  });
}

/**
 * A join key from a name, for a class item whose author left `slug` blank.
 *
 * Deliberately lossy in the same way everywhere: lowercase, non-alphanumerics
 * to single hyphens, ends trimmed. "Blade Dancer" and "blade dancer" must not
 * be two different classes.
 */
export function classSlug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Normalise one entry of the shipped table.
 *
 * `trainedSkills: null` means "not read in from the book yet" and is left as
 * null rather than coerced to 0 — `trainedSkillCount` throws on it deliberately
 * (issue #34), because a silent 0 produces a plausible-but-wrong build.
 */
export function normaliseShippedClass(raw = {}) {
  return canonical({
    label: raw.label,
    hpFirst: raw.hp1, hpPer: raw.hpPer,
    mpFirst: raw.mp1, mpPer: raw.mpPer,
    initDie: raw.initDie,
    ref: raw.ref, fort: raw.fort, will: raw.will,
    trainedSkills: raw.trainedSkills,
    isAdvanced: false
  });
}

/**
 * Normalise a `class` ITEM.
 *
 * Takes the item's own `name` as the label, because a GM-authored class has no
 * `LASTARC.*` key to localise and never will — the label is whatever they typed.
 */
export function normaliseClassItem(item = {}) {
  const sys = item.system ?? {};
  return canonical({
    label: item.name,
    hpFirst: sys.hp?.first, hpPer: sys.hp?.perLevel,
    mpFirst: sys.mp?.first, mpPer: sys.mp?.perLevel,
    initDie: sys.initiativeDie,
    ref: sys.defences?.ref, fort: sys.defences?.fort, will: sys.defences?.will,
    trainedSkills: sys.trainedSkills,
    isAdvanced: !!sys.isAdvanced
  });
}

/**
 * Build the lookup a character resolves its class list against.
 *
 * `owned` beats `world` beats `shipped`, and within each source the FIRST entry
 * for a slug wins — so a duplicate authored by accident cannot silently change
 * a character's hit points depending on document ordering.
 */
export function buildClassCatalogue({ owned = [], world = [], shipped = LASTARC.classes } = {}) {
  const out = new Map();

  for (const [key, raw] of Object.entries(shipped ?? {})) {
    out.set(key, normaliseShippedClass(raw));
  }
  // Items override the shipped table, so they are applied after it — and world
  // before owned, so the actor's own copy is the last word.
  for (const group of [world, owned]) {
    for (const item of group ?? []) {
      if (item?.type && item.type !== "class") continue;
      const slug = classSlug(item?.system?.slug || item?.name || "");
      if (!slug) continue;
      out.set(slug, normaliseClassItem(item));
    }
  }

  return out;
}

/** The stat block for one class entry, or null if nothing in the world defines it. */
export function resolveClass(name, catalogue) {
  if (!name) return null;
  const map = catalogue ?? buildClassCatalogue();
  return map.get(name) ?? map.get(classSlug(name)) ?? null;
}

/**
 * Every class a character may pick, for the sheet's dropdown.
 *
 * Advanced classes are marked rather than hidden or separated. A GM whose party
 * is nowhere near level 8 still wants to see the list, and the prerequisite is
 * on the character, not on the option.
 */
export function classOptions(catalogue) {
  const map = catalogue ?? buildClassCatalogue();
  return [...map.entries()]
    .map(([value, cls]) => ({ value, label: cls.label, isAdvanced: cls.isAdvanced }))
    .sort((a, b) => Number(a.isAdvanced) - Number(b.isAdvanced) || a.value.localeCompare(b.value));
}
