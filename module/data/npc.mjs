/**
 * NPC actor data model (§3.2).
 *
 * NPCs are STATBLOCK-DRIVEN, not build-driven: defences, Threshold, DR and
 * skills are stored as direct values rather than derived from classes and
 * attributes. That is deliberate — bestiary entries are authored numbers, and
 * back-deriving them from a character build would fight the source material.
 *
 * The one thing we still derive is the interaction with the Break Gauge, because
 * a statblock's printed defences are its UNBROKEN values and the gauge has to
 * move them.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";

const fields = foundry.data.fields;

function attributesSchema() {
  const schema = {};
  for (const key of Object.keys(LASTARC.attributes)) {
    schema[key] = new fields.SchemaField({
      value: new fields.NumberField({ initial: 10, integer: true, min: 1 })
    });
  }
  return schema;
}

export class LastArcNpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes: new fields.SchemaField(attributesSchema()),

      details: new fields.SchemaField({
        cr: new fields.NumberField({ initial: 1, min: 0 }),
        xp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        type: new fields.StringField({ initial: "" }),
        temperament: new fields.StringField({ initial: "" }),
        ethosPurity: new fields.StringField({ initial: "neutral", choices: LASTARC.ethosPurity }),
        ethosMorality: new fields.StringField({ initial: "neutral", choices: LASTARC.ethosMorality }),
        size: new fields.StringField({ initial: "medium", choices: Object.keys(LASTARC.sizes) }),
        /** Fighting space in squares (NxN) and reach in squares (§3.2). */
        space: new fields.NumberField({ initial: 1, min: 0 }),
        reach: new fields.NumberField({ initial: 1, min: 0 }),
        senses: new fields.StringField({ initial: "" }),
        biography: new fields.HTMLField({ initial: "" })
      }),

      resources: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 10, integer: true }),
          max: new fields.NumberField({ initial: 10, integer: true }),
          temp: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        mp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true }),
          max: new fields.NumberField({ initial: 0, integer: true })
        })
      }),

      /**
       * Printed statblock defences — the UNBROKEN values. The Break Gauge
       * penalty is applied on top in prepareDerivedData, so `base` stays exactly
       * what the book says while `value` is what's live right now.
       */
      defences: new fields.SchemaField({
        ref: new fields.SchemaField({
          base: new fields.NumberField({ initial: 10, integer: true }),
          /**
           * Statblocks print a parenthetical flat-footed Reflex. Stored as an
           * explicit override rather than derived: NPC numbers are authored, and
           * `ref − max(0, agiMod)` does not always reproduce them.
           */
          flatFootedBase: new fields.NumberField({ initial: null, integer: true, nullable: true })
        }),
        fort: new fields.SchemaField({
          base: new fields.NumberField({ initial: 10, integer: true })
        }),
        will: new fields.SchemaField({
          base: new fields.NumberField({ initial: 10, integer: true })
        })
      }),

      breakGauge: new fields.SchemaField({
        step: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 5 }),
        persistentSteps: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 5 }),
        persistentSources: new fields.ArrayField(
          new fields.SchemaField({
            id: new fields.StringField(),
            label: new fields.StringField(),
            clearedBy: new fields.StringField({ initial: "" })
          }),
          { initial: [] }
        ),
        /**
         * Printed Threshold. Statblocks give this directly; when null we fall
         * back to deriving it from Fortitude so a partially-entered NPC still
         * behaves rather than reading 0.
         */
        thresholdBase: new fields.NumberField({ initial: null, integer: true, nullable: true }),
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
        /** Nonheroic use d10, beasts d8 (§3.2). Lowest acts first (§8). */
        die: new fields.StringField({ initial: "d10" }),
        bonusSteps: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      damageMods: new fields.SchemaField({
        resistance: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        immunity: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        weakness: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        dr: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      /**
       * Statblock attacks (§3.2).
       *
       * Stored on the actor rather than as weapon Items because a monster's
       * "Bite +8, 2d6+4 piercing" is an authored line, not a build: there is no
       * weapon to equip, no proficiency to check, and no Strength to add. The
       * printed damage is already the TOTAL, which is why nothing here goes
       * through `buildDamageTerms`.
       *
       * `atkBonus` follows the same convention as the printed defences — it is
       * the UNBROKEN number, with the Break Gauge applied on top in
       * prepareDerivedData.
       */
      attacks: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ initial: "" }),
          atkBonus: new fields.NumberField({ initial: 0, integer: true }),
          /** Dice half only, e.g. "2d6". Flat modifiers go in `damageBonus`. */
          damage: new fields.StringField({ initial: "1d6" }),
          damageBonus: new fields.NumberField({ initial: 0, integer: true }),
          damageType: new fields.StringField({
            initial: "blunt", choices: [...LASTARC.allDamageTypes]
          }),
          isMelee: new fields.BooleanField({ initial: true }),
          /** Area attacks can neither crit nor combo (§5.1). */
          isArea: new fields.BooleanField({ initial: false }),
          /** Squares. Melee uses reach; ranged uses range. */
          reach: new fields.NumberField({ initial: 1, min: 0 }),
          range: new fields.StringField({ initial: "" }),
          /** Multiattack: how many of these the creature makes per action. */
          count: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
          /** Optional rider applied to the target on a hit. */
          appliesStatus: new fields.StringField({
            initial: "", blank: true, choices: ["", ...LASTARC.allStatusIds]
          }),
          notes: new fields.StringField({ initial: "" })
        }),
        { initial: [] }
      ),

      /** Free-form statblock skill list: `{ key, value }`, printed totals. */
      skills: new fields.ArrayField(
        new fields.SchemaField({
          key: new fields.StringField({ initial: "" }),
          value: new fields.NumberField({ initial: 0, integer: true })
        }),
        { initial: [] }
      ),

      /** Statblock passive Perception, printed directly (§7 rev2). */
      passivePerception: new fields.NumberField({ initial: 10, integer: true }),

      /** Loot / Steal tables: item name + % chance (§3.2). */
      loot: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ initial: "" }),
          chance: new fields.NumberField({ initial: 100, min: 0, max: 100 })
        }),
        { initial: [] }
      ),
      steal: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ initial: "" }),
          chance: new fields.NumberField({ initial: 100, min: 0, max: 100 })
        }),
        { initial: [] }
      )
    };
  }

  prepareDerivedData() {
    for (const key of Object.keys(LASTARC.attributes)) {
      const attr = this.attributes[key];
      attr.total = attr.value;
      attr.mod = D.attributeModifier(attr.value, true);
    }

    const step = D.clampStep(this.breakGauge.step);
    const bp = D.breakPenaltyOrZero(step);

    this.breakGauge.penalty = bp;
    this.breakGauge.incapacitated = D.isIncapacitated(step) || this.resources.hp.value <= 0;

    // Printed values are unbroken; apply the gauge on top.
    this.defences.ref.value = this.defences.ref.base + bp;
    this.defences.fort.value = this.defences.fort.base + bp;
    this.defences.will.value = this.defences.will.base + bp;

    this.defences.ref.flatFooted =
      (this.defences.ref.flatFootedBase ?? (this.defences.ref.base - Math.max(0, this.attributes.agi.mod)))
      + bp;

    // Threshold: use the printed value when present, else derive from the LIVE
    // Fortitude so the death spiral still applies to hand-entered NPCs.
    this.breakGauge.threshold = this.breakGauge.thresholdBase !== null
      ? this.breakGauge.thresholdBase + bp
      : D.breakThreshold({ fort: this.defences.fort.value, size: this.details.size });

    // Printed attack bonuses are unbroken, exactly like the defences above.
    // `printed` is kept beside `total` so the sheet can show the book value and
    // the live value together — a GM comparing against the page needs both.
    for (const atk of this.attacks) {
      atk.printed = atk.atkBonus;
      atk.total = atk.atkBonus + bp;
      atk.damageFormula = atk.damageBonus
        ? `${atk.damage}${atk.damageBonus > 0 ? "+" : ""}${atk.damageBonus}`
        : atk.damage;
    }

    this.resources.hp.value = Math.clamp(this.resources.hp.value, 0, this.resources.hp.max);
    this.resources.mp.value = Math.clamp(this.resources.mp.value, 0, this.resources.mp.max);

    this.movement.value = this.movement.base;

    try {
      this.initiative.effectiveDie = D.improvedInitiativeDie(
        this.initiative.die, this.initiative.bonusSteps
      );
    } catch {
      this.initiative.effectiveDie = this.initiative.die;
    }

    this.details.spaceFromSize = LASTARC.sizes[this.details.size]?.space ?? 1;
  }
}
