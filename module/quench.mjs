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
import * as BLOCK from "./dice/block.mjs";
import * as HEAL from "./dice/healing.mjs";
import * as ORDER from "./item-order.mjs";
import { effectPanelRows, toggleEffect, deleteEffect } from "./sheets/effect-panel.mjs";

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

        /**
         * Issue #7, and the second test that asserted the opposite. Kept here
         * rather than deleted because the pairing is the point: the Break
         * Gauge penalty is real and reaches Fortitude, and it stops there.
         */
        it("the gauge penalises Fortitude but leaves Threshold alone", async function () {
          await withActor({
            system: { classes: [{ name: "warrior", levels: 5 }] }
          }, async (actor) => {
            const thresholdBefore = actor.system.breakGauge.threshold;
            const fortBefore = actor.system.defences.fort.value;

            await actor.update({ "system.breakGauge.step": 3 });

            assert.equal(actor.system.defences.fort.value, fortBefore - 5,
              "step 3 is a −5 penalty and Fortitude must take it");
            assert.equal(actor.system.breakGauge.threshold, thresholdBefore,
              "Threshold is not in the gauge's enumerated penalty list");
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

      /**
       * The Effects panel (#20 slice C).
       *
       * Slice B put real effects on targeted allies and nothing could see one:
       * this system replaces Foundry's actor sheet, so its effects tab went
       * too, and the only UI touching effects was the status palette. A
       * performance buff out of combat "stays until removed" by design, with
       * nothing able to remove it.
       *
       * The two tests above prove the INVARIANT the panel reports on. These
       * prove the panel reports it, and that its buttons do what they say.
       */
      describe("the Effects panel", function () {
        const inert = {
          name: "Quench: inert ward",
          changes: [{
            key: "system.resources.hp.max",
            mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "10"
          }]
        };
        const live = {
          name: "Quench: real ward",
          changes: [{
            key: "system.defences.will.misc",
            mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "2"
          }]
        };

        it("lists an effect with what it changes", async function () {
          await withActor({}, async (actor) => {
            await actor.createEmbeddedDocuments("ActiveEffect", [live]);
            const rows = effectPanelRows(actor, (k) => game.i18n.localize(k));

            const row = rows.find((r) => r.name === live.name);
            assert.ok(row, "the effect is not listed at all");
            assert.equal(row.changes.length, 1);
            assert.equal(row.changes[0].display, "+2");
            assert.isFalse(row.unsupported);
          });
        });

        /**
         * The reason the panel exists. An effect on a derived path sits there
         * looking healthy and does nothing; the GM had no way to find out
         * which of theirs those were.
         */
        it("flags one that derivation overwrites", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.resources.hp.max;
            await actor.createEmbeddedDocuments("ActiveEffect", [inert]);

            assert.equal(actor.system.resources.hp.max, before,
              "the premise: this effect really does nothing");

            const row = effectPanelRows(actor, (k) => game.i18n.localize(k))
              .find((r) => r.name === inert.name);
            assert.isTrue(row?.unsupported, "...and the panel has to say so");
          });
        });

        /**
         * Conditions belong to the status palette, whose remove deletes EVERY
         * effect carrying that id. One condition with two remove buttons that
         * behave differently is how the pile-up in #47 happened.
         */
        it("leaves conditions to the status palette", async function () {
          await withActor({}, async (actor) => {
            await actor.toggleStatusEffect("prone", { active: true });
            const rows = effectPanelRows(actor, (k) => game.i18n.localize(k));
            assert.equal(rows.length, 0, "a status is showing up in the effects panel");
          });
        });

        it("suspending stops the number moving, and resuming brings it back", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.defences.will.value;
            const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [live]);
            assert.equal(actor.system.defences.will.value, before + 2);

            await toggleEffect(actor, effect.id);
            assert.equal(actor.system.defences.will.value, before,
              "a suspended effect must not still be applying");

            await toggleEffect(actor, effect.id);
            assert.equal(actor.system.defences.will.value, before + 2);
          });
        });

        it("deleting removes it", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.defences.will.value;
            const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [live]);

            await deleteEffect(actor, effect.id);
            assert.equal(actor.system.defences.will.value, before);
            assert.equal(actor.effects.size, 0);
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
        /**
         * Issue #5: "defences are not increased by character level at all".
         *
         * They were, and the maths was right. The trap was two levers —
         * `details.level` drove every derived number while a player levelling
         * up naturally edited `classes[].levels`, which drove nothing. Level is
         * now the sum of the class levels, so raising a class raises everything
         * downstream of it.
         */
        it("levelling a class raises character level and the defences with it",
          async function () {
            const actor = await Actor.create({ name: "Quench level chain", type: "character" });
            try {
              const before = {
                level: actor.system.details.level,
                ref: actor.system.defences.ref.value,
                fort: actor.system.defences.fort.value,
                will: actor.system.defences.will.value
              };
              assert.equal(before.level, 1, "a fresh character should start at level 1");

              await actor.update({ "system.classes": [{ name: "warrior", levels: 6 }] });

              assert.equal(actor.system.details.level, 6,
                "character level must follow the class levels");
              for (const key of ["ref", "fort", "will"]) {
                assert.equal(actor.system.defences[key].value - before[key], 5,
                  `${key} should rise by 5 across five levels, not stay put`);
              }

              // Multiclass sums rather than takes a maximum.
              await actor.update({ "system.classes": [
                { name: "warrior", levels: 6 }, { name: "mage", levels: 2 }
              ] });
              assert.equal(actor.system.details.level, 8);

              // No classes at all must floor at 1, not 0 — a level-0 character
              // derives negative half-level bonuses.
              await actor.update({ "system.classes": [] });
              assert.equal(actor.system.details.level, 1);
            } finally {
              await actor.delete();
            }
          });

        /**
         * Issue #6: equipping armour left damage reduction at 0.
         *
         * The armour WAS being read — its Reflex bonus applied — but nothing
         * ever assigned `damageMods.dr`, which is the field the damage
         * pipeline consumes. Reflex is asserted alongside DR here precisely
         * because that pairing is what made the bug confusing to report: the
         * armour visibly did something, just not the thing on the tin.
         */
        it("equipping armour raises damage reduction", async function () {
          await withActor({}, async (actor) => {
            const bareDr = actor.system.damageMods.dr;
            const bareRef = actor.system.defences.ref.value;
            assert.equal(bareDr, 0, "an unarmoured character should have no DR");

            const [armour] = await actor.createEmbeddedDocuments("Item", [{
              name: "Quench Plate", type: "armour",
              system: { equipped: true, type: "heavy", dr: 5, refBonus: 1, maxAgiBonus: 1 }
            }]);

            assert.equal(actor.system.damageMods.dr, 5, "armour DR did not reach the actor");
            assert.isAbove(actor.system.defences.ref.value, bareRef);

            // Damaged armour stops less (§11): effectiveDr, not the printed dr.
            await armour.update({ "system.breakGauge.step": 3 });
            assert.equal(actor.system.damageMods.dr, 0,
              "a −5 break penalty on DR 5 armour should leave nothing, floored at 0");

            // Unequipping removes it rather than leaving the last value behind.
            await armour.update({ "system.equipped": false, "system.breakGauge.step": 0 });
            assert.equal(actor.system.damageMods.dr, 0);
          });
        });

        /**
         * Issue #3: accessories could not grant hit points — the shared grants
         * schema had defences, threshold, hero points, initiative, speed,
         * second wind and skills, and no HP, MP or DR.
         */
        it("an accessory can grant HP, MP and DR, and only while equipped",
          async function () {
            await withActor({}, async (actor) => {
              const before = {
                hp: actor.system.resources.hp.max,
                mp: actor.system.resources.mp.max,
                dr: actor.system.damageMods.dr
              };

              const [amulet] = await actor.createEmbeddedDocuments("Item", [{
                name: "Quench Amulet", type: "accessory",
                system: { equipped: true, grants: { hp: 10, mp: 4, dr: 2 } }
              }]);

              assert.equal(actor.system.resources.hp.max, before.hp + 10);
              assert.equal(actor.system.resources.mp.max, before.mp + 4);
              assert.equal(actor.system.damageMods.dr, before.dr + 2);

              // Worn items contribute only while worn; knowledge always does.
              await amulet.update({ "system.equipped": false });
              assert.equal(actor.system.resources.hp.max, before.hp,
                "an unequipped accessory must stop granting");
            });
          });

        /**
         * The grant is added AFTER the status multipliers, so withering halves
         * what the class and Vitality gave and leaves the trinket alone.
         */
        it("a withered character keeps the full HP grant from an accessory",
          async function () {
            await withActor({}, async (actor) => {
              await actor.createEmbeddedDocuments("Item", [{
                name: "Quench Amulet", type: "accessory",
                system: { equipped: true, grants: { hp: 10 } }
              }]);
              const healthy = actor.system.resources.hp.max;

              await actor.toggleStatusEffect("withering", { active: true });
              const withered = actor.system.resources.hp.max;
              await actor.toggleStatusEffect("withering", { active: false });

              const baseHalved = Math.round((healthy - 10) / 2);
              assert.equal(withered, baseHalved + 10,
                "the amulet's 10 HP should survive the halving intact");
            });
          });

        /**
         * Issue #7: the Break Gauge was dragging Break Threshold down with it.
         *
         * Tested on a live actor rather than through the pure function,
         * because this is entirely a call-site question — `breakThreshold`
         * happily accepts either Fortitude, and the unit test that "proved"
         * the old behaviour did so by passing in the penalised one itself.
         */
        it("worsening the Break Gauge does not lower Break Threshold", async function () {
          await withActor({
            system: {
              attributes: { vit: { value: 16 } },
              classes: [{ name: "warrior", levels: 5 }]
            }
          }, async (actor) => {
            const unbroken = actor.system.breakGauge.threshold;
            const fortUnbroken = actor.system.defences.fort.value;

            for (const step of [1, 2, 3, 4]) {
              await actor.update({ "system.breakGauge.step": step });
              assert.equal(actor.system.breakGauge.threshold, unbroken,
                `Threshold moved at break step ${step}`);
              // The defence itself MUST still fall — the penalty is real, it
              // simply does not reach Threshold.
              assert.isBelow(actor.system.defences.fort.value, fortUnbroken,
                `Fortitude should still be penalised at step ${step}`);
            }
          });
        });

        it("a statblock's printed Threshold is not reduced by its Break Gauge",
          async function () {
            const npc = await Actor.create({
              name: "Quench threshold npc", type: "npc",
              system: { breakGauge: { thresholdBase: 40 } }
            });
            try {
              assert.equal(npc.system.breakGauge.threshold, 40);
              await npc.update({ "system.breakGauge.step": 4 });
              assert.equal(npc.system.breakGauge.threshold, 40,
                "a printed statblock number is an authored constant");
            } finally {
              await npc.delete();
            }
          });

        /**
         * Issue #8: the Race & Class panel made whole-race and whole-class
         * items, which duplicated the header's race field and class dropdown
         * and contributed nothing to the character. A feature is one named
         * benefit with a grants block, so its bonus reaches the sheet the same
         * way a technick's does.
         */
        it("a race feature's bonus reaches the character", async function () {
          await withActor({}, async (actor) => {
            const skillBefore = actor.system.skills.acrobatics.total;
            const refBefore = actor.system.defences.ref.value;

            await actor.createEmbeddedDocuments("Item", [{
              name: "Quench Fleet of Foot", type: "feature",
              system: {
                category: "race",
                grants: { skills: [{ key: "acrobatics", bonus: 2 }], defences: { ref: 1 } }
              }
            }]);

            assert.equal(actor.system.skills.acrobatics.total, skillBefore + 2);
            assert.equal(actor.system.defences.ref.value, refBefore + 1);
          });
        });

        /**
         * A feature is innate: unlike an accessory it has no `equipped` flag,
         * and must contribute without one. Getting this wrong would make every
         * feature silently inert, which is the bug being fixed.
         */
        it("a feature contributes without needing to be equipped", async function () {
          await withActor({}, async (actor) => {
            const before = actor.system.defences.will.value;
            const [feat] = await actor.createEmbeddedDocuments("Item", [{
              name: "Quench Stubborn", type: "feature",
              system: { category: "class", grants: { defences: { will: 3 } } }
            }]);
            assert.isUndefined(feat.system.equipped,
              "a feature should carry no equipped flag at all");
            assert.equal(actor.system.defences.will.value, before + 3);
          });
        });

        it("whole-race and whole-class items stay inert and are labelled so",
          async function () {
            await withActor({}, async (actor) => {
              const before = actor.system.defences.ref.value;
              await actor.createEmbeddedDocuments("Item", [{
                name: "Quench Legacy Race", type: "race",
                system: { speed: 8, attributeMods: { str: 2 } }
              }]);
              assert.equal(actor.system.defences.ref.value, before,
                "a race item must not quietly change anything");

              await actor.sheet.render(true);
              await new Promise((r) => setTimeout(r, 400));
              const panel = actor.sheet.element.querySelector(".la-panel--features");
              const text = panel?.textContent ?? "";
              await actor.sheet.close({ animate: false });

              assert.include(text, "Quench Legacy Race", "it should still be visible");
              assert.include(text.toLowerCase(), "inert",
                "and flagged, so nobody assumes it is doing something");
            });
          });

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
            "details.level": "DERIVED — the sum of the class levels. It was an " +
              "editable field, and defences, HP, MP and half-level bonuses all read " +
              "it, so levelling a class moved nothing.",
            "details.classLevelTotal": "DERIVED — the same sum, kept for display",
            "resources.hp.max": "DERIVED from class, level and Vitality",
            "resources.mp.max": "DERIVED from class, level and Mind",
            "resources.heroPoints.max": "DERIVED from level and technick grants",
            "resources.secondWind.max": "DERIVED from technick grants",
            "resources.secondWind.used": "ACTION — one checkbox per use, tickable " +
              "both ways, plus the Second Wind button which spends one (issue #10). " +
              "`usedThisEncounter` used to sit beside this claiming it was 'reset by " +
              "combat lifecycle'; nothing ever wrote it, so the once-per-encounter " +
              "cap did not exist. The field is gone rather than the claim fixed.",
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
            "damageMods.dr": "DERIVED from equipped armour plus grants. This entry " +
              "was here BEFORE the code was true — nothing assigned damageMods.dr at " +
              "all, and the exemption suppressed the check that would have caught it " +
              "(issue #6). An EXEMPT reason is a claim about the code, not a licence."
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

        /**
         * THE HOLE THE ABOVE LEAVES, and the one issue #13 fell through.
         *
         * `leafPaths` skips ArrayFields outright, on the reasoning that an
         * array is edited by an add/remove widget rather than a bound input.
         * True of the array — and completely false of its ELEMENT, whose fields
         * do get bound inputs (`system.outcomes.0.dc`). So an array of schemas
         * could ship with no row editor at all, or gain a field that no row
         * renders, and the coverage test would report full marks.
         *
         * That is exactly what happened: performances carried an `outcomes`
         * array, `performItem` read it, and the item sheet had no editor for
         * it. Every performance in every world had zero rows and resolved to
         * nothing, and the guard could not see it.
         *
         * Checked at runtime rather than by reading the template, because the
         * row markup only exists once a row does — so this adds one, renders,
         * and looks for its fields.
         */
        it("every array-of-schemas has a row editor covering its fields", async function () {
          this.timeout(60_000);
          const failures = [];

          for (const type of Object.keys(game.system.documentTypes.Item)) {
            const item = await Item.create({ name: `Quench rows ${type}`, type });
            try {
              for (const [key, field] of Object.entries(item.system.schema.fields)) {
                if (field.constructor.name !== "ArrayField") continue;
                if (field.element?.constructor?.name !== "SchemaField") continue;

                // Seed one row so the editor has something to draw.
                await item.update({ [`system.${key}`]: [field.element.clean({})] });

                const bound = await boundPaths(item);
                for (const { path } of leafPaths(field.element, `${key}.0`)) {
                  if (!covers(bound, path)) failures.push(`${type}.${path}`);
                }
              }
            } finally {
              await item.delete();
            }
          }

          assert.deepEqual(failures, [],
            `array rows with no input — the row exists and cannot be edited:\n  ` +
            failures.join("\n  "));
        });

        /**
         * THE OTHER HALF OF THAT HOLE, which issues #14 and #15 fell through.
         *
         * An ArrayField of PLAIN STRINGS is not edited by a row widget either.
         * It gets one comma-separated box standing in for the whole array —
         * `languagesText`, `fitsText`, `featuresText` — and if nobody writes
         * that box, the array is unauthorable and utterly silent about it.
         *
         * Three shipped that way. `details.languages` on the character was
         * declared in the very first version and had no input for nine
         * releases. `prerequisites.trainedSkills`, `.technicks` and `.talents`
         * were read by checkPrerequisites the whole time, so "Trained in
         * Acrobatics" — the commonest prerequisite the book prints — could be
         * checked but never recorded.
         *
         * A stand-in box does not carry the array's own name, so this cannot
         * look for the path directly; it checks that SOMETHING is bound whose
         * name starts with the array's own, which is the `*Text` convention.
         */
        const ARRAY_EXEMPT = {
          // Empty, and it should stay that way. `npc.loot` and `npc.steal` sat
          // here reading "no UI yet"; an exemption is a debt, not a licence, and
          // they now have a row editor on the NPC sheet.
        };

        it("every array of plain values can be edited somehow", async function () {
          this.timeout(60_000);
          const failures = [];

          const scan = async (doc, kind) => {
            const bound = await boundPaths(doc);
            for (const [key, field] of Object.entries(doc.system.schema.fields)) {
              for (const { path, element } of arrayLeaves(field, key)) {
                if (element === "SchemaField") continue;      // covered above
                if (ARRAY_EXEMPT[kind]?.[path]) continue;
                // Either the array itself is bound, or a stand-in box whose
                // name begins with it (`details.languagesText`).
                const covered = [...bound].some(
                  (b) => b === path || b.startsWith(path)
                );
                if (!covered) failures.push(`${kind}.${path}`);
              }
            }
          };

          /** Dotted paths of every ArrayField, recursing through SchemaFields. */
          function arrayLeaves(field, path) {
            const cls = field.constructor.name;
            if (cls === "ArrayField") {
              return [{ path, element: field.element?.constructor?.name }];
            }
            if (cls !== "SchemaField") return [];
            return Object.entries(field.fields ?? {})
              .flatMap(([k, f]) => arrayLeaves(f, `${path}.${k}`));
          }

          for (const type of Object.keys(game.system.documentTypes.Actor)) {
            const actor = await Actor.create({ name: `Quench arrays ${type}`, type });
            try { await scan(actor, type); } finally { await actor.delete(); }
          }
          for (const type of Object.keys(game.system.documentTypes.Item)) {
            const item = await Item.create({ name: `Quench arrays ${type}`, type });
            try { await scan(item, type); } finally { await item.delete(); }
          }

          assert.deepEqual(failures, [],
            `arrays with no way to edit them:\n  ${failures.join("\n  ")}\n` +
            `Add a comma box named <path>Text and repack it in _prepareSubmitData.`);
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
         * Rich-text editors must be USABLE, not merely present.
         *
         * The description round-tripped correctly and was still unusable: a
         * `display: block` override collapsed the flex column Foundry's layout
         * depends on, the absolutely-positioned content area lost the box it
         * sizes against, and the toolbar rendered on top of the text. Reported
         * as "the text you type is behind the rich-markdown editor".
         *
         * Persistence and visibility are separate questions, and the test that
         * only asked the first one passed throughout.
         */
        it("the description editor lays out with the text visible", async function () {
          this.timeout(20_000);
          const item = await Item.create({ name: "Quench editor layout", type: "spell" });
          try {
            await item.sheet.render(true);
            await new Promise((r) => setTimeout(r, 400));

            const pm = item.sheet.element.querySelector("prose-mirror[name='system.description']");
            assert.exists(pm, "no description editor on the sheet");

            // Activate it the way the toggle button does.
            pm.querySelector("button.toggle")?.click();
            await new Promise((r) => setTimeout(r, 600));

            const styles = getComputedStyle(pm);
            const rect = (sel) => pm.querySelector(sel)?.getBoundingClientRect();
            const menu = rect("menu");
            const content = rect(".ProseMirror");

            assert.equal(styles.display, "flex",
              "prose-mirror must stay a flex column — its content area is absolutely " +
              "positioned inside a flex:1 container and gets its height from nowhere else");
            assert.isAbove(content?.height ?? 0, 20,
              "the editor's content area has collapsed, so there is nowhere to type");
            if (menu && content) {
              assert.isAtMost(menu.bottom, content.top + 2,
                "the toolbar overlaps the text area — typing goes behind it");
            }
          } finally {
            await item.sheet.close({ animate: false });
            await item.delete();
          }
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

        /**
         * ISSUE #17. Drench, oil and agony were computed into the status
         * aggregate and read by nothing: applyDamage took the target's raw
         * damageMods and never looked at its statuses. The unit suite could not
         * see it — the aggregation it tests was correct all along.
         *
         * Bounded rather than exact, because the bonus dice EXPLODE: two d6
         * can roll anything from 2 upwards, so the assertion is that they were
         * rolled at all.
         */
        it("a drenched target takes extra dice from cold, and only from cold", async function () {
          await withActor({}, async (actor) => {
            await actor.toggleStatusEffect("drench", { active: true });

            const cold = await game.lastarc.applyDamage(
              actor, { total: 10, type: "cold", faces: 6 }
            );
            assert.isAbove(cold.final, 10, "drench adds two dice to incoming cold");

            const blunt = await game.lastarc.applyDamage(
              actor, { total: 10, type: "blunt", faces: 6 }
            );
            assert.equal(blunt.final, 10, "drench must not touch other damage types");
          });
        });

        /**
         * The same hole, on the other payload. Agony strips immunity outright,
         * so a creature immune to cold must still take the hit.
         */
        it("agony strips a target's immunity at application time", async function () {
          await withActor({
            system: { damageMods: { immunity: ["cold"] } }
          }, async (actor) => {
            const immune = await game.lastarc.applyDamage(actor, { total: 10, type: "cold" });
            assert.equal(immune.final, 0, "immunity holds while unafflicted");

            await actor.toggleStatusEffect("agony", { active: true });
            const afflicted = await game.lastarc.applyDamage(actor, { total: 10, type: "cold" });
            assert.isAbove(afflicted.final, 0, "agony strips immunity (§12)");
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

        /**
         * The GM's ruling on #37: the per-attacker cases — flat-footed against
         * one creature and not another — are applied BY HAND, because a Foundry
         * status is one flag on the actor and cannot express a pair.
         *
         * That only works if the lifecycle leaves hand-applied statuses alone.
         * The round sweep used to clear flat-footed from EVERY combatant at
         * every round boundary, so the GM's ruling lasted until the next round
         * tick and no longer — and the creature it was meant to catch had not
         * yet taken the turn that is supposed to end it.
         */
        it("a hand-applied flat-footed survives the round boundary", async function () {
          this.timeout(20_000);
          await withEncounter(async (combat, a, b) => {
            await combat.startCombat();
            await settle();
            await combat.nextTurn();     // b acts; its round-1 status clears
            await settle();
            await combat.nextTurn();     // round 2, a acts
            await settle();
            assert.isFalse(b.statuses.has("flatFooted"), "clean slate to start from");

            await b.toggleStatusEffect("flatFooted", { active: true });
            await settle();

            await combat.nextRound();    // round 3 opens on a; b has not acted
            await settle();
            assert.isTrue(b.statuses.has("flatFooted"),
              "the sweep cleared a status the lifecycle did not apply");

            await combat.nextTurn();     // b's turn
            await settle();
            assert.isFalse(b.statuses.has("flatFooted"),
              "and the start of its own turn is where it ends");
          });
        });

        /**
         * The one case the two implementations of this rule disagreed on. The
         * lifecycle inlined "everyone except whoever is acting", so a creature
         * caught by the surprise round which then WON initiative walked into
         * its own ambush at full Reflex.
         */
        it("a surprised combatant is flat-footed even though it acts first", async function () {
          this.timeout(20_000);
          await withEncounter(async (combat, a) => {
            const first = combat.combatants.find((c) => c.actorId === a.id);
            await first.setFlag("last-arc", "surprised", true);

            await combat.startCombat();
            await settle();

            assert.equal(combat.combatant.actorId, a.id, "a rolled lowest and acts first");
            assert.isTrue(a.statuses.has("flatFooted"),
              "acting exempts you from the round-1 trigger, not from surprise");
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

      /* -- Block (issue #12) ------------------------------------------------ */

      describe("block", function () {
        it("refuses without an equipped shield, and allows with one", async function () {
          await withActor({}, async (pc) => {
            assert.isFalse(BLOCK.canBlock(pc).allowed, "no shield, no block");

            await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ board", type: "shield",
              system: { size: "medium", equipped: false }
            }]);
            assert.isFalse(BLOCK.canBlock(pc).allowed, "a shield in the pack is not in hand");

            const shield = pc.items.find((i) => i.type === "shield");
            await shield.update({ "system.equipped": true });
            assert.isTrue(BLOCK.canBlock(pc).allowed);
          });
        });

        /**
         * Reactions are blocked entirely while flat-footed (§8, §12). This is
         * the interaction most likely to be missed, because Block is offered
         * from a chat card rather than from the sheet that shows the status.
         */
        it("a flat-footed defender cannot block", async function () {
          await withActor({}, async (pc) => {
            await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ board", type: "shield",
              system: { size: "medium", equipped: true }
            }]);
            await pc.toggleStatusEffect("flatFooted", { active: true });

            const check = BLOCK.canBlock(pc);
            assert.isFalse(check.allowed);
            assert.equal(check.reason, "LASTARC.Block.FlatFooted");
          });
        });

        it("picks the better of the two skills a light shield allows", async function () {
          await withActor({
            system: {
              details: { size: "medium" },
              skills: { lightWeapon: { trained: true, focus: 6 }, oneHanded: { trained: false } }
            }
          }, async (pc) => {
            const [shield] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ buckler", type: "shield",
              system: { size: "small", equipped: true }
            }]);
            assert.equal(BLOCK.bestShieldSkill(pc, shield), "lightWeapon");
          });
        });

        /**
         * An NPC has no `proficiencies` list and stores skills as a printed
         * array rather than a keyed object. Reading the character-shaped path
         * against a statblock yields undefined and silently rolls a bare d20 —
         * the same failure that made every light-weapon attack roll with no
         * skill bonus.
         */
        it("reads a statblock's printed skill rather than rolling bare", async function () {
          await withNpc({
            system: { details: { size: "medium" }, skills: [{ key: "oneHanded", value: 9 }] }
          }, async (npc) => {
            await npc.createEmbeddedDocuments("Item", [{
              name: "ZZ board", type: "shield",
              system: { size: "medium", equipped: true, blockBonus: 2 }
            }]);

            const result = await BLOCK.rollBlock(npc, { attackTotal: 0 });
            const natural = result.roll.dice[0].results[0].result;
            assert.equal(result.roll.total, natural + 11,
              "printed 9 plus the shield's 2, and no non-proficiency penalty");
          });
        });

        it("counts repeat blocks against the blocker's own turn", async function () {
          await withActor({}, async (pc) => {
            await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ board", type: "shield",
              system: { size: "medium", equipped: true }
            }]);

            const combat = await Combat.create({});
            try {
              await combat.createEmbeddedDocuments("Combatant", [{ actorId: pc.id }]);

              assert.equal(BLOCK.previousBlocks(pc), 0);
              await BLOCK.rollBlock(pc, { attackTotal: 99 });
              assert.equal(BLOCK.previousBlocks(pc), 1, "a failed block still counts");

              const combatant = combat.getCombatantByActor(pc.id);
              await CB.setTurnState(combatant, AE.beginTurn(CB.getTurnState(combatant)));
              assert.equal(BLOCK.previousBlocks(pc), 0,
                "the count clears at the start of the blocker's next turn");
            } finally {
              await combat.delete();
            }
          });
        });
      });

      /* -- Healing (issue #11) ---------------------------------------------- */

      describe("healing", function () {
        it("heals, caps at the maximum, and posts a card with the sum", async function () {
          await withActor({}, async (pc) => {
            const max = pc.system.resources.hp.max;
            await pc.update({ "system.resources.hp.value": 1 });

            const before = game.messages.size;
            const result = await HEAL.applyHealing(pc, { amount: max * 10 });

            assert.equal(pc.system.resources.hp.value, max);
            assert.equal(result.applied, max - 1);
            assert.isAbove(result.wasted, 0, "the overflow is reported, not swallowed");
            assert.equal(game.messages.size, before + 1, "healing must show its working");
          });
        });

        /**
         * `outcomes[].healing` was editable on every spell sheet and read by
         * nothing: a cure spell rolled its check, announced a tier, and healed
         * no one (issue #11).
         */
        it("a spell outcome's healing formula actually heals", async function () {
          await withActor({}, async (pc) => {
            await pc.update({ "system.resources.hp.value": 1, "system.resources.mp.value": 20 });

            const [spell] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ mend", type: "spell",
              system: {
                school: "white", mpCost: 1,
                outcomes: [{ dc: 0, healing: "4" }]
              }
            }]);

            await MAGIC.castSpell(pc, spell);
            assert.equal(pc.system.resources.hp.value, 5, "1 + 4");
          });
        });
      });

      /* -- Performance outcomes (issue #13) --------------------------------- */

      describe("performance outcomes", function () {
        /**
         * The reported bug, at its root. The array existed, `performItem` read
         * it, and no sheet could author a row — so every performance in every
         * world resolved to nothing at all.
         */
        it("a tier the check reaches is selected and reported", async function () {
          await withActor({
            system: { skills: { perform: { trained: true, focus: 20 } } }
          }, async (pc) => {
            const [perf] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ tune", type: "performance",
              system: {
                kind: "enhancing",
                outcomes: [
                  { dc: 15, skillBonus: 1, bonusScope: "weaponSkills" },
                  { dc: 500, skillBonus: 5, bonusScope: "weaponSkills" }
                ]
              }
            }]);

            const result = await MAGIC.performItem(pc, perf);
            assert.equal(result.outcome.dc, 15, "the unreachable tier must not win");
            assert.isTrue(result.landed);
          });
        });

        /**
         * Enfeebling tiers read "should your check beat an enemy's Will
         * Defence". An enhancing tier has no gate, and conflating the two would
         * make every buff need a target.
         */
        it("an enfeebling tier is gated on beating the defence", async function () {
          await withActor({}, async (pc) => {
            const [perf] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ jeer", type: "performance",
              system: {
                kind: "enfeebling",
                outcomes: [{ dc: null, opposedDefence: "will", penalty: 2, penaltyScope: "allDefences" }]
              }
            }]);

            await withNpc({ system: { defences: { will: { base: 500 } } } }, async (npc) => {
              const result = await MAGIC.performItem(pc, perf, { target: npc });
              assert.isTrue(result.opposed.opposed);
              assert.isFalse(result.opposed.beat, "nothing beats a 500 Will");
              assert.isFalse(result.landed, "and a resisted tier must not apply");
            });
          });
        });

        /**
         * Mana loss EXPLODES — Chapter 9 says so outright, and it is the only
         * resource drain in the system that does. Verified by draining a d1-ish
         * die is impossible, so this checks the plumbing rather than the
         * cascade: MP actually leaves the target and floors at zero.
         */
        it("mana loss actually strips MP and floors at zero", async function () {
          await withActor({}, async (pc) => {
            const [perf] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ drain", type: "performance",
              system: {
                kind: "enfeebling",
                outcomes: [{ dc: null, mpDamage: "100" }]
              }
            }]);

            await withNpc({ system: { resources: { mp: { value: 10, max: 10 } } } }, async (npc) => {
              const result = await MAGIC.performItem(pc, perf, { target: npc });
              assert.equal(npc.system.resources.mp.value, 0);
              assert.equal(result.mpDamage.lost, 10, "only what was there is lost");
            });
          });
        });

        it("a new outcome row matches the performance schema, not the spell one", async function () {
          const perf = await Item.create({ name: "ZZ shape", type: "performance" });
          try {
            const blank = perf.system.schema.fields.outcomes.element.clean({});
            assert.property(blank, "bonusScope", "the scope is the half that matters");
            assert.property(blank, "mpDamage");
            assert.notProperty(blank, "onFail", "that is a spell's shape");
            assert.isNull(blank.dc, "a blank DC means the row always applies");
          } finally {
            await perf.delete();
          }
        });
      });

      /* -- Item ordering (issue #9) ----------------------------------------- */

      describe("item ordering", function () {
        it("a new item lands after the ones already there", async function () {
          await withActor({}, async (pc) => {
            const [first] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ one", type: "talent", sort: ORDER.SORT_STEP
            }]);
            const [second] = await pc.createEmbeddedDocuments("Item", [{
              name: "ZZ two", type: "talent", sort: ORDER.nextSort([...pc.items])
            }]);
            assert.isAbove(second.sort, first.sort);
          });
        });

        it("renumbering a panel survives a round trip through the database", async function () {
          await withActor({}, async (pc) => {
            const created = await pc.createEmbeddedDocuments("Item", [
              { name: "ZZ a", type: "talent" },
              { name: "ZZ b", type: "talent" },
              { name: "ZZ c", type: "talent" }
            ]);
            const ids = created.map((i) => i.id);

            // Every item starts at sort 0, which is exactly the case a
            // two-value swap cannot fix.
            assert.deepEqual(created.map((i) => i.sort), [0, 0, 0]);

            const moved = ORDER.moveInOrder(ids, ids[2], "up");
            await pc.updateEmbeddedDocuments("Item", ORDER.sortUpdates(moved));

            const ordered = ORDER.orderBySort([...pc.items]).map((i) => i.id);
            assert.deepEqual(ordered, [ids[0], ids[2], ids[1]]);
          });
        });
      });

    },
    { displayName: "Last Arc — Combat" }
  );
}
