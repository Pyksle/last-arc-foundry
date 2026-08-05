# Working in this repository

An unofficial Foundry VTT v13 system for *Last Arc: Tactics Analogue*.

Read this before changing anything. The integrity suite enforces a lot of
cross-file invariants, and discovering them one failing test at a time is slow
and expensive. Everything below exists because something broke.

## Content policy — non-negotiable

**Never commit game content.** No rules text, spell or item names and
descriptions, bestiary entries, or setting material from the rulebook. It is not
ours to distribute. The compendium packs in `system.json` ship EMPTY and stay
empty; `packs/` is gitignored, as are the PDF and the spec markdown.

Mechanics are fine — a formula, a status effect's payload, a field on a schema.
Prose is not. If a change would put a sentence from the book into the repo,
stop.

Do not add "example" spells, weapons or monsters, even as test fixtures. Tests
use obviously synthetic names (`Quench weapon`, `ZZ probe`).

**Never declare a compendium pack in `system.json`.** A system's packs live in
the system folder, which Foundry replaces wholesale on update, taking every
document in them. Ten empty packs shipped from 0.1.0 to 0.7.0 as a home for
hand-authored content and destroyed it on every release. Content belongs in a
WORLD compendium — `game.lastarc.createWorldCompendiums()` builds the set. A
test enforces `packs: []`.

## Layout

```
module/
  config.mjs        static tables — Foundry-free
  derivation.mjs    all derived-stat maths — Foundry-free, unit tested
  action-economy.mjs, initiative.mjs, explode.mjs   also Foundry-free
  last-arc.mjs      entry point; the only file touching Foundry globals at load
  data/             TypeDataModel subclasses (character, npc, items)
  sheets/           ApplicationV2 sheets
  dice/             roll pipelines (attack, magic, hero points)
  quench.mjs        in-Foundry integration tests
templates/          Handlebars
styles/             CSS only — no shipped art
lang/en.json        every user-visible string
test/               plain `node --test`, no Foundry needed
```

Maths goes in the Foundry-free modules so it can be unit tested. Data models are
thin wrappers over `derivation.mjs`.

## What a change actually costs

The suite cross-references files, so a change in one place usually obliges
changes in others. Before running the tests, work out which of these apply:

**Adding a schema field** (`module/data/*.mjs`)
1. The field itself.
2. An input in the relevant template — Quench asserts every scalar field has
   one, or an entry in the `EXEMPT` map in `quench.mjs` giving the reason.
   "DERIVED" and "ACTION" are the two accepted reasons.
3. A `LASTARC.*` key in `lang/en.json` for its label and any tooltip.
4. Wiring in `prepareDerivedData` if anything should read it.

**Adding an `ArrayField` of `choices`** — the Quench check above walks scalar
leaves and SKIPS arrays, so it will not ask. `test/reachable-choices.test.mjs`
does, and needs an entry in its `SECTIONS` map naming the template block that
renders your data model. Both fields of this shape in the codebase shipped with
no input at all (issue #32): weapons were permanently slashing, and every
technick flag including Weapon Finesse was unswitchable. If you narrow an
existing `choices` list, keep the old values valid — see
`LASTARC.retiredTechnickFlags`. A document holding a value the schema no longer
accepts will not open.

**Adding a `{{localize "LASTARC.X"}}`** — the key must exist in `lang/en.json`.
Keys assembled at runtime (`LASTARC.DamageType.${k}`) are checked separately
against the config lists.

**Adding a `data-action="foo"`** — needs `foo: SheetClass.#onFoo` in
`DEFAULT_OPTIONS.actions` AND a `static async #onFoo(` method. The reverse is
also enforced: a declared action with no button in any template fails, because a
feature nobody can reach is the defect this project keeps producing.

**Adding an item subtype** — needs a data model, a `system.json` entry, a
`TYPES.Item.x` label, a group in `LASTARC.itemCreationGroups`, and a branch in
`#prepareItems` or a numeric `bulk`.

**Adding a top-level panel to an actor sheet** — needs an entry in
`LASTARC.sheetSections` *at the position it appears in the template*, a
`LASTARC.Section.*` label, and `data-section="id"` on the `<section>` with
`{{> laSectionTitle id="id"}}` in place of a hand-written `<h2>`. All three are
enforced by `test/sheet-layout.test.mjs`, which compares the config list against
the template's DOM order — a mismatch reshuffles the sheet the first time
anybody opens it, because a fresh reader's arrangement IS that list. Put the
entry in its designed position rather than at the end: `normaliseOrder` inserts
a newly shipped panel after whichever of its predecessors the reader kept, so
the position is what decides where it lands for people who have already
customised their sheet.

**Adding an exported function** — call it from somewhere, or add it to the
allowlist in `test/integrity.test.mjs` with a reason. Orphaned exports are the
single most common bug here: correct, tested, and wired to nothing.

## Testing

```bash
npm test          # ~1120 tests, no Foundry needed — always run this
```

`npm run test:integration` runs the Quench suite inside a real Foundry. **It
cannot run in CI** — it needs a licensed Foundry server and a live world. If you
change sheet rendering, layout, or anything a player clicks, say plainly in your
PR that it is unverified rather than implying the green unit suite covered it.

A green `npm test` means the maths is right. It does not mean the UI works.

## Things that will bite you

1. **Break Gauge steps run 0→5 as the character gets WORSE**, and the penalties
   at those steps are `0, −1, −2, −5, −10, unconscious` — two different
   sequences. Say "worsen"/"improve", never "+1 step".
2. **Initiative is inverted.** A class die, not a d20, and *lowest acts first*.
3. **Active Effects apply BETWEEN `prepareBaseData` and `prepareDerivedData`.**
   Anything computed in the latter silently overwrites an AE on the same path.
   The break penalty → defences → Fortitude → Threshold chain is therefore
   computed in code; AEs feed the `misc` inputs.
4. **Never give a derived value an input.** `prepareDerivedData` assigns it on
   every prepare, so the box stores the number and shows the old one back. This
   shipped twice — `defences.*.technicks` and `details.level`. Both are readouts
   now. If derivation writes to a path, the template must not bind to it.
5. **Character level is the sum of class levels.** Derived, not editable.
6. **Foundry hooks are `callAll`** — synchronous, never awaited. `combatTurn`
   and friends fire BEFORE the document updates; use `updateCombat`.
7. **An unlinked token's actor is a different document** from
   `game.actors.getName(x)`. Changes to one do not affect the other.
8. **Do not restyle `prose-mirror` layout.** Foundry builds it as a flex column
   whose content area is `position: absolute; inset: 0`. Setting `display` or
   `height` collapses it and the toolbar lands on top of the text. Use the
   `--min-height` variable.
9. **A chat card is a piece of paper, not a themed surface.** Chat messages
   render OUTSIDE `.last-arc`, so the palette variables do not reach them. The
   card states its background and ink as literal hex and every colour on it is
   chosen against cream. Never add a `prefers-color-scheme` rule for a
   `.lastarc-*` colour — one shipped and put pale green text on the pale green
   verdict plate at 1.12:1. `test/contrast.test.mjs` now forbids it.
10. **NPCs and characters have different shapes.** Characters keep skills as a
    keyed object of derived rows; NPCs keep a flat printed array of
    `{key, value}`, and NPCs have no `proficiencies` and no `system.statuses`.
    Reading a character path against an NPC yields `undefined`, which silently
    becomes 0 — how every light-weapon attack came to roll a bare d20.
11. **`data-group` and `data-panel` are different vocabularies.** `data-group`
    names a `LASTARC.itemCreationGroups` key for the Add button; `data-panel`
    names a rendered list for the reorder arrows. The Attacks panel is not a
    creation group and the `npc` creation group renders into a panel called
    `items`. The integrity suite checks the first and will flag the second if
    you reuse the attribute.

## Releasing

`system.json` `version` and `download` must be bumped together — the download
URL has to name the current version, and a test enforces it. Build the archive
with `node tools/build-release.mjs`, which verifies `system.json` sits at the
zip root. Foundry decides an update exists by comparing the manifest's version
to the installed one, so a forgotten bump means the release is invisible.

## Style

Match the surrounding code. Comments explain *why*, especially where a rule is
counter-intuitive or a previous approach failed — most comments here are
load-bearing warnings, not descriptions. British spelling in prose and
identifiers (`armour`, `behaviour`).

You cannot modify `.github/workflows/` — the GitHub App has no permission for
it. If a change needs a workflow edit, say so instead of trying.
