/**
 * Generate the status effect icon set.
 *
 * `registerStatusEffects()` points at systems/last-arc/assets/status/*.svg. Those
 * files did not exist, so every status badge on a token was a broken image.
 *
 * These are ORIGINAL glyphs built from primitive shapes — deliberately not
 * traced or derived from the rulebook, which would be exactly the kind of asset
 * §17 says must never ship. They are monochrome and use `currentColor` so
 * Foundry's token badge tinting works.
 *
 *   node tools/make-status-icons.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "assets/status");

/** Wrap glyph body in a consistent 64×64 frame. */
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" ` +
  `fill="none" stroke="currentColor" stroke-width="3.5" ` +
  `stroke-linecap="round" stroke-linejoin="round">\n${body}\n</svg>\n`;

/**
 * An Archimedean spiral as a polyline, for `unconscious`.
 *
 * The one glyph that is computed rather than hand-drawn. Getting a spiral right
 * with SVG arc flags is fiddly and easy to get subtly wrong; sampling r = a·θ is
 * exact. Everything else stays literal.
 */
function spiral({ cx = 32, cy = 32, turns = 1.9, rMax = 17, steps = 160 } = {}) {
  const thetaMax = turns * 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * thetaMax;
    const r = (rMax * t) / thetaMax;
    pts.push(`${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`);
  }
  return `<path d="M${pts.join("L")}"/>`;
}

/**
 * One glyph per status. Kept literal and readable rather than clever — these
 * are read far more often than they are written, and a parametric generator
 * would make "what does petrify look like?" hard to answer.
 */
const GLYPHS = {
  // ── Senses & mind ─────────────────────────────────────────────────────────
  blind: `<path d="M6 32c8-11 17-16 26-16s18 5 26 16c-8 11-17 16-26 16S14 43 6 32z"/>
<circle cx="32" cy="32" r="7"/><path d="M12 52 52 12"/>`,

  confusion: `<path d="M22 24a10 10 0 1 1 13 10v6"/><circle cx="35" cy="50" r="2.5" fill="currentColor" stroke="none"/>
<path d="M12 14l-4 8 8-2M52 14l4 8-8-2"/>`,

  silence: `<path d="M20 26h-8v12h8l12 10V16z"/><path d="M42 26l14 12M56 26 42 38"/>`,

  sleep: `<path d="M40 10a22 22 0 1 0 14 40A24 24 0 0 1 40 10z"/>
<path d="M44 12h10l-10 12h10" stroke-width="3"/>`,

  // ── Body ──────────────────────────────────────────────────────────────────
  // A pathogen cluster, NOT a radiating circle — an earlier version of this
  // glyph was a sun burst and was indistinguishable from `dim` at badge size.
  disease: `<circle cx="32" cy="32" r="15"/>
<circle cx="26" cy="27" r="3.5" fill="currentColor" stroke="none"/>
<circle cx="38" cy="33" r="3" fill="currentColor" stroke="none"/>
<circle cx="29" cy="39" r="2.5" fill="currentColor" stroke="none"/>
<path d="M32 17V9M47 32h8M32 47v8M17 32H9"/>`,

  poison: `<path d="M32 8c10 12 16 20 16 28a16 16 0 0 1-32 0c0-8 6-16 16-28z"/>
<path d="M26 34l12 12M38 34 26 46"/>`,

  paralysis: `<path d="M36 6 16 34h12l-4 24 22-30H34z"/>`,

  petrify: `<path d="M14 22 30 8l22 8 4 22-16 18-20-4z"/><path d="M30 8l4 26 22 4M34 34 22 54"/>`,

  // drench and oil both began as bare droplets and were indistinguishable.
  // Each now carries the vulnerability it confers: waves for cold/electric,
  // a flame for fire.
  drench: `<path d="M32 6c8 11 13 18 13 24a13 13 0 0 1-26 0c0-6 5-13 13-24z"/>
<path d="M8 50c5-4 8-4 12 0s7 4 12 0 8-4 12 0 7 4 12 0"/>
<path d="M8 58c5-4 8-4 12 0s7 4 12 0 8-4 12 0 7 4 12 0"/>`,

  oil: `<path d="M20 62c-6-3-9-9-9-15 0-8 8-14 8-22 6 3 9 8 9 13 3-4 4-9 3-14 8 5 15 14 15 23 0 7-4 13-10 15"/>
<path d="M32 62c-4-2-6-5-6-9 0-5 6-8 6-13 4 4 6 8 6 13 0 4-2 7-6 9z"/>`,

  // ── Position & restraint ──────────────────────────────────────────────────
  prone: `<path d="M8 48h48"/><circle cx="18" cy="38" r="6"/><path d="M24 42h20l8-6"/>`,

  helpless: `<circle cx="32" cy="18" r="8"/><path d="M20 52c0-8 5-14 12-14s12 6 12 14"/>
<path d="M10 30l10 6M54 30l-10 6"/>`,

  // "Out cold" as a spiral. The first draft was a slumped figure, which at 24px
  // was indistinguishable from `helpless` — and `unconscious`, `prone` and
  // `helpless` are all applied together at 0 HP (§5.6), so they sit side by side
  // on one token and MUST stay tellable apart. The spiral is the only unused
  // shape in the set: every other glyph is a figure, a circle-with-contents, or
  // an object silhouette.
  unconscious: spiral(),

  flatFooted: `<path d="M32 6v22M32 40v4"/><circle cx="32" cy="32" r="24"/>
<circle cx="32" cy="46" r="2.5" fill="currentColor" stroke="none"/>`,

  // ── Applied by spells ─────────────────────────────────────────────────────
  // Each deliberately claims shape-space nothing else uses. `doom` already owns
  // the skull and `withering` the plant, so zombified takes the headstone.
  zombified: `<path d="M16 58V26a16 16 0 0 1 32 0v32z"/>
<path d="M26 38h12M32 32v14"/><path d="M12 58h40"/>`,

  // A rewind chevron pair. Not a clock — `exhaustion` is the clock.
  slowed: `<path d="M34 16 18 32l16 16"/><path d="M50 16 34 32l16 16"/>`,

  // The only dashed glyph in the set, which is the whole point: at badge size
  // "not entirely there" reads faster than any figure would.
  incorporeal: `<path d="M20 54V28a12 12 0 0 1 24 0v26l-6-5-6 5-6-5z"
stroke-dasharray="5 4"/>
<circle cx="27" cy="30" r="2.5" fill="currentColor" stroke="none"/>
<circle cx="37" cy="30" r="2.5" fill="currentColor" stroke="none"/>`,

  charmed: `<path d="M32 54S12 40 12 27a10 10 0 0 1 20-4 10 10 0 0 1 20 4c0 13-20 27-20 27z"/>`,

  grabbed: `<path d="M18 40V20a4 4 0 0 1 8 0v14M26 34V16a4 4 0 0 1 8 0v18M34 34V20a4 4 0 0 1 8 0v16
M42 30a4 4 0 0 1 8 0v10c0 10-8 16-16 16s-16-6-16-16"/>`,

  pinned: `<path d="M32 8v34"/><path d="M22 42h20l-10 14z"/><path d="M12 20h40"/>`,

  encumbered: `<path d="M16 24h32l4 32H12z"/><path d="M24 24v-6a8 8 0 0 1 16 0v6"/>`,

  overencumbered: `<path d="M16 24h32l4 32H12z"/><path d="M24 24v-6a8 8 0 0 1 16 0v6"/>
<path d="M14 14 50 50"/>`,

  // ── Curses ────────────────────────────────────────────────────────────────
  agony: `<path d="M32 6 38 26h20L42 38l6 20-16-12-16 12 6-20L6 26h20z"/>`,

  exhaustion: `<path d="M32 6a26 26 0 1 0 26 26"/><path d="M32 18v14l10 6"/>
<path d="M44 6h14M44 14h10"/>`,

  misfortune: `<rect x="12" y="12" width="40" height="40" rx="6"/>
<circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/>
<circle cx="40" cy="40" r="3" fill="currentColor" stroke="none"/>
<path d="M12 52 52 12"/>`,

  withering: `<path d="M32 56V28"/><path d="M32 28c0-8-6-14-14-14 0 8 6 14 14 14z"/>
<path d="M32 34c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M22 56h20"/>`,

  dim: `<circle cx="32" cy="32" r="12"/><path d="M32 4v8M32 52v8M4 32h8M52 32h8"/>
<path d="M14 14l6 6M44 44l6 6"/>`,

  doom: `<path d="M32 6c12 0 20 9 20 20 0 8-4 12-4 18H16c0-6-4-10-4-18 0-11 8-20 20-20z"/>
<circle cx="24" cy="26" r="4" fill="currentColor" stroke="none"/>
<circle cx="40" cy="26" r="4" fill="currentColor" stroke="none"/>
<path d="M20 50h24M24 50v8M32 50v8M40 50v8"/>`,

  lycanthropy: `<path d="M10 20l8 6 6-14 8 12 8-12 6 14 8-6-4 26c0 10-8 16-18 16s-18-6-18-16z"/>
<circle cx="25" cy="34" r="3" fill="currentColor" stroke="none"/>
<circle cx="39" cy="34" r="3" fill="currentColor" stroke="none"/>`,

  vampyrism: `<path d="M16 12h32v18c0 14-10 22-16 26-6-4-16-12-16-26z"/>
<path d="M26 30l6 10 6-10"/>`
};

/* -------------------------------------------------------------------------- */

mkdirSync(outDir, { recursive: true });

const expected = LASTARC.allStatusIds;
const missing = expected.filter((id) => !GLYPHS[id]);
const extra = Object.keys(GLYPHS).filter((id) => !expected.includes(id));

if (missing.length) {
  console.error(`Missing glyphs for: ${missing.join(", ")}`);
  process.exitCode = 1;
}
if (extra.length) {
  console.warn(`Glyphs with no matching status: ${extra.join(", ")}`);
}

let written = 0;
for (const [id, body] of Object.entries(GLYPHS)) {
  if (!expected.includes(id)) continue;
  writeFileSync(join(outDir, `${id}.svg`), svg(body.trim()), "utf8");
  written++;
}

console.log(`Wrote ${written} status icons to assets/status/`);
