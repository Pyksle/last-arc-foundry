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
import { rollBlock, canBlock } from "./dice/block.mjs";
import { describeDamage } from "./dice/breakdown.mjs";

export function registerChatListeners() {
  Hooks.on("renderChatMessageHTML", (message, element) => {
    offerHeroReroll(message, element);
    offerBlock(message, element);
    markBlockedAttack(message, element);
    refreshBlockedAttack(message);

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

/**
 * Offer a Block to whoever is being attacked (book p.109, issue #12).
 *
 * Injected here rather than baked into the attack card for two reasons. The
 * card is rendered once by the ATTACKER and stored; the decision about who may
 * block depends on who is LOOKING at it, and that differs per client. And doing
 * it in one place covers spell cards too — a spell opposing Reflex is blockable
 * and a spell opposing Will is not, which the card itself has no reason to know.
 *
 * Not shown when it cannot be used. `canBlock` explains a missing shield or a
 * flat-footed defender, and those explanations are worth surfacing; but a
 * player who owns no shield at all should not see a Block button on every
 * attack for the rest of the campaign, so the no-shield case stays silent.
 */
function offerBlock(message, element) {
  const flags = message.flags?.["last-arc"] ?? {};
  if (flags.type !== "attack" && flags.type !== "spell") return;
  if (flags.targetsDefence !== "ref") return;
  if (flags.attackTotal == null) return;

  const defender = game.actors.get(flags.targetId);
  if (!defender?.isOwner) return;

  // Already answered — one block per triggering attack.
  if (blockFor(message)) return;

  const check = canBlock(defender);
  if (!check.shield) return;              // no shield: silence, not a dead button

  const button = document.createElement("button");
  button.type = "button";
  button.className = "lastarc-block-offer";
  button.dataset.action = "lastarcBlock";
  button.dataset.actorId = defender.id;
  button.textContent = game.i18n.format("LASTARC.Block.Offer", { shield: check.shield.name });

  if (!check.allowed) {
    button.disabled = true;
    button.dataset.tooltip = game.i18n.localize(check.reason);
  } else {
    button.dataset.tooltip = game.i18n.localize("LASTARC.Block.OfferTooltip");
  }

  element.querySelector(".message-content")?.appendChild(button);
}

/**
 * Strike through an attack that was subsequently blocked.
 *
 * Computed on every client from a LATER block message rather than by editing
 * the attack message, because the defender does not own the attacker's chat
 * message and could not write to it. Every client reaches the same answer from
 * the same log, so nobody needs permission to keep the card honest.
 */
function markBlockedAttack(message, element) {
  const flags = message.flags?.["last-arc"] ?? {};
  if (flags.type !== "attack" && flags.type !== "spell") return;

  const block = blockFor(message);
  if (!block?.flags?.["last-arc"]?.blocked) return;

  element.querySelector(".lastarc-card")?.classList.add("is-blocked");
  element.querySelectorAll("[data-action='lastarcRollDamage']").forEach((b) => {
    b.disabled = true;
    b.dataset.tooltip = game.i18n.localize("LASTARC.Block.DamageBlocked");
  });
}

/**
 * When a block card arrives, redraw the attack it answered.
 *
 * Foundry renders a chat message once and leaves it alone, so without this the
 * strike-through above would not appear until the log was rebuilt — which for a
 * player means "not this session". Doing it from the BLOCK card's own render
 * means every client fixes its own copy as the card lands, with no socket and
 * no permission to edit someone else's message.
 *
 * No recursion: re-rendering the attack does not re-render the block.
 */
function refreshBlockedAttack(message) {
  const flags = message.flags?.["last-arc"] ?? {};
  if (flags.type !== "block" || !flags.blocksMessageId) return;

  const attack = game.messages?.get(flags.blocksMessageId);
  if (attack) ui.chat?.updateMessage?.(attack);
}

/**
 * The block message answering this one, if any.
 *
 * Walks backward from the end of the log and stops early: a chat log runs to
 * thousands of messages over a campaign and a full scan on every render would
 * be felt. A block always follows its attack closely, so the window is small.
 */
function blockFor(message) {
  const messages = game.messages?.contents ?? [];
  const start = Math.max(0, messages.length - BLOCK_SEARCH_WINDOW);
  for (let i = messages.length - 1; i >= start; i--) {
    const f = messages[i].flags?.["last-arc"];
    if (f?.type === "block" && f.blocksMessageId === message.id) return messages[i];
  }
  return null;
}

/** How far back to look for a block answering an attack. */
const BLOCK_SEARCH_WINDOW = 50;

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
      case "lastarcBlock": return await onBlock(button, message);
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

/**
 * Block the attack in this message.
 *
 * Disabled immediately: the roll is asynchronous, and a second click before it
 * settles would spend a second reaction against the same trigger, which is
 * exactly what "once per triggering action" forbids.
 */
async function onBlock(button, message) {
  const actor = resolveActor(button);
  const flags = message.flags?.["last-arc"] ?? {};
  button.disabled = true;

  await rollBlock(actor, {
    attackTotal: flags.attackTotal,
    attackerName: flags.attackerName ?? null,
    sourceMessageId: message.id
  });
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

  /**
   * How the attack was made, read back off the card.
   *
   * These used to default silently to a one-handed melee swing whenever the
   * flags were absent — and they were ALWAYS absent, because nothing wrote
   * them. Every damage roll from a chat card resolved as one-handed melee: no
   * two-handed Strength doubling, no Weapon Finesse, and Strength added to
   * crossbows and staves. The attack roll was correct throughout, so it looked
   * like a damage bug rather than a plumbing one.
   *
   * A card written before 0.18.1 genuinely has no flags to read, so the
   * fallback stays — but it says so now instead of quietly inventing a grip.
   */
  const wield = flags.wield ?? null;
  const isMelee = flags.isMelee ?? null;
  if (wield === null || isMelee === null) {
    console.warn(`Last Arc | This attack card predates 0.18.1 and does not record how ` +
      `the attack was made; damage is being resolved as a one-handed melee attack. ` +
      `Re-roll the attack for correct damage.`);
  }

  const result = await rollDamage(actor, weapon, {
    outcome,
    wield: wield ?? "oneHanded",
    isMelee: isMelee ?? true
  });

  // Null means the damage-type picker was dismissed. Posting a card anyway
  // would announce a hit that the player just backed out of.
  if (!result) return;

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
  const rolled = Number(button.dataset.total);
  const type = button.dataset.damageType;
  // Rounded down, matching how resistance halves in applyDamageMitigation.
  const half = button.dataset.half === "true";
  const total = half ? Math.floor(rolled / 2) : rolled;
  // `faces` is absent on cards posted before 0.11.0 and on odd formulas the
  // dice parser could not read; applyDamage says so rather than skipping.
  const faces = Number(button.dataset.faces) || null;

  const targets = [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean);
  if (!targets.length) {
    ui.notifications?.warn(game.i18n.localize("LASTARC.Warning.NoTargets"));
    return;
  }

  const lines = [];
  for (const target of targets) {
    const result = await applyDamage(target, { total, type, faces });
    lines.push(describeApplication(target, result));
  }

  await ChatMessage.create({
    content: `<div class="lastarc-card lastarc-card--applied">${lines.join("")}</div>`
  });
}

/**
 * The arithmetic between the rolled number and the hit points lost (issue #26).
 *
 * Reported as: attacking a drenched target with electric, "I think the extra
 * damage is occurring, but I can't see what that damage information is". It
 * was occurring. `applyDamage` has returned the bonus roll since 0.11.0 and
 * NOTHING RENDERED IT — the same orphan pattern as the payload it was added to
 * fix, one layer up. A number that arrives with no working is indistinguishable
 * from a wrong number, so the whole chain is stated: what was rolled, what the
 * target's statuses added, what its weakness or resistance did, what DR took
 * off, and what temporary hit points absorbed.
 */
function describeArithmetic(result) {
  const steps = [];

  if (result.bonus?.results?.length) {
    const dice = result.bonus.results.map((r) => r.result).join(", ");
    steps.push(game.i18n.format("LASTARC.Card.StatusDice", {
      n: result.bonus.results.length, dice, total: result.bonus.total
    }));
  }
  // preDR is after weakness/resistance and before reduction, so the gap on
  // either side names the two steps without either needing to be passed out.
  if (result.preDR !== undefined && result.postDR !== undefined
      && result.preDR !== result.postDR) {
    steps.push(game.i18n.format("LASTARC.Card.AfterDR", {
      before: result.preDR, after: result.postDR
    }));
  }
  if (result.absorbed) {
    steps.push(game.i18n.format("LASTARC.Card.TempAbsorbed", { amount: result.absorbed }));
  }

  return steps.length
    ? `<p class="lastarc-calc"><span class="lastarc-calc__sum">${steps.join(" → ")}</span></p>`
    : "";
}

function describeApplication(target, result) {
  const bits = [];
  if (result.immune) {
    bits.push(game.i18n.localize("LASTARC.Card.Immune"));
  } else {
    bits.push(game.i18n.format("LASTARC.Card.Took", { amount: result.final }));
  }
  if (result.breaks) bits.push(game.i18n.localize("LASTARC.Card.BreakStep"));
  if (result.droppedToZero) bits.push(game.i18n.localize("LASTARC.Card.Downed"));

  let line = `<p class="lastarc-applied"><strong>${target.name}</strong> — ${bits.join(" · ")}</p>`;
  line += describeArithmetic(result);

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
      breakdown: describeDamage(result),
      capped: result.capped,
      damageType: result.damageType,
      damageTypeLabel: `LASTARC.DamageType.${result.damageType}`,
      critMultiplierLabel: critLabel,
      // Carried so a drenched or oiled target can roll its bonus dice at the
      // die size that was actually used (issue #17).
      faces: result.faces ?? null
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
