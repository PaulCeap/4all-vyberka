import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTender } from "../src/model.mjs";
import { assessScope } from "../src/scope.mjs";
import { scoreTender } from "../src/scoring.mjs";

const now = new Date("2026-10-18T10:00:00Z");

function candidate(title, summary) {
  return normalizeTender({
    source: "nen", sourceId: title, title, summary, buyer: "Zadavatel",
    procedureType: "Služby", deadline: "2026-11-12T09:00:00Z",
  }, now);
}

const included = [
  ["PR agentura", "Poptáváme PR služby a vztahy s médii."],
  ["Komunikační kampaň", "Dodavatel připraví komunikační strategii."],
  ["Tvorba obsahu pro web", "Předmětem je copywriting a tvorba textů."],
  ["Grafické práce", "Předmětem jsou grafické služby."],
  ["Výroba videí", "Dodavatel zajistí výrobu čtyř videí a jejich střih."],
  ["Produkce podcastu", "Zajistí nahrávání a střih podcastových dílů."],
  ["Fotografické služby", "Předmětem je focení akcí a portrétů."],
  ["Produkční zajištění natáčení", "Předmětem je produkční zajištění natáčení pořadu."],
  ["Produkce akce", "Dodavatel zajistí organizaci konference."],
  ["Nákup mediálního prostoru", "Předmětem jsou reklamní plochy pro výstavu."],
];

for (const [title, summary] of included) {
  test(`služba 4ALL projde: ${title}`, () => {
    const tender = candidate(title, summary);
    assert.equal(assessScope(tender).eligible, true);
    assert.ok(scoreTender(tender, now).score >= 42);
  });
}

test("samostatný redaktor městských novin neprojde", () => {
  const tender = candidate("Kyjovské noviny - externí redaktor",
    "Redakční činnost periodika, texty, grafická stránka a výběr fotografií.");
  assert.equal(assessScope(tender).eligible, false);
  assert.ok(scoreTender(tender, now).score < 42);
});

test("okrajová zmínka o videu ani obecná AI zakázka nestačí", () => {
  for (const tender of [
    candidate("IT infrastruktura", "Dodávka serverů. V příloze je video s návodem."),
    candidate("Videotechnika", "Dodávka videotechniky pro učebnu."),
    candidate("Fotovoltaika", "Dodávka fotovoltaických panelů."),
    candidate("AI chatbot", "Vývoj chatbota pro správu interních dat."),
  ]) {
    assert.equal(assessScope(tender).eligible, false);
    assert.ok(scoreTender(tender, now).score < 42);
  }
});
