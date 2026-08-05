/**
 * How an asset URL reaches the page (issue #51).
 *
 * All 33 status icons 404ed in a live world and the palette drew blank discs on
 * both actor sheets, with ~200 console errors on every sheet open. The path
 * itself was never wrong — `systems/last-arc/assets/status/blind.svg` is served
 * — but the browser asked for
 * `systems/last-arc/styles/systems/last-arc/assets/status/blind.svg`.
 *
 * The template declared the url as a CUSTOM PROPERTY on the element:
 *
 *     style="--la-status-icon: url('systems/last-arc/assets/status/blind.svg')"
 *
 * and `styles/last-arc.css` substituted it into `mask`. A relative url() in a
 * style ATTRIBUTE resolves against the document, which is what the path is
 * written for; a relative url() carried through a custom property resolves in
 * Chromium where the property is SUBSTITUTED, against the stylesheet doing the
 * substituting — so the stylesheet's own directory, `systems/last-arc/styles/`,
 * got prepended.
 *
 * Nothing that reads either file on its own can see this. The path is valid,
 * the CSS is valid, the custom property is spelled the same in both places, and
 * the whole node suite was green while every icon was missing. What is asserted
 * here is the MECHANISM: a url may travel to the page in a style attribute, and
 * it may sit in a stylesheet, but it may not be handed from one to the other
 * through a variable, because that is the one route that silently rebases it.
 *
 * The palette itself no longer takes either route — it is an `<img src>`, which
 * the HTML parser resolves against the document and no stylesheet can touch.
 * That was forced by a second fault found underneath this one (the mask kept
 * only the badge's alpha; see the note in styles/last-arc.css), but it is also
 * the version with no resolution rule to get wrong, so it is pinned here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { LASTARC } from "../module/config.mjs";

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => readFileSync(at(p), "utf8");

/**
 * Comments out, line numbers kept. Most of the comments in this codebase
 * describe the mistake they exist to prevent, and quote it — including the one
 * above `.la-status__icon`, which spells out the `mask: var(…)` this file
 * forbids. Scanning the prose would fail on the explanation of the fix.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => "\n".repeat((c.match(/\n/g) ?? []).length));

const css = stripComments(read("styles/last-arc.css"));
const SYSTEM_ID = JSON.parse(read("system.json")).id;

/** Every .hbs under templates/, path relative to the repo root. */
function templates(dir = at("templates")) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return templates(full);
    return entry.endsWith(".hbs") ? [relative(at("."), full)] : [];
  });
}

/**
 * Handlebars comments, both forms. The `--` pair is matched as a pair and not
 * as "optionally `--`, then the first `}}`" — status-palette.hbs quotes the bug
 * INCLUDING a `{{this.img}}`, so a lazier pattern stops at that inner mustache
 * and leaves half a comment behind. Which half it leaves decides whether the
 * scan below reads prose as markup.
 */
const stripHbsComments = (src) =>
  src.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![^}]*\}\}/g, "");

/**
 * Each `style="…"` in a template, split into its individual declarations.
 * Comments are dropped first, for the same reason as the CSS ones: the fix is
 * explained by quoting what it replaced.
 */
function inlineDeclarations(src) {
  return [...stripHbsComments(src).matchAll(/style="([^"]*)"/g)]
    .flatMap((m) => m[1].split(";"))
    .map((d) => d.trim())
    .filter(Boolean);
}

describe("§51 a url never reaches the page through a variable", () => {
  test("there are style attributes to check", () => {
    // A rename of the attribute or of templates/ would make every assertion
    // below vacuously true, which is how a guard quietly stops guarding.
    const all = templates().flatMap((t) => inlineDeclarations(read(t)));
    assert.ok(all.length >= 4,
      `found ${all.length} inline declarations across the templates; the scan ` +
      "is no longer looking at anything");
  });

  test("no template declares a custom property holding a url()", () => {
    const offenders = [];
    for (const tpl of templates()) {
      for (const decl of inlineDeclarations(read(tpl))) {
        if (/^--/.test(decl) && /url\(/.test(decl)) offenders.push(`${tpl}: ${decl}`);
      }
    }
    assert.deepEqual(offenders, [],
      "a relative url() inside a custom property is resolved against the " +
      "stylesheet that substitutes it, not against the document — it will " +
      "404 with the stylesheet's directory prepended. Put the url straight " +
      "into the property that consumes it (mask-image, background-image), " +
      `which the style attribute resolves from the document:\n  ${offenders.join("\n  ")}`);
  });

  test("the stylesheet takes no image from a variable", () => {
    // The other end of the same route. A custom property is the only way a url
    // gets from markup into this file, and an image-valued property is the only
    // place it could be going.
    const hits = css.split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) =>
        /(?:-webkit-)?(?:mask|background|border|list-style|content|cursor)[a-z-]*\s*:[^;]*var\(--[a-z-]*(?:icon|img|image|url|sprite|badge)/i.test(line));
    assert.deepEqual(hits.map(([n, l]) => `${n}: ${l.trim()}`), [],
      "an image arriving as var() came from a custom property in markup, and " +
      "Chromium will rebase its url against this stylesheet");
  });

  test("the status icon is a document element, not a painted background", () => {
    // The strongest version of the guard: an <img src> is resolved by the HTML
    // parser against the document and cannot be rebased by any stylesheet.
    const tpl = read("templates/actor/status-palette.hbs");
    assert.match(tpl, /<img[^>]*class="la-status__icon"[^>]*src="\{\{this\.img\}\}"/,
      "the badge must arrive as an <img>; a CSS image on this element is what " +
      "put the url through the stylesheet in the first place");

    const start = css.indexOf(".la-status__icon {");
    assert.ok(start !== -1, "lost .la-status__icon");
    const rule = css.slice(start, css.indexOf("}", start));
    assert.doesNotMatch(rule, /(?:-webkit-)?mask|background-image|content\s*:/,
      "an <img> is already showing the badge; a second image here is either " +
      "dead weight or a url this file will rebase");
  });
});

describe("§51 the status icon path is one the document can resolve", () => {
  /**
   * The url the palette hands out, rebuilt the way `registerStatusEffects`
   * builds it. Read from the source rather than hardcoded so a change to the
   * shape of the path is caught here instead of in a live world.
   */
  const built = read("module/last-arc.mjs")
    .match(/img:\s*`([^`]*\$\{id\}[^`]*)`/)?.[1]
    ?.replace("${SYSTEM_ID}", SYSTEM_ID);

  test("the path is still built where this test thinks it is", () => {
    assert.ok(built, "no `img:` template literal in registerStatusEffects");
  });

  test("it is document-relative, as Foundry and the token HUD expect", () => {
    // Not root-absolute: a Foundry served under a route prefix answers on
    // /<prefix>/systems/…, and a leading slash would miss it. Document-relative
    // is right in both deployments — it just has to be RESOLVED that way.
    assert.ok(built.startsWith(`systems/${SYSTEM_ID}/`),
      `status icons are served from systems/${SYSTEM_ID}/, got "${built}"`);
    assert.doesNotMatch(built, /^[/]|^[a-z]+:/,
      "an absolute path breaks a Foundry running under a route prefix");
  });

  test("every icon it names ships in the repo", () => {
    // `systems/last-arc/x` is this repo's `x` once the system is installed, so
    // the tail of the path is a path from the repo root.
    const missing = LASTARC.allStatusIds.filter((id) =>
      !existsSync(at(built.replace("${id}", id).slice(`systems/${SYSTEM_ID}/`.length))));
    assert.deepEqual(missing, [],
      `the palette points at files that are not here: ${missing.join(", ")}`);
  });
});
