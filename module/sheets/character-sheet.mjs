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
      addSubskill: LastArcCharacterSheet.#onAddSubskill,
      removeSubskill: LastArcCharacterSheet.#onRemoveSubskill,
      addClass: LastArcCharacterSheet.#onAddClass,
      removeClass: LastArcCharacterSheet.#onRemoveClass,
      editItem: LastArcCharacterSheet.#onEditItem,
      deleteItem: LastArcCharacterSheet.#onDeleteItem,
      toggleEquip: LastArcCharacterSheet.#onToggleEquip
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

    context.system = sys;
    context.config = LASTARC;
    context.editable = this.isEditable;

    // Attributes in PRINTED order, not object-key order (§2 rev2).
    context.attributes = LASTARC.attributeOrder.map((key) => ({
      key,
      label: LASTARC.attributes[key].label,
      abbr: LASTARC.attributes[key].abbr,
      ...sys.attributes[key]
    }));

    // Skills, standard then weapon, each carrying the five printed columns.
    const toRow = (key, cfg) => {
      const s = sys.skills[key];
      return {
        key,
        label: cfg.label,
        attr: cfg.attr,
        attrAbbr: LASTARC.attributes[cfg.attr].abbr,
        subskilled: !!cfg.subskilled,
        isWeaponSkill: !!cfg.weapon,
        trained: s.trained,
        focus: s.focus,
        misc: s.misc,
        total: s.total,
        appliesArmourPenalty: s.appliesArmourPenalty,
        halfLevel: D.rd(sys.details.level / 2),
        attrMod: sys.attributes[cfg.attr].mod,
        subskills: (s.subskills ?? []).map((sub, index) => ({ ...sub, index }))
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

    context.recoveryTarget = LASTARC.recoveryMinorActions;

    context.defenceRows = ["ref", "fort", "will"].map((key) => ({
      key,
      label: `LASTARC.Defence.${key}`,
      ...sys.defences[key]
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

    // Surfaced as a visible warning rather than a silent inconsistency.
    context.levelMismatch = sys.details.levelMismatch;

    this.#prepareItems(context, sys);

    return context;
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

    const EQUIPPABLE = new Set(["weapon", "armour", "shield", "accessory", "prostheticLimb"]);

    for (const item of this.document.items) {
      if (item.type === "technick" || item.type === "talent") {
        const check = D.checkPrerequisites(item.system.prerequisites, snapshot);
        technicks.push({
          id: item.id,
          name: item.name,
          img: item.img,
          kindLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
          summary: this.#grantSummary(item.system.grants),
          prereqsMet: check.met,
          unmetText: check.unmet.join(", ")
        });
        continue;
      }

      if (typeof item.system?.bulk !== "number") continue;

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
    context.bulkState = sys.bulk.state === "none" ? null : sys.bulk.state;
    context.bulkStateLabel = context.bulkState ? `LASTARC.Status.${context.bulkState}` : null;
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
    const { skill, subskill } = target.dataset;
    await rollSkill(this.document, skill, { subskill: subskill || null });
  }

  static async #onRollAttribute(event, target) {
    await rollAttribute(this.document, target.dataset.attribute);
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
    const required = LASTARC.recoveryMinorActions;
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

  static async #onSecondWind(event, target) {
    const sys = this.document.system;
    if (!sys.resources.secondWind.canUse) {
      ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.SecondWind"));
      return;
    }
    const healed = Math.min(
      sys.resources.hp.max,
      sys.resources.hp.value + sys.resources.secondWind.healAmount
    );
    await this.document.update({
      "system.resources.hp.value": healed,
      "system.resources.secondWind.used": sys.resources.secondWind.used + 1
    });
  }

  static async #onAddSubskill(event, target) {
    const key = target.dataset.skill;
    const current = this.document.system.skills[key].subskills ?? [];
    await this.document.update({
      [`system.skills.${key}.subskills`]: [
        ...current,
        { name: game.i18n.localize("LASTARC.Skill.NewSpecialisation"), trained: false, focus: 0, misc: 0 }
      ]
    });
  }

  static async #onRemoveSubskill(event, target) {
    const { skill, index } = target.dataset;
    const current = [...(this.document.system.skills[skill].subskills ?? [])];
    current.splice(Number(index), 1);
    await this.document.update({ [`system.skills.${skill}.subskills`]: current });
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
