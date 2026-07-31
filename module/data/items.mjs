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
    /** Shake it Off reduces the Recovery action from three minors to two. */
    recoveryMinorActions: new fields.NumberField({
      initial: null, nullable: true, integer: true, min: 1
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

      kind: new fields.StringField({ initial: "technick", choices: ["technick", "talent"] }),

      prerequisites: new fields.SchemaField({
        attributes: new fields.ObjectField({ initial: {} }),   // { str: 13, agi: 15 }
        characterLevel: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        classLevel: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        technicks: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        talents: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        trainedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),

      repeatable: new fields.BooleanField({ initial: false }),
      /** Talents only: the class tree this belongs to. */
      tree: new fields.StringField({ initial: "", blank: true, nullable: true }),
      /** Class-slot technicks are restricted to a class's bonus list. */
      classRestricted: new fields.BooleanField({ initial: false }),
      classes: new fields.ArrayField(new fields.StringField(), { initial: [] }),

      grants: grantsSchema(),
      flags: new fields.ArrayField(
        new fields.StringField({ choices: LASTARC.technickFlags }), { initial: [] }
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

      /**
       * The Spellcraft check does TRIPLE duty (§11): it determines success, it
       * SCALES DAMAGE by how high it rolls, and it may inflict a status if it
       * also beats a second defence. All three outcomes have to surface at roll
       * time, so all three are modelled.
       */
      spellcraftDC: new fields.NumberField({ initial: 15, integer: true }),
      damage: new fields.StringField({ initial: "", blank: true }),
      damageType: new fields.StringField({
        initial: "unaspected", choices: LASTARC.allDamageTypes
      }),
      /** Extra damage per point by which the Spellcraft check beats its DC. */
      damageScaling: new fields.StringField({ initial: "", blank: true }),
      /** Secondary defence the same roll is compared against, if any. */
      secondaryDefence: new fields.StringField({
        initial: "", blank: true, choices: ["", "ref", "fort", "will"]
      }),
      secondaryStatus: new fields.StringField({ initial: "", blank: true }),

      targetDefence: new fields.StringField({
        initial: "ref", choices: ["ref", "fort", "will"]
      }),
      range: new fields.NumberField({ initial: 6, min: 0 }),
      area: new fields.StringField({ initial: "", blank: true }),
      duration: new fields.StringField({ initial: "", blank: true }),
      /** Area attacks can neither crit nor combo (§5.1). */
      isArea: new fields.BooleanField({ initial: false })
    };
  }
}

export class LastArcPerformanceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonFields(),
      mpCost: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      performDC: new fields.NumberField({ initial: 15, integer: true }),
      /** Perform is sub-skilled; this names the required specialisation. */
      specialisation: new fields.StringField({ initial: "", blank: true }),
      duration: new fields.StringField({ initial: "", blank: true }),
      area: new fields.StringField({ initial: "", blank: true })
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
      traits: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ initial: "" }),
          description: new fields.HTMLField({ initial: "" })
        }),
        { initial: [] }
      ),
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
        choices: ["potion", "poison", "scroll", "score", "grenade", "other"]
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
      replaces: new fields.StringField({ initial: "arm", choices: ["arm", "leg"] }),
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
  resourceItem: LastArcResourceItemData,
  mount: LastArcMountData,
  spellScroll: LastArcConsumableData,
  orchestralScore: LastArcConsumableData,
  prostheticLimb: LastArcProstheticLimbData
};
