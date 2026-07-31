# Last Arc: Tactics Analogue — Foundry VTT System

An unofficial Foundry VTT v13+ implementation of *Last Arc: Tactics Analogue*.

> **This system ships with empty compendia.** No game content is distributed. See
> [Content](#content) below.

## Status

Phase 1 of 6, plus the item layer. What works today:

- Character and NPC data models with full derived-stat computation
- Data models for all 17 item subtypes
- Character, NPC, and item sheets (ApplicationV2)
- Skill, weapon-skill, and attribute rolls with chat output
- Break Gauge widget with recovery tracking and persistent-condition floors
- Technicks and talents that feed derived values automatically, with live
  prerequisite checking
- Inventory with bulk-driven encumbrance and exclusive armour/shield equipping
- Attack rolls with Combo/Critical riders, and a damage pipeline with exploding
  dice (including the doubled-explosion variant)
- Chat cards with damage application, mitigation, and Break Threshold checks
- Inverted initiative sorting (lowest acts first)

| Phase | Deliverable | Status |
|---|---|---|
| 1 | Data models, actor sheet, derived stats, skill rolls | ✅ |
| 1+ | Item data models, item sheets, technick wiring, inventory | ✅ |
| 2 | Attack/damage pipeline, exploding dice, weapon rolls | ✅ |
| 3 | Break Gauge Active Effects | ⬜ |
| 4 | Initiative + action economy tracking | ⬜ |
| 5 | Compendium ingestion | ⬜ |
| 6 | Technick/talent automation | ⬜ |

## Install

Paste this manifest URL into Foundry's *Install System* dialog:

```
<manifest URL once published>
```

## Content

*Last Arc: Tactics Analogue* and all its game content — rules text, item and spell
names and descriptions, bestiary entries, setting material, and artwork — are the
property of **Old World Studios Inc.** This project is unofficial and is not
affiliated with, endorsed by, or sponsored by them.

This repository contains **no game content**. The compendium packs listed in
`system.json` ship empty and must be populated from your own licensed copy of the
rulebook using the importer (Phase 5).

The code in this repository is MIT licensed — see [LICENSE](LICENSE).

## Development

```bash
npm test
```

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
