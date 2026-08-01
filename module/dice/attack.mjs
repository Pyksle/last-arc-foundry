/**
 * Attack and damage pipeline (§5.1, §5.2, §5.5).
 *
 * The pure decision logic lives in `resolveAttack` and `buildDamageTerms` so it
 * can be unit tested; the async functions below are the Foundry-facing wrappers
 * that actually roll dice and post chat cards.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollDamageDice, rollExplodingDice } from "./explode.mjs";
import { describeCheck } from "./breakdown.mjs";
import { situationalLabel } from "./situational.mjs";
import * as DT from "./damage-type.mjs";

/* -------------------------------------------------------------------------- */
/*  Attack resolution — pure                                                   */
/* -------------------------------------------------------------------------- */

/** Two-weapon fighting penalty by Dual Wield rank (§5.1). */
export const DUAL_WIELD_PENALTY = [-10, -5, -2, 0];

/**
 * The modifiers that depend only on the SITUATION, not on who is attacking.
 *
 * Split out because monsters take these too. An NPC's attack bonus is a printed
 * statblock number rather than a derived skill total, but flanking, cover, high
 * ground and a prone target apply to a goblin exactly as they apply to a
 * player. Keeping one implementation means a modifier added here can never
 * silently apply to only half the combatants.
 *
 * @returns {Array<{label:string, value:number}>}
 */
export function situationalModifiers({
  flanking = false,
  highGround = false,
  shootingIntoMelee = false,
  preciseShot = false,
  targetProne = false,
  isMelee = true,
  targetHelpless = false,
  concealment = "none",
  improvised = false,
  situational = 0,
  situationalNote = null,
  rangeBand = null
} = {}) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  if (flanking && isMelee) add("LASTARC.Mod.flanking", 2);
  if (highGround && !isMelee) add("LASTARC.Mod.highGround", 2);

  // Precise Shot negates the shooting-into-melee penalty entirely (§10).
  if (shootingIntoMelee && !preciseShot) add("LASTARC.Mod.shootingIntoMelee", -5);

  // Prone helps melee attackers and hinders ranged ones (§10).
  if (targetProne) add("LASTARC.Mod.targetProne", isMelee ? 5 : -5);
  if (targetHelpless) add("LASTARC.Mod.targetHelpless", 5);

  if (concealment === "partial") add("LASTARC.Mod.concealment", -2);
  else if (concealment === "total") add("LASTARC.Mod.totalConcealment", -5);

  if (improvised) add("LASTARC.Mod.improvised", -5);

  // Range increment (issue #36). The band is stated by the player rather than
  // measured — the system has no reliable notion of the distance between two
  // tokens on an arbitrary scene, and guessing it would be worse than asking.
  if (rangeBand) add(LASTARC.rangeBands[rangeBand]?.label ?? "", D.rangeBandPenalty(rangeBand));

  // The note replaces the generic label when one was typed, so the card
  // records WHY the number was applied and the table can check it later.
  add(situationalLabel(situationalNote), situational);

  return parts;
}

/**
 * Assemble the modifiers on a CHARACTER's attack roll.
 *
 * @returns {{total:number, parts:Array<{label:string, value:number}>}}
 */
export function attackModifiers({
  skillMod = 0,
  weaponAtkBonus = 0,
  proficient = true,
  twoWeapon = false,
  dualWieldRank = 0,
  ...situation
} = {}) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  add("LASTARC.Mod.skill", skillMod);
  add("LASTARC.Mod.weapon", weaponAtkBonus);

  if (!proficient) add("LASTARC.Mod.nonProficient", -5);

  if (twoWeapon) {
    const rank = Math.min(dualWieldRank, DUAL_WIELD_PENALTY.length - 1);
    add("LASTARC.Mod.twoWeapon", DUAL_WIELD_PENALTY[rank]);
  }

  parts.push(...situationalModifiers(situation));

  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/**
 * Assemble the modifiers on an NPC's attack roll.
 *
 * A statblock's attack bonus is a PRINTED, UNBROKEN number — the same convention
 * its defences use. The Break Gauge penalty is applied on top here rather than
 * baked into the stored value, so the sheet can always show what the book says
 * next to what is true right now.
 *
 * Nothing here derives from attributes or skills on purpose: back-deriving a
 * bestiary entry from a character build fights the source material.
 *
 * @returns {{total:number, parts:Array<{label:string, value:number}>}}
 */
export function npcAttackModifiers({
  atkBonus = 0,
  breakPenalty = 0,
  ...situation
} = {}) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  add("LASTARC.Mod.statblock", atkBonus);
  add("LASTARC.Mod.break", breakPenalty);

  parts.push(...situationalModifiers(situation));

  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/**
 * Decide the outcome of an attack from its natural die and total.
 *
 * Three things here are easy to get wrong:
 *
 * 1. **Nat 20 and nat 1 are absolute** — they hit and miss regardless of totals.
 *    This applies to weapon skills, which is what attacks use.
 * 2. **An auto-hit is still blockable and dodgeable.** Block and Dodge are
 *    OPPOSED REACTIONS, not defence comparisons, so a natural 20 does not close
 *    the reaction window. `reactionWindowOpen` stays true on auto-hits precisely
 *    so callers cannot short-circuit it.
 * 3. **Area attacks can neither crit nor combo** (§5.1), and a charge cannot
 *    combo, so the nat-20 rider depends on more than melee/ranged.
 *
 * @returns {{hit:boolean, natural:number, autoHit:boolean, autoMiss:boolean,
 *            combo:boolean, critical:boolean, reactionWindowOpen:boolean}}
 */
export function resolveAttack({
  natural,
  total,
  targetDefence,
  isMelee = true,
  isArea = false,
  isCharge = false
}) {
  const autoHit = natural === 20;
  const autoMiss = natural === 1;

  // Meet it, beat it (§1).
  const hit = autoHit ? true : autoMiss ? false : total >= targetDefence;

  const canRide = autoHit && !isArea;
  const combo = canRide && isMelee && !isCharge;
  const critical = canRide && !isMelee;

  return {
    natural,
    total,
    hit,
    autoHit,
    autoMiss,
    combo,
    critical,
    // Open on any hit, INCLUDING an auto-hit.
    reactionWindowOpen: hit
  };
}

/**
 * Build the non-dice half of a damage expression (§5.2).
 *
 * `wieldCategory` is the DERIVED category from §5.4, not a grip choice — only a
 * weapon one size category larger than its wielder doubles Strength.
 *
 * Weapon Finesse substitutes Agility for Strength on light, thrown, unarmed and
 * natural attacks. It is applied here rather than at the call site so the
 * "which attribute" question has exactly one answer in the codebase.
 *
 * @returns {{flat:number, parts:Array<{label:string, value:number}>, attribute:string|null}}
 */
export function buildDamageTerms({
  level = 1,
  strMod = 0,
  agiMod = 0,
  wieldCategory = "oneHanded",
  isRanged = false,
  isThrown = false,
  weaponFinesse = false,
  rangedUsesStrength = false,
  damageBonus = 0,
  breakPenalty = 0
} = {}) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };

  add("LASTARC.Mod.halfLevel", D.rd(level / 2));

  let attribute = null;
  if (!isRanged || isThrown) {
    // Finesse applies to light, thrown, unarmed and natural attacks.
    const finesseEligible = wieldCategory === "light" || isThrown || wieldCategory === "unarmed";
    attribute = weaponFinesse && finesseEligible ? "agi" : "str";

    const mod = attribute === "agi" ? agiMod : strMod;
    const multiplier = D.strDamageMultiplier(wieldCategory);
    add(multiplier === 2 ? "LASTARC.Mod.attributeDoubled" : "LASTARC.Mod.attribute", mod * multiplier);
  } else if (rangedUsesStrength) {
    /**
     * Bows, and only bows (issue #36). The weapon groups define bows as ranged
     * weapons that "rely on the wielder's strength" and crossbows as ranged
     * weapons "that do not utilize strength" — two groups that differ, not one
     * rule with an exception.
     *
     * Treating "ranged" as a single behaviour got BOTH wrong simultaneously:
     * no ranged weapon added an attribute, so crossbows were right by accident
     * and every bow in play was quietly short its Strength modifier.
     *
     * Never doubled. The ×2 belongs to the melee sizing rule for wielding a
     * weapon a category above you; nothing extends it to a longbow.
     */
    attribute = "str";
    add("LASTARC.Mod.attribute", strMod);
  }

  add("LASTARC.Mod.weaponBonus", damageBonus);

  // A broken weapon deals less damage; the total floors at 1 (§6).
  add("LASTARC.Mod.weaponBreak", breakPenalty);

  return { flat: parts.reduce((s, p) => s + p.value, 0), parts, attribute };
}

/* -------------------------------------------------------------------------- */
/*  Foundry-facing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Roll an attack with a weapon.
 *
 * @param {Actor} actor
 * @param {Item} weapon
 * @param {object} [options]
 */
export async function rollAttack(actor, weapon, options = {}) {
  const sys = actor.system;

  if (sys.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  const wield = D.wieldCategory(sys.details.size, weapon.system.size, weapon.system.category);
  if (wield === "unusable") {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.WeaponUnusable", {
        weapon: weapon.name, actor: actor.name
      })
    );
    return null;
  }

  // A light weapon one size down may use 1-Handed instead, at the wielder's
  // choice (§5.4). Everything else maps straight through — via weaponSkillFor,
  // because the wield vocabulary and the skill vocabulary differ.
  /**
   * Staves are resolved with Spellcraft, not a weapon skill (issue #36). The
   * check is on the CATEGORY and comes first, because the wield category is
   * derived from size and would otherwise route a staff to One-Handed or
   * Two-Handed — the sizing question the book explicitly does not ask of them.
   */
  const skillKey = LASTARC.spellcraftWeaponCategories.has(weapon.system.category)
    ? "spellcraft"
    : wield === "light" && options.useOneHanded
      ? "oneHanded"
      : D.weaponSkillFor(wield);

  const skill = sys.skills[skillKey];
  if (!skill) throw new Error(`Actor has no "${skillKey}" skill for a ${wield} attack.`);
  const isMelee = !LASTARC.rangedWeaponCategories.has(weapon.system.category);

  const mods = attackModifiers({
    skillMod: skill?.total ?? 0,
    weaponAtkBonus: weapon.system.atkBonus ?? 0,
    proficient: sys.proficiencies.weapons.includes(weapon.system.category),
    isMelee,
    preciseShot: hasFlag(actor, "preciseShot"),
    dualWieldRank: dualWieldRank(actor),
    ...options
  });

  const roll = new Roll("1d20 + @mod", { mod: mods.total });
  await roll.evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? 0;

  const outcome = resolveAttack({
    natural,
    total: roll.total,
    targetDefence: options.targetDefence ?? null,
    isMelee,
    isArea: !!options.isArea,
    isCharge: !!options.isCharge
  });

  await postAttackCard({ actor, weapon, roll, mods, outcome, options });
  return { roll, mods, outcome, wield, skillKey, isMelee };
}

/**
 * Roll damage for a resolved attack.
 *
 * A critical multiplies the WEAPON's dice count only. Bonus dice from talents
 * and technicks are rolled separately and are not multiplied unless the granting
 * effect says so (§5.1).
 */
export async function rollDamage(
  actor, weapon,
  { outcome, wield, isMelee, isThrown = false, damageType = null, prompt = true } = {}
) {
  const sys = actor.system;

  /**
   * Settled BEFORE any dice are rolled, because dismissing the picker has to
   * mean the attack did not happen. Resolving it afterwards would leave a rolled
   * result with nowhere to go and a spent Combo.
   */
  const type = await DT.resolveDamageType(weapon.system.damageType, {
    chosen: damageType, prompt, weaponName: weapon.name
  });
  if (type === null) return null;

  const critMultiplier = outcome?.critical
    ? (hasFlag(actor, "tripleCrit") ? 3 : 2)
    : 1;

  const explosionMultiplier = hasFlag(actor, "doubledExplosions") ? 2 : 1;

  const terms = buildDamageTerms({
    level: sys.details.level,
    strMod: sys.attributes.str.mod,
    agiMod: sys.attributes.agi.mod,
    wieldCategory: wield,
    isRanged: !isMelee,
    isThrown,
    weaponFinesse: hasFlag(actor, "weaponFinesse"),
    // Bows only — crossbows and staves add no attribute at all (issue #36).
    rangedUsesStrength: LASTARC.strengthRangedCategories.has(weapon.system.category),
    damageBonus: weapon.system.damageBonus ?? 0,
    breakPenalty: weapon.system.breakGauge?.penalty ?? 0
  });

  const result = await rollDamageDice({
    diceFormula: weapon.system.damage,
    critMultiplier,
    explosionMultiplier,
    flat: terms.flat
  });

  // Minimum 1 damage on a successful hit (§5.5 step 8) — applied again after
  // mitigation, but a broken weapon with a large penalty could already have
  // driven the pre-mitigation total to zero or below.
  const total = Math.max(1, result.total);

  return {
    ...result,
    total,
    terms,
    critMultiplier,
    explosionMultiplier,
    damageType: type
  };
}

/**
 * The Reflex value an attack must beat against a given target.
 *
 * A flat-footed defender uses its FLAT-FOOTED Reflex — which is the whole point
 * of the surprise round. Reading `ref.value` unconditionally would quietly
 * discard that, and the bug would look like "surprise does nothing" rather than
 * like a wrong number.
 *
 * @param {Actor|null|undefined} target
 * @returns {number|null} null when nothing is targeted
 */
export function defenceToBeat(target) {
  const ref = target?.system?.defences?.ref;
  if (!ref) return null;
  const flatFooted = target.statuses?.has?.("flatFooted");
  return flatFooted ? (ref.flatFooted ?? ref.value) : ref.value;
}

/* -------------------------------------------------------------------------- */
/*  NPC attacks                                                                */
/* -------------------------------------------------------------------------- */

/** Read a statblock attack by index, or warn and return null. */
function getNpcAttack(actor, index) {
  const attack = actor.system.attacks?.[index];
  if (!attack) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.NoSuchAttack", { name: actor.name })
    );
    return null;
  }
  return attack;
}

/**
 * Roll a statblock attack.
 *
 * Deliberately parallel to `rollAttack` rather than folded into it: the two
 * share `situationalModifiers` and `resolveAttack` — everything that encodes a
 * RULE — but differ entirely in where the number comes from. Trying to unify
 * them would mean a function full of "if this is an NPC" branches on every line.
 *
 * @param {Actor} actor
 * @param {number} index  position in `system.attacks`
 */
export async function rollNpcAttack(actor, index, options = {}) {
  const sys = actor.system;

  if (sys.breakGauge?.incapacitated) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Warning.Incapacitated", { name: actor.name })
    );
    return null;
  }

  const attack = getNpcAttack(actor, index);
  if (!attack) return null;

  const isMelee = attack.isMelee;

  const mods = npcAttackModifiers({
    atkBonus: attack.atkBonus,
    breakPenalty: sys.breakGauge?.penalty ?? 0,
    isMelee,
    ...options
  });

  const roll = new Roll("1d20 + @mod", { mod: mods.total });
  await roll.evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? 0;

  const outcome = resolveAttack({
    natural,
    total: roll.total,
    targetDefence: options.targetDefence ?? null,
    isMelee,
    isArea: !!attack.isArea,
    isCharge: !!options.isCharge
  });

  await postAttackCard({
    actor,
    attack,
    attackIndex: index,
    roll,
    mods,
    outcome,
    options
  });

  return { roll, mods, outcome, isMelee, attack };
}

/**
 * Roll damage for a statblock attack.
 *
 * A statblock's printed damage is already the TOTAL — Strength, size and level
 * are baked into the authored number. So this does NOT go through
 * `buildDamageTerms`; doing so would add a Strength modifier the book already
 * counted.
 *
 * The creature's own Break step does not reduce its damage, matching characters
 * (there the gauge hits the attack roll via skills, and only a broken WEAPON
 * reduces damage).
 */
export async function rollNpcDamage(actor, index, { outcome } = {}) {
  const attack = getNpcAttack(actor, index);
  if (!attack) return null;

  // No tripleCrit: that is a technick, and NPCs carry no technick items.
  const critMultiplier = outcome?.critical ? 2 : 1;

  const result = await rollDamageDice({
    diceFormula: attack.damage,
    critMultiplier,
    explosionMultiplier: 1,
    flat: attack.damageBonus ?? 0
  });

  return {
    ...result,
    total: Math.max(1, result.total),
    critMultiplier,
    explosionMultiplier: 1,
    damageType: attack.damageType ?? "blunt",
    appliesStatus: attack.appliesStatus || null
  };
}

/**
 * Apply a damage instance to a target: mitigation, Break Threshold, then HP.
 *
 * Order is fixed by §5.5 and the Threshold tap is chosen by the
 * `breakThresholdUsesPostDR` setting (§15 A1) rather than hardcoded.
 */
export async function applyDamage(target, { total, type = "blunt", faces = null } = {}) {
  const sys = target.system;

  /**
   * The TARGET's statuses change the instance before mitigation, and this
   * function used to ignore them completely — three payloads were computed,
   * tested and read by nobody (issue #17).
   *
   * Read off the live status set rather than `system.effectiveDamageMods`,
   * which only characters derive: an NPC would silently take the unmodified
   * numbers. Same reason `rollHealing` reads `target.statuses`.
   */
  const statuses = D.aggregateStatuses([...(target.statuses ?? [])]);
  const mods = D.effectiveDamageMods(sys.damageMods ?? {}, statuses);

  /**
   * Drench adds two DICE to incoming cold and electric, oil two to fire (§12) —
   * dice, not damage, so they explode like any other damage die. The size is
   * the attacker's, carried here from the damage roll.
   */
  const bonusDice = statuses.bonusDamageDice?.[type] ?? 0;
  let bonus = null;
  if (bonusDice > 0) {
    if (faces) {
      bonus = await rollExplodingDice({ faces, count: bonusDice, multiplier: 1 });
      total += bonus.total;
    } else {
      // Silence here would read as the status doing nothing, which is the
      // defect this whole change exists to fix.
      console.warn(
        `Last Arc | ${target.name} has +${bonusDice} ${type} damage dice but the ` +
        `damage instance carries no die size; the bonus was not applied.`
      );
    }
  }

  const mitigated = D.applyDamageMitigation({
    total,
    type,
    weakness: (mods.weakness ?? []).includes(type),
    resistance: (mods.resistance ?? []).includes(type),
    immunity: (mods.immunity ?? []).includes(type),
    dr: mods.dr ?? 0,
    isHit: true
  });

  const usePostDR = getSetting("breakThresholdUsesPostDR", true);
  const breaks = !mitigated.immune && D.exceedsBreakThreshold(
    mitigated, sys.breakGauge.threshold, usePostDR
  );

  // Temp HP absorbs first, then real HP (§5.5 step 11).
  const temp = sys.resources.hp.temp ?? 0;
  const absorbed = Math.min(temp, mitigated.final);
  const toHp = mitigated.final - absorbed;
  const newHp = Math.max(0, sys.resources.hp.value - toHp);

  const updates = {
    "system.resources.hp.temp": temp - absorbed,
    "system.resources.hp.value": newHp
  };

  if (breaks) {
    const steps = hasFlag(target, "debilitatingInjury") ? 2 : 1;
    updates["system.breakGauge.step"] = D.worsenStep(sys.breakGauge.step, steps);
    // Any action interrupts a banked Recovery (§9).
    updates["system.breakGauge.recoveryProgress"] = 0;
  }

  // At 0 HP the character drops to the bottom of the gauge and is unconscious,
  // prone and helpless (§5.6). This overrides any Break step just applied.
  const droppedToZero = newHp === 0 && sys.resources.hp.value > 0;
  if (droppedToZero) {
    updates["system.breakGauge.step"] = LASTARC.BREAK_STEP_MAX;
  }

  await target.update(updates);

  if (droppedToZero) {
    await target.toggleStatusEffect?.("unconscious", { active: true });
    await target.toggleStatusEffect?.("prone", { active: true });
    await target.toggleStatusEffect?.("helpless", { active: true });
  }

  return { ...mitigated, breaks, absorbed, appliedToHp: toHp, droppedToZero, bonus };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function hasFlag(actor, flag) {
  return actor?.items?.some(
    (i) => (i.type === "technick" || i.type === "talent")
      // Switched-off technicks do not contribute. Most of the book's flags are
      // conditional — Backstab doubles explosions when you backstab, not on
      // every attack forever — and the system cannot evaluate the condition,
      // so the player switches the technick off when it does not apply.
      && i.system?.active !== false
      && i.system?.flags?.includes(flag)
  ) ?? false;
}

/** Highest Dual Wield rank the actor holds, 0 (none) through 3 (Dual Wield III). */
function dualWieldRank(actor) {
  const ranks = { "dual-wield-i": 1, "dual-wield-ii": 2, "dual-wield-iii": 3 };
  let best = 0;
  for (const item of actor?.items ?? []) {
    const r = ranks[item.system?.slug];
    if (r > best) best = r;
  }
  return best;
}

function getSetting(key, fallback) {
  try {
    return game.settings.get("last-arc", key);
  } catch {
    return fallback;
  }
}

/**
 * Post an attack card for either a weapon Item or a statblock attack.
 *
 * Exactly one of `weapon` / `attack` is supplied. The card carries whichever
 * identifier applies so the Damage button can route back to the right roller;
 * `attackIndex` is checked with `!= null` because index 0 is legitimate and
 * would otherwise read as absent.
 */
async function postAttackCard({
  actor, weapon, attack, attackIndex = null, roll, mods, outcome, options
}) {
  const isNpc = attack != null;

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/attack-card.hbs",
    {
      actorId: actor.id,
      weaponId: weapon?.id ?? null,
      attackIndex,
      weaponName: isNpc ? attack.name : weapon.name,
      weaponImg: isNpc ? actor.img : weapon.img,
      formula: roll.formula,
      total: roll.total,
      natural: outcome.natural,
      parts: mods.parts,
      breakdown: describeCheck(roll, mods.parts),
      outcome,
      targetDefence: options.targetDefence ?? null,
      hasTarget: options.targetDefence != null,
      hasAttackIndex: attackIndex != null,
      targetName: options.target?.name ?? null,
      statusLabel: isNpc && attack.appliesStatus
        ? game.i18n.localize(`LASTARC.Status.${attack.appliesStatus}`)
        : null
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    flags: {
      "last-arc": {
        type: "attack",
        actorId: actor.id,
        weaponId: weapon?.id ?? null,
        attackIndex,
        outcome,
        // Who may answer this with a Block (issue #12). Every weapon attack
        // targets Reflex, and Reflex is what a shield opposes.
        targetId: options.target?.id ?? null,
        targetsDefence: "ref",
        attackerName: actor.name,
        attackTotal: roll.total
      }
    }
  });
}
