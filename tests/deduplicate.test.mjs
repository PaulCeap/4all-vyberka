import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateTenders } from "../src/deduplicate.mjs";
import { normalizeTender } from "../src/model.mjs";

test("stejná zakázka z více zdrojů se sloučí podle fingerprintu", () => {
  const common = { title: "PR kampaň města", buyer: "Město Demo", deadline: "2026-09-01T10:00:00Z" };
  const first = normalizeTender({ ...common, source: "ted", sourceId: "1", summary: "Krátce" });
  const second = normalizeTender({ ...common, source: "zakazky-gov", sourceId: "2", summary: "Výrazně podrobnější popis předmětu veřejné zakázky." });
  const result = deduplicateTenders([first, second]);
  assert.equal(result.length, 1);
  assert.match(result[0].summary, /podrobnější/);
  assert.deepEqual(new Set(result[0].duplicateSources), new Set(["ted", "zakazky-gov"]));
});

test("různí anonymní zadavatelé se stejným názvem a termínem se nesloučí", () => {
  const common = { title: "Reklamní a marketingové služby", deadline: "2026-08-15T10:00:00Z" };
  const first = normalizeTender({ ...common, source: "poptavky", sourceId: "2050851", buyer: "Zadavatel z Poptávky.cz", summary: "Obec Křetín" });
  const second = normalizeTender({ ...common, source: "poptavej", sourceId: "VZ142853", buyer: "Zadavatel z Poptávej.cz", summary: "Dětská léčebna" });
  assert.equal(deduplicateTenders([first, second]).length, 2);
});

test("při sloučení se zachová přesný čas termínu", () => {
  const rough = normalizeTender({
    source: "poptavej", sourceId: "1", title: "Komunikační kampaň", buyer: "Město Demo",
    deadline: "2026-10-31T11:00:00Z", deadlineTimeKnown: false,
  });
  const precise = normalizeTender({
    source: "nen", sourceId: "2", title: "Komunikační kampaň", buyer: "Město Demo",
    deadline: "2026-10-31T12:00:00Z", deadlineTimeKnown: true,
  });
  const [merged] = deduplicateTenders([rough, precise]);
  assert.equal(merged.deadline, precise.deadline);
  assert.equal(merged.deadlineTimeKnown, true);
});

test("ověřený výtah má při sloučení přednost před delším neověřeným popisem", () => {
  const common = { title: "Kampaň města", buyer: "Město Demo", deadline: "2026-10-31T12:00:00Z" };
  const reviewed = normalizeTender({
    ...common, source: "nen", sourceId: "1", summary: "Tvorba PR kampaně.",
    factsReviewedAt: "2026-10-17T12:00:00Z",
    verifiedFacts: [{ text: "Zakázka zahrnuje tiskové zprávy.", url: "https://example.test/zadani.pdf" }],
  });
  const raw = normalizeTender({
    ...common, source: "ted", sourceId: "2",
    summary: "Dlouhý automaticky složený popis, který má výrazně více znaků, ale nebyl ověřen v zadání.",
  });
  const [merged] = deduplicateTenders([reviewed, raw]);
  assert.equal(merged.summary, reviewed.summary);
  assert.deepEqual(merged.verifiedFacts, reviewed.verifiedFacts);
});
