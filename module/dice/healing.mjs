/**
 * Healing (issue #11: "when healing there is no calculation listed").
 *
 * It was worse than that. `healing` was a field on spell outcomes and on
 * consumables, editable on both sheets, and NOTHING ever read it — the classic
 * defect in this repo: correct, stored, and wired to nothing. So a cure spell
 * rolled its Spellcraft check, announced a tier, and healed no one.
 *
 * The card shows the whole sum rather than a bare total, because a heal has
 * three interesting numbers and only one of them is "how much you rolled": what
 * was rolled, what actually landed, and what was thrown away against the
 * maximum. The last of those decides whether the potion was worth drinking.
 */

import * as D from "../derivation.mjs";
import { rollDamageDice } from "./explode.mjs";

/**
 * Roll a healing formula and apply it.
 *
 * Healing dice do NOT explode: exploding dice are a damage rule (§5.3), and
 * nothing in the healing rules invokes them. Passing an explosion multiplier of
 * 1 keeps the shared roller's parsing and dice-cap safety without borrowing the
 * behaviour.
 *
 * @param {Actor} target
 * @param {object} options
 * @param {string} options.formula   e.g. "2d8+4"
 * @param {string} [options.sourceName]  what did the healing, for the card
 * @param {string} [options.sourceImg]
 * @param {Actor}  [options.healer]  speaker for the card; defaults to the target
 * @param {boolean} [options.post]   post a chat card (default true)
 */
export async function rollHealing(target, {
  formula, sourceName = null, sourceImg = null, healer = null, post = true
} = {}) {
  if (!formula) return null;

  const rolled = await rollDamageDice({
    diceFormula: formula, critMultiplier: 1, explosionMultiplier: 1, flat: 0
  });

  return await applyHealing(target, {
    amount: rolled.total,
    dice: rolled.results ?? [],
    formula,
    sourceName,
    sourceImg,
    healer,
    post
  });
}

/**
 * Apply a fixed amount of healing.
 *
 * Separate from `rollHealing` because Second Wind heals a computed amount with
 * no dice at all, and it needs the same card — a player asking "why did that
 * only give me 6?" is asking about the maximum, not about the roll.
 */
export async function applyHealing(target, {
  amount, dice = [], formula = null, sourceName = null, sourceImg = null,
  healer = null, post = true
} = {}) {
  const sys = target.system;
  const hp = sys.resources?.hp ?? sys.hp;
  if (!hp) return null;

  // Zombified inverts healing into unaspected damage (§12). Aggregated from the
  // actor's live status set rather than read off `system.statuses`, because
  // only the character model computes that — an NPC would silently miss the
  // inversion. And aggregated rather than checked by id, so any future status
  // carrying the same payload behaves the same way.
  const becomesDamage = !!D.aggregateStatuses([...(target.statuses ?? [])]).healingBecomesDamage;

  const result = D.resolveHealing({
    amount, current: hp.value, max: hp.max, becomesDamage
  });

  await target.update({ "system.resources.hp.value": result.newHp });

  if (post) {
    await postHealingCard({
      target, healer, result, amount, dice, formula, sourceName, sourceImg
    });
  }

  return result;
}

async function postHealingCard({
  target, healer, result, amount, dice, formula, sourceName, sourceImg
}) {
  const hp = target.system.resources.hp;

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/healing-card.hbs",
    {
      sourceName: sourceName ?? game.i18n.localize("LASTARC.Card.Healing"),
      sourceImg: sourceImg ?? target.img,
      targetName: target.name,
      formula,
      dice,
      rolled: amount,
      applied: Math.abs(result.applied),
      wasted: result.wasted || null,
      inverted: result.inverted,
      hpValue: hp.value,
      hpMax: hp.max,
      // The sum, spelled out, for the tooltip on the big number.
      breakdown: result.inverted
        ? game.i18n.format("LASTARC.Card.HealInvertedSum", { rolled: amount })
        : game.i18n.format("LASTARC.Card.HealSum", {
            rolled: amount,
            applied: result.applied,
            wasted: result.wasted,
            max: hp.max
          })
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: healer ?? target }),
    content,
    flags: { "last-arc": { type: "healing", actorId: target.id } }
  });
}
