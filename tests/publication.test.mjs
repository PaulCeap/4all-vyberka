import test from "node:test";
import assert from "node:assert/strict";
import { publicDataset } from "../src/publication.mjs";

test("veřejná data obsahují původní zakázku, nikoli agregátor nebo jeho odkaz", () => {
  const dataset = {
    sources: [{ id: "poptavej", count: 20 }, { id: "nen", count: 1 }],
    tenders: [
      {
        source: "nen", sourceId: "N006/26/V00032165",
        url: "https://nen.nipez.cz/verejne-zakazky/detail-zakazky/N006-26-V00032165",
        summary: "Úplný popis zadavatele", discoverySource: "poptavej",
        discoveryUrl: "https://www.poptavej.cz/verejna-zakazka/VZ326386/x", originConfidence: 99,
        candidateProfileUrls: ["https://www.poptavej.cz/verejna-zakazka/VZ326386/x"],
        documents: [{ name: "Krycí list.docx", url: "https://nen.nipez.cz/file?id=1" }],
        documentsUrl: "https://nen.nipez.cz/zadavaci-dokumentace",
      },
      { source: "poptavej", url: "https://www.poptavej.cz/verejna-zakazka/VZ123/x" },
    ],
  };
  const published = publicDataset(dataset);
  assert.deepEqual(published.sources.map((source) => source.id), ["nen"]);
  assert.equal(published.tenders.length, 1);
  assert.equal(published.tenders[0].summary, "Úplný popis zadavatele");
  assert.match(published.tenders[0].url, /nen\.nipez\.cz/);
  assert.equal(published.tenders[0].documents, undefined);
  assert.equal(published.tenders[0].documentsUrl, undefined);
  assert.equal(JSON.stringify(published).includes("poptavej"), false);
  assert.equal(dataset.tenders[0].discoverySource, "poptavej");
});

test("záznam nalezený přes agregátor bez ověřeného odkazu se nepublikuje", () => {
  const dataset = { sources: [], tenders: [
    { source: "manual", discoverySource: "poptavky", url: "https://www.poptavky.cz/poptavka/123", title: "Tip" },
    { source: "manual", url: "https://www.poptavej.cz/verejna-zakazka/123", title: "Tip bez provenience" },
  ] };
  assert.equal(publicDataset(dataset).tenders.length, 0);
});
