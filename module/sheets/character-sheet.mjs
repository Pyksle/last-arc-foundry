/**
 * Character sheet — ApplicationV2 (§16 rev2).
 *
 * Built on ActorSheetV2 + HandlebarsApplicationMixin. The V1 Application family
 * is deprecated as of v12 and slated for removal in v16; starting here avoids a
 * rewrite later.
 *
 * Layout follows the printed character sheet (book p.263) closely enough that a
 * player can move between paper and VTT without relearning where things are:
 * attributes in book order (Str·Vit·Agi·Int·Mnd·Chr), defences with their
 * Level/Attrib/Class/Tech/Bonus breakdown, skills with the five printed columns,
 * and the Break Gauge as a horizontal track rather than a number field.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollSkill, rollAttribute } from "../dice/rolls.mjs";
import { rollAttack, defenceToBeat, weaponProfileFor } from "../dice/attack.mjs";
import { castSpell, performItem, performancesDisplacedBy } from "../dice/magic.mjs";
import { heroPointDefenceBoost } from "../dice/hero-points.mjs";
import * as AE from "../action-economy.mjs";
import { getTurnState, setTurnState, holdTurn, resetActions } from "../combat.mjs";
import { promptCreateItem } from "./item-creation.mjs";
import { shareItem } from "../dice/share-item.mjs";
import { orderBySort } from "../item-order.mjs";
import { markOrder, moveItem } from "./reorder.mjs";
import { markStatuses, toggleStatus } from "./status-palette.mjs";
import { situationalOptions } from "../dice/situational.mjs";
import { applyHealing } from "../dice/healing.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class LastArcCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["last-arc", "sheet", "actor", "character"],
    position: { width: 960, height: 820 },
    window: { resizable: true, contentClasses: ["last-arc-sheet-body"] },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollSkill: LastArcCharacterSheet.#onRollSkill,
      rollAttribute: LastArcCharacterSheet.#onRollAttribute,
      setBreakStep: LastArcCharacterSheet.#onSetBreakStep,
      bankRecovery: LastArcCharacterSheet.#onBankRecovery,
      secondWind: LastArcCharacterSheet.#onSecondWind,
      setSecondWind: LastArcCharacterSheet.#onSetSecondWind,
      takeRest: LastArcCharacterSheet.#onTakeRest,
      addClass: LastArcCharacterSheet.#onAddClass,
      removeClass: LastArcCharacterSheet.#onRemoveClass,
      createItem: LastArcCharacterSheet.#onCreateItem,
      shareItem: LastArcCharacterSheet.#onShareItem,
      editItem: LastArcCharacterSheet.#onEditItem,
      deleteItem: LastArcCharacterSheet.#onDeleteItem,
      moveItem: LastArcCharacterSheet.#onMoveItem,
      toggleEquip: LastArcCharacterSheet.#onToggleEquip,
      rollAttack: LastArcCharacterSheet.#onRollAttack,
      castSpell: LastArcCharacterSheet.#onCastSpell,
      performItem: LastArcCharacterSheet.#onPerform,
      addPersistent: LastArcCharacterSheet.#onAddPersistent,
      clearPersistent: LastArcCharacterSheet.#onClearPersistent,
      heroBoost: LastArcCharacterSheet.#onHeroBoost,
      toggleSlot: LastArcCharacterSheet.#onToggleSlot,
      bankAim: LastArcCharacterSheet.#onBankAim,
      holdTurn: LastArcCharacterSheet.#onHoldTurn,
      resetActions: LastArcCharacterSheet.#onResetActions,
      toggleStatus: LastArcCharacterSheet.#onToggleStatus,
      toggleProficiency: LastArcCharacterSheet.#onToggleProficiency,
      toggleTechnickActive: LastArcCharacterSheet.#onToggleTechnickActive
    }
  };

  static PARTS = {
    header: { template: "systems/last-arc/templates/actor/character-header.hbs" },
    body: {
      template: "systems/last-arc/templates/actor/character-body.hbs",
      scrollable: [""]
    }
  };

  /* ------------------------------------------------------------------------ */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;

    /**
     * STORED values, before Active Effects and before derivation (issue #28).
     *
     * Anything rendered into an <input> must come from here, never from the
     * prepared model. CLAUDE.md already says a derived value must not have an
     * input; the same is true of any path an ACTIVE EFFECT feeds, and effects
     * are fed deliberately into `misc` and attribute values by design.
     *
     * The failure is a ratchet, not a wrong number: the box shows the value
     * WITH the effect applied, `submitOnChange` writes that back on the next
     * change to anything on the sheet, and the effect then applies again on top
     * of its own result. Reported as a permanent, creeping Will bonus that
     * appeared while clicking the proficiency toggles — the toggles were
     * innocent, they were just submitting the form repeatedly.
     */
    const src = this.document.system._source;

    /**
     * Flight and hover are ZEROED by derivation when the character is
     * overencumbered or speed-locked (§4.6). Rendering the prepared value into
     * the input meant that, while encumbered, any submit wrote those zeros to
     * storage — so dropping the load did not give the flight speed back. It was
     * gone. Same defect as the Will ratchet, running the other way.
     */
    context.movementInput = {
      fly: src.movement?.fly ?? 0,
      hover: !!src.movement?.hover
    };

    context.system = sys;
    context.config = LASTARC;
    context.editable = this.isEditable;

    // The schema, so {{formInput}} can build a <prose-mirror> for biography.
    // An HTMLField has no sensible hand-written equivalent.
    context.fields = sys.schema.fields;
    context.enrichedBiography = await foundry.applications.ux.TextEditor
      .implementation.enrichHTML(sys.details.biography ?? "", { relativeTo: this.document });

    // An ArrayField of strings, shown as one comma box (issue #14). Unpacked
    // here and repacked in _prepareSubmitData — a `name` pointing straight at
    // the array would store the raw string and quietly lose it.
    context.languagesText = (sys.details.languages ?? []).join(", ");

    /**
     * Proficiencies (issue #21). Both of these are ArrayFields of category
     * keys that WERE ALREADY BEING READ — `proficiencies.weapons` costs −5 on
     * every attack with a weapon whose category is missing, and
     * `proficiencies.armour` decides whether the armour check penalty applies
     * to every Str- and Agi-based skill. Neither had an input anywhere, so
     * every character was non-proficient with every weapon, permanently.
     *
     * Checkboxes rather than a comma box: both are closed sets of eight and
     * three, and asking a player to type `bludgeons` correctly to stop losing
     * 5 from their attacks is a trap. Repacked in _prepareSubmitData.
     */
    const weaponProf = sys.proficiencies.weapons ?? [];
    context.weaponProficiencies = LASTARC.weaponCategories.map((key) => ({
      key,
      label: `LASTARC.WeaponCategory.${key}`,
      active: weaponProf.includes(key)
    }));

    const armourProf = sys.proficiencies.armour ?? [];
    context.armourProficiencies = Object.keys(LASTARC.armourTypes).map((key) => ({
      key,
      label: `LASTARC.ArmourType.${key}`,
      active: armourProf.includes(key)
    }));

    // Attributes in PRINTED order, not object-key order (§2 rev2).
    context.attributes = LASTARC.attributeOrder.map((key) => ({
      key,
      label: LASTARC.attributes[key].label,
      abbr: LASTARC.attributes[key].abbr,
      ...sys.attributes[key],
      // Attributes are the commonest Active Effect target of all.
      valueInput: src.attributes[key]?.value ?? 0,
      racialModInput: src.attributes[key]?.racialMod ?? 0,
      capInput: src.attributes[key]?.cap ?? null
    }));

    // Skills, standard then weapon, each carrying the five printed columns.
    //
    // The printed columns do NOT account for everything in the total: the Break
    // Gauge penalty, the armour check penalty, technick bonuses and granted
    // training/focus all land in the score without a column of their own. That
    // made the sheet look broken — a row could show 2 + 1 and total +1 — so
    // everything unprinted is gathered into a single `adjustment` column with
    // an itemised tooltip. The invariant is now:
    //
    //   total = halfLevel + attrMod + trainedShown + focus + misc + adjustment
    //
    // `skillBreakdown` asserts exactly that, and a unit test pins it.
    const halfLevel = D.rd(sys.details.level / 2);
    const breakPenalty = sys.breakGauge.penalty;


    const toRow = (key, cfg) => {
      const s = sys.skills[key];
      const parts = D.skillAdjustmentParts(s, breakPenalty);
      const adjustment = parts.reduce((sum, p) => sum + p.value, 0);

      return {
        key,
        label: cfg.label,
        attr: cfg.attr,
        attrAbbr: LASTARC.attributes[cfg.attr].abbr,
        isWeaponSkill: !!cfg.weapon,
        trained: s.trained,
        focus: s.focus,
        misc: s.misc,
        miscInput: src.skills[key]?.misc ?? 0,
        total: s.total,
        appliesArmourPenalty: s.appliesArmourPenalty,
        halfLevel,
        attrMod: sys.attributes[cfg.attr].mod,
        adjustment,
        hasAdjustment: adjustment !== 0,
        adjustmentTooltip: parts.length
          ? parts.map((p) => `${game.i18n.localize(p.label)} ${D.signed(p.value)}`).join(" · ")
          : game.i18n.localize("LASTARC.Tooltip.NoAdjustments"),
      };
    };

    context.skills = Object.entries(LASTARC.skills).map(([k, c]) => toRow(k, c));
    context.weaponSkills = Object.entries(LASTARC.weaponSkills).map(([k, c]) => toRow(k, c));
    context.passivePerception = sys.skills.perception.passive;

    // Break Gauge track: one cell per step, 0..5.
    context.breakTrack = LASTARC.breakPenalties.map((penalty, step) => ({
      step,
      penalty,
      isCurrent: step === sys.breakGauge.step,
      isPassed: step < sys.breakGauge.step,
      isPersistent: step > 0 && step <= sys.breakGauge.persistentSteps,
      isTerminal: penalty === null,
      label: penalty === null
        ? game.i18n.localize("LASTARC.Break.Unconscious")
        : penalty === 0
          ? game.i18n.localize("LASTARC.Break.Normal")
          : `−${Math.abs(penalty)}`
    }));

    // Shake it Off can lower this, so read the derived value rather than the
    // config constant.
    context.recoveryTarget = sys.breakGauge.recoveryRequired ?? LASTARC.recoveryMinorActions;

    context.persistentSources = sys.breakGauge.persistentSources
      .map((s, index) => ({ ...s, index }));

    // One checkbox per Second Wind use (issue #10). `max` is derived — Extra
    // Second Wind grants more — so the row grows and shrinks with the build
    // rather than being a fixed pair of boxes.
    const wind = sys.resources.secondWind;
    context.secondWindPips = Array.from({ length: wind.max }, (_, index) => ({
      index,
      spent: index < wind.used,
      label: game.i18n.format("LASTARC.Resource.SecondWindUseN", { n: index + 1 })
    }));

    // Gauge fills. Computed here rather than in CSS because both need a
    // divide-by-zero guard and a clamp — a character with 0 max MP must not
    // produce NaN%, and temp HP can push the current value above max.
    const pct = (value, max) =>
      max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
    context.hpPercent = pct(sys.resources.hp.value, sys.resources.hp.max);
    context.mpPercent = pct(sys.resources.mp.value, sys.resources.mp.max);

    context.canSpendHero = (sys.resources.heroPoints.value ?? 0) > 0;
    // Surfaced explicitly because §12 flags this interaction: misfortune forbids
    // rerolling d20s, which silently removes one of the four hero point spends.
    context.misfortuneBlocksReroll = !!sys.statuses?.blocksD20Reroll;

    context.defenceRows = ["ref", "fort", "will"].map((key) => ({
      key,
      label: `LASTARC.Defence.${key}`,
      ...sys.defences[key],
      miscInput: src.defences[key]?.misc ?? 0
    }));

    context.classOptions = Object.entries(LASTARC.classes)
      .map(([k, c]) => ({ value: k, label: c.label }));

    // `isFirst` drives the label — entry 0 grants the level-1 HP/MP values and,
    // by default, the only set of class defence bonuses, so it is not
    // interchangeable with the others.
    context.classes = sys.classes.map((c, index) => ({
      ...c,
      index,
      isFirst: index === 0,
      isOnly: sys.classes.length === 1
    }));
    context.sizeOptions = LASTARC.sizeOrder
      .map((k) => ({ value: k, label: LASTARC.sizes[k].label }));
    // Built as {value,label} pairs rather than bare strings so the template does
    // not need a `concat` helper to assemble localisation keys.
    context.ethosPurityOptions = LASTARC.ethosPurity
      .map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` }));
    context.ethosMoralityOptions = LASTARC.ethosMorality
      .map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` }));


    this.#prepareItems(context, sys);
    context.actionEconomy = this.#prepareActionEconomy();

    return context;
  }

  /**
   * Repack the comma box back into the ArrayField it stands for.
   *
   * Without this the extra key is simply dropped on update, so the box accepts
   * typing and forgets it the moment the sheet re-renders — the same silent
   * failure the item sheet's `*Text` fields exist to avoid.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const submit = super._prepareSubmitData(event, form, formData, updateData);

    const raw = submit["system.details.languagesText"];
    if (typeof raw === "string") {
      submit["system.details.languages"] =
        raw.split(",").map((s) => s.trim()).filter(Boolean);
      delete submit["system.details.languagesText"];
    }

    /**
     * Proficiencies used to be repacked here from a grid of checkboxes named
     * `...weaponsChoice.<key>`. They are toggle buttons now and write their own
     * arrays, so there is nothing left to repack — see #onToggleProficiency.
     */
    return submit;
  }

  /**
   * Action economy panel, shown only while this actor is in an active combat.
   *
   * The state lives on the COMBATANT, not the actor — the same actor can be in
   * two combats, and action slots are per-encounter. Returns null when not in
   * combat so the template can omit the whole panel rather than show an inert one.
   */
  #prepareActionEconomy() {
    const combatant = game.combat?.getCombatantByActor?.(this.document.id);
    if (!combatant) return null;

    const state = getTurnState(combatant);
    const bankedFor = state.bankedFor;
    const sequence = bankedFor ? AE.SEQUENCES[bankedFor] : null;

    // Shake it Off lowers the Recovery requirement, so read the derived value.
    const required = bankedFor === "recovery"
      ? (this.document.system.breakGauge.recoveryRequired ?? sequence?.minors)
      : sequence?.minors;

    return {
      slots: [
        { key: "primary", label: "LASTARC.Action.Primary",
          tooltip: "LASTARC.Tooltip.SlotPrimary", available: state.primary },
        { key: "secondary", label: "LASTARC.Action.Secondary",
          tooltip: "LASTARC.Tooltip.SlotSecondary", available: state.secondary },
        { key: "minor", label: "LASTARC.Action.Minor",
          tooltip: "LASTARC.Tooltip.SlotMinor", available: state.minor }
      ],
      availableMinors: AE.availableMinors(state),
      banked: {
        active: !!bankedFor,
        label: sequence?.label,
        count: state.bankedMinors,
        required,
        // One pip per required minor, filled to the current count.
        pips: Array.from({ length: required ?? 0 }, (_, i) => i < state.bankedMinors)
      },
      reactionUsed: state.reactionUsed,
      reactionsBlocked: this.document.statuses?.has("flatFooted") ?? false
    };
  }

  /**
   * Split owned items into technicks/talents and carried inventory.
   *
   * Prerequisites are re-checked here rather than trusted from when the item was
   * added: a character can lose a prerequisite afterwards — an attribute drain,
   * a removed feeding technick, a class change — and a technick whose
   * requirements no longer hold should say so rather than quietly keep granting.
   */
  #prepareItems(context, sys) {
    const snapshot = sys.prerequisiteSnapshot();
    const technicks = [];
    const inventory = [];
    const spells = [];
    const performances = [];
    const features = [];

    const EQUIPPABLE = new Set(["weapon", "armour", "shield", "accessory", "prostheticLimb"]);

    // Ordered ONCE, here, so every panel below inherits the player's manual
    // order (issue #9). Sorting inside each branch instead would be four
    // chances to forget one.
    for (const item of orderBySort([...this.document.items])) {
      // Race and class Items used to be dropped here as "redundant", on the
      // grounds that the header already reads system.details.race and
      // system.classes. That was wrong twice over: #onHeroBoost reads a race
      // item's slug for the Grassrunner reroll, so such an item is
      // mechanically live while being invisible; and a player transcribing
      // their race's features from the book had nowhere to put them and no
      // sign the import had worked.
      if (item.type === "feature" || item.type === "race" || item.type === "class") {
        features.push({
          id: item.id,
          name: item.name,
          img: item.img,
          // A feature says where it came from; a legacy race/class item just
          // says what it is.
          typeLabel: item.type === "feature"
            ? game.i18n.localize(`LASTARC.FeatureCategory.${item.system.category}`)
            : game.i18n.localize(`TYPES.Item.${item.type}`),
          summary: this.#grantSummary(item.system.grants),
          // Whole-race and whole-class items predate the feature subtype and
          // contribute nothing, so say so rather than let them sit there
          // looking mechanical (issue #8).
          isLegacy: item.type !== "feature"
        });
        continue;
      }

      if (item.type === "spell") {
        spells.push({
          id: item.id,
          name: item.name,
          img: item.img,
          school: item.system.school,
          schoolLabel: game.i18n.localize(`LASTARC.School.${item.system.school}`),
          mpCost: item.system.mpCost,
          castingTimeLabel: game.i18n.localize(
            LASTARC.castingTimes[item.system.castingTime]?.label ?? ""
          ),
          target: item.system.target,
          affordable: (sys.resources.mp?.value ?? 0) >= item.system.mpCost
        });
        continue;
      }

      if (item.type === "performance") {
        performances.push({
          id: item.id,
          name: item.name,
          img: item.img,
          mpCost: item.system.mpCost,
          specialisation: item.system.specialisation,
          affordable: (sys.resources.mp?.value ?? 0) >= item.system.mpCost
        });
        continue;
      }

      if (item.type === "technick" || item.type === "talent") {
        const check = D.checkPrerequisites(item.system.prerequisites, snapshot);
        technicks.push({
          id: item.id,
          name: item.name,
          img: item.img,
          kindLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
          summary: this.#grantSummary(item.system.grants),
          prereqsMet: check.met,
          unmetText: check.unmet.join(", "),
          /**
           * Whether this technick is in effect right now. Surfaced on the ROW
           * rather than only on the item sheet because the technicks that need
           * switching are the conditional ones, and their condition changes
           * mid-turn — opening an item sheet to toggle Backstab between two
           * attacks is not something anybody will do twice.
           */
          active: item.system.active !== false,
          /** Only worth switching if the technick actually does something. */
          hasFlags: (item.system.flags?.length ?? 0) > 0
        });
        continue;
      }

      // THE SILENT DROP. This line used to be the only fallthrough, so every
      // subtype without a bulk value vanished from the sheet without trace —
      // a spell added to a character was simply not there. Every declared
      // subtype now has a panel, so anything reaching here is a new subtype
      // that nobody gave a home to, and it says so.
      if (typeof item.system?.bulk !== "number") {
        console.warn(
          `Last Arc | "${item.name}" (${item.type}) has no bulk and no panel, so it ` +
          `will not appear on the sheet. Give it a branch in #prepareItems and a ` +
          `group in LASTARC.itemCreationGroups.`
        );
        continue;
      }

      inventory.push({
        id: item.id,
        name: item.name,
        img: item.img,
        typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
        quantity: item.system.quantity > 1 ? item.system.quantity : null,
        totalBulk: Math.round((item.system.bulk * (item.system.quantity ?? 1)) * 10) / 10,
        equipped: !!item.system.equipped,
        equippable: EQUIPPABLE.has(item.type),
        broken: item.system.breakGauge?.destroyed
      });
    }

    context.technicks = technicks;
    context.inventory = inventory;
    context.spells = spells;
    context.performances = performances;
    context.features = features;
    context.attacks = this.#prepareAttacks(sys);

    // Reorder controls, and the order the reorder handler will work against.
    // Recorded from the rendered arrays rather than recomputed later, so the
    // handler and the list on screen cannot disagree about what "next" means.
    markOrder(this, { attacks: context.attacks, spells, performances, technicks, features, inventory });
    markStatuses(context, this.document);

    /**
     * Read straight off the derived model rather than recomputed here (issue
     * #33). Both limits are gated on a repeatable technick and on Intelligence,
     * and a second implementation on the sheet would be a second place for the
     * gate to be forgotten — which is how the old flat `1 + Int` came to be
     * handed to characters who had never taken Arcane Study.
     */
    context.study = sys.study;
    context.noArcaneStudy = sys.study.spells.takings === 0;
    context.noBardicStudy = sys.study.performances.takings === 0;
    context.highArcanaOptions = LASTARC.highArcanaIds.map((id) => ({
      value: id, label: game.i18n.localize(LASTARC.highArcana[id].label)
    }));
    context.bulkState = sys.bulk.state === "none" ? null : sys.bulk.state;
    context.bulkStateLabel = context.bulkState ? `LASTARC.Status.${context.bulkState}` : null;
  }

  /**
   * Build the attack line for each equipped weapon.
   *
   * Wield category is computed here, per weapon, against THIS actor's size — it
   * is never stored on the item, because the same weapon is a different thing in
   * a Small character's hands than a Large one's (§5.4). A weapon two or more
   * size categories larger is unusable, and the row is disabled rather than
   * hidden so the player can see why.
   */
  #prepareAttacks(sys) {
    const out = [];

    // Same manual order as every other panel (issue #9). Iterating the raw
    // collection here would have left the Attacks panel rendering in database
    // order while its own arrows wrote sort values nothing read back.
    for (const item of orderBySort([...this.document.items])) {
      if (item.type !== "weapon" || !item.system.equipped) continue;

      /**
       * The SAME profile `rollAttack` uses. This row used to compute its own
       * skill choice and its own damage terms, and had drifted from the dice in
       * four places at once (issue #40) — most visibly a Spellcraft wand
       * advertising the ranged skill's +2 against the +13 it actually rolled.
       *
       * Nothing about the numbers below may be computed here. If the row needs
       * a term the dice do not have, it belongs in `weaponAttackProfile` where
       * both halves can see it.
       */
      const profile = weaponProfileFor(this.document, item);
      const { wield, unusable } = profile;

      out.push({
        id: item.id,
        name: item.name,
        img: item.img,
        unusable,
        wieldLabel: LASTARC.wieldLabels[wield],
        wieldTooltip: unusable ? "LASTARC.Tooltip.WeaponUnusable" : "LASTARC.Tooltip.WieldDerived",
        atkTotal: profile.attack.total,
        // Which skill the row's number came from, so a player can see WHY a
        // wand reads +13 rather than being asked to take it on trust.
        skillLabel: profile.skillKey ? `LASTARC.Skill.${profile.skillKey}` : "",
        damage: item.system.damage,
        damageFlat: profile.damage.flat,
        /**
         * ALL of them, not the first. A weapon may carry several and the row
         * showed only `[0]`, so a "Piercing or Slashing" polearm advertised
         * itself as one type while the player got to choose the other at roll
         * time — the row and the dice disagreeing about the same weapon.
         */
        damageTypeLabels: (item.system.damageType?.length
          ? item.system.damageType
          : ["blunt"]).map((t) => `LASTARC.DamageType.${t}`)
      });
    }

    return out;
  }

  /** One-line human summary of a technick's numeric payload, for the list row. */
  #grantSummary(grants) {
    if (!grants) return "";
    const parts = [];
    const sign = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

    for (const key of ["ref", "fort", "will"]) {
      if (grants.defences?.[key]) {
        parts.push(`${sign(grants.defences[key])} ${game.i18n.localize(`LASTARC.Defence.${key}`)}`);
      }
    }
    if (grants.breakThreshold) parts.push(`${sign(grants.breakThreshold)} Threshold`);
    if (grants.heroPoints) parts.push(`${sign(grants.heroPoints)} Hero Points`);
    if (grants.initiativeSteps) parts.push(`Init −${grants.initiativeSteps} step`);
    if (grants.speed) parts.push(`${sign(grants.speed)} Speed`);
    for (const s of grants.skills ?? []) {
      const label = game.i18n.localize(LASTARC.allSkills[s.key]?.label ?? s.key);
      if (s.focus) parts.push(`${sign(s.focus)} ${label} focus`);
      if (s.bonus) parts.push(`${sign(s.bonus)} ${label}`);
      if (s.trained) parts.push(`trained: ${label}`);
    }
    return parts.join(" · ");
  }

  /* ------------------------------------------------------------------------ */
  /*  Actions                                                                  */
  /* ------------------------------------------------------------------------ */

  static async #onRollSkill(event, target) {
    const { skill } = target.dataset;
    // Alt-click asks for a situational modifier first; a dismissed prompt
    // cancels the roll rather than rolling at +0 (issue #16).
    const extra = await situationalOptions(event);
    if (extra === null) return;

    await rollSkill(this.document, skill, extra);
  }

  static async #onRollAttribute(event, target) {
    const extra = await situationalOptions(event);
    if (extra === null) return;

    await rollAttribute(this.document, target.dataset.attribute, extra);
  }

  /**
   * Set the Break Gauge directly by clicking a cell.
   *
   * Goes through the derivation helpers rather than writing `step` raw, so the
   * `persistentSteps ≤ step` invariant and the 0..5 clamp are enforced in one
   * place. Clicking at or below the persistent floor is refused with a reason —
   * silently ignoring the click reads as a broken UI.
   */
  static async #onSetBreakStep(event, target) {
    const requested = Number(target.dataset.step);
    const sys = this.document.system;

    if (requested < sys.breakGauge.persistentSteps) {
      ui.notifications?.warn(
        game.i18n.format("LASTARC.Warning.PersistentFloor", {
          steps: sys.breakGauge.persistentSteps
        })
      );
      return;
    }

    const next = D.reconcilePersistent(requested, sys.breakGauge.persistentSteps);
    await this.document.update({
      "system.breakGauge.step": next.step,
      "system.breakGauge.recoveryProgress": 0   // any change interrupts a banked Recovery
    });
  }

  /**
   * Bank one minor action toward a Recovery action.
   *
   * The interrupt rule is the fiddly part (§9): three CONSECUTIVE minor actions,
   * and any intervening action — including a reaction — resets progress to 0.
   * Nobody tracks this by hand, which is exactly why it belongs in the UI.
   */
  static async #onBankRecovery(event, target) {
    const sys = this.document.system;

    // Disease blocks recovery actions outright (§12), independently of the
    // persistent floor.
    if (sys.breakGauge.recoveryBlocked) {
      ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.RecoveryDisabled"));
      return;
    }

    const required = sys.breakGauge.recoveryRequired ?? LASTARC.recoveryMinorActions;
    const banked = sys.breakGauge.recoveryProgress + 1;

    if (banked < required) {
      await this.document.update({ "system.breakGauge.recoveryProgress": banked });
      ui.notifications?.info(
        game.i18n.format("LASTARC.Info.RecoveryBanked", { banked, required })
      );
      return;
    }

    const improved = D.improveStep(sys.breakGauge.step, 1, sys.breakGauge.persistentSteps);
    await this.document.update({
      "system.breakGauge.step": improved,
      "system.breakGauge.recoveryProgress": 0
    });

    if (improved === sys.breakGauge.step) {
      ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.RecoveryBlocked"));
    }
  }

  /**
   * Add a named persistent Break condition.
   *
   * Adding one WORSENS the gauge if the character is not already at least that
   * far down — a persistent step is a step, not just a floor. The
   * `persistentSteps ≤ step` invariant is enforced by `reconcilePersistent`
   * rather than by arithmetic here.
   */
  /**
   * Spend a hero point to add an exploding 1d6 to a defence until the start of
   * your next turn (§13).
   *
   * Boosting Fortitude also raises Break Threshold when
   * `heroPointAffectsThreshold` is on, since Threshold is defined as Fortitude
   * and derived live — that is §15 A2, and it means this button can be used
   * reactively to shrug off an incoming hit.
   */
  /**
   * Toggle a slot by hand.
   *
   * Restoring a slot deliberately does NOT restore banked minor progress — an
   * interrupted sequence is interrupted, and un-spending the action that broke
   * it does not un-break it. GMs correcting a misclick can use Reset.
   */
  static async #onToggleSlot(event, target) {
    const combatant = game.combat?.getCombatantByActor?.(this.document.id);
    if (!combatant) return;

    const slot = target.dataset.slot;
    const state = getTurnState(combatant);
    await setTurnState(combatant, { ...state, [slot]: !state[slot] });
    this.render();
  }

  static async #onBankAim(event, target) {
    const combatant = game.combat?.getCombatantByActor?.(this.document.id);
    if (!combatant) return;

    const state = getTurnState(combatant);
    const before = state.bankedMinors;
    const result = AE.spend(state, { type: "minor", banks: "aim" });

    if (!result.ok) {
      ui.notifications?.warn(game.i18n.localize(result.reason));
      return;
    }
    await setTurnState(combatant, result.state);

    if (before > 0 && result.state.bankedFor !== state.bankedFor) {
      ui.notifications?.info(
        game.i18n.format("LASTARC.Action.SequenceInterrupted", { banked: before })
      );
    }
    this.render();
  }

  static async #onHoldTurn(event, target) {
    const combatant = game.combat?.getCombatantByActor?.(this.document.id);
    if (!combatant) return;
    await holdTurn(combatant);
    this.render();
  }

  static async #onResetActions(event, target) {
    const combatant = game.combat?.getCombatantByActor?.(this.document.id);
    if (!combatant) return;
    await resetActions(combatant);
    this.render();
  }

  static async #onToggleStatus(event, target) {
    await toggleStatus(this, target);
  }

  /**
   * Toggle one weapon category, armour type, or shield proficiency (#28).
   *
   * Writes the document directly rather than going through the form. The grid
   * shipped in 0.12.0 as bound checkboxes repacked in `_prepareSubmitData`, and
   * that had two failure modes at once: `submitOnChange` re-renders the sheet
   * on every change, so a tick could be lost to the re-render — reported as
   * "not staying selected", and intermittent exactly as a race is — and the
   * repack itself assumed a shape for the submit data that could not be
   * verified without a live Foundry. Neither risk survives writing the array
   * here.
   *
   * Rebuilt by adding or removing the one key, so unticking genuinely removes
   * it; a merge would make proficiency additive and impossible to take away.
   */
  static async #onToggleProficiency(event, target) {
    const { prof, key } = target.dataset;

    if (prof === "shields") {
      await this.document.update({
        "system.proficiencies.shields": !this.document.system.proficiencies.shields
      });
      return;
    }

    const valid = prof === "weapons"
      ? LASTARC.weaponCategories
      : prof === "armour" ? Object.keys(LASTARC.armourTypes) : null;

    // Checked against the config rather than trusted from the markup: an
    // unrecognised key would otherwise be stored and then silently fail to
    // match any weapon, which looks exactly like the button doing nothing.
    if (!valid || !valid.includes(key)) {
      console.warn(`Last Arc | "${prof}/${key}" is not a proficiency; nothing toggled.`);
      return;
    }

    const current = this.document.system.proficiencies[prof] ?? [];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];

    await this.document.update({ [`system.proficiencies.${prof}`]: next });
  }

  /**
   * Suspend or resume a technick's mechanical effects.
   *
   * Backstab doubles exploding dice, and the flag is unconditional once set —
   * so a rogue who takes it has every javelin throw exploding twice for the
   * rest of the session. The condition is one the system cannot evaluate, so
   * the player states it: switch off, throw the javelin, switch back on.
   */
  static async #onToggleTechnickActive(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    if (!item) return;

    await item.update({ "system.active": item.system.active === false });
  }

  static async #onHeroBoost(event, target) {
    const grassrunner = this.document.items.some(
      (i) => i.type === "race" && i.system?.slug === "grassrunner"
    );
    await heroPointDefenceBoost(this.document, target.dataset.defence, {
      rerollOnes: grassrunner
    });
  }

  static async #onAddPersistent(event, target) {
    const sys = this.document.system;

    const label = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("LASTARC.Dialog.AddPersistent.title") },
      content:
        `<p>${game.i18n.localize("LASTARC.Dialog.AddPersistent.content")}</p>` +
        `<label>${game.i18n.localize("LASTARC.Dialog.AddPersistent.source")}` +
        `<input type="text" name="label" autofocus></label>` +
        `<label>${game.i18n.localize("LASTARC.Dialog.AddPersistent.clearedBy")}` +
        `<input type="text" name="clearedBy"></label>` +
        `<label><input type="checkbox" name="fromInjury"> ` +
        `${game.i18n.localize("LASTARC.Dialog.AddPersistent.fromInjury")}</label>`,
      ok: {
        callback: (event, button) => ({
          label: button.form.elements.label.value.trim(),
          clearedBy: button.form.elements.clearedBy.value.trim(),
          fromInjury: button.form.elements.fromInjury.checked
        })
      },
      rejectClose: false
    });

    if (!label?.label) return;

    const sources = [...sys.breakGauge.persistentSources, {
      id: foundry.utils.randomID(),
      label: label.label,
      clearedBy: label.clearedBy,
      fromInjury: label.fromInjury
    }];

    const next = D.reconcilePersistent(sys.breakGauge.step, sources.length);
    await this.document.update({
      "system.breakGauge.persistentSources": sources,
      "system.breakGauge.persistentSteps": next.persistentSteps,
      "system.breakGauge.step": next.step
    });
  }

  /**
   * Clear one persistent condition.
   *
   * Clearing the source does NOT improve the gauge on its own — it only lowers
   * the floor, so a Recovery action can now reach further. That matches §6:
   * recovery cannot clear persistent steps, but once the underlying condition is
   * cured the step becomes ordinary and recoverable.
   */
  static async #onClearPersistent(event, target) {
    const sys = this.document.system;
    const sources = [...sys.breakGauge.persistentSources];
    sources.splice(Number(target.dataset.index), 1);

    await this.document.update({
      "system.breakGauge.persistentSources": sources,
      "system.breakGauge.persistentSteps": sources.length
    });
  }

  static async #onSecondWind(event, target) {
    const sys = this.document.system;
    if (!sys.resources.secondWind.canUse) {
      ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.SecondWind"));
      return;
    }
    // Spend first, then heal. `applyHealing` writes HP itself and posts the
    // card that shows the sum, so it cannot be folded into one update — and
    // healing without a card was half of issue #11.
    await this.document.update({
      "system.resources.secondWind.used": sys.resources.secondWind.used + 1
    });

    await applyHealing(this.document, {
      amount: sys.resources.secondWind.healAmount,
      sourceName: game.i18n.localize("LASTARC.Resource.SecondWind"),
      sourceImg: this.document.img
    });
  }

  /**
   * Tick or untick one Second Wind use (issue #10).
   *
   * Clicking a spent box UNSPENDS everything from it onward, so the leftmost
   * box is a reset. That is the whole point of the request: Second Wind comes
   * back on a rest, and no part of this software knows when a table decided one
   * happened, so the record has to be freely editable in both directions.
   *
   * Reads the index rather than the checkbox's own checked state, because the
   * re-render immediately replaces the element and its transient state with the
   * value from the document.
   */
  static async #onSetSecondWind(event, target) {
    const index = Number(target.dataset.index);
    const used = this.document.system.resources.secondWind.used;

    // Ticking box i means "i+1 spent"; clicking the last spent box gives it back.
    const next = used === index + 1 ? index : index + 1;
    await this.document.update({ "system.resources.secondWind.used": next });
  }

  /**
   * Roll an attack with an equipped weapon.
   *
   * The target's Reflex is read from the user's current target so the card can
   * state hit or miss. With no target the attack still rolls and the card says
   * so — the GM adjudicating by eye is a normal way to play, and refusing to
   * roll would be worse than reporting an unresolved total.
   */
  static async #onRollAttack(event, target) {
    const weapon = this.document.items.get(target.dataset.itemId);
    if (!weapon) return;

    /**
     * Ranged weapons get a range-band selector in the Alt-click dialog (issue
     * #36). Offered only when the weapon is actually ranged, so a swordsman is
     * never asked which increment they are swinging at.
     */
    const isRanged = LASTARC.rangedWeaponCategories.has(weapon.system.category);
    const extra = await situationalOptions(event, {
      rangeBands: isRanged
        ? D.rangeBandsFor(weapon.system.size, { isThrown: false })
        : null
    });
    if (extra === null) return;

    const targeted = [...(game.user.targets ?? [])][0]?.actor;
    await rollAttack(this.document, weapon, {
      ...extra,
      targetDefence: defenceToBeat(targeted),
      // Carried so the card can offer the target a Block (issue #12). Weapon
      // attacks always target Reflex, which is exactly what a shield answers.
      target: targeted
    });
  }

  /**
   * Cast from the sheet.
   *
   * `threatCount` is asked for rather than computed: whether a creature
   * threatens you depends on reach, positioning and GM ruling, and guessing it
   * from token distance would silently get the defensive-casting penalty wrong
   * (which is −5 PER threat, so an error compounds).
   */
  static async #onCastSpell(event, target) {
    const spell = this.document.items.get(target.dataset.itemId);
    if (!spell) return;

    const extra = await situationalOptions(event);
    if (extra === null) return;

    const targeted = [...(game.user.targets ?? [])][0]?.actor;

    await castSpell(this.document, spell, {
      ...extra,
      target: targeted,
      castDefensively: !!event.shiftKey,
      threatCount: event.shiftKey ? 1 : 0
    });
  }

  /**
   * Rest (§13).
   *
   * HP and MP recover on the same shape with different attributes — Vit for HP,
   * Mnd for MP — and both clamp the hours term at 8, because the book says more
   * than 8 yields nothing extra and the raw formula would happily reward 30.
   *
   * A character with a non-injury persistent condition or an HP-affecting status
   * gains NO HP, which is why `naturalHealingBlocked` is derived rather than
   * recomputed here.
   */
  static async #onTakeRest() {
    const sys = this.document.system;
    const blocked = sys.resources.naturalHealingBlocked;

    const hours = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("LASTARC.Dialog.Rest.title") },
      content:
        `<p>${game.i18n.localize("LASTARC.Dialog.Rest.content")}</p>` +
        (blocked ? `<p class="notification warning">${game.i18n.localize("LASTARC.Dialog.Rest.blocked")}</p>` : "") +
        `<input type="number" name="hours" value="8" min="0" max="24" autofocus>`,
      ok: {
        label: game.i18n.localize("LASTARC.Action.Rest"),
        callback: (event, button) => Number(button.form.elements.hours.value)
      },
      rejectClose: false
    });

    if (hours == null || Number.isNaN(hours)) return;

    const hp = D.restRecovery({
      attrMod: sys.attributes.vit.mod, level: sys.details.level, hours, blocked
    });
    // MP is not blocked by the conditions that block HP — the book names those
    // as preventing HP recovery specifically.
    const mp = D.restRecovery({
      attrMod: sys.attributes.mnd.mod, level: sys.details.level, hours
    });

    const newHp = Math.min(sys.resources.hp.max, sys.resources.hp.value + hp);
    const newMp = Math.min(sys.resources.mp.max, sys.resources.mp.value + mp);

    const updates = {
      "system.resources.hp.value": newHp,
      "system.resources.mp.value": newMp
    };
    // A full 8 hours restores per-day abilities.
    if (hours >= 8) updates["system.resources.secondWind.used"] = 0;

    await this.document.update(updates);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      content:
        `<div class="lastarc-card lastarc-card--rest">` +
        `<p>${game.i18n.format("LASTARC.Card.Rested", {
          name: this.document.name, hours,
          hp: newHp - sys.resources.hp.value, mp: newMp - sys.resources.mp.value
        })}</p>` +
        (blocked ? `<p class="lastarc-note">${game.i18n.localize("LASTARC.Dialog.Rest.blocked")}</p>` : "") +
        `</div>`
    });
  }

  /**
   * Perform. Shift-click performs defensively, matching the cast button.
   *
   * The displacement rule is reported rather than enforced: which performances
   * are currently affecting whom is table state we do not track, and silently
   * cancelling the wrong one would be worse than saying nothing.
   */
  static async #onPerform(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    if (!item) return;

    const extra = await situationalOptions(event);
    if (extra === null) return;

    await performItem(this.document, item, {
      ...extra,
      performDefensively: !!event.shiftKey,
      threatCount: event.shiftKey ? 1 : 0,
      // Enfeebling tiers are gated on beating a defence and can strip mana, so
      // a performance needs its target the same way a spell does (issue #13).
      target: [...(game.user.targets ?? [])][0]?.actor
    });
  }

  static async #onCreateItem(event, target) {
    await promptCreateItem(this.document, target.dataset.group);
  }

  /**
   * Post an item to chat so the rest of the table can read it.
   *
   * A readout, not a use: nothing is rolled and nothing is spent.
   */
  static async #onShareItem(event, target) {
    await shareItem(this.document.items.get(target.dataset.itemId));
  }

  static async #onEditItem(event, target) {
    this.document.items.get(target.dataset.itemId)?.sheet?.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("LASTARC.Dialog.DeleteItem.title") },
      content: `<p>${game.i18n.format("LASTARC.Dialog.DeleteItem.content", { name: item.name })}</p>`
    });
    if (confirmed) await item.delete();
  }

  /** Move an item one place up or down its panel (issue #9). */
  static async #onMoveItem(event, target) {
    await moveItem(this, target);
  }

  /**
   * Equipping armour or a shield is exclusive — the derivation reads a single
   * equipped armour, and two at once would silently pick whichever the item
   * collection happened to return first.
   */
  static async #onToggleEquip(event, target) {
    const item = this.document.items.get(target.dataset.itemId);
    if (!item) return;

    const next = !item.system.equipped;
    const updates = [{ _id: item.id, "system.equipped": next }];

    if (next && (item.type === "armour" || item.type === "shield")) {
      for (const other of this.document.items) {
        if (other.id !== item.id && other.type === item.type && other.system.equipped) {
          updates.push({ _id: other.id, "system.equipped": false });
        }
      }
    }

    await this.document.updateEmbeddedDocuments("Item", updates);
  }

  static async #onAddClass(event, target) {
    const current = this.document.system.classes.map((c) => ({ ...c }));
    await this.document.update({
      "system.classes": [...current, { name: "warrior", levels: 1, advanced: null }]
    });
  }

  /**
   * Removing the FIRST class re-seats whichever class follows it, which silently
   * changes the character's level-1 HP/MP grant and class defence bonuses. Warn
   * rather than doing that invisibly.
   */
  static async #onRemoveClass(event, target) {
    const index = Number(target.dataset.index);
    const current = this.document.system.classes.map((c) => ({ ...c }));

    if (current.length <= 1) return;

    if (index === 0) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("LASTARC.Dialog.RemoveFirstClass.title") },
        content: `<p>${game.i18n.localize("LASTARC.Dialog.RemoveFirstClass.content")}</p>`
      });
      if (!confirmed) return;
    }

    current.splice(index, 1);
    await this.document.update({ "system.classes": current });
  }
}
