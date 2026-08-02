/**
 * Themes and token status icons (issue #41).
 *
 * Two reports in one ticket, with the same shape: a thing that was written to
 * respond to a signal, and never received that signal.
 *
 *   1. "both only appear as dark mode for me". The explicit palettes keyed off
 *      `:root[data-theme="…"]`, which nothing sets, so the OS media query alone
 *      decided the palette. On a dark-mode machine that means dark, always,
 *      whatever Foundry's own toggle says.
 *
 *   2. "the status icons on the token are hard to see". Every icon painted with
 *      `currentColor`. In a file loaded as an IMAGE there is no inherited
 *      `color` to pick up, so `currentColor` resolves to its initial value —
 *      black — and black line art on a dark token is invisible.
 *
 * Neither could be caught by anything that reads the SVG or CSS as text and
 * asks whether it is well-formed. Both are about the value a property resolves
 * to in a context the source file cannot see.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const css = readFileSync(at("styles/last-arc.css"), "utf8");

const ICON_DIR = at("assets/status");
const icons = readdirSync(ICON_DIR).filter((f) => f.endsWith(".svg"));

describe("§ issue #41: the theme toggle actually toggles", () => {
  test("there are icons to check", () => {
    assert.ok(icons.length >= 30, `expected the full status set, found ${icons.length}`);
  });

  /**
   * The palettes must respond to what Foundry SETS, not only to the OS. Foundry
   * v13 puts `theme-light` / `theme-dark` classes on the window element.
   */
  for (const theme of ["light", "dark"]) {
    test(`the ${theme} palette responds to Foundry's own theme class`, () => {
      assert.match(css, new RegExp(`\\.theme-${theme}\\s+\\.last-arc`),
        `nothing matches Foundry's .theme-${theme} class, so the in-app theme ` +
        "setting cannot reach the sheet and the OS decides the palette alone");
    });
  }

  /**
   * The direction that was broken. A dark-mode OS plus an explicit LIGHT choice
   * must land on light, which needs the explicit rule to outrank the media
   * query. It does so on specificity — `.theme-light .last-arc` is (0,2,0)
   * against the media query's (0,1,0) — but source order is asserted too, so a
   * later reshuffle cannot quietly reintroduce the bug.
   */
  test("an explicit choice outranks the OS preference", () => {
    const mediaAt = css.indexOf("@media (prefers-color-scheme: dark)");
    const lightAt = css.indexOf(".theme-light .last-arc");
    assert.ok(mediaAt !== -1 && lightAt !== -1, "lost target");
    assert.ok(lightAt > mediaAt,
      "the OS dark palette is declared after the explicit light one; if their " +
      "specificity is ever equalised, a dark-mode machine can never show light");
  });
});

describe("§ issue #41: token status icons are visible on a token", () => {
  /**
   * `currentColor` is not wrong in a sheet — it is wrong in a FILE. These are
   * loaded by path as token overlay images, with no cascade to inherit from.
   */
  test("no icon relies on an inherited colour it cannot receive", () => {
    const bad = icons.filter((f) => {
      const src = readFileSync(`${ICON_DIR}/${f}`, "utf8");
      // currentColor is fine as long as the file itself supplies a `color`.
      return src.includes("currentColor") && !/\bcolor\s*:\s*#[0-9a-f]{3,8}/i.test(src);
    });

    assert.deepEqual(bad, [],
      "these icons paint with currentColor and never set a colour of their " +
      "own, so they rasterise BLACK on the token:\n  " + bad.join("\n  "));
  });

  test("every icon carries a contrasting outline", () => {
    // A light glyph alone fails on a light map exactly as a dark one fails on a
    // dark map. The halo is what makes the set background-independent.
    const bad = icons.filter((f) => !readFileSync(`${ICON_DIR}/${f}`, "utf8").includes("feMorphology"));

    assert.deepEqual(bad, [],
      "these icons have no halo, so they are legible only against backgrounds " +
      "that happen to contrast with them:\n  " + bad.join("\n  "));
  });

  test("the halo does not swallow the glyph's interior detail", () => {
    // Dilating the alpha closes small gaps. At radius 4 the skull's eye sockets
    // and the target's pips start filling in; 3.2 was the largest that held.
    for (const f of icons) {
      const radii = [...readFileSync(`${ICON_DIR}/${f}`, "utf8")
        .matchAll(/feMorphology[^>]*radius="([\d.]+)"/g)].map((m) => Number(m[1]));
      assert.ok(radii.length > 0, `${f}: no halo radius found`);
      for (const r of radii) {
        assert.ok(r <= 3.5, `${f}: halo radius ${r} fills in interior detail`);
      }
    }
  });

  test("the icons are still valid, self-contained SVG", () => {
    for (const f of icons) {
      const src = readFileSync(`${ICON_DIR}/${f}`, "utf8");
      assert.match(src, /^<svg\b/, `${f}: does not start with an svg element`);
      assert.match(src, /<\/svg>\s*$/, `${f}: unclosed svg element`);
      // A token icon is fetched by path; anything external would 404 silently.
      assert.doesNotMatch(src, /\b(?:href|src)="(?!#)/,
        `${f}: references something outside itself`);
    }
  });
});
