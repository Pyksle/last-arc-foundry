/**
 * Casting pipeline (§18, book Chapter 8).
 *
 * ── The rule that shapes this whole file ────────────────────────────────────
 *
 *   "Spells are not attacks and are unaffected by talents, technicks, or other
 *    abilities that interact with attacks."                        — book p.140
 *
 * So NOTHING here routes through `attack.mjs`. There is no natural-20 auto-hit,
 * no natural-1 auto-miss, no Combo, no Critical, no reaction window, and none of
 * the attack technick flags apply — `tripleCrit` and `doubledExplosions` in
 * particular must never reach a spell. The overlap with attacks is exactly one
 * function, `applyDamage`, because mitigation and the Break Threshold belong to
 * the damage itself rather than to how it was caused.
 *
 * Resolution is a Spellcraft check whose RESULT selects an outcome row, rather
 * than a to-hit roll that succeeds or fails.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollDamageDice } from "./explode.mjs";
import { applyDamage } from "./attack.mjs";

/** Re-exported: it is a derived value and lives with the other derived values. */
export { knownSpellLimit } from "../derivation.mjs";

/* -------------------------------------------------------------------------- */
/*  Pure resolution                                                            */
/* -------------------------------------------------------------------------- */

/**
 * MP a casting actually costs (§18.5, p.155).
 *
 * ORDER MATTERS and is stated explicitly in the book: a High Arcana doubles the
 * cost, and only THEN is any reduction applied. Applying a reduction first
 * would make it twice as valuable on an enhanced spell.
 */
export function manaCost(baseCost, { highArcana = null, reduction = 0 } = {}) {
  const enhanced = highArcana
    ? baseCost * LASTARC.highArcanaCostMultiplier
    : baseCost;
  return Math.max(0, enhanced - reduction);
}

/**
 * The penalty for casting defensively (§18.4).
 *
 * −5 PER CREATURE threatening you, not a flat −5. Technicks may reduce it —
 * Combat Casting collapses multiple threats to a single −5.
 */
export function defensiveCastingPenalty(threatCount = 0, { combatCasting = false } = {}) {
  if (threatCount <= 0) return 0;
  return combatCasting ? -5 : -5 * threatCount;
}

/**
 * Select the outcome row a Spellcraft result achieves.
 *
 * Rows with `dc: null` always apply (the spell is opposed rather than tiered).
 * Tiered rows are the HIGHEST whose DC the check reached — "meet it, beat it"
 * (§1), so a check exactly equal to a DC does achieve that tier.
 *
 * Returns null when a tiered spell missed even its lowest DC — the book's
 * "determines the effect, IF ANY" case.
 */
export function selectOutcome(outcomes = [], checkTotal = 0) {
  if (!outcomes.length) return null;

  const untiered = outcomes.find((o) => o.dc === null || o.dc === undefined);
  if (untiered) return untiered;

  const reached = outcomes
    .filter((o) => checkTotal >= o.dc)
    .sort((a, b) => a.dc - b.dc);

  return reached.length ? reached[reached.length - 1] : null;
}

/**
 * Resolve an opposed row against a target's defence.
 *
 * `higherLevelTargetBonus` is the recurring "higher-level targets gain a +5
 * bonus to their defence against this spell" rider (§18.7). It applies only
 * when the target's level EXCEEDS the caster's; equal levels get nothing.
 *
 * @returns {{opposed:boolean, beat:boolean, defence:number|null, bonusApplied:number}}
 */
export function resolveOpposed(outcome, {
  checkTotal = 0,
  targetDefences = {},
  casterLevel = 1,
  targetLevel = 1,
  higherLevelTargetBonus = 0
} = {}) {
  const key = outcome?.opposedDefence;
  if (!key) return { opposed: false, beat: true, defence: null, bonusApplied: 0 };

  const bonusApplied = targetLevel > casterLevel ? higherLevelTargetBonus : 0;
  const defence = (targetDefences[key] ?? 0) + bonusApplied;

  return { opposed: true, beat: checkTotal >= defence, defence, bonusApplied };
}

/**
 * The damage decay schedule for a spell with `damageOverTime` (§18.7).
 *
 * Fractions are of the INITIAL damage, not of the previous tick, and each is
 * rounded down. DR is deliberately not applied here: the book says mitigation
 * touches only the initial hit.
 */
export function decayTicks(initialDamage, fractions = []) {
  return fractions.map((f, i) => ({
    turnsAhead: i + 1,
    amount: Math.floor(initialDamage * f)
  }));
}

/**
 * Does a counterattack destroy the casting? (§18.4)
 *
 * Not merely damage: a counterattack whose damage beats the caster's Break
 * Threshold makes the spell fail outright AND wastes the mana. This is the
 * mechanic most likely to be implemented as "the caster takes damage" and
 * quietly lose the rest.
 */
export function counterattackDisruptsCasting(counterDamage, breakThreshold) {
  return counterDamage > breakThreshold;
}

/* -------------------------------------------------------------------------- */
/*  Foundry-facing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cast a spell.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} [options]
 * @param {Actor} [options.target]
 * @param {number} [options.threatCount]   creatures threatening the caster
 * @param {boolean} [options.castDefensively]
 * @param {string} [options.highArcana]    id from LASTARC.highArcana
 */
export async function castSpell(actor, spell, options = {}) {
  const sys = actor.system;
  const sp = spell.system;

  if (sys.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  const arcana = options.highArcana && LASTARC.highArcana[options.highArcana]
    ? options.highArcana
    : null;

  const cost = manaCost(sp.mpCost, { highArcana: arcana, reduction: options.mpReduction ?? 0 });
  const available = sys.resources?.mp?.value ?? 0;

  if (available < cost) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.NotEnoughMana", {
        name: actor.name, cost, available
      })
    );
    return null;
  }

  /* -- the Spellcraft check ------------------------------------------------ */

  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  const skill = sys.skills?.spellcraft;
  add("LASTARC.Mod.spellcraft", skill?.total ?? 0);

  // Adamant Spell ignores Break Gauge penalties to the check. The skill total
  // already includes the penalty, so it is added back rather than re-derived.
  if (arcana === "adamant" && sys.breakGauge?.penalty) {
    add("LASTARC.Mod.adamant", -sys.breakGauge.penalty);
  }

  const defensive = options.castDefensively
    ? defensiveCastingPenalty(options.threatCount ?? 0, {
        combatCasting: hasFlag(actor, "combatCasting")
      })
    : 0;
  add("LASTARC.Mod.castDefensively", defensive);
  add("LASTARC.Mod.situational", options.situational ?? 0);

  const mod = parts.reduce((s, p) => s + p.value, 0);
  const roll = new Roll("1d20 + @mod", { mod });
  await roll.evaluate();

  /* -- outcome ------------------------------------------------------------- */

  const outcome = selectOutcome(sp.outcomes, roll.total);
  const target = options.target;

  const opposed = outcome
    ? resolveOpposed(outcome, {
        checkTotal: roll.total,
        targetDefences: {
          ref: target?.system?.defences?.ref?.value,
          fort: target?.system?.defences?.fort?.value,
          will: target?.system?.defences?.will?.value
        },
        casterLevel: sys.details?.level ?? 1,
        targetLevel: target?.system?.details?.level ?? 1,
        higherLevelTargetBonus: sp.higherLevelTargetBonus ?? 0
      })
    : { opposed: false, beat: false, defence: null, bonusApplied: 0 };

  // Mana is spent whether or not the check achieved anything — the only thing
  // that refunds it is nothing, and the only thing that wastes it *and* stops
  // the spell is a disrupting counterattack, handled by the caller before this.
  await actor.update({ "system.resources.mp.value": available - cost });

  const result = {
    roll, parts, cost, outcome, opposed,
    achieved: !!outcome,
    highArcana: arcana,
    damage: null
  };

  /* -- damage, if the row has any ----------------------------------------- */

  if (outcome?.damage && (!opposed.opposed || opposed.beat || outcome.onFail?.damageMultiplier)) {
    const dice = arcana === "intensified"
      ? doubleDiceCount(outcome.damage)
      : outcome.damage;

    // Spells are not attacks: no crit multiplier, and explosion stays at 1
    // regardless of any `doubledExplosions` the caster may have.
    const rolled = await rollDamageDice({
      diceFormula: dice, critMultiplier: 1, explosionMultiplier: 1, flat: 0
    });

    const multiplier = opposed.opposed && !opposed.beat
      ? (outcome.onFail?.damageMultiplier ?? 0)
      : 1;

    const total = Math.floor(rolled.total * multiplier);
    result.damage = { ...rolled, total, damageType: sp.damageType };

    if (target && total > 0) {
      result.applied = await applyDamage(target, { total, type: sp.damageType });
      result.decay = decayTicks(total, sp.damageOverTime ?? []);
    }
  }

  /* -- status rider -------------------------------------------------------- */

  if (outcome?.status && (!opposed.opposed || opposed.beat) && target) {
    if (!LASTARC.allStatusIds.includes(outcome.status)) {
      ui.notifications?.error(
        game.i18n.format("LASTARC.Warning.UnknownStatus", { id: outcome.status })
      );
    } else {
      await target.toggleStatusEffect?.(outcome.status, { active: true });
      result.statusApplied = outcome.status;
    }
  }

  await postSpellCard({ actor, spell, result, target });
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Intensified Spell doubles the NUMBER OF DICE, not the result. */
function doubleDiceCount(formula) {
  return String(formula).replace(/^(\d*)d(\d+)/i, (_, n, faces) =>
    `${(Number(n || 1) * 2)}d${faces}`
  );
}

function hasFlag(actor, flag) {
  return actor?.items?.some(
    (i) => (i.type === "technick" || i.type === "talent") && i.system?.flags?.includes(flag)
  ) ?? false;
}

async function postSpellCard({ actor, spell, result, target }) {
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/spell-card.hbs",
    {
      actorId: actor.id,
      spellName: spell.name,
      spellImg: spell.img,
      schoolLabel: game.i18n.localize(`LASTARC.School.${spell.system.school}`),
      total: result.roll.total,
      parts: result.parts,
      cost: result.cost,
      arcanaLabel: result.highArcana
        ? game.i18n.localize(LASTARC.highArcana[result.highArcana].label)
        : null,
      achieved: result.achieved,
      dc: result.outcome?.dc ?? null,
      opposed: result.opposed.opposed,
      beat: result.opposed.beat,
      defence: result.opposed.defence,
      bonusApplied: result.opposed.bonusApplied,
      targetName: target?.name ?? null,
      damage: result.damage,
      damageTypeLabel: result.damage
        ? game.i18n.localize(`LASTARC.DamageType.${result.damage.damageType}`)
        : null,
      decay: result.decay ?? [],
      statusLabel: result.statusApplied
        ? game.i18n.localize(`LASTARC.Status.${result.statusApplied}`)
        : null,
      notes: result.outcome?.notes || null
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [result.roll],
    flags: { "last-arc": { type: "spell", actorId: actor.id, spellId: spell.id } }
  });
}
