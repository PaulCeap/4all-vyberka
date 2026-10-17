import test from "node:test";
import assert from "node:assert/strict";
import { fetchPoptavky, parsePoptavkyDetail } from "../src/sources/poptavky.mjs";
import { fetchPoptavej, parsePoptavejDetail } from "../src/sources/poptavej.mjs";
import { czechDate, getText, plainText } from "../src/sources/html-utils.mjs";
import { parseMediaFeed } from "../src/sources/media-signals.mjs";
import { fetchTenderArena, parseTenderArenaList } from "../src/sources/tenderarena.mjs";
import { fetchZakazkyGov } from "../src/sources/zakazky-gov.mjs";
import { fetchTed, parseTedNotice } from "../src/sources/ted.mjs";
import { fetchEzakazkyDocuments, parseEzakazkyDetail, searchEzakazkyProfile } from "../src/sources/e-zakazky.mjs";
import { parseEzakDetail, parseEzakList } from "../src/sources/ezak-watchlist.mjs";
import { extractCandidateOriginUrls, resolveAggregatorLeads } from "../src/origin-resolver.mjs";
import { fetchNen, parseNenDetail, parseNenDocuments, selectNenSummaries } from "../src/sources/nen.mjs";

test("Poptávky.cz přečte JSON-LD, cenu a deadline", () => {
  const demand = { "@type": "Demand", identifier: "2050851", name: "Reklamní a marketingové služby", description: "Lokalita:\n- Křetín\nTermín pro podání nabídek:\n- 15. 08. 2026 12:00", mainEntityOfPage: { url: "https://example.test/1" } };
  const html = `<script type="application/ld+json">${JSON.stringify(demand)}</script><li>Datum publikace: <strong>7. 8. 2026 08:44</strong></li><li>Odhad ceny: <strong>3 000 000 Kč</strong></li>`;
  const row = parsePoptavkyDetail(html, "https://example.test/1");
  assert.equal(row.sourceId, "2050851");
  assert.equal(row.value.amount, 3_000_000);
  assert.match(row.deadline, /^2026-08-15/);
  assert.equal(row.deadlineTimeKnown, true);
});

test("Poptávej.cz přečte veřejnou zakázku", () => {
  const html = `<h1>Marketingová strategie</h1><p class="popis">Předmět: marketingové služby Lokalita: Praha Termín: do října</p><div class="title">Datum vyhlášení zadavatelem:</div><div class="value">7.8.2026</div><div class="title">Datum pro podání nabídky:</div><div class="value"><b>14.8.2026</b></div><div class="title">Předpokládaná hodnota:</div><div class="value cena">1 700 000 Kč</div><div class="title">Druh veřejné zakázky:</div><div class="value">Zakázka na služby</div><div class="title">Číslo zakázky:</div><div class="value">VZ697018</div>`;
  const row = parsePoptavejDetail(html, "https://example.test/verejna-zakazka/VZ697018/x");
  assert.equal(row.sourceId, "VZ697018");
  assert.match(row.deadline, /^2026-08-14/);
  assert.equal(row.deadlineTimeKnown, false);
});

test("český termín se správně převede v letním i zimním čase", () => {
  assert.equal(czechDate("15. 8. 2026 12:00"), "2026-08-15T10:00:00.000Z");
  assert.equal(czechDate("31. 10. 2026 12:00"), "2026-10-31T11:00:00.000Z");
  assert.equal(czechDate("31. 10. 2026"), "2026-10-31T11:00:00.000Z");
  assert.equal(czechDate("3. 11. 2026", true), "2026-11-03T22:59:00.000Z");
  assert.equal(czechDate("32. 10. 2026"), null);
});

test("číselné HTML entity v původním zadání zachovají český text", () => {
  assert.equal(plainText("Zaji&#353;t&#283;n&#237; slu&#382;eb"), "Zajištění služeb");
});

test("TED vrátí profil zadavatele a přesný čas lhůty", () => {
  const tender = parseTedNotice({
    "publication-number": "706257-2026", "notice-title": { ces: "Marketingová strategie" },
    "buyer-name": { ces: "Oborová zdravotní pojišťovna" },
    "deadline-receipt-tender-date-lot": ["2026-11-02"],
    "deadline-receipt-tender-time-lot": ["10:00:00+01:00"],
    "document-url-lot": ["https://www.e-zakazky.cz/profil-zadavatele/01d47fe3-916b-4869-bc75-c097dc0eefe1"],
  });
  assert.equal(tender.deadline, "2026-11-02T10:00:00+01:00");
  assert.equal(tender.deadlineTimeKnown, true);
  assert.equal(tender.candidateProfileUrls.length, 1);
});

test("profil E-ZAKAZKY poskytne detail a přílohy přímo od zadavatele", async () => {
  const profile = "https://www.e-zakazky.cz/profil-zadavatele/01d47fe3-916b-4869-bc75-c097dc0eefe1";
  const detailUrl = `${profile}/zakazka/P26V00000072`;
  const detailHtml = `<h1>Detail zakázky <span>Oborová zdravotní pojišťovna</span></h1>
    <tr class="hlavicka"><th>Marketingová strategie</th></tr>
    <tr><th>Identifikátor:</th><td>P26V00000072</td></tr>
    <tr><th>Datum uveřejnění na profilu:</th><td>10. 10. 2026</td></tr>
    <tr><th>Konec lhůty pro podání nabídek:</th><td>2. 11. 2026 10:00</td></tr>
    <tr><th>Hlavní CPV kód:</th><td>79340000-9</td></tr>
    <tr><th>Status:</th><td>Neukončena</td></tr>
    <script>{"loadParams":{"zakazkaId":66285}}</script>`;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target === profile) return new Response('<script>{"loadParams":{"zadavatelId":861,"statusId":1}}</script>');
    if (target.includes("GetZakazkyZadavatel")) return Response.json({ data: [
      { Nazev: "Marketingová strategie", ZakazkaIdentifikator: "P26V00000072" },
    ] });
    if (target === detailUrl) return new Response(detailHtml);
    if (target.includes("GetDokumenty")) return Response.json({ data: [
      { NazevDokumentu: "Zadávací dokumentace.pdf", TypDokumentu: "Zadání", GuidSouboru: "file-1" },
    ] });
    throw new Error(`Nečekaná adresa ${target}`);
  };
  const [row] = await searchEzakazkyProfile(profile, "Marketingová strategie", { fetchImpl });
  assert.deepEqual(row, parseEzakazkyDetail(detailHtml, detailUrl));
  assert.equal(row.deadline, "2026-11-02T09:00:00.000Z");
  assert.equal(row.status, "open");
  const documents = await fetchEzakazkyDocuments(detailUrl, { fetchImpl });
  assert.deepEqual(documents.documents, [{
    name: "Zadávací dokumentace.pdf", type: "Zadání",
    url: "https://www.e-zakazky.cz/stazenisouboru/file-1",
  }]);
});

test("dočasný výpadek zdroje se jednou zopakuje", async () => {
  let calls = 0;
  const text = await getText("https://example.test/", {
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response("Chyba", { status: 503 }) : new Response("Zakázky");
    },
  });
  assert.equal(text, "Zakázky");
  assert.equal(calls, 2);
});

test("neexistující stránka se zbytečně neopakuje", async () => {
  let calls = 0;
  await assert.rejects(() => getText("https://example.test/", {
    retryDelayMs: 0,
    fetchImpl: async () => { calls += 1; return new Response("Nenalezeno", { status: 404 }); },
  }), /HTTP 404/);
  assert.equal(calls, 1);
});

test("nefunkční detaily agregátorů jsou označené jako chyba zdroje", async () => {
  await assert.rejects(() => fetchPoptavej({ limit: 1, fetchImpl: async (url) => new Response(
    String(url).includes("reklama-a-tisk")
      ? '<a href="/verejna-zakazka/VZ123/test">Zakázka</a>'
      : "Nenalezeno",
    { status: String(url).includes("reklama-a-tisk") ? 200 : 404 },
  ) }), /žádný detail/);
  await assert.rejects(() => fetchPoptavky({ limit: 1, fetchImpl: async (url) => new Response(
    String(url).endsWith("reklama-tisk")
      ? '<a href="https://www.poptavky.cz/poptavka/123">Zakázka</a>'
      : "Nenalezeno",
    { status: String(url).endsWith("reklama-tisk") ? 200 : 404 },
  ) }), /žádný detail/);
});

test("změněný formát oficiálních API se nepočítá jako prázdný úspěch", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ unexpected: [] }), {
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(() => fetchZakazkyGov({ fetchImpl }), /formát/);
  await assert.rejects(() => fetchTenderArena({ fetchImpl }), /formát/);
  await assert.rejects(() => fetchTed({ now: new Date("2026-10-17T10:00:00Z"), fetchImpl }), /formát/);
});

test("mediální RSS propustí aktivní tendr a vyřadí výsledek tendru", () => {
  const xml = `<rss><channel><item><title>Pivovary hledají eventovou agenturu</title><link>https://example.test/zubr</link><description>Výběrové řízení pro festivaly.</description><pubDate>Mon, 15 Jun 2026 08:00:00 +0200</pubDate></item><item><title>Firma vybrala agenturu</title><link>https://example.test/hotovo</link><description>Vítězem tendru je Studio.</description></item></channel></rss>`;
  const rows = parseMediaFeed(xml, "mediaguru");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opportunityType, "market-signal");
});

test("TenderArena převede veřejný seznam na přímé detaily", () => {
  const [row] = parseTenderArenaList({ polozky: [{
    id: 908464, systemoveCislo: "P26V00343460", nazev: "Komunikační kampaň",
    uredniNazevZadavatele: "Město Test", stav: "NEUKONCENA", lhutaProPodaniNabidek: 1788170400000,
  }] });
  assert.equal(row.source, "tenderarena");
  assert.equal(row.sourceId, "P26V00343460");
  assert.equal(row.url, "https://tenderarena.cz/dodavatel/zakazka/908464");
  assert.match(row.deadline, /^2026-/);
});

test("E-ZAK projde všechny stránky aktivních zakázek", () => {
  const html = `<a href="contract_display_46460.html">Marketing</a><div class="pager"><a href="?state=OFFERS&page=2">2</a><a href="?state=OFFERS&page=4">4</a></div>`;
  assert.deepEqual(parseEzakList(html), { paths: ["contract_display_46460.html"], pageCount: 4 });
});

test("E-ZAK načte zadavatele, hodnotu, termín a CPV", () => {
  const html = `Systémové číslo: <b>P26V00003164</b><br>Datum zahájení: <b>31.07.2026</b><br>Nabídku podat do: <b>21.08.2026 12:00</b><li>Název: <b>Reklamní a marketingové služby</b></li><li>Druh veřejné zakázky: <b>Služby</b></li><p>Stručný popis předmětu:<br>Správa sociálních sítí.</p><li>Předpokládaná hodnota: <b>2 000 000 Kč bez DPH</b></li><h4>Místo plnění</h4><ul><li>Jihomoravský kraj</li></ul><li>Úřední název: <b>Jihomoravské dětské léčebny</b></li><div id="body_subject_items"><td>79340000-9</td></div><h3>Dokumenty</h3><span>32581199-1</span>`;
  const row = parseEzakDetail(html, "https://zakazky.krajbezkorupce.cz/contract_display_46460.html", { source: "ezak-jmk", buyer: "JMK" });
  assert.equal(row.sourceId, "P26V00003164");
  assert.equal(row.buyer, "Jihomoravské dětské léčebny");
  assert.equal(row.value.amount, 2_000_000);
  assert.match(row.deadline, /^2026-08-21/);
  assert.deepEqual(row.cpv, ["79340000"]);
});

test("NEN rozdělí limit mezi všechny cílené dotazy", () => {
  const rows = selectNenSummaries([
    [{ kod: "A1" }, { kod: "A2" }, { kod: "A3" }],
    [{ kod: "B1" }, { kod: "A1" }, { kod: "B2" }],
    [{ kod: "C1" }],
  ], 5);
  assert.deepEqual(rows.map((row) => row.kod), ["A1", "B1", "C1", "A2", "B2"]);
});

test("NEN datum bez časového pásma je pražský čas", () => {
  const state = { detailObjectStore: { objects: { item: { object: {
    kod: "N006/26/V00032165", nazev: "EXPO 2027", podaniLhuta: "2026-11-06T10:00:00",
  } } } } };
  const html = `<meta name="initialReduxState" content="${encodeURIComponent(JSON.stringify(state))}">`;
  const row = parseNenDetail(html, "https://nen.nipez.cz/verejne-zakazky/detail-zakazky/N006-26-V00032165");
  assert.equal(row.deadline, "2026-11-06T09:00:00.000Z");
});

test("NEN seznam dokumentů vrací přímé soubory a druh dokumentu", () => {
  const html = `<tr><td data-title="Typ dokumentu">Zadávací dokumentace</td><td><a href="/file?id=4778453882">ZD EXPO 2027 AV.pdf</a></td></tr>`;
  assert.deepEqual(parseNenDocuments(html, "https://nen.nipez.cz/verejne-zakazky/detail-zakazky/N006-26-V00032165"), [{
    name: "ZD EXPO 2027 AV.pdf", type: "Zadávací dokumentace", url: "https://nen.nipez.cz/file?id=4778453882",
  }]);
});

test("výpadek jednoho vyhledávání NEN nezahodí ostatní výsledky", async () => {
  const list = { collectionStore: { collections: { "verejne-zakazky-seznam": {
    collection: [{ kod: "N006/26/V00012345", nazev: "Komunikační kampaň", zadavatelNazev: "Město Test" }],
  } } } };
  const detail = { detailObjectStore: { objects: { item: { object: {
    kod: "N006/26/V00012345", nazev: "Komunikační kampaň", zadavatelNazev: "Město Test",
    podaniLhuta: "2026-11-05T10:00:00Z",
  } } } } };
  const html = (state) => `<meta name="initialReduxState" content="${encodeURIComponent(JSON.stringify(state))}">`;
  const rows = await fetchNen({ fetchImpl: async (url) => {
    if (String(url).includes("komunika%C4%8Dn%C3%AD%20strategie")) throw new Error("timeout");
    return new Response(html(String(url).includes("detail-zakazky") ? detail : list));
  } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deadlineTimeKnown, true);
});

test("agregátor povýší jen konkrétní oficiální detail", () => {
  const html = `<a href="https://zakazky.gov.cz/">portál</a><a href="https://zakazky.gov.cz/verejne-zakazky/detail-zakazky/N006-26-V00012345">zdroj</a>`;
  assert.deepEqual(extractCandidateOriginUrls(html, "https://www.poptavky.cz/poptavka/1"), [
    "https://zakazky.gov.cz/verejne-zakazky/detail-zakazky/N006-26-V00012345",
  ]);
});

test("radarový tip se spojí s odpovídajícím oficiálním záznamem", () => {
  const official = {
    source: "tenderarena", sourceId: "P26V00343460", url: "https://tenderarena.cz/dodavatel/zakazka/1",
    title: "Tvorba komunikační strategie a marketingové kampaně", buyer: "Město Test", deadline: "2026-08-31T10:00:00Z",
  };
  const lead = {
    source: "poptavky", sourceId: "123", url: "https://www.poptavky.cz/poptavka/123",
    title: "Tvorba komunikační strategie a marketingové kampaně", buyer: "Zadavatel z Poptávky.cz", deadline: "2026-08-31T12:00:00+02:00",
    firstSeenAt: "2026-08-09T10:00:00Z",
  };
  const { rows } = resolveAggregatorLeads([lead], [official]);
  assert.equal(rows[0].source, "tenderarena");
  assert.equal(rows[0].discoverySource, "poptavky");
  assert.equal(rows[0].originStatus, "resolved");
  assert.equal(rows[0].firstSeenAt, lead.firstSeenAt);
});
