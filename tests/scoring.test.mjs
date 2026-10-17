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

test("samostatná pozice redaktora novin není marketingový tendr", () => {
  const tender = normalizeTender({
    source: "proebiz", sourceId: "6297", title: "Kyjovské noviny - externí redaktor",
    buyer: "Město Kyjov",
    summary: "Samostatná redakční činnost, tvorba článků, grafická stránka vydání a výběr fotografií pro městské noviny.",
    deadline: "2026-10-30T08:00:00Z", procedureType: "Služby",
  }, new Date("2026-10-18T00:00:00Z"));
  assert.ok(scoreTender(tender, new Date("2026-10-18T00:00:00Z")).score < 42);
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

test("ověřený obsah rozhoduje i při obecném názvu", () => {
  const tender = normalizeTender({
    source: "test", sourceId: "4", title: "Rámcová dohoda pro rok 2027",
    buyer: "Město", summary: "PR služby, komunikační strategie, správa sociálních sítí a tvorba obsahu.",
    factsReviewedAt: "2026-08-08T10:00:00Z",
    verifiedFacts: [{ text: "Dodavatel zajistí tiskové zprávy.", url: "https://example.test/zadani.pdf" }],
    deadline: "2026-08-30T10:00:00Z", procedureType: "Služby",
  }, now);
  const result = scoreTender(tender, now);
  assert.ok(result.score >= 55);
  assert.ok(result.reasons.some((reason) => reason.includes("ověřený výtah")));
});

test("samotný lákavý název a CPV nestačí k publikované shodě", () => {
  const tender = normalizeTender({
    source: "test", sourceId: "5", title: "PR služby a marketingová kampaň",
    buyer: "Město", summary: "Zadání je v příloze.", cpv: ["79340000"],
    deadline: "2026-08-30T10:00:00Z", procedureType: "Služby",
  }, now);
  assert.ok(scoreTender(tender, now).score < 42);
  assert.ok(scoreTender(tender, now, { preliminary: true }).score >= 42);
});

test("věcný údaj z ověřených podkladů může zvýšit shodu", () => {
  const tender = normalizeTender({
    source: "test", sourceId: "6", title: "Zakázka na služby",
    buyer: "Město", summary: "Zajištění odborných služeb.",
    factsReviewedAt: "2026-08-08T10:00:00Z",
    verifiedFacts: [{ text: "Součástí je tvorba obsahu a správa sociálních sítí.", url: "https://example.test/zadani.pdf" }],
    deadline: "2026-08-30T10:00:00Z", procedureType: "Služby",
  }, now);
  assert.ok(scoreTender(tender, now).score > scoreTender({ ...tender, factsReviewedAt: null }, now).score);
});
