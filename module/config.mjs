/**
 * Static configuration tables for Last Arc: Tactics Analogue.
 *
 * This module is deliberately FOUNDRY-FREE — it imports nothing and touches no
 * globals, so it can be loaded by the plain-node test suite. Anything requiring
 * `game`, `CONFIG`, or `foundry` belongs in last-arc.mjs instead.
 *
 * Spec references are to last-arc-foundry-system-spec.md (rev2).
 */

export const LASTARC = {};

/* -------------------------------------------------------------------------- */
/*  Attributes (§2)                                                            */
/* -------------------------------------------------------------------------- */

LASTARC.attributes = {
  str: { label: "LASTARC.Attribute.str", abbr: "LASTARC.Attribute.strAbbr" },
  vit: { label: "LASTARC.Attribute.vit", abbr: "LASTARC.Attribute.vitAbbr" },
  agi: { label: "LASTARC.Attribute.agi", abbr: "LASTARC.Attribute.agiAbbr" },
  int: { label: "LASTARC.Attribute.int", abbr: "LASTARC.Attribute.intAbbr" },
  mnd: { label: "LASTARC.Attribute.mnd", abbr: "LASTARC.Attribute.mndAbbr" },
  chr: { label: "LASTARC.Attribute.chr", abbr: "LASTARC.Attribute.chrAbbr" }
};

/**
 * Display order for sheets, matching the printed character sheet (book p.263):
 * Str · Vit · Agi · Int · Mnd · Chr. Note this differs from the key order used
 * in §2 of the spec — never rely on object insertion order to reproduce the book.
 */
LASTARC.attributeOrder = ["str", "vit", "agi", "int", "mnd", "chr"];

/** Stated modifier range is −5..+5; see §15 A3 and `clampAttributeModifier`. */
LASTARC.attributeModifierClamp = { min: -5, max: 5 };

/* -------------------------------------------------------------------------- */
/*  Break Gauge (§6)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Penalty applied at each Break Gauge step to attacks, defences, skill checks,
 * and attribute checks.
 *
 * NON-LINEAR — never compute this as `-step`.
 *
 * SIGN CONVENTION (§6 rev2): the INDEX runs 0..5 and higher is WORSE. The values
 * are the penalties, which are a different sequence entirely. Step 5 is `null`,
 * not a number: the character is unconscious/disabled/destroyed and no longer
 * rolling at all. Callers must handle `null` rather than coercing it to 0 —
 * `0` would read as "no penalty", the exact opposite of the truth.
 */
LASTARC.breakPenalties = Object.freeze([0, -1, -2, -5, -10, null]);

LASTARC.BREAK_STEP_MIN = 0;
LASTARC.BREAK_STEP_MAX = 5;

/** Consecutive minor actions required for a Recovery action (§6). */
LASTARC.recoveryMinorActions = 3;
/** ...reduced to this by the *Shake it Off* technick. */
LASTARC.recoveryMinorActionsShakeItOff = 2;

/* -------------------------------------------------------------------------- */
/*  Skills (§7)                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `acp` = subject to the armour check penalty when not proficient with the worn
 * armour. Per §4.5 that is all Str- and Agi-based skills, PLUS Alchemy,
 * Smithing, Spellcraft and Perform.
 *
 * Lore and Perform are each several DISCRETE skills rather than a container
 * with user-named children — see the note beside them below (issue #35).
 */
LASTARC.skills = {
  acrobatics: { label: "LASTARC.Skill.acrobatics", attr: "agi", acp: true },
  alchemy:    { label: "LASTARC.Skill.alchemy",    attr: "int", acp: true },
  athletics:  { label: "LASTARC.Skill.athletics",  attr: "str", acp: true },
  deception:  { label: "LASTARC.Skill.deception",  attr: "chr", acp: false },
  disable:    { label: "LASTARC.Skill.disable",    attr: "agi", acp: true },
  /**
   * Lore and Perform are FIVE and THREE skills, not one each with children
   * (issue #35).
   *
   * The class lists print "Lore (taken individually)", and there is no such
   * thing as a base Lore check — every check is against one field of study. The
   * old model made the parent a container with user-named subskills, which put
   * a row on the sheet nobody could ever roll and let a player type "Arcaen"
   * and quietly train nothing. Fixed keys also mean an NPC statblock and a
   * character finally name the same skill.
   */
  loreArcane:      { label: "LASTARC.Skill.loreArcane",      attr: "int", acp: false },
  loreMystic:      { label: "LASTARC.Skill.loreMystic",      attr: "int", acp: false },
  loreOccult:      { label: "LASTARC.Skill.loreOccult",      attr: "int", acp: false },
  loreSocial:      { label: "LASTARC.Skill.loreSocial",      attr: "int", acp: false },
  loreTerrestrial: { label: "LASTARC.Skill.loreTerrestrial", attr: "int", acp: false },
  medicine:   { label: "LASTARC.Skill.medicine",   attr: "mnd", acp: false },
  perception: { label: "LASTARC.Skill.perception", attr: "mnd", acp: false },
  performDance:      { label: "LASTARC.Skill.performDance",      attr: "chr", acp: true },
  performInstrument: { label: "LASTARC.Skill.performInstrument", attr: "chr", acp: true },
  performOratory:    { label: "LASTARC.Skill.performOratory",    attr: "chr", acp: true },
  persuasion: { label: "LASTARC.Skill.persuasion", attr: "chr", acp: false },
  pilot:      { label: "LASTARC.Skill.pilot",      attr: "agi", acp: true },
  ride:       { label: "LASTARC.Skill.ride",       attr: "agi", acp: true },
  smithing:   { label: "LASTARC.Skill.smithing",   attr: "int", acp: true },
  spellcraft: { label: "LASTARC.Skill.spellcraft", attr: "mnd", acp: true },
  stealth:    { label: "LASTARC.Skill.stealth",    attr: "agi", acp: true },
  survival:   { label: "LASTARC.Skill.survival",   attr: "mnd", acp: false }
};

/**
 * Weapon skills (§7). These behave differently from standard skills:
 *   - cannot Take 10 or Take 20
 *   - natural 1 always fails and natural 20 always succeeds, regardless of totals
 *
 * ⚠ ASSUMPTION: `acp: true` follows from §4.5's "all Str- and Agi-based skills",
 * which these are. That is consequential — via §5.1 the penalty flows into every
 * attack roll made in non-proficient armour. The book may well intend it, but it
 * is an inference rather than a printed rule. VERIFY DURING INGESTION.
 */
LASTARC.weaponSkills = {
  oneHanded:   { label: "LASTARC.Skill.oneHanded",   attr: "str", acp: true, weapon: true },
  twoHanded:   { label: "LASTARC.Skill.twoHanded",   attr: "str", acp: true, weapon: true },
  lightWeapon: { label: "LASTARC.Skill.lightWeapon", attr: "agi", acp: true, weapon: true },
  ranged:      { label: "LASTARC.Skill.ranged",      attr: "agi", acp: true, weapon: true },
  unarmed:     { label: "LASTARC.Skill.unarmed",     attr: "str", acp: true, weapon: true }
};

/** Every skill, standard and weapon, in one lookup. */
LASTARC.allSkills = { ...LASTARC.skills, ...LASTARC.weaponSkills };

/** Bonus granted by being trained in a skill (§4.5). */
LASTARC.trainedBonus = 5;

/* -------------------------------------------------------------------------- */
/*  Classes (§4.3)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * hp1/mp1 are the level-1 values; hpPer/mpPer the per-level-thereafter gain.
 * Both are stated as "N + modifier" — the modifier (Vit for HP, Mnd for MP) is
 * added at every level, not just once.
 *
 * ref/fort/will are granted ONCE at class level 1 (see §15 A9 for the multiclass
 * question and the `multiclassRegrantsLevel1Benefits` setting).
 *
 * `trainedSkills` is the class base; the total is that plus the Int modifier.
 * Read from the "Number of Trained Skills" table (book p.35): Rogue 8;
 * Bard, Ranger and Warrior 6; Initiate and Mage 4. Previously four of these were
 * null and `trainedSkillCount()` threw rather than guess — resolved.
 *
 * HP, MP and initiative dice below were verified against the same page in the
 * same pass and needed no correction.
 */
LASTARC.classes = {
  bard:     { label: "LASTARC.Class.bard",     hp1: 24, hpPer: 5, mp1: 6,  mpPer: 2, initDie: "d6",  ref: 2, fort: 0, will: 1, trainedSkills: 6 },
  initiate: { label: "LASTARC.Class.initiate", hp1: 18, hpPer: 4, mp1: 12, mpPer: 3, initDie: "d12", ref: 0, fort: 1, will: 2, trainedSkills: 4 },
  mage:     { label: "LASTARC.Class.mage",     hp1: 18, hpPer: 4, mp1: 12, mpPer: 3, initDie: "d12", ref: 1, fort: 0, will: 2, trainedSkills: 4 },
  ranger:   { label: "LASTARC.Class.ranger",   hp1: 30, hpPer: 6, mp1: 6,  mpPer: 2, initDie: "d8",  ref: 1, fort: 2, will: 0, trainedSkills: 6 },
  rogue:    { label: "LASTARC.Class.rogue",    hp1: 24, hpPer: 5, mp1: 6,  mpPer: 2, initDie: "d4",  ref: 2, fort: 1, will: 0, trainedSkills: 8 },
  warrior:  { label: "LASTARC.Class.warrior",  hp1: 30, hpPer: 6, mp1: 6,  mpPer: 2, initDie: "d10", ref: 0, fort: 2, will: 1, trainedSkills: 6 }
};

/**
 * Advanced classes (§14, Ch.12) — names only in the demo. Declared now so the
 * data model accepts an advanced class layered over a base class without a
 * migration when the full release lands.
 */
LASTARC.advancedClasses = [
  "archmage", "assassin", "battlemage", "berserker", "bishop", "bladeDancer",
  "dragoon", "druid", "gladiator", "necromancer", "paladin", "purloiner",
  "sabreur", "shikari", "summoner", "troubador", "warlock"
];

/** Initiative dice for non-player categories (§3.2). Lower is better (§8). */
LASTARC.initiativeDice = {
  nonheroic: "d10",
  beast: "d8"
};

/**
 * Improved Initiative steps the die DOWN, because lowest acts first (§8).
 * Stackable; floors at d3.
 */
LASTARC.initiativeDieLadder = ["d12", "d10", "d8", "d6", "d4", "d3"];

/* -------------------------------------------------------------------------- */
/*  Size (§5.4) — CREATURES                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠ There are TWO size tables in this system and they are NOT the same. This is
 * the creature table. Objects use LASTARC.objectSizes below, whose Reflex
 * modifiers are roughly double these. Do not "simplify" them into one.
 */
LASTARC.sizes = {
  fine:       { label: "LASTARC.Size.fine",       mod:  10, grapple: -20, threshold:  0, space: null },
  diminutive: { label: "LASTARC.Size.diminutive", mod:   5, grapple: -15, threshold:  0, space: null },
  tiny:       { label: "LASTARC.Size.tiny",       mod:   2, grapple: -10, threshold:  0, space: null },
  small:      { label: "LASTARC.Size.small",      mod:   1, grapple:  -5, threshold:  0, space: 1 },
  medium:     { label: "LASTARC.Size.medium",     mod:   0, grapple:   0, threshold:  0, space: 1 },
  large:      { label: "LASTARC.Size.large",      mod:  -1, grapple:   5, threshold:  5, space: 2 },
  huge:       { label: "LASTARC.Size.huge",       mod:  -2, grapple:  10, threshold: 10, space: 3 },
  gargantuan: { label: "LASTARC.Size.gargantuan", mod:  -5, grapple:  15, threshold: 20, space: 4 },
  colossal:   { label: "LASTARC.Size.colossal",   mod: -10, grapple:  20, threshold: 50, space: 6 }
};

/** Ordered smallest → largest, for the relative-size comparisons in §5.4. */
LASTARC.sizeOrder = [
  "fine", "diminutive", "tiny", "small", "medium",
  "large", "huge", "gargantuan", "colossal"
];

/* -------------------------------------------------------------------------- */
/*  Size (§6) — OBJECTS                                                        */
/* -------------------------------------------------------------------------- */

LASTARC.objectSizes = {
  fine:       { refMod:  20, durability:   5, breakDC:  5 },
  diminutive: { refMod:  15, durability:  10, breakDC: 10 },
  tiny:       { refMod:  10, durability:  15, breakDC: 10 },
  small:      { refMod:   5, durability:  20, breakDC: 15 },
  medium:     { refMod:   0, durability:  30, breakDC: 15 },
  large:      { refMod:  -5, durability:  40, breakDC: 25 },
  huge:       { refMod: -10, durability:  50, breakDC: 30 },
  gargantuan: { refMod: -15, durability:  70, breakDC: 40 },
  colossal:   { refMod: -20, durability: 100, breakDC: 80 }
};

/* -------------------------------------------------------------------------- */
/*  Damage (§5.5)                                                              */
/* -------------------------------------------------------------------------- */

LASTARC.damageTypes = {
  physical:  ["blunt", "piercing", "slashing"],
  elemental: ["cold", "dark", "electric", "fire", "holy"],
  /** Belongs to neither category and ignores DR entirely. */
  other:     ["unaspected"]
};

LASTARC.allDamageTypes = [
  ...LASTARC.damageTypes.physical,
  ...LASTARC.damageTypes.elemental,
  ...LASTARC.damageTypes.other
];

/** Damage types that bypass DR (§5.5 step 7). */
LASTARC.drBypassing = new Set(["unaspected"]);

LASTARC.weaponCategories = [
  "axes", "bludgeons", "bows", "crossbows",
  "knives", "polearms", "staves", "swords"
];

/** Categories that always use the Ranged skill regardless of relative size (§5.4 rev2). */
LASTARC.rangedWeaponCategories = new Set(["bows", "crossbows", "staves"]);

/**
 * Ranged groups that add the wielder's Strength to damage (issue #36).
 *
 * Bows "rely on the wielder's strength"; crossbows are defined in the same list
 * as ranged weapons "that do not utilize strength". They are NOT one behaviour
 * with an exception — they are two groups that differ, and treating "ranged" as
 * a single rule got both wrong at once: no ranged weapon added an attribute at
 * all, so crossbows looked right by accident and bows were quietly short.
 *
 * The two-handed doubling is deliberately NOT extended here. The book grants it
 * for wielding a weapon a size category above you, in the melee sizing rules;
 * nothing says a longbow doubles.
 */
LASTARC.strengthRangedCategories = new Set(["bows"]);

/**
 * Groups whose attacks are resolved with Spellcraft rather than a weapon skill.
 *
 * Staves "use the same range increments as ranged weapons, but the attacks are
 * resolved with the Spellcraft skill", with no attribute-based damage modifier.
 * They are ranged, so they take the ranged critical rather than the melee combo.
 */
LASTARC.spellcraftWeaponCategories = new Set(["staves"]);

/**
 * Range increments (§ ranged combat, book p.103).
 *
 * The bands are a property of the weapon's SIZE, not numbers typed per weapon —
 * which is why the penalty table is here rather than on the schema. Distances
 * are the upper bound of each band in squares; `null` means "no further band".
 */
LASTARC.rangeBands = Object.freeze({
  pointBlank: { label: "LASTARC.Range.pointBlank", penalty: 0 },
  short:      { label: "LASTARC.Range.short",      penalty: -2 },
  mid:        { label: "LASTARC.Range.mid",        penalty: -5 },
  long:       { label: "LASTARC.Range.long",       penalty: -10 }
});

LASTARC.rangeIncrements = Object.freeze({
  thrown: { pointBlank: 6,  short: 8,  mid: 10,  long: 12 },
  small:  { pointBlank: 10, short: 20, mid: 30,  long: 40 },
  medium: { pointBlank: 20, short: 40, mid: 60,  long: 80 },
  large:  { pointBlank: 30, short: 60, mid: 120, long: 240 }
});

/** Labels for the derived wield categories returned by `wieldCategory()`. */
LASTARC.wieldLabels = {
  light: "LASTARC.Skill.lightWeapon",
  oneHanded: "LASTARC.Skill.oneHanded",
  twoHanded: "LASTARC.Skill.twoHanded",
  ranged: "LASTARC.Skill.ranged",
  unusable: "LASTARC.Derived.Unusable"
};

LASTARC.armourTypes = { light: "light", heavy: "heavy", mystic: "mystic" };

/** Bulk cost by armour type and weapon handedness (§4.6). */
LASTARC.bulk = {
  armour: { light: 2, heavy: 3, mystic: 1 },
  weapon: { light: 0.1, oneHanded: 1, twoHanded: 2, tooLarge: 3 }
};

/* -------------------------------------------------------------------------- */
/*  Technicks & talents (§11)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Technicks that may be taken more than once (§11). Everything else is
 * non-repeatable by default; the item schema carries a `repeatable` flag and
 * this list is what the level-up UI should pre-set it from during ingestion.
 */
LASTARC.repeatableTechnicks = [
  "skill-focus", "skill-training", "improved-initiative", "weapon-proficiency",
  "arcane-study", "bardic-study", "channel", "extra-second-wind", "linguist"
];

/**
 * Behavioural flags a technick, talent, or item feature can set.
 *
 * These are markers, NOT logic. Phase 2's damage pipeline and Phase 4's action
 * economy read them; the point is that ~80 technicks can be expressed as data
 * plus a hook rather than 80 branches in the combat code (§11).
 *
 * EVERY ENTRY HERE MUST HAVE A READER. This list is now rendered as a picker on
 * the technick sheet (issue #32), so an entry with no `hasFlag` behind it is a
 * switch the player can flip that does nothing — the decoy this project keeps
 * shipping, only worse, because it looks deliberate. Three were removed when
 * the picker was built rather than shown as tickable no-ops:
 *
 *   shieldProficiency — was never a technick flag. It lives on
 *     `proficiencies.shields`, which has its own toggle on the character sheet,
 *     and `LASTARC.blockPenaltyPerBlock` is what reads it. Listing it here as
 *     well would have given players two switches for one rule, one of them
 *     inert. Its lang string also described the rule backwards, capping the
 *     penalty rather than halving the rate.
 *   hardyAndHearty — removed the once-per-encounter Second Wind cap. That cap
 *     was deleted in issue #10 because nothing ever enforced it, so this flag
 *     now suppresses a rule that does not exist.
 *   brawler — unarmed attacks no longer provoke. `provokes()` below says the
 *     caller checks this; no caller ever did. Implementing it needs to know the
 *     attacker stands in a threatened area, which needs token positions and
 *     enemy reach the system does not track. Filed rather than faked.
 *
 * `test/reachable-choices.test.mjs` enforces the rule.
 */
LASTARC.technickFlags = [
  "weaponFinesse",        // substitute Agi for Str on light/thrown/unarmed/natural
  "preciseShot",          // negates the -5 for shooting into melee
  "tripleCrit",           // ranged crit multiplier x3 instead of x2
  "doubledExplosions",    // each exploding die generates 2 rather than 1 (Backstab)
  /**
   * The same doubling, but on SPELL damage (issue #42). A separate flag on
   * purpose: `doubledExplosions` is carried by weapon technicks, and merging
   * the two would have a backstab doubling a fireball.
   *
   * Held by the WIELDER rather than the spell, because the book's sources for
   * it are equipment whose trigger is conditional — one wants the weapon and
   * the spell to damage in the same instant, two others want a particular
   * school. None of those is a condition the system can evaluate, so this uses
   * the same switch every conditional flag uses: the player turns it on when it
   * applies. Spells that ALWAYS double carry `system.doubledExplosions`
   * instead and need no switching.
   */
  "doubledSpellExplosions",
  "combatCasting",        // multi-threat casting reduced to a single -5
  "debilitatingInjury",   // damage over Threshold worsens the gauge by 2, not 1
  /**
   * The two study technicks (issue #33). Flags rather than `grants` entries
   * because what they give is not a constant: each taking is worth
   * `1 + Int modifier`, so the number moves when Intelligence does. A flat
   * grant would have to be re-typed every time the character's Int changed,
   * and would be wrong in between. Counted, not merely tested for — both are
   * explicitly repeatable.
   */
  "arcaneStudy",          // +1+Int spells known per taking (minimum 1)
  "bardicStudy"           // +1+Int performances known per taking (minimum 1)
];

/**
 * Flags that are no longer offered but are still ACCEPTED.
 *
 * The schema validates against this superset rather than the picker list, so
 * narrowing the picker cannot invalidate a document somebody already has.
 * A `StringField` with `choices` rejects anything outside them, and a technick
 * carrying a retired flag would fail validation on load — an item that will not
 * open is a far worse outcome than an inert value sitting in an array nothing
 * reads. Nothing could have set these through the UI, because until issue #32
 * there was no UI; this guards the macro and hand-edited-JSON cases, and costs
 * six lines to be certain.
 */
LASTARC.retiredTechnickFlags = ["brawler", "shieldProficiency", "hardyAndHearty"];

/** What the schema accepts. `technickFlags` is what the sheet offers. */
LASTARC.allTechnickFlags = [...LASTARC.technickFlags, ...LASTARC.retiredTechnickFlags];

/** Acquisition cadence (§11). Enforced by the level-up UI, not the data model. */
LASTARC.acquisition = {
  characterTechnick: "odd",      // level 1 and every odd character level
  classTechnick: "even",         // every even CLASS level, from that class's list
  talent: "odd"                  // level 1 and every odd class level
};

/* -------------------------------------------------------------------------- */
/*  Availability & shopping (§11)                                              */
/* -------------------------------------------------------------------------- */

/** `stockDC`: d% roll must be ≤ this to be in stock. null = not purchasable. */
LASTARC.availability = {
  common:    { stockDC: null, purchasable: true,  minLevel: 1 },
  uncommon:  { stockDC: 75,   purchasable: true,  minLevel: 4 },
  rare:      { stockDC: 50,   purchasable: true,  minLevel: 8 },
  exotic:    { stockDC: 25,   purchasable: true,  minLevel: 12 },
  epic:      { stockDC: null, purchasable: false, minLevel: null },
  legendary: { stockDC: null, purchasable: false, minLevel: null },
  mythic:    { stockDC: null, purchasable: false, minLevel: null }
};

/* -------------------------------------------------------------------------- */
/*  Status effects (§12)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Statuses with their mechanical payloads.
 *
 * ── Durations ───────────────────────────────────────────────────────────────
 * §12 is explicit that these do NOT expire at end of turn or end of encounter.
 * They persist until a specific clearance condition is met. Nothing here carries
 * a round count, and none should be given one by default. `chanceToClear` is a
 * per-turn removal ROLL, not a duration — a drenched creature is not drenched
 * "for 4 rounds", it has a 25% chance each turn of shaking it off.
 *
 * ── Stacking ────────────────────────────────────────────────────────────────
 * A creature may hold many statuses, but no status stacks with ITSELF. Poisons
 * and curses are the exception in that *different* poisons or curses stack,
 * while duplicates of the same one do not. `stacksIndependently` marks those.
 *
 * ── Fields ──────────────────────────────────────────────────────────────────
 * Only fields that differ from the defaults are listed on each entry. The
 * derivation reads these rather than branching on status id, so adding a status
 * is a data change.
 */
LASTARC.statusEffects = {
  blind: {
    /** Every target has TOTAL concealment from this creature — not the reverse. */
    grantsTargetsTotalConcealment: true
  },
  confusion: {
    /** Start of turn: 60% to attack the nearest ally, or itself. */
    confusionChance: 0.6,
    /** Cleared when an ally hits it beating BOTH Reflex and Will. */
    clearedByAllyHit: true
  },
  disease: {
    /**
     * "Current HP is treated as max HP" — the cap follows the wound rather than
     * the wound following the cap. Recovery actions are blocked outright.
     */
    currentHpBecomesMax: true,
    blocksRecovery: true,
    blocksNaturalHealing: true
  },
  drench: {
    /** Cold and electric deal +2 DICE, not +2 damage. */
    bonusDamageDice: { cold: 2, electric: 2 },
    chanceToClear: 0.25
  },
  oil: {
    bonusDamageDice: { fire: 2 },
    chanceToClear: 0.25
  },
  paralysis: {
    /** Start of turn: 25% chance of flat-footed and no actions until next turn. */
    paralysisChance: 0.25
  },
  petrify: {
    agiDenied: true,
    noActions: true,
    /** Explicitly NOT helpless — so no Coup de Grace. */
    helpless: false,
    immuneToForcedMovement: true,
    /** One hour to death, and it IGNORES hero points. */
    deathAfterMinutes: 60,
    deathIgnoresHeroPoints: true
  },
  poison: {
    stacksIndependently: true,
    /** Attacks Fortitude at the start of each of the creature's turns. */
    attacksDefenceEachTurn: "fort",
    /** Auto-removed after failing to beat Fort on two CONSECUTIVE turns. */
    clearAfterConsecutiveFailures: 2,
    blocksNaturalHealing: true
  },
  silence: {
    /**
     * Skills needing audible sound. Perform used to be one container skill with
     * named specialisations, so this was two keys: `blocksSkills` plus a
     * `blocksPerformSpecialisations: ["instrument", "oratory"]`. Issue #35 made
     * Perform eight ordinary skills and the second key was left describing a
     * shape that no longer exists — it named no skill anything could look up,
     * so it was dead on arrival. One list of real skill keys now.
     *
     * Dance is deliberately absent: it makes no sound to suppress.
     */
    blocksSkills: ["spellcraft", "persuasion", "performInstrument", "performOratory"]
  },
  sleep: {
    agiDenied: true,
    noActions: true,
    helpless: false,
    /** Any damage wakes it, UNLESS the damage came from a pre-applied effect. */
    wakesOnDamage: true,
    wakesOnDamageExceptPreApplied: true,
    chanceToClear: 0.25
  },
  flatFooted: {
    agiDenied: true,
    noReactions: true
  },
  /* ── Applied by spells (§18.8). These are referenced by Chapter 8 entries and
     were absent from the table; an unregistered id throws at toggle time, the
     same way `unconscious` did. ──────────────────────────────────────────── */
  /**
   * Book p.189. The previous payload (`treatedAsUndead`) was inferred from the
   * name and is not what the status does. Healing is INVERTED — an attempt to
   * heal a zombified creature deals that much unaspected damage instead — and
   * rest does nothing. Modelling it as "undead" would have made a cleric's heal
   * simply fail rather than actively hurt the target.
   */
  zombified: {
    healingBecomesDamage: true,
    healingDamageType: "unaspected",
    blocksNaturalHealing: true
  },
  /**
   * Book p.189. Movement halved to a MINIMUM OF 1 SQUARE — the floor matters,
   * since a speed-1 creature would otherwise round to zero — plus a −10 to
   * Acrobatics and Athletics, which the first version omitted entirely.
   */
  slowed: {
    speedMultiplier: 0.5,
    speedMinimum: 1,
    skillPenalties: { acrobatics: -10, athletics: -10 }
  },
  /**
   * Blue Magick, with a duration that scales off the check (2–5 turns).
   * Deliberately carries no derived-stat payload: what being incorporeal DOES
   * is a positioning and targeting ruling, not an arithmetic one, and inventing
   * numbers here would be worse than leaving it to the GM.
   */
  incorporeal: {},
  /** Blue Magick. Retargeting is a GM ruling; the badge is the mechanical part. */
  charmed: {},

  /**
   * Book p.189. The most sweeping status in the game and it was missing
   * outright: −10 to defences, attacks, skill checks AND damage rolls, treated
   * as Tiny, no benefit from equipment, and no class features, talents, spells,
   * technicks or other abilities. Effectively removes a character from the
   * fight without removing their turn.
   */
  toad: {
    /**
     * Reflex is deliberately NOT in this list, and removing it was the GM's
     * call on #46. Under Toad, Reflex is rebuilt from the three keys below
     * rather than penalised: base 10 with Agi treated as −5 gives 5, the toad's
     * own Tiny size adds +2 (p.163), and the armour bonus goes because the
     * armour is not on a toad. That reaches
     *
     *     7 + level + class bonus + technicks
     *
     * which is the GM's formula exactly. Leaving the −10 here as well would
     * charge the same transformation twice.
     */
    defences: { fort: -10, will: -10 },
    agiOverride: -5,
    attackPenalty: -10,
    skillCheckPenalty: -10,
    damageRollPenalty: -10,
    treatedAsSize: "tiny",
    noEquipmentBenefit: true,
    noAbilities: true
  },

  /* ── Dismemberment (book p.170). PERMANENT — these are not cleared by rest
     or by clearing statuses; only a prosthetic reduces them. ────────────── */
  severedLeg: {
    permanent: true,
    attributeCheckPenalty: { agi: -5 },
    speedMultiplier: 0.5,
    maxBulkMultiplier: 0.5,
    blocksCharge: true
  },
  severedArm: {
    permanent: true,
    attributeCheckPenalty: { str: -5, agi: -5 },
    blocksTwoHandedWeapons: true,
    reloadStepIncrease: 1
  },
  /**
   * Applied at 0 HP alongside `prone` and `helpless` (§5.6).
   *
   * This has to be defined here rather than inherited from Foundry: registration
   * REPLACES `CONFIG.statusEffects` wholesale, so core's `unconscious` does not
   * survive, and `applyDamage` asking for it by id would throw "Invalid status
   * ID" on every character that dropped.
   *
   * It carries no `agiOverride` of its own — `helpless` is applied in the same
   * breath and supplies the −5, and doubling it up here would make the override
   * order-dependent.
   */
  unconscious: {
    agiDenied: true,
    noActions: true,
    noReactions: true,
    blocksRecovery: true
  },
  prone: {
    /** Modifiers others get when attacking it, and its own melee penalty. */
    incomingMeleeBonus: 5,
    incomingRangedPenalty: -5,
    ownMeleePenalty: -5
  },
  helpless: {
    agiDenied: true,
    /** Agi is treated as −5 outright, and Coup de Grace becomes available. */
    agiOverride: -5,
    incomingAttackBonus: 5,
    /** Does not stack with prone (§10). */
    supersedes: ["prone"]
  },
  grabbed: {
    speedZero: true,
    /** Stacks per grabber, unlike most statuses. */
    stacksIndependently: true,
    attackPenalty: -2,
    blocksDefensiveActions: true
  },
  pinned: {
    agiDenied: true,
    prone: true,
    maxActions: { minor: 1, secondary: 0, primary: 0 }
  },
  encumbered: {
    speedReduction: 0.25,
  },
  overencumbered: {
    speedZero: true,
    agiDenied: true,
  }
};

/**
 * Curses (§12). A sub-type of status: each curse stacks INDEPENDENTLY of the
 * others, so a creature can carry several at once, but not two of the same one.
 */
LASTARC.curses = {
  agony: {
    /** Loses all immunities and resistances, and becomes weak to everything. */
    stripsResistances: true,
    stripsImmunities: true,
    weakToAll: true
  },
  exhaustion: {
    defences: { ref: -10, fort: -10, will: -10 }
  },
  misfortune: {
    /**
     * Reroll all attacks and skill checks keeping the LOWER result — and
     * explicitly CANNOT reroll d20s, which is what blocks the hero point
     * reroll. See §12's three distinct reroll kinds; this is the penalty one.
     */
    rerollKeepLower: true,
    blocksD20Reroll: true
  },
  withering: { maxHpMultiplier: 0.5 },
  dim: { maxMpMultiplier: 0.5 },
  doom: {
    /** A death effect: dies in 1d4+1 turns. */
    deathAfterTurns: "1d4+1",
    isDeathEffect: true
  },
  lycanthropy: {},
  vampyrism: {}
};

/** Every status id, curses included — the set registered with Foundry. */
LASTARC.allStatusIds = [
  ...Object.keys(LASTARC.statusEffects),
  ...Object.keys(LASTARC.curses)
];

/* -------------------------------------------------------------------------- */
/*  Status icon families (issue #43)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Which colour family each status badge is drawn in.
 *
 * The GROUPINGS are the GM's, from #43 — they reflect how the table actually
 * reads the board, which is not something to invent from the outside. Only the
 * three below were unassigned and are my calls, easily moved:
 *
 *   - `unconscious` joins prone/helpless because §5.6 applies all three at once
 *   - `flatFooted` joins grabbed/pinned: you have lost control of your position
 *   - `incorporeal` joins oil/slow/petrify: your body is made of something else
 *
 * Colour is the SECOND channel, never the first. Two of the players it is for
 * are colour-blind, so the glyph shape carries the meaning and the filled disc
 * carries the visibility; hue only helps a group stand out from its neighbours.
 * See `LASTARC.statusFamilyColours` for why these particular hexes.
 */
LASTARC.statusFamilies = {
  injury:     ["blind", "severedLeg", "severedArm"],
  mind:       ["confusion", "charmed"],
  affliction: ["disease", "poison", "toad", "zombified"],
  material:   ["oil", "slowed", "petrify", "incorporeal"],
  dampened:   ["drench", "silence", "sleep"],
  shock:      ["paralysis"],
  downed:     ["prone", "helpless", "encumbered", "overencumbered", "unconscious"],
  restrained: ["grabbed", "pinned", "flatFooted"],
  curse:      Object.keys(LASTARC.curses)
};

/**
 * One colour per family, and the choice of hex is load-bearing.
 *
 * The obvious reading of the GM's colour names — a textbook red, green, pink
 * and so on — collides badly. Simulated against the three dichromacies
 * (Viénot–Brettel–Mollon), pink/green and red/green and yellow/orange all land
 * within ΔE 16 of each other under deuteranopia, and pink/grey within ΔE 10
 * under protanopia. That is two of this table's players unable to tell four of
 * the nine families apart.
 *
 * So each family keeps the colour it was NAMED but takes a specific lightness,
 * and the set forms a monotonic ladder from `downed` (L 95) to `material`
 * (L 21). Lightness is the one channel every kind of colour vision retains,
 * including the player who is losing theirs. Worst-case separation went from
 * ΔE 9.6 to ΔE 16.0 across all three dichromacies.
 *
 * `ink` is the glyph drawn on top, chosen per family for contrast against its
 * own disc — never below 4.5:1, checked in test/status-icons.test.mjs.
 */
LASTARC.statusFamilyColours = {
  downed:     { disc: "#f3f3f0", ink: "#12100e" },   // white   L 96
  shock:      { disc: "#f4db9c", ink: "#12100e" },   // yellow  L 88
  affliction: { disc: "#77c592", ink: "#12100e" },   // green   L 73
  restrained: { disc: "#e1895d", ink: "#12100e" },   // orange  L 66
  mind:       { disc: "#ea4169", ink: "#12100e" },   // pink    L 54
  dampened:   { disc: "#1b67bc", ink: "#ffffff" },   // blue    L 44
  injury:     { disc: "#952a19", ink: "#ffffff" },   // red     L 34
  curse:      { disc: "#5a216e", ink: "#ffffff" },   // purple  L 25
  material:   { disc: "#232a33", ink: "#ffffff" }    // grey    L 17
};

/** The family a status belongs to, or null. */
LASTARC.statusFamilyOf = (id) =>
  Object.keys(LASTARC.statusFamilies).find((f) => LASTARC.statusFamilies[f].includes(id)) ?? null;

/**
 * The three reroll kinds (§12), which must not be conflated:
 *   1. `second`  — reroll and keep the second result even if worse (a gamble)
 *   2. `higher`  — keep the better of the two (a racial trait plus a talent)
 *   3. `lower`   — keep the worse of the two (the misfortune penalty)
 */
LASTARC.rerollKinds = ["second", "higher", "lower"];

/* -------------------------------------------------------------------------- */
/*  Ethos (§12)                                                                */
/* -------------------------------------------------------------------------- */

LASTARC.ethosPurity = ["pure", "neutral", "corrupt"];
LASTARC.ethosMorality = ["good", "neutral", "evil"];

/* -------------------------------------------------------------------------- */
/*  Spells (§11)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The FIVE schools of magick (§18.5, book p.140).
 *
 * `highArcana` was previously listed here as a sixth school. It is not a school:
 * the book says "There are 5 different schools of magick" and names these five.
 * High Arcana are METAMAGIC modifiers applied on top of a spell — see
 * `LASTARC.highArcana` below.
 */
LASTARC.spellSchools = ["black", "blue", "green", "red", "white"];

/**
 * High Arcana — metamagic, not a school (book p.155).
 *
 * Shared rules, which the casting pipeline must honour:
 *   - using one DOUBLES the spell's MP cost;
 *   - they CANNOT be stacked (at most one per casting);
 *   - anything that reduces MP cost applies AFTER the doubling, so a cost
 *     reduction is worth half as much on an enhanced spell. Order matters.
 */
LASTARC.highArcana = Object.freeze({
  adamant: { label: "LASTARC.HighArcana.adamant", ignoresBreakPenalty: true },
  distant: { label: "LASTARC.HighArcana.distant", rangeMultiplier: 2 },
  /** Explicitly does NOT extend secondary effects. */
  enlarged: { label: "LASTARC.HighArcana.enlarged", areaMultiplier: 2 },
  intensified: { label: "LASTARC.HighArcana.intensified", damageDiceMultiplier: 2 },
  /** Only affects spells whose duration scales. */
  lingering: { label: "LASTARC.HighArcana.lingering", durationMultiplier: 2 },
  /** Extra targets = Mnd modifier (min 1); single-target spells only. */
  multi: { label: "LASTARC.HighArcana.multi", extraTargetsFromMnd: true }
});

LASTARC.highArcanaIds = Object.keys(LASTARC.highArcana);

/** MP cost multiplier applied when any High Arcana is used. */
LASTARC.highArcanaCostMultiplier = 2;

/**
 * Injury & Dismemberment (book p.170), rolled when a hero point prevents death.
 *
 * RESOLVED — this was ambiguity A7, and the resolution is not what the spec
 * assumed. The entries are NOT mutually exclusive bands on a lookup table.
 * The book says:
 *
 *   "Roll a d%, rolling the % shown, OR LESS, will impose the listed effect."
 *
 * So each row is an INDEPENDENT threshold against one roll, and they stack:
 *
 *   roll  3 → Injury AND Severed Leg AND Severed Arm
 *   roll  8 → Injury AND Severed Leg
 *   roll 50 → Injury
 *   roll 95 → nothing
 *
 * That explains both things that looked broken about the transcription: the
 * "overlapping ≤ bands" are deliberate, and the uncovered 91–100 is the
 * escape-unharmed case. Read as exclusive bands, dismemberment would have been
 * a 15% outcome; read correctly it is 10% and 5% independently.
 *
 * Missing limbs CANNOT be restored — only prosthetics reduce the penalties.
 */
LASTARC.injuryTable = Object.freeze([
  {
    id: "injury",
    threshold: 90,
    label: "LASTARC.Injury.injury",
    /** A persistent Break condition, the same mechanism as §6. */
    persistentCondition: true
  },
  {
    id: "severedLeg",
    threshold: 10,
    label: "LASTARC.Injury.severedLeg",
    status: "severedLeg"
  },
  {
    id: "severedArm",
    threshold: 5,
    label: "LASTARC.Injury.severedArm",
    status: "severedArm"
  }
]);

/**
 * Perform specialisations, and the penalty each takes to perform defensively
 * (§19, book p.157).
 *
 * NOT a flat −5 like casting: Instrument takes −5, Dance and Oratory −2, and it
 * is PER threatening creature in both cases. A bard who plays rather than sings
 * pays more than twice as much to stay safe, which is a real tactical choice and
 * would vanish entirely if this were modelled as one number.
 */
LASTARC.performSpecialisations = Object.freeze({
  instrument: { label: "LASTARC.Perform.instrument", defensivePenalty: -5 },
  dance: { label: "LASTARC.Perform.dance", defensivePenalty: -2 },
  oratory: { label: "LASTARC.Perform.oratory", defensivePenalty: -2 }
});

/**
 * Which Perform SKILL each specialisation rolls (issue #35).
 *
 * The two vocabularies are separate on purpose — a performance item stores a
 * specialisation, and the actor has skills — so the mapping is stated once here
 * rather than assembled from a string at three call sites.
 */
LASTARC.performSkillFor = Object.freeze({
  instrument: "performInstrument",
  dance: "performDance",
  oratory: "performOratory"
});

/** Whether a performance helps allies or hinders enemies (§19). */
LASTARC.performanceKinds = Object.freeze({
  enhancing: { label: "LASTARC.Perform.enhancing", targetsAllies: true },
  enfeebling: { label: "LASTARC.Perform.enfeebling", targetsAllies: false }
});

/* -------------------------------------------------------------------------- */
/*  Performance outcomes (Chapter 9, issue #13)                                */
/* -------------------------------------------------------------------------- */

/**
 * A performance's DC tiers are NOT shaped like a spell's, which is why reusing
 * the spell editor for them would have produced boxes for the wrong things.
 *
 * A spell tier answers "how much damage, against which defence, for how long".
 * A performance tier answers "who gets what bonus TO WHAT" — and the scope is
 * the load-bearing half. Chapter 9's tiers are almost all "+N to <a named
 * category>", and the categories are specific and repeated: weapon skills,
 * Reflex against spells, Reflex against attacks, Spellcraft, and a general
 * skills bucket that explicitly excludes the other three.
 *
 * A bare `skillBonus: 3` cannot tell those apart, so a bard reading their own
 * card could not know what the +3 applied to. These are the categories the
 * chapter actually prints, and no others.
 */
LASTARC.performanceBonusScopes = Object.freeze({
  weaponSkills:  { label: "LASTARC.PerformScope.weaponSkills" },
  refVsSpells:   { label: "LASTARC.PerformScope.refVsSpells" },
  refVsAttacks:  { label: "LASTARC.PerformScope.refVsAttacks" },
  spellcraft:    { label: "LASTARC.PerformScope.spellcraft" },
  /** Skill checks EXCLUDING weapon skills, Alchemy, Smithing and Spellcraft. */
  generalSkills: { label: "LASTARC.PerformScope.generalSkills" }
});

/** Bonus damage riders apply to one attack kind, never to both. */
LASTARC.performanceDamageScopes = Object.freeze({
  melee:  { label: "LASTARC.PerformScope.melee" },
  ranged: { label: "LASTARC.PerformScope.ranged" }
});

/** What an enfeebling tier's flat penalty lands on. */
LASTARC.performancePenaltyScopes = Object.freeze({
  allDefences:      { label: "LASTARC.PerformScope.allDefences" },
  ref:              { label: "LASTARC.Defence.ref" },
  fort:             { label: "LASTARC.Defence.fort" },
  will:             { label: "LASTARC.Defence.will" },
  attacksAndSkills: { label: "LASTARC.PerformScope.attacksAndSkills" }
});

/**
 * Effect tags a performance can carry.
 *
 * Printed as a trailing sentence on the enfeebling entries ("this is a mind
 * effect", "this is a fear effect"). They exist so a creature immune to one can
 * be adjudicated; nothing in this system consumes them automatically, so they
 * are a label on the card rather than a rule.
 */
LASTARC.performanceEffectTags = Object.freeze({
  mind: { label: "LASTARC.PerformTag.mind" },
  fear: { label: "LASTARC.PerformTag.fear" }
});

/**
 * MP loss from a performance EXPLODES, which nothing else draining a resource
 * does. Chapter 9 says so explicitly on the tier that causes it, so it is
 * recorded here rather than left to whoever wires the roll.
 */
LASTARC.performanceMpLossExplodes = true;

/**
 * Casting times seen across Chapters 8 and 9. These map onto the §9 action
 * slots directly — there is no minor-action casting.
 */
LASTARC.castingTimes = Object.freeze({
  primary: { label: "LASTARC.CastingTime.primary", slot: "primary" },
  secondary: { label: "LASTARC.CastingTime.secondary", slot: "secondary" },
  allOut: { label: "LASTARC.CastingTime.allOut", slot: "allOut" }
});

/**
 * Shield bash damage by shield size (§11). Note this is the SHIELD's own size,
 * not the wielder's, and is unrelated to the relative-size wield rules in §5.4.
 */
LASTARC.shieldDamage = {
  tiny: "1d4", small: "1d6", medium: "1d8", large: "1d10"
};

/** Durability class by armour type (§11) — indexes into LASTARC.objectSizes. */
LASTARC.armourDurabilityClass = {
  light: "medium", heavy: "large", mystic: "small"
};

/* -------------------------------------------------------------------------- */
/*  Block (book p.109)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cumulative penalty per block already made before the blocker's next turn.
 *
 * NOTE THE DIRECTION. An earlier draft of the spec recorded shield proficiency
 * as "caps the cumulative penalty at a flat −5", which is backwards: −5 per
 * previous block is the NORMAL rate, and being non-proficient makes it worse,
 * not the proficiency making it better. Getting this inverted turns the
 * proficiency into a downgrade for anyone who blocks twice.
 */
LASTARC.blockPenaltyPerBlock = { proficient: 5, nonProficient: 10 };

/** Flat penalty on any check made with a shield without Shield Proficiency. */
LASTARC.nonProficientShieldPenalty = 5;

/**
 * Strength score at which a heavy shield — one size category LARGER than its
 * wielder — may use the 1-Handed skill instead of 2-Handed.
 */
LASTARC.heavyShieldStrWaiver = 15;

/* -------------------------------------------------------------------------- */
/*  Dice safety (§5.3 rev2)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Cap on TOTAL dice rolled in a single exploding-dice evaluation.
 *
 * Deliberately a total, not a recursion depth: with the doubled-explosion
 * variant each explosion spawns 2 dice, so this is a branching process and a
 * depth cap of N permits up to 2^N rolls.
 */
LASTARC.maxDicePerRoll = 1000;

/** Defensive cap on Combo chains (§15 A6). */
LASTARC.maxComboChain = 20;

/* -------------------------------------------------------------------------- */
/*  Item subtypes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Subtypes that live in an inventory: they carry bulk, cost, quantity and an
 * equipped flag, and the character sheet's Inventory panel lists exactly these.
 *
 * Single source of truth on purpose. This list previously existed twice — once
 * as PHYSICAL_TYPES in item-sheet.mjs and once implicitly as "has a numeric
 * bulk" in character-sheet.mjs — and the two could drift without any test
 * noticing, which is precisely how a subtype ends up creatable but invisible.
 */
LASTARC.physicalItemTypes = [
  "weapon", "armour", "shield", "ammunition", "accessory", "consumable",
  "resourceItem", "mount", "spellScroll", "orchestralScore", "prostheticLimb"
];

/**
 * Which subtypes each character-sheet panel can create.
 *
 * Drives the "+" button in every panel header. The keys are panel names, not
 * arbitrary labels — `createItem` reads `data-group` and looks it up here, so a
 * typo in a template fails loudly at click time instead of creating the wrong
 * thing. `allItemTypes` below asserts every declared subtype appears in at
 * least one group, which is what stops a new subtype from being unreachable.
 */
LASTARC.itemCreationGroups = {
  attacks: ["weapon"],
  spells: ["spell"],
  performances: ["performance"],
  technicks: ["technick", "talent"],
  features: ["feature", "race", "class"],
  // Scrolls and orchestral scores are objects you carry, not things you know,
  // so they belong here rather than in the Spells and Performances groups —
  // creating one from those panels would file it into Inventory and look like
  // the button had failed.
  inventory: LASTARC.physicalItemTypes,
  // The NPC sheet has one undifferentiated item list rather than panels, so it
  // offers everything. Assigned below, once allItemTypes exists.
  npc: []
};

/** Every subtype the system declares, in a stable order for pickers. */
LASTARC.allItemTypes = [
  "weapon", "armour", "shield", "ammunition", "accessory", "consumable",
  "technick", "talent", "spell", "performance", "race", "class", "feature",
  "resourceItem", "mount", "spellScroll", "orchestralScore", "prostheticLimb"
];

LASTARC.itemCreationGroups.npc = LASTARC.allItemTypes;

/**
 * Enumerations the item schemas constrain on and the item sheet builds
 * dropdowns from.
 *
 * Previously written inline in `defineSchema()` as bare arrays, which meant the
 * sheet had no way to offer the choices a field would accept — and a field
 * whose valid values the UI cannot show is a field nobody can set correctly.
 */
LASTARC.technickKinds = ["technick", "talent"];
/** Where a race/class feature came from. Labelling only — no mechanical effect. */
LASTARC.featureCategories = ["race", "class", "other"];
LASTARC.consumableTypes = ["potion", "poison", "scroll", "score", "grenade", "other"];
LASTARC.prostheticSites = ["arm", "leg"];
/** Defences a spell outcome or performance may be opposed by. */
LASTARC.opposableDefences = ["ref", "fort", "will"];

/* -------------------------------------------------------------------------- */
/*  Active Effect targets (issue #20)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The paths an Active Effect may usefully write.
 *
 * THIS IS A WHITELIST, AND IT HAS TO BE. Active Effects apply BETWEEN
 * `prepareBaseData` and `prepareDerivedData`, so every path derivation assigns
 * afterwards is overwritten in memory on the very next prepare. Forty paths are
 * written after that point, and they are exactly the ones anybody reaches for
 * first: `resources.hp.max`, `defences.ref.value`, `movement.value`,
 * `damageMods.dr`, `breakGauge.threshold`.
 *
 * An effect on any of those does nothing, reports no error, and leaves a GM
 * staring at a number that will not move. Offering a free-text path box would
 * make that the DEFAULT experience, so the authoring UI offers this list and
 * nothing else, and `module/effects.mjs` warns about anything outside it.
 *
 * What makes an entry safe is that it is an INPUT slot — `misc`, `racialMod`,
 * an attribute's `value` — deliberately provided for exactly this. Derivation
 * reads them and never assigns them. `test/effect-targets.test.mjs` re-derives
 * the written set from the data model source and fails if any entry here has
 * become one of them, so this list cannot rot into a lie.
 *
 * Categories, not individual skills: a group expands to its members at use
 * time, because "all weapon skills" is what a performance actually grants and
 * making the GM tick five boxes would invite them to miss one.
 */
LASTARC.effectTargetGroups = Object.freeze({
  attribute: { label: "LASTARC.EffectTarget.groupAttribute" },
  defence: { label: "LASTARC.EffectTarget.groupDefence" },
  skill: { label: "LASTARC.EffectTarget.groupSkill" },
  skillGroup: { label: "LASTARC.EffectTarget.groupSkillGroup" }
});

/**
 * Named collections of skills a single effect can hit at once.
 *
 * `generalSkills` is defined by EXCLUSION in Chapter 9 — every skill that is
 * not a weapon skill, Alchemy, Smithing or Spellcraft — so it is resolved from
 * that rule rather than listed, and cannot fall out of step when a skill is
 * added.
 */
LASTARC.effectSkillGroups = Object.freeze({
  weaponSkills: {
    label: "LASTARC.PerformScope.weaponSkills",
    members: () => Object.entries(LASTARC.allSkills)
      .filter(([, cfg]) => cfg.weapon).map(([k]) => k)
  },
  generalSkills: {
    label: "LASTARC.PerformScope.generalSkills",
    members: () => Object.entries(LASTARC.allSkills)
      .filter(([k, cfg]) => !cfg.weapon && !["alchemy", "smithing", "spellcraft"].includes(k))
      .map(([k]) => k)
  },
  allSkills: {
    label: "LASTARC.EffectTarget.allSkills",
    members: () => Object.keys(LASTARC.allSkills)
  }
});

/**
 * Performance and spell scopes that CANNOT become an Active Effect, with the
 * reason, so the card can say so instead of silently dropping them.
 *
 * Both are conditional on something the effect system cannot see:
 *
 *   - a Reflex bonus that applies only against spells, or only against
 *     attacks, would have to sit on `defences.ref.misc`, which applies to
 *     everything. Over-applying a bonus is worse than not applying it.
 *   - bonus damage is assembled at roll time from the weapon and the
 *     wielder's attribute. There is no actor field standing behind it, so
 *     there is nothing for an effect to point at.
 *
 * These belong to issue #16's conditional modifiers, not here.
 */
LASTARC.unmappableEffectScopes = Object.freeze({
  refVsSpells: "LASTARC.EffectTarget.conditionalOnly",
  refVsAttacks: "LASTARC.EffectTarget.conditionalOnly",
  melee: "LASTARC.EffectTarget.noDamageField",
  ranged: "LASTARC.EffectTarget.noDamageField"
});

/* -------------------------------------------------------------------------- */
/*  Hook surface (§11)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Documented hook names. Technicks, talents and item features inject here rather
 * than being hardcoded — there are ~80 technicks and many rewrite the damage
 * pipeline, action economy, or reaction rules.
 */
LASTARC.hooks = {
  preDamageRoll: "lastarc.preDamageRoll",
  postDamageRoll: "lastarc.postDamageRoll",
  explodeDice: "lastarc.explodeDice",
  breakStepApplied: "lastarc.breakStepApplied",
  provokeCheck: "lastarc.provokeCheck",
  reactionAvailable: "lastarc.reactionAvailable"
};
