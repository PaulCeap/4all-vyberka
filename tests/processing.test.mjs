import test from "node:test";
import assert from "node:assert/strict";
import { currentNotes } from "../src/verified-notes.mjs";
import { pendingDocumentReviews, reviewDocuments } from "../src/document-review.mjs";
import { buildExtractiveNote, reviewPendingDocuments } from "../src/automatic-review.mjs";
import { buildReviewState, dueReviews, classifyLead, radarDataset, processingOverview } from "../src/processing-state.mjs";
import { primaryMatchConfidence, matchConfidence } from "../src/origin-resolver.mjs";
import { extractBudget, assessOpportunity } from "../src/assessment.mjs";
import { scoreTender } from "../src/scoring.mjs";
import { normalizeTender } from "../src/model.mjs";
import { getText } from "../src/sources/html-utils.mjs";

const now = new Date("2026-10-24T10:00:00Z");
const doc = { name: "Zadávací dokumentace.pdf", url: "https://example.cz/zd.pdf" };
const row = normalizeTender({ source: "nen", sourceId: "1", title: "Monitoring médií", buyer: "Ministerstvo",
  summary: "Poskytování denního monitoringu médií a analýzy mediálního obsahu pro zadavatele.",
  deadline: "2026-11-20T10:00:00Z", documents: [doc] }, now);

test("stará ruční poznámka nezablokuje nové automatické přečtení", () => {
  const manual = { [row.id]: { documentSnapshot: ["https://example.cz/old.pdf"] } };
  const auto = { [row.id]: { documentSnapshot: [doc.url], complete: true } };
  assert.equal(pendingDocumentReviews([row], currentNotes([row], auto, manual)).length, 0);
  assert.equal(currentNotes([row], auto, { [row.id]: { documentSnapshot: [doc.url], manual: true } })[row.id].manual, true);
});

test("monitoring médií i jeho skloňování potvrdí předmět z podkladů", () => {
  for (const text of [row.summary, "Předmětem jsou služby spočívající v monitoringu médií, poskytování denního monitoringu tištěných a elektronických médií."]) {
    const note = buildExtractiveNote(row, [{ url: doc.url, text }], now);
    assert.ok(note);
    assert.equal(note.facts[0].kind, "scope");
  }
  for (const title of ["Zajištění závěrečné konference", "Výzkumy trhu", "Příprava grafických materiálů"]) {
    assert.ok(scoreTender(normalizeTender({ ...row, title, summary: "" }, now), now, { preliminary: true }).score >= 42);
  }
});

test("přístroje a počítače nejsou zakázka na výrobu videa", () => {
  for (const [title, summary] of [
    ["PC pro střih videí", "Dodávka PC pro střih videí."],
    ["Video bronchoskop ultrazvukový", "Předmětem plnění je dodávka ultrazvukového video bronchoskopu."],
  ]) for (const preliminary of [true, false]) {
    assert.ok(scoreTender(normalizeTender({ ...row, title, summary }), now, { preliminary }).score < 42);
  }
  const venue = normalizeTender({ ...row, title: "Výjezdní zasedání managementu",
    summary: "Zajištění konferenčních prostor a souvisejících služeb k výjezdnímu zasedání managementu." });
  assert.ok(scoreTender(venue, now).score < 42);
});

test("výběr přeskočí skloňované formuláře a duplicitní podepsanou verzi", () => {
  const selected = reviewDocuments([
    doc, { name: "Zadávací dokumentace_podepsaná.pdf", url: "https://example.cz/signed.pdf" },
    { name: "Příloha č. 1 – Vzor krycího listu.docx" },
    { name: "Příloha č. 2 – Vzor čestného prohlášení dodavatele.docx" },
    { name: "Cenová kalkulace.xlsx", url: "https://example.cz/price.xlsx" },
  ]);
  assert.deepEqual(selected.map((d) => d.url), [doc.url, "https://example.cz/price.xlsx"]);
});

test("částečné přečtení zachová fakta a zároveň naplánuje opakování", async () => {
  const input = { ...row, documents: [doc, { name: "Příloha 1.xlsx", url: "https://example.cz/p.xlsx" }] };
  const pending = pendingDocumentReviews([input]);
  const review = await reviewPendingDocuments(pending, [input], now, { extract: async () => ({ documents: [
    { ...doc, text: row.summary }, { ...input.documents[1], error: "HTTP 503" },
  ] }) });
  assert.equal(review.results[0].status, "partial");
  assert.equal(review.notes[row.id].complete, false);
  assert.ok(review.notes[row.id].facts.length);
  assert.equal(pendingDocumentReviews([input], review.notes).length, 1);
});

test("opakování má odstup a po třech neúspěších konkrétní stav k řešení", () => {
  const pending = pendingDocumentReviews([row]);
  let previous = {};
  for (let day = 0; day < 3; day++) {
    const time = new Date(now.valueOf() + day * 86400_000);
    assert.equal(dueReviews(pending, [row], previous, time).length, 1);
    previous = buildReviewState({ candidates: [row], remaining: pending,
      results: [{ id: row.id, status: "failed", error: "HTTP 503" }],
      sourceErrors: [{ id: row.id, error: "HTTP 503" }], previous, now: time });
    assert.equal(previous.failedCount, 1); // one tender, not two error events
    assert.equal(dueReviews(pending, [row], previous, time).length, 0);
  }
  assert.equal(previous.tenders[0].status, "needs-review");
  assert.equal(previous.attentionCount, 1);
  assert.equal(previous.pendingCount, 0);
  const changed = { ...row, documents: [{ ...doc, url: "https://example.cz/changed.pdf" }] };
  assert.equal(dueReviews(pendingDocumentReviews([changed]), [changed], previous, now).length, 1);
});

test("úspěch uzavře frontu a nová položka dostane přednost před opakovanou chybou", () => {
  const failed = buildReviewState({ candidates: [row], remaining: pendingDocumentReviews([row]),
    results: [{ id: row.id, status: "failed", error: "503" }], now });
  const newRow = { ...row, id: "nen:2" };
  const due = dueReviews(pendingDocumentReviews([row, newRow]), [row, newRow], failed, new Date(now.valueOf() + 86400_000));
  assert.equal(due[0].id, newRow.id);
  const resolved = buildReviewState({ candidates: [row], remaining: [], results: [{ id: row.id, status: "reviewed" }], previous: failed, now });
  assert.equal(resolved.pendingCount, 0);
  assert.equal(resolved.tenders[0].status, "reviewed");
});

test("radar rozliší vyřazení, ověření komerčního zdroje a skutečné čekání", () => {
  const lead = { ...row, source: "poptavky", sourceId: "1", originStatus: "unresolved", lastSeenAt: now.toISOString() };
  assert.equal(classifyLead(lead, now).processingStatus, "pending");
  assert.equal(classifyLead({ ...lead, opportunityType: "commercial-demand" }, now).processingStatus, "needs-verification");
  assert.equal(classifyLead({ ...lead, title: "Tisk triček", summary: "Potisk 200 triček.", cpv: [] }, now).processingStatus, "rejected");
  assert.equal(classifyLead({ ...lead, originCheckAttempts: 3 }, now).processingStatus, "needs-verification");
  const radar = radarDataset([], { leads: [{ ...lead, deadline: "2020-01-01" }] }, now);
  assert.equal(radar.leads.length, 1);
  assert.equal(radar.counts.expired, 1);
});

test("odklad termínu spáruje TED s doloženým profilem, nikoli anonymní agregátor", () => {
  const profile = "https://www.e-zakazky.cz/profil-zadavatele/demo";
  const primary = { ...row, title: "Zajištění realizace marketingové strategie pro rok 2027", url: `${profile}/zakazka/P26V1` };
  const notice = { ...primary, source: "ted", deadline: "2026-11-02T10:00:00Z", candidateProfileUrls: [profile] };
  assert.equal(primaryMatchConfidence(notice, primary), 96);
  assert.equal(primaryMatchConfidence({ ...notice, candidateProfileUrls: [profile.replace('profil-zadavatele', 'Profil-Zadavatele')] }, primary), 96);
  assert.equal(matchConfidence({ ...notice, source: "poptavky" }, primary), 0);
  assert.equal(primaryMatchConfidence({ ...notice, candidateProfileUrls: [] }, primary), 0);
  assert.equal(primaryMatchConfidence({ ...notice, buyer: "Jiný zadavatel" }, primary), 0);
});

test("rozpočet se získá jen z výslovné celkové hodnoty a rozpory neodhaduje", () => {
  assert.deepEqual(extractBudget([{ url: doc.url, text: "Předpokládaná hodnota veřejné zakázky činí 12 892 561,98 Kč bez DPH." }])?.value,
    { amount: 12892561.98, currency: "CZK" });
  assert.equal(extractBudget([{ url: doc.url, text: "Reference alespoň 300 000 Kč." }]), null);
  assert.equal(extractBudget([{ url: doc.url, text: "Předpokládaná hodnota 100 000 Kč. Předpokládaná hodnota 200 000 Kč." }]), null);
  assert.match(assessOpportunity(row).explanation, /nikoli odhad zisku/);
});

test("dočasné chyby se opakují, chybné oprávnění se neopakuje", async () => {
  let calls = 0;
  const text = await getText("https://example.cz", { retryDelayMs: 0, retries: 2,
    fetchImpl: async () => new Response(++calls === 3 ? "ok" : "busy", { status: calls === 3 ? 200 : 503 }) });
  assert.equal(text, "ok");
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(getText("https://example.cz", { retryDelayMs: 0,
    fetchImpl: async () => { calls++; return new Response("no", { status: 403 }); } }));
  assert.equal(calls, 1);
});

test("upozornění rozlišuje aktualizaci zveřejněné zakázky", () => {
  const state = buildReviewState({ candidates: [row], remaining: pendingDocumentReviews([row]),
    results: [{ id: row.id, status: "failed", error: "503" }], now });
  const overview = processingOverview(state, { leads: [], counts: {} }, [], [row], now);
  assert.equal(overview.items[0].published, true);
});
