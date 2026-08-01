/**
 * Where hand-authored content lives.
 *
 * This system ships no game content and never will — the rulebook is not ours
 * to distribute — so every table types its own in from its own copy. For seven
 * releases the obvious home for that work was a set of ten empty compendium
 * packs the system declared: Races, Spells, Bestiary and so on.
 *
 * THAT DESTROYED PEOPLE'S WORK. A system's packs live inside the system folder,
 * and Foundry replaces that entire folder when it updates a system. So every
 * release wiped everything anyone had put in them, and the empty packs were an
 * invitation to put the work exactly where it would be destroyed. Reported
 * after a playtest as "when we update, all of the compendium things we make get
 * overwritten".
 *
 * The declarations are gone. This builds the same organised set as WORLD
 * compendiums instead, which live in the world folder and are never touched by
 * a system update.
 */

import { LASTARC } from "./config.mjs";

const SYSTEM_ID = "last-arc";
const NOTICE_FLAG = "contentHomeNoticeSeen";

/**
 * The set the system used to declare, rebuilt where it is safe.
 *
 * Same names and the same split, so anyone who had the old ones finds what they
 * expect. Labels are prefixed because a world compendium sits in the same list
 * as every other package's, and "Spells" alone is ambiguous once a second
 * system is installed.
 */
const SETS = [
  { key: "races", label: "Races", type: "Item" },
  { key: "classes", label: "Classes", type: "Item" },
  { key: "technicks", label: "Technicks", type: "Item" },
  { key: "talents", label: "Talents", type: "Item" },
  { key: "weapons", label: "Weapons", type: "Item" },
  { key: "armour", label: "Armour & Shields", type: "Item" },
  { key: "equipment", label: "Accessories & Consumables", type: "Item" },
  { key: "spells", label: "Spells", type: "Item" },
  { key: "performances", label: "Performances", type: "Item" },
  { key: "bestiary", label: "Bestiary", type: "Actor" }
];

const labelFor = (label) => `Last Arc — ${label}`;

/** Every world compendium this system would have created. */
function existingWorldPacks() {
  const wanted = new Set(SETS.map((s) => labelFor(s.label)));
  return game.packs.filter(
    (p) => p.metadata.packageType === "world" && wanted.has(p.metadata.label)
  );
}

/**
 * Create the standard compendium set in the WORLD.
 *
 * Idempotent: a pack that already exists is left alone rather than duplicated,
 * so a GM can run this again after adding a set without losing anything.
 *
 * @returns {Promise<{created: string[], existing: string[]}>}
 */
export async function createWorldCompendiums() {
  if (!game.user.isGM) {
    ui.notifications?.warn(game.i18n.localize("LASTARC.Content.GMOnly"));
    return { created: [], existing: [] };
  }

  // v13 moved this under foundry.documents.collections and left a global shim.
  // Take whichever exists rather than betting on one — this system has already
  // been bitten once by asserting a Foundry internal it had not checked.
  const CompendiumCls =
    foundry?.documents?.collections?.CompendiumCollection ??
    globalThis.CompendiumCollection;

  if (!CompendiumCls) {
    ui.notifications?.error("Last Arc | Cannot find CompendiumCollection.");
    return { created: [], existing: [] };
  }

  const created = [];
  const existing = [];

  for (const set of SETS) {
    const label = labelFor(set.label);
    const found = game.packs.find(
      (p) => p.metadata.packageType === "world" && p.metadata.label === label
    );
    if (found) {
      existing.push(label);
      continue;
    }
    await CompendiumCls.createCompendium({ label, type: set.type });
    created.push(label);
  }

  ui.notifications?.info(
    game.i18n.format("LASTARC.Content.Created", { n: created.length, kept: existing.length })
  );
  return { created, existing };
}

/**
 * Offer to build the set, once per world, as a dialog a GM cannot miss.
 *
 * This replaces a whispered chat message containing a line of JavaScript to
 * copy. That was the right information delivered in the one form nobody acts
 * on: the compendiums people had lost stayed missing, because getting them back
 * required knowing an API existed and typing it correctly.
 *
 * A dialog with a button is the whole point. It also ASKS rather than doing it
 * silently — ten compendiums appearing unannounced in someone's world is not a
 * decision this system gets to make for them.
 *
 * Silent when the world already has them: somebody has clearly sorted it out.
 */
export async function offerContentSetup() {
  if (!game.user.isGM) return;
  if (game.settings.get(SYSTEM_ID, NOTICE_FLAG)) return;
  if (existingWorldPacks().length) return;

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("LASTARC.Content.NoticeTitle") },
    content:
      `<p>${game.i18n.localize("LASTARC.Content.NoticeBody")}</p>` +
      `<p>${game.i18n.localize("LASTARC.Content.NoticeList")}</p>`,
    buttons: [
      { action: "create", label: game.i18n.localize("LASTARC.Content.Create"), default: true },
      { action: "later", label: game.i18n.localize("LASTARC.Content.Later") },
      { action: "never", label: game.i18n.localize("LASTARC.Content.Never") }
    ],
    // Closing the dialog is "ask me next time", not "never" — dismissing a box
    // is not consent to never being told again.
    rejectClose: false
  });

  if (choice === "create") {
    await createWorldCompendiums();
    await game.settings.set(SYSTEM_ID, NOTICE_FLAG, true);
  } else if (choice === "never") {
    await game.settings.set(SYSTEM_ID, NOTICE_FLAG, true);
  }
}

/** Registered by the entry point; kept here so the flag has one owner. */
export function registerContentSettings() {
  game.settings.register(SYSTEM_ID, NOTICE_FLAG, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  /**
   * A visible way back to the offer, for anyone who dismissed it or wants the
   * set in a world made before this shipped. A checkbox rather than a menu
   * button because a settings MENU needs its own Application class, and a
   * one-click checkbox does the same job with none of that surface.
   */
  game.settings.register(SYSTEM_ID, "createCompendiumsNow", {
    name: "LASTARC.Setting.CreateCompendiums.name",
    hint: "LASTARC.Setting.CreateCompendiums.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: async (value) => {
      if (!value) return;
      // Reset immediately so the box reads as a button rather than a state.
      await game.settings.set(SYSTEM_ID, "createCompendiumsNow", false);
      await createWorldCompendiums();
    }
  });
}
