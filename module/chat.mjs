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
import {
  canSpendHeroPoint, heroPointReroll, heroPointBonusRoll,
  heroPointPreventDeath, HERO_SPEND
} from "./dice/hero-points.mjs";

export function registerChatListeners() {
  Hooks.on("renderChatMessageHTML", (message, element) => {
    offerHeroReroll(message, element);

    element.querySelectorAll("[data-action^='lastarc']").forEach((button) => {
      button.addEventListener("click", (event) => onChatAction(event, message));
    });
  });
}

/**
 * Add a hero-point reroll button to any d20 result the viewer could spend on.
 *
 * Injected here rather than baked into each card template so it covers skill
 * checks, attribute checks, attacks and spells from one place — and so a future
 * roll type gets it for free instead of silently missing it.
 *
 * Deliberately NOT shown when it cannot be used: no hero points, the misfortune
 * curse forbidding d20 rerolls, or the roll already having been rerolled. A
 * button that explains its own refusal is better than one that lies, but a
 * button that cannot ever work is just noise.
 */
function offerHeroReroll(message, element) {
  const flags = message.flags?.["last-arc"] ?? {};
  const actor = game.actors.get(flags.actorId);
  if (!actor?.isOwner) return;
  if (flags.heroRerolled) return;
  if (!message.rolls?.[0]?.dice?.some((d) => d.faces === 20)) return;

  // Offer the panel if EITHER spend is available; misfortune blocks the reroll
  // but not the bonus roll, and suppressing both would quietly remove a legal
  // option from a cursed character.
  const canReroll = canSpendHeroPoint(actor, HERO_SPEND.REROLL).allowed;
  const canBonus = canSpendHeroPoint(actor, HERO_SPEND.BONUS_ROLL).allowed;
  if (!canReroll && !canBonus) return;

  const wrap = document.createElement("div");
  wrap.className = "lastarc-hero-spends";

  const make = (action, labelKey, tipKey) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lastarc-hero-reroll";
    b.dataset.action = action;
    b.dataset.actorId = actor.id;
    b.textContent = game.i18n.localize(labelKey);
    b.dataset.tooltip = game.i18n.localize(tipKey);
    return b;
  };

  if (canReroll) {
    wrap.appendChild(make("lastarcHeroReroll",
      "LASTARC.HeroPoint.Reroll", "LASTARC.HeroPoint.RerollTooltip"));
  }

  // The bonus roll is NOT blocked by misfortune — that curse forbids rerolling
  // a d20, and this keeps the die and adds to it.
  if (canBonus) {
    wrap.appendChild(make("lastarcHeroBonus",
      "LASTARC.HeroPoint.BonusRoll", "LASTARC.HeroPoint.BonusRollTooltip"));
  }

  element.querySelector(".message-content")?.appendChild(wrap);
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
      case "lastarcHeroReroll": return await onHeroReroll(button, message);
      case "lastarcHeroBonus": return await onHeroBonus(button, message);
      case "lastarcPreventDeath": return await onPreventDeath(button);
    }
  } catch (err) {
    console.error("Last Arc | Chat action failed", err);
    ui.notifications?.error(err.message);
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Spend a hero point to reroll the d20 in this message.
 *
 * The message is flagged as rerolled so the button cannot be used twice on the
 * same roll — a hero point buys one reroll, not a slot machine.
 */
async function onHeroReroll(button, message) {
  const actor = resolveActor(button);
  const original = message.rolls?.[0];
  if (!original) return;

  const result = await heroPointReroll(actor, original);
  if (!result) return;

  await message.setFlag("last-arc", "heroRerolled", true);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<div class="lastarc-card lastarc-card--hero">` +
      `<p class="lastarc-verdict">${game.i18n.format("LASTARC.HeroPoint.Rerolled", {
        original: result.original, rerolled: result.rerolled, kept: result.kept
      })}</p></div>`,
    rolls: [result.roll]
  });
}

/** Spend a hero point to add an exploding 1d6 to this roll's result. */
async function onHeroBonus(button, message) {
  const actor = resolveActor(button);
  const original = message.rolls?.[0]?.total;
  if (original == null) return;

  const result = await heroPointBonusRoll(actor, original);
  if (!result) return;

  await message.setFlag("last-arc", "heroRerolled", true);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<div class="lastarc-card lastarc-card--hero">` +
      `<p class="lastarc-verdict">${game.i18n.format("LASTARC.HeroPoint.BonusApplied", {
        bonus: result.bonus, original: result.original, total: result.total
      })}</p></div>`
  });
}

/**
 * Spend a hero point to prevent death.
 *
 * Offered from the damage-application card when a hit drops someone to 0, since
 * that is the only moment it is legal and the moment a player will want it.
 */
async function onPreventDeath(button) {
  const actor = resolveActor(button);
  await heroPointPreventDeath(actor);
  button.disabled = true;
}

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

  let line = `<p class="lastarc-applied"><strong>${target.name}</strong> — ${bits.join(" · ")}</p>`;

  // Prevent Death is only legal at the moment of dropping, and this is that
  // moment. Offering it here rather than on the sheet means a player does not
  // have to know the rule exists to be given the choice.
  if (result.droppedToZero && canSpendHeroPoint(target, HERO_SPEND.PREVENT_DEATH).allowed) {
    line += `<button type="button" data-action="lastarcPreventDeath" ` +
            `data-actor-id="${target.id}">` +
            `${game.i18n.localize("LASTARC.HeroPoint.PreventDeath")}</button>`;
  }

  return line;
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
