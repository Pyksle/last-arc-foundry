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
import * as heroPoints from "./dice/hero-points.mjs";
import { registerChatListeners } from "./chat.mjs";
import { registerCombat, holdTurn, spendAction, resetActions, rollGroupInitiative }
  from "./combat.mjs";
import * as INIT from "./initiative.mjs";
import * as AE from "./action-economy.mjs";
import { registerQuenchBatches } from "./quench.mjs";

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
    rollExplodingDice,
    heroPoints,
    initiative: INIT,
    actionEconomy: AE,
    holdTurn,
    spendAction,
    resetActions,
    rollGroupInitiative
  };

  CONFIG.Actor.dataModels.character = LastArcCharacterData;
  CONFIG.Actor.dataModels.npc = LastArcNpcData;
  Object.assign(CONFIG.Item.dataModels, ITEM_DATA_MODELS);

  registerSettings();
  registerTokenDefaults();
  registerResourceDefaults();
  registerSheets();
  registerHandlebarsHelpers();
  registerStatusEffects();
  registerChatListeners();
  registerCombat();

  // Integration tests. The hook only fires when Quench is installed and active,
  // so a normal user never sees any of this.
  registerQuenchBatches();
});

/* -------------------------------------------------------------------------- */
/*  Settings (§15)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every documented ambiguity is a setting with a stated default rather than a
 * silent choice. A4 is absent because it was RESOLVED against the printed sheet
 * (Passive Perception = 10 + Perception) and no longer needs one.
 */
/**
 * Sensible prototype-token defaults per actor type.
 *
 * Foundry creates every actor with a HOSTILE token. For a player character that
 * is simply wrong, and it is not cosmetic: threat, counterattacks and targeting
 * all key off disposition, so a party of "hostile" PCs threatens nobody and
 * provokes nothing. Characters are also linked by default, so their sheet and
 * their token are one creature; NPCs stay unlinked so each token takes its own
 * damage.
 */
function registerTokenDefaults() {
  Hooks.on("preCreateActor", (actor, data) => {
    if (data.prototypeToken?.disposition !== undefined) return;   // author chose

    const isCharacter = actor.type === "character";
    actor.updateSource({
      prototypeToken: {
        disposition: isCharacter
          ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
          : CONST.TOKEN_DISPOSITIONS.HOSTILE,
        actorLink: isCharacter,
        sight: { enabled: isCharacter }
      }
    });
  });
}

/**
 * Start new actors at full HP and MP.
 *
 * Both resources default to their schema initial (10 and 0) while the MAXIMUM
 * is derived from class and attributes, so a freshly created level-6 character
 * arrives at 10/53 hit points and 0/36 mana. In a playtest the front-liner was
 * dropped in round one by an attack he should have shrugged off, and the caster
 * could not cast at all.
 *
 * Runs on `createActor` rather than `preCreateActor` because the maximum is
 * DERIVED — it does not exist until the document has been prepared.
 *
 * Only fills a resource that is still sitting at its schema default, so an
 * import or a duplicate that carries real values is left alone.
 */
function registerResourceDefaults() {
  Hooks.on("createActor", async (actor, options, userId) => {
    if (game.user.id !== userId) return;

    const updates = {};
    const hp = actor.system.resources?.hp;
    const mp = actor.system.resources?.mp;

    if (hp && hp.value === 10 && hp.max > 10) updates["system.resources.hp.value"] = hp.max;
    if (mp && mp.value === 0 && mp.max > 0) updates["system.resources.mp.value"] = mp.max;

    if (Object.keys(updates).length) await actor.update(updates);
  });
}

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
  Handlebars.registerHelper("lasignal", (n) => D.signed(n));

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
  CONFIG.statusEffects = LASTARC.allStatusIds.map((id) => {
    const isCurse = id in LASTARC.curses;
    return {
      id,
      name: `LASTARC.Status.${id}`,
      img: `systems/${SYSTEM_ID}/assets/status/${id}.svg`,
      // Curses are a sub-type: different curses stack, duplicates do not.
      ...(isCurse ? { flags: { [SYSTEM_ID]: { curse: true } } } : {})
    };
  });

  // Foundry's default "dead" overlay does not apply here — a Last Arc character
  // at 0 HP is unconscious, prone and helpless rather than dead, and death is a
  // separate outcome of the Vitality check (§5.6).
  CONFIG.specialStatusEffects.DEFEATED = "helpless";
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
