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
import { promptCreateItem } from "./item-creation.mjs";
import { shareItem } from "../dice/share-item.mjs";
import { orderBySort } from "../item-order.mjs";
import { markOrder, moveItem } from "./reorder.mjs";
import { markStatuses, toggleStatus } from "./status-palette.mjs";
import { situationalOptions } from "../dice/situational.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * One-line summary of a technick's numeric payload.
 *
 * Deliberately a plain function rather than a copy of the character sheet's
 * private method: a GM reading a monster's abilities wants the same shorthand
 * a player gets, and two implementations would drift.
 */
function grantSummary(grants) {
  if (!grants) return "";
  const parts = [];
  const sign = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

  for (const key of ["ref", "fort", "will"]) {
    if (grants.defences?.[key]) {
      parts.push(`${sign(grants.defences[key])} ${game.i18n.localize(`LASTARC.Defence.${key}`)}`);
    }
  }
  if (grants.breakThreshold) parts.push(`${sign(grants.breakThreshold)} Threshold`);
  if (grants.hp) parts.push(`${sign(grants.hp)} HP`);
  if (grants.mp) parts.push(`${sign(grants.mp)} MP`);
  if (grants.dr) parts.push(`${sign(grants.dr)} DR`);
  if (grants.speed) parts.push(`${sign(grants.speed)} Speed`);
  if (grants.initiativeSteps) parts.push(`Init −${grants.initiativeSteps} step`);
  return parts.join(" · ");
}

/**
 * The two drop tables (§3.2). Loot and Steal hold the same row — item name plus
 * a percentage — so one pair of handlers serves both, keyed by `data-drops`.
 *
 * Named here rather than interpolated straight from the dataset into an update
 * path: a typo in the markup would otherwise write a new top-level field that
 * the schema drops on the way out, which fails silently and looks like the
 * button doing nothing.
 */
const DROP_TABLES = ["loot", "steal"];

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
      addSkill: LastArcNpcSheet.#onAddSkill,
      removeSkill: LastArcNpcSheet.#onRemoveSkill,
      addDrop: LastArcNpcSheet.#onAddDrop,
      deleteDrop: LastArcNpcSheet.#onDeleteDrop,
      toggleStatus: LastArcNpcSheet.#onToggleStatus,
      rollNpcSkill: LastArcNpcSheet.#onRollNpcSkill,
      createItem: LastArcNpcSheet.#onCreateItem,
      shareItem: LastArcNpcSheet.#onShareItem,
      editItem: LastArcNpcSheet.#onEditItem,
      deleteItem: LastArcNpcSheet.#onDeleteItem,
      moveItem: LastArcNpcSheet.#onMoveItem
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

    context.fields = sys.schema.fields;
    context.enrichedBiography = await foundry.applications.ux.TextEditor
      .implementation.enrichHTML(sys.details.biography ?? "", { relativeTo: this.document });

    context.ethosPurityOptions = LASTARC.ethosPurity
      .map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` }));
    context.ethosMoralityOptions = LASTARC.ethosMorality
      .map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` }));

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

    // Printed statblock skills. Stored as {key, value} pairs rather than the
    // character's full derived rows — an NPC's skills are authored totals, not
    // built from attributes and training (§3.2).
    context.skillOptions = Object.entries(LASTARC.allSkills)
      .map(([k, c]) => ({ value: k, label: c.label }));
    context.npcSkills = sys.skills.map((s, index) => ({
      ...s,
      index,
      label: LASTARC.allSkills[s.key]?.label ?? s.key
    }));

    // Drop tables. Both render through the same row markup, and the index is
    // carried on each row because the inputs bind by position
    // (`system.loot.0.name`) — the same convention as the attack rows above.
    context.loot = sys.loot.map((row, index) => ({ ...row, index }));
    context.steal = sys.steal.map((row, index) => ({ ...row, index }));

    // Technicks and talents get their own panel. They were mixed into an
    // undifferentiated item list with the creature's gear, so a monster's
    // abilities sat between its sword and its rations with nothing to
    // distinguish them.
    const technicks = [];
    const items = [];
    for (const i of orderBySort([...this.document.items])) {
      const row = {
        id: i.id,
        name: i.name,
        img: i.img,
        typeLabel: game.i18n.localize(`TYPES.Item.${i.type}`)
      };
      if (i.type === "technick" || i.type === "talent") {
        technicks.push({ ...row, summary: grantSummary(i.system.grants) });
      } else {
        items.push(row);
      }
    }
    context.technicks = technicks;
    context.items = items;
    markOrder(this, { technicks, items });
    markStatuses(context, this.document);

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
    const extra = await situationalOptions(event);
    if (extra === null) return;

    await rollAttribute(this.document, target.dataset.attribute, extra);
  }

  static async #onRollNpcAttack(event, target) {
    const index = Number(target.dataset.index);
    const extra = await situationalOptions(event);
    if (extra === null) return;

    const targeted = [...(game.user.targets ?? [])][0]?.actor;

    await rollNpcAttack(this.document, index, {
      ...extra,
      targetDefence: defenceToBeat(targeted),
      targetProne: !!targeted?.statuses?.has?.("prone"),
      targetHelpless: !!targeted?.statuses?.has?.("helpless"),
      // Carried so the card can offer the target a Block (issue #12). A
      // monster's attack is the commonest thing a player will want to block.
      target: targeted
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

  static async #onAddSkill() {
    const skills = this.document.system.toObject().skills ?? [];
    // Default to the first skill not already listed, so adding three rows in a
    // row does not produce three Acrobatics.
    const used = new Set(skills.map((s) => s.key));
    const next = Object.keys(LASTARC.allSkills).find((k) => !used.has(k))
      ?? Object.keys(LASTARC.allSkills)[0];
    await this.document.update({ "system.skills": [...skills, { key: next, value: 0 }] });
  }

  /** Whole-array write: `-=N` is object-key deletion and corrupts an ArrayField. */
  static async #onRemoveSkill(event, target) {
    const index = Number(target.dataset.index);
    const skills = this.document.system.toObject().skills ?? [];
    if (!skills[index]) return;
    await this.document.update({ "system.skills": skills.filter((_, i) => i !== index) });
  }

  static async #onToggleStatus(event, target) {
    await toggleStatus(this, target);
  }

  static async #onAddDrop(event, target) {
    const table = target.dataset.drops;
    if (!DROP_TABLES.includes(table)) return;

    const rows = this.document.system.toObject()[table] ?? [];
    // 100% by default: a bestiary entry's guaranteed drop is the common case,
    // and a row that appears at 0% would look like a broken new row.
    await this.document.update({ [`system.${table}`]: [...rows, { name: "", chance: 100 }] });
  }

  /**
   * No confirmation dialog, unlike deleteAttack: a drop row is a name and a
   * percentage, and re-typing it costs less than the prompt does. Whole-array
   * write, because `-=N` is object-key deletion and corrupts an ArrayField.
   */
  static async #onDeleteDrop(event, target) {
    const table = target.dataset.drops;
    if (!DROP_TABLES.includes(table)) return;

    const index = Number(target.dataset.index);
    const rows = this.document.system.toObject()[table] ?? [];
    if (!rows[index]) return;

    await this.document.update({
      [`system.${table}`]: rows.filter((_, i) => i !== index)
    });
  }

  /**
   * Roll a statblock skill.
   *
   * The printed total is used as-is plus the Break Gauge penalty — an NPC's
   * skills are authored numbers, not derived from attributes and training, so
   * there is nothing else to add.
   */
  static async #onRollNpcSkill(event, target) {
    const index = Number(target.dataset.index);
    const entry = this.document.system.skills[index];
    if (!entry) return;

    const penalty = this.document.system.breakGauge.penalty ?? 0;
    const roll = await new Roll(`1d20 + ${entry.value} + ${penalty}`).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: game.i18n.format("LASTARC.Card.SkillCheck", {
        skill: game.i18n.localize(LASTARC.allSkills[entry.key]?.label ?? entry.key)
      })
    });
  }

  static async #onCreateItem(event, target) {
    await promptCreateItem(this.document, target.dataset.group ?? "npc");
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
}
