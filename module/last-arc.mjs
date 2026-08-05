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
import { warnUnsupportedTargets } from "./effects.mjs";
import { registerCombat, holdTurn, spendAction, resetActions, rollGroupInitiative }
  from "./combat.mjs";
import * as INIT from "./initiative.mjs";
import * as AE from "./action-economy.mjs";
import * as AMMO from "./ammunition.mjs";
import { AMMO_MODES } from "./ammunition.mjs";
import { registerAmmunition } from "./dice/ammunition.mjs";
import { registerQuenchBatches } from "./quench.mjs";
import { createWorldCompendiums, offerContentSetup, registerContentSettings }
  from "./world-content.mjs";

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
    ammunition: AMMO,
    holdTurn,
    spendAction,
    resetActions,
    rollGroupInitiative,
    /**
     * Build the standard compendium set in the WORLD.
     *
     * Public because it is the answer to "where do I put the content I typed
     * in", and that answer used to be a set of system packs every update
     * destroyed. A macro one-liner, so a GM can run it without a UI for it.
     */
    createWorldCompendiums
  };

  CONFIG.Actor.dataModels.character = LastArcCharacterData;
  CONFIG.Actor.dataModels.npc = LastArcNpcData;
  Object.assign(CONFIG.Item.dataModels, ITEM_DATA_MODELS);

  registerSettings();
  registerContentSettings();
  registerTokenDefaults();
  registerResourceDefaults();
  registerEffectGuards();
  registerSheets();
  registerHandlebarsHelpers();
  registerPartials();
  registerStatusEffects();
  registerChatListeners();
  registerCombat();
  registerAmmunition();

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
 * Say something when an Active Effect points where it cannot work (issue #20).
 *
 * Effects apply BETWEEN `prepareBaseData` and `prepareDerivedData`, so every
 * path derivation assigns is overwritten in memory on the next prepare. The
 * failure is completely silent: the effect exists, its icon shows on the token,
 * and the number never moves.
 *
 * Both create and update, because the path is as easy to get wrong on the
 * second edit as the first.
 */
function registerEffectGuards() {
  Hooks.on("preCreateActiveEffect", (effect) => warnUnsupportedTargets(effect));
  Hooks.on("preUpdateActiveEffect", (effect, changed) => {
    // `changed` carries the incoming edit; fall back to the stored effect when
    // the update does not touch `changes` at all.
    if (!changed?.changes) return;
    warnUnsupportedTargets({ name: effect.name, changes: changed.changes });
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

  /**
   * Raising a maximum on a creature that is at FULL keeps it at full.
   *
   * The hook above cannot help a statblock, and that is not a detail: a
   * character's HP and MP maxima are DERIVED, so they exist the instant the
   * actor does. An NPC's are printed numbers the GM types in afterwards, and
   * they start at 10/10 and 0/0. So `createActor` runs while `mp.max` is still
   * 0, its `max > 0` condition is false, and it never fires for an NPC at all.
   *
   * The GM then types a maximum, the current value stays where it was, and:
   *
   *   - a monster with 60 max HP sits at 10 and dies to a stiff breeze;
   *   - a bard with 20 max MP sits at 0, so every performance and spell it owns
   *     renders as a DISABLED button that explains nothing. Reported from a
   *     playtest as "Floofers couldn't perform".
   *
   * "Was at full" is the test, rather than "was at the schema default". It is
   * the honest reading of the intent — you are describing the creature, not
   * wounding it — and it leaves a deliberately-injured creature alone: set a
   * monster to 3/10 and raise the max to 60 and it stays on 3, which is what
   * someone who typed a 3 meant.
   *
   * `preUpdate`, so the fill rides along inside the GM's own write instead of
   * chasing it with a second one. That also means no client guard is needed:
   * this mutates the pending data on the client already making the change.
   */
  Hooks.on("preUpdateActor", (actor, changed) => {
    const get = foundry.utils.getProperty;
    const set = foundry.utils.setProperty;

    for (const key of ["hp", "mp"]) {
      const newMax = get(changed, `system.resources.${key}.max`);
      if (newMax == null) continue;

      // An explicit value in the SAME update always wins — the GM is stating
      // both numbers, and second-guessing that would fight their typing.
      if (get(changed, `system.resources.${key}.value`) != null) continue;

      const current = actor.system.resources?.[key];
      if (!current || current.value !== current.max) continue;   // not at full
      if (newMax <= current.max) continue;                       // only ever upward

      set(changed, `system.resources.${key}.value`, newMax);
    }
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

  // Issue #7 — whether the Break Gauge penalty drags Break Threshold down with
  // it. OFF by default: the gauge's penalty is enumerated in the book as
  // applying to attack rolls, skill checks, attribute checks and defences, and
  // Threshold is named in none of those. Deriving it from the penalised
  // Fortitude produced a death spiral the text does not ask for.
  def("breakGaugeAffectsThreshold", {
    name: "LASTARC.Setting.breakGaugeAffectsThreshold.name",
    hint: "LASTARC.Setting.breakGaugeAffectsThreshold.hint",
    initial: false
  });

  /**
   * Ammunition tracking (book p.102).
   *
   * OFF BY DEFAULT, and that is a decision rather than an oversight. The book
   * presents counting arrows as the assumed rule and the ammo die as its
   * optional replacement, but tracking either one is bookkeeping a table opts
   * into. Shipping this switched on would have changed how every existing bow
   * and crossbow behaves in worlds whose players never asked for it — the
   * feature would arrive as a bug report about crossbows that will not fire.
   *
   * A choice rather than two booleans: the systems are alternatives, not
   * layers, and two switches would let a table select both and get an
   * arithmetic no page of the book describes.
   */
  game.settings.register(SYSTEM_ID, "ammoTracking", {
    name: "LASTARC.Setting.ammoTracking.name",
    hint: "LASTARC.Setting.ammoTracking.hint",
    scope: "world", config: true, type: String, default: "off",
    choices: Object.fromEntries(
      AMMO_MODES.map((m) => [m, `LASTARC.AmmoMode.${m}`])
    )
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

/**
 * Markup shared between panels, registered under a short alias.
 *
 * NOT awaited: `init` handlers are called synchronously by Foundry, and the
 * sheets that use these partials cannot render until a document is opened,
 * which is long after the fetch settles. Awaiting here would only delay `init`
 * for everything else.
 */
function registerPartials() {
  foundry.applications.handlebars.loadTemplates({
    laItemOrder: `systems/${SYSTEM_ID}/templates/actor/item-order.hbs`,
    laStatusPalette: `systems/${SYSTEM_ID}/templates/actor/status-palette.hbs`,
    laEffectsPanel: `systems/${SYSTEM_ID}/templates/actor/effects-panel.hbs`,
    laDamageMods: `systems/${SYSTEM_ID}/templates/actor/damage-mods.hbs`
  }).catch((err) => {
    // A missing partial fails at RENDER time, as "The partial laItemOrder could
    // not be found" from deep inside Handlebars, with nothing pointing back
    // here. Say it out loud at load instead.
    console.error("Last Arc | Shared partials failed to load; sheets will not render.", err);
  });
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

  // Offer to build the compendium set where updates cannot reach it. The system
  // used to declare packs of its own and every update destroyed them; a GM who
  // has just lost that content needs a button, not an API to look up.
  offerContentSetup();
});
