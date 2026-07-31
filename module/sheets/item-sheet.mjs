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

export class LastArcItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["last-arc", "sheet", "item"],
    position: { width: 560, height: 620 },
    window: { resizable: true, contentClasses: ["last-arc-sheet-body"] },
    form: { submitOnChange: true, closeOnSubmit: false }
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

    if (context.isTechnick) {
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
}
