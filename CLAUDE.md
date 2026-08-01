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

**Adding an exported function** — call it from somewhere, or add it to the
allowlist in `test/integrity.test.mjs` with a reason. Orphaned exports are the
single most common bug here: correct, tested, and wired to nothing.

## Testing

```bash
npm test          # 311 tests, no Foundry needed — always run this
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
