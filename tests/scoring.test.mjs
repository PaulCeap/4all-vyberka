import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTender } from "../src/model.mjs";
import { scoreTender } from "../src/scoring.mjs";

const now = new Date("2026-08-09T10:00:00Z");

test("komunikační kampaň získá vysoké a vysvětlitelné skóre", () => {
  const tender = normalizeTender({
    source: "test", sourceId: "1", title: "Komunikační a kreativní kampaň",
    buyer: "Město", summary: "PR služby, tvorba obsahu, video a správa sociálních sítí.",
    deadline: "2026-08-30T10:00:00Z", cpv: ["79340000"], procedureType: "Služby",
  }, now);
  const result = scoreTender(tender, now);
  assert.ok(result.score >= 75);
  assert.ok(result.categories.some((category) => category.id === "pr"));
  assert.ok(result.reasons.length > 0);
});

test("stavební zakázka neprojde ani s obecným slovem komunikace", () => {
  const tender = normalizeTender({
    source: "test", sourceId: "2", title: "Rekonstrukce komunikace",
    buyer: "Obec", summary: "Stavební práce na místní komunikaci.",
    deadline: "2026-09-30T10:00:00Z", cpv: ["45000000"], procedureType: "Stavební práce",
  }, now);
  assert.ok(scoreTender(tender, now).score < 42);
});

test("prošlá zakázka dostane výraznou penalizaci", () => {
  const tender = normalizeTender({
    source: "test", sourceId: "3", title: "Marketingová kampaň a PR služby",
    buyer: "Město", summary: "Komunikační strategie a sociální sítě.",
    deadline: "2026-07-01T10:00:00Z", cpv: ["79340000"], procedureType: "Služby",
  }, now);
  assert.ok(scoreTender(tender, now).score < 55);
});

test("aktivní komerční tendr z médií dostane vysvětlitelný bonus", () => {
  const tender = normalizeTender({
    source: "mediaguru", sourceId: "zubr", title: "Pivovary hledají eventovou agenturu",
    buyer: "Pivovary", summary: "Festivaly, promo akce a eventový marketing.",
    publishedAt: "2026-06-15T06:00:00Z", opportunityType: "market-signal",
  }, now);
  const result = scoreTender(tender, now);
  assert.ok(result.score >= 42);
  assert.ok(result.reasons.some((reason) => reason.includes("komerční")));
});
