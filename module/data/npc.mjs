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
          /**
           * Printed range text, e.g. "60/120". Display only — kept because a
           * statblock's own wording is often not four clean numbers, and the
           * GM should not have to normalise the page to record it.
           */
          range: new fields.StringField({ initial: "" }),
          /**
           * Range increments in squares, so a statblock attack can offer the
           * same band picker a player gets (#43).
           *
           * TYPED, not derived. A character's bands come from the weapon's size
           * via one table in the book; a monster's are whatever the statblock
           * prints, and there is no size row that reproduces "40/80/160/320"
           * for a specific creature. The GM asked to "manually dictate the
           * range increments" and that is the honest shape for printed data.
           *
           * All zero means "no bands recorded" and the picker stays away — an
           * attack that has never been given increments must not start
           * demanding one before every roll.
           */
          rangeBands: new fields.SchemaField(
            /**
             * Generated from `LASTARC.rangeBands`, which is also what the sheet
             * loops over to draw the boxes. ONE list, so a band cannot exist in
             * the schema with no input or in the editor with nowhere to store.
             * Two hand-kept copies is how this codebase shipped two `choices`
             * arrays nobody could reach (issue #32).
             */
            Object.fromEntries(Object.keys(LASTARC.rangeBands).map((key) => [
              key, new fields.NumberField({ initial: 0, integer: true, min: 0 })
            ]))
          ),
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

    /**
     * STATUSES APPLY TO MONSTERS TOO.
     *
     * They did not. Statuses were wired into character derivation and never
     * here, so every derived consequence was inert on a statblock: a boss under
     * Exhaustion kept its full defences, a withered one kept its full hit
     * points, a grabbed one attacked at its full printed bonus.
     *
     * The affordance was the damning part — the NPC sheet carries the whole
     * status palette, so a GM could click any of the thirty-three onto a
     * monster, watch the icon appear on the token, and get no arithmetic at all.
     *
     * The DAMAGE side always worked, because `applyDamage` and `rollHealing`
     * read `target.statuses` directly rather than going through a data model.
     * That split is why this survived: half the feature was visibly fine.
     */
    const statuses = D.aggregateStatuses(this.parent?.statuses ?? []);
    this.statuses = statuses;

    this.breakGauge.penalty = bp;
    this.breakGauge.incapacitated =
      D.isIncapacitated(step) || this.resources.hp.value <= 0 || statuses.noActions;

    // Printed values are unbroken; the gauge and any status penalties ride on
    // top. Statuses are added here rather than subtracted from the finished
    // total for the same reason as on a character: Threshold reads Fortitude.
    this.defences.fort.value = this.defences.fort.base + bp + statuses.defences.fort;
    this.defences.will.value = this.defences.will.base + bp + statuses.defences.will;

    /**
     * Reflex has three interacting status rules and is therefore computed
     * whole, in the Foundry-free module, rather than by a sequence of `if`s
     * here — see `printedReflex`.
     *
     * That is not tidiness. The first version of this lived inline with an
     * `if (statuses.agiOverride != null)` around it, and the guard meant to
     * protect it was a source scan for the helper's name. Mutating the
     * condition to `if (false)` left the name in place and the suite stayed
     * green. A branch a test cannot reach is a branch a test cannot defend.
     */
    const ref = D.printedReflex({
      printed: this.defences.ref.base,
      flatFootedBase: this.defences.ref.flatFootedBase,
      agiMod: this.attributes.agi.mod,
      breakPenalty: bp,
      statusDefence: statuses.defences.ref,
      agiDenied: statuses.agiDenied,
      agiOverride: statuses.agiOverride
    });
    this.defences.ref.value = ref.value;
    this.defences.ref.flatFooted = ref.flatFooted;

    /**
     * Threshold: the printed value when present, else derived from the
     * UNBROKEN Fortitude (issue #7).
     *
     * Both branches used to add the break penalty, on the reasoning that
     * Threshold is Fortitude and Fortitude falls with the gauge. The book's
     * penalty is enumerated as applying to attack rolls, skill checks,
     * attribute checks and defences, and Threshold is in none of those — so a
     * statblock's printed Threshold is simply its Threshold, broken or not.
     *
     * Deliberately NOT gated on breakGaugeAffectsThreshold: a printed
     * statblock number is an authored constant, and a world setting has no
     * business rewriting what the page says.
     */
    this.breakGauge.threshold = this.breakGauge.thresholdBase !== null
      ? this.breakGauge.thresholdBase
      : D.breakThreshold({ fort: this.defences.fort.base, size: this.details.size });

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

    /**
     * WITHERING AND DIM ARE NOT APPLIED HERE, deliberately.
     *
     * They halve maximum HP and MP, and on a character that is safe because the
     * maximum is derived. On a statblock it is PRINTED, with an input on the
     * sheet — so writing it in `prepareDerivedData` would store the GM's number
     * and show a halved one back, which is the exact defect CLAUDE.md rule 4
     * exists for and which has shipped twice already.
     *
     * Caught by `test/derived-binding.test.mjs` the moment it was written, which
     * is the guard doing its job on the person who added it.
     *
     * Doing this properly needs an `effectiveMax` beside the printed one and
     * every consumer moved onto it. Until then the GM halves the printed
     * maximum by hand — the status icon on the token is the reminder.
     */
    this.resources.hp.value = Math.clamp(this.resources.hp.value, 0, this.resources.hp.max);
    this.resources.mp.value = Math.clamp(this.resources.mp.value, 0, this.resources.mp.max);

    /**
     * Movement. A statblock has no encumbrance — it carries no inventory — so
     * this is the status half of the character's calculation and nothing else.
     * Slow halves to a MINIMUM of one square (§12), which is a stated rule
     * rather than a rounding artefact.
     */
    if (statuses.speedZero) {
      this.movement.value = 0;
    } else {
      this.movement.value = D.speedAfterPenalties(
        this.movement.base,
        statuses.speedReduction ? [statuses.speedReduction] : []
      );
      if (statuses.speedMultiplier || statuses.speedMinimum) {
        const scaled = Math.floor(this.movement.value * (statuses.speedMultiplier ?? 1));
        this.movement.value = Math.max(statuses.speedMinimum ?? 0, scaled);
      }
      // `fly` and `hover` are authored inputs on a statblock, not derived
      // values, so `blocksFlying` cannot be applied by writing them — same
      // rule-4 reason as the maxima above.
    }

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
