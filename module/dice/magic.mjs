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
import { rollHealing } from "./healing.mjs";
import { describeCheck, describeDamage } from "./breakdown.mjs";
import { situationalLabel } from "./situational.mjs";
import { rollCheckD20 } from "./d20.mjs";
import { performanceEffectChanges, performanceRiders } from "../effects.mjs";
import { negatesSecondaryEffects, describeNegatedRider } from "../status-guard.mjs";
import * as CB from "../combat.mjs";

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
  if (!key) {
    return { opposed: false, beat: true, defence: null, defenceKey: null, bonusApplied: 0 };
  }

  const bonusApplied = targetLevel > casterLevel ? higherLevelTargetBonus : 0;
  const defence = (targetDefences[key] ?? 0) + bonusApplied;

  // `defence` is the NUMBER to beat and `defenceKey` names which defence it is.
  // Both are needed and they are easy to confuse: the card wants "vs Ref 15",
  // and only a spell opposing Reflex may be answered with a Block (issue #12).
  return { opposed: true, beat: checkTotal >= defence, defence, defenceKey: key, bonusApplied };
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
 * Apply a High Arcana's effect to a casting (§18.5, p.155).
 *
 * Returns the modified values plus notes for the card, rather than mutating the
 * spell — the item is the printed entry and must stay that way.
 *
 * `enlarged` cannot be computed: the printed area is free text ("a 4 square
 * cone"), so it is reported for the GM to apply rather than parsed. Saying so is
 * better than silently doing nothing, which is what all four of these did before
 * — declared, selectable, and inert.
 *
 * @returns {{range:number, extraTargets:number, durationTurns:number, notes:string[]}}
 */
export function applyHighArcana(arcanaId, {
  range = 0, durationTurns = 0, mndMod = 0, isSingleTarget = true
} = {}) {
  const out = { range, extraTargets: 0, durationTurns, notes: [] };
  const def = LASTARC.highArcana[arcanaId];
  if (!def) return out;

  if (def.rangeMultiplier) {
    out.range = range * def.rangeMultiplier;
    out.notes.push("LASTARC.HighArcana.note.distant");
  }

  if (def.areaMultiplier) {
    // Free text; the GM doubles it. Explicitly NOT extended to secondary
    // effects, per the book.
    out.notes.push("LASTARC.HighArcana.note.enlarged");
  }

  if (def.durationMultiplier) {
    // "Only affects spells with a scaling duration" — a fixed-duration spell
    // gains nothing, so a zero stays zero rather than becoming a free buff.
    if (durationTurns > 0) out.durationTurns = durationTurns * def.durationMultiplier;
    out.notes.push("LASTARC.HighArcana.note.lingering");
  }

  if (def.extraTargetsFromMnd) {
    // Single-target spells only; areas may not overlap.
    if (isSingleTarget) out.extraTargets = Math.max(1, mndMod);
    out.notes.push(isSingleTarget
      ? "LASTARC.HighArcana.note.multi"
      : "LASTARC.HighArcana.note.multiInapplicable");
  }

  return out;
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
/*  Performances (§19, book Chapter 9)                                         */
/* -------------------------------------------------------------------------- */

/**
 * The penalty for performing defensively (§19).
 *
 * NOT the flat −5 that casting uses. Instrument takes −5; Dance and Oratory take
 * −2. Both are PER threatening creature. Assuming symmetry with `castSpell`
 * would overcharge a dancer by more than double.
 */
export function defensivePerformPenalty(threatCount = 0, specialisation = "instrument") {
  if (threatCount <= 0) return 0;
  const per = LASTARC.performSpecialisations[specialisation]?.defensivePenalty ?? -5;
  return per * threatCount;
}

/**
 * Which existing performance a new one displaces (§19).
 *
 * "If a creature affected by an ally's performance becomes affected by another
 * ally's performance, they are no longer affected by the previous performance.
 * This is also the case for enemy performances, though you may be affected by
 * both an enemy and an allied performance."
 *
 * So a creature carries AT MOST ONE of each side, and a new performance
 * displaces only its own side. Modelling this as a single slot would silently
 * cancel an enemy's debuff every time an ally played, which is a large and
 * invisible buff to the party.
 *
 * @param {Array<{id:string, fromAlly:boolean}>} active
 * @param {boolean} incomingFromAlly
 * @returns {string[]} ids of performances the newcomer replaces
 */
export function performancesDisplacedBy(active = [], incomingFromAlly = true) {
  return active
    .filter((p) => p.fromAlly === incomingFromAlly)
    .map((p) => p.id);
}

/**
 * Perform.
 *
 * Shares `selectOutcome` with casting — the tier tables are the same shape —
 * but differs in three ways that matter and are easy to assume away:
 *
 *   1. NO MANA. Chapter 9 never mentions MP and no performance name carries the
 *      parenthetical cost every spell name has.
 *   2. The defensive penalty depends on the SPECIALISATION, not a flat −5.
 *   3. A disrupting counterattack makes the performance fail, but there is no
 *      mana to waste — the book says only that it fails.
 */
export async function performItem(actor, performance, options = {}) {
  const sys = actor.system;
  const perf = performance.system;

  if (sys.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  /**
   * NO MANA IS SPENT HERE, and that is deliberate — see the note on the
   * performance schema. Chapter 9 never mentions mana, and no performance name
   * carries the parenthetical cost every spell name has. An earlier pass
   * removed `mpCost` from the model for exactly that reason.
   *
   * Recorded as a comment because the symmetry with `castSpell` is so
   * inviting that it has now been "fixed" once by mistake: on playtest day I
   * read the sheets' leftover affordability check, concluded the pipeline had
   * forgotten to charge, and added a gate and a deduction. The schema comment
   * next door is what caught it.
   */

  // Performing in a threatened area provokes; a counterattack beating the
  // performer's Break Threshold makes it fail (§19).
  if (options.combatant && !options.performDefensively) {
    const counter = await CB.resolveCounterattacks(options.combatant, "performance", {
      castDefensively: false
    });
    if (counter.provoked && counterattackDisruptsCasting(
      counter.totalDamage, sys.breakGauge?.threshold ?? Infinity
    )) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content:
          `<div class="lastarc-card lastarc-card--spell lastarc-card--disrupted">` +
          `<p class="lastarc-verdict lastarc-verdict--bad">` +
          `${game.i18n.format("LASTARC.Card.PerformanceDisrupted", { name: performance.name })}` +
          `</p></div>`
      });
      return {
        disrupted: true, counter, roll: null, outcome: null,
        achieved: false, landed: false
      };
    }
  }

  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  /**
   * Each Perform specialisation is its own skill (issue #35). This used to hunt
   * a free-text subskill by lowercased name and fall back to the parent Perform
   * total when it missed — so a player who typed "Instruments" or "Lute" got the
   * untrained parent silently, and there was no way to tell from the card.
   */
  const skillKey = LASTARC.performSkillFor[perf.specialisation];
  // Shape-aware, for the same reason as the Spellcraft read above.
  add("LASTARC.Mod.perform", D.skillTotalOf(sys.skills, skillKey));

  const defensive = options.performDefensively
    ? defensivePerformPenalty(options.threatCount ?? 0, perf.specialisation)
    : 0;
  add("LASTARC.Mod.performDefensively", defensive);
  add(situationalLabel(options.situationalNote), options.situational ?? 0);

  const mod = parts.reduce((sum, p) => sum + p.value, 0);
  const { roll } = await rollCheckD20(actor, mod);

  const outcome = selectOutcome(perf.outcomes, roll.total);
  const target = options.target;

  /* -- the enfeebling gate ------------------------------------------------- */

  // Enfeebling tiers read "should your check beat an enemy's Will Defence,
  // they suffer...". Reusing resolveOpposed keeps the meet-it-beat-it rule in
  // one place; an enhancing tier leaves opposedDefence blank and passes.
  const opposed = outcome
    ? resolveOpposed(outcome, {
        checkTotal: roll.total,
        targetDefences: {
          ref: target?.system?.defences?.ref?.value,
          fort: target?.system?.defences?.fort?.value,
          will: target?.system?.defences?.will?.value
        }
      })
    : { opposed: false, beat: false, defence: null, defenceKey: null };

  const landed = !!outcome && (!opposed.opposed || opposed.beat);
  const result = { roll, parts, outcome, opposed, achieved: !!outcome, landed };

  /* -- what the tier actually does ----------------------------------------- */

  if (landed && target) {
    /**
     * Chapter 9's direct damage is always unaspected, which bypasses DR — so
     * when it is applied it goes through applyDamage rather than being
     * subtracted by hand.
     *
     * It is NOT applied here. A performance used to land its damage the moment
     * it resolved, with no way to hold it back for a ruling or a resisted
     * effect, while a weapon hit posted a button and waited (issue #19). The
     * card carries the button now, and the two paths agree.
     */
    if (outcome.damage) {
      const rolled = await rollDamageDice({
        diceFormula: outcome.damage, critMultiplier: 1, explosionMultiplier: 1, flat: 0
      });
      result.damage = { ...rolled, damageType: "unaspected" };
    }

    /**
     * Mana loss. THE DIE EXPLODES — Chapter 9 says so outright, and it is the
     * only resource drain in the system that does. Rolling it flat would
     * quietly cap the worst case at the die's face value.
     */
    if (outcome.mpDamage) {
      const rolled = await rollDamageDice({
        diceFormula: outcome.mpDamage,
        critMultiplier: 1,
        explosionMultiplier: LASTARC.performanceMpLossExplodes ? 1 : 0,
        flat: 0
      });
      const before = target.system.resources?.mp?.value ?? 0;
      const after = Math.max(0, before - rolled.total);
      await target.update({ "system.resources.mp.value": after });
      result.mpDamage = { ...rolled, before, after, lost: before - after };
    }

    if (outcome.status && LASTARC.allStatusIds.includes(outcome.status)) {
      /**
       * A performance's damage is unaspected, so only a creature resistant or
       * immune to unaspected shrugs off its rider — and only when the tier
       * carries damage at all. A tier with no damage formula has no aspect for
       * anything to be resistant TO, so its rider always lands (§5.5).
       */
      const { negated, reason } = negatesSecondaryEffects(
        target, outcome.damage ? "unaspected" : null
      );
      if (negated) {
        result.statusNegated = { status: outcome.status, reason, damageType: "unaspected" };
      } else {
        await target.toggleStatusEffect?.(outcome.status, { active: true });
        result.statusApplied = outcome.status;
      }
    }
  }

  const scopeLabel = (table, key) =>
    key ? game.i18n.localize(table[key]?.label ?? key) : null;

  /**
   * What of this tier can become a standing Active Effect, and what cannot
   * (issue #20). Resolved once, here, so the card and the flags agree — the
   * button offers exactly what the flags carry.
   */
  const effectChanges = performanceEffectChanges(outcome ?? {});

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/performance-card.hbs",
    {
      name: performance.name,
      img: performance.img,
      kindLabel: game.i18n.localize(LASTARC.performanceKinds[perf.kind]?.label ?? ""),
      specLabel: game.i18n.localize(
        LASTARC.performSpecialisations[perf.specialisation]?.label ?? ""
      ),
      total: roll.total,
      natural: roll.dice[0]?.results?.[0]?.result ?? 0,
      parts,
      breakdown: describeCheck(roll, parts),
      achieved: !!outcome,
      landed,
      dc: outcome?.dc ?? null,
      opposed: opposed.opposed,
      beat: opposed.beat,
      defence: opposed.defence,
      defenceLabel: opposed.defenceKey
        ? game.i18n.localize(`LASTARC.Defence.${opposed.defenceKey}`)
        : null,
      targetName: target?.name ?? null,
      effect: outcome?.effect || null,
      // A bonus with no scope is unreadable, so the two travel together.
      /**
       * ISSUE #29. The card used to render this through a string that
       * hardcoded "to all weapon skills" and then printed the chosen scope
       * beside it, so a Spellcraft-scoped bonus announced itself as a weapon
       * bonus and contradicted its own label. Worse, it never said the bonus
       * was to the CHECK — and "Bonus damage" sits directly beneath it on the
       * same card, which is how it came to be applied to damage rolls.
       *
       * Pre-signed, because "gain 2" reads as a total rather than a modifier.
       */
      skillBonus: outcome?.skillBonus ? D.signed(outcome.skillBonus) : null,
      bonusScopeLabel: scopeLabel(LASTARC.performanceBonusScopes, outcome?.bonusScope),
      bonusDamage: outcome?.bonusDamage || null,
      bonusDamageScopeLabel:
        scopeLabel(LASTARC.performanceDamageScopes, outcome?.bonusDamageScope),
      penalty: outcome?.penalty || null,
      penaltyScopeLabel: scopeLabel(LASTARC.performancePenaltyScopes, outcome?.penaltyScope),
      damage: result.damage ?? null,
      damageBreakdown: result.damage ? describeDamage(result.damage) : null,
      mpDamage: result.mpDamage ?? null,
      statusLabel: result.statusApplied
        ? game.i18n.localize(`LASTARC.Status.${result.statusApplied}`)
        : null,
      // The rider the target's resistance or immunity stopped (#57). Said out
      // loud, because a condition that silently fails to appear looks exactly
      // like a condition the system forgot.
      statusNegatedLabel: describeNegatedRider(result.statusNegated),
      effectTagLabel: perf.effectTag
        ? game.i18n.localize(LASTARC.performanceEffectTags[perf.effectTag]?.label ?? "")
        : null,
      notes: outcome?.notes || null,
      special: perf.special || null,
      substitutesDefence: perf.substitutesDefence
        ? game.i18n.localize(`LASTARC.Defence.${perf.substitutesDefence}`)
        : null,

      /**
       * Whether this tier has anything a standing effect could carry, and what
       * it could not (issue #20). Computed here rather than in the template
       * because the answer depends on the SCOPE, not on whether a number is
       * present: a +2 to Reflex-against-spells is a real bonus with no path to
       * live on, and the card has to offer the button for one and an
       * explanation for the other.
       */
      canApplyEffect: landed && effectChanges.changes.length > 0,
      unappliableRiders: effectChanges.skipped.map((s) => ({
        label: game.i18n.localize(
          LASTARC.performanceBonusScopes[s.scope]?.label
          ?? LASTARC.performanceDamageScopes[s.scope]?.label
          ?? LASTARC.performancePenaltyScopes[s.scope]?.label
          ?? s.scope
        ),
        reason: game.i18n.localize(s.reason)
      }))
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    /**
     * The CHANGES travel on the card, not the outcome index.
     *
     * Rebuilding them at apply time would mean reading the performance item
     * again, and the item can be edited — or deleted — between the roll and the
     * click. The card is the record of what was performed, so it carries what
     * was actually granted. Same reasoning as the attack card's wield flags.
     */
    flags: {
      "last-arc": {
        type: "performance",
        actorId: actor.id,
        performanceId: performance.id,
        performanceName: performance.name,
        performanceImg: performance.img,
        effectRiders: performanceRiders(outcome ?? {})
      }
    }
  });

  return result;
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

  /* -- provoked counterattacks, BEFORE the spell resolves (§18.4) ---------- */

  // Casting in a threatened area provokes unless cast defensively. This is not
  // merely damage to the caster: a counterattack whose damage beats the
  // caster's Break Threshold makes the spell FAIL OUTRIGHT and wastes the MP.
  // Resolved before the check, because a disrupted casting never gets to roll.
  if (options.combatant && !options.castDefensively) {
    const counter = await CB.resolveCounterattacks(options.combatant, "castSpell", {
      castDefensively: false
    });

    if (counter.provoked && counterattackDisruptsCasting(
      counter.totalDamage, sys.breakGauge?.threshold ?? Infinity
    )) {
      // Mana is spent even though nothing happens — that is the rule, and it is
      // the entire cost of casting in melee without casting defensively.
      await actor.update({ "system.resources.mp.value": available - cost });
      await postDisruptedCard({ actor, spell, cost, counter });
      return {
        disrupted: true, counter, cost,
        roll: null, outcome: null, achieved: false
      };
    }
  }

  /* -- the Spellcraft check ------------------------------------------------ */

  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  /**
   * Shape-aware (CLAUDE.md §10). A character keys skills by name with a
   * derived `total`; a statblock keeps a flat printed `{key, value}` array. The
   * character path read `sys.skills.spellcraft.total`, which on an NPC is
   * `undefined` and became 0 — so every monster cast at Spellcraft +0.
   *
   * Nobody hit it because the NPC sheet had no way to cast at all (#49), which
   * is the only reason this was not a live bug. `skillTotalOf` was written for
   * exactly this and had not been applied here.
   */
  add("LASTARC.Mod.spellcraft", D.skillTotalOf(sys.skills, "spellcraft"));

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
  add(situationalLabel(options.situationalNote), options.situational ?? 0);

  const mod = parts.reduce((s, p) => s + p.value, 0);
  const { roll } = await rollCheckD20(actor, mod);

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

  const arcanaEffect = arcana
    ? applyHighArcana(arcana, {
        range: sp.range,
        durationTurns: outcome?.durationTurns ?? 0,
        mndMod: sys.attributes?.mnd?.mod ?? 0,
        isSingleTarget: !sp.isArea
      })
    : null;

  const result = {
    roll, parts, cost, outcome, opposed,
    achieved: !!outcome,
    highArcana: arcana,
    arcanaEffect,
    damage: null
  };

  /* -- damage, if the row has any ----------------------------------------- */

  if (outcome?.damage && (!opposed.opposed || opposed.beat || outcome.onFail?.damageMultiplier)) {
    const dice = arcana === "intensified"
      ? doubleDiceCount(outcome.damage)
      : outcome.damage;

    /**
     * Spells are not attacks, so there is no crit multiplier here. Explosions
     * are a different question, and the answer used to be a hardcoded 1 with a
     * comment asserting spells never double. That was wrong (issue #42).
     *
     * Two sources, deliberately separate:
     *
     *   - the SPELL itself always doubles — a fixed property of a handful of
     *     the book's spells, needing no switch;
     *   - the CASTER carries `doubledSpellExplosions`, which is how the
     *     conditional equipment sources are modelled. It is a different flag
     *     from the weapon technicks' `doubledExplosions` precisely so that a
     *     melee doubling technick cannot leak onto a fireball.
     *
     * They do not stack. The book doubles; nothing in it doubles twice, and
     * inventing a ×4 because two sources happened to overlap would be a
     * house rule the system imposed rather than the table chose.
     */
    const doubles = !!sp.doubledExplosions || hasFlag(actor, "doubledSpellExplosions");

    const rolled = await rollDamageDice({
      diceFormula: dice, critMultiplier: 1, explosionMultiplier: doubles ? 2 : 1, flat: 0
    });

    const multiplier = opposed.opposed && !opposed.beat
      ? (outcome.onFail?.damageMultiplier ?? 0)
      : 1;

    const total = Math.floor(rolled.total * multiplier);
    result.damage = { ...rolled, total, damageType: sp.damageType };

    // Rolled, shown, and left for the Apply button on the card — see the note
    // on the performance path above (issue #19). The decay schedule is a
    // property of the damage rolled, not of anyone having taken it yet.
    if (total > 0) result.decay = decayTicks(total, sp.damageOverTime ?? []);
  }

  /* -- healing, if the row has any ---------------------------------------- */

  // `outcomes[].healing` had been an editable field on every spell sheet with
  // no reader anywhere: a cure spell rolled its check, announced a tier and
  // healed nobody (issue #11). Resolved against the target where there is one
  // and the caster otherwise, which is how a self-heal is cast in practice.
  if (outcome?.healing && (!opposed.opposed || opposed.beat)) {
    const recipient = target ?? actor;
    result.healing = await rollHealing(recipient, {
      formula: outcome.healing,
      sourceName: spell.name,
      sourceImg: spell.img,
      healer: actor
    });
  }

  /* -- status rider -------------------------------------------------------- */

  if (outcome?.status && (!opposed.opposed || opposed.beat) && target) {
    if (!LASTARC.allStatusIds.includes(outcome.status)) {
      ui.notifications?.error(
        game.i18n.format("LASTARC.Warning.UnknownStatus", { id: outcome.status })
      );
    } else {
      /**
       * A creature resistant to the spell's aspect is unaffected by the
       * secondary effects of that damage, and an immune one takes no effects
       * from the source at all (§5.5, p.169 — see `negatesSecondaryEffects`).
       *
       * This clause had been computed and never read since §5.5 was written:
       * `applyDamageMitigation` returns `secondaryEffectsNegated`, two unit
       * tests assert it, and nothing anywhere consumed it. So a fire-immune
       * creature took 0 fire damage and was blinded by the same spell, which is
       * what #57 reported.
       */
      const { negated, reason } = negatesSecondaryEffects(
        target, sp.damageType, { dealsDamage: !!outcome.damage }
      );
      if (negated) {
        result.statusNegated = { status: outcome.status, reason, damageType: sp.damageType };
      } else {
        await target.toggleStatusEffect?.(outcome.status, { active: true });
        result.statusApplied = outcome.status;
      }
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
    (i) => (i.type === "technick" || i.type === "talent")
      // See the copy in attack.mjs: a technick switched off on the sheet
      // contributes no flags.
      && i.system?.active !== false
      && i.system?.flags?.includes(flag)
  ) ?? false;
}

async function postDisruptedCard({ actor, spell, cost, counter }) {
  const lines = counter.attacks
    .filter((a) => a.hit)
    .map((a) => `${a.attacker} (${a.damage})`)
    .join(", ");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<div class="lastarc-card lastarc-card--spell lastarc-card--disrupted">` +
      `<p class="lastarc-verdict lastarc-verdict--bad">` +
      `${game.i18n.format("LASTARC.Card.SpellDisrupted", { spell: spell.name, cost })}</p>` +
      (lines ? `<p class="lastarc-note">${lines}</p>` : "") +
      `</div>`,
    flags: { "last-arc": { type: "spellDisrupted", actorId: actor.id } }
  });
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
      natural: result.roll.dice[0]?.results?.[0]?.result ?? 0,
      parts: result.parts,
      // "What was rolled and the modifiers included" (issue #11), as one line
      // on the total. The per-chip tooltips name each modifier but never say
      // what the die showed, so the sum could not be checked from the card.
      breakdown: describeCheck(result.roll, result.parts),
      // The spell's own text. Its absence was reported directly: casting
      // announced a tier and a number with no statement of what the spell
      // actually does, so the caster had to open the item to read their own
      // spell mid-turn.
      description: await foundry.applications.ux.TextEditor
        .implementation.enrichHTML(spell.system.description ?? "", { relativeTo: spell }),
      cost: result.cost,
      arcanaLabel: result.highArcana
        ? game.i18n.localize(LASTARC.highArcana[result.highArcana].label)
        : null,
      arcanaNotes: (result.arcanaEffect?.notes ?? []).map((k) => game.i18n.localize(k)),
      achieved: result.achieved,
      dc: result.outcome?.dc ?? null,
      opposed: result.opposed.opposed,
      beat: result.opposed.beat,
      defence: result.opposed.defence,
      defenceLabel: result.opposed.defenceKey
        ? game.i18n.localize(`LASTARC.Defence.${result.opposed.defenceKey}`)
        : null,
      bonusApplied: result.opposed.bonusApplied,
      targetName: target?.name ?? null,
      damage: result.damage,
      // The damage sum, spelled out. "When rolling damage the damage
      // calculation does not display" (issue #11) — the card showed a total
      // and a row of dice with no statement of how one became the other.
      damageBreakdown: result.damage ? describeDamage(result.damage) : null,
      damageTypeLabel: result.damage
        ? game.i18n.localize(`LASTARC.DamageType.${result.damage.damageType}`)
        : null,
      healing: result.healing ?? null,
      decay: result.decay ?? [],
      statusLabel: result.statusApplied
        ? game.i18n.localize(`LASTARC.Status.${result.statusApplied}`)
        : null,
      // The rider the target's resistance or immunity stopped (#57). Said out
      // loud, because a condition that silently fails to appear looks exactly
      // like a condition the system forgot.
      statusNegatedLabel: describeNegatedRider(result.statusNegated),
      notes: result.outcome?.notes || null
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [result.roll],
    flags: {
      "last-arc": {
        type: "spell",
        actorId: actor.id,
        spellId: spell.id,
        // A spell that opposes Reflex may be blocked with a shield, area
        // effects included (book p.109, issue #12). One that opposes Fortitude
        // or Will may not, so the defence travels with the card rather than
        // being assumed.
        targetId: target?.id ?? null,
        targetsDefence: result.opposed.defenceKey,
        attackerName: actor.name,
        attackTotal: result.roll.total
      }
    }
  });
}
