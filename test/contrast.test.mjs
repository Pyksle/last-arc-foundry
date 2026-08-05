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
import { readFileSync, readdirSync } from "node:fs";
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
   * The OTHER half of §9, and the half that was missing.
   *
   * The rule above stops a card being repainted by the viewer's theme. This one
   * stops a card asking for a colour that never arrives: the palette variables
   * are declared under `.last-arc`, and a chat message is not inside it. A bare
   * `var(--la-bronze)` in a `.lastarc-*` rule is not a wrong colour, it is an
   * INVALID VALUE — the whole declaration is dropped and the element silently
   * inherits.
   *
   * Five rules were doing this. Mostly it looked like nothing much: the hero
   * point button rendered as a bare browser default, the MP cost lost its
   * figures font. One was worse. `.lastarc-prereq.is-unmet` is how a posted
   * item card marks a prerequisite the character does not meet — struck
   * through AND red. The strike-through is plain CSS and survived; the red came
   * from `--la-oxblood` and did not. So the warning rendered in ordinary black
   * ink, and the only thing distinguishing "you cannot use this" was a line.
   *
   * The per-selector contrast checks below could not catch any of it: they test
   * a hand-written list, and every one of these was absent from it. A guard
   * that tests the examples its author thought of tests the author.
   */
  test("no chat rule depends on a palette variable that cannot reach it", () => {
    const offenders = [];
    for (const rule of css.matchAll(/(^|\n)([^{}\n][^{}]*?)\{([^}]*)\}/g)) {
      // Drop any comment sitting between the previous rule and this selector,
      // or the failure message quotes the whole explanation back at you.
      const selector = rule[2].replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!/\.lastarc-/.test(selector)) continue;
      for (const v of rule[3].matchAll(/var\(\s*(--la-[\w-]+)\s*\)/g)) {
        offenders.push(`${selector.replace(/\s+/g, " ")} { …${v[1]} }`);
      }
    }

    assert.deepEqual(offenders, [],
      "a .lastarc-* rule used a palette variable with no fallback. Chat renders " +
      "outside .last-arc, so --la-* is undefined there and the declaration is " +
      "dropped. Use a literal hex chosen against the card's cream:\n  " +
      offenders.join("\n  "));
  });

  /**
   * A COLOUR THAT LOSES THE CASCADE IS NOT A COLOUR.
   *
   * Every check in this file parses DECLARATIONS. That is fine for asking
   * whether a chosen colour is legible and useless for asking whether it ever
   * arrives — and those are different questions, as four rules proved.
   *
   * `.lastarc-card p, span, div, strong { color: inherit }` exists to beat
   * Foundry's own chat-log styling. It is (0,1,1). Every rider variant was a
   * bare `.lastarc-rider--crit` at (0,1,0) and LOST: the combo, critical and
   * healing riders rendered in the card's default ink for eleven releases, and
   * `border-left: 3px solid currentColor` took the left bar with them. Only the
   * translucent plate behind the text showed, which was enough to look
   * deliberate. Meanwhile the per-selector tests below reported all three as
   * comfortably passing, because the value they measured was one the browser
   * had discarded.
   *
   * Caught by measuring the computed colour in a real browser while adding a
   * fourth rider (#57). This is that check, made structural: any `.lastarc-*`
   * class that a chat template puts on a p/span/div/strong must out-specify the
   * reset, or its colour is decoration in the source file only.
   */
  test("no chat colour is out-specified by the inherit reset", () => {
    // Which tags each class actually lands on, read from the templates.
    const tags = new Map();
    for (const file of readdirSync(join(root, "templates/chat"))) {
      const tpl = readFileSync(join(root, "templates/chat", file), "utf8");
      for (const m of tpl.matchAll(/<(p|span|div|strong)\b[^>]*class="([^"]*)"/g)) {
        for (const cls of m[2].split(/\s+/)) {
          if (!cls.startsWith("lastarc-")) continue;
          if (!tags.has(cls)) tags.set(cls, new Set());
          tags.get(cls).add(m[1]);
        }
      }
    }
    // The reset itself must exist, or this test is asserting nothing.
    assert.match(css, /\.lastarc-card p,[\s\S]{0,120}color:\s*inherit/,
      "the inherit reset is gone — this guard has lost its premise");

    /** [ids, classes, elements] for a whole selector. */
    const specificity = (sel) => [
      (sel.match(/#[\w-]+/g) ?? []).length,
      (sel.match(/(?:\.[\w-]+|:[\w-]+(?:\([^)]*\))?|\[[^\]]*\])/g) ?? []).length,
      (sel.match(/(?:^|[\s>+~])[a-z][\w-]*/g) ?? []).length
    ];

    const nc = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const resetAt = nc.search(/\.lastarc-card strong,/);
    assert.ok(resetAt > 0, "the reset moved; source-order tie-breaks are wrong");

    const losers = [];
    for (const rule of nc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const colour = rule[2].match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1]?.trim();
      // `inherit` IS the reset. `.lastarc-card` is the ancestor supplying the
      // value being inherited. Neither is a descendant losing a cascade.
      if (!colour || colour === "inherit") continue;

      for (const sel of rule[1].split(",")) {
        const one = sel.trim().replace(/\s+/g, " ");
        if (!one || one === ".lastarc-card") continue;

        /**
         * The SUBJECT is the rightmost compound — the element the rule paints.
         * `.lastarc-ammo strong` paints a <strong>, not the ammo line, and it
         * ties the reset on specificity and wins on source order. Judging by
         * "the last class named anywhere in the selector" flagged it, and
         * flagged `.lastarc-ammo-row button` for a tag the reset never touches.
         */
        const subject = one.split(/[\s>+~]+/).pop();
        const cls = [...subject.matchAll(/\.(lastarc-[\w-]+)/g)].pop()?.[1];
        if (!cls || !tags.has(cls)) continue;
        // Only the four tags the reset actually names can lose to it.
        if (![...tags.get(cls)].some((t) => ["p", "span", "div", "strong"].includes(t))) continue;

        const [a, b, c] = specificity(one);
        const wins = a > 0 || b > 1 || (b === 1 && c > 1)
          // An exact tie is decided by source order, and every one of these
          // sits below the reset — so a tie is a win, not a loss.
          || (a === 0 && b === 1 && c === 1 && rule.index > resetAt);
        if (wins) continue;

        losers.push(`${one}  (on <${[...tags.get(cls)].join("/")}>)`);
      }
    }

    assert.deepEqual(losers, [],
      "these declare a colour that the `.lastarc-card p,span,div,strong { color: " +
      "inherit }` reset overrides, so the element renders in the card's default " +
      "ink and the declaration is decoration. Scope them under `.lastarc-card`:\n  " +
      losers.join("\n  "));
  });

  /**
   * Text over a tinted plate. The plate is translucent over the card, so both
   * halves have to be composited before the comparison — measuring the text
   * against the raw card would flatter every one of these.
   */
  const PLATED = [
    [".lastarc-card .lastarc-verdict--good", "the hit/beat verdict"],
    [".lastarc-card .lastarc-verdict--bad", "the miss/resisted verdict"],
    [".lastarc-card .lastarc-rider--combo", "the combo and repeat-block riders"],
    [".lastarc-card .lastarc-rider--crit", "the critical rider"],
    [".lastarc-card .lastarc-rider--heal", "the healing rider"],
    // Added with the rider itself (#57). A plate that arrives unlisted here is
    // exactly how the pale-green-on-pale-green verdict shipped: this list is
    // the check, so a new plate is unmeasured until it is on it.
    [".lastarc-card .lastarc-rider--negated", "the negated-rider plate"]
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

/* -------------------------------------------------------------------------- */

/**
 * SHEET INK TOKENS — the measurable part of the gap named at the top of this
 * file (issue: statuses unreadable).
 *
 * The header says this suite does not cover the sheets, because sheet surfaces
 * are painted with gradients and cannot be resolved by parsing CSS. That is
 * still true of the SURFACES. It was never true of the TOKENS: every palette
 * declares its paper and its three inks as literal hex, four times over —
 * default, dark, and the two explicit `data-theme` blocks — so the ink-on-paper
 * pairing can be measured exactly, and it is the pairing that actually failed.
 *
 * `--la-ink-faint` shipped at 3.45:1 light and 4.12:1 dark. Every one of its
 * ~forty uses is small text, so both were short of AA, and the status palette
 * then halved the opacity on top of it and reached 1.73:1.
 *
 * This does NOT prove any given element is legible — an element can still be
 * dimmed, or placed on a gradient stop darker than `--la-paper`. It proves the
 * palette is not unreadable BY CONSTRUCTION, which is the failure that shipped.
 */
describe("sheet palette: ink on paper", () => {
  /** Each palette block declares `--la-paper` first; read to the block's end. */
  function palettes() {
    const out = [];
    const re = /--la-paper:\s*(#[0-9a-f]{6})/gi;
    for (const m of css.matchAll(re)) {
      const body = css.slice(m.index, css.indexOf("}", m.index));
      const vars = {};
      for (const v of body.matchAll(/(--la-[\w-]+):\s*(#[0-9a-f]{6})/gi)) vars[v[1]] = v[2];
      out.push(vars);
    }
    return out;
  }

  const found = palettes();

  test("all four palette blocks are found", () => {
    assert.equal(found.length, 4,
      "expected default, dark, and both data-theme palettes; the parser above " +
      "relies on --la-paper being declared first in each");
  });

  for (const token of ["--la-ink", "--la-ink-soft", "--la-ink-faint"]) {
    test(`${token} is readable on paper in every theme`, () => {
      found.forEach((vars, i) => {
        const fg = vars[token];
        const bg = vars["--la-paper"];
        if (!fg || !bg) return;
        const r = contrast(hex(fg), hex(bg));
        assert.ok(r >= 4.5,
          `palette ${i}: ${token} ${fg} on ${bg} is ${r.toFixed(2)}:1, ` +
          `under the 4.5:1 that small text needs`);
      });
    });
  }

  /**
   * The status palette dims its ICON and not its label, which is why the label
   * is checked at full strength above. Pinned here so a future tidy-up cannot
   * reinstate a blanket opacity on the tile without this going red.
   */
  test("the status tile does not dim its label", () => {
    // The tile's OWN rule body only. Slicing further would swallow
    // `.la-status__icon`, whose opacity is the whole point.
    const start = css.indexOf(".la-status {");
    const tile = css.slice(start, css.indexOf("}", start));
    assert.doesNotMatch(tile, /^\s*opacity:/m,
      "a blanket opacity on .la-status takes the label down with the icon; " +
      "dim .la-status__icon instead");
  });

  /**
   * This test used to require the OPPOSITE — a CSS mask, never an <img>.
   *
   * That was right for #41, when every icon drew with `stroke="currentColor"`:
   * an <img> resolves `currentColor` against the SVG's own root, which is
   * black, so the palette was black on near-black at 1.12:1 and only a mask
   * could get the sheet's ink into it. #43 then redrew all 33 as self-contained
   * badges — a family-coloured disc, a white glyph, two rings — and deleted
   * every `currentColor`. The mask had nothing left to tint and kept only the
   * alpha of an edge-to-edge opaque badge, so it painted 33 identical discs and
   * discarded the colour separation #43 exists to provide.
   *
   * The requirement the old test was protecting has not moved: the palette must
   * be legible without inheriting anything. It is now met by the artwork rather
   * than by the mask, and asserted where the artwork is —
   * test/status-icons.test.mjs checks the glyph/disc ratio and that no
   * `currentColor` has crept back in. Both halves are needed: an <img> here is
   * only safe while that stays true.
   */
  test("status icons are the badge itself, which carries its own contrast", () => {
    const tpl = readFileSync(join(root, "templates/actor/status-palette.hbs"), "utf8");
    assert.match(tpl, /<img[^>]*class="la-status__icon"[^>]*src="\{\{this\.img\}\}"/,
      "the palette must draw the same badge the token wears");
    assert.doesNotMatch(css, /\.la-status__icon[\s\S]*?(?:-webkit-)?mask/,
      "a mask keeps only the alpha of an opaque badge — 33 identical discs, " +
      "and none of the family colours from #43");

    const icons = readdirSync(join(root, "assets/status")).filter((f) => f.endsWith(".svg"));
    const tinted = icons.filter((f) =>
      readFileSync(join(root, "assets/status", f), "utf8").includes("currentColor"));
    assert.deepEqual(tinted, [],
      "an <img> resolves currentColor to black against the SVG's own root; " +
      `these would go back to 1.12:1 in the dark theme: ${tinted.join(", ")}`);
  });

  /**
   * The tile is a <button>, and Foundry gives every button the height of one
   * row of text. A two-line tile does not fit, and the icon is the part that
   * gives: it was measured at 3.3px of an intended 25.6px in a live world.
   */
  test("the status tile is not held at Foundry's button height", () => {
    const start = css.indexOf(".la-status {");
    const tile = css.slice(start, css.indexOf("}", start));
    assert.match(tile, /height:\s*auto/,
      "without this the tile is `--button-size` tall and the icon is squashed");
    assert.match(tile, /min-height:\s*0/,
      "height alone leaves the min-height floor still holding the tile at 28px");
  });
});

/**
 * Card text that reads as English.
 *
 * `LASTARC.Card.VsReflex` is already "vs Reflex", and the attack card printed
 * `Versus` immediately before it — so every targeted attack in the game said
 * "9 vs vs Reflex 17". Nothing could see it: both keys exist, both are
 * localised, and the integrity suite only checks that a key RESOLVES.
 *
 * Found by rendering a card and reading it, which is the only way this class of
 * defect ever surfaces.
 */
describe("§ chat card wording", () => {
  test("no card prints two prepositions in a row", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("../templates/chat", import.meta.url));
    const lang = JSON.parse(
      readFileSync(fileURLToPath(new URL("../lang/en.json", import.meta.url)), "utf8"));

    const doubled = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".hbs"))) {
      const src = readFileSync(`${dir}/${file}`, "utf8");
      // Two adjacent {{localize}} calls whose STRINGS both start with the same
      // word — "vs" then "vs Reflex".
      for (const m of src.matchAll(
        /\{\{localize "([\w.]+)"\}\}\s*\{\{localize "([\w.]+)"\}\}/g
      )) {
        const a = (lang[m[1]] ?? "").trim().toLowerCase();
        const b = (lang[m[2]] ?? "").trim().toLowerCase();
        if (a && b && (b === a || b.startsWith(`${a} `))) {
          doubled.push(`${file}: "${lang[m[1]]}" + "${lang[m[2]]}"`);
        }
      }
    }
    assert.deepEqual(doubled, [],
      "these render a word twice in a row:\n  " + doubled.join("\n  "));
  });
});
