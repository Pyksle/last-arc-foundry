/**
 * Quench integration test batches.
 *
 * These cover what the plain-node suite structurally CANNOT: anything that
 * needs a real Foundry document, a real render, or the real hook ordering.
 * The node tests verify the maths; these verify that the maths is actually
 * wired to Foundry correctly.
 *
 * In particular this is where the Active Effect timing trap gets tested rather
 * than merely avoided — see the "active effect ordering" batch.
 *
 * Registration is gated on Quench being installed and active, so a normal user
 * who has never heard of Quench sees nothing. Quench is a dev dependency of the
 * workflow, not of the system.
 *
 * Run with:  npm run test:integration    (see tools/integration-test.mjs)
 */

import { LASTARC } from "./config.mjs";
import * as AE from "./action-economy.mjs";
import * as ATK from "./dice/attack.mjs";
import * as CB from "./combat.mjs";
import * as MAGIC from "./dice/magic.mjs";
import * as D from "./derivation.mjs";

const SYSTEM_ID = "last-arc";

export function registerQuenchBatches() {
  Hooks.on("quenchReady", (quench) => {
    registerDocumentBatch(quench);
    registerDerivationBatch(quench);
    registerActiveEffectBatch(quench);
    registerSheetBatch(quench);
    registerCombatBatch(quench);
  });
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create a temporary document and always clean it up, even when the assertion
 * throws. A leaked Actor between batches makes later failures baffling.
 */
async function withActor(data, fn) {
  const actor = await Actor.create({
    name: "Quench Subject", type: "character", ...data
  });
  try {
    return await fn(actor);
  } finally {
    await actor?.delete();
  }
}

/** As withActor, but for a statblock NPC. */
async function withNpc(data, fn) {
  const actor = await Actor.create({ name: "Quench Monster", type: "npc", ...data });
  try {
    return await fn(actor);
  } finally {
    await actor?.delete();
  }
}

/**
 * Wait for detached hook side effects to land.
 *
 * Every Foundry hook is dispatched with `Hooks.callAll`, which is SYNCHRONOUS
 * and does not await handlers. A system that does document writes in response
 * to a turn change — as every system must — therefore finishes those writes
 * some ticks after `nextTurn()` resolves. Tests have to wait for that; so does
 * teardown, or the combat gets deleted out from under a running handler.
 */
async function settle(ms = 300) {
  await new Promise((r) => setTimeout(r, ms));
}

/* -------------------------------------------------------------------------- */
/*  Documents                                                                  */
/* -------------------------------------------------------------------------- */

function registerDocumentBatch(quench) {
  quench.registerBatch(
    `${SYSTEM_ID}.documents`,
    (context) => {
      const { describe, it, assert } = context;

      describe("actor subtypes", function () {
        it("creates a character with a populated schema", async function () {
          await withActor({}, (actor) => {
            assert.equal(actor.type, "character");
            assert.exists(actor.system.attributes.str);
            assert.exists(actor.system.defences.ref);
            assert.exists(actor.system.breakGauge);
            assert.isNumber(actor.system.resources.hp.max);
          });
        });

        it("creates an NPC with statblock fields", async function () {
          const npc = await Actor.create({ name: "Quench NPC", type: "npc" });
          try {
            assert.equal(npc.type, "npc");
            assert.isNumber(npc.system.defences.ref.base);
            assert.isNumber(npc.system.passivePerception);
          } finally {
            await npc.delete();
          }
        });
      });

      describe("item subtypes", function () {
        /**
         * Every subtype declared in system.json must instantiate. A subtype with
         * no data model is accepted by Foundry but arrives schemaless, which
         * shows up much later as undefined-property errors.
         */
        for (const type of Object.keys(game.system.documentTypes?.Item ?? {})) {
          it(`creates a ${type} with its schema applied`, async function () {
            const item = await Item.create({ name: `Quench ${type}`, type });
            try {
              assert.equal(item.type, type);
              assert.isDefined(item.system, `${type} has no system data`);
              assert.notDeepEqual(item.system, {}, `${type} appears schemaless`);
            } finally {
              await item.delete();
            }
          });
        }
      });

      describe("status effect registration", function () {
        it("registers every status with a resolvable icon", async function () {
          // One HTTP round trip per status. Sequentially this outgrew Mocha's
          // 2s default the moment the set passed ~25 icons.
          this.timeout(30_000);

          const entries = LASTARC.allStatusIds.map((id) => {
            const entry = CONFIG.statusEffects.find((s) => s.id === id);
            assert.exists(entry, `status ${id} not registered`);
            return entry;
          });

          const responses = await Promise.all(entries.map((e) => fetch(e.img)));
          responses.forEach((response, i) => {
            assert.isTrue(response.ok, `icon 404: ${entries[i].img}`);
          });
        });

        it("localises every status name", function () {
          for (const id of LASTARC.allStatusIds) {
            const key = `LASTARC.Status.${id}`;
            assert.notEqual(game.i18n.localize(key), key, `untranslated: ${key}`);
          }
        });
      });
    },
    { displayName: "Last Arc — Documents & Registration" }
  );
}

/* -------------------------------------------------------------------------- */
/*  Derivation against live documents                                          */
/* -------------------------------------------------------------------------- */

function registerDerivationBatch(quench) {
  quench.registerBatch(
    `${SYSTEM_ID}.derivation`,
    (context) => {
      const { describe, it, assert } = context;

      describe("derived values on a real actor", function () {
        it("computes defences and Threshold", async function () {
          await withActor({
            system: {
              attributes: { vit: { value: 16 }, agi: { value: 14 } },
              details: { level: 5 },
              classes: [{ name: "warrior", levels: 5 }]
            }
          }, (actor) => {
            const sys = actor.system;
            assert.isNumber(sys.defences.fort.value);
            assert.isNumber(sys.breakGauge.threshold);
            assert.equal(
              sys.breakGauge.threshold, sys.defences.fort.value,
              "medium size adds nothing, so Threshold should equal Fortitude"
            );
          });
        });

        it("no derived value is ever NaN", async function () {
          // The unarmoured min(agiMod, undefined) case is the known way this
          // breaks, and NaN propagates silently through every comparison.
          await withActor({}, (actor) => {
            const walk = (obj, path = "system") => {
              for (const [k, v] of Object.entries(obj ?? {})) {
                if (typeof v === "number") {
                  assert.isFalse(Number.isNaN(v), `${path}.${k} is NaN`);
                } else if (v && typeof v === "object" && !Array.isArray(v)) {
                  walk(v, `${path}.${k}`);
                }
              }
            };
            walk(actor.system);
          });
        });

        it("THE DEATH SPIRAL: worsening the gauge lowers Threshold", async function () {
          await withActor({
            system: { details: { level: 5 }, classes: [{ name: "warrior", levels: 5 }] }
          }, async (actor) => {
            const before = actor.system.breakGauge.threshold;
            await actor.update({ "system.breakGauge.step": 3 });
            const after = actor.system.breakGauge.threshold;

            assert.isBelow(after, before, "Threshold must fall with Fortitude");
            assert.equal(before - after, 5, "step 3 is a -5 penalty");
          });
        });

        it("technick grants flow into defences automatically", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.defences.will.value;

            await actor.createEmbeddedDocuments("Item", [{
              name: "Iron Will", type: "technick",
              system: { slug: "iron-will", grants: { defences: { will: 2 } } }
            }]);

            assert.equal(actor.system.defences.will.value, before + 2);
            assert.equal(actor.system.defences.will.technicks, 2,
              "the contribution should be visible in the breakdown, not just the total");
          });
        });

        it("carried bulk drives encumbrance", async function () {
          await withActor({
            system: { attributes: { str: { value: 10 } } }
          }, async (actor) => {
            assert.equal(actor.system.bulk.state, "none");

            await actor.createEmbeddedDocuments("Item", [{
              name: "Anvil", type: "resourceItem",
              system: { bulk: 20, quantity: 1 }
            }]);

            assert.notEqual(actor.system.bulk.state, "none");
          });
        });
      });
    },
    { displayName: "Last Arc — Derivation (live documents)" }
  );
}

/* -------------------------------------------------------------------------- */
/*  Active Effect ordering — the §16 trap                                      */
/* -------------------------------------------------------------------------- */

function registerActiveEffectBatch(quench) {
  quench.registerBatch(
    `${SYSTEM_ID}.activeEffects`,
    (context) => {
      const { describe, it, assert } = context;

      describe("Active Effect application order", function () {
        /**
         * THE TRAP (spec §16 rev2). Foundry applies Active Effects BETWEEN
         * prepareBaseData and prepareDerivedData, so an AE targeting a field
         * that prepareDerivedData writes is silently overwritten — it presents
         * as "the effect does nothing", with no error anywhere.
         *
         * Our design routes effects through the `misc` INPUT slots instead.
         * These two tests assert both halves: the input slot works, and the
         * computed field genuinely does get overwritten, so nobody later
         * "fixes" the architecture by targeting it directly.
         */
        it("an AE on a misc INPUT slot reaches the total", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.defences.ref.value;

            await actor.createEmbeddedDocuments("ActiveEffect", [{
              name: "Quench: +3 Ref via misc",
              changes: [{
                key: "system.defences.ref.misc",
                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                value: "3"
              }]
            }]);

            assert.equal(actor.system.defences.ref.value, before + 3);
          });
        });

        it("an AE on the COMPUTED field is overwritten — this is why", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.defences.ref.value;

            await actor.createEmbeddedDocuments("ActiveEffect", [{
              name: "Quench: +99 Ref direct",
              changes: [{
                key: "system.defences.ref.value",
                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                value: "99"
              }]
            }]);

            assert.equal(
              actor.system.defences.ref.value, before,
              "if this ever passes with +99, prepareDerivedData stopped recomputing " +
              "and the whole derivation chain is no longer authoritative"
            );
          });
        });
      });

      describe("statuses as Active Effects", function () {
        it("exhaustion drops all three defences by 10", async function () {
          await withActor({}, async (actor) => {
            const before = {
              ref: actor.system.defences.ref.value,
              fort: actor.system.defences.fort.value,
              will: actor.system.defences.will.value
            };

            await actor.toggleStatusEffect("exhaustion", { active: true });

            assert.equal(actor.system.defences.ref.value, before.ref - 10);
            assert.equal(actor.system.defences.fort.value, before.fort - 10);
            assert.equal(actor.system.defences.will.value, before.will - 10);
          });
        });

        it("exhaustion also drags Break Threshold down with Fortitude", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.breakGauge.threshold;
            await actor.toggleStatusEffect("exhaustion", { active: true });
            assert.equal(actor.system.breakGauge.threshold, before - 10);
          });
        });

        it("withering halves maximum HP without zeroing it", async function () {
          await withActor({
            system: { classes: [{ name: "warrior", levels: 4 }], details: { level: 4 } }
          }, async (actor) => {
            const before = actor.system.resources.hp.max;
            await actor.toggleStatusEffect("withering", { active: true });

            const after = actor.system.resources.hp.max;
            assert.isAbove(after, 0, "a halving must never reach zero");
            assert.equal(after, Math.floor(before / 2));
          });
        });

        it("flat-footed removes the Agility bonus from Reflex", async function () {
          await withActor({
            system: { attributes: { agi: { value: 18 } } }
          }, async (actor) => {
            const before = actor.system.defences.ref.value;
            await actor.toggleStatusEffect("flatFooted", { active: true });
            assert.isBelow(actor.system.defences.ref.value, before);
          });
        });
      });
    },
    { displayName: "Last Arc — Active Effects & Statuses" }
  );
}

/* -------------------------------------------------------------------------- */
/*  Sheets                                                                     */
/* -------------------------------------------------------------------------- */

function registerSheetBatch(quench) {
  quench.registerBatch(
    `${SYSTEM_ID}.sheets`,
    (context) => {
      const { describe, it, assert } = context;

      describe("sheet rendering", function () {
        /**
         * A template that fails to render shows as a blank window in Foundry and
         * an error only in the console. Rendering each sheet once catches
         * missing context keys and malformed Handlebars that the compile-only
         * node check cannot.
         */
        it("renders the character sheet without throwing", async function () {
          await withActor({}, async (actor) => {
            const sheet = actor.sheet;
            await sheet.render(true);
            assert.exists(sheet.element, "sheet produced no DOM");
            assert.isTrue(sheet.rendered);
            await sheet.close({ animate: false });
          });
        });

        it("renders the NPC sheet without throwing", async function () {
          const npc = await Actor.create({ name: "Quench NPC Sheet", type: "npc" });
          try {
            await npc.sheet.render(true);
            assert.isTrue(npc.sheet.rendered);
            await npc.sheet.close({ animate: false });
          } finally {
            await npc.delete();
          }
        });

        // 17 subtypes, each a document create + render + close + delete. Render
        // itself is single-digit milliseconds; it is the round trips that add
        // up, and Mocha's default is 2000ms.
        it("renders an item sheet for every subtype", async function () {
          this.timeout(20_000);
          for (const type of Object.keys(game.system.documentTypes?.Item ?? {})) {
            const item = await Item.create({ name: `Quench ${type}`, type });
            try {
              await item.sheet.render(true);
              assert.isTrue(item.sheet.rendered, `${type} sheet did not render`);
              await item.sheet.close({ animate: false });
            } finally {
              await item.delete();
            }
          }
        });

        it("leaves no untranslated LASTARC keys in the rendered sheet", async function () {
          await withActor({}, async (actor) => {
            await actor.sheet.render(true);
            const text = actor.sheet.element?.textContent ?? "";
            const leaked = text.match(/LASTARC\.[A-Za-z0-9_.]+/g);
            await actor.sheet.close({ animate: false });
            assert.isNull(leaked, `raw localisation keys visible: ${leaked?.join(", ")}`);
          });
        });
      });

      /**
       * Getting content INTO a character.
       *
       * This system ships with empty compendium packs by design — the rulebook
       * is not ours to distribute — so hand-authoring is the only way anything
       * enters a world. For a while the sheets offered no way to do it: every
       * subsystem worked, every panel rendered, and there was simply no button
       * that made anything. Nothing in the unit suite could see that, because
       * nothing was mathematically wrong.
       *
       * These tests therefore assert the AFFORDANCE, not just the function.
       */
      describe("creating items by hand", function () {
        it("offers an add button in every panel of the character sheet", async function () {
          await withActor({}, async (actor) => {
            await actor.sheet.render(true);
            const groups = [...actor.sheet.element.querySelectorAll('[data-action="createItem"]')]
              .map((b) => b.dataset.group);
            await actor.sheet.close({ animate: false });

            for (const expected of ["attacks", "spells", "performances", "technicks",
                                    "features", "inventory"]) {
              assert.include(groups, expected, `no add button for the "${expected}" panel`);
            }
          });
        });

        it("offers an add button on the NPC sheet", async function () {
          const npc = await Actor.create({ name: "Quench NPC Add", type: "npc" });
          try {
            await npc.sheet.render(true);
            const btn = npc.sheet.element.querySelector('[data-action="createItem"]');
            await npc.sheet.close({ animate: false });
            assert.exists(btn, "the NPC sheet has no way to add an item");
          } finally {
            await npc.delete();
          }
        });

        /**
         * Creation is only half of it: an item that is created and then not
         * displayed is indistinguishable from a button that did nothing. Every
         * subtype in every group must be visible on the sheet afterwards.
         */
        it("shows every subtype on the sheet once created", async function () {
          this.timeout(30_000);
          await withActor({}, async (actor) => {
            const types = [...new Set(Object.values(CONFIG.LASTARC.itemCreationGroups).flat())];

            await actor.createEmbeddedDocuments("Item",
              types.map((t) => ({ name: `Quench show ${t}`, type: t })));

            await actor.sheet.render(true);
            const text = actor.sheet.element?.textContent ?? "";
            await actor.sheet.close({ animate: false });

            const invisible = types.filter((t) => !text.includes(`Quench show ${t}`));
            assert.deepEqual(invisible, [],
              `created but not rendered anywhere on the sheet: ${invisible.join(", ")}`);
          });
        });

        it("puts a weapon made from the Attacks panel straight into the attack list",
          async function () {
            await withActor({}, async (actor) => {
              // The Attacks panel lists EQUIPPED weapons only, so one created
              // there must arrive equipped or it appears to vanish.
              await actor.createEmbeddedDocuments("Item", [{
                name: "Quench Panel Sword", type: "weapon", system: { equipped: true }
              }]);
              await actor.sheet.render(true);
              const panel = actor.sheet.element.querySelector(".la-panel--attacks");
              const text = panel?.textContent ?? "";
              await actor.sheet.close({ animate: false });
              assert.include(text, "Quench Panel Sword");
            });
          });
      });

      /**
       * Field coverage — the guard for "I can't edit the description".
       *
       * Reported by a user who had just hand-authored a spell and found the
       * description read-only. It was, on all seventeen subtypes, and so were
       * most of every subtype's other fields: only weapon, armour, spell and
       * technick ever got a bespoke section, so a shield's block bonus, a
       * potion's healing, a race's attribute modifiers and a class's HP
       * progression had no input anywhere.
       *
       * Nothing static could catch it. A schema field with no input is not a
       * syntax error, a dangling key or an unwired button — it is an absence,
       * and only walking the real DataModel against the real rendered DOM
       * finds an absence. Hence Quench rather than the node suite.
       */
      describe("every schema field is reachable", function () {
        /** Flatten a schema to dotted leaf paths, keeping the field class. */
        function leafPaths(schema, prefix = "") {
          const out = [];
          for (const [key, field] of Object.entries(schema?.fields ?? {})) {
            const path = prefix ? `${prefix}.${key}` : key;
            const cls = field.constructor.name;
            if (cls === "SchemaField") out.push(...leafPaths(field, path));
            // ArrayFields are edited by add/remove widgets, never a bound input.
            else if (cls !== "ArrayField") out.push({ path, cls });
          }
          return out;
        }

        /**
         * Paths with no input, each with the reason it does not need one.
         *
         * Every entry is a claim that can be wrong, so keep them specific. The
         * two categories that matter:
         *
         *   DERIVED — prepareDerivedData assigns it, so an input would be
         *   overwritten in memory on the next prepare. `defences.*.technicks`
         *   USED to have an input for exactly this reason: it stored 7 and read
         *   back 0, which is worse than no box at all.
         *
         *   ACTION — edited through a data-action rather than a form control:
         *   the Break Gauge is a clickable track, persistent conditions have a
         *   dialog, Second Wind has a button.
         */
        const EXEMPT = {
          character: {
            "resources.hp.max": "DERIVED from class, level and Vitality",
            "resources.mp.max": "DERIVED from class, level and Mind",
            "resources.heroPoints.max": "DERIVED from level and technick grants",
            "resources.secondWind.max": "DERIVED from technick grants",
            "resources.secondWind.used": "ACTION — the Second Wind button spends it",
            "resources.secondWind.usedThisEncounter": "ACTION — reset by combat lifecycle",
            "defences.ref.value": "DERIVED total",
            "defences.fort.value": "DERIVED total",
            "defences.will.value": "DERIVED total",
            "defences.ref.classBonus": "DERIVED from the class list",
            "defences.fort.classBonus": "DERIVED from the class list",
            "defences.will.classBonus": "DERIVED from the class list",
            "defences.ref.technicks": "DERIVED — aggregate of technick grants",
            "defences.fort.technicks": "DERIVED — aggregate of technick grants",
            "defences.will.technicks": "DERIVED — aggregate of technick grants",
            "breakGauge.step": "ACTION — the Break Gauge track is clickable",
            "breakGauge.persistentSteps": "ACTION — added and cleared by dialog",
            "breakGauge.recoveryProgress": "ACTION — banked by the Recovery button",
            "initiative.die": "DERIVED from the first class",
            "bulk.value": "DERIVED — sum of carried item bulk",
            "damageMods.dr": "DERIVED from equipped armour"
          },
          npc: {
            "breakGauge.step": "ACTION — the Break Gauge track is clickable",
            "breakGauge.persistentSteps": "ACTION — added and cleared by dialog",
            "breakGauge.recoveryProgress": "ACTION — banked by the Recovery button"
          },
          item: {
            // Nothing. Every item field has an input, and it must stay that way.
          }
        };

        // Skill sub-objects repeat the same derived field across ~19 skills.
        const EXEMPT_PATTERNS = [
          { re: /^skills\.\w+\.technicks$/, why: "DERIVED — aggregate of technick grants" },
          { re: /^skills\.\w+\.(total|passive|appliesArmourPenalty)$/, why: "DERIVED" }
        ];

        /** Collect every bound control name from a rendered sheet. */
        async function boundPaths(doc) {
          await doc.sheet.render(true);
          await new Promise((r) => setTimeout(r, 350));
          const names = [...doc.sheet.element.querySelectorAll(
            "input[name], select[name], textarea[name], prose-mirror[name]"
          )].map((n) => n.getAttribute("name"));
          await doc.sheet.close({ animate: false });

          return new Set(names
            .filter((n) => n?.startsWith("system."))
            .map((n) => n.slice("system.".length)));
        }

        /** A path counts as covered if bound exactly, or as an object prefix. */
        const covers = (bound, path) =>
          bound.has(path) || [...bound].some((b) => b.startsWith(`${path}.`));

        it("every item subtype exposes all of its fields", async function () {
          this.timeout(60_000);
          const failures = [];

          for (const type of Object.keys(game.system.documentTypes.Item)) {
            const item = await Item.create({ name: `Quench fields ${type}`, type });
            try {
              const bound = await boundPaths(item);
              for (const { path, cls } of leafPaths(item.system.schema)) {
                if (EXEMPT.item[path]) continue;
                if (!covers(bound, path)) failures.push(`${type}.${path} (${cls})`);
              }
            } finally {
              await item.delete();
            }
          }

          assert.deepEqual(failures, [],
            `item fields with no input — nobody can set these:\n  ${failures.join("\n  ")}`);
        });

        it("every actor subtype exposes all of its fields, or exempts them", async function () {
          this.timeout(60_000);
          const failures = [];

          for (const type of Object.keys(game.system.documentTypes.Actor)) {
            const actor = await Actor.create({ name: `Quench fields ${type}`, type });
            try {
              const bound = await boundPaths(actor);
              for (const { path, cls } of leafPaths(actor.system.schema)) {
                if (EXEMPT[type]?.[path]) continue;
                if (EXEMPT_PATTERNS.some((p) => p.re.test(path))) continue;
                if (!covers(bound, path)) failures.push(`${type}.${path} (${cls})`);
              }
            } finally {
              await actor.delete();
            }
          }

          assert.deepEqual(failures, [],
            `actor fields with no input and no exemption:\n  ${failures.join("\n  ")}\n` +
            `Add an input, or an EXEMPT entry saying why it does not need one.`);
        });

        /**
         * The other half. An input whose value derivation overwrites is worse
         * than a missing one: it accepts typing and shows the old number back.
         */
        it("values typed into a bound field survive a round trip", async function () {
          this.timeout(30_000);
          const lost = [];

          const roundTrip = async (doc, path, value) => {
            await doc.update({ [path]: value });
            if (foundry.utils.getProperty(doc, path) !== value) {
              lost.push(`${path} — wrote ${value}, reads back ` +
                `${foundry.utils.getProperty(doc, path)}`);
            }
          };

          await withActor({}, async (actor) => {
            const bound = await boundPaths(actor);
            // Numeric leaves only: a representative sample is enough to catch a
            // derivation that clobbers, and writing to every field would take
            // longer than the whole rest of the suite.
            for (const { path, cls } of leafPaths(actor.system.schema)) {
              if (cls !== "NumberField" || !bound.has(path)) continue;
              await roundTrip(actor, `system.${path}`, 7);
            }
          });

          assert.deepEqual(lost, [],
            `these have an input but derivation overwrites it, so typing in them ` +
            `does nothing:\n  ${lost.join("\n  ")}`);
        });
      });
    },
    { displayName: "Last Arc — Sheets" }
  );
}

/* -------------------------------------------------------------------------- */
/*  Combat                                                                     */
/* -------------------------------------------------------------------------- */

function registerCombatBatch(quench) {
  quench.registerBatch(
    `${SYSTEM_ID}.combat`,
    (context) => {
      const { describe, it, assert } = context;

      describe("initiative", function () {
        it("uses the class die rather than a d20", async function () {
          await withActor({
            system: { classes: [{ name: "rogue", levels: 1 }] }
          }, async (actor) => {
            assert.equal(actor.system.initiative.effectiveDie, "d4");

            const combat = await Combat.create({});
            try {
              const [combatant] = await combat.createEmbeddedDocuments(
                "Combatant", [{ actorId: actor.id }]
              );
              // Via the COMBATANT, which is what Foundry actually calls. The
              // earlier version of this test asked `combat._getInitiativeFormula`
              // — the same wrong API the implementation used — so it passed
              // while rolling initiative from the tracker threw outright.
              const formula = combatant._getInitiativeFormula();
              assert.include(formula, "d4");
              assert.notInclude(formula, "d20");
            } finally {
              await combat.delete();
            }
          });
        });

        it("sorts ASCENDING — lowest acts first", async function () {
          const combat = await Combat.create({});
          const fast = await Actor.create({ name: "Quench Fast", type: "npc" });
          const slow = await Actor.create({ name: "Quench Slow", type: "npc" });
          try {
            await combat.createEmbeddedDocuments("Combatant", [
              { actorId: slow.id, initiative: 11 },
              { actorId: fast.id, initiative: 2 }
            ]);
            await combat.setupTurns();

            assert.equal(
              combat.turns[0].actorId, fast.id,
              "Foundry sorts descending by default; the override should invert it"
            );
          } finally {
            await combat.delete();
            await fast.delete();
            await slow.delete();
          }
        });
      });

      describe("action economy state", function () {
        it("persists turn state on the combatant", async function () {
          const combat = await Combat.create({});
          const actor = await Actor.create({ name: "Quench Turns", type: "character" });
          try {
            const [combatant] = await combat.createEmbeddedDocuments(
              "Combatant", [{ actorId: actor.id }]
            );

            const state = AE.spend(AE.createTurnState(), {
              type: "minor", banks: "recovery"
            }).state;
            await combatant.setFlag(SYSTEM_ID, "actions", state);

            const stored = combatant.getFlag(SYSTEM_ID, "actions");
            assert.equal(stored.bankedMinors, 1);
            assert.equal(stored.bankedFor, "recovery");
          } finally {
            await combat.delete();
            await actor.delete();
          }
        });
      });

      describe("damage application", function () {
        it("applies mitigation and worsens the gauge over Threshold", async function () {
          await withActor({
            system: { classes: [{ name: "warrior", levels: 3 }], details: { level: 3 } }
          }, async (actor) => {
            const { applyDamage } = game.lastarc;
            const threshold = actor.system.breakGauge.threshold;
            const stepBefore = actor.system.breakGauge.step;

            await applyDamage(actor, { total: threshold + 10, type: "slashing" });

            assert.isAbove(
              actor.system.breakGauge.step, stepBefore,
              "damage exceeding Threshold must worsen the gauge"
            );
          });
        });

        it("temp HP absorbs before real HP", async function () {
          await withActor({}, async (actor) => {
            await actor.update({ "system.resources.hp.temp": 5 });
            const hpBefore = actor.system.resources.hp.value;

            await game.lastarc.applyDamage(actor, { total: 3, type: "blunt" });

            assert.equal(actor.system.resources.hp.value, hpBefore, "real HP untouched");
            assert.equal(actor.system.resources.hp.temp, 2);
          });
        });
      });
      describe("turn lifecycle", function () {
        /**
         * Build a live 2-combatant encounter and tear it down afterwards.
         * These need real turn advancement — the bugs they guard were entirely
         * in WHEN Foundry fires its hooks and what is current at that moment,
         * which no pure test can see.
         */
        async function withEncounter(fn) {
          const a = await Actor.create({ name: "Q First", type: "character",
            system: { classes: [{ name: "rogue", levels: 1 }] } });
          const b = await Actor.create({ name: "Q Second", type: "character",
            system: { classes: [{ name: "warrior", levels: 1 }] } });
          const combat = await Combat.create({});
          try {
            const cs = await combat.createEmbeddedDocuments("Combatant",
              [{ actorId: a.id }, { actorId: b.id }]);
            // Explicit initiative so turn order is deterministic: lowest first.
            await combat.updateEmbeddedDocuments("Combatant",
              [{ _id: cs[0].id, initiative: 1 }, { _id: cs[1].id, initiative: 9 }]);
            const result = await fn(combat, a, b);
            await settle();   // let in-flight hook writes finish before teardown
            return result;
          } finally {
            await combat.delete();
            await a.delete();
            await b.delete();
          }
        }

        /**
         * REGRESSION GUARD — the worst of the lifecycle bugs.
         *
         * The slot reset ran in `combatTurn`, which Foundry fires BEFORE it
         * applies the update. `combat.combatant` there is still the OUTGOING
         * combatant, so every turn refreshed the slots of the character who had
         * just finished and left the incoming one with whatever they had left
         * over. Nothing in the pure action-economy suite could see it: the state
         * machine was right, it was being handed the wrong combatant.
         */
        it("gives fresh action slots to the INCOMING combatant", async function () {
          this.timeout(20_000);
          await withEncounter(async (combat) => {
            await combat.startCombat();
            await settle();
            const first = combat.combatant;

            // Spend the first combatant's primary.
            await CB.spendAction(first, "attack");
            assert.isFalse(CB.getTurnState(first).primary, "primary should be spent");

            await combat.nextTurn();
            await settle();
            const second = combat.combatant;
            assert.notEqual(second.id, first.id, "the turn must actually advance");

            assert.isTrue(
              CB.getTurnState(second).primary,
              "the combatant whose turn it now is must have a fresh primary"
            );
            assert.isFalse(
              CB.getTurnState(first).primary,
              "the combatant who just acted must NOT have been refreshed"
            );
          });
        });

        /**
         * REGRESSION GUARD. Nothing ever SET flat-footed — the lifecycle only
         * cleared it — so round-1 flat-footed and the whole surprise round never
         * happened in play despite `isFlatFooted` being correct and tested.
         */
        it("flat-foots everyone who has not yet acted when combat begins", async function () {
          this.timeout(20_000);
          await withEncounter(async (combat, a, b) => {
            assert.isFalse(a.statuses.has("flatFooted"), "not flat-footed before combat");

            await combat.startCombat();
            await settle();
            const first = combat.combatant.actor;
            const other = first === a ? b : a;

            assert.isFalse(first.statuses.has("flatFooted"), "the one acting is not flat-footed");
            assert.isTrue(other.statuses.has("flatFooted"), "everyone else is");
          });
        });

        it("clears flat-footed from the combatant whose turn it becomes", async function () {
          this.timeout(20_000);
          await withEncounter(async (combat) => {
            await combat.startCombat();
            await settle();
            await combat.nextTurn();
            await settle();
            assert.isFalse(
              combat.combatant.actor.statuses.has("flatFooted"),
              "acting ends round-1 flat-footed for the ACTIVE combatant"
            );
          });
        });

        /**
         * The round guard read `combat.round` inside a pre-update hook, so it
         * saw the OLD round and the sweep was permanently one round late — a
         * combatant could stay flat-footed through the whole of round 2.
         */
        it("no one is flat-footed once round 2 begins", async function () {
          this.timeout(20_000);
          await withEncounter(async (combat) => {
            await combat.startCombat();
            await settle();
            await combat.nextTurn();
            await settle();
            await combat.nextTurn();   // wraps into round 2
            await settle();

            assert.equal(combat.round, 2);
            for (const c of combat.combatants) {
              assert.isFalse(
                c.actor.statuses.has("flatFooted"),
                `${c.name} is still flat-footed in round ${combat.round}`
              );
            }
          });
        });
      });

      describe("rolling initiative through Foundry", function () {
        /**
         * REGRESSION GUARD. The override originally sat on `Combat.prototype`
         * and took a combatant argument. v13 calls it on the COMBATANT with no
         * arguments, so ours was never consulted and core fell back to
         * `String(undefined)` — rolling initiative from the tracker threw
         * "Unresolved StringTerm undefined".
         *
         * Nothing in the node suite could see this: the die-selection logic was
         * correct and well tested, it simply was not plugged in.
         */
        it("uses the class die via the real Foundry roll path", async function () {
          this.timeout(15_000);
          await withActor({
            system: { classes: [{ name: "rogue", levels: 1 }] }
          }, async (actor) => {
            const combat = await Combat.create({});
            try {
              const [c] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id }]);

              assert.equal(c._getInitiativeFormula(), "1d4", "rogue rolls its class die");

              const roll = c.getInitiativeRoll();
              await roll.evaluate();
              assert.isNumber(roll.total);
              assert.isAtLeast(roll.total, 1);
              assert.isAtMost(roll.total, 4, "a d4 cannot exceed 4 — a d20 fallback would");

              // The whole path, as the tracker calls it.
              await combat.rollInitiative([c.id]);
              assert.isNumber(combat.combatants.get(c.id).initiative);
            } finally {
              await combat.delete();
            }
          });
        });

        it("falls back to a parseable formula when an actor has no die", async function () {
          const combat = await Combat.create({});
          try {
            const [c] = await combat.createEmbeddedDocuments("Combatant", [{}]);
            const formula = c._getInitiativeFormula();
            assert.notInclude(formula, "undefined");
            assert.doesNotThrow(() => foundry.dice.Roll.create(formula));
          } finally {
            await combat.delete();
          }
        });
      });

      describe("counterattacks", function () {
        /**
         * A flat-footed creature has no reactions, so it cannot counterattack.
         * This is the interaction between §8 and §9 that makes opening a fight
         * with a caster safe in round 1, and it is easy to lose by checking only
         * `reactionUsed`.
         */
        it("a flat-footed threat cannot counterattack", async function () {
          this.timeout(15_000);
          await withActor({}, async (actor) => {
            await actor.toggleStatusEffect("flatFooted", { active: true });
            const state = AE.createTurnState();
            const r = AE.useReaction(state, { flatFooted: true });
            assert.isFalse(r.ok);
            assert.match(r.reason, /FlatFooted/);
          });
        });

        it("casting provokes, and casting defensively does not", function () {
          assert.isTrue(AE.provokes("castSpell", { castDefensively: false }));
          assert.isFalse(AE.provokes("castSpell", { castDefensively: true }));
        });

        /**
         * §18.4. Not merely damage: a counterattack beating the caster's Break
         * Threshold destroys the casting AND wastes the mana. The natural
         * implementation applies damage and lets the spell continue.
         */
        it("a counterattack over Break Threshold disrupts and wastes the mana", async function () {
          this.timeout(15_000);
          assert.isTrue(MAGIC.counterattackDisruptsCasting(30, 17));
          assert.isFalse(MAGIC.counterattackDisruptsCasting(17, 17), "must BEAT it");
        });

        it("threat detection excludes the incapacitated and the non-opposed", async function () {
          this.timeout(20_000);
          const combat = await Combat.create({});
          const a = await Actor.create({ name: "Q Caster", type: "character" });
          const b = await Actor.create({ name: "Q Ally", type: "character" });
          try {
            const cs = await combat.createEmbeddedDocuments("Combatant",
              [{ actorId: a.id }, { actorId: b.id }]);
            // Two characters are both FRIENDLY, so neither threatens the other
            // even standing on top of one another.
            assert.deepEqual(CB.threateningCombatants(cs[0]), [],
              "allies must never threaten each other");
          } finally {
            await combat.delete();
            await a.delete();
            await b.delete();
          }
        });
      });

      describe("rest", function () {
        it("recovers HP and MP on the same shape from different attributes", async function () {
          await withActor({
            system: {
              attributes: { vit: { value: 16 }, mnd: { value: 12 } },
              details: { level: 4 }
            }
          }, (actor) => {
            const sys = actor.system;
            const hp = D.restRecovery({ attrMod: sys.attributes.vit.mod, level: 4, hours: 8 });
            const mp = D.restRecovery({ attrMod: sys.attributes.mnd.mod, level: 4, hours: 8 });
            assert.isAbove(hp, mp, "Vit 16 beats Mnd 12, so HP recovers faster");
          });
        });

        it("more than eight hours yields nothing extra", () => {
          const eight = D.restRecovery({ attrMod: 3, level: 5, hours: 8 });
          assert.equal(D.restRecovery({ attrMod: 3, level: 5, hours: 30 }), eight);
        });

        it("a blocked character gains no HP from rest", () => {
          assert.equal(D.restRecovery({ attrMod: 3, level: 5, hours: 8, blocked: true }), 0);
        });
      });

      describe("statblock attacks", function () {
        const lurker = {
          system: {
            defences: { ref: { base: 15 }, fort: { base: 18 }, will: { base: 12 } },
            resources: { hp: { value: 40, max: 40 } },
            attacks: [
              { name: "Tentacle", atkBonus: 9, damage: "2d6", damageBonus: 5,
                damageType: "blunt", isMelee: true, appliesStatus: "grabbed" }
            ]
          }
        };

        it("derives a live attack total from the printed bonus", async function () {
          await withNpc(lurker, async (npc) => {
            const atk = npc.system.attacks[0];
            assert.equal(atk.printed, 9, "printed value must survive untouched");
            assert.equal(atk.total, 9, "unbroken, so live equals printed");
            assert.equal(atk.damageFormula, "2d6+5");
          });
        });

        /**
         * The whole reason `printed` and `total` are separate. A statblock's
         * attack bonus is its UNBROKEN value, exactly like its defences — if the
         * gauge were baked into the stored number a GM could never check the
         * sheet against the page.
         */
        it("applies the Break Gauge on top of the printed bonus", async function () {
          await withNpc(lurker, async (npc) => {
            await npc.update({ "system.breakGauge.step": 3 });
            const atk = npc.system.attacks[0];
            assert.equal(atk.printed, 9);
            assert.equal(atk.total, 4, "step 3 is −5");
          });
        });

        it("rolls an attack and posts a card carrying the attack index", async function () {
          this.timeout(10_000);
          await withNpc(lurker, async (npc) => {
            const result = await ATK.rollNpcAttack(npc, 0, { targetDefence: 10 });
            assert.isNotNull(result);
            assert.isNumber(result.roll.total);

            const msg = [...game.messages].pop();
            const flags = msg.flags?.["last-arc"];
            assert.equal(flags.attackIndex, 0, "index 0 must survive as a number, not vanish");
            assert.isNull(flags.weaponId);

            // Let the chat log finish animating the card in before removing it.
            // Foundry re-queries the message element after a ~350ms animation
            // (ChatLog##postNotification); deleting inside that window makes the
            // lookup return null and throws an unhandled rejection that fails
            // the whole run on an error nothing in real play would hit.
            await new Promise((r) => setTimeout(r, 500));
            await msg.delete();
          });
        });

        /**
         * Statblock damage is the AUTHORED total — Strength is already in the
         * printed number. Running it through buildDamageTerms would add the
         * creature's Strength modifier a second time.
         */
        it("does not add a Strength modifier to printed damage", async function () {
          await withNpc({
            system: {
              attributes: { str: { value: 20 } },
              attacks: [{ name: "Slam", atkBonus: 5, damage: "2d6", damageBonus: 7 }]
            }
          }, async (npc) => {
            assert.equal(npc.system.attributes.str.mod, 5, "a +5 that must NOT leak in");

            const dmg = await ATK.rollNpcDamage(npc, 0, { outcome: { critical: false } });

            // Exact and explosion-proof: assert on the flat term rather than on
            // a total, because the dice explode and no fixed total exists.
            // A leaked Strength modifier would show up as 12 rather than 7.
            // (Deliberately not a d1 either — k/faces = 1 never terminates, so
            // it explodes all the way to the dice cap.)
            const diceSum = dmg.results.reduce((a, r) => a + r.result, 0);
            assert.equal(dmg.flat, 7, "flat term must be damageBonus alone");
            assert.equal(dmg.total, diceSum + 7, "total is dice plus the printed bonus, nothing else");
            assert.isUndefined(dmg.terms, "NPC damage must not go through buildDamageTerms");
          });
        });

        it("reports the on-hit status rider", async function () {
          await withNpc(lurker, async (npc) => {
            const dmg = await ATK.rollNpcDamage(npc, 0, { outcome: {} });
            assert.equal(dmg.appliesStatus, "grabbed");
          });
        });

        it("refuses to roll an attack that does not exist", async function () {
          await withNpc(lurker, async (npc) => {
            // Capture the warning instead of letting it reach the real toast UI.
            // Two reasons: it asserts the GM is actually TOLD rather than just
            // getting a silent null, and Foundry's #postNotification rejects
            // asynchronously in this context, which would fail the whole run on
            // an error that has nothing to do with us.
            const warnings = [];
            const original = ui.notifications;
            ui.notifications = { ...original, warn: (m) => warnings.push(m) };
            try {
              assert.isNull(await ATK.rollNpcAttack(npc, 99, {}));
              assert.lengthOf(warnings, 1, "a missing attack must warn, not fail silently");
            } finally {
              ui.notifications = original;
            }
          });
        });

        /**
         * A flat-footed defender uses its flat-footed Reflex — the entire point
         * of the surprise round. Reading `ref.value` unconditionally would make
         * surprise silently do nothing.
         */
        it("targets flat-footed Reflex when the defender is flat-footed", async function () {
          await withActor({}, async (pc) => {
            const standing = ATK.defenceToBeat(pc);
            await pc.toggleStatusEffect("flatFooted", { active: true });
            const surprised = ATK.defenceToBeat(pc);
            assert.equal(surprised, pc.system.defences.ref.flatFooted);
            assert.isAtMost(surprised, standing);
          });
        });

        it("has no defence to beat when nothing is targeted", function () {
          assert.isNull(ATK.defenceToBeat(undefined));
        });
      });

    },
    { displayName: "Last Arc — Combat" }
  );
}
