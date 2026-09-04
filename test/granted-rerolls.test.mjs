/**
 * Rerolls granted by technicks, talents and racial traits (#48).
 *
 * The GM: "there are certain talents, technicks, and racial traits that allow
 * for the rerolling of a roll. Would it be possible to add two checkboxes for
 * mechanical effects inside of the technicks?"
 *
 * Both semantics already existed in `resolveReroll` and were read by nothing
 * but the hero point — so this is plumbing, and plumbing is precisely where
 * this project loses things. Every link in the chain is checked: the item can
 * store it, the sheet can tick it, the actor aggregates it, the card offers it,
 * and the handler spends it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LASTARC } from "../module/config.mjs";
import {
  aggregateGrants, resolveReroll, rerollApplies, offeredRerolls, rerollGrantId,
  rerollBonus
} from "../module/derivation.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

/**
 * One function's body, brace-free and window-free.
 *
 * Three guards in this file sliced a fixed number of characters after a
 * function's name, and every one of them went stale as soon as the function
 * grew — failing on runs where nothing was wrong, which is how a guard gets
 * deleted rather than read.
 */
function fnBody(source, signature) {
  const at = source.indexOf(signature);
  if (at === -1) return "";
  const end = source.indexOf("\n}", at);
  return source.slice(at, end === -1 ? undefined : end);
}
const chat = read("module/chat.mjs");
const heroPoints = read("module/dice/hero-points.mjs");
const itemSheet = read("module/sheets/item-sheet.mjs");
const itemTemplate = read("templates/item/item-sheet.hbs");
const character = read("module/data/character.mjs");
const lang = JSON.parse(read("lang/en.json"));

describe("§48 which kinds a trait may grant", () => {
  test("the grantable kinds are a subset of the real ones", () => {
    for (const kind of LASTARC.grantableRerollKinds) {
      assert.ok(LASTARC.rerollKinds.includes(kind), `${kind} is not a reroll kind at all`);
    }
  });

  /**
   * `lower` is the MISFORTUNE penalty — reroll and keep the worse. An item
   * granting it would be handing a character a curse, so it is deliberately
   * not grantable even though it is a perfectly real reroll kind.
   */
  test("the penalty kind is not grantable", () => {
    assert.ok(!LASTARC.grantableRerollKinds.includes("lower"),
      "a trait can grant `lower`, which means an item can curse its owner");
    assert.equal(resolveReroll(18, 4, "lower"), 4, "...and it really is a penalty");
  });
});

describe("§48 a grant survives the trip from item to actor", () => {
  test("a ticked kind reaches the aggregate, an unticked one does not", () => {
    const g = aggregateGrants([
      { __source: "ZZ trait", reroll: { second: true, higher: false, skill: "survival" } },
      { __source: "ZZ inert", reroll: { second: false, higher: false, skill: "survival" } }
    ]);
    assert.equal(g.rerolls.length, 1, "an untouched trait must grant nothing");
    assert.deepEqual(g.rerolls[0], {
      kind: "second", skill: "survival", attribute: null, weaponCategory: null,
      perEncounter: false, bonusAttribute: null, bonusMultiplier: 1,
      source: "ZZ trait", sourceId: null
    });
  });

  test("one trait can grant both kinds", () => {
    const g = aggregateGrants([
      { __source: "ZZ both", reroll: { second: true, higher: true, skill: "" } }
    ]);
    assert.deepEqual(g.rerolls.map((r) => r.kind), ["second", "higher"]);
  });

  /**
   * A LIST rather than a count. A player with two reroll traits needs to tell
   * them apart at the table — they may have different semantics — and
   * "Reroll ×2" says nothing about which is which.
   */
  test("each grant carries the name of the trait that gave it", () => {
    const g = aggregateGrants([
      { __source: "ZZ knack", reroll: { second: true, skill: "" } },
      { __source: "ZZ boon", reroll: { higher: true, skill: "stealth" } }
    ]);
    assert.deepEqual(g.rerolls.map((r) => r.source), ["ZZ knack", "ZZ boon"]);
  });

  test("no grants means an empty list, not undefined", () => {
    assert.deepEqual(aggregateGrants([]).rerolls, []);
    assert.deepEqual(aggregateGrants([{ hp: 3 }]).rerolls, []);
  });

  test("the character model surfaces them for the card to read", () => {
    assert.match(character, /this\.rerollGrants = grants\.rerolls;/,
      "the aggregate never reaches `system`, so the chat card would have to " +
      "walk the item list itself — a second implementation waiting to disagree");
    assert.match(character, /__source: item\.name/,
      "grants are not tagged with their item, so no button can be named");
  });
});

describe("§48 every link of the chain is connected", () => {
  test("the item sheet builds a checkbox per grantable kind", () => {
    assert.match(itemSheet, /LASTARC\.grantableRerollKinds\.map\(/,
      "the checkboxes are hand-listed, so a kind can be grantable in the " +
      "schema and untickable on the sheet — issue #32, twice");
    assert.match(itemTemplate, /name="system\.grants\.reroll\.\{\{this\.key\}\}"/,
      "the generated checkboxes do not bind to the grants schema");
    assert.match(itemTemplate, /name="system\.grants\.reroll\.skill"/,
      "no skill picker, so a trait that rerolls one named skill cannot say which");
  });

  test("the card offers one button per grant", () => {
    assert.match(chat, /function offerGrantedRerolls\(/, "no offer is built at all");
    assert.match(chat, /offerGrantedRerolls\(message, element\);/,
      "the offer exists and the render hook never calls it");
    assert.match(chat, /actor\.system\?\.rerollGrants/,
      "the button does not read the actor's grants");
  });

  test("the action is dispatched to a handler", () => {
    assert.match(chat, /case "lastarcGrantedReroll": return await onGrantedReroll\(/,
      "the button is emitted and nothing handles the click");
  });

  test("the rebuilt card comes from the shared chain", () => {
    // THE FUNCTION, not a fixed slice of it. A 1600-character window went stale
    // the moment the function grew, failing with nothing wrong — the third
    // guard in this suite to do that.
    const fn = fnBody(chat, "async function onGrantedReroll");
    assert.match(fn, /rebuildAfterReroll\(actor, flags, result\.keptRoll\)/,
      "a granted reroll must rebuild its card like a hero point does, or an " +
      "attack loses its damage button and a check loses its verdict");
  });

  test("no hero point is spent", () => {
    const fn = chat.slice(chat.indexOf("async function onGrantedReroll"),
      chat.indexOf("function offerBlock"));
    assert.ok(!/heroPointReroll|canSpendHeroPoint|HERO_SPEND/.test(fn),
      "a granted reroll must not touch hero points — being free is the point");
  });
});

describe("§48 the reroll maths is shared, not reimplemented", () => {
  test("the free reroll keeps the die resolveReroll chose", () => {
    // Under "keep the better" the winner is frequently the ORIGINAL. Returning
    // the new roll regardless prints a total the dice never produced — every
    // time the reroll fails to improve, which is most of them.
    assert.match(heroPoints, /export async function rerollWithoutCost\(/);
    const fn = heroPoints.slice(heroPoints.indexOf("export async function rerollWithoutCost"));
    assert.match(fn.slice(0, 900), /kept === rerolled \? reroll : originalRoll/,
      "the kept roll does not follow resolveReroll's choice");
    assert.match(fn.slice(0, 900), /new Roll\("1d20 \+ @mod", \{ mod \}\)/,
      "the free reroll is a naked d20, so its total is a bare die face");
  });

  test("it applies the kind it was given", () => {
    assert.equal(resolveReroll(18, 4, "second"), 4, "second: the new die stands");
    assert.equal(resolveReroll(18, 4, "higher"), 18, "higher: the original wins");
    assert.equal(resolveReroll(4, 18, "higher"), 18);
  });
});

describe("§48 one d20 gets one second chance", () => {
  test("either kind of reroll closes the roll to the other", () => {
    // The flags are separate because the resources are, but the GATE is
    // shared: having only the hero point respect it let a granted reroll be
    // followed by a bought one on the same die.
    const hero = chat.slice(chat.indexOf("function offerHeroReroll"),
      chat.indexOf("function offerGrantedRerolls"));
    const granted = chat.slice(chat.indexOf("function offerGrantedRerolls"),
      chat.indexOf("async function onGrantedReroll"));

    assert.match(hero, /flags\.heroRerolled \|\| flags\.rerolled/,
      "a granted reroll does not stop a hero point being spent afterwards");
    assert.match(granted, /flags\.rerolled \|\| flags\.heroRerolled/,
      "a hero point reroll does not stop a granted one being used afterwards");
  });

  test("using one stamps the message", () => {
    assert.match(chat, /setFlag\("last-arc", "rerolled", true\)/,
      "nothing marks the roll as rerolled, so the button never goes away");
  });
});

describe("§48 strings exist for everything the buttons say", () => {
  test("each grantable kind has a label and a tooltip", () => {
    for (const kind of LASTARC.grantableRerollKinds) {
      assert.ok(lang[`LASTARC.RerollKind.${kind}`], `no label for ${kind}`);
      assert.ok(lang[`LASTARC.Tooltip.RerollKind.${kind}`], `no tooltip for ${kind}`);
    }
  });

  test("the offer and its result have strings", () => {
    for (const key of ["LASTARC.Reroll.Offer", "LASTARC.Reroll.OfferTooltip",
      "LASTARC.Reroll.Applied", "LASTARC.Field.GrantsReroll", "LASTARC.Field.RerollSkill",
      "LASTARC.Field.RerollAnyRoll"]) {
      assert.ok(lang[key], `${key} is missing from lang/en.json`);
    }
  });

  test("the button names the trait rather than the mechanic", () => {
    // "Reroll — Grassrunner" is usable at a table; "Reroll (keep the better)"
    // twice over is not, when a character has two such traits.
    assert.match(lang["LASTARC.Reroll.Offer"], /\{source\}/,
      "the button does not name its source, so two grants look identical");
  });
});

/* ── scoping (the GM's ruling on #48) ─────────────────────────────────────── */

describe("§48 a scoped grant only offers itself on its own skill", () => {
  test("the aggregate carries the scope, blank becoming null", () => {
    const scoped = aggregateGrants([
      { __source: "ZZ knack", reroll: { second: true, skill: "survival" } }
    ]);
    assert.equal(scoped.rerolls[0].skill, "survival");

    const anyRoll = aggregateGrants([
      { __source: "ZZ boon", reroll: { second: true, skill: "" } }
    ]);
    assert.equal(anyRoll.rerolls[0].skill, null,
      "blank must normalise to null, or `!g.skill` would not read as unscoped");
  });

  /**
   * Both sites now call the same helper. They used to be two copies of one
   * expression with a comment on each warning they must agree — which is the
   * shape of a bug waiting for somebody to edit one of them.
   */
  test("the offer filters through the shared matcher", () => {
    assert.match(chat, /D\.offeredRerolls\(\s*actor\.system\?\.rerollGrants,\s*flags,/,
      "every grant is offered on every roll, so a trait that rerolls one skill " +
      "would offer itself on all of them");
  });

  /**
   * The button's index is into the FILTERED list. Indexing the raw list in the
   * handler would spend the wrong grant the moment a character has one scoped
   * trait and one unscoped — the two lists differ in length and order.
   */
  test("the handler re-filters the same way before indexing", () => {
    const fn = chat.slice(chat.indexOf("async function onGrantedReroll"));
    assert.match(fn.slice(0, 1200), /D\.offeredRerolls\(/,
      "the handler indexes the unfiltered list, so it can spend the wrong grant");
    // The SAME function, not a second filter that happens to agree today.
    assert.ok(!/\.filter\(\(g\) =>/.test(fn.slice(0, 1200)),
      "the handler has its own filter again — it will drift from the offer");
  });

  test("a check records which skill it was", () => {
    const rolls = read("module/dice/rolls.mjs");
    assert.match(rolls, /skillKey: skillKey \?\? null/,
      "a check does not say which skill it was, so no scoped grant can match it");
    assert.match(rolls, /flavourKey: "LASTARC\.Roll\.SkillCheck",\s*\n\s*skillKey/,
      "rollSkill does not pass the key through to the card");
  });

  test("there is no per-rest counter", () => {
    // The GM's ruling: one reroll per attempted check, which the shared gate
    // already enforces. A second limit with no rule behind it is issue #46.
    for (const f of ["module/data/items.mjs", "module/chat.mjs", "module/derivation.mjs"]) {
      assert.ok(!read(f).includes("usesPerRest"),
        `${f} still carries a per-rest limit that no rule asks for`);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("§79 a reroll can be scoped to an attribute", () => {
  const grant = (o) => ({ kind: "second", skill: null, attribute: null, source: "ZZ", ...o });

  test("an unscoped grant still offers on everything", () => {
    assert.equal(rerollApplies(grant({}), { skillKey: "survival" }), true);
    assert.equal(rerollApplies(grant({}), {}), true);
  });

  test("an attribute scope covers every skill governed by it", () => {
    const g = grant({ attribute: "str" });
    const str = Object.entries(LASTARC.allSkills).filter(([, c]) => c.attr === "str");
    assert.ok(str.length > 1, "the fixture needs more than one Strength skill to mean anything");
    for (const [key] of str) {
      assert.equal(rerollApplies(g, { skillKey: key }), true, `${key} was not covered`);
    }
  });

  test("…and not the ones governed by something else", () => {
    const g = grant({ attribute: "str" });
    for (const [key, cfg] of Object.entries(LASTARC.allSkills)) {
      if (cfg.attr === "str") continue;
      assert.equal(rerollApplies(g, { skillKey: key }), false, `${key} was wrongly covered`);
    }
  });

  /**
   * A Strength check is as strength-based as a Strength skill, and it carries
   * no skill key at all — so without this the reader who ticks "any Strength
   * check" watches it not offer on the most obvious case of all.
   */
  test("…and the raw attribute check too", () => {
    assert.equal(rerollApplies(grant({ attribute: "str" }), { attributeKey: "str" }), true);
    assert.equal(rerollApplies(grant({ attribute: "str" }), { attributeKey: "int" }), false);
  });

  test("a skill scope is unchanged by any of this", () => {
    const g = grant({ skill: "survival" });
    assert.equal(rerollApplies(g, { skillKey: "survival" }), true);
    assert.equal(rerollApplies(g, { skillKey: "athletics" }), false);
    assert.equal(rerollApplies(g, { attributeKey: "str" }), false,
      "a skill-scoped trait leaked onto a raw attribute check");
  });

  /** Both scopes ORed — a union is what "this trait rerolls these" means. */
  test("naming both offers on either", () => {
    const g = grant({ skill: "arcana", attribute: "str" });
    assert.equal(rerollApplies(g, { skillKey: "arcana" }), true);
    assert.equal(rerollApplies(g, { skillKey: "athletics" }), true);
    assert.equal(rerollApplies(g, { skillKey: "perception" }), false);
  });

  test("an attack, which has neither key, gets no scoped offer", () => {
    assert.equal(rerollApplies(grant({ attribute: "str" }), {}), false);
    assert.equal(rerollApplies(grant({ skill: "survival" }), {}), false);
  });

  /**
   * THE reason this is one function. The button's index is into the FILTERED
   * list, and the offer and the spend both build it — if they disagree by one
   * entry the player spends a different trait from the one they clicked.
   */
  test("the filtered list is stable, so an index means the same thing twice", () => {
    const grants = [
      grant({ source: "unscoped" }),
      grant({ attribute: "str", source: "strength" }),
      grant({ skill: "arcana", source: "arcana" })
    ];
    const onAthletics = offeredRerolls(grants, { skillKey: "athletics" });
    assert.deepEqual(onAthletics.map((g) => g.source), ["unscoped", "strength"]);

    const onArcana = offeredRerolls(grants, { skillKey: "arcana" });
    assert.deepEqual(onArcana.map((g) => g.source), ["unscoped", "arcana"],
      "index 1 means a different trait on a different roll, which is the point");

    assert.deepEqual(offeredRerolls(grants, {}).map((g) => g.source), ["unscoped"]);
  });

  test("the aggregate carries the attribute scope across", () => {
    const g = aggregateGrants([
      { __source: "ZZ surge", reroll: { second: true, skill: "", attribute: "str" } }
    ]);
    assert.equal(g.rerolls[0].attribute, "str");
    assert.equal(g.rerolls[0].skill, null);
  });

  /** An attribute check must say which attribute, or nothing can match on it. */
  test("rollAttribute stamps the attribute onto the message", () => {
    const rolls = read("module/dice/rolls.mjs");
    const fn = rolls.slice(rolls.indexOf("export async function rollAttribute"));
    assert.match(fn.slice(0, 900), /attributeKey: attrKey/,
      "an attribute check carries no attribute, so no scoped trait can see it");
    assert.match(rolls, /attributeKey: attributeKey \?\? null/,
      "evaluateCheck drops it before it reaches the message flags");
  });
});

/* -------------------------------------------------------------------------- */

describe("§79 a reroll can be scoped to a weapon group", () => {
  const grant = (o) => ({
    kind: "second", skill: null, attribute: null, weaponCategory: null,
    perEncounter: false, source: "ZZ", sourceId: "i1", ...o
  });

  test("it offers on an attack with that group", () => {
    const g = grant({ weaponCategory: "axes" });
    assert.equal(rerollApplies(g, { weaponCategory: "axes" }), true);
    assert.equal(rerollApplies(g, { weaponCategory: "swords" }), false);
  });

  /**
   * The other two scopes are checks. A weapon-group trait is the first that
   * reaches attacks at all, and it must not start offering on checks in the
   * process — an attack card carries no skill key and a check carries no
   * weapon group, so each stays on its own side.
   */
  test("…and not on a skill or attribute check", () => {
    const g = grant({ weaponCategory: "axes" });
    assert.equal(rerollApplies(g, { skillKey: "athletics" }), false);
    assert.equal(rerollApplies(g, { attributeKey: "str" }), false);
  });

  test("a check-scoped trait still never offers on an attack", () => {
    assert.equal(rerollApplies(grant({ attribute: "str" }), { weaponCategory: "axes" }), false);
    assert.equal(rerollApplies(grant({ skill: "athletics" }), { weaponCategory: "axes" }), false);
  });

  test("an unscoped grant still offers on everything, attacks included", () => {
    assert.equal(rerollApplies(grant({}), { weaponCategory: "axes" }), true);
  });
});

describe("§79 a trait can improve the reroll it grants", () => {
  const mods = { str: 4, int: 1 };
  const grant = (o) => ({ bonusAttribute: null, bonusMultiplier: 1, ...o });

  /**
   * A racial spends its once-per-encounter reroll to add TWICE its Strength to
   * a reroll with a weapon it specialises in. The trait does not merely grant
   * the reroll; it improves the one it grants, which is neither a scope nor a
   * kind — it is a modifier that exists only on the second die.
   */
  test("twice an attribute is twice its modifier", () => {
    assert.equal(rerollBonus(grant({ bonusAttribute: "str", bonusMultiplier: 2 }), mods), 8);
  });

  test("once is once, and the multiplier defaults to one", () => {
    assert.equal(rerollBonus(grant({ bonusAttribute: "str" }), mods), 4);
    assert.equal(rerollBonus(grant({ bonusAttribute: "int", bonusMultiplier: 3 }), mods), 3);
  });

  /** Every reroll that existed before this must be untouched. */
  test("no attribute named is no bonus at all", () => {
    assert.equal(rerollBonus(grant({}), mods), 0);
    assert.equal(rerollBonus(grant({ bonusMultiplier: 5 }), mods), 0,
      "a multiplier with nothing to multiply paid out anyway");
    assert.equal(rerollBonus({}, mods), 0);
    assert.equal(rerollBonus(), 0);
  });

  /**
   * A half-built character must not turn its reroll into `1d20 + NaN`, which
   * evaluates to nothing and reports nothing.
   */
  test("an attribute the character does not have is zero, not NaN", () => {
    assert.equal(rerollBonus(grant({ bonusAttribute: "str" }), {}), 0);
    assert.equal(rerollBonus(grant({ bonusAttribute: "str" }), { str: null }), 0);
    assert.equal(rerollBonus(grant({ bonusAttribute: "str" }), { str: "big" }), 0);
  });

  test("a negative modifier is carried, not clamped away", () => {
    assert.equal(rerollBonus(grant({ bonusAttribute: "str", bonusMultiplier: 2 }),
      { str: -2 }), -4, "a penalty attribute stopped counting");
  });

  test("a nonsense multiplier falls back to counting it once", () => {
    assert.equal(rerollBonus(grant({ bonusAttribute: "str", bonusMultiplier: 0 }), mods), 4);
    assert.equal(rerollBonus(grant({ bonusAttribute: "str", bonusMultiplier: -3 }), mods), 4);
  });

  test("the aggregate carries it across", () => {
    const g = aggregateGrants([{
      __source: "ZZ surge",
      reroll: { second: true, weaponCategory: "knuckles", perEncounter: true,
                bonusAttribute: "str", bonusMultiplier: 2 }
    }]);
    assert.equal(g.rerolls[0].bonusAttribute, "str");
    assert.equal(g.rerolls[0].bonusMultiplier, 2);
  });

  /**
   * The SECOND die only. Added to the original roll's modifier it would change
   * the card being replaced, and a player who declined the reroll would keep a
   * bonus they never spent anything for.
   */
  test("it rides on the reroll, never on the original", () => {
    const fn = fnBody(chat, "async function onGrantedReroll");
    assert.match(fn, /mod: rollModifier\(flags\) \+ bonus/,
      "the bonus is not reaching the rerolled die");
    assert.ok(!/rollModifier\(flags\) \+ bonus[\s\S]*setFlag\("last-arc", "mods"/.test(fn),
      "the bonus is being written back onto the original card");
    /**
     * The note must be REACHABLE, not merely present. Asserting the key alone
     * survived the condition being replaced with `false` — the string stayed in
     * the file and the line would never have rendered.
     */
    assert.match(fn, /\(bonus \?\s*`<p class="lastarc-note">\$\{game\.i18n\.format\("LASTARC\.Reroll\.Bonus"/,
      "a reroll that came out higher than the die shows, with nothing saying why");
  });
});

describe("§79 once per encounter", () => {
  const limited = {
    kind: "second", skill: null, attribute: null, weaponCategory: "axes",
    perEncounter: true, source: "ZZ spec", sourceId: "item-1"
  };
  const unlimited = { ...limited, perEncounter: false, sourceId: "item-2" };
  const roll = { weaponCategory: "axes" };

  test("it is offered while unspent", () => {
    assert.equal(offeredRerolls([limited], roll, []).length, 1);
  });

  test("…and withdrawn once spent", () => {
    assert.equal(offeredRerolls([limited], roll, ["item-1"]).length, 0);
  });

  test("an unlimited grant ignores the spent list entirely", () => {
    assert.equal(offeredRerolls([unlimited], roll, ["item-2"]).length, 1,
      "a trait with no per-encounter limit was withdrawn anyway");
  });

  /** Spending one trait must not retire another the character also holds. */
  test("spending one leaves the others alone", () => {
    const other = { ...limited, sourceId: "item-3", source: "ZZ other" };
    const left = offeredRerolls([limited, other], roll, ["item-1"]);
    assert.deepEqual(left.map((g) => g.sourceId), ["item-3"]);
  });

  /**
   * The id is the item's, so two traits that happen to share a NAME are still
   * two traits. Falling back to the name is deliberate — a grant that reached
   * the actor without an id would otherwise lose its limit silently.
   */
  /**
   * A racial that rerolls one attribute's checks, and says that a character who
   * ALSO has a weapon-specialisation talent may spend it on attacks with that
   * weapon. One trait, two scopes, one use per encounter.
   *
   * This is why the scopes are a UNION and not a precedence order: under
   * precedence the trait would have to be recorded twice, and the two copies
   * would each carry their own once-per-encounter limit — handing the character
   * two uses of an ability that has one.
   */
  test("one grant can carry an attribute scope and a weapon scope at once", () => {
    const both = [{
      kind: "second", skill: null, attribute: "str", weaponCategory: "knuckles",
      perEncounter: true, source: "ZZ surge", sourceId: "i1"
    }];
    const offered = (ctx, spent = []) => offeredRerolls(both, ctx, spent).length;

    assert.equal(offered({ skillKey: "athletics" }), 1, "the attribute half was lost");
    assert.equal(offered({ attributeKey: "str" }), 1, "the raw attribute check was lost");
    assert.equal(offered({ weaponCategory: "knuckles" }), 1, "the weapon half was lost");

    assert.equal(offered({ weaponCategory: "swords" }), 0, "it reached another weapon group");
    assert.equal(offered({ skillKey: "loreArcane" }), 0, "it reached another attribute's skills");

    /** ONE use, spent from whichever side used it. */
    assert.equal(offered({ weaponCategory: "knuckles" }, ["i1"]), 0);
    assert.equal(offered({ skillKey: "athletics" }, ["i1"]), 0,
      "spending it on an attack left the skill half still available");
  });

  test("the spend key prefers the item id and falls back to the name", () => {
    assert.equal(rerollGrantId({ sourceId: "i9", source: "ZZ" }), "i9");
    assert.equal(rerollGrantId({ sourceId: null, source: "ZZ" }), "ZZ");
    assert.equal(rerollGrantId({}), null);
  });

  test("the aggregate carries the limit and the item id across", () => {
    const g = aggregateGrants([{
      __source: "ZZ spec", __sourceId: "item-1",
      reroll: { second: true, weaponCategory: "axes", perEncounter: true }
    }]);
    assert.equal(g.rerolls[0].perEncounter, true);
    assert.equal(g.rerolls[0].weaponCategory, "axes");
    assert.equal(g.rerolls[0].sourceId, "item-1");
  });

  /**
   * The spent list lives on the COMBATANT, which Foundry deletes with the
   * combat — so the reset is the encounter ending and there is no hook to
   * forget. Asserted on the source because only a live Foundry can show the
   * document lifecycle, and the mistake worth guarding is storing it on the
   * actor, where it would persist for the rest of the campaign.
   */
  test("spent state is kept on the combatant, not the actor", () => {
    const chat = read("module/chat.mjs");
    /**
     * THE FUNCTION BODY, not a fixed window after its name. A 400-character
     * slice ran past the end of `spentRerolls` into `markRerollSpent`, which
     * mentions the combatant too — so replacing the whole body with an ACTOR
     * flag lookup left this green. Caught by mutation, not by reading it.
     */
    const at = chat.indexOf("export function spentRerolls");
    const fn = chat.slice(at, chat.indexOf("\n}", at));
    assert.match(fn, /getCombatantByActor/,
      "the spent list is not being read off the combatant");
    assert.ok(!/actor\.getFlag/.test(fn),
      "a per-encounter spend read from the ACTOR never clears");
    assert.ok(!/actor\.setFlag|actor\.update/.test(chat.slice(
      chat.indexOf("async function markRerollSpent"),
      chat.indexOf("async function onGrantedReroll"))),
      "a per-encounter spend written to the ACTOR never clears");
  });
});
