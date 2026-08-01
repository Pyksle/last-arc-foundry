# Last Arc: Tactics Analogue — Foundry VTT System

An unofficial Foundry VTT v13+ implementation of *Last Arc: Tactics Analogue*.

> **This system ships with empty compendia.** No game content is distributed. See
> [Content](#content) below.

## Status

Playable. Every subsystem below has been driven end to end in a live world, not
only unit tested.

- Character and NPC data models with full derived-stat computation
- All 17 item subtypes, each creatable and editable by hand in the UI
- Character, NPC and item sheets (ApplicationV2), light and dark
- Skill, weapon-skill and attribute rolls
- **Break Gauge** with its death spiral, recovery banking, and named persistent
  conditions cleared individually
- Attack and damage pipeline: exploding dice with the doubled-explosion variant,
  Combo and Critical riders, mitigation, and the Break Threshold check
- **Magick** — the Spellcraft check's tiered outcomes, opposed branches, mana,
  casting defensively, and all six High Arcana
- **Performances** — Perform checks, the one-per-side replacement rule, and the
  specialisation-dependent defensive penalty
- Statblock attacks, so a GM can run a monster from its own sheet
- **Counterattacks**, including the rule that one beating your Break Threshold
  destroys a casting and wastes the mana
- **Block** — the shield reaction, offered on any card whose roll targets your
  Reflex, with the cumulative penalty for repeat blocks before your next turn
  and the skill your shield's relative size dictates
- Healing that shows its arithmetic: what was rolled, what landed, and what was
  wasted against the maximum
- Inverted initiative (class dice, lowest acts first), Hold Turn, group
  initiative, round-1 flat-footed
- Action economy with downgrades and the banked-minor interrupt rule
- All four hero point spends, Second Wind, rest, and the Injury &
  Dismemberment chart
- 33 statuses and curses with mechanical payloads and original icon art
- Hand-authoring of all 17 item subtypes from the sheet they belong on, which is
  how content gets in — see [Content](#content)
- Manual ordering of every item list, and Second Wind tracked as boxes you tick
  and untick yourself

Not implemented: a bulk importer for the rulebook (there is no legal source to
import from), airships (out of scope), and advanced classes / Aeons / optional
rules, which the demo does not include.

## Install

Paste this manifest URL into Foundry's *Install System* dialog:

```
https://raw.githubusercontent.com/Pyksle/last-arc-foundry/main/system.json
```

## Content

*Last Arc: Tactics Analogue* and all its game content — rules text, item and spell
names and descriptions, bestiary entries, setting material, and artwork — are the
property of **Old World Studios Inc.** This project is unofficial and is not
affiliated with, endorsed by, or sponsored by them.

This repository contains **no game content**. The compendium packs listed in
`system.json` ship empty, and they stay empty — there is no download that fills
them.

**You enter content by hand, from your own copy of the book.** Every panel on the
character sheet has an *Add* row at its foot — weapons, spells, performances,
technicks and talents, race and class features, equipment — and the NPC sheet has
one too. Clicking it asks for a name, then opens that item's sheet so you can type
in the numbers your book prints. Anything you make can be dragged into a
compendium of your own to reuse across worlds.

The code in this repository is MIT licensed — see [LICENSE](LICENSE).

## Development

```bash
npm test
```

### Integration tests against a headless Foundry

The unit suite verifies the *maths*. It cannot verify that the maths is wired to
Foundry correctly — document creation, derived data on live actors, Active Effect
ordering, sheet rendering, combat sorting. That needs a real Foundry, and
"headless Foundry" is not a flag: it is the **Node.js build**, which has no
Electron GUI and simply serves the app over HTTP.

**One-time setup** (needs your Foundry licence — this part cannot be automated):

1. On foundryvtt.com, go to your purchased licences and pick **Node.js** from the
   operating-system dropdown, not the macOS/Windows application build.
2. Extract it, and make a separate data directory:

   ```bash
   mkdir -p ~/foundry/app ~/foundry/data
   ```

3. Launch it. Two path gotchas: in **v13 `main.js` sits at the top level** of the
   archive (older versions nested it under `resources/app/`), but the archive
   **extracts into its own versioned folder**, so the real path includes that:

   ```bash
   node ~/foundry/app/FoundryVTT-Node-13.351/main.js --dataPath=$HOME/foundry/data --port=30000
   ```

   Adjust the version folder to match what you downloaded. If in doubt:

   ```bash
   find ~/foundry/app -maxdepth 3 -name main.js
   ```

4. Open <http://localhost:30000>, paste your licence key and accept the EULA.
   This persists to `~/foundry/data/Config/`, so it is genuinely one-time.
5. Install the **Quench** module (Add-on Modules → Install Module → search
   "Quench"). It is the in-Foundry Mocha/Chai runner the batches register with.

**Then, from this repo:**

```bash
npm run link
```

That symlinks the repo into `~/foundry/data/Data/systems/last-arc`, so edits here
are picked up by a browser reload rather than needing a redeploy. Create a world
using the Last Arc system, enable Quench in it, and:

```bash
npm i -D playwright && npx playwright install chromium
npm run test:integration
```

Playwright is deliberately *not* a hard dependency — installing it downloads
~100MB of browser binaries, which has no business being mandatory for someone who
only wants to run the unit suite. Install it with `-D` if you like; just don't
commit the manifest change.

Useful flags: `--headed` to watch it run, `--url=` for a non-default host,
`--dataPath=` on `npm run link` if your data directory is elsewhere (it also
honours `$FOUNDRY_DATA_PATH`).

**Close any browser tab sitting in the world first.** Foundry disables the
`<option>` for a user who is already logged in, so leaving a tab open on the
Gamemaster session means the driver has no free user to join as. It will say so
rather than hanging.

> **macOS: `ERR_DLOPEN_FAILED` on `classic-level.node`.** Gatekeeper refuses to
> load the unsigned native LevelDB binary while the download quarantine flag is
> set, and the server dies on boot with `library load disallowed by system
> policy`. Clear it on the app directory only:
>
> ```bash
> xattr -dr com.apple.quarantine ~/foundry/app
> ```

> **Node version.** Foundry v13 requires Node 22+. Newer majors generally work but
> are not what upstream tests against — if the server misbehaves on a very recent
> Node, drop to 22 LTS via `nvm` before assuming the system is at fault.

### Previewing sheets without Foundry

To inspect the sheet without a Foundry install:

```bash
node tools/preview.mjs --theme=light && open preview.html
```

This renders the real Handlebars templates against a synthetic level-5
Warrior/Rogue — deliberately a messy case, with a Break step, a persistent
condition, and non-proficient heavy armour, so the death spiral and the armour
check penalty are both visible. Pass `--theme=dark` for the other palette.

The test suite runs under plain Node with no Foundry install required. That is
deliberate: all derivation math lives in `module/derivation.mjs`, which imports
nothing from Foundry, and the data models are thin wrappers over it. Two suites:

- `test/derivation.test.mjs` — the §4 and §5.5 math, including the Break Gauge
  death spiral and the pre/post-DR Threshold question.
- `test/integrity.test.mjs` — cross-references config, templates, localisation,
  and `system.json` so dangling keys and unwired sheet buttons fail the build
  rather than surfacing as a broken sheet.

### Layout

```
module/
  config.mjs        static tables — Foundry-free
  derivation.mjs    all derived-stat math — Foundry-free, unit tested
  last-arc.mjs      entry point; the only file touching Foundry globals at load
  data/             TypeDataModel subclasses (character, npc)
  sheets/           ApplicationV2 sheets
  dice/             roll pipeline
templates/actor/    Handlebars templates
styles/             CSS-only theming, no shipped art
lang/               localisation
```

### Things that will bite you

Three places where this system's rules run against Foundry's defaults or against
ordinary intuition. All three are commented at the relevant code, but they are
worth knowing before reading anything:

1. **Break Gauge steps run 0→5 as the character gets *worse*, and the penalties
   at those steps are `0, −1, −2, −5, −10, unconscious`.** Two different number
   sequences. Say "worsen"/"improve", never "+1 step"/"−1 step".
2. **Initiative is inverted** — a class die, not a d20, and *lowest acts first*.
   Sorting is overridden rather than storing negated values.
3. **Active Effects apply *between* `prepareBaseData` and `prepareDerivedData`.**
   Anything computed in `prepareDerivedData` silently overwrites an AE targeting
   the same path. The break penalty → defences → Fortitude → Threshold chain is
   therefore computed in code; AEs feed the `misc`/`technicks` inputs instead.
4. **An automatic hit does not close the reaction window.** Block and Dodge are
   *opposed reactions*, not defence comparisons, so a natural 20 is still
   blockable and dodgeable. `resolveAttack` returns `reactionWindowOpen` on
   auto-hits specifically so callers cannot short-circuit it.
5. **Exploding dice are capped on TOTAL dice, not recursion depth.** The
   doubled-explosion variant is a branching process — a depth cap of *N* permits
   2^*N* rolls. The cascade also only terminates while `k/faces < 1`, so a d2
   with the doubled variant is exactly critical.
6. **Banked minor actions survive the turn boundary but not an interruption.**
   A Recovery spans turns by design; *any* intervening action breaks it —
   including a reaction taken on someone else's turn. Resetting the bank in
   `beginTurn` would quietly make Recovery single-turn-only.
7. **Turn order is a separate key from the initiative roll.** Hold Turn
   permanently reorders the tracker, so order genuinely diverges from what was
   rolled. The displayed initiative stays the die result.
