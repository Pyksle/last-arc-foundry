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
              const formula = combat._getInitiativeFormula(combatant);
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
