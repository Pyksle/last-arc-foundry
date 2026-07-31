/**
 * Last Arc: Tactics Analogue — system entry point.
 *
 * This is the only module that touches Foundry globals at load time. Everything
 * mechanical lives in config.mjs and derivation.mjs, both of which are
 * Foundry-free and unit tested.
 */

import { LASTARC } from "./config.mjs";
import * as D from "./derivation.mjs";
import { LastArcCharacterData } from "./data/character.mjs";
import { LastArcNpcData } from "./data/npc.mjs";
import { ITEM_DATA_MODELS } from "./data/items.mjs";
import { LastArcCharacterSheet } from "./sheets/character-sheet.mjs";
import { LastArcNpcSheet } from "./sheets/npc-sheet.mjs";
import { LastArcItemSheet } from "./sheets/item-sheet.mjs";
import { rollSkill, rollAttribute, takeN } from "./dice/rolls.mjs";
import { rollAttack, rollDamage, applyDamage } from "./dice/attack.mjs";
import { explodeDice, rollExplodingDice } from "./dice/explode.mjs";
import { registerChatListeners } from "./chat.mjs";

const SYSTEM_ID = "last-arc";

/* -------------------------------------------------------------------------- */
/*  Init                                                                       */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  console.log("Last Arc | Initialising");

  CONFIG.LASTARC = LASTARC;

  // Public API surface for macros and modules.
  game.lastarc = {
    config: LASTARC,
    derivation: D,
    rollSkill,
    rollAttribute,
    takeN,
    rollAttack,
    rollDamage,
    applyDamage,
    explodeDice,
    rollExplodingDice
  };

  CONFIG.Actor.dataModels.character = LastArcCharacterData;
  CONFIG.Actor.dataModels.npc = LastArcNpcData;
  Object.assign(CONFIG.Item.dataModels, ITEM_DATA_MODELS);

  registerSettings();
  registerSheets();
  registerHandlebarsHelpers();
  registerStatusEffects();
  registerChatListeners();
  applyInvertedInitiative();
});

/* -------------------------------------------------------------------------- */
/*  Settings (§15)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every documented ambiguity is a setting with a stated default rather than a
 * silent choice. A4 is absent because it was RESOLVED against the printed sheet
 * (Passive Perception = 10 + Perception) and no longer needs one.
 */
function registerSettings() {
  const def = (key, { name, hint, type = Boolean, initial }) =>
    game.settings.register(SYSTEM_ID, key, {
      name, hint, scope: "world", config: true, type, default: initial
    });

  // A1 — highest impact: changes every Break Gauge interaction in the game.
  def("breakThresholdUsesPostDR", {
    name: "LASTARC.Setting.breakThresholdUsesPostDR.name",
    hint: "LASTARC.Setting.breakThresholdUsesPostDR.hint",
    initial: true
  });

  // A2 — hero point 1d6 to a defence; Threshold IS Fortitude, so it rides along.
  def("heroPointAffectsThreshold", {
    name: "LASTARC.Setting.heroPointAffectsThreshold.name",
    hint: "LASTARC.Setting.heroPointAffectsThreshold.hint",
    initial: true
  });

  // A3 — stated −5..+5 range vs racial caps of 22 (which compute to +6).
  def("clampAttributeModifier", {
    name: "LASTARC.Setting.clampAttributeModifier.name",
    hint: "LASTARC.Setting.clampAttributeModifier.hint",
    initial: true
  });

  // A9 — §4.3 and A5 disagree; default follows A5.
  def("multiclassRegrantsLevel1Benefits", {
    name: "LASTARC.Setting.multiclassRegrantsLevel1Benefits.name",
    hint: "LASTARC.Setting.multiclassRegrantsLevel1Benefits.hint",
    initial: false
  });

  // A6 — Combo chaining depth.
  game.settings.register(SYSTEM_ID, "maxComboChain", {
    name: "LASTARC.Setting.maxComboChain.name",
    hint: "LASTARC.Setting.maxComboChain.hint",
    scope: "world", config: true, type: Number, default: LASTARC.maxComboChain
  });
}

/* -------------------------------------------------------------------------- */
/*  Sheets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * NOTE: unregistering the core sheet means EVERY subtype we declare must get a
 * replacement. Registering only `character` here previously left NPC actors with
 * no sheet at all — they simply would not open. The integrity suite now asserts
 * that every subtype in system.json has a registered sheet.
 */
function registerSheets() {
  const { DocumentSheetConfig } = foundry.applications.apps;

  DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.appv1.sheets.ActorSheet);
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, LastArcCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "LASTARC.Sheet.Character"
  });
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, LastArcNpcSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "LASTARC.Sheet.Npc"
  });

  DocumentSheetConfig.unregisterSheet(Item, "core", foundry.appv1.sheets.ItemSheet);
  DocumentSheetConfig.registerSheet(Item, SYSTEM_ID, LastArcItemSheet, {
    types: Object.keys(ITEM_DATA_MODELS),
    makeDefault: true,
    label: "LASTARC.Sheet.Item"
  });
}

/* -------------------------------------------------------------------------- */
/*  Handlebars                                                                 */
/* -------------------------------------------------------------------------- */

function registerHandlebarsHelpers() {
  /** Format a modifier with an explicit sign: 3 → "+3", −2 → "−2", 0 → "+0". */
  Handlebars.registerHelper("lasignal", (n) => {
    const v = Number(n) || 0;
    return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
  });

  Handlebars.registerHelper("laeq", (a, b) => a === b);
  Handlebars.registerHelper("lagte", (a, b) => Number(a) >= Number(b));
}

/* -------------------------------------------------------------------------- */
/*  Status effects (§12)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Durations here are deliberately LONG. §12 is explicit that statuses do not
 * expire at end of turn or end of encounter — they persist until a specific
 * clearance condition is met. Do not add round-based durations to these.
 */
function registerStatusEffects() {
  const statuses = [
    "blind", "confusion", "disease", "drench", "oil", "paralysis", "petrify",
    "poison", "silence", "sleep", "flatFooted", "prone", "helpless", "grabbed",
    "pinned", "encumbered", "overencumbered"
  ];

  CONFIG.statusEffects = statuses.map((id) => ({
    id,
    name: `LASTARC.Status.${id}`,
    img: `systems/${SYSTEM_ID}/assets/status/${id}.svg`
  }));
}

/* -------------------------------------------------------------------------- */
/*  Inverted initiative (§8)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Foundry sorts combatants DESCENDING by initiative. Last Arc runs ascending:
 * lowest acts first, ties broken by higher Agility SCORE.
 *
 * Strictly this is Phase 4 work, but §16 flags it as painful to retrofit and the
 * override is small — installing it now means every later combat feature is
 * built against the correct ordering.
 *
 * Deliberately NOT solved by storing a negated initiative value: that surfaces
 * wrong in the tracker UI and to every module that reads `combatant.initiative`.
 */
function applyInvertedInitiative() {
  Combat.prototype._sortCombatants = function (a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    return D.compareInitiative(
      { initiative: ia, agiScore: a.actor?.system?.attributes?.agi?.total ?? 0 },
      { initiative: ib, agiScore: b.actor?.system?.attributes?.agi?.total ?? 0 }
    ) || (a.id > b.id ? 1 : -1);
  };
}

/* -------------------------------------------------------------------------- */
/*  Ready                                                                      */
/* -------------------------------------------------------------------------- */

Hooks.once("ready", () => {
  // Loud, early warning for the config gaps that Phase 5 ingestion must close.
  const missing = Object.entries(LASTARC.classes)
    .filter(([, c]) => c.trainedSkills === null)
    .map(([k]) => k);

  if (missing.length) {
    console.warn(
      `Last Arc | Trained-skill counts are unknown for: ${missing.join(", ")}. ` +
      `These must be read from the class tables (book pp.34-55). ` +
      `Character creation for those classes will throw until they are filled in.`
    );
  }
});
