/**
 * Symlink this repo into a Foundry data directory for live development.
 *
 * A symlink rather than a copy so edits here are picked up by a browser reload
 * instead of needing a redeploy step. Foundry follows symlinks in
 * `Data/systems/` without complaint.
 *
 *   node tools/link-system.mjs [--dataPath=<path>] [--unlink]
 *
 * `--dataPath` defaults to $FOUNDRY_DATA_PATH, then to ~/foundry/data, which is
 * the layout the README suggests.
 */

import { symlinkSync, unlinkSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const has = (name) => process.argv.includes(`--${name}`);

const dataPath = resolve(
  arg("dataPath") ?? process.env.FOUNDRY_DATA_PATH ?? join(homedir(), "foundry/data")
);

const systemsDir = join(dataPath, "Data", "systems");
const linkPath = join(systemsDir, "last-arc");

/* -------------------------------------------------------------------------- */

if (!existsSync(dataPath)) {
  console.error(
    `Foundry data path not found: ${dataPath}\n` +
    `Start the Node build once so it creates the directory, or pass --dataPath=<path>.`
  );
  process.exit(1);
}

if (has("unlink")) {
  if (!existsSync(linkPath)) {
    console.log(`Nothing to remove at ${linkPath}`);
    process.exit(0);
  }
  // Refuse to delete a real directory. If someone copied the system in by hand,
  // removing it here would destroy work rather than detach a link.
  if (!lstatSync(linkPath).isSymbolicLink()) {
    console.error(
      `${linkPath} is a real directory, not a symlink. Refusing to delete it — ` +
      `remove it by hand if that is really what you want.`
    );
    process.exit(1);
  }
  unlinkSync(linkPath);
  console.log(`Unlinked ${linkPath}`);
  process.exit(0);
}

mkdirSync(systemsDir, { recursive: true });

if (existsSync(linkPath)) {
  const isLink = lstatSync(linkPath).isSymbolicLink();
  if (!isLink) {
    console.error(
      `${linkPath} already exists and is a real directory. Move it aside first — ` +
      `overwriting it would delete whatever is there.`
    );
    process.exit(1);
  }
  const current = realpathSync(linkPath);
  if (current === root) {
    console.log(`Already linked: ${linkPath} → ${root}`);
    process.exit(0);
  }
  unlinkSync(linkPath);
}

symlinkSync(root, linkPath, "dir");
console.log(`Linked ${linkPath} → ${root}`);
console.log(`Restart Foundry (or return to setup and back) to pick up the system.`);
