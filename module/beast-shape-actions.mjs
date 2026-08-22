/**
 * Beast Shape, on the Foundry side.
 *
 * The arithmetic is in `beast-shape.mjs` and is unit tested; everything here is
 * marshalling — read the beast, call the maths, write the druid, post the card.
 *
 * WHY NO ACTIVE EFFECT IS APPLIED FOR THE LEVEL BONUS
 *
 * The bonus is "+1 to all defences, skills and damage rolls per level you
 * exceed the beast". Of those three, only defences can be expressed as an
 * Active Effect on an NPC: skills are a flat printed `{key, value}` array and
 * damage bonuses live per attack, neither of which an effect can target.
 *
 * Applying the third of it that CAN be automated is worse than applying none,
 * because a player who sees their Reflex already moved has every reason to
 * assume their skills moved too. So the card states the whole bonus, once,
 * plainly, and the player adds it.
 *
 * There is a second reason, and it is the one that would have caused real
 * trouble: a form points at the GM's bestiary entry, which is ONE document
 * shared by every token of that creature (CLAUDE.md §7). An effect written
 * there arms every wolf in the encounter with the druid's level bonus.
 */

import * as BS from "./beast-shape.mjs";

/** No form is active when the pointer is empty — see `isActiveForm`. */
const NO_FORM = Object.freeze({
  uuid: "", name: "", bonus: 0, duration: 0, expiresRound: 0,
  beastMaxHp: 0, beastMaxMp: 0
});

/**
 * Add a beast to this druid's repertoire.
 *
 * Refuses a duplicate rather than storing two entries for one creature: the
 * allowance is a count of FORMS, and a druid who learned the same wolf twice
 * would have spent half of theirs on nothing.
 *
 * Does NOT refuse when the allowance is full. The book says a druid who learns
 * one too many must replace an existing form, which is a choice the player
 * makes — so the sheet reports being over the limit, the way it reports being
 * over the trained-skill budget, and leaves the decision alone.
 */
export async function learnForm(actor, beast) {
  if (!actor || !beast) return null;

  const forms = actor.system.beastShape.forms.map((f) => ({ ...f }));
  const uuid = beast.uuid;
  if (forms.some((f) => f.uuid === uuid)) {
    ui.notifications?.warn(game.i18n.format("LASTARC.BeastShape.AlreadyKnown", { name: beast.name }));
    return null;
  }

  const read = BS.readBeast(beast.system);
  forms.push({
    uuid, name: beast.name, img: beast.img,
    level: read.level, maxHp: read.maxHp, maxMp: read.maxMp
  });

  await actor.update({ "system.beastShape.forms": forms });
  return forms;
}

/** Drop a form. Reverts first if it is the one being worn. */
export async function forgetForm(actor, uuid) {
  if (!actor || !uuid) return null;

  if (BS.isActiveForm(actor.system.beastShape.active, uuid)) await revertForm(actor);

  const forms = actor.system.beastShape.forms
    .filter((f) => f.uuid !== uuid)
    .map((f) => ({ ...f }));
  await actor.update({ "system.beastShape.forms": forms });
  return forms;
}

/**
 * Take a form.
 *
 * Refreshes the cached numbers from the live beast first. A form entry caches
 * the level and maxima so the sheet can draw without resolving an actor, and a
 * cache nothing refreshes is wrong by the third session — the beast gets
 * levelled, or its statblock finally gets filled in, and the druid is still
 * paying the old price.
 */
export async function transformInto(actor, uuid) {
  if (!actor || !uuid) return null;

  const sys = actor.system;
  if (sys.beastShape.active.uuid) {
    ui.notifications?.warn(game.i18n.localize("LASTARC.BeastShape.AlreadyShifted"));
    return null;
  }

  const stored = sys.beastShape.forms.find((f) => f.uuid === uuid);
  if (!stored) return null;

  const beast = await fromUuid(uuid);
  const live = beast ? BS.readBeast(beast.system) : null;
  const form = live
    ? { ...stored, name: beast.name, img: beast.img, ...live }
    : { ...stored };

  const result = BS.transformResult({
    hp: sys.resources.hp.value, mp: sys.resources.mp.value,
    hpMax: sys.resources.hp.max, mpMax: sys.resources.mp.max,
    beastMaxHp: form.maxHp, beastMaxMp: form.maxMp, beastLevel: form.level,
    druidLevel: sys.details.level, vitMod: sys.attributes.vit.mod
  });

  if (!result.affordable) {
    // The casting pipeline's own sentence, not a near-duplicate of it — a
    // second way to say "not enough mana" is a second thing to keep in step.
    ui.notifications?.warn(game.i18n.format("LASTARC.Warning.NotEnoughMana", {
      name: form.name, cost: result.cost, available: sys.resources.mp.value
    }));
    return null;
  }

  const expiresRound = BS.expiryRound(game.combat?.round ?? null, result.duration);

  /**
   * The active block keeps its OWN copy of the maxima it added.
   *
   * The revert cost must give back exactly what was granted. Read back off the
   * form entry instead, a GM who corrects the beast's statblock mid-encounter
   * would refund a different number from the one that was lent, and the druid
   * would gain or lose hit points from an edit nobody made to them.
   */
  await actor.update({
    "system.resources.hp.value": result.hp,
    "system.resources.mp.value": result.mp,
    "system.beastShape.forms": refreshed(sys.beastShape.forms, form),
    "system.beastShape.active": {
      uuid, name: form.name, bonus: result.bonus, duration: result.duration,
      expiresRound: expiresRound ?? 0,
      beastMaxHp: form.maxHp, beastMaxMp: form.maxMp
    }
  });

  await postCard(actor, {
    mode: "transform", form, result, expiresRound,
    hp: result.hp, mp: result.mp
  });
  return result;
}

/**
 * Return to your own shape, and pay for it.
 *
 * `reason` distinguishes a deliberate revert from the one the book forces when
 * a druid is dropped in beast form — the card says which, because a player
 * reading it later needs to know whether they chose this.
 */
export async function revertForm(actor, { reason = "chosen" } = {}) {
  if (!actor) return null;

  const sys = actor.system;
  const active = sys.beastShape.active;
  if (!active.uuid) return null;

  const result = BS.revertResult({
    hp: sys.resources.hp.value, mp: sys.resources.mp.value,
    beastMaxHp: active.beastMaxHp, beastMaxMp: active.beastMaxMp
  });

  await actor.update({
    "system.resources.hp.value": result.hp,
    "system.resources.mp.value": result.mp,
    "system.beastShape.active": { ...NO_FORM }
  });

  await postCard(actor, {
    mode: "revert", form: { name: active.name }, result, reason,
    hp: result.hp, mp: result.mp
  });
  return result;
}

/** The form list with one entry's cached numbers brought up to date. */
function refreshed(forms, form) {
  return forms.map((f) => (f.uuid === form.uuid ? { ...f, ...form } : { ...f }));
}

async function postCard(actor, { mode, form, result, expiresRound, reason, hp, mp }) {
  const transforming = mode === "transform";

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/last-arc/templates/chat/beast-shape-card.hbs",
    {
      transforming,
      actorName: actor.name,
      formName: form?.name ?? "",
      img: form?.img ?? actor.img,
      cost: result.cost,
      bonus: result.bonus,
      duration: result.duration,
      expiresRound: expiresRound || null,
      lostHp: result.lostHp,
      lostMp: result.lostMp,
      unconscious: !!result.unconscious,
      forced: reason === "forced",
      hp, mp,
      hpMax: actor.system.resources.hp.max,
      mpMax: actor.system.resources.mp.max
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { "last-arc": { type: "beastShape", mode, actorId: actor.id } }
  });
}
