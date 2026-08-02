/**
 * Offline sheet preview harness.
 *
 * Renders the Handlebars templates with a synthetic actor and wraps the result
 * in a standalone HTML page, so the sheet's layout and CSS can be inspected
 * without a Foundry install. Two things this buys us:
 *
 *   1. It proves the templates COMPILE and that every path they reference
 *      actually exists on the context object `_prepareContext` builds.
 *   2. It makes the visual design reviewable at all in this environment.
 *
 * It is a development tool, not part of the shipped system.
 *
 *   node tools/preview.mjs [outfile]
 */

import Handlebars from "handlebars";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import * as D from "../module/derivation.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
const css = readFileSync(join(root, "styles/last-arc.css"), "utf8");

/* -------------------------------------------------------------------------- */
/*  Helper stubs — must mirror registerHandlebarsHelpers() in last-arc.mjs      */
/* -------------------------------------------------------------------------- */

const localize = (key) => lang[key] ?? key;

/**
 * Foundry's `localize` also FORMATS: `{{localize "X" n=2 scope="Will"}}`
 * substitutes `{n}` and `{scope}` in the string.
 *
 * The stub used to ignore the hash entirely, so every formatted string previewed
 * with its raw `{placeholders}` showing. That is the harness misleading in
 * exactly the way it exists to prevent — a reviewer sees `{n}` and cannot tell a
 * missing context value from a stub that never substitutes.
 */
Handlebars.registerHelper("localize", (key, options) => {
  let out = localize(key);
  for (const [k, v] of Object.entries(options?.hash ?? {})) {
    out = out.replaceAll(`{${k}}`, v ?? "");
  }
  return new Handlebars.SafeString(out);
});
Handlebars.registerHelper("lasignal", (n) => {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
});
Handlebars.registerHelper("laeq", (a, b) => a === b);
Handlebars.registerHelper("lagte", (a, b) => Number(a) >= Number(b));

/**
 * Foundry's own Handlebars helpers, stubbed to the shape the templates need.
 *
 * `formInput` is the documented way to get a `<prose-mirror>` editor out of an
 * HTMLField, so the biography and description panels use it. It belongs to
 * Foundry, not to us, and a bare Handlebars has never heard of it.
 *
 * The stub emits a real `<prose-mirror name=…>` because the layout question
 * this harness exists to answer is about that element specifically — see the
 * warning in CLAUDE.md about restyling it.
 */
Handlebars.registerHelper("formInput", (field, options) => {
  const name = options?.hash?.name ?? field?.fieldPath ?? "";
  const value = options?.hash?.value ?? "";
  return new Handlebars.SafeString(
    `<prose-mirror name="${name}" toggled=""><div class="editor-content">${value}</div></prose-mirror>`
  );
});

/**
 * PARTIALS. `registerPartials()` in last-arc.mjs hands these to Foundry's
 * template loader; Handlebars here knows nothing about them, and a missing
 * partial is a THROW, not a blank.
 *
 * Their absence is why this tool stopped working. Nothing runs it in CI, so it
 * broke silently the day the first partial was introduced and stayed broken —
 * which is the whole reason every sheet change since has shipped with "not
 * rendered in a live Foundry" attached to it. The one thing that could have
 * checked was itself unchecked.
 *
 * Read from the same paths last-arc.mjs registers, so adding a partial there
 * and forgetting it here fails loudly the next time anyone previews.
 */
export const PARTIALS = {
  laItemOrder: "templates/actor/item-order.hbs",
  laStatusPalette: "templates/actor/status-palette.hbs"
};
for (const [name, rel] of Object.entries(PARTIALS)) {
  Handlebars.registerPartial(name, readFileSync(join(root, rel), "utf8"));
}

/** The configured Handlebars, so a test can compile templates the same way. */
export { Handlebars };

/* -------------------------------------------------------------------------- */
/*  Synthetic actor                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A level-5 Warrior/Rogue at Break step 2 with one persistent step, wearing
 * heavy armour they are not proficient with. Deliberately not a clean case: it
 * exercises the multiclass path, the death spiral, the persistent floor, and
 * the armour check penalty all at once.
 */
export function buildContext() {
  const scores = { str: 16, vit: 14, agi: 13, int: 10, mnd: 8, chr: 12 };
  const level = 5;
  const breakStep = 2;
  const persistentSteps = 1;

  const attrs = {};
  for (const [k, v] of Object.entries(scores)) {
    attrs[k] = { value: v, racialMod: 0, cap: 20, total: v, mod: D.attributeModifier(v) };
  }

  const classes = [{ name: "warrior", levels: 3 }, { name: "rogue", levels: 2 }];
  const classBonus = D.classDefenceBonuses(classes);
  const armour = { refBonus: 4, maxAgiBonus: 1, checkPenalty: 5, dr: 3, type: "heavy" };

  const defs = D.computeDefences({
    level,
    agiMod: attrs.agi.mod,
    vitMod: attrs.vit.mod,
    mndMod: attrs.mnd.mod,
    classBonus,
    armour,
    sizeMod: 0,
    breakStep
  });

  const threshold = D.breakThreshold({ fort: defs.fort, size: "medium" });

  const mkSkill = (key, cfg) => {
    const trained = ["athletics", "perception", "oneHanded"].includes(key);
    // Stealth is trained BY A TECHNICK, so it counts as trained in the maths
    // while the player's own box stays unticked — the reported case.
    const grantedTrained = key === "stealth";
    const total = D.skillModifier({
      level,
      attrMod: attrs[cfg.attr].mod,
      trained: trained || grantedTrained,
      focus: key === "athletics" ? 2 : 0,
      armourCheckPenalty: armour.checkPenalty,
      appliesArmourPenalty: !!cfg.acp,      // not proficient with heavy
      breakStep
    });
    return {
      key, label: cfg.label, attr: cfg.attr,
      attrAbbr: LASTARC.attributes[cfg.attr].abbr,
      subskilled: !!cfg.subskilled,
      isWeaponSkill: !!cfg.weapon,
      trained, focus: key === "athletics" ? 2 : 0, misc: 0, total,
      /**
       * A technick-granted training and a granted focus, so the markers added
       * for issue #43 are actually exercised. Stealth is trained by a technick
       * the player never ticked — the case the GM reported, where an empty box
       * read as "you do not have this skill".
       */
      // Granted and NOT hand-trained — the case the GM reported.
      grantedTrained,
      grantedFocus: key === "perception" ? 1 : 0,
      grantedBonus: key === "perception" ? 2 : 0,
      adjustment: key === "stealth" ? 2 : (key === "perception" ? 3 : 0),
      hasAdjustment: ["stealth", "perception"].includes(key),
      adjustmentTooltip: key === "stealth" ? "Granted training +2" : "Technick +2 · Granted focus +1",
      appliesArmourPenalty: !!cfg.acp,
      halfLevel: D.rd(level / 2),
      attrMod: attrs[cfg.attr].mod,
      subskills: cfg.subskilled
        ? [{ name: key === "lore" ? "Ruins" : "Oratory", trained: true, focus: 0, misc: 0, index: 0,
             total: D.skillModifier({ level, attrMod: attrs[cfg.attr].mod, trained: true, breakStep }) }]
        : []
    };
  };

  const skills = Object.entries(LASTARC.skills).map(([k, c]) => mkSkill(k, c));
  const weaponSkills = Object.entries(LASTARC.weaponSkills).map(([k, c]) => mkSkill(k, c));
  const perception = skills.find((s) => s.key === "perception");

  const hpMax = D.hpMax(classes, attrs.vit.mod);

  return {
    document: { name: "Vashti Corvale", img: "" },
    system: {
      attributes: attrs,
      details: {
        race: "Half-Elf", gender: "Non-binary", size: "medium",
        level, xp: 6500, xpNext: 10000,
        ethosPurity: "neutral", ethosMorality: "good",
      },
      classes,
      resources: {
        hp: { value: 21, max: hpMax, temp: 4 },
        mp: { value: 6, max: D.mpMax(classes, attrs.mnd.mod) },
        heroPoints: { value: 1, max: D.heroPointMax(level) },
        naturalHealingBlocked: true,
        secondWind: { used: 0, max: 1, canUse: true, healAmount: D.secondWindHeal(14, hpMax) }
      },
      defences: {
        ref:  { value: defs.ref, beforeBreak: defs.ref - defs.breakPenalty, classBonus: classBonus.ref, technicks: 0, misc: 0, flatFooted: defs.ref - Math.max(0, attrs.agi.mod) },
        fort: { value: defs.fort, beforeBreak: defs.fort - defs.breakPenalty, classBonus: classBonus.fort, technicks: 0, misc: 0 },
        will: { value: defs.will, beforeBreak: defs.will - defs.breakPenalty, classBonus: classBonus.will, technicks: 0, misc: 0 }
      },
      breakGauge: {
        step: breakStep, persistentSteps, threshold, recoveryProgress: 1,
        penalty: defs.breakPenalty, recoveryRequired: 3, recoveryBlocked: false
      },
      movement: { base: 6, value: D.speedAfterPenalties(6, [0.25]) },
      bulk: { value: 5.4, max: D.bulkLimits(16).max, overMax: D.bulkLimits(16).overMax, state: "encumbered" },
      initiative: { effectiveDie: "d10" },
      damageMods: { dr: armour.dr },
      skills: Object.fromEntries(skills.map((s) => [s.key, s]))
    },
    attributes: LASTARC.attributeOrder.map((key) => ({
      key, label: LASTARC.attributes[key].label, abbr: LASTARC.attributes[key].abbr, ...attrs[key]
    })),
    skills,
    weaponSkills,
    passivePerception: D.passivePerception(perception.total),
    breakTrack: LASTARC.breakPenalties.map((penalty, step) => ({
      step, penalty,
      isCurrent: step === breakStep,
      isPassed: step < breakStep,
      isPersistent: step > 0 && step <= persistentSteps,
      isTerminal: penalty === null,
      label: penalty === null ? localize("LASTARC.Break.Unconscious")
           : penalty === 0 ? localize("LASTARC.Break.Normal")
           : `−${Math.abs(penalty)}`
    })),
    recoveryTarget: LASTARC.recoveryMinorActions,

    // One poison step (blocks natural healing) and one injury step (does not),
    // so the visual distinction between the two is actually exercised.
    persistentSources: [
      { index: 0, label: "Serpent venom", clearedBy: "Antidote or Remedy", fromInjury: false },
      { index: 1, label: "Cracked ribs", clearedBy: "Medicine DC 15, one week", fromInjury: true }
    ],
    // Mirrors the sheet's own computation; without these the gauges render
    // empty here while working in Foundry, which is exactly the kind of
    // divergence that makes an offline preview untrustworthy.
    hpPercent: Math.round((21 / hpMax) * 100),
    mpPercent: Math.round((6 / D.mpMax(classes, attrs.mnd.mod)) * 100),

    canSpendHero: true,
    misfortuneBlocksReroll: true,

    // Mid-Recovery with the primary already spent — the state where the
    // interrupt rule matters and the one worth eyeballing.
    actionEconomy: {
      slots: [
        { key: "primary", label: "LASTARC.Action.Primary",
          tooltip: "LASTARC.Tooltip.SlotPrimary", available: false },
        { key: "secondary", label: "LASTARC.Action.Secondary",
          tooltip: "LASTARC.Tooltip.SlotSecondary", available: true },
        { key: "minor", label: "LASTARC.Action.Minor",
          tooltip: "LASTARC.Tooltip.SlotMinor", available: true }
      ],
      availableMinors: 2,
      banked: {
        active: true, label: "LASTARC.Action.Recovery",
        count: 2, required: 3, pips: [true, true, false]
      },
      reactionUsed: false,
      reactionsBlocked: false
    },
    defenceRows: ["ref", "fort", "will"].map((key) => ({
      key, label: `LASTARC.Defence.${key}`,
      value: defs[key],
      beforeBreak: defs[key] - defs.breakPenalty,
      classBonus: classBonus[key], technicks: 0, misc: 0
    })),
    classes: classes.map((c, index) => ({
      ...c, advanced: "", index, isFirst: index === 0, isOnly: classes.length === 1
    })),

    // A usable weapon and one that is too large, so the disabled/unusable state
    // is visible rather than only reasoned about.
    attacks: [
      { id: "w1", name: "Arming Sword", img: "", unusable: false,
        wieldLabel: "LASTARC.Skill.oneHanded", wieldTooltip: "LASTARC.Tooltip.WieldDerived",
        atkTotal: 6, damage: "1d8", damageFlat: 5, damageTypeLabel: "LASTARC.DamageType.slashing" },
      { id: "w2", name: "Greataxe", img: "", unusable: false,
        wieldLabel: "LASTARC.Skill.twoHanded", wieldTooltip: "LASTARC.Tooltip.WieldDerived",
        atkTotal: 4, damage: "1d12", damageFlat: 8, damageTypeLabel: "LASTARC.DamageType.slashing" },
      { id: "w3", name: "Siege Maul", img: "", unusable: true,
        wieldLabel: "LASTARC.Derived.Unusable", wieldTooltip: "LASTARC.Tooltip.WeaponUnusable",
        atkTotal: 0, damage: "3d10", damageFlat: 0, damageTypeLabel: "LASTARC.DamageType.blunt" }
    ],

    // Two technicks: one whose prerequisites hold, one whose do not, so the
    // unmet-prerequisite state is visible in the preview rather than only in
    // theory. The third row exercises the behavioural (no numeric payload) case.
    technicks: [
      { id: "t1", name: "Improved Initiative", img: "", kindLabel: "Technick",
        summary: "Init −1 step", prereqsMet: true, unmetText: "" },
      { id: "t2", name: "Weapon Finesse", img: "", kindLabel: "Technick",
        summary: "", prereqsMet: true, unmetText: "" },
      { id: "t3", name: "Dual Wield II", img: "", kindLabel: "Technick",
        summary: "", prereqsMet: false, unmetText: "agi 17 (have 13), technick: dual-wield-i" }
    ],
    inventory: [
      { id: "i1", name: "Brigandine", img: "", typeLabel: "Armour", quantity: null,
        totalBulk: 3, equipped: true, equippable: true, broken: false },
      { id: "i2", name: "Arming Sword", img: "", typeLabel: "Weapon", quantity: null,
        totalBulk: 1, equipped: true, equippable: true, broken: false },
      { id: "i3", name: "Cracked Buckler", img: "", typeLabel: "Shield", quantity: null,
        totalBulk: 1, equipped: false, equippable: true, broken: true },
      { id: "i4", name: "Potion of Mending", img: "", typeLabel: "Consumable", quantity: 4,
        totalBulk: 0.4, equipped: false, equippable: false, broken: false }
    ],
    bulkState: "encumbered",
    bulkStateLabel: "LASTARC.Status.encumbered",
    /**
     * These three were ABSENT, so the Proficiencies and Statuses panels
     * rendered as empty boxes in every preview ever taken. That is the harness
     * lying in the safe direction, which is still lying: a reviewer sees a
     * blank panel and cannot tell "not wired up" from "not in this fixture".
     *
     * The keys are named to match `_prepareContext` exactly. There is no
     * mechanism forcing that — the harness builds its own context by hand — and
     * that is the same second-copy-of-a-decision problem that produced issue
     * #40, sitting in the verification tool this time. Recorded on the board
     * rather than fixed here.
     */
    /**
     * Label keys and the `active` flag are copied from `_prepareContext`
     * VERBATIM. The first version of this guessed `armourTypes[key].label` and
     * `proficient`, and the preview duly rendered "undefined · undefined ·
     * undefined" with every tick blank — `armourTypes` is a string map, and the
     * flag is called `active`.
     *
     * That is the fixture-drift problem in miniature and the reason #44 stays
     * open: matching key NAMES is checkable, matching the shape behind them is
     * not, and only rendering it and looking caught this.
     */
    weaponProficiencies: LASTARC.weaponCategories.map((key, i) => ({
      key, label: `LASTARC.WeaponCategory.${key}`, active: i < 3
    })),
    armourProficiencies: Object.keys(LASTARC.armourTypes).map((key, i) => ({
      key, label: `LASTARC.ArmourType.${key}`, active: i === 0
    })),
    statuses: LASTARC.allStatusIds.slice(0, 6).map((id, i) => ({
      id, label: `LASTARC.Status.${id}`,
      img: `assets/status/${id}.svg`, active: i === 0, isCurse: false
    })),

    /**
     * The rest of what `_prepareContext` assigns (issue #44).
     *
     * Fourteen keys were missing, so the Spells, Performances and Features
     * panels, the Second Wind pips and the study allowances all rendered blank
     * in every preview ever taken. The harness was failing in the SAFE
     * direction, which is why nobody noticed and why it is still wrong: a
     * reviewer sees an empty panel and cannot tell "not wired up" from "not in
     * this fixture", and telling those apart is the entire job.
     *
     * Names are synthetic on purpose — no rulebook content lives in this repo.
     */
    config: LASTARC,
    editable: true,
    fields: {},
    enrichedBiography: "<p>A synthetic biography, for layout only.</p>",
    languagesText: "ZZ trade cant, ZZ high tongue",
    movementInput: { fly: 0, hover: false },
    secondWindPips: [
      { index: 0, spent: true, label: "Second Wind 1" },
      { index: 1, spent: false, label: "Second Wind 2" }
    ],
    spells: [
      { id: "s1", name: "ZZ probe", img: "", school: "black", schoolLabel: "Black",
        mpCost: 3, castingTimeLabel: "Primary", isArea: false }
    ],
    performances: [
      { id: "p1", name: "ZZ cadence", img: "", kindLabel: "Enhancing",
        specLabel: "Instrument" }
    ],
    features: [
      { id: "f1", name: "ZZ trait", img: "", typeLabel: "Feature", summary: "" }
    ],
    /** Over the limit on spells, so the readout's warning state is visible. */
    study: {
      spells: { known: 2, max: 1, takings: 1, over: true },
      performances: { known: 0, max: 0, takings: 0, over: false }
    },
    noArcaneStudy: false,
    noBardicStudy: true,
    highArcanaOptions: LASTARC.highArcanaIds.map((id) => ({
      value: id, label: LASTARC.highArcana[id].label
    })),

    classOptions: Object.entries(LASTARC.classes).map(([k, c]) => ({ value: k, label: c.label })),
    sizeOptions: LASTARC.sizeOrder.map((k) => ({ value: k, label: LASTARC.sizes[k].label })),
    ethosPurityOptions: LASTARC.ethosPurity.map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` })),
    ethosMoralityOptions: LASTARC.ethosMorality.map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` })),
  };
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Fixtures for the sheets this harness did not used to reach                 */
/* -------------------------------------------------------------------------- */

/**
 * Exported so `test/templates-render.test.mjs` uses THESE and not a second set.
 *
 * Before this, the preview rendered two of thirteen templates: the character
 * sheet and two chat cards. The NPC sheet, all eighteen item subtypes and five
 * of the seven cards had never been rendered outside a live Foundry at all —
 * which is Quench's "renders an item sheet for every subtype" and "renders the
 * NPC sheet", both of which have never run.
 *
 * The contexts are deliberately SPARSE. A fixture that fills every key proves
 * the template works when it is handed everything; the interesting case is a
 * half-filled document, which is what a hand-authoring GM actually produces.
 */
export function itemContext(type) {
  return {
    itemType: type,
    document: { name: `ZZ ${type}`, img: "" },
    system: {},
    fields: {},
    config: LASTARC,
    // Panels are gated on these, so a false one hides the block it guards and
    // the render proves nothing about it.
    isPhysical: true,
    hasGrants: true,
    isTechnick: type === "technick" || type === "talent",
    outcomes: [],
    grantedSkills: [],
    skillOptions: [],
    statusOptions: [],
    defenceOptions: [],
    weaponDamageTypes: [],
    flagOptions: []
  };
}

export function npcContext() {
  return {
    ...buildContext(),
    system: {
      attacks: [], skills: [], drops: [],
      breakGauge: {}, resources: { hp: {}, mp: {} },
      defences: {}, details: {}, damageMods: {}
    },
    attacks: [], npcSkills: [], drops: [],
    damageTypeOptions: [], statusOptions: [], skillOptions: [],
    /**
     * A cursed statblock, so the "adjust by hand" note (#45) is actually in the
     * render rather than being a branch the preview never enters.
     *
     * COMPUTED from the real config function rather than written out here. This
     * fixture is hand-built and can drift from the sheet (#44); anything taken
     * straight from the source it is meant to mirror cannot.
     */
    manualAdjustments: LASTARC.npcManualAdjustments(D.aggregateStatuses(["withering", "dim"]))
  };
}

/** One scripted context per chat card, keyed by template path. */
export function cardContexts() {
  return {
    "templates/chat/spell-card.hbs": { name: "ZZ probe", parts: [], outcome: {} },
    "templates/chat/healing-card.hbs": { name: "ZZ probe", results: [] },
    "templates/chat/item-card.hbs": { name: "ZZ probe" },
    "templates/chat/block-card.hbs": { shieldName: "ZZ probe", parts: [] },
    "templates/chat/performance-card.hbs": {
      name: "ZZ probe", parts: [], achieved: true, landed: true,
      canApplyEffect: true, unappliableRiders: []
    }
  };
}

const context = buildContext();
const render = (rel) =>
  Handlebars.compile(readFileSync(join(root, rel), "utf8"))(context);

const header = render("templates/actor/character-header.hbs");
const body = render("templates/actor/character-body.hbs");

/**
 * The character sheet's own markup, exported for the render checks.
 *
 * It was NOT exported at first, and the "nothing renders the word undefined"
 * guard therefore passed while the armour proficiency row read "undefined ·
 * undefined · undefined" — the very bug that prompted the guard. A check that
 * does not cover the surface it was written for is worse than none.
 */
export const renderedCharacterSheet = header + body;

/**
 * Everything else, rendered on import so that merely loading this module proves
 * every template still compiles and resolves. The results are exported rather
 * than dropped: the render test reads them to check that no `LASTARC.*` key
 * reached the output as literal text, which is Quench's "leaves no untranslated
 * keys in the rendered sheet" running for the first time.
 */
export const renderedItemSheets = Object.fromEntries(
  Object.keys(
    JSON.parse(readFileSync(join(root, "system.json"), "utf8")).documentTypes.Item
  ).map((type) => [
    type,
    Handlebars.compile(readFileSync(join(root, "templates/item/item-sheet.hbs"), "utf8"))(
      itemContext(type)
    )
  ])
);

export const renderedNpcSheet = Handlebars.compile(
  readFileSync(join(root, "templates/actor/npc-sheet.hbs"), "utf8")
)(npcContext());

export const renderedCards = Object.fromEntries(
  Object.entries(cardContexts()).map(([path, ctx]) => [
    path,
    Handlebars.compile(readFileSync(join(root, path), "utf8"))(ctx)
  ])
);

/**
 * Chat cards, rendered against a scripted attack and damage result. The attack
 * shown is a natural 20 specifically so the reaction-window notice is visible —
 * that is the state most likely to be implemented wrongly.
 */
const attackCard = Handlebars.compile(
  readFileSync(join(root, "templates/chat/attack-card.hbs"), "utf8")
)({
  actorId: "a", weaponId: "w", weaponName: "Arming Sword", weaponImg: "",
  total: 27, natural: 20, hasTarget: true, targetDefence: 18,
  parts: [
    { label: "LASTARC.Mod.skill", value: 6 },
    { label: "LASTARC.Mod.flanking", value: 2 },
    { label: "LASTARC.Mod.nonProficient", value: -5 }
  ],
  outcome: { natural: 20, hit: true, autoHit: true, autoMiss: false,
             combo: true, critical: false, reactionWindowOpen: true }
});

const damageCard = Handlebars.compile(
  readFileSync(join(root, "templates/chat/damage-card.hbs"), "utf8")
)({
  weaponName: "Arming Sword", weaponImg: "", total: 23,
  damageType: "slashing", damageTypeLabel: "LASTARC.DamageType.slashing",
  critMultiplierLabel: null,
  results: [
    { result: 8, exploded: true, generation: 0 },
    { result: 8, exploded: true, generation: 1 },
    { result: 3, exploded: false, generation: 2 }
  ],
  parts: [
    { label: "LASTARC.Mod.halfLevel", value: 2 },
    { label: "LASTARC.Mod.attribute", value: 3 },
    { label: "LASTARC.Mod.weaponBreak", value: -1 }
  ],
  capped: false
});

// Force a theme rather than inheriting the browser's, so both can be reviewed.
// `:root[data-theme=...]` beats the prefers-color-scheme block by design.
const theme = process.argv.find((a) => a.startsWith("--theme="))?.split("=")[1] ?? "light";

const page = `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<title>Last Arc — sheet preview (${theme})</title>
<style>
  body { margin: 0; padding: 1.5rem; background: #6b6558; font-family: system-ui, sans-serif; }
  .preview-pair { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
  .preview-frame { flex: 1 1 480px; max-width: 980px; border-radius: 6px; overflow: hidden;
                   box-shadow: 0 10px 40px rgba(0,0,0,.45); }
  .preview-label { color: #efe7d6; font-size: .7rem; letter-spacing: .16em;
                   text-transform: uppercase; margin: 0 0 .4rem .2rem; }
${css}
</style></head>
<body>
  <div class="preview-pair">
    <div style="flex:1 1 560px;">
      <p class="preview-label">${theme} — character sheet</p>
      <div class="preview-frame">
        <div class="last-arc sheet actor character themed theme-${theme}" data-theme-scope>
          <div class="window-content last-arc-sheet-body">${header}${body}</div>
        </div>
      </div>
    </div>
    <div style="flex:0 1 340px;">
      <p class="preview-label">chat cards</p>
      <div class="preview-frame">
        <div class="last-arc" style="padding:0.75rem; display:flex; flex-direction:column; gap:0.75rem;">
          ${attackCard}
          ${damageCard}
        </div>
      </div>
    </div>
  </div>
</body></html>`;

/**
 * Only write a file when run as a command. Everything above still executes on
 * import, and that is the point: `test/templates-render.test.mjs` imports this
 * module purely to prove the templates compile, their partials resolve and
 * their helpers exist. That test is what stops this tool breaking silently
 * again — it had been throwing since the first partial was introduced, and
 * nothing runs a dev tool, so every sheet change shipped unverified.
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Positional outfile, ignoring any --flags so `--theme=` cannot be mistaken for a path.
  const out = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(root, "preview.html");
  writeFileSync(out, page, "utf8");
  console.log(`Preview written to ${out}`);
}
