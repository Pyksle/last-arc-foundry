/**
 * Creating items by hand, from the sheet they belong on.
 *
 * This system ships with EMPTY compendium packs by design (§17): the rulebook
 * is not ours to distribute, so no game content comes with it. That makes
 * hand-authoring from your own copy the ONLY way content enters a world — and
 * for a long time the sheets offered no way to do it. The sole route was the
 * sidebar Items directory followed by a drag onto the sheet, which works but is
 * invisible, while the empty-state copy pointed at compendia that are empty for
 * everybody. The result read, correctly, as "this system cannot be used".
 *
 * Shared by the character and NPC sheets rather than duplicated: the two sheets
 * already repeat several small handlers, and repeating this one would mean the
 * type lists could drift apart without a test noticing.
 */

import { LASTARC } from "../config.mjs";
import { nextSort } from "../item-order.mjs";

/**
 * Prompt for a name and subtype, then create the item on `actor` and open it.
 *
 * @param {Actor} actor    The actor to create the item on.
 * @param {string} group   A key of LASTARC.itemCreationGroups.
 * @returns {Promise<Item|null>} The created item, or null if cancelled.
 */
export async function promptCreateItem(actor, group) {
  const types = LASTARC.itemCreationGroups[group];

  // A typo in a template must not quietly create the wrong subtype.
  if (!types?.length) {
    console.error(
      `Last Arc | createItem: no such group "${group}". ` +
      `Valid groups: ${Object.keys(LASTARC.itemCreationGroups).join(", ")}.`
    );
    return null;
  }

  const typeLabel = (t) => game.i18n.localize(`TYPES.Item.${t}`);

  // One type needs no picker; several get a select. Either way the field is
  // named `type`, so the callback reads it the same way.
  const typeField = types.length === 1
    ? `<input type="hidden" name="type" value="${types[0]}">`
    : `<label>${game.i18n.localize("LASTARC.Dialog.CreateItem.type")}` +
      `<select name="type">` +
      types.map((t) => `<option value="${t}">${typeLabel(t)}</option>`).join("") +
      `</select></label>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("LASTARC.Dialog.CreateItem.title") },
    content:
      `<p>${game.i18n.localize("LASTARC.Dialog.CreateItem.content")}</p>` +
      `<label>${game.i18n.localize("LASTARC.Dialog.CreateItem.name")}` +
      `<input type="text" name="name" autofocus></label>` +
      typeField,
    ok: {
      label: game.i18n.localize("LASTARC.Dialog.CreateItem.submit"),
      callback: (event, button) => ({
        name: button.form.elements.name.value.trim(),
        type: button.form.elements.type.value
      })
    },
    rejectClose: false
  });

  if (!result?.type) return null;

  // Land at the END of the list. Foundry leaves `sort` at 0 on creation, so
  // without this a new item outranks everything the player has deliberately
  // ordered and jumps to the top of its panel (issue #9).
  const data = {
    name: result.name || typeLabel(result.type),
    type: result.type,
    sort: nextSort([...actor.items])
  };

  // A weapon created from the Attacks panel arrives equipped. That panel lists
  // equipped weapons only, so creating one that then failed to appear in the
  // very panel you clicked would read as the button not working. Weapons carry
  // no exclusivity rule, unlike armour and shields, so this is safe to do.
  if (group === "attacks") data.system = { equipped: true };

  const [item] = await actor.createEmbeddedDocuments("Item", [data]);

  // Open it straight away: the name is never the interesting part — the
  // numbers are, and they live one click deeper.
  item?.sheet?.render(true);
  return item ?? null;
}
