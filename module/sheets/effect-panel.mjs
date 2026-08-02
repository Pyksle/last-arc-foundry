/**
 * The Effects panel, shared by both actor sheets (#20 slice C).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Slice B taught performances to put a real Active Effect on every targeted
 * ally, and the hero point defence boost has created one since it was written.
 * Neither could be SEEN. This system replaces Foundry's actor sheet, and
 * Foundry's effects tab went with it, so the only UI that touched effects was
 * the status palette — which only handles effects carrying a status id.
 *
 * The consequences were concrete rather than theoretical:
 *
 *   - a performance buff out of combat has no round to count and, by design,
 *     "stays until removed" — with nothing anywhere able to remove it;
 *   - an effect whose change points at a derived path does nothing at all, and
 *     the GM had no way to find out which of their effects those were;
 *   - the hero point defence boost drew the EXHAUSTION icon on the token of a
 *     character who had just spent a point to get BETTER.
 *
 * ── Shared, not duplicated ──────────────────────────────────────────────────
 *
 * Both sheets need identical behaviour here, and #44 was about what happens
 * when two sheets each keep their own copy of the same decision. The handlers
 * on the sheets are one line each; everything they do is in this file.
 */

import { LASTARC } from "../config.mjs";
import {
  effectRows, customEffectTargets, scopeTargets, buildDuration, supportsSkillEffects
} from "../effects.mjs";

const FLAG = "last-arc";

/**
 * Rows for the panel, in the shape the template renders.
 *
 * `isStatus` is resolved here because it needs the document; `effectRows`
 * filters on it and stays Foundry-free.
 */
export function effectPanelRows(actor, localize = (k) => k) {
  const snapshots = [...(actor?.effects ?? [])].map((e) => ({
    id: e.id,
    name: e.name,
    img: e.img,
    disabled: e.disabled,
    changes: e.changes,
    isStatus: (e.statuses?.size ?? 0) > 0,
    /**
     * Foundry's own duration wording, not ours. It knows the combat, the round
     * it started, and how many turns are left; a second implementation here
     * would be a second opinion about when a buff ends.
     */
    durationLabel: e.duration?.duration ? e.duration.label : null,
    source: e.sourceName && e.sourceName !== "None" ? e.sourceName : null
  }));

  return effectRows(snapshots, { localize, actorType: actor?.type ?? null });
}

/**
 * Build a custom effect from the curated scope list.
 *
 * A SCOPE picker rather than a free-text path box, which is how most systems do
 * this. Here a path box would be a trap: forty of the paths a GM would reach
 * for first — maximum HP, a defence total, damage reduction, Break Threshold —
 * are assigned by `prepareDerivedData` AFTER effects apply, so an effect
 * pointing at one is overwritten before anyone reads it. The box would accept
 * them, the effect would appear on the sheet, and nothing would happen.
 *
 * @returns {Promise<ActiveEffect|null>}
 */
export async function promptCreateEffect(actor) {
  const targets = customEffectTargets(actor?.type ?? "character");

  // Grouped, in the order the groups are declared, so the list reads like the
  // sheet rather than like the config object's iteration order.
  const byGroup = new Map();
  for (const key of Object.keys(LASTARC.effectTargetGroups)) byGroup.set(key, []);
  for (const t of targets) byGroup.get(t.group)?.push(t);

  const optgroups = [...byGroup.entries()]
    .filter(([, rows]) => rows.length)
    .map(([group, rows]) =>
      `<optgroup label="${game.i18n.localize(LASTARC.effectTargetGroups[group].label)}">` +
      rows.map((r) =>
        `<option value="${r.scope}">${game.i18n.localize(r.label)}</option>`).join("") +
      `</optgroup>`)
    .join("");

  const L = (k) => game.i18n.localize(k);

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: L("LASTARC.Dialog.CreateEffect.title") },
    content:
      `<p>${L("LASTARC.Dialog.CreateEffect.content")}</p>` +
      `<label>${L("LASTARC.Dialog.CreateEffect.name")}` +
      `<input type="text" name="name" autofocus></label>` +
      `<label>${L("LASTARC.Dialog.CreateEffect.target")}` +
      `<select name="scope">${optgroups}</select></label>` +
      `<label>${L("LASTARC.Dialog.CreateEffect.value")}` +
      `<input type="number" name="value" value="1" step="1"></label>` +
      `<label>${L("LASTARC.Dialog.CreateEffect.rounds")}` +
      `<input type="number" name="rounds" value="0" min="0" step="1"></label>` +
      `<p class="la-note">${L("LASTARC.Dialog.CreateEffect.roundsHint")}</p>` +
      (supportsSkillEffects(actor?.type)
        ? ""
        : `<p class="la-note">${L("LASTARC.EffectTarget.noStatblockSkills")}</p>`),
    ok: {
      label: L("LASTARC.Dialog.CreateEffect.submit"),
      callback: (event, button) => ({
        name: button.form.elements.name.value.trim(),
        scope: button.form.elements.scope.value,
        value: Number(button.form.elements.value.value) || 0,
        rounds: Math.max(0, Number(button.form.elements.rounds.value) || 0)
      })
    },
    rejectClose: false
  });

  if (!result?.scope) return null;

  const { paths, reason } = scopeTargets(result.scope, actor.type);
  if (!paths.length) {
    // Only reachable if the config and the picker disagree. Say so rather than
    // creating an effect with no changes, which would sit on the sheet looking
    // like it worked.
    ui.notifications?.warn(game.i18n.localize(reason ?? "LASTARC.EffectTarget.unknownScope"));
    return null;
  }

  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: result.name || game.i18n.localize("LASTARC.Effect.Custom"),
    // No `img`: Foundry's own default is neutral. Reaching for a status icon is
    // how a hero point BOOST came to draw the Exhaustion badge on a token.
    changes: paths.map((key) => ({
      key,
      // ADD, matching every other effect this system makes. The `misc` slots
      // are sums by construction, so OVERRIDE would silently erase whatever
      // else is already there.
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: String(result.value),
      priority: 20
    })),
    duration: buildDuration(result.rounds),
    flags: { [FLAG]: { custom: true } }
  }]);

  return effect ?? null;
}

/** Open Foundry's own effect config, which can edit anything this cannot. */
export function editEffect(actor, id) {
  actor?.effects?.get(id)?.sheet?.render(true);
}

/** Suspend an effect without losing it — the GM's undo for a mistaken buff. */
export async function toggleEffect(actor, id) {
  const effect = actor?.effects?.get(id);
  if (!effect) return null;
  return effect.update({ disabled: !effect.disabled });
}

export async function deleteEffect(actor, id) {
  const effect = actor?.effects?.get(id);
  if (!effect) return null;
  return actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
}
