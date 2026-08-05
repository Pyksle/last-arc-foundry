/**
 * Whether a status actually lands on a creature (#57, #58).
 *
 * Two reports, one question. The book gives two independent reasons a condition
 * that "should" be applied is not:
 *
 *   §5.5 (p.169) — a creature RESISTANT to a damage type is "unaffected by the
 *     secondary effects of any damage they are resistant to", and one IMMUNE
 *     suffers "no damage OR EFFECTS" from that source. So a fire spell that
 *     blinds does not blind a fire-immune creature, however the damage lands.
 *   Statblocks — a creature simply immune to a CONDITION. Undead do not sleep;
 *     an ooze cannot be tripped. Nothing to do with damage types at all.
 *
 * ── Why this module exists rather than three checks at three call sites ──────
 *
 * The first rule was already computed. `applyDamageMitigation` has returned
 * `secondaryEffectsNegated` since §5.5 was implemented, `test/derivation.test.mjs`
 * asserted it in two places, and NOTHING IN THE SYSTEM EVER READ IT. Every
 * status rider landed on every target regardless — which is exactly the orphan
 * pattern CLAUDE.md names as this project's most common defect, and exactly what
 * #57 reported: resistance visibly halving the number while the condition it is
 * supposed to prevent went on anyway.
 *
 * A value with one producer and no consumer is indistinguishable from a value
 * with one producer and three consumers that each got it slightly wrong. So the
 * decision lives in one place with one name, and the call sites ask it.
 *
 * The rules are Foundry-free — every one takes plain data or a duck-typed actor
 * (`{statuses, system}`), so they are unit tested without a licensed server —
 * and the create-time enforcement sits at the bottom, the same split
 * `effects.mjs` uses.
 */

import { LASTARC } from "./config.mjs";
import * as D from "./derivation.mjs";

/**
 * Why a status was refused. Carried onto the chat card, because "nothing
 * happened" and "nothing happened BECAUSE it is immune to fire" are the same
 * picture at the table and only one of them is the system working.
 */
export const NEGATED_BY = Object.freeze({
  immunity: "immunity",
  resistance: "resistance"
});

/* -------------------------------------------------------------------------- */
/*  #57 — the secondary-effects clause                                         */
/* -------------------------------------------------------------------------- */

/**
 * Does this creature's resistance or immunity cancel a rider carried by an
 * effect of this aspect?
 *
 * ── The book draws a distinction here and it is load-bearing ────────────────
 *
 * Immunity is written against the SOURCE: "suffer no damage OR EFFECTS from
 * sources to which they are immune". Resistance is written against the DAMAGE:
 * "unaffected by the secondary effects of ANY DAMAGE they are resistant to".
 *
 * So they part company on exactly one case — an aspected effect that deals no
 * damage, which is most of the interesting conditions in the game. A dark
 * spell that only puts a creature to sleep IS a dark source, so a dark-immune
 * creature ignores it; but there is no dark damage for a dark-RESISTANT
 * creature to be unaffected by the secondary effects of, so it sleeps. That
 * asymmetry is the difference between the two grades, and flattening it would
 * quietly make resistance as good as immunity against every non-damaging
 * rider in the book.
 *
 * `dealsDamage` is about the ABILITY, not the roll: whether this outcome has a
 * damage formula at all. Keying it on the rolled total would mean a fire spell
 * that happened to come up 0 blinds the fire-resistant creature it just failed
 * to burn.
 *
 * The mods are resolved through `effectiveDamageMods` rather than read off the
 * actor, so Agony (which strips resistances and immunities outright, §12) is
 * honoured here exactly as it is in the damage pipeline. Reading
 * `system.damageMods` directly would give a creature in Agony its immunities
 * back for the purpose of shrugging off conditions — the one moment the rules
 * say it should be at its most vulnerable.
 *
 * @param {{statuses?: Iterable<string>, system?: object}} target  duck-typed actor
 * @param {string|null} damageType  the aspect of the attack, spell or ability
 * @param {boolean} [dealsDamage]  does this outcome carry damage of that aspect?
 * @returns {{negated: boolean, reason: string|null}}
 */
export function negatesSecondaryEffects(target, damageType, { dealsDamage = true } = {}) {
  // An ability with no aspect has nothing to be resistant TO. Not an error:
  // plenty of conditions are applied by effects that are not damage at all.
  if (!damageType || !LASTARC.allDamageTypes.includes(damageType)) {
    return { negated: false, reason: null };
  }

  const statuses = D.aggregateStatuses([...(target?.statuses ?? [])]);
  const mods = D.effectiveDamageMods(target?.system?.damageMods ?? {}, statuses);

  // Immunity is checked first because a creature marked both should read as
  // immune — the stronger claim, and the one that also zeroes the damage.
  if ((mods.immunity ?? []).includes(damageType)) {
    return { negated: true, reason: NEGATED_BY.immunity };
  }
  if (dealsDamage && (mods.resistance ?? []).includes(damageType)) {
    return { negated: true, reason: NEGATED_BY.resistance };
  }
  return { negated: false, reason: null };
}

/* -------------------------------------------------------------------------- */
/*  #58 — immunity to a condition                                              */
/* -------------------------------------------------------------------------- */

/**
 * The creature's condition immunities, filtered to ids that still exist.
 *
 * VALIDATED HERE RATHER THAN ON THE SCHEMA, deliberately. A `choices` list on
 * the StringField would throw on any value the list later drops, and a document
 * holding a rejected value DOES NOT OPEN (CLAUDE.md, on retired technick flags).
 * A statblock marked immune to a status that is renamed in a future release
 * would become unopenable — a far worse failure than one immunity quietly
 * ceasing to apply. `magic.mjs` and the palette already take this approach for
 * the same reason.
 */
export function readStatusImmunities(system) {
  return (system?.statusImmunities ?? []).filter((id) => LASTARC.allStatusIds.includes(id));
}

/**
 * The list with one id switched on or off, for the alt+click toggle.
 *
 * Returns a NEW array rather than mutating: this feeds straight into
 * `actor.update`, and Foundry compares against the stored array to decide
 * whether anything changed.
 */
export function toggleStatusImmunity(immunities = [], id) {
  if (!LASTARC.allStatusIds.includes(id)) return [...immunities];
  const set = new Set(immunities);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  // Config order, not click order, so the stored array is stable and two GMs
  // marking the same three immunities produce the same document.
  return LASTARC.allStatusIds.filter((s) => set.has(s));
}

/**
 * Split the statuses an incoming effect carries into those that land and those
 * the creature is immune to.
 *
 * An effect may carry SEVERAL statuses, and refusing the whole document because
 * one of them is blocked would be a second bug wearing the first one's clothes:
 * a two-condition attack against a creature immune to one of them should still
 * apply the other.
 */
export function splitByImmunity(ids = [], immunities = []) {
  const immune = new Set(immunities);
  const allowed = [];
  const blocked = [];
  for (const id of ids) (immune.has(id) ? blocked : allowed).push(id);
  return { allowed, blocked };
}

/* -------------------------------------------------------------------------- */
/*  Foundry-facing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The card's line for a rider that did not land, or null when one did.
 *
 * A condition that silently fails to appear is indistinguishable from a
 * condition the system forgot to apply — which is the state #57 was reported
 * from, and the reason this is stated rather than merely obeyed. The line names
 * BOTH halves: which grade stopped it and which aspect, because "immune" alone
 * leaves the GM checking the wrong column of the statblock.
 *
 * Explicit keys rather than one assembled from `reason`: keys built at runtime
 * are only checked against the config lists they are built from, and this pair
 * is not one of those lists.
 */
const NEGATION_KEYS = Object.freeze({
  [NEGATED_BY.immunity]: "LASTARC.Card.RiderNegatedImmunity",
  [NEGATED_BY.resistance]: "LASTARC.Card.RiderNegatedResistance"
});

export function describeNegatedRider(negated) {
  const key = NEGATION_KEYS[negated?.reason];
  if (!key) return null;
  return game.i18n.format(key, {
    status: game.i18n.localize(`LASTARC.Status.${negated.status}`),
    type: game.i18n.localize(`LASTARC.DamageType.${negated.damageType}`)
  });
}

/**
 * Refuse a condition the creature is immune to, wherever it came from.
 *
 * ONE CHOKE POINT, ON PURPOSE. Statuses reach an actor from the token HUD, from
 * `toggleStatusEffect`, from the sheet palette, from spell and consumable
 * riders, from dropping to 0 HP, and from any macro or module a table has
 * installed. Guarding the six call sites this system happens to own would mean
 * the GM marks a creature immune to sleep and then watches the token HUD put it
 * to sleep — an immunity that holds only against the paths we remembered is
 * worse than none, because it is trusted.
 *
 * `preCreateActiveEffect` is below all of them: every one of those routes ends
 * in creating an ActiveEffect on the actor.
 *
 * A REFUSAL, not a warning — unlike `warnUnsupportedTargets`, which cannot know
 * whether a strange path is a mistake. This is the GM's own explicit statement
 * about this creature, entered by hand on this sheet, and the whole point is
 * that it is enforced. The escape hatch is the same gesture that set it:
 * alt+click the tile again.
 *
 * @returns {boolean} false to cancel creation, the `preCreate*` convention.
 */
export function guardStatusImmunity(effect) {
  const actor = effect?.parent;
  // Effects also live on Items, which have no immunities and no `system.statusImmunities`.
  if (!actor || actor.documentName !== "Actor") return true;

  const ids = [...(effect.statuses ?? [])];
  if (!ids.length) return true;

  const immunities = readStatusImmunities(actor.system);
  if (!immunities.length) return true;

  const { allowed, blocked } = splitByImmunity(ids, immunities);
  if (!blocked.length) return true;

  // Silence here would read as the click not registering, which is how the GM
  // ends up clicking four more times — the exact failure #47 was about.
  ui.notifications?.info(game.i18n.format("LASTARC.StatusImmunity.Refused", {
    name: actor.name,
    statuses: blocked.map((id) => game.i18n.localize(`LASTARC.Status.${id}`)).join(", ")
  }));

  /**
   * An effect carrying SEVERAL statuses keeps the ones that land. A two-
   * condition attack against a creature immune to one of them should still
   * apply the other; vetoing the document would be a second bug wearing the
   * first one's clothes.
   */
  if (allowed.length) {
    effect.updateSource({ statuses: allowed });
    return true;
  }
  return false;
}
