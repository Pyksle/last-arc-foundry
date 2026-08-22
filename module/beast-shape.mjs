/**
 * Beast Shape — the Druid's forms.
 *
 * Every other advanced-class mechanic is a number that goes in a box. This one
 * replaces the character's stat block with a creature's, merges both resource
 * pools, and charges a price on the way back out. The maths is small; the
 * damage a mistake does is not, because the revert cost is the one rule at this
 * table that can take a player character to 0 hit points as a matter of
 * bookkeeping rather than of combat.
 *
 * So all of it lives here, Foundry-free and unit tested, and the sheet does
 * nothing but call these and report what they said.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not touch the beast's own actor unless that actor is a token's
 * unlinked copy. A form normally points at the GM's bestiary entry, which is
 * ONE document shared by every token of that creature (see CLAUDE.md §7) — so
 * writing the druid's level bonus onto it would hand the same bonus to every
 * wolf in the encounter, silently, including the ones trying to eat the party.
 * The bonus is stated on the card instead, and applied for real only where it
 * cannot leak.
 */

/**
 * How many forms a druid may hold at once: 1 + Int modifier.
 *
 * Floored at one. A druid with Int 8 still learned Beast Shape, and a talent
 * that lets you know zero of the thing it teaches is not a reading anybody
 * would defend.
 */
export function formAllowance(intMod = 0) {
  return Math.max(1, 1 + intMod);
}

/** Transforming costs twice the beast's level in MP. */
export function transformCost(beastLevel = 0) {
  return 2 * Math.max(0, Math.floor(beastLevel));
}

/**
 * +1 to defences, skills and damage per level the druid exceeds the beast.
 *
 * Never negative: taking a form stronger than you is allowed — it is only
 * harder to learn — and the book grants a bonus for the gap rather than
 * imposing a penalty for it.
 */
export function levelBonus(druidLevel = 0, beastLevel = 0) {
  return Math.max(0, Math.floor(druidLevel) - Math.floor(beastLevel));
}

/**
 * The form lasts 5 + Vit modifier turns.
 *
 * Floored at one turn, for the same reason as the allowance: a Vit penalty deep
 * enough to zero this out would make the ability cost MP to do nothing at all.
 */
export function formDuration(vitMod = 0) {
  return Math.max(1, 5 + vitMod);
}

/**
 * Everything transforming does to the druid's own numbers.
 *
 * The MP cost comes out of the druid's OWN pool before the beast's is added.
 * The other order lets a druid with 0 MP become anything at all by spending the
 * mana of the creature they have not become yet, which is not a loan any table
 * would allow.
 *
 * Both pools gain the beast's MAXIMUM, not its current: a form is a shape you
 * take, not a creature you summon, so it arrives whole. That is also what makes
 * the revert cost the exact inverse of this when nothing hurt you in between —
 * which is the property that tells you the two halves agree.
 */
export function transformResult({
  hp = 0, mp = 0, hpMax = 0, mpMax = 0,
  beastMaxHp = 0, beastMaxMp = 0, beastLevel = 0,
  druidLevel = 0, vitMod = 0
} = {}) {
  const cost = transformCost(beastLevel);
  const affordable = mp >= cost;

  return {
    cost,
    affordable,
    bonus: levelBonus(druidLevel, beastLevel),
    duration: formDuration(vitMod),
    hp: hp + beastMaxHp,
    mp: mp - cost + beastMaxMp,
    hpMax: hpMax + beastMaxHp,
    mpMax: mpMax + beastMaxMp
  };
}

/**
 * Everything reverting costs.
 *
 * The druid loses the beast's MAXIMUM from each pool, whatever the pool holds
 * by then — so a form that took a beating comes off the druid's own hit points.
 * That is the rule, and it is the reason this function exists rather than a
 * subtraction at the call site.
 *
 * Reaching 0 this way does NOT kill: the book says unconscious, explicitly, and
 * this is the only place in the system where 0 HP arrives as arithmetic rather
 * than as damage. A caller that treated it like a killing blow would end a
 * character on a bookkeeping step.
 */
export function revertResult({ hp = 0, mp = 0, beastMaxHp = 0, beastMaxMp = 0 } = {}) {
  const rawHp = hp - beastMaxHp;
  return {
    lostHp: beastMaxHp,
    lostMp: beastMaxMp,
    hp: Math.max(0, rawHp),
    mp: Math.max(0, mp - beastMaxMp),
    unconscious: rawHp <= 0
  };
}

/**
 * Which combat round the form drops on.
 *
 * Rounds, not a per-turn countdown. The duration is in the druid's turns and a
 * druid takes one per round, so the expiry is knowable the moment they
 * transform — no hook, nothing to fire on every combatant's turn, and nothing
 * to go wrong when a turn is skipped or the encounter is rebuilt. Foundry's
 * turn hooks are `callAll` and fire before the document updates (CLAUDE.md §6);
 * a countdown riding on them is a race this does not need to enter.
 *
 * Returns null outside combat, where "5 turns" is a thing the table tracks and
 * a round number would be a fiction.
 */
export function expiryRound(currentRound = null, duration = 0) {
  if (!currentRound) return null;
  return currentRound + Math.max(1, duration) - 1;
}

/**
 * Is this form still the one in play?
 *
 * A form is identified by the actor it points at. Comparing names would break
 * the moment two beasts share one, and comparing indices breaks as soon as a
 * form is removed from the middle of the list.
 */
export function isActiveForm(active = {}, uuid = "") {
  return !!uuid && active?.uuid === uuid;
}

/**
 * Read a beast actor's numbers, so the form entry can be refreshed on use.
 *
 * A form caches the beast's level and maxima because the actor can be deleted,
 * renamed or unavailable when the card is drawn — but a cache that never
 * refreshes is a cache that is wrong by the third session. Called at transform
 * time, so staleness heals itself the next time it matters.
 *
 * Takes the plain system object rather than the document, to stay Foundry-free.
 */
export function readBeast(system = {}) {
  return {
    level: system?.details?.level ?? 0,
    maxHp: system?.resources?.hp?.max ?? 0,
    maxMp: system?.resources?.mp?.max ?? 0,
    will: system?.defences?.will?.value ?? system?.defences?.will?.base ?? 10
  };
}
