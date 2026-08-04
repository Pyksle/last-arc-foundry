/**
 * Combat wiring (§8, §9).
 *
 * Replaces Foundry's default turn handling, which is wrong for this system in
 * two ways: it rolls d20 for initiative and it sorts descending. All the
 * decision logic lives in initiative.mjs and action-economy.mjs, both
 * Foundry-free and unit tested; this file is the adapter.
 */

import { LASTARC } from "./config.mjs";
import * as INIT from "./initiative.mjs";
import * as AE from "./action-economy.mjs";
import * as ATK from "./dice/attack.mjs";
import * as D from "./derivation.mjs";
import { rollCheckD20 } from "./dice/d20.mjs";

const SYSTEM_ID = "last-arc";
const FLAG_ORDER = "turnOrder";
const FLAG_ACTIONS = "actions";
const FLAG_HELD = "held";

/**
 * Set when the LIFECYCLE flat-footed a combatant for the round-1 rule, so the
 * round-2 expiry can clear exactly those and leave anything else alone (#37).
 *
 * The GM's ruling is that the per-attacker cases — "flat-footed against Nim but
 * not against Vera" — are applied by hand, because one status on the actor
 * cannot express a pair. That only works if the lifecycle stops sweeping the
 * status off everybody at the top of every round, which is what it did: a
 * flat-footed applied during round 3 for an ambush vanished when round 4 began,
 * before its target had taken the turn that is supposed to end it.
 */
const FLAG_FF_AUTO = "flatFootedRound1";

/**
 * Whether this combatant was caught by the surprise round (§8).
 *
 * A combat-scoped flag rather than a status: `LASTARC.allStatusIds` is the
 * book's condition list and "surprised" is not on it — the rules express it as
 * a state of the encounter that MAKES you flat-footed. The flag is what feeds
 * `isFlatFooted`'s `surprised` trigger, and it ends where the GM asked the
 * status to end, at the start of the creature's turn.
 */
const FLAG_SURPRISED = "surprised";

/* -------------------------------------------------------------------------- */
/*  Combatant helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Snapshot in the shape the pure comparators expect. */
function snapshot(combatant) {
  const sys = combatant.actor?.system ?? {};
  return {
    id: combatant.id,
    initiative: combatant.initiative,
    turnOrder: combatant.getFlag(SYSTEM_ID, FLAG_ORDER) ?? combatant.initiative,
    agiScore: sys.attributes?.agi?.total ?? 0,
    initiativeDie: sys.initiative?.effectiveDie ?? "d10",
    surprised: !!combatant.getFlag(SYSTEM_ID, FLAG_SURPRISED)
  };
}

/**
 * End the statuses that a creature's own turn ends (§8, the GM's ruling on #37).
 *
 * Flat-footed and surprise both last "until your next turn", so the start of
 * that turn is where they go — whatever put them there. A GM who hand-applied
 * flat-footed for an ambush gets the same expiry as the round-1 rule, which is
 * the whole reason hand-application is a workable answer to the per-pair case.
 */
async function endTurnStartStatuses(combatant) {
  if (combatant.actor?.statuses?.has("flatFooted")) {
    await combatant.actor.toggleStatusEffect?.("flatFooted", { active: false });
  }
  // Unset only when set: an unconditional write is a document update per
  // combatant per turn, and this hook already does enough of those.
  if (combatant.getFlag(SYSTEM_ID, FLAG_FF_AUTO)) {
    await combatant.unsetFlag(SYSTEM_ID, FLAG_FF_AUTO);
  }
  if (combatant.getFlag(SYSTEM_ID, FLAG_SURPRISED)) {
    await combatant.unsetFlag(SYSTEM_ID, FLAG_SURPRISED);
  }
}

export function getTurnState(combatant) {
  return combatant.getFlag(SYSTEM_ID, FLAG_ACTIONS) ?? AE.createTurnState();
}

export async function setTurnState(combatant, state) {
  return combatant.setFlag(SYSTEM_ID, FLAG_ACTIONS, state);
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                               */
/* -------------------------------------------------------------------------- */

export function registerCombat() {
  /**
   * Ascending sort by the explicit turn-order key.
   *
   * Deliberately NOT solved by storing a negated initiative: that surfaces wrong
   * in the tracker UI and to every module that reads `combatant.initiative`.
   * The rolled die stays the displayed value; ordering is a separate key so Hold
   * Turn can permanently diverge from it.
   */
  Combat.prototype._sortCombatants = function (a, b) {
    const result = INIT.compareTurnOrder(snapshot(a), snapshot(b));
    // Stable fallback so the tracker does not jitter between renders. A genuine
    // tie is surfaced to the GM separately rather than silently settled here.
    return result || (a.id > b.id ? 1 : -1);
  };

  /**
   * Roll initiative with the actor's CLASS DIE, not a d20, and with no
   * modifiers by default (§8).
   *
   * This MUST hang off Combatant, not Combat, and MUST take no arguments.
   * v13 calls `combatant.getInitiativeRoll()` → `this._getInitiativeFormula()`
   * with `this` being the Combatant. An override on `Combat.prototype` is never
   * consulted: core then falls back to
   * `String(CONFIG.Combat.initiative.formula || game.system.initiative)`, and
   * with neither set that stringifies to the literal "undefined", which fails
   * to parse as "Unresolved StringTerm undefined". The effect was that rolling
   * initiative from the tracker threw outright.
   */
  Combatant.prototype._getInitiativeFormula = function () {
    const die = this.actor?.system?.initiative?.effectiveDie;
    // Stored as "d10"; make the count explicit rather than trusting the parser.
    return die ? `1${die}` : "1d10";
  };

  // Seed the ordering key whenever initiative is rolled.
  Hooks.on("updateCombatant", async (combatant, changed) => {
    if (!("initiative" in changed) || changed.initiative == null) return;
    if (combatant.getFlag(SYSTEM_ID, FLAG_HELD)) return;   // a hold owns the order
    await combatant.setFlag(SYSTEM_ID, FLAG_ORDER, changed.initiative);
  });

  /**
   * Turn and round bookkeeping, driven from `updateCombat`.
   *
   * NOT from `combatTurn` / `combatRound` / `combatStart`, all three of which
   * Foundry fires with `Hooks.callAll(...)` BEFORE `await this.update(...)`.
   * That has two consequences, and the original code was wrong on both:
   *
   *   1. `combat.combatant`, `combat.round` and `combat.turn` are all still the
   *      OLD values. Resetting action slots there reset them for the OUTGOING
   *      combatant, so everyone acted on someone else's budget, and the
   *      round-2 flat-footed sweep was permanently one round late.
   *   2. `callAll` is synchronous and does not await handlers, so any document
   *      write raced the combat update — turns visibly failed to advance.
   *
   * `updateCombat` fires after the document has changed, so everything read
   * here is current, and it is awaited properly.
   *
   * Guarded to a single GM: without this every connected client would race to
   * apply the same status toggles.
   */
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.users?.activeGM?.isSelf) return;
    if (!("turn" in changed) && !("round" in changed)) return;

    const combatant = combat.combatant;
    const startedThisUpdate = changed.round === 1 && combat.turn === 0;

    /**
     * Combat has just begun: everyone who has not yet acted is flat-footed (§8).
     *
     * The list comes from `initiative.mjs` rather than being decided here.
     * This block used to read `c.id === combatant?.id` and nothing else — a
     * strict subset of the rule that file states, and the two disagreed on a
     * real case: a creature caught by the surprise round which then won
     * initiative was flat-footed by the rule and not by the code (#37).
     */
    if (startedThisUpdate) {
      const ids = new Set(INIT.flatFootedAtCombatStart(
        [...combat.combatants].map(snapshot),
        { round: combat.round, actingId: combatant?.id ?? null }
      ));
      for (const c of combat.combatants) {
        if (!c.actor || !ids.has(c.id)) continue;
        await c.actor.toggleStatusEffect?.("flatFooted", { active: true });
        await c.setFlag(SYSTEM_ID, FLAG_FF_AUTO, true);
      }
    }

    /**
     * From round 2 the "has not yet acted" trigger no longer applies to anyone.
     *
     * Scoped to the combatants the lifecycle itself flat-footed. It used to
     * clear the status from EVERY combatant, which is indistinguishable from
     * the round-1 case only for as long as nothing else can apply it — and the
     * ruling on #37 is that the GM applies it by hand for the per-attacker
     * cases. Unscoped, this loop deleted those at the next round boundary.
     */
    if (combat.round > 1 && "round" in changed) {
      for (const c of combat.combatants) {
        if (!c.getFlag(SYSTEM_ID, FLAG_FF_AUTO)) continue;
        if (c.actor?.statuses?.has("flatFooted")) {
          await c.actor.toggleStatusEffect?.("flatFooted", { active: false });
        }
        await c.unsetFlag(SYSTEM_ID, FLAG_FF_AUTO);
      }
    }

    if (!combatant) return;

    /**
     * The start of a creature's turn ends its flat-footed and its surprise.
     *
     * NOT on the update where combat began. That is the first combatant's
     * first turn, not a later one, and §8 gives a surprised creature its
     * flat-footed "until its NEXT turn" — clearing here would hand back the
     * Agility on the single turn the ambush was meant to cost.
     */
    if (!startedThisUpdate) await endTurnStartStatuses(combatant);

    // Fresh slots for the INCOMING combatant — but banked minor progress
    // survives the turn boundary, per §9.
    await setTurnState(combatant, AE.beginTurn(getTurnState(combatant)));
  });

  // Surface genuine ties for a coin flip rather than settling them invisibly.
  Hooks.on("renderCombatTracker", (app, element) => {
    const combat = game.combat;
    if (!combat?.combatants?.size) return;

    const ties = INIT.unresolvedTies([...combat.combatants].map(snapshot));
    if (!ties.length) return;

    console.debug(
      `Last Arc | ${ties.length} initiative tie(s) unresolved after Agility — ` +
      `§8 settles these with a coin flip.`
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  Counterattacks                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Grid distance in squares between two token documents.
 *
 * Uses the scene's own measurement so the §10 diagonal rule (RECTILINEAR — a
 * diagonal costs 2) is honoured rather than re-implemented here with a
 * Chebyshev distance that would quietly disagree with movement.
 */
function squaresBetween(a, b) {
  if (!a || !b) return Infinity;
  const grid = a.parent?.grid ?? canvas?.grid;
  if (!grid) return Infinity;

  const from = { x: a.x + (a.width * grid.size) / 2, y: a.y + (a.height * grid.size) / 2 };
  const to = { x: b.x + (b.width * grid.size) / 2, y: b.y + (b.height * grid.size) / 2 };

  const path = grid.measurePath?.([from, to]);
  if (path?.distance != null) return path.distance;

  // Gridless or an older measurement API: fall back to raw distance in squares.
  return Math.hypot(to.x - from.x, to.y - from.y) / grid.size;
}

/**
 * Combatants who threaten `combatant` — enemies in reach with a reaction left.
 *
 * A SUGGESTION, not an authority. Whether a creature actually threatens you is a
 * ruling (cover, awareness, being restrained), so callers may pass their own
 * list. Getting this wrong matters: the defensive-casting penalty is −5 PER
 * threat, so an over-count compounds.
 */
export function threateningCombatants(combatant) {
  const combat = combatant?.parent;
  if (!combat || !combatant.token) return [];

  // Opposition, stated explicitly rather than inferred from "dispositions
  // differ" — which treats two HOSTILE creatures as enemies of each other, and
  // a NEUTRAL bystander as an enemy of everyone.
  //
  // FRIENDLY vs HOSTILE is the only pairing taken as automatically opposed.
  // Anything involving NEUTRAL or SECRET is a ruling, so it is left out and the
  // caller may pass an explicit `threats` list instead.
  const D_ = CONST.TOKEN_DISPOSITIONS;
  const mine = combatant.token?.disposition;
  const isHostileTo = (other) => {
    const theirs = other.token?.disposition;
    return (mine === D_.FRIENDLY && theirs === D_.HOSTILE)
        || (mine === D_.HOSTILE && theirs === D_.FRIENDLY);
  };

  return combat.combatants.filter((other) => {
    if (other.id === combatant.id || !other.actor || !other.token) return false;
    if (other.actor.system.resources?.hp?.value <= 0) return false;
    if (other.actor.system.breakGauge?.incapacitated) return false;
    if (!isHostileTo(other)) return false;

    const reach = other.actor.system.details?.reach ?? 1;
    return squaresBetween(other.token, combatant.token) <= reach;
  });
}

/**
 * Resolve counterattacks provoked by an action (§9, §18.4).
 *
 * Each threatening combatant that still has a reaction spends it to attack. The
 * total damage is returned so the caller can apply the consequence — which for
 * casting is not merely damage: a counterattack beating the caster's Break
 * Threshold destroys the spell outright and wastes the mana.
 *
 * @returns {Promise<{provoked:boolean, attacks:Array, totalDamage:number}>}
 */
export async function resolveCounterattacks(combatant, actionKey, options = {}) {
  const provoked = AE.provokes(actionKey, options);
  if (!provoked) return { provoked: false, attacks: [], totalDamage: 0 };

  const threats = options.threats ?? threateningCombatants(combatant);
  const attacks = [];
  let totalDamage = 0;

  for (const threat of threats) {
    // A counterattack IS a reaction and is bound by the same once-per-trigger
    // limit; a flat-footed creature has none to spend.
    const state = getTurnState(threat);
    const reaction = AE.useReaction(state, {
      flatFooted: threat.actor?.statuses?.has("flatFooted") ?? false
    });
    if (!reaction.ok) continue;
    await setTurnState(threat, reaction.state);

    const defender = combatant.actor;
    const attacker = threat.actor;

    let res = null;
    if (attacker.type === "npc") {
      if (!attacker.system.attacks?.length) continue;
      res = await ATK.rollNpcAttack(attacker, 0, {
        targetDefence: ATK.defenceToBeat(defender)
      });
    } else {
      const weapon = attacker.items.find((i) => i.type === "weapon" && i.system.equipped);
      if (!weapon) continue;
      res = await ATK.rollAttack(attacker, weapon, {
        targetDefence: ATK.defenceToBeat(defender)
      });
    }
    if (!res?.outcome?.hit) { attacks.push({ attacker: threat.name, hit: false }); continue; }

    const dmg = attacker.type === "npc"
      ? await ATK.rollNpcDamage(attacker, 0, { outcome: res.outcome })
      // `prompt: false` — a dual-type weapon takes its first type here rather
      // than opening a picker. This loop runs once per threatening creature, in
      // the middle of somebody else's turn, so asking would stack a dialog per
      // counterattacker on a player who did not initiate any of them.
      : await ATK.rollDamage(attacker, attacker.items.find((i) => i.type === "weapon" && i.system.equipped),
          { outcome: res.outcome, wield: res.wield, isMelee: res.isMelee, prompt: false });

    if (!dmg) continue;
    const applied = await ATK.applyDamage(defender, { total: dmg.total, type: dmg.damageType });
    totalDamage += applied.final;
    attacks.push({ attacker: threat.name, hit: true, damage: applied.final });
  }

  return { provoked: true, attacks, totalDamage };
}

/* -------------------------------------------------------------------------- */
/*  Surprise                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a surprise round: roll each ambusher's Stealth, compare it against
 * every defender's Passive Perception, and flat-foot the ones who were caught.
 *
 * Awareness is decided PER ATTACKER-DEFENDER PAIR (§8) — a guard can spot one
 * ambusher and miss another. Foundry's status system is a flat set on the actor
 * and cannot express "flat-footed against Nim but not against Vera", so the
 * status is applied when a defender missed AT LEAST ONE attacker, and the full
 * pairing is reported back for the GM to adjudicate the rest.
 *
 * @param {Combatant[]} attackers
 * @param {Combatant[]} defenders
 * @returns {Promise<{stealth:Object, unnoticed:Object, flatFooted:string[]}>}
 */
export async function rollSurprise(attackers, defenders) {
  const stealth = {};
  const rolled = [];

  for (const a of attackers) {
    /**
     * Shape-aware, and it was not. This read `skills.stealth.total`, which a
     * statblock does not have, so every monster ambushed at Stealth +0 — while
     * the DEFENDERS' passive Perception below was written to handle both shapes
     * from the start. Ten lines apart, in the same function.
     */
    const mod = D.skillTotalOf(a.actor?.system?.skills, "stealth");
    // A Stealth check is a skill check, so Misfortune applies (§12).
    const { roll } = await rollCheckD20(a.actor, mod);
    stealth[a.name] = roll.total;
    rolled.push({ id: a.id, name: a.name, stealth: roll.total });
  }

  const defs = defenders.map((d) => ({
    id: d.id,
    name: d.name,
    passivePerception:
      d.actor?.system?.skills?.perception?.passive
      ?? d.actor?.system?.passivePerception
      ?? 0
  }));

  const unnoticed = INIT.surpriseAwareness(rolled, defs);

  const flatFooted = [];
  const report = {};
  /**
   * Iterating the COMBATANTS, not the plain snapshots.
   *
   * This loop ran over `defs`, whose entries carry `{id, name,
   * passivePerception}` and no `actor` at all — so `d.actor?.toggleStatusEffect`
   * short-circuited on undefined every time and no status was ever applied,
   * while `flatFooted.push` still ran. The function reported an ambush it had
   * not carried out. It has never bitten anyone only because nothing calls it
   * yet; the tracker button that would have was the thing keeping it quiet.
   */
  for (const defender of defenders) {
    const missed = unnoticed.get(defender.id) ?? new Set();
    report[defender.name] = rolled.filter((a) => missed.has(a.id)).map((a) => a.name);
    if (!missed.size) continue;

    await defender.actor?.toggleStatusEffect?.("flatFooted", { active: true });
    // Recorded so the round-1 sweep can tell an ambush from the opening-round
    // rule, and so `isFlatFooted` sees the surprise trigger for a defender who
    // goes on to win initiative (#37).
    await defender.setFlag?.(SYSTEM_ID, FLAG_SURPRISED, true);
    flatFooted.push(defender.name);
  }

  return { stealth, unnoticed: report, flatFooted };
}

/* -------------------------------------------------------------------------- */
/*  Hold Turn                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hold this combatant's turn, deferring to the next one.
 *
 * §8: this PERMANENTLY reorders the tracker for the rest of combat — it is not
 * a one-round delay. The new position persists because it is written to the
 * turn-order key rather than applied for a single round.
 */
export async function holdTurn(combatant) {
  const combat = combatant.parent;
  const all = [...combat.combatants].map(snapshot);

  const newOrder = INIT.holdTurnOrder(all, combatant.id);
  if (newOrder === null) {
    ui.notifications?.info(game.i18n.localize("LASTARC.Combat.HoldLast"));
    return null;
  }

  await combatant.setFlag(SYSTEM_ID, FLAG_ORDER, newOrder);
  await combatant.setFlag(SYSTEM_ID, FLAG_HELD, true);

  ChatMessage.create({
    content: `<p class="lastarc-applied"><strong>${combatant.name}</strong> — ` +
             `${game.i18n.localize("LASTARC.Combat.Held")}</p>`
  });

  await combat.setupTurns();
  return newOrder;
}

/**
 * Add a combatant mid-encounter (§8): they roll, then act after the current
 * highest-initiative combatant finishes.
 */
export async function joinCombat(combatant) {
  const combat = combatant.parent;
  const all = [...combat.combatants]
    .filter((c) => c.id !== combatant.id)
    .map(snapshot);

  await combat.rollInitiative([combatant.id]);
  await combatant.setFlag(SYSTEM_ID, FLAG_ORDER, INIT.joinCombatOrder(all));
  await combat.setupTurns();
}

/**
 * Roll group initiative (§8, GM option): one roll for the whole group, using the
 * LARGEST die among them — the group moves at the pace of its slowest member.
 */
export async function rollGroupInitiative(combatants) {
  if (!combatants.length) return null;

  const die = INIT.groupInitiativeDie(combatants.map(snapshot));
  const roll = new Roll(die.startsWith("d") ? `1${die}` : die);
  await roll.evaluate();

  const updates = combatants.map((c) => ({ _id: c.id, initiative: roll.total }));
  await combatants[0].parent.updateEmbeddedDocuments("Combatant", updates);

  await roll.toMessage({
    flavor: game.i18n.format("LASTARC.Combat.GroupInitiative", { die })
  });

  return roll.total;
}

/* -------------------------------------------------------------------------- */
/*  Action spending                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Spend an action for a combatant, honouring downgrades and the interrupt rule.
 *
 * @param {Combatant} combatant
 * @param {string} actionKey  Key into AE.ACTIONS.
 * @param {object} [options]
 * @param {string} [options.slot] Override the catalogue's slot for this one
 *   spend. Reload is the reason it exists: the book prices it as a secondary,
 *   Quick Reload makes it a minor and a Severed Arm makes it a primary, so the
 *   cost is a property of the CHARACTER and not of the action. Editing
 *   `ACTIONS.reload` per actor would be a global mutation; passing the answer
 *   in keeps the catalogue a constant.
 */
export async function spendAction(combatant, actionKey, { slot = null } = {}) {
  const catalogued = AE.ACTIONS[actionKey];
  if (!catalogued) throw new Error(`Unknown action: ${actionKey}`);

  const def = slot ? { ...catalogued, slot } : catalogued;

  const state = getTurnState(combatant);
  const flatFooted = combatant.actor?.statuses?.has("flatFooted") ?? false;

  if (def.slot === "reaction") {
    const result = AE.useReaction(state, { flatFooted });
    if (!result.ok) {
      ui.notifications?.warn(game.i18n.localize(result.reason));
      return null;
    }
    await setTurnState(combatant, result.state);
    return result;
  }

  const before = state.bankedMinors;
  const result = AE.spend(state, { type: def.slot, banks: def.banks ?? null });

  if (!result.ok) {
    ui.notifications?.warn(game.i18n.localize(result.reason));
    return null;
  }

  await setTurnState(combatant, result.state);

  // Tell the player when a sequence was broken. Silently zeroing two turns of
  // banked Recovery is the single most annoying way this could behave.
  if (before > 0 && result.state.bankedMinors === 0) {
    ui.notifications?.info(
      game.i18n.format("LASTARC.Action.SequenceInterrupted", { banked: before })
    );
  }

  return result;
}

/** Reset a combatant's turn state entirely, banked progress included. */
export async function resetActions(combatant) {
  await setTurnState(combatant, AE.createTurnState());
}
