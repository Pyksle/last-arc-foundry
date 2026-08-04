/**
 * Ammunition against live documents — the Foundry half of `ammunition.mjs`.
 *
 * Every rule is next door and pure. What is here is the document work: which
 * quiver a weapon is drawing from, moving units between a stack and a magazine,
 * rolling the ammo die, and the two chat cards.
 *
 * ── Where the loaded state lives, and why it is a flag ──────────────────────
 *
 * A crossbow remembers which bolts are in it and how many are left. That is
 * per-weapon state, and the obvious home is the weapon's schema.
 *
 * It is a FLAG instead. `test/integrity` and the Quench field sweep both hold
 * item schemas to a rule with no exemptions — "every item field has an input,
 * and it must stay that way" — and neither of these two values is typeable. An
 * ammunition id is a document id; a magazine count is written by the Reload
 * action and by firing. Adding them to the schema would mean adding the first
 * two entries to an exemption map whose comment says it must stay empty, to
 * claim an input exists that never will.
 *
 * Combat state already lives in flags here for the same reason — the whole turn
 * economy is a combatant flag. A loaded magazine is that kind of state.
 *
 * ── setFlag MERGES ──────────────────────────────────────────────────────────
 *
 * The lesson #53 cost a playtest week. `setFlag` on an object merges key by
 * key, so a key you omit is RETAINED, not cleared. Every write below therefore
 * states every key, and the one place that genuinely needs a value to disappear
 * — clearing the encounter's spend — calls `unsetFlag` rather than writing an
 * empty object over it, because writing `{}` over `{abc: 6}` leaves `{abc: 6}`.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import * as AMMO from "../ammunition.mjs";
import { hasTechnickFlag } from "./attack.mjs";
import { spendAction } from "../combat.mjs";

const SYSTEM_ID = "last-arc";

/** Which ammunition a weapon is drawing from, and how many rounds are in it. */
const FLAG_LOADED = "loaded";

/** Units spent this encounter, keyed by ammunition item id. */
const FLAG_SPENT = "ammoSpent";

/* -------------------------------------------------------------------------- */
/*  Setting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The world's tracking mode.
 *
 * Falls back to `off` rather than throwing. This is read on every ranged attack
 * and inside sheet preparation, and a world whose setting has not registered
 * yet must render a sheet rather than fail to open one.
 */
export function ammoMode() {
  try {
    return game.settings.get(SYSTEM_ID, "ammoTracking");
  } catch {
    return "off";
  }
}

/** Is any ammunition tracking switched on at all? */
export function ammoTrackingOn() {
  return ammoMode() !== "off";
}

/* -------------------------------------------------------------------------- */
/*  Reading state                                                              */
/* -------------------------------------------------------------------------- */

/** @returns {{ammoId: string|null, count: number}} */
export function loadedAmmo(weapon) {
  const flag = weapon?.getFlag?.(SYSTEM_ID, FLAG_LOADED) ?? {};
  return { ammoId: flag.ammoId ?? null, count: Math.max(0, Number(flag.count) || 0) };
}

/** Write both keys, always — see the note on merging at the top of this file. */
export async function setLoadedAmmo(weapon, { ammoId = null, count = 0 } = {}) {
  return weapon.setFlag(SYSTEM_ID, FLAG_LOADED, {
    ammoId: ammoId ?? null,
    count: Math.max(0, Math.trunc(Number(count) || 0))
  });
}

/**
 * Ammunition in this actor's inventory that fits this weapon.
 *
 * An EMPTY `fits` fits everything. The field is a free-text comma box, so blank
 * means "nobody said", and reading it as "fits nothing" would make every
 * ammunition item a player created without filling that box invisible to the
 * reload picker — with no message, because there would be nothing to list.
 */
export function ammunitionFor(actor, weapon) {
  const category = weapon?.system?.category;
  return [...(actor?.items ?? [])].filter((item) => {
    if (item.type !== "ammunition") return false;
    const fits = item.system?.fits ?? [];
    return fits.length === 0 || fits.includes(category);
  });
}

/**
 * Everything the pure rules need about one weapon on one actor.
 *
 * One reader, so the sheet's readout, the attack's gate and the spend cannot
 * disagree about what is loaded — the same argument as `weaponProfileFor`.
 */
export function ammoContext(actor, weapon, { units = 1 } = {}) {
  const { ammoId, count } = loadedAmmo(weapon);

  // Resolved through the actor rather than trusted: an ammunition item the
  // player deleted leaves a live id in the flag, and a magazine whose contents
  // no longer exist must read as empty rather than as "8 of something".
  const ammo = ammoId ? (actor?.items?.get?.(ammoId) ?? null) : null;

  return {
    mode: ammoMode(),
    requiresAmmo: AMMO.requiresAmmunition(weapon?.system?.category),
    capacity: weapon?.system?.capacity ?? null,
    ammo,
    ammoId: ammo ? ammoId : null,
    loaded: ammo ? count : 0,
    stock: ammo?.system?.quantity ?? 0,
    die: ammo?.system?.ammoDie ?? AMMO.AMMO_EMPTY,
    units
  };
}

/**
 * May this attack be paid for? Returns the context too, so the caller does not
 * build it twice.
 */
export function checkAmmo(actor, weapon, { units = 1 } = {}) {
  const context = ammoContext(actor, weapon, { units });
  const verdict = AMMO.ammoCheck({ ...context, selected: !!context.ammoId });
  return { ...verdict, context };
}

/* -------------------------------------------------------------------------- */
/*  Firing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Spend the ammunition for one attack.
 *
 * Assumes `checkAmmo` has already passed — the caller has to gate BEFORE
 * rolling, so re-deciding here would be a second answer to a settled question.
 *
 * @returns {Promise<object|null>} a report for the attack card, or null when
 *   nothing was spent (tracking off, melee weapon, staff, nothing selected).
 */
export async function spendAmmo(actor, weapon, { units = 1 } = {}) {
  const context = ammoContext(actor, weapon, { units });
  if (context.mode === "off" || !context.requiresAmmo || !context.ammoId) return null;

  /**
   * The die is rolled HERE and handed to the pure function, rather than being
   * rolled inside it. A rules function that reaches for a random number is a
   * rules function no test can pin down.
   */
  let roll = null;
  if (context.mode === "die") {
    const formula = AMMO.ammoDieFormula(context.die);
    if (formula) roll = await new Roll(formula).evaluate();
  }

  const next = AMMO.ammoSpend({ ...context, dieRoll: roll?.total ?? null });

  // Magazine first: it is the value the next shot's gate reads.
  if (context.capacity != null) {
    await setLoadedAmmo(weapon, { ammoId: context.ammoId, count: next.loaded });
  }

  const updates = {};
  if (context.mode === "units" && context.capacity == null) {
    updates["system.quantity"] = next.stock;
  }
  if (context.mode === "die") updates["system.ammoDie"] = next.die;
  if (Object.keys(updates).length) await context.ammo.update(updates);

  /**
   * Recorded for Ammunition Recovery, which is a COUNTED-system rule.
   *
   * Under the ammo die the book replaces recovery with looting — "looting ammo
   * increases your die by 1 step" — so there is no tally to keep and half of
   * nothing is what recovery would offer. Recording it anyway would put a
   * Recover button on a card that could only ever hand back zero.
   */
  if (context.mode === "units") await recordSpend(actor, context.ammoId, next.spent);

  return {
    name: context.ammo.name,
    img: context.ammo.img,
    spent: next.spent,
    mode: context.mode,
    roll,
    dieBefore: context.die,
    dieAfter: next.die,
    shrank: next.shrank,
    threshold: next.threshold,
    exhausted: next.exhausted,
    capacity: context.capacity,
    loaded: context.capacity != null ? next.loaded : null,
    // What is left to draw on. The magazine for a crossbow, the quiver for a
    // bow, and nothing meaningful under the die — which reports its size.
    remaining: context.mode === "units"
      ? (context.capacity != null ? next.loaded : next.stock)
      : null
  };
}

/* -------------------------------------------------------------------------- */
/*  Reloading                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a reload costs this character, as an action slot.
 *
 * Reads `reloadStepIncrease` off the aggregated statuses rather than testing
 * for `severedArm` by name, so anything a GM writes carrying that key lands
 * too — and so the config entry that has held the value since the dismemberment
 * table was transcribed is finally read by something.
 */
export function reloadCost(actor) {
  const statuses = D.aggregateStatuses([...(actor?.statuses ?? [])]);
  return AMMO.reloadSlot({
    quickReload: hasTechnickFlag(actor, "quickReload"),
    stepIncrease: statuses.reloadStepIncrease
  });
}

/**
 * Reload, or — for a bow — choose which quiver to draw from.
 *
 * A BOW IS NOT RELOADED. The book's Reload action is worded "you may reload
 * ranged weapons WITH CAPACITY", and nocking an arrow is part of firing. So
 * picking ammunition for a bow moves nothing and costs nothing; it records
 * which of several arrow types the next shot spends. Charging a secondary
 * action for it would invent a rule and tax every archer's turn.
 */
export async function reloadWeapon(actor, weapon) {
  const mode = ammoMode();
  if (mode === "off") {
    ui.notifications?.info(game.i18n.localize("LASTARC.Ammo.TrackingOff"));
    return null;
  }
  if (!AMMO.requiresAmmunition(weapon?.system?.category)) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Ammo.NoAmmoNeeded", { weapon: weapon.name })
    );
    return null;
  }

  const options = ammunitionFor(actor, weapon);
  if (!options.length) {
    ui.notifications?.warn(
      game.i18n.format("LASTARC.Ammo.NoneCarried", { weapon: weapon.name })
    );
    return null;
  }

  const capacity = weapon.system.capacity ?? null;
  const current = loadedAmmo(weapon);
  const chosenId = await promptAmmunition({ actor, weapon, options, current, mode, capacity });
  if (!chosenId) return null;

  const chosen = actor.items.get(chosenId);
  if (!chosen) return null;

  /**
   * Pay for it BEFORE moving anything.
   *
   * `spendAction` refuses and warns when the slot is gone, and a reload that
   * was refused must not still have filled the magazine. Outside combat and for
   * bows there is nothing to pay.
   */
  if (capacity != null) {
    const combatant = game.combat?.getCombatantByActor?.(actor.id);
    if (combatant) {
      const spent = await spendAction(combatant, "reload", { slot: reloadCost(actor) });
      if (!spent) return null;
    }
  }

  const plan = AMMO.reloadPlan({
    mode,
    capacity,
    loaded: current.count,
    currentAmmoId: current.ammoId,
    ammoId: chosenId,
    stock: chosen.system.quantity ?? 0
  });

  /**
   * Unloading returns the rounds to the stack they came from.
   *
   * The book forbids mixing types in one weapon, which is a reason to take the
   * old bolts OUT — not a reason for them to cease to exist. Done before the
   * draw so that swapping back and forth between two stacks conserves them.
   */
  if (plan.returned > 0 && current.ammoId && current.ammoId !== chosenId) {
    const previous = actor.items.get(current.ammoId);
    if (previous) {
      await previous.update({
        "system.quantity": (previous.system.quantity ?? 0) + plan.returned
      });
    }
  }

  if (mode === "units" && plan.drawn > 0) {
    await chosen.update({
      "system.quantity": Math.max(0, (chosen.system.quantity ?? 0) - plan.drawn)
    });
  }

  await setLoadedAmmo(weapon, { ammoId: chosenId, count: plan.loaded });

  ui.notifications?.info(
    capacity == null
      ? game.i18n.format("LASTARC.Ammo.Selected", { ammo: chosen.name, weapon: weapon.name })
      : game.i18n.format("LASTARC.Ammo.Reloaded", {
        weapon: weapon.name, ammo: chosen.name, count: plan.loaded
      })
  );

  return { ammoId: chosenId, ...plan };
}

/** Pick an ammunition item, showing what each one has left. */
async function promptAmmunition({ actor, weapon, options, current, mode, capacity }) {
  const rows = options.map((item) => {
    const left = mode === "die"
      ? game.i18n.localize(`LASTARC.AmmoDie.${item.system.ammoDie}`)
      : game.i18n.format("LASTARC.Ammo.Units", { count: item.system.quantity ?? 0 });
    const selected = item.id === current.ammoId ? " selected" : "";
    return `<option value="${item.id}"${selected}>${foundry.utils.escapeHTML(item.name)} — ${left}</option>`;
  }).join("");

  const costLine = capacity == null
    ? game.i18n.localize("LASTARC.Ammo.SelectHint")
    : game.i18n.format("LASTARC.Ammo.ReloadHint", {
      capacity,
      slot: game.i18n.localize(`LASTARC.Slot.${reloadCost(actor)}`)
    });

  const result = await foundry.applications.api.DialogV2.prompt({
    window: {
      title: game.i18n.format(
        capacity == null ? "LASTARC.Ammo.SelectTitle" : "LASTARC.Ammo.ReloadTitle",
        { weapon: weapon.name }
      )
    },
    content: `
      <div class="la-situational">
        <p class="la-hint">${costLine}</p>
        <label>
          <span>${game.i18n.localize("LASTARC.Ammo.Ammunition")}</span>
          <select name="ammoId">${rows}</select>
        </label>
      </div>`,
    ok: {
      label: game.i18n.localize(
        capacity == null ? "LASTARC.Ammo.Select" : "LASTARC.Ammo.Reload"
      ),
      callback: (event, button) => button.form.elements.ammoId.value
    },
    rejectClose: false
  });

  return result ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Recovery and looting                                                       */
/* -------------------------------------------------------------------------- */

/** Units spent this encounter, keyed by ammunition item id. */
export function ammoSpentBy(actor) {
  return actor?.getFlag?.(SYSTEM_ID, FLAG_SPENT) ?? {};
}

async function recordSpend(actor, ammoId, units) {
  const spent = ammoSpentBy(actor);
  // A merge is what is wanted here: one key updated, the rest kept.
  return actor.setFlag(SYSTEM_ID, FLAG_SPENT, {
    ...spent, [ammoId]: (spent[ammoId] ?? 0) + units
  });
}

/**
 * What this actor could recover right now, resolved to live items.
 *
 * @returns {Array<{item: Item, units: number}>}
 */
export function recoverableFor(actor) {
  const recovered = AMMO.ammoRecovered(ammoSpentBy(actor));
  const rows = [];
  for (const [ammoId, units] of Object.entries(recovered)) {
    const item = actor?.items?.get?.(ammoId);
    // Spend against ammunition that has since been deleted recovers nothing.
    // There is nowhere to put it, and creating an item to hold it would be
    // inventing property the player threw away.
    if (item) rows.push({ item, units });
  }
  return rows;
}

/**
 * Ammunition Recovery: half of what was spent, rounded down, per type.
 *
 * Clears the encounter's tally whether or not anything came back, because the
 * tally is per encounter and a zero recovery still ends it.
 */
export async function recoverAmmunition(actor) {
  const rows = recoverableFor(actor);

  for (const { item, units } of rows) {
    await item.update({ "system.quantity": (item.system.quantity ?? 0) + units });
  }

  /**
   * `unsetFlag`, NOT `setFlag(..., {})`.
   *
   * Flags merge. Writing an empty object over `{abc: 6}` leaves `{abc: 6}`
   * untouched, and the recovery would then be claimable again after every
   * subsequent encounter, compounding. This is the same merge that made Dodge
   * once per combat (#53); it is written out here because the next person to
   * add a per-encounter tally will reach for `setFlag` first.
   */
  await actor.unsetFlag(SYSTEM_ID, FLAG_SPENT);

  return rows;
}

/**
 * Looting, under the ammo die: the stack goes up one step.
 *
 * The die system's answer to recovery. Capped at d12 by `growAmmoDie`.
 */
export async function lootAmmunition(item) {
  const next = AMMO.growAmmoDie(item.system.ammoDie);
  if (next === item.system.ammoDie) {
    ui.notifications?.info(game.i18n.format("LASTARC.Ammo.LootFull", { ammo: item.name }));
    return null;
  }
  await item.update({ "system.ammoDie": next });
  ui.notifications?.info(game.i18n.format("LASTARC.Ammo.Looted", {
    ammo: item.name, die: game.i18n.localize(`LASTARC.AmmoDie.${next}`)
  }));
  return next;
}

/* -------------------------------------------------------------------------- */
/*  Encounter lifecycle                                                        */
/* -------------------------------------------------------------------------- */

export function registerAmmunition() {
  /**
   * Offer recovery when the encounter ends.
   *
   * `deleteCombat` rather than a turn or round hook: "at the end of an
   * encounter" is exactly when the Combat document goes away, and it is the one
   * moment that fires once. A card rather than an automatic grant, because the
   * book says a player MAY recover — and because arrows fired into a river, or
   * into something that walked off with them, are a ruling the table makes.
   *
   * One GM posts it. Every connected client runs this hook, and without the
   * guard a four-player table gets four identical cards.
   */
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.users?.activeGM?.isSelf) return;
    if (ammoMode() !== "units") return;

    const rows = [];
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor) continue;
      // An unlinked token's actor is its own document (CLAUDE.md #7), so the
      // spend recorded during the fight belongs to THAT actor. Deduplicated by
      // document id rather than by name for the same reason.
      if (rows.some((r) => r.actorId === actor.id)) continue;

      const recoverable = recoverableFor(actor);
      if (!recoverable.length) continue;

      rows.push({
        actorId: actor.id,
        name: actor.name,
        items: recoverable.map((r) => ({ name: r.item.name, units: r.units }))
      });
    }

    if (!rows.length) return;

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/last-arc/templates/chat/ammo-recovery-card.hbs", { rows }
    );
    await ChatMessage.create({
      content, flags: { "last-arc": { type: "ammoRecovery" } }
    });
  });
}
