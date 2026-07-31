/**
 * Build the release archive Foundry downloads when installing or updating.
 *
 * Foundry's update flow has two halves and both must line up:
 *
 *   1. It fetches the `manifest` URL and compares that file's `version` with
 *      the installed one. Equal means "no update available" — which is what a
 *      forgotten version bump looks like from the user's side: commits land,
 *      the manifest is served, and Foundry cheerfully reports nothing new.
 *   2. If newer, it downloads the `download` URL and expects a zip with
 *      `system.json` AT THE ROOT.
 *
 * That second point is why this script exists rather than a link to GitHub's
 * auto-generated source archive. `archive/refs/heads/main.zip` wraps everything
 * in a `last-arc-foundry-main/` directory, and it always serves whatever main
 * happens to be — so a user installing "0.2.0" could receive something else
 * entirely. A built, tagged asset is reproducible.
 *
 *   node tools/build-release.mjs [--out=dist]
 */

import { readFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const outDir = join(root, arg("out") ?? "dist");
const manifest = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));
const { id, version } = manifest;

/**
 * What ships.
 *
 * Everything Foundry loads at runtime, and nothing else. `packs/` is
 * deliberately absent: the directories are created on demand at world load
 * (verified against a live server with them removed), and shipping them would
 * imply content that is not ours to distribute. `test/`, `tools/` and
 * `node_modules/` are development-only.
 */
const INCLUDE = [
  "system.json",
  "LICENSE",
  "README.md",
  "module",
  "templates",
  "styles",
  "lang",
  "assets"
];

const missing = INCLUDE.filter((p) => !existsSync(join(root, p)));
if (missing.length) {
  console.error(`Cannot build: these are declared but absent — ${missing.join(", ")}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

const stage = join(outDir, id);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const rel of INCLUDE) {
  cpSync(join(root, rel), join(stage, rel), {
    recursive: true,
    // .DS_Store in a published archive is untidy at best and, on a case-folding
    // filesystem, occasionally worse.
    filter: (src) => !src.endsWith(".DS_Store")
  });
}

// Zip from INSIDE the staging directory so system.json lands at the archive
// root. Zipping the directory itself would reproduce exactly the wrapper
// problem this script exists to avoid.
const zipPath = join(outDir, `${id}-${version}.zip`);
execFileSync("zip", ["-qr", zipPath, "."], { cwd: stage });

rmSync(stage, { recursive: true, force: true });

/* --- verify what we just made --------------------------------------------- */

const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
  .split("\n").filter(Boolean);

if (!listing.includes("system.json")) {
  console.error(
    `Built archive has no system.json at its root — Foundry will reject it.\n` +
    `Root entries: ${[...new Set(listing.map((f) => f.split("/")[0]))].join(", ")}`
  );
  process.exit(1);
}

// The manifest inside the archive must agree with the one being served, or an
// install reports a different version from the update that offered it.
const inner = JSON.parse(
  execFileSync("unzip", ["-p", zipPath, "system.json"], { encoding: "utf8" })
);
if (inner.version !== version) {
  console.error(`Archive says ${inner.version}, repo says ${version}.`);
  process.exit(1);
}

const size = (execFileSync("wc", ["-c", zipPath], { encoding: "utf8" }).trim().split(/\s+/)[0] / 1024);
console.log(`${zipPath}`);
console.log(`  version ${version}, ${listing.length} entries, ${size.toFixed(0)} KB`);
console.log(`  download URL must be: ${manifest.download}`);
