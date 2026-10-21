import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessScope } from "../src/scope.mjs";
import { scoreTender } from "../src/scoring.mjs";
import { normalizeTender } from "../src/model.mjs";
import { buildDataset } from "../src/dataset.mjs";
import { fetchNen } from "../src/sources/nen.mjs";
import { fetchTed } from "../src/sources/ted.mjs";
import { attachVerifiedNotes } from "../src/verified-notes.mjs";
import { reviewSnapshot } from "../src/document-review.mjs";

// Official NEN description and TED value, retrieved 2026-10-21. No curated brief.
const raw = JSON.parse(readFileSync(new URL("../data/fixtures/mzp-opzp-2026.json", import.meta.url)));
const now = new Date("2026-10-21T12:00:00Z");

test("MŽP event services pass scope, scoring and publication using the original description", () => {
  const tender = normalizeTender(raw, now);
  assert.deepEqual(assessScope(tender).contentAreas, ["marketing"]);
  assert.ok(scoreTender(tender, now).score >= 42);
  const { dataset } = buildDataset({ rows: [raw], sources: [], previous: { tenders: [] }, now });
  assert.equal(dataset.tenders[0]?.id, "nen:N006/26/V00021404");
  assert.equal(dataset.tenders[0].deadline, "2026-11-02T07:00:00.000Z");
});

test("NEN discovers Czech event titles without the words event or production", async () => {
  const html = (state) => `<meta name="initialReduxState" content="${encodeURIComponent(JSON.stringify(state))}">`;
  const rows = await fetchNen({ fetchImpl: async (url) => {
    if (String(url).includes("detail-zakazky")) return new Response(html({ detailObjectStore: { objects: {
      detail: { object: { kod: raw.sourceId, nazev: raw.title, popisPredmet: raw.summary,
        podaniLhuta: "2026-11-02T08:00:00", stavZP: "neukoncena", druhVZ: "Sluzby" } },
    } } }));
    const route = decodeURIComponent(String(url));
    return new Response(html({ collectionStore: { collections: { "verejne-zakazky-seznam": {
      collection: route.includes("query=zajištění akcí") ? [{ kod: raw.sourceId }] : [],
    } } } }));
  } });
  assert.equal(rows[0]?.sourceId, raw.sourceId);
});

test("event support recognition does not admit building, IT or catering-only work", () => {
  for (const summary of [
    "Technická a organizační podpora při realizaci stavby konferenčního centra.",
    "Dodávka techniky do konferenčního sálu. Instalace serverů a projekční techniky.",
    "Zajištění občerstvení a ubytování účastníků konference.",
    "Technická a organizační podpora provozu informačního systému.",
  ]) {
    const tender = normalizeTender({ ...raw, title: "Služby", summary }, now);
    assert.equal(assessScope(tender).eligible, false, summary);
    assert.ok(scoreTender(tender, now).score < 42, summary);
  }
});

test("TED recovers the October 2 event outside the eight-day daily window", async () => {
  const queries = [];
  const rows = await fetchTed({ now, fetchImpl: async (_url, options) => {
    const { query } = JSON.parse(options.body);
    queries.push(query);
    const recovered = query.includes("classification-cpv = 79950000");
    return Response.json({ notices: recovered ? [{
      "publication-number": "680377-2026", "notice-title": { ces: raw.title },
      "description-proc": { ces: raw.summary }, "publication-date": "2026-10-02",
    }] : [] });
  } });
  assert.match(queries[0], /publication-date >= 20261013/);
  assert.match(queries[1], /publication-date >= 20260906 AND publication-date < 20261013/);
  assert.equal(rows[0]?.sourceId, "680377-2026");
});

test("a failed TED recovery does not discard the current daily results", async () => {
  const rows = await fetchTed({ now, fetchImpl: async (_url, options) => {
    if (JSON.parse(options.body).query.includes("classification-cpv")) throw new Error("timeout");
    return Response.json({ notices: [{ "publication-number": "700000-2026", "notice-title": { ces: "New event" } }] });
  } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceId, "700000-2026");
});

test("a reviewed value fills an omitted NEN value only while the document snapshot matches", () => {
  const row = { ...raw, value: null, documents: [{ name: "Zadávací dokumentace.pdf", url: "https://nen.nipez.cz/file?id=1" }] };
  const notes = { [`${raw.source}:${raw.sourceId}`]: {
    documentSnapshot: reviewSnapshot(row.documents), value: raw.value, valueSource: "verified-documents",
  } };
  assert.equal(attachVerifiedNotes([row], notes)[0].value.amount, raw.value.amount);
  assert.equal(attachVerifiedNotes([{ ...row, value: { amount: 10, currency: "CZK" } }], notes)[0].value.amount, 10);
  assert.equal(attachVerifiedNotes([{ ...row, documents: [{ ...row.documents[0], url: "https://nen.nipez.cz/file?id=2" }] }], notes)[0].value, null);
});

test("a liability insurance requirement does not turn an event tender into insurance services", () => {
  const tender = normalizeTender({ ...raw, factsReviewedAt: now.toISOString(), verifiedFacts: [{
    text: "Vyžaduje se pojištění odpovědnosti nejméně 2 mil. Kč.", url: raw.url,
  }] }, now);
  assert.ok(scoreTender(tender, now).score >= 42);
  const insurance = normalizeTender({ ...raw, title: "Pojišťovací služby",
    summary: "Pojištění vozidel a majetku zadavatele." }, now);
  assert.ok(scoreTender(insurance, now).score < 42);
});
