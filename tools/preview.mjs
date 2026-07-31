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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
const css = readFileSync(join(root, "styles/last-arc.css"), "utf8");

/* -------------------------------------------------------------------------- */
/*  Helper stubs — must mirror registerHandlebarsHelpers() in last-arc.mjs      */
/* -------------------------------------------------------------------------- */

const localize = (key) => lang[key] ?? key;

Handlebars.registerHelper("localize", localize);
Handlebars.registerHelper("lasignal", (n) => {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
});
Handlebars.registerHelper("laeq", (a, b) => a === b);
Handlebars.registerHelper("lagte", (a, b) => Number(a) >= Number(b));

/* -------------------------------------------------------------------------- */
/*  Synthetic actor                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A level-5 Warrior/Rogue at Break step 2 with one persistent step, wearing
 * heavy armour they are not proficient with. Deliberately not a clean case: it
 * exercises the multiclass path, the death spiral, the persistent floor, and
 * the armour check penalty all at once.
 */
function buildContext() {
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
    const trained = ["athletics", "perception", "stealth", "oneHanded"].includes(key);
    const total = D.skillModifier({
      level,
      attrMod: attrs[cfg.attr].mod,
      trained,
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
        levelMismatch: false
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
    canSpendHero: true,
    misfortuneBlocksReroll: true,
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
    classOptions: Object.entries(LASTARC.classes).map(([k, c]) => ({ value: k, label: c.label })),
    sizeOptions: LASTARC.sizeOrder.map((k) => ({ value: k, label: LASTARC.sizes[k].label })),
    ethosPurityOptions: LASTARC.ethosPurity.map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` })),
    ethosMoralityOptions: LASTARC.ethosMorality.map((v) => ({ value: v, label: `LASTARC.Ethos.${v}` })),
    levelMismatch: false
  };
}

/* -------------------------------------------------------------------------- */

const context = buildContext();
const render = (rel) =>
  Handlebars.compile(readFileSync(join(root, rel), "utf8"))(context);

const header = render("templates/actor/character-header.hbs");
const body = render("templates/actor/character-body.hbs");

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
        <div class="last-arc sheet actor character" data-theme-scope>
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

// Positional outfile, ignoring any --flags so `--theme=` cannot be mistaken for a path.
const out = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(root, "preview.html");
writeFileSync(out, page, "utf8");
console.log(`Preview written to ${out}`);
