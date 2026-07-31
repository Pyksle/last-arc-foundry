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
 * `subskilled` = "taken individually" (§7): the parent is a container and each
 * user-defined specialisation is trained separately.
 */
LASTARC.skills = {
  acrobatics: { label: "LASTARC.Skill.acrobatics", attr: "agi", acp: true },
  alchemy:    { label: "LASTARC.Skill.alchemy",    attr: "int", acp: true },
  athletics:  { label: "LASTARC.Skill.athletics",  attr: "str", acp: true },
  deception:  { label: "LASTARC.Skill.deception",  attr: "chr", acp: false },
  disable:    { label: "LASTARC.Skill.disable",    attr: "agi", acp: true },
  lore:       { label: "LASTARC.Skill.lore",       attr: "int", acp: false, subskilled: true },
  medicine:   { label: "LASTARC.Skill.medicine",   attr: "mnd", acp: false },
  perception: { label: "LASTARC.Skill.perception", attr: "mnd", acp: false },
  perform:    { label: "LASTARC.Skill.perform",    attr: "chr", acp: true,  subskilled: true },
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
 * ⚠ `trainedSkills` is INCOMPLETE. §4.5 gives only Rogue 8 and Warrior 6; the
 * remaining four are marked null and must be filled from the class tables
 * (book pp.34–55) during Phase 5 ingestion. `trainedSkillCount()` throws on null
 * rather than guessing, so this cannot silently ship wrong.
 */
LASTARC.classes = {
  bard:     { label: "LASTARC.Class.bard",     hp1: 24, hpPer: 5, mp1: 6,  mpPer: 2, initDie: "d6",  ref: 2, fort: 0, will: 1, trainedSkills: null },
  initiate: { label: "LASTARC.Class.initiate", hp1: 18, hpPer: 4, mp1: 12, mpPer: 3, initDie: "d12", ref: 0, fort: 1, will: 2, trainedSkills: null },
  mage:     { label: "LASTARC.Class.mage",     hp1: 18, hpPer: 4, mp1: 12, mpPer: 3, initDie: "d12", ref: 1, fort: 0, will: 2, trainedSkills: null },
  ranger:   { label: "LASTARC.Class.ranger",   hp1: 30, hpPer: 6, mp1: 6,  mpPer: 2, initDie: "d8",  ref: 1, fort: 2, will: 0, trainedSkills: null },
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
LASTARC.rangedWeaponCategories = new Set(["bows", "crossbows"]);

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
 */
LASTARC.technickFlags = [
  "weaponFinesse",        // substitute Agi for Str on light/thrown/unarmed/natural
  "preciseShot",          // negates the -5 for shooting into melee
  "tripleCrit",           // ranged crit multiplier x3 instead of x2
  "doubledExplosions",    // each exploding die generates 2 rather than 1 (Backstab)
  "combatCasting",        // multi-threat casting reduced to a single -5
  "brawler",              // unarmed attacks no longer provoke
  "shieldProficiency",    // cumulative block penalty capped at a flat -5
  "hardyAndHearty",       // removes the once-per-encounter Second Wind cap
  "debilitatingInjury"    // damage over Threshold worsens the gauge by 2, not 1
];

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
    /** Skills requiring vocalisation. Perform is sub-skilled; only some qualify. */
    blocksSkills: ["spellcraft", "persuasion"],
    blocksPerformSpecialisations: ["instrument", "oratory"]
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
    enablesCoupDeGrace: true,
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
    blocksFlying: true
  },
  overencumbered: {
    speedZero: true,
    agiDenied: true,
    blocksFlying: true
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

LASTARC.spellSchools = ["black", "blue", "green", "red", "white", "highArcana"];

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
