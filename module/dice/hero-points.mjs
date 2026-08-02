/**
 * Hero point spending (§13).
 *
 * Four spends, all free actions usable once per turn and off-turn:
 *   1. reroll a d20
 *   2. add 1d6 to a d20 result
 *   3. add 1d6 to one defence until the start of your next turn
 *   4. prevent death (→ unconscious + Injury & Dismemberment roll)
 *
 * Hero-point bonus d6s EXPLODE (§13), which is why they go through the same
 * exploding roller as damage rather than being a plain 1d6. Grassrunners reroll
 * 1s on these dice.
 *
 * The misfortune curse blocks d20 rerolls specifically, and §12 calls out that
 * this interacts with hero points. Spend 1 is therefore gated.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";
import { rollExplodingDice } from "./explode.mjs";

/** Spend kinds, kept as constants so callers cannot typo them into no-ops. */
export const HERO_SPEND = {
  REROLL: "reroll",
  BONUS_ROLL: "bonusRoll",
  BONUS_DEFENCE: "bonusDefence",
  PREVENT_DEATH: "preventDeath"
};

/**
 * Can this actor spend a hero point at all, and on this particular kind?
 *
 * Returns a reason rather than a bare boolean so the UI can explain the refusal.
 * A greyed-out button with no explanation is how rules get argued about at the
 * table.
 *
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function canSpendHeroPoint(actor, kind) {
  const sys = actor.system;

  if ((sys.resources?.heroPoints?.value ?? 0) <= 0) {
    return { allowed: false, reason: "LASTARC.HeroPoint.None" };
  }

  if (kind === HERO_SPEND.REROLL && !D.canRerollD20(sys.statuses ?? {})) {
    return { allowed: false, reason: "LASTARC.HeroPoint.MisfortuneBlocks" };
  }

  return { allowed: true, reason: null };
}

/**
 * Roll a hero-point bonus die.
 *
 * @param {boolean} rerollOnes  Grassrunner trait: reroll 1s on these dice (§13).
 */
export async function rollHeroDie({ rerollOnes = false } = {}) {
  const result = await rollExplodingDice({ faces: 6, count: 1 });

  if (!rerollOnes || result.results[0]?.result !== 1) return result;

  // Reroll a 1 and keep the new result. This is the "keep second" kind (§12) —
  // it is a replacement, not a keep-higher, so a reroll into another 1 stands.
  const replacement = await rollExplodingDice({ faces: 6, count: 1 });
  return { ...replacement, rerolledFromOne: true };
}

/**
 * Spend a hero point to reroll a d20.
 *
 * @param {Roll} originalRoll
 * @param {"second"|"higher"|"lower"} kind  Which reroll semantics apply (§12).
 */
export async function heroPointReroll(actor, originalRoll, { kind = "second", mod = 0 } = {}) {
  const check = canSpendHeroPoint(actor, HERO_SPEND.REROLL);
  if (!check.allowed) {
    ui.notifications?.warn(game.i18n.localize(check.reason));
    return null;
  }

  const original = originalRoll.dice[0]?.results?.[0]?.result ?? 0;

  /**
   * Rolled WITH the modifier, not as a bare `1d20`.
   *
   * The reroll used to be a naked die, so its `total` was just the face — fine
   * for a card that only printed "you rolled a 17", useless for rebuilding an
   * attack card, where the total has to be the number compared against a
   * defence (#48). Both candidate rolls are now real, comparable rolls.
   */
  const reroll = new Roll("1d20 + @mod", { mod });
  await reroll.evaluate();
  const rerolled = reroll.dice[0]?.results?.[0]?.result ?? 0;

  const kept = D.resolveReroll(original, rerolled, kind);

  await spend(actor, 1);

  return {
    original, rerolled, kept, kind,
    // The reroll itself, for the plain card's "1d20 → 17" display.
    roll: reroll,
    /**
     * The roll that WON, as a real evaluated Roll. `resolveReroll` decides by
     * natural; whichever natural it picked, the caller needs that die's whole
     * roll — original included — or an attack card rebuilt from it would show
     * a total the dice never produced.
     */
    keptRoll: kept === rerolled ? reroll : originalRoll
  };
}

/**
 * Spend a hero point to add an exploding 1d6 to a d20 RESULT (§13).
 *
 * Distinct from the reroll: this keeps the original die and adds to it, so it
 * can rescue a roll that missed by a little without risking a worse one. It was
 * declared in HERO_SPEND from the start and never implemented — the enum
 * constant was referenced, so nothing flagged it as missing.
 */
export async function heroPointBonusRoll(actor, originalTotal, { rerollOnes = false } = {}) {
  const check = canSpendHeroPoint(actor, HERO_SPEND.BONUS_ROLL);
  if (!check.allowed) {
    ui.notifications?.warn(game.i18n.localize(check.reason));
    return null;
  }

  const die = await rollHeroDie({ rerollOnes });
  await spend(actor, 1);

  return { die, bonus: die.total, original: originalTotal, total: originalTotal + die.total };
}

/**
 * Spend a hero point to add an exploding 1d6 to a defence until the start of
 * your next turn.
 *
 * §15 A2: Break Threshold is DEFINED as Fortitude, so boosting Fortitude this
 * way also raises the Threshold if it is derived live — which it is. The
 * `heroPointAffectsThreshold` setting exposes that reading; when disabled the
 * bonus is recorded separately so Threshold can ignore it.
 */
export async function heroPointDefenceBoost(actor, defence, { rerollOnes = false } = {}) {
  const check = canSpendHeroPoint(actor, HERO_SPEND.BONUS_DEFENCE);
  if (!check.allowed) {
    ui.notifications?.warn(game.i18n.localize(check.reason));
    return null;
  }

  const die = await rollHeroDie({ rerollOnes });
  const affectsThreshold = getSetting("heroPointAffectsThreshold", true);

  // Recorded as an Active Effect on the misc slot, which the derivation reads
  // as an INPUT — see the note in character.mjs about why effects must not
  // target the computed fields directly.
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("LASTARC.HeroPoint.DefenceBoost", {
      defence: game.i18n.localize(`LASTARC.Defence.${defence}`),
      amount: die.total
    }),
    img: `systems/last-arc/assets/status/exhaustion.svg`,
    changes: [{
      key: `system.defences.${defence}.misc`,
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: String(die.total)
    }],
    duration: { rounds: 1 },
    flags: { "last-arc": { heroPointBoost: true, affectsThreshold } }
  }]);

  await spend(actor, 1);
  return { die, defence, affectsThreshold };
}

/**
 * Spend a hero point to prevent death (§5.6).
 *
 * The character survives, unconscious, and rolls on the Injury & Dismemberment
 * table — which is currently BLOCKED, see below.
 */
export async function heroPointPreventDeath(actor) {
  const check = canSpendHeroPoint(actor, HERO_SPEND.PREVENT_DEATH);
  if (!check.allowed) {
    ui.notifications?.warn(game.i18n.localize(check.reason));
    return null;
  }

  await spend(actor, 1);
  await actor.update({
    "system.resources.hp.value": 0,
    "system.breakGauge.step": LASTARC.BREAK_STEP_MAX
  });
  // The same trio §5.6 applies at 0 HP. `unconscious` was missing here while
  // the card said "Death prevented — unconscious", so the text and the token
  // badges disagreed.
  await actor.toggleStatusEffect?.("unconscious", { active: true });
  await actor.toggleStatusEffect?.("helpless", { active: true });
  await actor.toggleStatusEffect?.("prone", { active: true });

  /**
   * Roll the Injury & Dismemberment chart (book p.170).
   *
   * This used to REFUSE, because the transcribed table looked like three
   * overlapping `≤` bands with an uncovered 91–100. It is not a band table:
   * each row is an independent threshold on one roll, and they stack. See
   * `LASTARC.injuryTable`.
   */
  const roll = new Roll("1d100");
  await roll.evaluate();
  const results = D.resolveInjuryRoll(roll.total);

  for (const row of results) {
    if (row.status) {
      await actor.toggleStatusEffect?.(row.status, { active: true });
    }
    if (row.persistentCondition) {
      const sources = actor.system.toObject().breakGauge.persistentSources ?? [];
      await actor.update({
        "system.breakGauge.persistentSteps":
          Math.min(LASTARC.BREAK_STEP_MAX, actor.system.breakGauge.persistentSteps + 1),
        "system.breakGauge.persistentSources": [...sources, {
          id: `injury-${roll.total}-${sources.length}`,
          label: game.i18n.localize("LASTARC.Injury.injury"),
          clearedBy: game.i18n.localize("LASTARC.Injury.clearedByCare"),
          fromInjury: true
        }]
      });
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<div class="lastarc-card lastarc-card--injury">` +
      `<p class="lastarc-verdict lastarc-verdict--bad">` +
      `${game.i18n.localize("LASTARC.HeroPoint.DeathPrevented")}</p>` +
      `<p class="lastarc-card__natural">` +
      `${game.i18n.format("LASTARC.Injury.Rolled", { roll: roll.total })}</p>` +
      (results.length
        ? results.map((r) =>
            `<p class="lastarc-rider">${game.i18n.localize(r.label)}</p>`).join("")
        : `<p class="lastarc-note">${game.i18n.localize("LASTARC.Injury.None")}</p>`) +
      (results.some((r) => r.status)
        ? `<p class="lastarc-note">${game.i18n.localize("LASTARC.Injury.Permanent")}</p>`
        : "") +
      `</div>`,
    rolls: [roll]
  });

  return { prevented: true, injuryRoll: roll.total, injuries: results };
}

/* -------------------------------------------------------------------------- */

async function spend(actor, n = 1) {
  const current = actor.system.resources.heroPoints.value;
  await actor.update({ "system.resources.heroPoints.value": Math.max(0, current - n) });
}

function getSetting(key, fallback) {
  try {
    return game.settings.get("last-arc", key);
  } catch {
    return fallback;
  }
}
