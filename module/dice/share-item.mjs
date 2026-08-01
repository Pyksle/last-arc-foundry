/**
 * Posting an owned item to chat.
 *
 * Issue #2: "I can't put my talent in the chat for other people to review."
 * Correct — weapons, spells and performances all had a click-to-use button
 * that produced a card, and technicks, talents, race and class items had no
 * chat output whatsoever. They rendered on the sheet and stopped there, so
 * there was no way to show the table what an ability actually does.
 *
 * This is a READOUT, not a roll. Nothing is resolved, nothing is spent, and the
 * card deliberately carries no total — sharing a talent must never look like
 * using one.
 */

import { LASTARC } from "../config.mjs";
import * as D from "../derivation.mjs";

/** Human-readable prerequisite lines, each flagged met or unmet. */
function prerequisiteLines(item, actor) {
  const p = item.system?.prerequisites;
  if (!p) return { lines: [], unmet: false };

  const snapshot = actor?.system?.prerequisiteSnapshot?.();
  const check = snapshot ? D.checkPrerequisites(p, snapshot) : null;
  const unmetSet = new Set(check?.unmet ?? []);

  const lines = [];
  const add = (text) => lines.push({ text, met: !unmetSet.has(text) });

  // A zero minimum is not a requirement (issue #15). Blank number boxes on the
  // item sheet used to store 0 rather than nothing, so a technick nobody had
  // set a prerequisite on shared to chat carrying six of them — "Str 0, Vit 0,
  // Agi 0…". Filtered here as well as at the source, because worlds already
  // hold the zeros and a display fix needs no migration.
  for (const [attr, min] of Object.entries(p.attributes ?? {})) {
    if (!min) continue;
    add(`${game.i18n.localize(LASTARC.attributes[attr]?.abbr ?? attr)} ${min}`);
  }
  if (p.characterLevel) add(`${game.i18n.localize("LASTARC.Field.Level")} ${p.characterLevel}`);
  if (p.classLevel) add(`${game.i18n.localize("LASTARC.Field.ClassLevelReq")} ${p.classLevel}`);
  for (const t of p.technicks ?? []) add(t);
  for (const t of p.talents ?? []) add(t);
  for (const s of p.trainedSkills ?? []) {
    add(game.i18n.localize(LASTARC.allSkills[s]?.label ?? s));
  }

  // `unmet` comes from checkPrerequisites rather than from the lines above:
  // the line text is for display and may not match the checker's phrasing, and
  // a mismatch must not silently read as "all met".
  return { lines, unmet: !!check && !check.met };
}

/** One-line summary of a grants block, matching the sheet's shorthand. */
function grantSummary(grants) {
  if (!grants) return "";
  const parts = [];
  const sign = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

  for (const key of ["ref", "fort", "will"]) {
    if (grants.defences?.[key]) {
      parts.push(`${sign(grants.defences[key])} ${game.i18n.localize(`LASTARC.Defence.${key}`)}`);
    }
  }
  if (grants.breakThreshold) parts.push(`${sign(grants.breakThreshold)} Threshold`);
  if (grants.hp) parts.push(`${sign(grants.hp)} HP`);
  if (grants.mp) parts.push(`${sign(grants.mp)} MP`);
  if (grants.dr) parts.push(`${sign(grants.dr)} DR`);
  if (grants.heroPoints) parts.push(`${sign(grants.heroPoints)} Hero Points`);
  if (grants.initiativeSteps) parts.push(`Init −${grants.initiativeSteps} step`);
  if (grants.speed) parts.push(`${sign(grants.speed)} Speed`);
  if (grants.secondWindUses) parts.push(`${sign(grants.secondWindUses)} Second Wind`);
  for (const s of grants.skills ?? []) {
    const label = game.i18n.localize(LASTARC.allSkills[s.key]?.label ?? s.key);
    if (s.focus) parts.push(`${sign(s.focus)} ${label} focus`);
    if (s.bonus) parts.push(`${sign(s.bonus)} ${label}`);
    if (s.trained) parts.push(`trained: ${label}`);
  }
  return parts.join(" · ");
}

/**
 * Post an item to chat as a readable card.
 *
 * @param {Item} item   The item to share. Any subtype.
 * @returns {Promise<ChatMessage|null>}
 */
export async function shareItem(item) {
  if (!item) return null;
  const actor = item.parent;

  const { lines, unmet } = prerequisiteLines(item, actor);

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/item-card.hbs",
    {
      name: item.name,
      img: item.img,
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      kindLabel: item.system?.tree || null,
      summary: grantSummary(item.system?.grants),
      prerequisites: lines,
      unmet,
      // Enriched so @UUID links and inline rolls a player typed into the
      // description resolve in chat the same way they do on the sheet.
      description: await foundry.applications.ux.TextEditor.implementation
        .enrichHTML(item.system?.description ?? "", { relativeTo: item })
    }
  );

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: actor ?? undefined }),
    content
  });
}
