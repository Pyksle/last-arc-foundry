/**
 * Chat card interactions for the combat pipeline.
 *
 * Buttons are wired through a single delegated listener on the chat log rather
 * than per-message handlers, so cards keep working after a page reload — a
 * per-message binding is lost when the log re-renders from the database.
 */

import { LASTARC } from "./config.mjs";
import {
  rollDamage, applyDamage, rollAttack, rollNpcAttack, rollNpcDamage
} from "./dice/attack.mjs";

export function registerChatListeners() {
  Hooks.on("renderChatMessageHTML", (message, element) => {
    element.querySelectorAll("[data-action^='lastarc']").forEach((button) => {
      button.addEventListener("click", (event) => onChatAction(event, message));
    });
  });
}

async function onChatAction(event, message) {
  event.preventDefault();
  const button = event.currentTarget;
  const action = button.dataset.action;

  try {
    switch (action) {
      case "lastarcRollDamage": return await onRollDamage(button, message);
      case "lastarcComboAttack": return await onComboAttack(button, message);
      case "lastarcApplyDamage": return await onApplyDamage(button);
    }
  } catch (err) {
    console.error("Last Arc | Chat action failed", err);
    ui.notifications?.error(err.message);
  }
}

/* -------------------------------------------------------------------------- */

function resolveActor(button) {
  const actor = game.actors.get(button.dataset.actorId);
  if (!actor) throw new Error(game.i18n.localize("LASTARC.Error.ActorGone"));
  return actor;
}

function resolveWeapon(actor, button) {
  const weapon = actor.items.get(button.dataset.weaponId);
  if (!weapon) throw new Error(game.i18n.localize("LASTARC.Error.WeaponGone"));
  return weapon;
}

/**
 * Read the statblock attack index off a button, or null for weapon attacks.
 *
 * Index 0 is a real attack — the FIRST one, which is the common case — so this
 * checks for the attribute's presence rather than the truthiness of its value.
 */
function attackIndexOf(button) {
  const raw = button.dataset.attackIndex;
  if (raw === undefined || raw === "") return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

async function onRollDamage(button, message) {
  const actor = resolveActor(button);
  const flags = message.flags?.["last-arc"] ?? {};
  const outcome = flags.outcome ?? { critical: button.dataset.critical === "true" };
  const index = attackIndexOf(button);

  if (index !== null) {
    const result = await rollNpcDamage(actor, index, { outcome });
    if (!result) return;
    return await postDamageCard({
      actor,
      name: actor.system.attacks[index]?.name,
      img: actor.img,
      result
    });
  }

  const weapon = resolveWeapon(actor, button);
  const result = await rollDamage(actor, weapon, {
    outcome,
    wield: flags.wield ?? "oneHanded",
    isMelee: flags.isMelee ?? true
  });

  await postDamageCard({ actor, name: weapon.name, img: weapon.img, result });
}

/**
 * A Combo is a free extra attack with the same weapon, target, bonuses and
 * penalties, and it can chain if it also rolls a natural 20 (§5.1).
 *
 * The chain is capped defensively — §15 A6 notes the book does not state a
 * limit, and an unbounded chain is a hang rather than a house rule.
 */
async function onComboAttack(button, message) {
  const actor = resolveActor(button);
  const flags = message.flags?.["last-arc"] ?? {};

  const cap = getSetting("maxComboChain", LASTARC.maxComboChain);
  const depth = (flags.comboDepth ?? 0) + 1;

  if (depth > cap) {
    ui.notifications?.warn(game.i18n.format("LASTARC.Warning.ComboCapped", { cap }));
    return;
  }

  const options = {
    ...(flags.attackOptions ?? {}),
    comboDepth: depth,
    isCharge: false   // a Combo attack is not itself a charge
  };

  const index = attackIndexOf(button);
  if (index !== null) return await rollNpcAttack(actor, index, options);

  await rollAttack(actor, resolveWeapon(actor, button), options);
}

async function onApplyDamage(button) {
  const total = Number(button.dataset.total);
  const type = button.dataset.damageType;

  const targets = [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean);
  if (!targets.length) {
    ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.NoTargets"));
    return;
  }

  const lines = [];
  for (const target of targets) {
    const result = await applyDamage(target, { total, type });
    lines.push(describeApplication(target, result));
  }

  await ChatMessage.create({
    content: `<div class="lastarc-card lastarc-card--applied">${lines.join("")}</div>`
  });
}

function describeApplication(target, result) {
  const bits = [];
  if (result.immune) {
    bits.push(game.i18n.localize("LASTARC.Card.Immune"));
  } else {
    bits.push(game.i18n.format("LASTARC.Card.Took", { amount: result.final }));
    if (result.absorbed) {
      bits.push(game.i18n.format("LASTARC.Card.TempAbsorbed", { amount: result.absorbed }));
    }
  }
  if (result.breaks) bits.push(game.i18n.localize("LASTARC.Card.BreakStep"));
  if (result.droppedToZero) bits.push(game.i18n.localize("LASTARC.Card.Downed"));

  return `<p class="lastarc-applied"><strong>${target.name}</strong> — ${bits.join(" · ")}</p>`;
}

async function postDamageCard({ actor, name, img, result }) {
  const critLabel = result.critMultiplier > 1
    ? game.i18n.format("LASTARC.Card.CritMultiplier", { n: result.critMultiplier })
    : null;

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/damage-card.hbs",
    {
      weaponName: name,
      weaponImg: img,
      total: result.total,
      results: result.results,
      parts: result.terms?.parts ?? [],
      capped: result.capped,
      damageType: result.damageType,
      damageTypeLabel: `LASTARC.DamageType.${result.damageType}`,
      critMultiplierLabel: critLabel
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { "last-arc": { type: "damage" } }
  });
}

function getSetting(key, fallback) {
  try {
    return game.settings.get("last-arc", key);
  } catch {
    return fallback;
  }
}
