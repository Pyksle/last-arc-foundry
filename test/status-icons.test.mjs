/**
 * Token status badges (issue #43).
 *
 * The GM's report: two colour-blind players, one losing their sight, and
 * telling the badges apart at a glance needs zooming in. The old badge was a
 * stroked glyph with a halo, and I had checked it at 44px — a token draws them
 * at roughly 24.
 *
 * Three things are asserted here, in descending order of how much they matter
 * to the people who reported the problem:
 *
 *   1. FIGURE-GROUND. A filled disc replaces the map inside the badge, so the
 *      glyph is read against a known colour instead of against grass or stone.
 *      This is what helps all three players, and it is not about colour at all.
 *   2. INK CONTRAST. The glyph must be legible on its own disc.
 *   3. COLOUR SEPARATION, simulated against the three dichromacies. Colour is
 *      the second channel, so this is the least important of the three — but
 *      getting it wrong makes four of the nine families collide for two of the
 *      players, which is worse than not colouring them at all.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { LASTARC } from "../module/config.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const icon = (id) => readFileSync(root(`assets/status/${id}.svg`), "utf8");

/* ── colour maths ─────────────────────────────────────────────────────────── */

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const hex = (c) => "#" + c.map((v) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

const luminance = (h) => { const [r, g, b] = rgb(h).map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Viénot–Brettel–Mollon dichromacy simulation. */
const RGB2LMS = [[0.31399022, 0.63951294, 0.04649755], [0.15537241, 0.75789446, 0.08670142], [0.01775239, 0.10944209, 0.87256922]];
const LMS2RGB = [[5.47221206, -4.6419601, 0.16963708], [-1.1252419, 2.29317094, -0.1678952], [0.02980165, -0.19318073, 1.16364789]];
const SIM = {
  protan: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]]
};
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const simulate = (h, kind) => kind === "normal" ? h
  : hex(mul(LMS2RGB, mul(SIM[kind], mul(RGB2LMS, rgb(h).map(toLinear)))).map(fromLinear));

const lab = (h) => {
  const [r, g, b] = rgb(h).map(toLinear);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047),
                     f(0.2126 * r + 0.7152 * g + 0.0722 * b),
                     f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (a, b) => {
  const [la, aa, ba] = lab(a), [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
};

/* ── the guards ───────────────────────────────────────────────────────────── */

describe("§43 every status is drawn, and drawn in a family", () => {
  test("every registered status has an icon file", () => {
    const onDisk = new Set(readdirSync(root("assets/status")).map((f) => f.replace(".svg", "")));
    const missing = LASTARC.allStatusIds.filter((id) => !onDisk.has(id));
    assert.deepEqual(missing, [], `no badge for: ${missing.join(", ")}`);
  });

  test("every registered status belongs to exactly one family", () => {
    const families = Object.entries(LASTARC.statusFamilies);
    for (const id of LASTARC.allStatusIds) {
      const hits = families.filter(([, ids]) => ids.includes(id)).map(([f]) => f);
      assert.equal(hits.length, 1,
        `${id} is in ${hits.length} families (${hits.join(", ") || "none"}) — a status ` +
        "with no family would be drawn in a default colour nobody chose");
    }
  });

  test("no family names a status that does not exist", () => {
    const real = new Set(LASTARC.allStatusIds);
    for (const [family, ids] of Object.entries(LASTARC.statusFamilies)) {
      for (const id of ids) {
        assert.ok(real.has(id), `${family} names "${id}", which is not a status`);
      }
    }
  });

  test("every family has a colour", () => {
    for (const family of Object.keys(LASTARC.statusFamilies)) {
      assert.ok(LASTARC.statusFamilyColours[family], `${family} has no disc colour`);
    }
  });
});

describe("§43 figure-ground: the badge replaces the map behind the glyph", () => {
  for (const id of LASTARC.allStatusIds) {
    test(`${id} has a filled disc and both rings`, () => {
      const svg = icon(id);
      const family = LASTARC.statusFamilyOf(id);
      const { disc } = LASTARC.statusFamilyColours[family];

      assert.match(svg, new RegExp(`<circle[^>]*r="27"[^>]*fill="${disc}"`),
        "no filled disc — the glyph would be read against whatever map is behind it");
      // A light disc vanishes on a light map and a dark one on a dark map, so
      // the badge carries a dark ring outside a light one. Whichever way the
      // map goes, one of the two separates the badge from it.
      assert.match(svg, /r="31"[^>]*fill="#12100e"/, "no dark outer ring");
      assert.match(svg, /r="29\.5"[^>]*stroke="#f7f5ef"/, "no light inner ring");
    });
  }
});

describe("§43 the glyph is legible on its own disc", () => {
  for (const [family, { disc, ink }] of Object.entries(LASTARC.statusFamilyColours)) {
    test(`${family}: ${ink} on ${disc}`, () => {
      const ratio = contrast(disc, ink);
      assert.ok(ratio >= 4.5,
        `${family} draws its glyph at ${ratio.toFixed(2)}:1 on its own disc`);
    });
  }

  test("no icon still uses currentColor", () => {
    // `currentColor` does not inherit from the surrounding stroke, and in a
    // texture rasterised outside the document it resolves to plain black. Eight
    // glyphs fill an interior detail that way; on the four dark discs that put
    // a black pip on a near-black ground and the incorporeal ghost lost both
    // its eyes.
    const offenders = LASTARC.allStatusIds.filter((id) => icon(id).includes("currentColor"));
    assert.deepEqual(offenders, [],
      `these resolve to black regardless of their disc: ${offenders.join(", ")}`);
  });
});

describe("§43 the families stay apart for the players this is for", () => {
  const families = Object.keys(LASTARC.statusFamilyColours);
  const discOf = (f) => LASTARC.statusFamilyColours[f].disc;

  /**
   * ΔE 14 is the floor, not a target. Below roughly 12 two colours are a
   * coin-flip side by side; the naive reading of the GM's colour names put
   * pink/green at 15.9 and red/green at 19.2 under deuteranopia, and pink/grey
   * at 9.6 under protanopia. Colour is the second channel here — the glyph
   * carries the meaning — but a palette that collapses is worse than none,
   * because it implies a distinction that is not there.
   */
  const FLOOR = 14;

  for (const kind of ["normal", "protan", "deutan", "tritan"]) {
    test(`${kind}: no two families collide`, () => {
      const collisions = [];
      for (let i = 0; i < families.length; i++) {
        for (let j = i + 1; j < families.length; j++) {
          const d = deltaE(simulate(discOf(families[i]), kind), simulate(discOf(families[j]), kind));
          if (d < FLOOR) collisions.push(`${families[i]}/${families[j]} ΔE ${d.toFixed(1)}`);
        }
      }
      assert.deepEqual(collisions, [],
        `indistinguishable under ${kind}: ${collisions.join(", ")}`);
    });
  }

  test("and they stay apart with no colour vision at all", () => {
    // The third player is losing their sight, not their colour vision — but a
    // lightness ladder is the one ordering every kind of vision retains, so it
    // is the cheapest possible insurance and worth holding onto deliberately.
    const ls = families.map((f) => [f, lab(discOf(f))[0]]).sort((a, b) => a[1] - b[1]);
    for (let i = 1; i < ls.length; i++) {
      const gap = ls[i][1] - ls[i - 1][1];
      assert.ok(gap >= 4,
        `${ls[i - 1][0]} and ${ls[i][0]} are ${gap.toFixed(1)} apart in lightness`);
    }
  });
});

describe("§43 the shipped icons match the generator", () => {
  test("regenerating produces no change", () => {
    // The assets are committed, so editing the palette without re-running the
    // generator would ship a config that describes icons nobody has. This is
    // the drift that put an empty compendium in ten releases.
    const before = Object.fromEntries(LASTARC.allStatusIds.map((id) => [id, icon(id)]));
    execFileSync("node", [root("tools/make-status-icons.mjs")], { cwd: root(".") });
    const changed = LASTARC.allStatusIds.filter((id) => icon(id) !== before[id]);
    assert.deepEqual(changed, [],
      `assets/status is stale — run \`node tools/make-status-icons.mjs\`: ${changed.join(", ")}`);
  });
});
