/**
 * Copy everything out of Last Arc's SYSTEM compendiums into WORLD compendiums.
 *
 * Run this as a GM, in a Script macro, BEFORE updating the system again.
 *
 * Foundry replaces the whole system folder when it updates a system, and the
 * system's compendium packs live inside that folder — so anything authored into
 * them is destroyed by the update. World compendiums live in the world folder
 * and are never touched by a system update.
 *
 * Safe to run twice: it skips documents whose id is already in the target pack.
 */
const SYSTEM_ID = "last-arc";

const sourcePacks = game.packs.filter(
  (p) => p.metadata.packageType === "system" && p.metadata.packageName === SYSTEM_ID
);

if (!sourcePacks.length) {
  ui.notifications.warn("No Last Arc system compendiums found — nothing to rescue.");
} else {
  const report = [];

  for (const pack of sourcePacks) {
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });

    const docs = await pack.getDocuments();
    if (!docs.length) {
      if (wasLocked) await pack.configure({ locked: true });
      continue;
    }

    const label = `Last Arc — ${pack.metadata.label}`;

    let target = game.packs.find(
      (p) => p.metadata.packageType === "world" && p.metadata.label === label
    );
    if (!target) {
      target = await CompendiumCollection.createCompendium({
        label,
        type: pack.metadata.type
      });
    }
    if (target.locked) await target.configure({ locked: false });

    // Skip anything already copied, so a second run is a no-op rather than a
    // pile of duplicates.
    await target.getIndex();
    const already = new Set(target.index.map((e) => e._id));
    const payload = docs.filter((d) => !already.has(d.id)).map((d) => d.toObject());

    if (payload.length) {
      const cls = CONFIG[pack.metadata.type].documentClass;
      await cls.createDocuments(payload, { pack: target.collection, keepId: true });
    }

    report.push(`${pack.metadata.label}: ${payload.length} copied (${docs.length} present)`);
    if (wasLocked) await pack.configure({ locked: true });
  }

  if (!report.length) {
    ui.notifications.info("Last Arc system compendiums are all empty — nothing to rescue.");
  } else {
    console.log("Last Arc | Compendium rescue:\n  " + report.join("\n  "));
    ChatMessage.create({
      whisper: [game.user.id],
      content:
        `<h3>Last Arc — compendium rescue</h3><ul><li>${report.join("</li><li>")}</li></ul>` +
        `<p>Copies are in the Compendium tab under <strong>Last Arc — …</strong>. ` +
        `These live in the world and survive system updates. Check them before updating.</p>`
    });
    ui.notifications.info(`Rescued ${report.length} compendium(s) — see chat for the tally.`);
  }
}
