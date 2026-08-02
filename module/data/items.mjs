/**
 * Item data models (§11).
 *
 * `system.json` declares seventeen Item subtypes. Without TypeDataModels they
 * are schemaless — Foundry accepts them, but nothing validates, nothing has
 * defaults, and every consumer has to defend against undefined. These give each
 * type a real shape.
 *
 * Where the spec details a schema (weapon, armour, technick, …) it is followed
 * closely. Where the demo has no content yet (advanced classes, aeons) the
 * schema is deliberately OPEN rather than absent, so the full release does not
 * force a migration (§14).
 */

import { LASTARC } from "../config.mjs";

const fields = foundry.data.fields;

/* -------------------------------------------------------------------------- */
/*  Shared field groups                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Present on every item.
 *
 * `slug` is a stable machine identifier, distinct from the display name. Code
 * that needs to find a specific technick ("heroic", "shake-it-off") keys off
 * this, so renaming or localising an item cannot silently break a rule.
 */
function commonFields() {
  return {
    description: new fields.HTMLField({ initial: "" }),
    slug: new fields.StringField({ initial: "", blank: true }),
    source: new fields.StringField({ initial: "" })
  };
}

/** Present on anything that can sit in an inventory and has weight and a price. */
function physicalFields({ bulk = 1 } = {}) {
  return {
    cost: new fields.NumberField({ initial: 0, min: 0 }),
    bulk: new fields.NumberField({ initial: bulk, min: 0 }),
    quantity: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
    equipped: new fields.BooleanField({ initial: false }),
    availability: new fields.StringField({
      initial: "common", choices: Object.keys(LASTARC.availability)
    }),
    /**
     * Everything in this system has a Break Gauge (§6), objects included. The
     * penalty applies to different things per item class: armour DR, weapon
     * damage, tool skill checks, vehicle Pilot checks.
     */
    breakGauge: new fields.SchemaField({
      step: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 5 }),
      persistentSteps: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 5 })
    }),
    /** Free-text plus structured flags — see the note on weapon features below. */
    features: new fields.ArrayField(new fields.StringField(), { initial: [] })
  };
}

/** Base class carrying the Break Gauge derivation every physical item shares. */
class PhysicalItemData extends foundry.abstract.TypeDataModel {
  prepareDerivedData() {
    const penalties = LASTARC.breakPenalties;
    const step = Math.min(5, Math.max(0, this.breakGauge?.step ?? 0));
    this.breakGauge.penalty = penalties[step] ?? penalties[4];
    this.breakGauge.destroyed = step >= 5;
    this.totalBulk = (this.bulk ?? 0) * (this.quantity ?? 1);
  }
}

/* -------------------------------------------------------------------------- */
/*  Weapon                                                                     */
/* -------------------------------------------------------------------------- */

export class LastArcWeaponData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 1 }),

      category: new fields.StringField({
        initial: "swords", choices: LASTARC.weaponCategories
      }),
      /**
       * ABSOLUTE size. The wield category (light / 1-handed / 2-handed /
       * unusable) is derived against the wielder's size at use time and is
       * deliberately NOT stored here — the same weapon is a different thing in
       * a Small character's hands than a Large one's (§5.4).
       */
      size: new fields.StringField({
        initial: "medium", choices: Object.keys(LASTARC.sizes)
      }),

      atkBonus: new fields.NumberField({ initial: 0, integer: true }),
      damage: new fields.StringField({ initial: "1d6" }),
      damageBonus: new fields.NumberField({ initial: 0, integer: true }),
      /** May list several; the wielder picks at roll time. */
      damageType: new fields.ArrayField(
        new fields.StringField({ choices: LASTARC.allDamageTypes }),
        { initial: ["slashing"] }
      ),

      reach: new fields.NumberField({ initial: 1, min: 0 }),
      range: new fields.SchemaField({
        short: new fields.NumberField({ initial: null, nullable: true, min: 0 }),
        medium: new fields.NumberField({ initial: null, nullable: true, min: 0 }),
        long: new fields.NumberField({ initial: null, nullable: true, min: 0 })
      }),
      /** Ammunition capacity before a reload is needed; null = not applicable. */
      capacity: new fields.NumberField({ initial: null, nullable: true, integer: true, min: 0 }),

      smithingDC: new fields.NumberField({ initial: 15, integer: true }),
      smithingComponents: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      /**
       * Structured behavioural flags, alongside the free-text `features`.
       *
       * Weapon features are numerous and idiosyncratic — parry bonuses, block
       * penalties imposed, element substitution against resistant targets,
       * Break Gauge effects on a natural 1, size reinterpretation for Small and
       * Medium wielders. Several legendary weapons simply replicate a technick.
       * Modelling them as an enum would be wrong; this is a flag array feeding
       * the documented hook surface (§11).
       */
      flags: new fields.ArrayField(new fields.StringField(), { initial: [] })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // A broken weapon deals less damage, floored at 1 (§6).
    this.damagePenalty = this.breakGauge.penalty;
    this.isRanged = LASTARC.rangedWeaponCategories.has(this.category);
  }
}

/* -------------------------------------------------------------------------- */
/*  Armour & shields                                                           */
/* -------------------------------------------------------------------------- */

export class LastArcArmourData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 2 }),

      type: new fields.StringField({
        initial: "light", choices: Object.keys(LASTARC.armourTypes)
      }),
      refBonus: new fields.NumberField({ initial: 0, integer: true }),
      dr: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      /**
       * Hard cap on the Agility contribution to Reflex. `null` means uncapped;
       * the derivation converts that to Infinity. Never leave it undefined —
       * `Math.min(agiMod, undefined)` is NaN and poisons Reflex silently.
       */
      maxAgiBonus: new fields.NumberField({ initial: null, nullable: true, integer: true }),
      /**
       * POSITIVE magnitude (§4.5 rev2). §4.5 subtracts this; storing it negative
       * would grant a bonus for wearing armour you are not proficient with.
       */
      checkPenalty: new fields.NumberField({ initial: 0, integer: true, min: 0 })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // Break penalty applies to DR for armour, floored at 0 (§6).
    this.effectiveDr = Math.max(0, this.dr + this.breakGauge.penalty);
    // Heavy armour treats the wearer as encumbered (§11).
    this.encumbers = this.type === "heavy";
    this.durabilityClass = LASTARC.armourDurabilityClass[this.type] ?? "medium";
  }
}

export class LastArcShieldData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 1 }),

      size: new fields.StringField({
        initial: "medium", choices: Object.keys(LASTARC.shieldDamage)
      }),
      refBonus: new fields.NumberField({ initial: 0, integer: true }),
      /** Bonus on the opposed roll made to Block — Block is NOT a flat AC bonus (§11). */
      blockBonus: new fields.NumberField({ initial: 0, integer: true })
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.bashDamage = LASTARC.shieldDamage[this.size] ?? "1d6";
  }
}

/* -------------------------------------------------------------------------- */
/*  Technick & talent                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The mechanical payload of a technick or talent.
 *
 * Everything expressible as a number goes here so the actor can aggregate it
 * automatically rather than the player hand-entering totals into the sheet's
 * `technicks` fields. Anything NOT expressible as a number goes in `flags` or an
 * Active Effect — §11 is explicit that technick logic must not be hardcoded.
 */
function grantsSchema() {
  return new fields.SchemaField({
    defences: new fields.SchemaField({
      ref: new fields.NumberField({ initial: 0, integer: true }),
      fort: new fields.NumberField({ initial: 0, integer: true }),
      will: new fields.NumberField({ initial: 0, integer: true })
    }),
    breakThreshold: new fields.NumberField({ initial: 0, integer: true }),
    heroPoints: new fields.NumberField({ initial: 0, integer: true }),
    /** Improved Initiative: steps the die DOWN the ladder, since lowest acts first. */
    initiativeSteps: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    speed: new fields.NumberField({ initial: 0, integer: true }),
    secondWindUses: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    /**
     * Flat additions to the maxima and to damage reduction.
     *
     * Absent until an accessory needed to grant hit points and there was
     * nowhere to put it. `dr` is here for the same reason: once armour DR is
     * derived rather than typed, a technick or trinket granting reduction has
     * no other home.
     */
    hp: new fields.NumberField({ initial: 0, integer: true }),
    mp: new fields.NumberField({ initial: 0, integer: true }),
    dr: new fields.NumberField({ initial: 0, integer: true }),
    /** Shake it Off reduces the Recovery action from three minors to two. */
    recoveryMinorActions: new fields.NumberField({
      initial: null, nullable: true, integer: true, min: 1
    }),
    /**
     * Rerolls this item grants (#48).
     *
     * The GM asked for "two checkboxes for mechanical effects inside of the
     * technicks" — reroll keeping the new die, and reroll keeping the better
     * one. Both semantics already existed in `resolveReroll` and were read by
     * nothing but the hero point.
     *
     * Generated from `LASTARC.grantableRerollKinds` so a kind cannot be
     * grantable in the schema and absent from the sheet's checkboxes, or the
     * reverse — the defect that shipped two unreachable `choices` arrays.
     *
     * `skill` scopes the grant. The GM's examples are a class talent and a
     * racial trait that both reroll ONE named skill, so a trait that rerolls
     * anything is the exception rather than the rule — blank means any roll.
     *
     * There is deliberately no uses-per-rest field. The GM's ruling is that
     * these are limited to one reroll per attempted check, which the chat card
     * already enforces by retiring the button once a roll has been rerolled by
     * ANY method. A per-rest counter would be a second limit with no rule
     * behind it, which is what issue #46 was about.
     */
    reroll: new fields.SchemaField({
      ...Object.fromEntries(LASTARC.grantableRerollKinds.map((kind) => [
        kind, new fields.BooleanField({ initial: false })
      ])),
      skill: new fields.StringField({
        initial: "", blank: true, choices: ["", ...Object.keys(LASTARC.allSkills)]
      })
    }),
    skills: new fields.ArrayField(
      new fields.SchemaField({
        key: new fields.StringField({ initial: "" }),
        focus: new fields.NumberField({ initial: 0, integer: true }),
        bonus: new fields.NumberField({ initial: 0, integer: true }),
        trained: new fields.BooleanField({ initial: false })
      }),
      { initial: [] }
    )
  });
}

export class LastArcTechnickData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),

      kind: new fields.StringField({ initial: "technick", choices: LASTARC.technickKinds }),

      prerequisites: new fields.SchemaField({
        attributes: new fields.ObjectField({ initial: {} }),   // { str: 13, agi: 15 }
        characterLevel: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        classLevel: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        technicks: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        talents: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        trainedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),

      /**
       * Whether this technick is currently in effect.
       *
       * Flags are unconditional once set, and most of the book's are not:
       * Backstab doubles explosions only when you are actually backstabbing,
       * not on every javelin throw for the rest of the session. The system
       * cannot tell — that is the whole of issue #16 — so rather than guess it
       * gives the player a switch and gets out of the way.
       *
       * Gates the technick's GRANTS as well as its flags, because a switch
       * labelled "active" that leaves half the payload running would be a
       * worse lie than no switch. Defaults true so nothing changes for the
       * unconditional ones.
       */
      active: new fields.BooleanField({ initial: true }),

      repeatable: new fields.BooleanField({ initial: false }),
      /** Talents only: the class tree this belongs to. */
      tree: new fields.StringField({ initial: "", blank: true, nullable: true }),
      /** Class-slot technicks are restricted to a class's bonus list. */
      classRestricted: new fields.BooleanField({ initial: false }),
      classes: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      grants: grantsSchema(),
      flags: new fields.ArrayField(
        // The superset, not the picker list — see LASTARC.retiredTechnickFlags.
        new fields.StringField({ choices: LASTARC.allTechnickFlags }), { initial: [] }
      )
    };
  }

  prepareDerivedData() {
    this.isTalent = this.kind === "talent";
    // A technick with no numeric payload is behavioural — it works through
    // `flags` and Active Effects rather than arithmetic. Surfaced so the sheet
    // can label it instead of showing a row of zeroes.
    const g = this.grants;
    this.hasNumericGrants = !!(
      g.defences.ref || g.defences.fort || g.defences.will ||
      g.breakThreshold || g.heroPoints || g.initiativeSteps || g.speed ||
      g.secondWindUses || g.recoveryMinorActions !== null || g.skills.length
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Spells & performances                                                      */
/* -------------------------------------------------------------------------- */

export class LastArcSpellData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),

      school: new fields.StringField({ initial: "black", choices: LASTARC.spellSchools }),
      mpCost: new fields.NumberField({ initial: 1, integer: true, min: 0 }),

      /** Primary / Secondary / All-out. Maps onto the §9 action slots. */
      castingTime: new fields.StringField({
        initial: "primary", choices: Object.keys(LASTARC.castingTimes)
      }),

      /** Printed target line, free text — "One creature within 12 squares and line of sight". */
      target: new fields.StringField({ initial: "", blank: true }),
      range: new fields.NumberField({ initial: 6, min: 0 }),
      area: new fields.StringField({ initial: "", blank: true }),
      duration: new fields.StringField({ initial: "", blank: true }),
      isArea: new fields.BooleanField({ initial: false }),

      damageType: new fields.StringField({
        initial: "unaspected", choices: LASTARC.allDamageTypes
      }),

      /**
       * This spell's damage dice always double their explosions (issue #42).
       *
       * A property of the SPELL, not of the caster, and unconditional — the
       * book has spells that simply do this whenever they deal damage. They
       * need no on/off switch, unlike the wielder-held `doubledSpellExplosions`
       * technick flag, whose sources are all conditional.
       *
       * Spell damage used to hardcode a multiplier of 1 with a comment saying
       * spells never double. That was wrong, and wrong in the direction that
       * quietly costs the player dice they were owed.
       */
      doubledExplosions: new fields.BooleanField({ initial: false }),

      /**
       * The outcome table (§18.6).
       *
       * This replaces a flat `spellcraftDC` + `damage` + `damageScaling` +
       * `secondaryDefence` + `secondaryStatus`, which could not express what
       * the book actually prints. Real entries take two shapes and COMBINE
       * them:
       *
       *   1. Opposed — "Should your check beat the target's Fort Defence, the
       *      target becomes silenced." One row, `dc: null`, `opposedDefence`
       *      set.
       *   2. Tiered — "The result of the check determines the effect": rows at
       *      DC 15/20/25/30/35/40, each printed as a DELTA on the row above.
       *
       * and a tier may itself branch on an opposed check, giving a reduced
       * effect rather than none:
       *
       *   "DC 20: Should your check beat a target's Fort Defence, the target
       *    takes 2d6 dark damage and suffers −10 Break Threshold. Otherwise,
       *    targets take half damage and only suffer −5."
       *
       * Rows are stored ABSOLUTE, not as deltas: the book writes "As DC 20,
       * except 3d6" for brevity in print, but storing deltas would mean every
       * consumer has to resolve the chain before it can show a row.
       */
      outcomes: new fields.ArrayField(
        new fields.SchemaField({
          /** null = not tiered; the row applies whenever the spell is cast. */
          dc: new fields.NumberField({ initial: null, integer: true, nullable: true }),
          /** Defence the check is compared against, if this row is opposed. */
          opposedDefence: new fields.StringField({
            initial: "", blank: true, choices: ["", ...LASTARC.opposableDefences]
          }),
          damage: new fields.StringField({ initial: "", blank: true }),
          status: new fields.StringField({ initial: "", blank: true }),
          healing: new fields.StringField({ initial: "", blank: true }),
          /** Break Threshold modifier imposed on the target, e.g. −10. */
          thresholdMod: new fields.NumberField({ initial: 0, integer: true }),
          /** Turns, where the book gives a scaling duration. */
          durationTurns: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          /** What happens when an opposed row FAILS — usually a halved effect. */
          onFail: new fields.SchemaField({
            damageMultiplier: new fields.NumberField({ initial: 0, min: 0 }),
            thresholdMod: new fields.NumberField({ initial: 0, integer: true })
          }),
          notes: new fields.StringField({ initial: "", blank: true })
        }),
        { initial: [] }
      ),

      /**
       * Recurring riders (§18.7), modelled once here rather than per spell.
       */
      /** "Higher-level targets gain a +5 bonus to their defence against this spell." */
      higherLevelTargetBonus: new fields.NumberField({ initial: 0, integer: true }),
      /** Decay ticks as fractions of the initial damage, e.g. [0.5, 0.25]. */
      damageOverTime: new fields.ArrayField(new fields.NumberField({ min: 0 }), { initial: [] }),
      /** DR applies ONLY to the initial hit, never to decay ticks. */
      drAppliesToInitialOnly: new fields.BooleanField({ initial: true }),

      special: new fields.StringField({ initial: "", blank: true })
    };
  }
}

export class LastArcPerformanceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),

      /**
       * NO MP COST. Chapter 9 never mentions mana and no performance name
       * carries the parenthetical cost every spell name has. The previous
       * schema had `mpCost` by assuming symmetry with casting; it does not hold.
       */

      /**
       * Perform is sub-skilled, and the specialisation is MECHANICAL rather
       * than flavour: it sets the defensive-performing penalty (−5 for
       * Instrument, −2 for Dance and Oratory).
       */
      specialisation: new fields.StringField({
        initial: "instrument", choices: Object.keys(LASTARC.performSpecialisations)
      }),

      /** Enhancing performances target allies; enfeebling ones target enemies. */
      kind: new fields.StringField({
        initial: "enhancing", choices: Object.keys(LASTARC.performanceKinds)
      }),

      /**
       * DC tiers. Tiered like a spell's, but NOT the same shape — see
       * LASTARC.performanceBonusScopes for why (issue #13).
       *
       * The comment here used to read "same tiered shape as spells", and that
       * was the whole bug: the array existed, `performItem` read it, and the
       * item sheet had no editor for it, so every performance in every world
       * had zero rows and resolved to nothing. Worse, the obvious fix — point
       * the spell editor at it — would have offered boxes for opposed damage
       * multipliers and threshold modifiers that Chapter 9 never uses, and no
       * box for the scope, which is the half that matters.
       */
      outcomes: new fields.ArrayField(
        new fields.SchemaField({
          /** Blank means the row always applies. */
          dc: new fields.NumberField({ initial: null, integer: true, nullable: true }),

          /**
           * Enfeebling tiers are gated on beating a defence — in the printed
           * chapter always Will, but stored generally rather than assumed.
           * Blank means the tier applies unconditionally, which is how every
           * enhancing tier reads.
           */
          opposedDefence: new fields.StringField({
            initial: "", blank: true, choices: ["", ...LASTARC.opposableDefences]
          }),

          effect: new fields.StringField({ initial: "", blank: true }),

          /** +N, and the category it applies to. A bonus with no scope is unreadable. */
          skillBonus: new fields.NumberField({ initial: 0, integer: true }),
          bonusScope: new fields.StringField({
            initial: "", blank: true,
            choices: ["", ...Object.keys(LASTARC.performanceBonusScopes)]
          }),

          /** Extra damage on the target's own successful attacks, melee or ranged. */
          bonusDamage: new fields.StringField({ initial: "", blank: true }),
          bonusDamageScope: new fields.StringField({
            initial: "", blank: true,
            choices: ["", ...Object.keys(LASTARC.performanceDamageScopes)]
          }),

          /** Damage the performance itself deals. Always unaspected in Chapter 9. */
          damage: new fields.StringField({ initial: "", blank: true }),

          /** Mana stripped from the target. This die EXPLODES — see config. */
          mpDamage: new fields.StringField({ initial: "", blank: true }),

          /**
           * Flat penalty, stored as a POSITIVE magnitude like §4.5's armour
           * check penalty. Storing it negative would make a hostile tier a
           * bonus the first time someone typed what the book prints.
           */
          penalty: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          penaltyScope: new fields.StringField({
            initial: "", blank: true,
            choices: ["", ...Object.keys(LASTARC.performancePenaltyScopes)]
          }),

          status: new fields.StringField({ initial: "", blank: true }),
          notes: new fields.StringField({ initial: "", blank: true })
        }),
        { initial: [] }
      ),

      /**
       * "This is a mind effect" / "a fear effect", printed as a trailing line
       * on the enfeebling entries. A tag for adjudication, not a rule — nothing
       * here consumes it.
       */
      effectTag: new fields.StringField({
        initial: "", blank: true,
        choices: ["", ...Object.keys(LASTARC.performanceEffectTags)]
      }),

      /**
       * Some performances let allies SUBSTITUTE the performer's Perform check
       * for one of their own defences until the performer's next turn — a shape
       * nothing else in the system has.
       */
      substitutesDefence: new fields.StringField({
        initial: "", blank: true, choices: ["", ...LASTARC.opposableDefences]
      }),

      duration: new fields.StringField({ initial: "", blank: true }),
      area: new fields.StringField({ initial: "", blank: true }),
      special: new fields.StringField({ initial: "", blank: true })
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Race & class                                                               */
/* -------------------------------------------------------------------------- */

export class LastArcRaceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),
      /** Applied AFTER attribute generation (§2). */
      attributeMods: new fields.ObjectField({ initial: {} }),   // { str: 2, chr: -2 }
      /** Per-attribute caps, 18–22 by species (§2). */
      attributeCaps: new fields.ObjectField({ initial: {} }),
      size: new fields.StringField({ initial: "medium", choices: Object.keys(LASTARC.sizes) }),
      speed: new fields.NumberField({ initial: 6, integer: true, min: 0 }),
      senses: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      languages: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      /**
       * `traits` USED TO BE HERE — an array of `{name, description}` rows.
       *
       * Removed rather than given an editor. Nothing read it, nothing rendered
       * it and nothing could enter it: dead at all three ends since the model
       * was written. The race's own `description` already carries the prose,
       * and the two traits that are MECHANICAL are the two fields below, which
       * derivation actually consumes.
       *
       * The rule this follows: a field with no reader does not need an input,
       * it needs deleting. Building the editor would have manufactured a place
       * for a GM to type something that could never take effect.
       */
      /** Humans get a bonus starting technick; half-elves get +1 trained skill (§4.5, §11). */
      bonusTechnicks: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      bonusTrainedSkills: new fields.NumberField({ initial: 0, integer: true, min: 0 })
    };
  }
}

export class LastArcClassData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),

      hp: new fields.SchemaField({
        first: new fields.NumberField({ initial: 24, integer: true }),
        perLevel: new fields.NumberField({ initial: 5, integer: true })
      }),
      mp: new fields.SchemaField({
        first: new fields.NumberField({ initial: 6, integer: true }),
        perLevel: new fields.NumberField({ initial: 2, integer: true })
      }),
      initiativeDie: new fields.StringField({ initial: "d10" }),
      defences: new fields.SchemaField({
        ref: new fields.NumberField({ initial: 0, integer: true }),
        fort: new fields.NumberField({ initial: 0, integer: true }),
        will: new fields.NumberField({ initial: 0, integer: true })
      }),
      trainedSkills: new fields.NumberField({ initial: 4, integer: true, min: 0 }),
      /** Slugs of the technicks this class may take in its class-technick slots. */
      bonusTechnickList: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      talentTrees: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      /**
       * Advanced classes layer OVER a base class (§14, Ch.12). The demo gives
       * names only, but the field exists now so the full release is a content
       * drop rather than a schema migration.
       */
      isAdvanced: new fields.BooleanField({ initial: false }),
      baseClasses: new fields.ArrayField(new fields.StringField(), { initial: [] })
    };
  }
}

/**
 * A single named benefit granted by a race or a class.
 *
 * Issue #8: the Race & Class panel used to create `race` and `class` items,
 * which was the wrong shape twice over. Those carry a WHOLE species or class —
 * attribute modifiers, size, speed, HP and MP progression, initiative die — and
 * they duplicated the race field and class dropdown already in the sheet
 * header. What a player actually writes down is one line from the book:
 * "Fleet of Foot: +2 Acrobatics".
 *
 * So this is deliberately thin. A name, a description, where it came from, and
 * the same `grants` block technicks use — which is what lets a feature give a
 * skill or defence modifier without any new derivation code.
 *
 * Nothing here is inferred. The numbers are typed in from your own copy of the
 * book, exactly like every other item in this system.
 */
export class LastArcFeatureData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),

      /** Which side of the character sheet this came from. Labelling only. */
      category: new fields.StringField({
        initial: "race", choices: LASTARC.featureCategories
      }),

      grants: grantsSchema()
    };
  }

  prepareDerivedData() {
    const g = this.grants;
    // Mirrors the technick flag: a feature with no numeric payload is purely
    // descriptive, and the sheet says so rather than showing a row of zeroes.
    this.hasNumericGrants = !!(
      g.defences.ref || g.defences.fort || g.defences.will ||
      g.breakThreshold || g.heroPoints || g.initiativeSteps || g.speed ||
      g.secondWindUses || g.hp || g.mp || g.dr ||
      g.recoveryMinorActions !== null || g.skills.length
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Consumables & sundry equipment                                             */
/* -------------------------------------------------------------------------- */

export class LastArcConsumableData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 0.1 }),
      /**
       * The book deliberately makes consumables plentiful, as a substitute for a
       * dedicated healer (§11). They should be ergonomic in the UI, not buried.
       */
      consumableType: new fields.StringField({
        initial: "potion",
        choices: LASTARC.consumableTypes
      }),
      uses: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
        max: new fields.NumberField({ initial: 1, integer: true, min: 0 })
      }),
      effect: new fields.StringField({ initial: "", blank: true }),
      healing: new fields.StringField({ initial: "", blank: true }),
      damage: new fields.StringField({ initial: "", blank: true }),
      damageType: new fields.StringField({
        initial: "unaspected", choices: LASTARC.allDamageTypes
      }),
      appliesStatus: new fields.StringField({ initial: "", blank: true }),
      consumeOnUse: new fields.BooleanField({ initial: true })
    };
  }
}

export class LastArcAmmunitionData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 0.1 }),
      /** Weapon categories this ammunition fits. */
      fits: new fields.ArrayField(new fields.StringField(), { initial: ["bows"] }),
      damageBonus: new fields.NumberField({ initial: 0, integer: true }),
      damageType: new fields.StringField({
        initial: "piercing", choices: LASTARC.allDamageTypes
      })
    };
  }
}

export class LastArcAccessoryData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 0.1 }),
      slot: new fields.StringField({ initial: "", blank: true }),
      grants: grantsSchema()
    };
  }
}

export class LastArcMountData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 0 }),
      size: new fields.StringField({ initial: "large", choices: Object.keys(LASTARC.sizes) }),
      speed: new fields.NumberField({ initial: 12, integer: true, min: 0 }),
      hp: new fields.SchemaField({
        value: new fields.NumberField({ initial: 20, integer: true }),
        max: new fields.NumberField({ initial: 20, integer: true })
      }),
      carryBulk: new fields.NumberField({ initial: 0, min: 0 })
    };
  }
}

export class LastArcProstheticLimbData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 0 }),
      /** Which Injury & Dismemberment result this compensates for (§5.6). */
      replaces: new fields.StringField({ initial: "arm", choices: LASTARC.prostheticSites }),
      /** Prosthetics restore some, not necessarily all, of what was lost. */
      restoresFully: new fields.BooleanField({ initial: false }),
      grants: grantsSchema()
    };
  }
}

/**
 * Generic stackable resource — crafting components, currency-likes, trade goods.
 * Intentionally thin; it is a container for things the bestiary and smithing
 * tables reference without needing behaviour.
 */
export class LastArcResourceItemData extends PhysicalItemData {
  static defineSchema() {
    return {
      ...commonFields(),
      ...physicalFields({ bulk: 0.1 })
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Keyed by the subtype names declared in system.json. Any mismatch between this
 * map and the manifest means Foundry discards documents of that type as
 * invalid, so the integrity suite asserts the two agree.
 *
 * spellScroll and orchestralScore reuse the consumable model: mechanically they
 * are single-use items that cast a spell or play a performance, and the demo
 * gives them no fields of their own.
 */
export const ITEM_DATA_MODELS = {
  weapon: LastArcWeaponData,
  armour: LastArcArmourData,
  shield: LastArcShieldData,
  ammunition: LastArcAmmunitionData,
  accessory: LastArcAccessoryData,
  consumable: LastArcConsumableData,
  technick: LastArcTechnickData,
  talent: LastArcTechnickData,
  spell: LastArcSpellData,
  performance: LastArcPerformanceData,
  race: LastArcRaceData,
  class: LastArcClassData,
  feature: LastArcFeatureData,
  resourceItem: LastArcResourceItemData,
  mount: LastArcMountData,
  spellScroll: LastArcConsumableData,
  orchestralScore: LastArcConsumableData,
  prostheticLimb: LastArcProstheticLimbData
};
