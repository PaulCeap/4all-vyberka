import test from "node:test";
import assert from "node:assert/strict";
import { attachNenDocuments, findOriginalRows, fetchOriginalDetail, preferPrimaryProfiles, refreshSavedNenProfiles } from "../src/origin-discovery.mjs";
import { resolveAggregatorLeads } from "../src/origin-resolver.mjs";
import { attachVerifiedNotes } from "../src/verified-notes.mjs";
import { pendingDocumentReviews, reviewDocuments } from "../src/document-review.mjs";

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

test("stručné oznámení TED se nahradí původním profilem NEN", async () => {
  const ted = {
    source: "ted", sourceId: "687952-2026", title: original.title,
    buyer: original.buyer, url: "https://ted.europa.eu/cs/notice/-/detail/687952-2026",
    value: { amount: 5_000_000, currency: "CZK" },
  };
  const result = await preferPrimaryProfiles([ted], {
    minimumScore: 0, searchNen: async () => [original],
    previousTenders: [{ id: "ted:687952-2026", firstSeenAt: "2026-10-06T09:00:00Z", originStatus: "resolved" }],
  });
  assert.equal(result.rows[0].source, "nen");
  assert.equal(result.rows[0].deadline, original.deadline);
  assert.equal(result.rows[0].value.amount, 5_000_000);
  assert.equal(result.rows[0].firstSeenAt, "2026-10-06T09:00:00Z");
  assert.equal(result.rows[0].originStatus, "resolved");
  assert.ok(result.supersededIds.has("ted:687952-2026"));
});

test("TED s odkazem na profil zadavatele vybere jeho konkrétní zakázku", async () => {
  const profile = "https://www.e-zakazky.cz/profil-zadavatele/01d47fe3-916b-4869-bc75-c097dc0eefe1";
  const primary = {
    source: "official-profile", sourceId: "P26V00000072",
    url: `${profile}/zakazka/P26V00000072`,
    title: "Zajištění realizace marketingové strategie pro rok 2027",
    buyer: "Oborová zdravotní pojišťovna",
    deadline: "2026-11-02T09:00:00.000Z", documents: [],
  };
  const ted = {
    source: "ted", sourceId: "706257-2026", title: primary.title, buyer: primary.buyer,
    url: "https://ted.europa.eu/cs/notice/-/detail/706257-2026",
    summary: "Oficiální oznámení", candidateProfileUrls: [profile],
  };
  let nenCalls = 0;
  const result = await preferPrimaryProfiles([ted], {
    minimumScore: 0,
    searchProfile: async (url) => { assert.equal(url, profile); return [primary]; },
    searchNen: async () => { nenCalls += 1; return []; },
  });
  assert.equal(result.rows[0].url, primary.url);
  assert.equal(result.rows[0].deadline, primary.deadline);
  assert.equal(result.rows[0].summary, ted.summary);
  assert.equal(nenCalls, 0);
  assert.ok(result.supersededIds.has("ted:706257-2026"));
});

test("NEN podklady se načtou jen k relevantní zakázce", async () => {
  const rows = await attachNenDocuments([original], {
    minimumScore: 0,
    fetchDocuments: async (url) => ({
      url: `${url}/zadavaci-dokumentace`, documents: [{ name: "Zadání.pdf", url: "https://nen.nipez.cz/file?id=1" }],
    }),
  });
  assert.equal(rows[0].documents.length, 1);
  assert.match(rows[0].documentsUrl, /zadavaci-dokumentace$/);
});

test("starší NEN zakázka se znovu čte, ale bez starých poznámek", async () => {
  const [row] = await refreshSavedNenProfiles([{
    ...original, firstSeenAt: "2026-10-06T09:00:00Z", verifiedFacts: [{ text: "Starý údaj" }],
  }], { fetchDetail: async () => ({ ...original, deadline: "2026-11-07T09:00:00Z" }) });
  assert.equal(row.deadline, "2026-11-07T09:00:00Z");
  assert.equal(row.firstSeenAt, "2026-10-06T09:00:00Z");
  assert.deepEqual(row.verifiedFacts, []);
});

test("nedostupná dokumentace nezachová dříve ověřené poznámky", async () => {
  const [row] = await attachNenDocuments([{
    ...original, documents: [{ name: "Staré zadání", url: "https://nen.nipez.cz/file?id=1" }],
    verifiedFacts: [{ text: "Starý údaj", url: "https://nen.nipez.cz/file?id=1" }],
  }], { minimumScore: 0, fetchDocuments: async () => { throw new Error("503"); } });
  assert.deepEqual(row.documents, []);
  assert.deepEqual(row.verifiedFacts, []);
  assert.match(row.documentsUrl, /zadavaci-dokumentace$/);
});

test("poznámky z dokumentace zmizí, pokud přibude nové vysvětlení", () => {
  const notes = { "nen:N006/26/V00012345": {
    reviewedAt: "2026-10-18T00:00:00Z",
    documentSnapshot: ["https://nen.nipez.cz/file?id=1"],
    summary: "Krátký ověřený popis.",
    facts: [{ text: "Limit 5 mil. Kč", url: "https://nen.nipez.cz/file?id=1" }],
  } };
  const row = { ...original, documents: [{ name: "Zadávací dokumentace.pdf", url: "https://nen.nipez.cz/file?id=1" }] };
  assert.equal(attachVerifiedNotes([row], notes)[0].verifiedFacts.length, 1);
  assert.equal(attachVerifiedNotes([row], notes)[0].summary, "Krátký ověřený popis.");
  assert.equal(attachVerifiedNotes([{ ...row, documents: [...row.documents, {
    name: "Vysvětlení zadávací dokumentace.pdf", url: "https://nen.nipez.cz/file?id=2",
  }] }], notes)[0].verifiedFacts, undefined);
  assert.equal(attachVerifiedNotes([{ ...row, documents: [...row.documents, {
    name: "Krycí list nabídky.docx", url: "https://nen.nipez.cz/file?id=3",
  }] }], notes)[0].verifiedFacts.length, 1);
});

test("ke čtení se vyberou věcné podklady bez administrativních formulářů", () => {
  const selected = reviewDocuments([
    { name: "Šifrovací klíč.txt" },
    { name: "00_Zadavaci_dokumentace.pdf" },
    { name: "01_Krycí list nabídky.docx" },
    { name: "Vysvětlení zadávací dokumentace č. 1.pdf" },
    { name: "04_Požadavky na prokázání kvalifikace.docx" },
    { name: "05_Seznam poddodavatelů.docx" },
  ]);
  assert.deepEqual(selected.map((document) => document.name), [
    "00_Zadavaci_dokumentace.pdf",
    "Vysvětlení zadávací dokumentace č. 1.pdf",
    "04_Požadavky na prokázání kvalifikace.docx",
  ]);
});

test("fronta pro čtení hlásí pouze nové nebo změněné věcné dokumenty", () => {
  const row = { id: "nen:1", title: "Kampaň", documents: [
    { name: "Zadávací dokumentace.pdf", url: "https://nen.nipez.cz/file?id=1" },
  ] };
  assert.equal(pendingDocumentReviews([row], {}).length, 1);
  const notes = { "nen:1": { documentSnapshot: [row.documents[0].url] } };
  assert.equal(pendingDocumentReviews([row], notes).length, 0);
  assert.equal(pendingDocumentReviews([{ ...row, documents: [...row.documents, {
    name: "Krycí list.docx", url: "https://nen.nipez.cz/file?id=2",
  }] }], notes).length, 0);
  assert.equal(pendingDocumentReviews([{ ...row, documents: [...row.documents, {
    name: "Vysvětlení zadání.pdf", url: "https://nen.nipez.cz/file?id=3",
  }] }], notes).length, 1);
});

test("denní limit hledání dává přednost nejdéle neprověřenému tipu", async () => {
  const checked = [];
  await findOriginalRows([
    { ...lead, candidateOriginUrls: [], lastOriginCheckAt: "2026-10-17T00:00:00Z" },
    { ...lead, sourceId: "VZ124", title: "Nová komunikační kampaň města", candidateOriginUrls: [], lastOriginCheckAt: null },
  ], [], {
    minimumScore: 0, searchLimit: 1, searchNen: async () => [],
    onChecked: (row) => checked.push(row.sourceId),
  });
  assert.deepEqual(checked, ["VZ124"]);
});
