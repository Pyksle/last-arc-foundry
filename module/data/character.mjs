/**
 * Character actor data model (§3.1).
 *
 * All real math lives in ../derivation.mjs, which is Foundry-free and unit
 * tested. This class is a marshalling layer: it declares the schema and feeds
 * `this` into those pure functions.
 *
 * ⚠ ACTIVE EFFECT TIMING (§16 rev2). Foundry applies Active Effects BETWEEN
 * prepareBaseData() and prepareDerivedData(). Anything computed below therefore
 * OVERWRITES an AE that targets the same path, silently and with no error. We
 * take the spec's recommended resolution: the derivation chain (break penalty →
 * defences → Fortitude → Threshold) is computed in code and is NOT modelled as
 * Active Effects. AEs feed the `misc` and `technicks` slots, which are read as
 * inputs here — that is the supported way to inject into this system.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";

const fields = foundry.data.fields;

/** Build the per-skill schema from config so the two can never drift apart. */
function skillsSchema() {
  const schema = {};
  for (const [key, skill] of Object.entries(LASTARC.allSkills)) {
    schema[key] = new fields.SchemaField({
      trained: new fields.BooleanField({ initial: false }),
      /** Skill Focus technick — a distinct column on the printed sheet (§4.5 rev2). */
      focus: new fields.NumberField({ initial: 0, integer: true }),
      technicks: new fields.NumberField({ initial: 0, integer: true }),
      misc: new fields.NumberField({ initial: 0, integer: true })
      /**
       * `subskills` used to live here — a free-text array standing in for the
       * Lore and Perform specialisations (issue #35). It is gone because those
       * are eight real skills now. The container it hung from could never be
       * rolled, and a typo in a specialisation's name trained nothing while
       * silently falling back to the untrained parent.
       */
    });
  }
  return schema;
}

function attributesSchema() {
  const schema = {};
  for (const key of Object.keys(LASTARC.attributes)) {
    schema[key] = new fields.SchemaField({
      value: new fields.NumberField({ initial: 10, integer: true, min: 1 }),
      racialMod: new fields.NumberField({ initial: 0, integer: true }),
      cap: new fields.NumberField({ initial: 20, integer: true })
    });
  }
  return schema;
}

function defenceSchema() {
  return new fields.SchemaField({
    value: new fields.NumberField({ initial: 10, integer: true }),
    classBonus: new fields.NumberField({ initial: 0, integer: true }),
    technicks: new fields.NumberField({ initial: 0, integer: true }),
    misc: new fields.NumberField({ initial: 0, integer: true })
  });
}

export class LastArcCharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes: new fields.SchemaField(attributesSchema()),

      details: new fields.SchemaField({
        race: new fields.StringField({ initial: "" }),
        gender: new fields.StringField({ initial: "" }),
        ethosPurity: new fields.StringField({
          initial: "neutral", choices: LASTARC.ethosPurity
        }),
        ethosMorality: new fields.StringField({
          initial: "neutral", choices: LASTARC.ethosMorality
        }),
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        xp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        xpNext: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        size: new fields.StringField({
          initial: "medium", choices: Object.keys(LASTARC.sizes)
        }),
        /**
         * Languages spoken. Declared from the start and editable nowhere until
         * issue #14 — an ArrayField of strings, which the field-coverage guard
         * skipped wholesale, so nothing noticed for nine releases.
         */
        languages: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        /**
         * Special senses — dark vision, low-light vision, scent (§2, #65).
         *
         * FREE TEXT, and authored rather than derived. Most of a character's
         * senses come from their race, and the sheet shows those beside this
         * box; but a technick, a prosthetic eye or a GM ruling can grant one
         * too, and there is nowhere else to put it. Reported as players having
         * no section to record them in at all.
         *
         * A plain string rather than the race item's array-plus-comma-box: this
         * mirrors `npc.details.senses`, which is the same question asked of the
         * other actor type, and two shapes for one field is what #60 removed.
         */
        senses: new fields.StringField({ initial: "" }),
        /**
         * Coin. The book budgets purchases in gold and gives no subdivisions
         * or alternative denominations, so this is one number rather than the
         * pouch of copper/silver/electrum other systems carry (p.84).
         */
        gold: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        biography: new fields.HTMLField({ initial: "" })
      }),

      /**
       * Ordered — entry [0] is the FIRST class taken, which grants the level-1
       * HP/MP values and (by default) the only set of class defence bonuses.
       * `advanced` layers an advanced class over the base one (§14); declared
       * now so the full release doesn't force a migration.
       */
      classes: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ initial: "warrior", choices: Object.keys(LASTARC.classes) }),
          levels: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
          advanced: new fields.StringField({ initial: "", blank: true, nullable: true })
        }),
        { initial: [{ name: "warrior", levels: 1, advanced: null }] }
      ),

      resources: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 10, integer: true }),
          max: new fields.NumberField({ initial: 10, integer: true }),
          temp: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        mp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
          max: new fields.NumberField({ initial: 0, integer: true })
        }),
        heroPoints: new fields.SchemaField({
          value: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 1, integer: true, min: 0 })
        }),
        secondWind: new fields.SchemaField({
          /**
           * Uses spent. Tracked with one checkbox per use on the sheet, and
           * freely tickable in both directions — see issue #10. There is no
           * automatic reset because there is nothing to hang one on: Second
           * Wind refreshes on a rest, but a table decides when a rest happened.
           *
           * `usedThisEncounter` used to sit beside this to enforce a
           * once-per-encounter cap. Nothing ever wrote it, so the cap did not
           * exist, and its entry in the field-coverage EXEMPT map claimed it
           * was "reset by combat lifecycle" — a description of code that was
           * never written. Removed rather than implemented: the design this
           * sheet is moving toward is manual tracking, and an invisible cap is
           * the opposite of that.
           */
          used: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 1, integer: true, min: 0 })
        })
      }),

      defences: new fields.SchemaField({
        ref: defenceSchema(),
        fort: defenceSchema(),
        will: defenceSchema()
      }),

      breakGauge: new fields.SchemaField({
        /** 0..5, HIGHER IS WORSE (§6 rev2). Never treat as a penalty value. */
        step: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 5 }),
        persistentSteps: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 5 }),
        /**
         * Each persistent step has its OWN named source and clearance
         * requirement, and multiple stack independently (§6). This is an array
         * rather than a count because "cleared by an antidote" and "cleared by
         * a specific spell" have to be tracked and satisfied separately.
         */
        persistentSources: new fields.ArrayField(
          new fields.SchemaField({
            id: new fields.StringField(),
            label: new fields.StringField(),
            clearedBy: new fields.StringField({ initial: "" }),
            /** Injury steps do NOT block natural healing; other sources do (§6). */
            fromInjury: new fields.BooleanField({ initial: false })
          }),
          { initial: [] }
        ),
        thresholdBonus: new fields.NumberField({ initial: 0, integer: true }),
        /** Consecutive minor actions banked toward a Recovery, 0..3. */
        recoveryProgress: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 3 })
      }),

      movement: new fields.SchemaField({
        base: new fields.NumberField({ initial: 6, integer: true, min: 0 }),
        fly: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        swim: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        climb: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        hover: new fields.BooleanField({ initial: false }),
        special: new fields.StringField({ initial: "" })
      }),

      initiative: new fields.SchemaField({
        die: new fields.StringField({ initial: "d10" }),
        /** Improved Initiative instances; each steps the die DOWN one rung (§8). */
        bonusSteps: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      bulk: new fields.SchemaField({
        // DERIVED, not authored — recomputed from the inventory on every
        // prepareDerivedData. Persisted only so the field exists for effects to
        // target; writing to it directly will be overwritten.
        value: new fields.NumberField({ initial: 0, min: 0 })
      }),

      skills: new fields.SchemaField(skillsSchema()),

      proficiencies: new fields.SchemaField({
        armour: new fields.ArrayField(new fields.StringField(), { initial: ["light"] }),
        weapons: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        shields: new fields.BooleanField({ initial: false })
      }),

      /** Damage type keys the actor resists / is immune to / is weak against (§5.5). */
      damageMods: new fields.SchemaField({
        resistance: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        immunity: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        weakness: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        dr: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      /**
       * Conditions this creature cannot be given at all (#58).
       *
       * Distinct from `damageMods.immunity`, which is about a DAMAGE TYPE and
       * cancels riders carried by that damage. This is immunity to the
       * condition itself, from any source whatsoever — the shape a statblock
       * actually prints, and the thing a player has to keep track of by hand
       * for their own race and gear otherwise.
       *
       * No `choices` on the element on purpose: a value the list later stops
       * accepting makes the document refuse to open. Validated at read time in
       * `status-guard.mjs` instead.
       */
      statusImmunities: new fields.ArrayField(new fields.StringField(), { initial: [] })
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  Derived data (§4)                                                        */
  /* ------------------------------------------------------------------------ */

  /**
   * COMPUTATION ORDER IS LOAD-BEARING and must not be reordered:
   *
   *   1. attribute modifiers
   *   2. total level (from classes)
   *   3. TECHNICK GRANTS ← must precede defences and skills, which consume them
   *   4. equipped armour
   *   5. status flags (incapacitated / agi-denied)
   *   6. class bonuses
   *   7. DEFENCES        ← consumes the break penalty and the grants
   *   8. BREAK THRESHOLD ← consumes the finished Fortitude
   *   9. everything else
   *
   * Steps 7 and 8 in that order are what make the §4.2 death spiral automatic.
   * Computing Threshold from a cached or pre-penalty Fortitude produces a value
   * that looks right and is wrong exactly when it matters.
   *
   * Items are safe to read here: Foundry prepares embedded documents before the
   * parent's prepareDerivedData runs.
   */
  prepareDerivedData() {
    const settings = this.#settings();

    // 1. Attribute modifiers ------------------------------------------------
    for (const key of Object.keys(LASTARC.attributes)) {
      const attr = this.attributes[key];
      attr.total = attr.value + attr.racialMod;
      attr.mod = D.attributeModifier(attr.total, settings.clampAttributeModifier);
    }

    // 2. Level --------------------------------------------------------------
    //
    // Character level is DERIVED from the class list, never entered directly.
    //
    // It used to be its own editable field, with a warning when the two
    // disagreed. That was a trap: defences, HP, MP, skills and half-level
    // bonuses all read `details.level`, while a player levelling up naturally
    // edits their CLASS level — so the character gained a class level and
    // nothing else moved. Reported as "defences are not increased by character
    // level at all", which was true and was not a maths bug.
    //
    // The spec calls this "total character level", and there is no legitimate
    // state where a character's level differs from the sum of their class
    // levels, so the second lever is removed rather than made louder.
    const classLevelTotal = this.classes.reduce((sum, c) => sum + c.levels, 0);
    this.details.classLevelTotal = classLevelTotal;
    // A character with no class entries at all would otherwise be level 0 and
    // derive negative half-level bonuses.
    this.details.level = Math.max(1, classLevelTotal);
    const level = this.details.level;

    // 3. Technick / talent / accessory grants -------------------------------
    const grants = this.#aggregateGrants();
    this.grants = grants;

    // 3b. Spells and performances known (issue #33) -------------------------
    // Read-only on both sides: the limit derives from the study technicks and
    // Intelligence, and the count derives from the items actually on the actor.
    // Neither may be bound to an input — see the class docstring.
    this.study = this.#studyLimits();
    this.trainedSkills = this.#trainedSkillLimits(grants);

    /**
     * Rerolls this character's traits offer (#48). Read-only, derived from the
     * items — see the class docstring on why nothing derived gets an input.
     *
     * Surfaced on `system` so the chat card can offer a button without walking
     * the item list itself: a chat handler that re-derives what the model
     * already knows is a second implementation waiting to disagree.
     */
    this.rerollGrants = grants.rerolls;

    // 4. Equipped armour ----------------------------------------------------
    const armour = this.#equippedArmour();

    // 5. Statuses -----------------------------------------------------------
    // Statuses ARE Foundry Active Effects — they are applied to the actor the
    // normal way. What is computed in code is their DERIVED consequences, for
    // the reason in the class docstring: an AE targeting a field this method
    // writes would be silently overwritten. So we read which statuses are
    // active and do the arithmetic here.
    const statuses = D.aggregateStatuses(this.parent?.statuses ?? []);
    this.statuses = statuses;

    const step = D.clampStep(this.breakGauge.step);
    const incapacitated = D.isIncapacitated(step) || this.resources.hp.value <= 0;
    const agiDenied = statuses.agiDenied;

    this.breakGauge.penalty = D.breakPenaltyOrZero(step);
    this.breakGauge.incapacitated = incapacitated;
    this.breakGauge.canRecoverTo = this.breakGauge.persistentSteps;
    // Shake it Off lowers the Recovery requirement from three minors to two.
    this.breakGauge.recoveryRequired =
      grants.recoveryMinorActions ?? LASTARC.recoveryMinorActions;
    // Disease blocks recovery actions outright, independently of the
    // persistent-step floor (§12).
    this.breakGauge.recoveryBlocked = statuses.blocksRecovery;

    // 6. Class bonuses ------------------------------------------------------
    let classBonus;
    try {
      classBonus = D.classDefenceBonuses(this.classes, settings.multiclassRegrantsLevel1Benefits);
    } catch (err) {
      console.warn(`Last Arc | ${this.parent?.name}: ${err.message}`);
      classBonus = { ref: 0, fort: 0, will: 0 };
    }
    this.defences.ref.classBonus = classBonus.ref;
    this.defences.fort.classBonus = classBonus.fort;
    this.defences.will.classBonus = classBonus.will;

    // Technick contributions are WRITTEN BACK to the schema fields so the sheet
    // shows where a defence bonus came from, rather than the player wondering
    // why the total does not match the parts.
    this.defences.ref.technicks = grants.defences.ref;
    this.defences.fort.technicks = grants.defences.fort;
    this.defences.will.technicks = grants.defences.will;

    // Status penalties (exhaustion is -10 to all three) ride in the misc slot so
    // they flow through the same single computation as everything else, rather
    // than being subtracted from the finished total afterwards — which would
    // bypass the Fortitude the Threshold is about to read.
    const miscWithStatus = {
      ref: this.defences.ref.misc + statuses.defences.ref,
      fort: this.defences.fort.misc + statuses.defences.fort,
      will: this.defences.will.misc + statuses.defences.will
    };

    // 7. Defences -----------------------------------------------------------
    // Toad replaces the creature's size outright rather than modifying it, so
    // the size read here is the EFFECTIVE one. `details.size` is left alone —
    // it is the character's real size and comes straight back when the status
    // clears.
    const effSize = D.effectiveSize(this.details.size, statuses.treatedAsSize);
    const sizeMod = LASTARC.sizes[effSize]?.mod ?? 0;
    const computed = D.computeDefences({
      level,
      agiMod: this.attributes.agi.mod,
      vitMod: this.attributes.vit.mod,
      mndMod: this.attributes.mnd.mod,
      classBonus,
      armour,
      sizeMod,
      technicks: {
        ref: this.defences.ref.technicks,
        fort: this.defences.fort.technicks,
        will: this.defences.will.technicks
      },
      misc: miscWithStatus,
      breakStep: step,
      agiDenied,
      incapacitated,
      agiOverride: statuses.agiOverride,
      noEquipmentBenefit: statuses.noEquipmentBenefit
    });

    this.defences.ref.value = computed.ref;
    this.defences.fort.value = computed.fort;
    this.defences.will.value = computed.will;

    // Flat-footed Reflex. NPCs override this directly (§3.2); characters derive
    // it by re-running with the Agi bonus denied.
    this.defences.ref.flatFooted = D.computeDefences({
      level,
      agiMod: this.attributes.agi.mod,
      vitMod: this.attributes.vit.mod,
      mndMod: this.attributes.mnd.mod,
      classBonus, armour, sizeMod,
      technicks: { ref: this.defences.ref.technicks },
      misc: { ref: miscWithStatus.ref },
      breakStep: step,
      agiDenied: true,
      incapacitated,
      agiOverride: statuses.agiOverride,
      noEquipmentBenefit: statuses.noEquipmentBenefit
    }).ref;

    // Subtotal WITHOUT the break penalty, so the sheet tooltip reconciles
    // against the printed sheet (which has no Break Gauge column).
    this.defences.ref.beforeBreak = computed.ref - computed.breakPenalty;
    this.defences.fort.beforeBreak = computed.fort - computed.breakPenalty;
    this.defences.will.beforeBreak = computed.will - computed.breakPenalty;

    /**
     * 8. Break Threshold (issue #7) ----------------------------------------
     *
     * Built from the UNPENALISED Fortitude. This previously used the live,
     * break-penalised value, which produced a death spiral: each step down the
     * gauge lowered Threshold, so the next hit broke you more easily.
     *
     * The book does not say that. The Break Gauge's penalty is enumerated —
     * "a penalty to their attack rolls, skill checks, attribute checks, and
     * defences", and the table repeats "to all defences, attack rolls, skill
     * checks, and attribute checks" at every step. Break Threshold is not in
     * that list. It is a damage comparison, not a roll or a roll target, and
     * the book presents it among the statistics calculated at character
     * creation (Step 5) alongside HP, MP and speed.
     *
     * The spiral was my inference from "Threshold = Fortitude Defence", not
     * something the text asks for. `breakGaugeAffectsThreshold` restores it for
     * anyone who reads it the other way.
     */
    this.breakGauge.threshold = D.breakThreshold({
      fort: settings.breakGaugeAffectsThreshold
        ? this.defences.fort.value
        : this.defences.fort.beforeBreak,
      // Effective, for the same reason as the Reflex size mod above: a Large
      // character turned into a toad no longer has a Large creature's Threshold.
      size: effSize,
      technicks: grants.breakThreshold,
      itemBonus: this.breakGauge.thresholdBonus
    });

    // 9. Resources ----------------------------------------------------------
    try {
      this.resources.hp.max = D.hpMax(this.classes, this.attributes.vit.mod);
      this.resources.mp.max = D.mpMax(this.classes, this.attributes.mnd.mod);
    } catch (err) {
      console.warn(`Last Arc | ${this.parent?.name}: ${err.message}`);
    }

    // Withering and dim halve the maxima. Multipliers COMPOUND in
    // aggregateStatuses rather than summing — two halvings give a quarter, not
    // zero, and zero max HP would be instant death rather than a penalty.
    this.resources.hp.unmodifiedMax = this.resources.hp.max;
    this.resources.mp.unmodifiedMax = this.resources.mp.max;
    this.resources.hp.max = Math.max(1, D.rd(this.resources.hp.max * statuses.maxHpMultiplier));
    this.resources.mp.max = Math.max(0, D.rd(this.resources.mp.max * statuses.maxMpMultiplier));

    /**
     * Disease: "current HP is treated as max HP" (§12). The cap follows the
     * wound rather than the wound following the cap — a diseased character at
     * 12/40 has an effective maximum of 12 and cannot heal above it until the
     * disease is cured. Applied AFTER the multipliers so a withered, diseased
     * character is capped by whichever bites harder.
     */
    if (statuses.currentHpBecomesMax) {
      this.resources.hp.max = Math.max(1, Math.min(this.resources.hp.max, this.resources.hp.value));
      this.resources.hp.diseasedCap = true;
    }

    // Flat grants from accessories, technicks and prosthetics are added AFTER
    // the status multipliers. Withering halves what your class and Vitality
    // gave you; it has no business halving an amulet.
    if (grants.hp) this.resources.hp.max = Math.max(1, this.resources.hp.max + grants.hp);
    if (grants.mp) this.resources.mp.max = Math.max(0, this.resources.mp.max + grants.mp);

    this.resources.hp.value = Math.clamp(this.resources.hp.value, 0, this.resources.hp.max);
    this.resources.mp.value = Math.clamp(this.resources.mp.value, 0, this.resources.mp.max);

    /**
     * Damage reduction (§11) — issue #6, "armour is not increasing DR".
     *
     * `damageMods.dr` was never assigned. The equipped armour was read and its
     * Reflex bonus applied, so armour visibly did something, while the stat the
     * damage pipeline actually consumes stayed at 0 forever.
     *
     * It hid because the field-coverage test excused it: the EXEMPT map said
     * "DERIVED from equipped armour", which was a claim, not a fact, and the
     * exemption suppressed the one check that would have caught it. An
     * allowlist entry is an assertion about the code and can be wrong.
     */
    this.damageMods.dr = Math.max(0, armour.dr + grants.dr);

    // The Heroic technick raises the cap via its `grants.heroPoints` payload,
    // so it is counted once here rather than by name-matching.
    this.resources.heroPoints.max = D.heroPointMax(level, grants.heroPoints);
    this.resources.secondWind.max = 1 + grants.secondWindUses;
    this.resources.secondWind.canUse =
      D.canUseSecondWind(this.resources.hp.value, this.resources.hp.max) &&
      this.resources.secondWind.used < this.resources.secondWind.max;
    /**
     * Resilient adds 5 + half level to every Second Wind (#64).
     *
     * Read off the items here rather than through `grants`, because the amount
     * scales with level and `grants` carries constants — see the note on the
     * flag in config.mjs. A suspended item contributes nothing, exactly as its
     * grants would not.
     */
    const resilient = (this.parent?.items ?? []).some(
      (i) => i.system?.active !== false && i.system?.flags?.includes("resilient")
    );
    this.resources.secondWind.healAmount = D.secondWindHeal(
      this.attributes.vit.total,
      this.resources.hp.max,
      resilient ? D.resilientSecondWindBonus(level) : 0
    );

    // 10. Bulk & movement ---------------------------------------------------
    const limits = D.bulkLimits(this.attributes.str.total);
    this.bulk.max = limits.max;
    this.bulk.overMax = limits.overMax;

    // Carried bulk is summed from inventory rather than hand-entered.
    this.bulk.value = this.#carriedBulk();
    this.bulk.state = D.encumbranceState(this.bulk.value, this.attributes.str.total);

    const reductions = [];
    if (this.bulk.state === "encumbered") reductions.push(0.25);
    if (armour?.type === "heavy") reductions.push(0.25);   // heavy armour = encumbered (§11)
    if (statuses.speedReduction) reductions.push(statuses.speedReduction);

    const baseSpeed = Math.max(0, this.movement.base + grants.speed);

    if (statuses.speedZero) {
      this.movement.value = 0;
      this.movement.fly = 0;
      this.movement.hover = false;
    } else if (this.bulk.state === "overencumbered") {
      this.movement.value = 0;
      this.movement.fly = 0;
      this.movement.hover = false;
    } else {
      /**
       * ONE additive pool (issue #51). Encumbrance, heavy armour, Slow and a
       * severed leg are all penalties to base speed, and the book says such
       * penalties add rather than compound. Slow used to be applied afterwards
       * as a multiplier on the already-reduced number, so slowed-and-encumbered
       * at base 6 gave 2 squares where the rule gives 1.
       */
      const reduced = D.speedAfterPenalties(baseSpeed, reductions);

      // Slow's floor of 1 square is a STATED rule, not a rounding artefact, so
      // it is applied to the total rather than folded into the reduction — a
      // creature whose penalties would take it to 0 still moves 1.
      this.movement.value = Math.max(statuses.speedMinimum ?? 0, reduced);
      if (reductions.length) {
        this.movement.fly = 0;      // encumbered: no flying, lose hover (§4.6)
        this.movement.hover = false;
      }
    }

    // 11. Skills ------------------------------------------------------------
    this.#prepareSkills({ level, armour, step, grants });

    // 12. Initiative --------------------------------------------------------
    this.initiative.effectiveDie = this.#initiativeDie(grants.initiativeSteps);

    // 13. Effective damage modifiers ----------------------------------------
    // Agony strips resistances and immunities and adds universal weakness, so
    // the combat pipeline must read THIS rather than the raw arrays.
    this.effectiveDamageMods = D.effectiveDamageMods(this.damageMods, statuses);

    // 14. Natural healing ---------------------------------------------------
    /**
     * Blocked by persistent Break steps and by HP/MP-affecting statuses (§6, §13).
     *
     * The exception in §6 is deliberate: steps that came from INJURIES do not
     * block healing, while steps from poison, disease and the like do. That is
     * why persistent sources carry a `fromInjury` flag rather than being an
     * undifferentiated count — a maimed character can still recover from rest,
     * a poisoned one cannot.
     */
    const nonInjuryPersistent = this.breakGauge.persistentSources
      .some((s) => !s.fromInjury);
    this.resources.naturalHealingBlocked =
      nonInjuryPersistent || statuses.blocksNaturalHealing;
  }

  /* ------------------------------------------------------------------------ */

  #prepareSkills({ level, armour, step, grants }) {
    const acp = armour?.checkPenalty ?? 0;
    const proficient = !armour?.type || this.proficiencies.armour.includes(armour.type);

    for (const [key, cfg] of Object.entries(LASTARC.allSkills)) {
      const skill = this.skills[key];
      if (!skill) continue;

      const attrMod = this.attributes[cfg.attr]?.mod ?? 0;
      const appliesArmourPenalty = !!cfg.acp && !proficient;

      // Skill Focus and Skill Training arrive as grants; Skill Training can make
      // a skill trained that the character never checked the box for.
      const granted = grants.skills[key] ?? { focus: 0, bonus: 0, trained: false };
      const trained = skill.trained || granted.trained;

      skill.attr = cfg.attr;
      skill.isWeaponSkill = !!cfg.weapon;
      skill.appliesArmourPenalty = appliesArmourPenalty;
      skill.grantedTrained = granted.trained && !skill.trained;
      skill.technicks = granted.bonus;
      skill.grantedFocus = granted.focus;
      // Stored as a POSITIVE magnitude, matching §4.5 rev2 and skillModifier's
      // contract. Kept per-skill so the sheet can show WHY a total is lower
      // than its visible columns — see the breakdown built in the sheet.
      skill.armourCheckPenalty = appliesArmourPenalty ? acp : 0;
      // Per-skill status penalties, e.g. slow's −10 to Acrobatics and Athletics,
      // plus any blanket skill-check penalty such as toad's −10.
      skill.statusPenalty =
        (this.statuses?.skillPenalties?.[key] ?? 0) + (this.statuses?.skillCheckPenalty ?? 0);

      skill.total = D.skillModifier({
        level,
        attrMod,
        trained,
        focus: skill.focus + granted.focus,
        technicks: granted.bonus,
        misc: skill.misc + skill.statusPenalty,
        armourCheckPenalty: acp,
        appliesArmourPenalty,
        breakStep: step
      });

    }

    this.skills.perception.passive = D.passivePerception(this.skills.perception.total);
  }

  /**
   * Improved Initiative steps the die DOWN the ladder (lowest acts first, §8).
   * Both the manual field and technick grants contribute; the technick is
   * repeatable, so multiple copies stack.
   */
  #initiativeDie(grantedSteps = 0) {
    const base = this.classes.length
      ? (LASTARC.classes[this.classes[0].name]?.initDie ?? "d10")
      : "d10";
    try {
      return D.improvedInitiativeDie(base, this.initiative.bonusSteps + grantedSteps);
    } catch {
      return base;
    }
  }

  /**
   * Collect `system.grants` from every technick, talent, accessory and
   * prosthetic the actor owns.
   *
   * Unequipped accessories are excluded — a ring in a backpack should not be
   * boosting Reflex — but technicks and talents always count, since they are
   * knowledge rather than gear.
   */
  #aggregateGrants() {
    const items = this.parent?.items ?? [];
    const contributing = [];

    for (const item of items) {
      const g = item.system?.grants;
      if (!g) continue;
      // Knowledge and innate features contribute unconditionally; worn things
      // only while worn. A racial feature is not something you take off.
      const isInnate = item.type === "technick" || item.type === "talent"
        || item.type === "feature";
      // A technick switched off contributes nothing — see `active` on the
      // technick schema. Features have no such switch, hence `!== false`
      // rather than a truthiness test.
      if (item.system.active === false) continue;
      /**
       * Tagged with the item's name so a granted reroll can say WHICH trait
       * offers it (#48). A player with two reroll traits needs "Reroll
       * (Grassrunner)" rather than two identical buttons — they may have
       * different semantics and different limits.
       *
       * A shallow copy, because `grants` is live schema data and writing a
       * display field onto it would persist to the database.
       */
      if (isInnate || item.system.equipped) contributing.push({ ...g, __source: item.name });
    }

    return D.aggregateGrants(contributing);
  }

  /**
   * How many spells and performances this character may know, against how many
   * they actually have (§10, book p.78).
   *
   * Both study technicks are repeatable, so this COUNTS the technicks carrying
   * each flag rather than asking whether one exists — `hasFlag`-style boolean
   * logic would cap a character at their first taking and silently discard
   * every one after it.
   *
   * Suspended technicks do not count, for the same reason they grant nothing
   * else: a switched-off technick contributes nothing.
   */
  #studyLimits() {
    const items = this.parent?.items ?? [];
    let arcane = 0;
    let bardic = 0;
    let spells = 0;
    let performances = 0;

    for (const item of items) {
      if (item.type === "spell") { spells++; continue; }
      if (item.type === "performance") { performances++; continue; }
      if (item.type !== "technick" && item.type !== "talent") continue;
      if (item.system?.active === false) continue;

      if (item.system?.flags?.includes("arcaneStudy")) arcane++;
      if (item.system?.flags?.includes("bardicStudy")) bardic++;
    }

    const intMod = this.attributes.int.mod;
    // Each pool goes through its OWN named limit rather than the shared helper,
    // so a future divergence between the two rules has an obvious place to land
    // and cannot accidentally be applied to both.
    const build = (known, takings, limitOf) => {
      const max = limitOf(takings, intMod);
      return { known, max, takings, over: known > max };
    };

    return {
      spells: build(spells, arcane, D.knownSpellLimit),
      performances: build(performances, bardic, D.knownPerformanceLimit)
    };
  }

  /**
   * How many skills this character may be trained in, against how many they are
   * (issue #34).
   *
   * `trainedSkillCount` was implemented, correct, and consumed by nothing, so
   * there was no allowance anywhere on the sheet and nothing said when a
   * character had over-trained. It stayed invisible because the orphan guard
   * counted a mention of it in a COMMENT as a use.
   *
   * The allowance comes from the BASE class — the first one taken. Multiclassing
   * does not grant a second helping of trained skills, and the book gives the
   * count in the class-creation table rather than per class level.
   *
   * Weapon skills are counted in the total on purpose: the class skill lists
   * print Light Weapon and its siblings alongside Acrobatics and Lore, so they
   * are choices from the same pool. If that reading is wrong the number is
   * visibly wrong, which is the point of showing it.
   */
  #trainedSkillLimits(grants = {}) {
    /**
     * A skill a technick TRAINED counts as known, and raises the allowance by
     * the same one (issue #43).
     *
     * Both halves matter. Counting it as known without raising the allowance
     * would report a character over budget for taking Skill Training, which is
     * a technick they paid for — the readout would punish them for it. Raising
     * the allowance without counting it would leave the number unchanged and
     * the player still unable to see that the skill is trained.
     *
     * Only grants the player has not ALSO trained by hand count, or a
     * belt-and-braces character double-counts a single skill.
     */
    const grantedKeys = Object.entries(grants.skills ?? {})
      .filter(([key, g]) => g?.trained && !this.skills[key]?.trained)
      .map(([key]) => key);

    const known = Object.values(this.skills).filter((s) => s.trained).length
      + grantedKeys.length;

    const halfElf = (this.parent?.items ?? []).some(
      (i) => i.type === "race" && i.system?.slug === "half-elf"
    );

    let max = null;
    try {
      max = D.trainedSkillCount(this.classes?.[0]?.name, this.attributes.int.mod, halfElf)
        + grantedKeys.length;
    } catch {
      // No class chosen yet, or one whose table entry is unset. Showing nothing
      // is honest; showing a number derived from a guess is how a character
      // sheet teaches somebody a wrong rule.
      max = null;
    }

    return { known, max, halfElf, granted: grantedKeys.length,
      over: max !== null && known > max };
  }

  /** Total bulk carried, summed across the inventory (§4.6). */
  #carriedBulk() {
    const items = this.parent?.items ?? [];
    let total = 0;
    for (const item of items) {
      const bulk = item.system?.bulk;
      if (typeof bulk !== "number") continue;
      total += bulk * (item.system.quantity ?? 1);
    }
    // Bulk is quoted to one decimal (light weapons are 0.1); round to avoid
    // floating-point dust accumulating across a large inventory.
    return Math.round(total * 10) / 10;
  }

  /**
   * Equipped armour, normalised for the derivation layer.
   *
   * Returns `maxAgiBonus: Infinity` when unarmoured — the derivation guards this
   * too, but establishing it here means the value is never `undefined` in flight.
   * Item data models arrive in Phase 2; until then this reads defensively.
   */
  #equippedArmour() {
    const item = this.parent?.items?.find(
      (i) => i.type === "armour" && i.system?.equipped
    );
    if (!item) return { refBonus: 0, maxAgiBonus: Infinity, checkPenalty: 0, dr: 0, type: null };

    const s = item.system ?? {};
    return {
      refBonus: s.refBonus ?? 0,
      maxAgiBonus: Number.isFinite(s.maxAgiBonus) ? s.maxAgiBonus : Infinity,
      // Stored as a POSITIVE magnitude (§4.5 rev2). Coerce defensively in case
      // a hand-authored item still carries the old negative convention.
      checkPenalty: Math.abs(s.checkPenalty ?? 0),
      // effectiveDr, not the printed dr: the armour's own Break Gauge reduces
      // what it stops (§11), floored at 0. Falls back to the raw value for a
      // hand-authored item whose derived data has not been prepared.
      dr: s.effectiveDr ?? s.dr ?? 0,
      type: s.type ?? null
    };
  }

  /**
   * Snapshot of the actor in the shape `D.checkPrerequisites` expects.
   *
   * Exposed publicly because the level-up UI needs it to evaluate a candidate
   * technick before it is added, and §11 allows prerequisites to be met at the
   * same level the technick is taken.
   */
  prerequisiteSnapshot() {
    const items = this.parent?.items ?? [];
    const slugsOfType = (type) => new Set(
      items.filter((i) => i.type === type && i.system?.slug).map((i) => i.system.slug)
    );

    const attributes = {};
    for (const key of Object.keys(LASTARC.attributes)) {
      attributes[key] = this.attributes[key].total ?? this.attributes[key].value;
    }

    return {
      attributes,
      characterLevel: this.details.level,
      classLevel: this.classes[0]?.levels ?? 0,
      technicks: slugsOfType("technick"),
      talents: slugsOfType("talent"),
      trainedSkills: new Set(
        Object.entries(this.skills)
          .filter(([, s]) => s.trained)
          .map(([k]) => k)
      )
    };
  }

  #hasAnyStatus(ids) {
    const statuses = this.parent?.statuses;
    if (!statuses) return false;
    return ids.some((id) => statuses.has(id));
  }

  #settings() {
    const get = (key, fallback) => {
      try {
        return game.settings.get("last-arc", key);
      } catch {
        return fallback;
      }
    };
    return {
      clampAttributeModifier: get("clampAttributeModifier", true),
      multiclassRegrantsLevel1Benefits: get("multiclassRegrantsLevel1Benefits", false),
      breakThresholdUsesPostDR: get("breakThresholdUsesPostDR", true),
      heroPointAffectsThreshold: get("heroPointAffectsThreshold", true),
      breakGaugeAffectsThreshold: get("breakGaugeAffectsThreshold", false)
    };
  }
}
