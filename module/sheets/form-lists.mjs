/**
 * Repacking the boxes that stand in for something the schema cannot bind to.
 *
 * READ FROM THE RAW FORM DATA, NEVER FROM THE SUBMIT OBJECT.
 *
 * `super._prepareSubmitData` ends with `document.validate({changes, clean:
 * true})`, and cleaning DELETES every key the schema does not declare. A
 * `*Text` box is exactly such a key — it exists only so a player can type
 * "Common, Elven" instead of operating a row editor — so by the time super
 * returns there is nothing left to repack.
 *
 * Both sheets read the cleaned result. Every comma box on both of them
 * therefore accepted typing and dropped it, silently, since it was written:
 * languages on a character; senses, languages, fits, features, decay fractions
 * and all three prerequisite lists on an item. Reported as "languages don't
 * save between sessions" — they never saved at all, and neither did the rest.
 *
 * The submit object is EXPANDED, not dotted. Foundry's own subclasses write
 * `submitData.text.markdown` and `setProperty(submitData, "video.timestamp")`,
 * which is the shape these helpers write into.
 */

/**
 * Write a dotted path into a nested object, creating the objects it needs.
 *
 * Local rather than `foundry.utils.setProperty` so this module is Foundry-free
 * and can be unit tested — the bug it exists to fix was invisible to the unit
 * suite precisely because it lived where only Foundry runs.
 */
function setPath(target, path, value) {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[keys.at(-1)] = value;
  return target;
}

/** The raw value of one form control, before validation cleaned it away. */
function rawField(formData, key) {
  return formData?.object?.[key];
}

const commaList = (raw) =>
  String(raw).split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Repack `*Text` boxes into the string arrays they stand for.
 *
 * @param {object} formData  the FormDataExtended super was handed
 * @param {object} submit    the expanded submit object to write into
 * @param {Record<string,string>} paths  form key -> document path
 */
export function repackTextLists(formData, submit, paths) {
  for (const [uiKey, path] of Object.entries(paths)) {
    const raw = rawField(formData, uiKey);
    if (typeof raw !== "string") continue;
    // Nothing to delete afterwards: the box is not a document field, so
    // validation has already removed it. That removal is the whole bug.
    setPath(submit, path, commaList(raw));
  }
  return submit;
}

/**
 * Repack a comma list of non-negative numbers, warning about the rest.
 *
 * Returns the values it kept, so a caller can decide whether to complain — the
 * warning is the caller's because only it knows what the numbers are for.
 */
export function repackNumberList(formData, submit, uiKey, path) {
  const raw = rawField(formData, uiKey);
  if (typeof raw !== "string") return null;

  const parts = commaList(raw).map(Number);
  const kept = parts.filter((n) => Number.isFinite(n) && n >= 0);
  setPath(submit, path, kept);
  return { kept, rejected: parts.length - kept.length };
}

/**
 * Rebuild an attribute-keyed map from its individual boxes.
 *
 * WHOLESALE, because a dotted path cannot express "remove this key" — and
 * removal is the point: a prerequisite of 0 is not a requirement at all, and
 * keeping those put six phantom lines ("Str 0, Vit 0, Agi 0…") on every
 * technick shared to chat, which is issue #15.
 *
 * `dropZero` is the difference between the two uses. A racial modifier of 0 and
 * no racial modifier are different things to read on a sheet; a prerequisite of
 * 0 and no prerequisite are the same thing.
 */
export function repackAttributeMap(formData, submit, base, { dropZero = false } = {}) {
  const prefix = `${base}.`;
  const keys = Object.keys(formData?.object ?? {}).filter((k) => k.startsWith(prefix));
  if (!keys.length) return submit;

  const rebuilt = {};
  for (const key of keys) {
    const value = rawField(formData, key);
    if (value === null || value === "" || value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (dropZero && n === 0) continue;
    rebuilt[key.slice(prefix.length)] = n;
  }
  setPath(submit, base, rebuilt);
  return submit;
}
