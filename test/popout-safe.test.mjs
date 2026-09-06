/**
 * Issue #85: "pop out the character sheet so it doesn't take up the Foundry
 * screen".
 *
 * Foundry has no such feature. Its own "popout" is a sidebar tab in a floating
 * window, still inside the same page; the thing being asked for is a second
 * BROWSER window, which the PopOut! module does and has done since v9.
 *
 * That module works by moving the rendered element into another document with
 * `adoptNode`. Everything about a sheet survives that EXCEPT code that reaches
 * for the page's own `document` or `window` to find its elements — those
 * globals still point at the Foundry window, where the sheet no longer is, so
 * the query returns nothing and the handler silently does nothing.
 *
 * Our sheets are already written the right way: every handler starts from
 * `this.element` or from the event's own target. This guard is here to keep
 * that true, because the failure is invisible until someone pops a sheet out.
 *
 * Chat is deliberately exempt. A card is rendered into the chat log in the main
 * window and is never adopted, so `document.createElement` there is correct.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => readFileSync(dir(p), "utf8");

/** Strip comments and strings, so prose about `document.validate` is not code. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

/**
 * Reaching for the OWNING page rather than for the element in hand.
 *
 * `ownerDocument` and `defaultView` are the popout-safe spellings and are
 * allowed through — they resolve to whichever window the element is actually in.
 */
const GLOBAL_LOOKUP =
  /(^|[^.\w$])(document|window)\.(querySelector|querySelectorAll|getElementById|getElementsByClassName|elementFromPoint|activeElement|getComputedStyle|innerWidth|innerHeight)\b/;

const files = readdirSync(dir("module/sheets"))
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => `module/sheets/${f}`);

describe("§ #85: the sheets survive being popped into another window", () => {
  test("this guard is actually looking at the sheets", () => {
    // A directory read that silently returned nothing would pass every
    // assertion below while checking no file at all.
    assert.ok(files.length >= 3, `only found ${files.length} sheet files`);
    assert.ok(files.some((f) => f.includes("character-sheet")), files.join(", "));
  });

  for (const file of files) {
    test(`${file} finds its elements from the element it was given`, () => {
      const body = code(read(file));
      const offender = body.split("\n").findIndex((line) => GLOBAL_LOOKUP.test(line));
      assert.equal(offender, -1,
        `${file}:${offender + 1} queries the page's own document. In a popped-out ` +
        "sheet the element lives in a different document and this finds nothing, " +
        "with no error. Start from `this.element`, the event target, or " +
        "`el.ownerDocument`.");
    });
  }

  test("the shared sheet helpers are clean too", () => {
    for (const file of ["module/sheet-rows.mjs", "module/item-actions.mjs"]) {
      assert.ok(!GLOBAL_LOOKUP.test(code(read(file))), `${file} queries the page document`);
    }
  });

  test("the guard can fail", () => {
    // Proving the regex bites, since every file above passes it today and a
    // pattern that matched nothing would look identical.
    assert.ok(GLOBAL_LOOKUP.test("const row = document.querySelector('.x');"));
    assert.ok(GLOBAL_LOOKUP.test("if (window.innerWidth < 600) return;"));
    assert.ok(!GLOBAL_LOOKUP.test("const row = this.element.querySelector('.x');"));
    assert.ok(!GLOBAL_LOOKUP.test("el.ownerDocument.querySelector('.x');"),
      "the popout-safe spelling must not be flagged");
  });
});
