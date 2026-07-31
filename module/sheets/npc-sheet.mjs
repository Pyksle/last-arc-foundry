/**
 * NPC sheet.
 *
 * Fixes a Phase 1 defect: `registerSheets()` unregistered Foundry's core
 * ActorSheet but only registered a sheet for the `character` subtype, which left
 * NPC actors with no sheet at all.
 *
 * Shaped like a printed statblock, not a character sheet. NPCs are authored
 * numbers rather than builds (§3.2), so defences, Threshold and Passive
 * Perception are direct inputs. The Break Gauge still derives on top, because
 * printed defences are the creature's UNBROKEN values.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollAttribute } from "../dice/rolls.mjs";
import { rollNpcAttack, defenceToBeat } from "../dice/attack.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class LastArcNpcSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["last-arc", "sheet", "actor", "npc"],
    position: { width: 760, height: 800 },
    window: { resizable: true, contentClasses: ["last-arc-sheet-body"] },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollAttribute: LastArcNpcSheet.#onRollAttribute,
      rollNpcAttack: LastArcNpcSheet.#onRollNpcAttack,
      addAttack: LastArcNpcSheet.#onAddAttack,
      deleteAttack: LastArcNpcSheet.#onDeleteAttack,
      setBreakStep: LastArcNpcSheet.#onSetBreakStep,
      editItem: LastArcNpcSheet.#onEditItem,
      deleteItem: LastArcNpcSheet.#onDeleteItem
    }
  };

  static PARTS = {
    body: {
      template: "systems/last-arc/templates/actor/npc-sheet.hbs",
      scrollable: [""]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;

    context.system = sys;
    context.config = LASTARC;

    // Same guard as the character sheet: a statblock with 0 max MP is common
    // and must not render NaN%.
    const pct = (value, max) =>
      max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
    context.hpPercent = pct(sys.resources.hp.value, sys.resources.hp.max);
    context.mpPercent = pct(sys.resources.mp.value, sys.resources.mp.max);

    context.attributes = LASTARC.attributeOrder.map((key) => ({
      key,
      label: LASTARC.attributes[key].label,
      abbr: LASTARC.attributes[key].abbr,
      ...sys.attributes[key]
    }));

    context.sizeOptions = LASTARC.sizeOrder
      .map((k) => ({ value: k, label: LASTARC.sizes[k].label }));

    context.defenceRows = ["ref", "fort", "will"].map((key) => ({
      key,
      label: `LASTARC.Defence.${key}`,
      value: sys.defences[key].value,
      base: sys.defences[key].base
    }));

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

    // Damage modifiers are arrays in the schema but comma lists in the UI —
    // statblocks are transcribed by hand and typing beats a multi-select.
    context.weaknessText = sys.damageMods.weakness.join(", ");
    context.resistanceText = sys.damageMods.resistance.join(", ");
    context.immunityText = sys.damageMods.immunity.join(", ");

    context.damageTypeOptions = LASTARC.allDamageTypes.map((t) => ({
      value: t, label: game.i18n.localize(`LASTARC.DamageType.${t}`)
    }));

    // A blank first entry is the "no rider" case and has to be selectable —
    // without it an attack that applies no status could never be un-set.
    context.statusOptions = [
      { value: "", label: game.i18n.localize("LASTARC.Attack.NoStatus") },
      ...LASTARC.allStatusIds.map((id) => ({
        value: id, label: game.i18n.localize(`LASTARC.Status.${id}`)
      }))
    ];

    const bp = sys.breakGauge.penalty;
    context.attacks = sys.attacks.map((atk, index) => ({
      ...atk,
      index,
      // Shown next to the live total so a GM can check the sheet against the
      // page without doing the Break Gauge arithmetic in their head.
      brokenBy: bp ? bp : null,
      displayName: atk.name || game.i18n.localize("LASTARC.Attack.Unnamed")
    }));

    context.items = this.document.items.map((i) => ({
      id: i.id,
      name: i.name,
      img: i.img,
      typeLabel: game.i18n.localize(`TYPES.Item.${i.type}`)
    }));

    return context;
  }

  /**
   * Parse the comma-separated damage-modifier fields back into arrays.
   *
   * Unknown type names are dropped with a warning rather than stored: an
   * unrecognised entry would sit in the data looking authoritative while
   * matching nothing in the damage pipeline.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const submit = super._prepareSubmitData(event, form, formData, updateData);

    for (const key of ["weakness", "resistance", "immunity"]) {
      const path = `system.damageMods.${key}`;
      const raw = submit[path];
      if (typeof raw !== "string") continue;

      const parsed = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const valid = parsed.filter((t) => LASTARC.allDamageTypes.includes(t));
      const unknown = parsed.filter((t) => !LASTARC.allDamageTypes.includes(t));

      if (unknown.length) {
        ui.notifications?.warn(
          game.i18n.format("LASTARC.Warning.UnknownDamageType", { types: unknown.join(", ") })
        );
      }
      submit[path] = valid;
    }

    return submit;
  }

  /* ------------------------------------------------------------------------ */

  static async #onRollAttribute(event, target) {
    await rollAttribute(this.document, target.dataset.attribute);
  }

  static async #onRollNpcAttack(event, target) {
    const index = Number(target.dataset.index);
    const targeted = [...(game.user.targets ?? [])][0]?.actor;

    await rollNpcAttack(this.document, index, {
      targetDefence: defenceToBeat(targeted),
      targetProne: !!targeted?.statuses?.has?.("prone"),
      targetHelpless: !!targeted?.statuses?.has?.("helpless")
    });
  }

  static async #onAddAttack() {
    const attacks = this.document.system.toObject().attacks ?? [];
    await this.document.update({
      "system.attacks": [...attacks, { name: "", atkBonus: 0, damage: "1d6" }]
    });
  }

  /**
   * Array element removal has to go through a whole-array write.
   * `system.attacks.-=N` is object-key deletion syntax and does not apply to
   * ArrayFields — using it here would corrupt the array rather than splice it.
   */
  static async #onDeleteAttack(event, target) {
    const index = Number(target.dataset.index);
    const attacks = this.document.system.toObject().attacks ?? [];
    if (!attacks[index]) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("LASTARC.Dialog.DeleteAttack.title") },
      content: `<p>${game.i18n.format("LASTARC.Dialog.DeleteAttack.content", {
        name: attacks[index].name || game.i18n.localize("LASTARC.Attack.Unnamed")
      })}</p>`
    });
    if (!confirmed) return;

    await this.document.update({
      "system.attacks": attacks.filter((_, i) => i !== index)
    });
  }

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
    await this.document.update({ "system.breakGauge.step": next.step });
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
}
