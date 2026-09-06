/**
 * Item sheet.
 *
 * One sheet class serving all seventeen subtypes, switching template sections on
 * `item.type`. Seventeen near-identical sheet classes would be seventeen places
 * to fix every future change; the variation between item types is which fields
 * show, not how the sheet behaves.
 */

import { LASTARC } from "../config.mjs";
import * as ROWS from "../sheet-rows.mjs";
import * as LISTS from "./form-lists.mjs";
import * as D from "../derivation.mjs";
import * as AMMO from "../ammunition.mjs";

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
      deleteOutcome: LastArcItemSheet.#onDeleteOutcome,
      addSkillGrant: LastArcItemSheet.#onAddSkillGrant,
      deleteSkillGrant: LastArcItemSheet.#onDeleteSkillGrant,
      toggleDamageType: LastArcItemSheet.#onToggleDamageType,
      toggleTechnickFlag: LastArcItemSheet.#onToggleTechnickFlag,
      toggleGrantWeaponProf: LastArcItemSheet.#onToggleGrantWeaponProf,
      toggleGrantArmourProf: LastArcItemSheet.#onToggleGrantArmourProf
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
    /**
     * Who gets the mechanical-flags panel (#64). Features carry flags now, and
     * `isTechnick` also gates the technick's PREREQUISITES block, which a
     * racial has none of — so this is a second, narrower question rather than
     * a widening of the first.
     */
    context.hasFlags = context.isTechnick || item.type === "feature";
    context.isConsumable = CONSUMABLE_TYPES.has(item.type);
    /**
     * ASKED OF THE DOCUMENT, not of a list of subtype names.
     *
     * This was a hardcoded `GRANTING_TYPES` set — a second statement of which
     * models mount `grantsSchema()`, free to disagree with the schema and
     * silently hide the panel for a subtype that had just gained one. Armour
     * and shields gaining a grants block is exactly the edit that would have
     * done it. The block's presence on the document is the only fact here, and
     * it cannot drift from itself.
     */
    context.hasGrants = !!sys.grants;

    /**
     * An empty grants block is not necessarily an unfinished one — most
     * technicks work through their flags, an Active Effect, or plain text
     * applied at the table. Say which it is, rather than leaving a reader to
     * guess whether a dozen zeroes mean "changes no numbers" or "not typed in
     * yet".
     *
     * Asked of EVERY granting type. The data models used to answer this for
     * themselves, and only technick/talent and feature did, so an accessory or
     * a prosthetic limb in exactly the same state would have gone unlabelled.
     *
     * The panel's inputs are NOT gated on this. Hiding an editor because it is
     * empty is how a field ends up unauthorable, which is the defect this
     * project keeps shipping; the note sits above them and they stay.
     */
    context.behaviouralGrants = context.hasGrants && !D.hasGrantPayload(sys.grants);

    /**
     * The reroll checkboxes (#48), driven off `LASTARC.grantableRerollKinds`
     * rather than written out twice in the template.
     *
     * Same reasoning as the NPC range bands: one list means a kind cannot
     * become grantable in the schema and stay untickable here. Two hand-kept
     * copies is how this codebase shipped two `choices` arrays nobody could
     * reach (#32).
     */
    context.rerollKindFields = LASTARC.grantableRerollKinds.map((key) => ({
      key,
      label: `LASTARC.RerollKind.${key}`,
      tooltip: `LASTARC.Tooltip.RerollKind.${key}`,
      checked: !!sys.grants?.reroll?.[key]
    }));

    // The schema itself, so {{formInput}} can build the right control for a
    // field rather than the template guessing. Needed for description in
    // particular: HTMLField defaults its element to <prose-mirror>, which is
    // the only way to get a rich-text editor, and hand-writing one is not
    // practical.
    context.fields = item.system.schema.fields;

    context.enrichedDescription = await foundry.applications.ux.TextEditor
      .implementation.enrichHTML(sys.description ?? "", { relativeTo: item });

    Object.assign(context, ROWS.itemChoiceOptions());

    // A blank first entry is the "none" case and must be selectable, or a
    // field once set could never be cleared.
    context.statusOptions = ROWS.statusOptions((k) => game.i18n.localize(k));
    context.defenceOptions = ROWS.opposedDefenceOptions((k) => game.i18n.localize(k));

    /**
     * Skill grants, for anything carrying the shared `grants` block.
     *
     * The rest of that block is flat numbers with one input each. Skills are
     * rows, and rows need an editor — which is why this one was missing while
     * every scalar beside it worked. The mechanic was complete otherwise: the
     * array is keyed by `aggregateGrants`, applied by character derivation as
     * focus, bonus and trained, and summarised on the technick row. Three
     * consumers and no producer, so Skill Focus and Skill Training could not be
     * expressed at all (issue #39).
     */
    /**
     * Defence-attribute substitutions (#69).
     *
     * Built here rather than in the template because each row needs its slot's
     * DEFAULT attribute named in the blank option — "Agility (default)" tells
     * the reader what leaving it alone means, which a bare empty option does
     * not. Handlebars cannot look one key up in another table.
     */
    if (sys.grants?.defenceAttribute) {
      const attrLabel = (k) => game.i18n.localize(LASTARC.attributes[k].label);
      context.defenceAttributeRows = Object.entries(LASTARC.defenceAttributes)
        .map(([slot, fallback]) => ({
          slot,
          label: game.i18n.localize(`LASTARC.Defence.${slot}`),
          value: sys.grants.defenceAttribute[slot] ?? "",
          defaultLabel: game.i18n.format("LASTARC.Field.DefenceAttributeDefault", {
            attribute: attrLabel(fallback)
          }),
          options: Object.keys(LASTARC.attributes)
            .map((value) => ({ value, label: attrLabel(value) }))
        }));
    }

    /**
     * Proficiencies this trait confers (#75).
     *
     * Checkbox rows rather than a comma box, for the reason the character
     * sheet's own picker gives: both are closed sets, and asking somebody to
     * type `bludgeons` correctly to stop losing 5 from every attack is a trap.
     */
    if (sys.grants?.proficiencies) {
      Object.assign(context, ROWS.grantProficiencyRows(sys.grants.proficiencies));
    }

    if (sys.grants?.skills) {
      context.grantedSkills = sys.grants.skills.map((s, index) => ({ ...s, index }));
      /**
       * Attribute scopes for a granted reroll (#79) — "any Strength check".
       * Built here rather than in the template because the label is the
       * attribute's own config key, which Handlebars cannot look up.
       */
      context.rerollAttributeOptions = Object.entries(LASTARC.attributes)
        .map(([value, cfg]) => ({ value, label: cfg.label }));

      /** Weapon groups, for a trait that rerolls attacks with one (#79). */
      context.rerollWeaponOptions = LASTARC.weaponCategories
        .map((value) => ({ value, label: `LASTARC.WeaponCategory.${value}` }));

      context.skillOptions = [
        { value: "", label: game.i18n.localize("LASTARC.Field.NoSkill") },
        ...Object.entries(LASTARC.allSkills)
          .map(([value, cfg]) => ({ value, label: game.i18n.localize(cfg.label) }))
          .sort((a, b) => a.label.localeCompare(b.label))
      ];
    }

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
      Object.assign(context, ROWS.performanceScopeOptions((k) => game.i18n.localize(k)));
    }

    // ArrayFields of plain strings get one comma-separated box rather than a
    // row-adding widget. They are short, unordered lists of free text, and a
    // full editor for them would cost more clicks than typing.
    if (item.type === "ammunition") {
      context.fitsText = sys.fits.join(", ");
      // Offered on every ammunition item, not only when the world uses the
      // die. A GM setting up a stack should not have to switch the world
      // setting on to be able to type into the field the schema declares —
      // and an unreachable field is the defect this project keeps producing.
      context.ammoDieOptions = AMMO.AMMO_DIE_STATES.map((value) => ({
        value, label: `LASTARC.AmmoDie.${value}`
      }));
    }
    if (item.type === "race") {
      context.sensesText = sys.senses.join(", ");
    }
    if (PHYSICAL_TYPES.has(item.type)) context.featuresText = sys.features.join(", ");

    /**
     * PREREQUISITES ARE A TECHNICK/TALENT THING, NOT A FLAGS THING (#66).
     *
     * This block was gated on `hasFlags` for one release, because features were
     * given mechanical flags (#64) and widening the nearest gate looked like
     * the way to render the picker for them. It is not: features have no
     * `prerequisites` field at all, so the very first line threw and NO FEATURE
     * SHEET WOULD OPEN — reported within hours of the release.
     *
     * The two questions were even distinguished in the comment written at the
     * time ("a racial has no prerequisites block"), which is worth recording:
     * knowing the distinction is not the same as gating on it.
     */
    if (context.isTechnick) {
      context.prereqAttributes = attributeGrid(sys.prerequisites.attributes);

      // Three ArrayFields of strings, shown as comma boxes (issue #15). They
      // had no input at all, so a technick could not record "Trained in
      // Acrobatics" — the commonest prerequisite the book prints.
      context.prereqTrainedSkillsText = (sys.prerequisites.trainedSkills ?? []).join(", ");
      context.prereqTechnicksText = (sys.prerequisites.technicks ?? []).join(", ");
      context.prereqTalentsText = (sys.prerequisites.talents ?? []).join(", ");

      /**
       * The flags picker. This context key existed and NO TEMPLATE RENDERED IT
       * (issue #32), so every mechanical flag was unreachable — a player with
       * Weapon Finesse had no way to turn it on, and the damage pipeline's
       * Agi-for-Str branch could never fire. Rendered as toggle buttons rather
       * than checkboxes for the same reason the proficiency grid is: this sheet
       * submits on change, and a checkbox can lose its click to the re-render
       * between mousedown and click.
       */
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

    /**
     * The flags picker, for every type that HAS flags — technick, talent and
     * feature (#64). Separate from the prerequisites block above, which is
     * about a different set of types and a different schema.
     */
    if (context.hasFlags) {
      context.flagOptions = ROWS.technickFlagOptions(sys.flags);
    }

    if (item.type === "shield") {
      /**
       * Which skill a shield Blocks with (#67), where the size table leaves a
       * choice. Offered unconditionally for the same reason the weapon's is:
       * the choice depends on the WIELDER's size, and a shield being authored
       * in a compendium has no wielder to depend on.
       */
      context.blockSkillOptions = [
        { value: "", label: "LASTARC.WieldSkill.auto" },
        { value: "lightWeapon", label: "LASTARC.Skill.lightWeapon" },
        { value: "oneHanded", label: "LASTARC.Skill.oneHanded" },
        { value: "twoHanded", label: "LASTARC.Skill.twoHanded" }
      ];
    }

    if (item.type === "weapon") {
      // The wield category depends on who is holding it, so it can only be shown
      // when the weapon is actually on an actor (§5.4).
      const actorSize = item.parent?.system?.details?.size;
      if (actorSize) {
        // With the grip applied, so the readout and the Str multiplier under it
        // describe the attack the weapon will actually make (#92).
        context.wieldCategory = D.wieldCategory(actorSize, sys.size, sys.category, {
          versatile: sys.versatile, grip: sys.wieldSkill
        });
        context.wieldChoice = D.lightWeaponAllowsChoice(actorSize, sys.size);
        context.versatileChoice =
          D.versatileAllowsChoice(actorSize, sys.size, sys.versatile);
        context.strMultiplier = D.strDamageMultiplier(context.wieldCategory);
      }

      /**
       * Which skill a light weapon rolls with, when the rules give a choice
       * (#63). Offered UNCONDITIONALLY, not only when `wieldChoice` is true.
       *
       * `wieldChoice` needs the weapon to be on an actor, because it depends on
       * that actor's size — so gating the control on it would make the setting
       * unreachable on a weapon sitting in the world or a compendium, which is
       * exactly where a GM builds one. The preference is inert until the choice
       * arises; the note under it says so.
       */
      context.wieldSkillOptions = [
        { value: "", label: "LASTARC.WieldSkill.auto" },
        { value: "lightWeapon", label: "LASTARC.Skill.lightWeapon" },
        { value: "oneHanded", label: "LASTARC.Skill.oneHanded" },
        { value: "twoHanded", label: "LASTARC.Skill.twoHanded" }
      ];

      /**
       * Damage types, as a multi-select (issue #32).
       *
       * The field is an ArrayField because the book's weapon tables routinely
       * print two — "Piercing or Slashing" appears on most polearms and several
       * swords — and which one you are using matters against a resistance. It
       * had NO INPUT at all, so every weapon in every world was stuck on the
       * schema's initial value of slashing, and the resistance rules the field
       * exists to serve could not be exercised.
       */
      const chosen = sys.damageType ?? [];
      context.weaponDamageTypes = ROWS.damageTypeOptions()
        .map((o) => ({ ...o, selected: chosen.includes(o.value) }));
      context.noDamageType = chosen.length === 0;
    }

    // See character-sheet.mjs: a player without FILES_BROWSE gets a picker that
    // silently declines to open, so the icon must not claim to be clickable.
    context.canBrowseFiles = game.user?.can("FILES_BROWSE") ?? false;

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

    /**
     * EVERY ONE OF THESE READS THE RAW FORM DATA.
     *
     * They used to read `submit`, after super had already run
     * `document.validate({clean: true})` — which deletes every key the schema
     * does not declare, and a `*Text` box is exactly such a key. So all seven
     * lists, the decay fractions and the prerequisite attributes accepted
     * typing and dropped it, silently, since they were written. Verified in a
     * live world: senses, features and prerequisite technicks all came back
     * empty. See `form-lists.mjs`.
     */
    LISTS.repackTextLists(formData, submit, {
      "system.fitsText": "system.fits",
      "system.sensesText": "system.senses",
      "system.languagesText": "system.languages",
      "system.featuresText": "system.features",
      "system.prerequisites.trainedSkillsText": "system.prerequisites.trainedSkills",
      "system.prerequisites.technicksText": "system.prerequisites.technicks",
      "system.prerequisites.talentsText": "system.prerequisites.talents"
    });

    const decay = LISTS.repackNumberList(
      formData, submit, "system.decayText", "system.damageOverTime");
    if (decay?.rejected) {
      ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.BadDecayFractions"));
    }

    /**
     * A PREREQUISITE OF 0 IS NOT A REQUIREMENT. Dropping the zeros is why this
     * is rebuilt wholesale — a dotted path cannot express "remove this key" —
     * and it is what stopped six phantom lines ("Str 0, Vit 0, Agi 0…") from
     * appearing on every technick shared to chat (issue #15). That fix had been
     * inert for the same reason as the lists above.
     */
    LISTS.repackAttributeMap(
      formData, submit, "system.prerequisites.attributes", { dropZero: true });

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

  /**
   * Add a skill-grant row.
   *
   * Built from the schema for the same reason `#onAddOutcome` is: the row's
   * shape lives in exactly one place. A blank `key` is a legitimate starting
   * state — `aggregateGrants` skips rows without one, so a half-filled row
   * grants nothing rather than throwing.
   */
  static async #onAddSkillGrant() {
    const skills = this.document.system.toObject().grants?.skills ?? [];
    const blank = this.document.system.schema.fields.grants.fields.skills.element.clean({});
    await this.document.update({ "system.grants.skills": [...skills, blank] });
  }

  /**
   * Remove one row. Whole-array write — `system.grants.skills.-=N` is
   * object-key deletion syntax and corrupts an ArrayField rather than splicing
   * it. Same trap as the outcome rows.
   */
  static async #onDeleteSkillGrant(event, target) {
    const index = Number(target.dataset.index);
    const skills = this.document.system.toObject().grants?.skills ?? [];
    if (!skills[index]) return;
    await this.document.update({
      "system.grants.skills": skills.filter((_, i) => i !== index)
    });
  }

  /**
   * Toggle one member of an ArrayField of choices.
   *
   * Shared by the weapon's damage types and the technick's flags, because they
   * are the same operation and the interesting part — validating against the
   * config list before writing — should not exist twice. An unrecognised key
   * warns and writes NOTHING: the value is constrained by the schema's
   * `choices`, so storing a typo would throw on the next prepare and leave the
   * item unopenable.
   */
  async #toggleInArray(path, key, valid) {
    if (!valid.includes(key)) {
      console.warn(`Last Arc | "${key}" is not a valid ${path}; nothing toggled.`);
      return;
    }
    const current = foundry.utils.getProperty(this.document.system.toObject(), path) ?? [];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];

    await this.document.update({ [`system.${path}`]: next });
  }

  static async #onToggleDamageType(event, target) {
    await this.#toggleInArray("damageType", target.dataset.key, LASTARC.allDamageTypes);
  }

  static async #onToggleTechnickFlag(event, target) {
    await this.#toggleInArray("flags", target.dataset.key, LASTARC.technickFlags);
  }

  /**
   * Two handlers rather than one taking the kind from a data attribute.
   *
   * Each names its path as a LITERAL, because that is how the reachability
   * guard traces a toggle button to the field it writes. A computed path reads
   * to that guard as a button wired to nothing — which, for its purposes, is
   * indistinguishable from actually being wired to nothing.
   */
  static async #onToggleGrantWeaponProf(event, target) {
    await this.#toggleInArray(
      "grants.proficiencies.weapons", target.dataset.key, LASTARC.weaponCategories);
  }

  static async #onToggleGrantArmourProf(event, target) {
    await this.#toggleInArray(
      "grants.proficiencies.armour", target.dataset.key, Object.keys(LASTARC.armourTypes));
  }
}
