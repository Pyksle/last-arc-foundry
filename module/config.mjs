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
    defences: { ref: -10, fort: -10, will: -10 },
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

/** Whether a performance helps allies or hinders enemies (§19). */
LASTARC.performanceKinds = Object.freeze({
  enhancing: { label: "LASTARC.Perform.enhancing", targetsAllies: true },
  enfeebling: { label: "LASTARC.Perform.enfeebling", targetsAllies: false }
});

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
