import test from "node:test";
import assert from "node:assert/strict";
import { buildExtractiveNote, isCurrentReviewCandidate, reviewPendingDocuments } from "../src/automatic-review.mjs";
import { pendingDocumentReviews } from "../src/document-review.mjs";
import { attachVerifiedNotes } from "../src/verified-notes.mjs";

const now = new Date("2026-10-18T10:00:00Z");
const document = { name: "Zadávací dokumentace.pdf", url: "https://nen.nipez.cz/file?id=123" };
const candidate = {
  id: "nen:current", title: "Kreativní služby", status: "open",
  publishedAt: "2026-10-15T10:00:00Z", deadline: "2026-11-15T10:00:00Z",
  documents: [document],
};

test("fronta vyloučí uzavřené, prošlé a staré zakázky bez termínu", () => {
  assert.equal(isCurrentReviewCandidate(candidate, now), true);
  assert.equal(isCurrentReviewCandidate({ ...candidate, status: "closed" }, now), false);
  assert.equal(isCurrentReviewCandidate({ ...candidate, deadline: "2026-10-17T10:00:00Z" }, now), false);
  assert.equal(isCurrentReviewCandidate({ ...candidate, deadline: null, publishedAt: "2021-10-18T10:00:00Z" }, now), false);
  assert.equal(isCurrentReviewCandidate({ ...candidate, deadline: null, publishedAt: "2026-03-04T10:00:00Z" }, now), true);
  assert.equal(isCurrentReviewCandidate({ ...candidate, status: "unknown", deadline: null, publishedAt: "2026-03-04T10:00:00Z" }, now), false);
});

test("přečtený dokument se změní v dohledatelné věcné úryvky a opustí frontu", async () => {
  const input = pendingDocumentReviews([candidate], {});
  const extraction = [{ url: document.url, text: "Předmětem veřejné zakázky jsou PR služby, tvorba obsahu a správa sociálních sítí pro zadavatele.\n\nDodavatel zajistí komunikační strategii a přípravu tiskových zpráv pro veřejnost." }];
  const review = await reviewPendingDocuments(input, [candidate], now, { extract: async () => ({ documents: extraction }) });
  assert.equal(review.results[0].status, "reviewed");
  assert.match(review.notes[candidate.id].summary, /PR služby/);
  assert.ok(review.notes[candidate.id].facts.every((fact) => fact.url === document.url));
  assert.deepEqual(pendingDocumentReviews([candidate], review.notes), []);
});

test("selhání stažení nezmizí z fronty jako hotová kontrola", async () => {
  const input = pendingDocumentReviews([candidate], {});
  const review = await reviewPendingDocuments(input, [candidate], now, {
    extract: async () => ({ documents: [{ url: document.url, error: "HTTP 503" }] }),
  });
  assert.equal(review.results[0].status, "failed");
  assert.deepEqual(review.notes, {});
  assert.equal(pendingDocumentReviews([candidate], review.notes).length, 1);
});

test("automatický úryvek nesmaže širší popis původního zadání", () => {
  const original = "Zadavatel poptává reklamní služby, produkci videí, komunikaci kampaní a správu obsahu pro různé cílové skupiny. Součástí je i koncepční a kreativní práce.";
  const note = { method: "automatic-extraction", summary: "Zadavatel poptává reklamní služby.",
    facts: [{ text: "Zadavatel poptává reklamní služby.", url: document.url }],
    reviewedAt: now.toISOString(), documentSnapshot: [document.url] };
  const [row] = attachVerifiedNotes([{ ...candidate, source: "nen", sourceId: "current", summary: original }], { [candidate.id]: note });
  assert.equal(row.summary, original);
  assert.equal(row.verifiedFacts.length, 1);
});
