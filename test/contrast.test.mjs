/**
 * Readability of the chat cards (issue #11).
 *
 * Reported as "the font for the DC and the comparison to the target's defence
 * is hard to read". It measured 1.12:1 — pale green text on the pale green
 * verdict plate — because the card had been made opaque cream while these rules
 * kept a `prefers-color-scheme: dark` override that lightened the text.
 *
 * WHY THIS TEST IS SHAPED LIKE THIS. Two earlier attempts at a general
 * readability audit drove a headless browser and walked the DOM, and both
 * reported over a hundred failures on plainly legible text: the sheet panels
 * paint their cream with a `linear-gradient`, which is a background-IMAGE and
 * fell through to Foundry's near-black window, and Foundry emits
 * `color(srgb ...)` that the parser did not read. A contrast checker that cries
 * wolf is worse than none.
 *
 * So this does not try to discover what is painted behind anything. The chat
 * card is the one surface that DECLARES both halves of every pairing as
 * literals — that is its whole design, because a chat message sits outside the
 * `.last-arc` scope and cannot know whether the log is light or dark. Reading
 * those literals out of the stylesheet and doing the arithmetic is exact.
 *
 * It does not cover the sheets. That is a real gap and is stated rather than
 * papered over; sheet colours come from theme variables composited through
 * gradients, and measuring them needs pixel sampling rather than CSS parsing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "styles", "last-arc.css"), "utf8");

/* -- WCAG 2.1 relative luminance ------------------------------------------- */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Composite a translucent colour over an opaque one. */
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* -- Reading the declared values back out of the stylesheet ---------------- */

/**
 * The body of a rule, by exact selector.
 *
 * Read from the CSS rather than restated here, so changing a colour changes
 * what this measures. A test carrying its own copy of the palette would keep
 * passing while the card went unreadable.
 */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(m, `no rule for "${selector}" — the selector was renamed or removed`);
  return m[1];
}

const declaration = (selector, property) => {
  const body = rule(selector);
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(m, `"${selector}" declares no ${property}`);
  return m[1].trim();
};

/** "#1f4327" → rgb; "rgba(78, 135, 87, 0.28)" → {rgb, alpha}. */
function parseColour(value) {
  const h = value.match(/#[0-9a-f]{6}/i);
  if (h) return { rgb: hex(h[0]), alpha: 1 };

  const rgba = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  assert.ok(rgba, `cannot parse colour: ${value}`);
  return {
    rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
    alpha: rgba[4] === undefined ? 1 : Number(rgba[4])
  };
}

/* -------------------------------------------------------------------------- */

describe("chat card readability", () => {
  /**
   * The card must paint its own opaque paper. Everything below depends on it:
   * every text colour on a card is a fixed dark value chosen against cream, so
   * a card that inherited a dark background would put dark ink on dark paper —
   * which is what shipped once already, at 1.12:1.
   */
  const paperValue = declaration(".lastarc-card", "background");
  const paper = parseColour(paperValue).rgb;

  test("the card background is opaque and light", () => {
    assert.equal(parseColour(paperValue).alpha, 1,
      "a translucent card inherits whatever the chat log is");
    assert.ok(luminance(paper) > 0.5, "the card is cream paper; the text colours assume it");
  });

  /**
   * THE STRUCTURAL GUARD, and the one that would have caught the reported bug.
   *
   * The card is deliberately theme-independent. A `prefers-color-scheme` rule
   * touching a `.lastarc-*` colour means someone has assumed the card follows
   * the viewer's theme — it does not, it is a piece of paper — and the result
   * is light text on the light plate it was already sitting on.
   */
  test("no dark-scheme override touches a chat card colour", () => {
    const offenders = [];
    for (const block of css.matchAll(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/g)) {
      // Walk from the opening brace to its match, so nested rules are included.
      let depth = 0;
      let i = block.index + block[0].length - 1;
      const start = i;
      do {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
        i++;
      } while (depth > 0 && i < css.length);

      const body = css.slice(start, i);
      for (const m of body.matchAll(/(\.lastarc-[\w-]+)[^{}]*\{[^}]*color\s*:/g)) {
        offenders.push(m[1]);
      }
    }

    assert.deepEqual(offenders, [],
      "chat cards paint their own paper and must not follow the viewer's theme. " +
      "These overrode a card colour in dark mode: " + offenders.join(", "));
  });

  /**
   * Text over a tinted plate. The plate is translucent over the card, so both
   * halves have to be composited before the comparison — measuring the text
   * against the raw card would flatter every one of these.
   */
  const PLATED = [
    [".lastarc-verdict--good", "the hit/beat verdict"],
    [".lastarc-verdict--bad", "the miss/resisted verdict"],
    [".lastarc-rider--combo", "the combo and repeat-block riders"],
    [".lastarc-rider--crit", "the critical rider"],
    [".lastarc-rider--heal", "the healing rider"]
  ];

  for (const [selector, what] of PLATED) {
    test(`${what} clears 4.5:1 on its own plate`, () => {
      const text = parseColour(declaration(selector, "color")).rgb;
      const plate = parseColour(declaration(selector, "background"));
      const behind = over(plate.rgb, plate.alpha, paper);

      const r = contrast(text, behind);
      assert.ok(r >= 4.5,
        `${selector} measures ${r.toFixed(2)}:1 against its own background`);
    });
  }

  /**
   * Dimmed text. `opacity` composites toward the background, so a chip at 0.68
   * of the size and 0.85 of the ink is doing two things at once and neither is
   * visible in the declared colour.
   */
  const DIMMED = [
    [".lastarc-card__sub", "the card subtitle"],
    [".lastarc-part", "the modifier chips"],
    [".lastarc-card__natural", "the die and modifier row"]
  ];

  for (const [selector, what] of DIMMED) {
    test(`${what} clears 4.5:1 after its opacity`, () => {
      const ink = parseColour(declaration(".lastarc-card", "color")).rgb;
      const alpha = Number(declaration(selector, "opacity"));
      assert.ok(alpha > 0 && alpha <= 1, `${selector} has a nonsense opacity`);

      const r = contrast(over(ink, alpha, paper), paper);
      assert.ok(r >= 4.5, `${selector} measures ${r.toFixed(2)}:1 at opacity ${alpha}`);
    });
  }

  /**
   * Uppercase below about 10px is harder to read than its contrast ratio
   * suggests — the letterforms lose the ascender and descender cues that make
   * lowercase scannable. The subtitle was 0.58rem, which is ~9px.
   */
  test("uppercase card text is at least 0.62rem", () => {
    for (const selector of [".lastarc-card__sub", ".lastarc-card__desc > summary"]) {
      const size = parseFloat(declaration(selector, "font-size"));
      assert.ok(size >= 0.62, `${selector} is ${size}rem — too small for uppercase`);
    }
  });

  /**
   * The five spell school chips, whose "green text on green background" was the
   * first readability report. They have no plate of their own — the colour is
   * both the text and, via currentColor, the border — so they sit on the sheet's
   * light paper.
   */
  test("every spell school chip clears 4.5:1 on light paper", () => {
    const sheetPaper = hex("#f5f0e4");
    for (const school of ["black", "blue", "green", "red", "white"]) {
      const colour = parseColour(
        declaration(`.la-spell__school--${school}`, "color")
      ).rgb;
      const r = contrast(colour, sheetPaper);
      assert.ok(r >= 4.5, `${school} measures ${r.toFixed(2)}:1`);
    }
  });
});
