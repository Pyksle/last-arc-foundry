/**
 * Item sheet.
 *
 * One sheet class serving all seventeen subtypes, switching template sections on
 * `item.type`. Seventeen near-identical sheet classes would be seventeen places
 * to fix every future change; the variation between item types is which fields
 * show, not how the sheet behaves.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Subtypes that live in an inventory and carry cost/bulk/quantity/equipped.
 *
 * Read from config rather than restated here: this list also decides what the
 * character sheet's Inventory panel accepts, and two copies that must agree but
 * are never compared will eventually disagree.
 */
const PHYSICAL_TYPES = new Set(LASTARC.physicalItemTypes);

/**
 * Subtypes sharing the consumable schema — uses, effect, healing, on-use.
 * A scroll and an orchestral score are consumables with a different flavour,
 * not separate shapes, so they share one section rather than three copies.
 */
const CONSUMABLE_TYPES = new Set(["consumable", "spellScroll", "orchestralScore"]);

/** Subtypes carrying a `grants` block of passive numeric bonuses. */
const GRANTING_TYPES = new Set(["technick", "talent", "accessory", "prostheticLimb", "feature"]);

/**
 * Turn an attribute-keyed ObjectField into one row of inputs, in PRINTED order
 * (Str·Vit·Agi·Int·Mnd·Chr) rather than whatever order the object happens to
 * hold. Absent keys render blank, which is the "no modifier" case.
 */
function attributeGrid(obj = {}) {
  return LASTARC.attributeOrder.map((key) => ({
    key,
    abbr: LASTARC.attributes[key].abbr,
    value: obj?.[key] ?? ""
  }));
}

export class LastArcItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["last-arc", "sheet", "item"],
    position: { width: 620, height: 720 },
    window: { resizable: true, contentClasses: ["last-arc-sheet-body"] },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addOutcome: LastArcItemSheet.#onAddOutcome,
      deleteOutcome: LastArcItemSheet.#onDeleteOutcome
    }
  };

  static PARTS = {
    body: {
      template: "systems/last-arc/templates/item/item-sheet.hbs",
      scrollable: [""]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const sys = item.system;

    context.system = sys;
    context.config = LASTARC;
    context.itemType = item.type;
    context.isPhysical = PHYSICAL_TYPES.has(item.type);
    context.isTechnick = item.type === "technick" || item.type === "talent";
    context.isConsumable = CONSUMABLE_TYPES.has(item.type);
    context.hasGrants = GRANTING_TYPES.has(item.type);

    // The schema itself, so {{formInput}} can build the right control for a
    // field rather than the template guessing. Needed for description in
    // particular: HTMLField defaults its element to <prose-mirror>, which is
    // the only way to get a rich-text editor, and hand-writing one is not
    // practical.
    context.fields = item.system.schema.fields;

    context.enrichedDescription = await foundry.applications.ux.TextEditor
      .implementation.enrichHTML(sys.description ?? "", { relativeTo: item });

    context.availabilityOptions = Object.keys(LASTARC.availability)
      .map((k) => ({ value: k, label: `LASTARC.Availability.${k}` }));
    context.sizeOptions = LASTARC.sizeOrder
      .map((k) => ({ value: k, label: LASTARC.sizes[k].label }));
    context.weaponCategoryOptions = LASTARC.weaponCategories
      .map((k) => ({ value: k, label: `LASTARC.WeaponCategory.${k}` }));
    context.armourTypeOptions = Object.keys(LASTARC.armourTypes)
      .map((k) => ({ value: k, label: `LASTARC.ArmourType.${k}` }));
    context.damageTypeOptions = LASTARC.allDamageTypes
      .map((k) => ({ value: k, label: `LASTARC.DamageType.${k}` }));
    context.schoolOptions = LASTARC.spellSchools
      .map((k) => ({ value: k, label: `LASTARC.School.${k}` }));
    context.skillOptions = Object.keys(LASTARC.allSkills)
      .map((k) => ({ value: k, label: LASTARC.allSkills[k].label }));
    context.castingTimeOptions = Object.entries(LASTARC.castingTimes)
      .map(([k, v]) => ({ value: k, label: v.label }));
    context.performSpecOptions = Object.keys(LASTARC.performSpecialisations)
      .map((k) => ({ value: k, label: `LASTARC.PerformSpec.${k}` }));
    context.performanceKindOptions = Object.keys(LASTARC.performanceKinds)
      .map((k) => ({ value: k, label: `LASTARC.PerformanceKind.${k}` }));
    context.classKeyOptions = Object.entries(LASTARC.classes)
      .map(([k, c]) => ({ value: k, label: c.label }));
    context.technickKindOptions = LASTARC.technickKinds
      .map((k) => ({ value: k, label: `LASTARC.TechnickKind.${k}` }));
    context.shieldSizeOptions = Object.keys(LASTARC.shieldDamage)
      .map((k) => ({ value: k, label: LASTARC.sizes[k]?.label ?? k }));
    context.consumableTypeOptions = LASTARC.consumableTypes
      .map((k) => ({ value: k, label: `LASTARC.ConsumableType.${k}` }));
    context.featureCategoryOptions = LASTARC.featureCategories
      .map((k) => ({ value: k, label: `LASTARC.FeatureCategory.${k}` }));
    context.prostheticSiteOptions = LASTARC.prostheticSites
      .map((k) => ({ value: k, label: `LASTARC.Prosthetic.${k}` }));
    // The ladder, not LASTARC.initiativeDice — that maps non-player CATEGORIES
    // to a die, which is a different table. Labels are the die faces
    // themselves, so they need no localisation.
    context.initiativeDieOptions = LASTARC.initiativeDieLadder
      .map((d) => ({ value: d, label: d }));

    // A blank first entry is the "none" case and must be selectable, or a
    // field once set could never be cleared.
    context.statusOptions = [
      { value: "", label: game.i18n.localize("LASTARC.Attack.NoStatus") },
      ...LASTARC.allStatusIds.map((id) => ({
        value: id, label: game.i18n.localize(`LASTARC.Status.${id}`)
      }))
    ];
    context.defenceOptions = [
      { value: "", label: game.i18n.localize("LASTARC.Field.NoOpposedDefence") },
      ...["ref", "fort", "will"].map((k) => ({ value: k, label: `LASTARC.Defence.${k}` }))
    ];

    // Spells and performances BOTH have DC tiers, and both need them indexed
    // here rather than in the template: the rows are edited by index and
    // Handlebars has no way to produce one. The two render different editors —
    // see LASTARC.performanceBonusScopes — but the plumbing is identical, and
    // performances having no editor at all was issue #13.
    if (item.type === "spell" || item.type === "performance") {
      context.outcomes = sys.outcomes.map((o, index) => ({ ...o, index }));
    }

    if (item.type === "spell") {
      // Decay fractions are an array of numbers but a comma list in the UI —
      // "0.5, 0.25" is how the book writes it and how a GM thinks of it.
      context.decayText = sys.damageOverTime.join(", ");
    }

    if (item.type === "performance") {
      const options = (table, blankLabel) => [
        { value: "", label: game.i18n.localize(blankLabel) },
        ...Object.entries(table).map(([value, cfg]) => ({ value, label: cfg.label }))
      ];
      context.bonusScopeOptions =
        options(LASTARC.performanceBonusScopes, "LASTARC.Field.NoScope");
      context.damageScopeOptions =
        options(LASTARC.performanceDamageScopes, "LASTARC.Field.NoScope");
      context.penaltyScopeOptions =
        options(LASTARC.performancePenaltyScopes, "LASTARC.Field.NoScope");
      context.effectTagOptions =
        options(LASTARC.performanceEffectTags, "LASTARC.Field.NoEffectTag");
    }

    // ArrayFields of plain strings get one comma-separated box rather than a
    // row-adding widget. They are short, unordered lists of free text, and a
    // full editor for them would cost more clicks than typing.
    if (item.type === "ammunition") context.fitsText = sys.fits.join(", ");
    if (item.type === "race") {
      context.sensesText = sys.senses.join(", ");
      context.languagesText = sys.languages.join(", ");
      // ObjectFields keyed by attribute. Rendered as one box per attribute in
      // printed order, so they read like the book's racial line rather than
      // like JSON.
      context.attributeMods = attributeGrid(sys.attributeMods);
      context.attributeCaps = attributeGrid(sys.attributeCaps);
    }
    if (PHYSICAL_TYPES.has(item.type)) context.featuresText = sys.features.join(", ");

    if (context.isTechnick) {
      context.prereqAttributes = attributeGrid(sys.prerequisites.attributes);

      context.flagOptions = LASTARC.technickFlags.map((f) => ({
        value: f,
        label: `LASTARC.TechnickFlag.${f}`,
        selected: sys.flags.includes(f)
      }));

      // If the item is on an actor, show whether its prerequisites are actually
      // met. A prerequisite list the player has to check by hand is a
      // prerequisite list that gets ignored.
      const actor = item.parent;
      if (actor?.system?.prerequisiteSnapshot) {
        context.prereqCheck = D.checkPrerequisites(
          sys.prerequisites, actor.system.prerequisiteSnapshot()
        );
      }
    }

    if (item.type === "weapon") {
      // The wield category depends on who is holding it, so it can only be shown
      // when the weapon is actually on an actor (§5.4).
      const actorSize = item.parent?.system?.details?.size;
      if (actorSize) {
        context.wieldCategory = D.wieldCategory(actorSize, sys.size, sys.category);
        context.wieldChoice = D.lightWeaponAllowsChoice(actorSize, sys.size);
        context.strMultiplier = D.strDamageMultiplier(context.wieldCategory);
      }
    }

    return context;
  }

  /**
   * Translate the UI's convenience fields back into what the schema stores.
   *
   * Three shapes need it, and all three fail SILENTLY without it — the extra
   * key is simply dropped on update, so the box accepts typing and forgets it:
   *
   *   1. `*Text` boxes standing in for ArrayFields of strings.
   *   2. Attribute-keyed ObjectFields, where a blank box means "no entry" and
   *      must delete the key rather than store 0 — a racial modifier of 0 and
   *      no racial modifier are different things to read on a sheet.
   *   3. Decay fractions, a comma list of numbers.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const submit = super._prepareSubmitData(event, form, formData, updateData);

    const commaList = (raw) =>
      String(raw).split(",").map((s) => s.trim()).filter(Boolean);

    for (const [uiKey, path] of Object.entries({
      "system.fitsText": "system.fits",
      "system.sensesText": "system.senses",
      "system.languagesText": "system.languages",
      "system.featuresText": "system.features"
    })) {
      if (typeof submit[uiKey] !== "string") continue;
      submit[path] = commaList(submit[uiKey]);
      delete submit[uiKey];
    }

    if (typeof submit["system.decayText"] === "string") {
      const parts = commaList(submit["system.decayText"]).map(Number);
      const bad = parts.filter((n) => !Number.isFinite(n) || n < 0);
      if (bad.length) {
        ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.BadDecayFractions"));
      }
      submit["system.damageOverTime"] = parts.filter((n) => Number.isFinite(n) && n >= 0);
      delete submit["system.decayText"];
    }

    // Attribute maps. Rebuilt wholesale rather than patched key by key,
    // because a dotted path cannot express "remove this key".
    for (const base of ["system.attributeMods", "system.attributeCaps",
                        "system.prerequisites.attributes"]) {
      const keys = Object.keys(submit).filter((k) => k.startsWith(`${base}.`));
      if (!keys.length) continue;

      const rebuilt = {};
      for (const k of keys) {
        const value = submit[k];
        delete submit[k];
        if (value === null || value === "" || Number.isNaN(value)) continue;
        rebuilt[k.slice(base.length + 1)] = Number(value);
      }
      submit[base] = rebuilt;
    }

    return submit;
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Add an outcome row.
   *
   * The blank row is built FROM THE SCHEMA rather than written out here, so one
   * handler serves both spells and performances — whose tiers share the DC
   * ladder and nothing else (issue #13). A hardcoded spell-shaped row pushed
   * onto a performance would have its unknown keys silently dropped and its
   * real ones left at whatever the literal happened to say.
   *
   * That also keeps `dc: null` correct for free. Null rather than 0 is
   * deliberate — it means "this row always applies", the common case for a
   * first row, where 0 would be a tier every check trivially reaches.
   */
  static async #onAddOutcome() {
    const outcomes = this.document.system.toObject().outcomes ?? [];

    // `clean({})` is what Foundry itself does to fill a schema from nothing: it
    // walks every subfield, recursing into nested ones, and substitutes the
    // declared initial wherever a key is missing. Safer than reading `initial`
    // by hand, which would miss the spell row's nested `onFail`.
    const blank = this.document.system.schema.fields.outcomes.element.clean({});

    await this.document.update({ "system.outcomes": [...outcomes, blank] });
  }

  /**
   * Remove one row. Whole-array write: `system.outcomes.-=N` is object-key
   * deletion syntax and does not splice an ArrayField, it corrupts it.
   */
  static async #onDeleteOutcome(event, target) {
    const index = Number(target.dataset.index);
    const outcomes = this.document.system.toObject().outcomes ?? [];
    if (!outcomes[index]) return;
    await this.document.update({
      "system.outcomes": outcomes.filter((_, i) => i !== index)
    });
  }
}
