import test from "node:test";
import assert from "node:assert/strict";
import { findOriginalRows, fetchOriginalDetail } from "../src/origin-discovery.mjs";
import { resolveAggregatorLeads } from "../src/origin-resolver.mjs";

const original = {
  source: "nen", sourceId: "N006/26/V00012345",
  url: "https://nen.nipez.cz/verejne-zakazky/detail-zakazky/N006-26-V00012345",
  title: "Zajištění komunikační kampaně pro návštěvníky muzea",
  buyer: "Město Test", summary: "Tvorba obsahu a správa sociálních sítí.",
  deadline: "2026-11-05T10:00:00Z",
};
const lead = {
  source: "poptavej", sourceId: "VZ123", url: "https://www.poptavej.cz/verejna-zakazka/VZ123/x",
  title: original.title, buyer: "Zadavatel z Poptávej.cz",
  summary: "Text z agregátoru, který se nesmí použít pro hodnocení.",
  deadline: original.deadline, opportunityType: "public-tender",
  candidateOriginUrls: [original.url],
};

test("pouhý odkaz z agregátoru nezmění tip na ověřenou zakázku", () => {
  const { rows } = resolveAggregatorLeads([lead], []);
  assert.equal(rows[0].originStatus, "unresolved");
  assert.equal(rows[0].source, "poptavej");
});

test("po načtení původního detailu se používají výhradně jeho údaje", async () => {
  const found = await findOriginalRows([lead], [], {
    fetchDetail: async () => original,
    searchNen: async () => { throw new Error("cílené hledání už není potřeba"); },
  });
  assert.equal(found.length, 1);
  const { rows } = resolveAggregatorLeads([lead], found);
  assert.equal(rows[0].source, "nen");
  assert.equal(rows[0].summary, original.summary);
  assert.equal(rows[0].buyer, original.buyer);
  assert.equal(rows[0].discoveryUrl, lead.url);
});

test("jiný termín či nejednoznačná shoda tip nepovýší", () => {
  const wrongDeadline = { ...original, deadline: "2026-11-06T10:00:00Z" };
  assert.equal(resolveAggregatorLeads([{ ...lead, candidateOriginUrls: [] }], [wrongDeadline]).rows[0].originStatus, "unresolved");
  assert.equal(resolveAggregatorLeads([lead], [wrongDeadline]).rows[0].deadline, wrongDeadline.deadline);
  const twin = { ...original, sourceId: "N006/26/V00054321", url: `${original.url}-2` };
  assert.equal(resolveAggregatorLeads([{ ...lead, candidateOriginUrls: [] }], [original, twin]).rows[0].originStatus, "unresolved");
});

test("oficiální detail NEN se skutečně přečte, nikoli odvodí z URL", async () => {
  const state = { detailObjectStore: { objects: { item: { object: {
    kod: original.sourceId, nazev: original.title, zadavatelNazev: original.buyer,
    popisPredmet: original.summary, podaniLhuta: original.deadline,
  } } } } };
  const fetched = await fetchOriginalDetail(original.url, {
    fetchImpl: async () => new Response(`<meta name="initialReduxState" content="${encodeURIComponent(JSON.stringify(state))}">`),
  });
  assert.equal(fetched.summary, original.summary);
  assert.equal(fetched.buyer, original.buyer);
});

test("nepřístupný detail zůstane interním tipem a hledá se další oficiální cesta", async () => {
  const found = await findOriginalRows([lead], [], {
    fetchDetail: async () => { throw new Error("HTTP 503"); },
    searchNen: async () => [original],
    minimumScore: 0,
  });
  assert.deepEqual(found, [original]);
});
