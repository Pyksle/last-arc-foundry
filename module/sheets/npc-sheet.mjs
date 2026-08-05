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
import { rollNpcAttack, defenceToBeat, targetConditions } from "../dice/attack.mjs";
import { rollCheckD20 } from "../dice/d20.mjs";
import { promptCreateItem } from "./item-creation.mjs";
import { shareItem } from "../dice/share-item.mjs";
import { orderBySort } from "../item-order.mjs";
import { markOrder, moveItem } from "./reorder.mjs";
import {
  applyLayout, sectionLabels, toggleSection, moveSection, toggleLayoutLock, resetLayout,
  rememberScroll, restoreScroll
} from "./sheet-layout-controls.mjs";
import { markStatuses, toggleStatus } from "./status-palette.mjs";
import { damageModTexts, repackDamageMods } from "./damage-mods.mjs";
import {
  effectPanelRows, promptCreateEffect, editEffect, toggleEffect, deleteEffect
} from "./effect-panel.mjs";
import { situationalOptions } from "../dice/situational.mjs";
import { castSpell, performItem } from "../dice/magic.mjs";
import * as ROWS from "../sheet-rows.mjs";

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
      castSpell: LastArcNpcSheet.#onCastSpell,
      performItem: LastArcNpcSheet.#onPerformItem,
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
      moveItem: LastArcNpcSheet.#onMoveItem,
      createEffect: LastArcNpcSheet.#onCreateEffect,
      editEffect: LastArcNpcSheet.#onEditEffect,
      toggleEffect: LastArcNpcSheet.#onToggleEffect,
      deleteEffect: LastArcNpcSheet.#onDeleteEffect,
      toggleSection: LastArcNpcSheet.#onToggleSection,
      moveSection: LastArcNpcSheet.#onMoveSection,
      toggleLayoutLock: LastArcNpcSheet.#onToggleLayoutLock,
      resetLayout: LastArcNpcSheet.#onResetLayout
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

    Object.assign(context, ROWS.ethosOptions());

    // Shared with the character sheet: a statblock with 0 max MP is common and
    // must not render NaN%. This was a byte-identical copy in both files (#44).
    context.hpPercent = ROWS.gaugePercent(sys.resources.hp.value, sys.resources.hp.max);
    context.mpPercent = ROWS.gaugePercent(sys.resources.mp.value, sys.resources.mp.max);

    /**
     * Curses a statblock cannot apply to itself (#45).
     *
     * The GM's decision was to halve these by hand, and that stands. This only
     * makes the omission visible: the icon lights up and no number moves, which
     * is exactly what a bug looks like — the more so because the same curse on
     * a PLAYER halves their maximum automatically.
     */
    context.manualAdjustments = LASTARC.npcManualAdjustments(sys.statuses);

    /**
     * The four range-increment boxes, driven off `LASTARC.rangeBands` rather
     * than written out four times in the template (#43).
     *
     * If a fifth band is ever added, the editor grows a box on its own instead
     * of silently storing a number nobody can type — which is the shape of
     * defect that put two unreachable `choices` arrays in this codebase.
     */
    context.rangeBandFields = Object.entries(LASTARC.rangeBands).map(([key, band]) => ({
      key,
      label: band.label,
      tooltip: `LASTARC.Tooltip.RangeBand.${key}`
    }));

    context.attributes = ROWS.npcAttributeRows(sys);

    context.sizeOptions = ROWS.sizeOptions();

    context.defenceRows = ROWS.npcDefenceRows(sys);

    // Identical to the character sheet's, so it is now literally the same code
    // (#44) — a change to the Break Gauge display used to need making twice.
    context.breakTrack = ROWS.breakTrackRows(sys, (key) => game.i18n.localize(key));

    // Damage modifiers are arrays in the schema but comma lists in the UI —
    // statblocks are transcribed by hand and typing beats a multi-select.
    // Shared with the character sheet (#53), which had no boxes at all.
    Object.assign(context, damageModTexts(sys));

    context.damageTypeOptions = ROWS.damageTypeOptions((k) => game.i18n.localize(k));

    // A blank first entry is the "no rider" case and has to be selectable —
    // without it an attack that applies no status could never be un-set.
    context.statusOptions = ROWS.statusOptions((k) => game.i18n.localize(k));

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
    const spells = [];
    const performances = [];
    // Affordability is decided once, against the statblock's current mana.
    const mp = sys.resources?.mp?.value ?? 0;
    for (const i of orderBySort([...this.document.items])) {
      const row = {
        id: i.id,
        name: i.name,
        img: i.img,
        typeLabel: game.i18n.localize(`TYPES.Item.${i.type}`)
      };
      if (i.type === "technick" || i.type === "talent") {
        technicks.push({ ...row, summary: grantSummary(i.system.grants) });
      } else if (i.type === "spell") {
        spells.push({
          ...row,
          school: i.system.school,
          schoolLabel: game.i18n.localize(`LASTARC.School.${i.system.school}`),
          mpCost: i.system.mpCost,
          castingTimeLabel: game.i18n.localize(
            LASTARC.castingTimes[i.system.castingTime]?.label ?? ""
          ),
          isArea: !!i.system.isArea,
          ...ROWS.magicRowCost(i.system.mpCost, mp, this.document.name, "LASTARC.Tooltip.CastSpell", game.i18n)
        });
      } else if (i.type === "performance") {
        performances.push({
          ...row,
          /**
           * NO mpCost and NO affordability. Performances do not cost mana —
           * see the schema. Reading the absent field gave `undefined`, and
           * `mp >= undefined` is FALSE for every value of mp, so every
           * performance row was permanently unaffordable.
           */
          specialisation: i.system.specialisation
        });
      } else {
        items.push(row);
      }
    }
    context.technicks = technicks;
    context.items = items;
    /**
     * Spells and performances a statblock owns (#49).
     *
     * They were falling into the generic Items list: visible, but with no MP
     * cost, no school and no way to cast them. The GM's report is that "many
     * NPCs will need to cast Spells and Performances", and the answer had been
     * "drop the item on them and roll it by hand".
     *
     * Same row shape as the character sheet's, because the same partial renders
     * both and a second shape would be a second thing to keep in step.
     */
    context.spells = spells;
    context.performances = performances;
    markOrder(this, { technicks, items });
    markStatuses(context, this.document);
    context.effects = effectPanelRows(this.document, (k) => game.i18n.localize(k));

    /**
     * Can this user open a file picker at all (#52)?
     *
     * `FILES_BROWSE` defaults to the TRUSTED role, so an ordinary PLAYER cannot
     * — and `FilePicker#browse()` simply RETURNS when they lack it. No error,
     * no notification, nothing in the console: the click does nothing and the
     * player has no way to learn why. Verified in a live v13 world; the GM's
     * report was "GMs can do it fine, players can't".
     *
     * The system cannot grant the permission and should not try. What it can do
     * is stop the portrait claiming to be clickable and say what to ask for.
     */
    context.canBrowseFiles = game.user?.can("FILES_BROWSE") ?? false;

    // Section titles are drawn by a shared partial that looks its label up
    // here, so `LASTARC.sheetSections` is the one place a panel is named.
    context.sectionLabels = sectionLabels("npc");

    return context;
  }

  /** Push this reader's arrangement onto the rendered statblock (#54, #55). */
  _onRender(context, options) {
    super._onRender(context, options);
    applyLayout(this, "npc");
    restoreScroll(this);
  }

  /** Note where the reader was before the re-render throws it away (#55). */
  _preRender(context, options) {
    rememberScroll(this);
    return super._preRender(context, options);
  }

  /**
   * A statblock takes effects too, and its shape is not a character's — the
   * builder resolves a scope against the actor it is creating on, so a defence
   * debuff lands on `base` here and on `misc` there. Skills are deliberately
   * absent from an NPC's picker: they are a printed array with no per-skill
   * slot to write to, so an effect could only address one by INDEX.
   */
  static async #onCreateEffect() {
    await promptCreateEffect(this.document);
  }

  static async #onEditEffect(event, target) {
    editEffect(this.document, target.dataset.effectId);
  }

  static async #onToggleEffect(event, target) {
    await toggleEffect(this.document, target.dataset.effectId);
  }

  static async #onDeleteEffect(event, target) {
    await deleteEffect(this.document, target.dataset.effectId);
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

    repackDamageMods(submit);

    return submit;
  }

  /* ------------------------------------------------------------------------ */

  static async #onRollAttribute(event, target) {
    const extra = await situationalOptions(event);
    if (extra === null) return;

    await rollAttribute(this.document, target.dataset.attribute, extra);
  }

  /**
   * Cast a spell from a statblock (#49).
   *
   * The same pipeline the character sheet uses, deliberately — a monster's
   * fireball and a player's are the same spell, and a second casting path would
   * be a second thing to keep in step with §18.
   *
   * `castSpell` reads Spellcraft through `skillTotalOf`, which understands both
   * actor shapes. Before that it read the character shape only, so a statblock
   * would have cast at +0 the moment this button existed.
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

  /** Perform from a statblock. Same pipeline as the character sheet's. */
  static async #onPerformItem(event, target) {
    const performance = this.document.items.get(target.dataset.itemId);
    if (!performance) return;

    const extra = await situationalOptions(event);
    if (extra === null) return;

    await performItem(this.document, performance, {
      ...extra,
      target: [...(game.user.targets ?? [])][0]?.actor,
      performDefensively: !!event.shiftKey,
      threatCount: event.shiftKey ? 1 : 0
    });
  }

  static async #onRollNpcAttack(event, target) {
    const index = Number(target.dataset.index);

    /**
     * A ranged statblock attack offers the same band picker a player gets
     * (#43), fed by the increments typed on the attack row.
     *
     * `npcRangeBands` returns null when none are recorded, and a melee attack
     * never asks — so the prompt appears exactly where the GM has said it
     * should and nowhere else.
     */
    const attack = this.document.system.attacks?.[index];
    const bands = attack && !attack.isMelee ? D.npcRangeBands(attack) : null;

    const extra = await situationalOptions(event, { rangeBands: bands });
    if (extra === null) return;

    const targeted = [...(game.user.targets ?? [])][0]?.actor;

    await rollNpcAttack(this.document, index, {
      ...extra,
      targetDefence: defenceToBeat(targeted),
      ...targetConditions(targeted),
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

  // The event is passed through for its `altKey`, which marks the creature
  // immune to the condition instead of applying it (#58).
  static async #onToggleStatus(event, target) {
    await toggleStatus(this, target, event);
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

    const sys = this.document.system;
    const penalty = sys.breakGauge.penalty ?? 0;
    /**
     * Statuses reach a statblock's skill checks too. A character picks up
     * `skillCheckPenalty` through derivation; an NPC's skills are printed
     * numbers, so it has to be added at the roll — the same reason its attack
     * bonus takes its status penalty here rather than in the model.
     *
     * Through the shared roller so Misfortune's reroll-and-keep-lower applies:
     * this is a skill check, and it was the eighth bare d20 in the codebase.
     */
    const statusPenalty = sys.statuses?.skillCheckPenalty ?? 0;
    const { roll } = await rollCheckD20(
      this.document, entry.value + penalty + statusPenalty
    );
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

  /* -- arranging the sheet itself (#54, #55) ------------------------------- */

  static async #onToggleSection(event, target) {
    await toggleSection(this, "npc", target);
  }

  static async #onMoveSection(event, target) {
    await moveSection(this, "npc", target);
  }

  static async #onToggleLayoutLock() {
    await toggleLayoutLock(this, "npc");
  }

  static async #onResetLayout() {
    await resetLayout(this, "npc");
  }
}
