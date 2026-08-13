import test from "node:test";
import assert from "node:assert/strict";
import { parsePoptavkyDetail } from "../src/sources/poptavky.mjs";
import { parsePoptavejDetail } from "../src/sources/poptavej.mjs";
import { parseMediaFeed } from "../src/sources/media-signals.mjs";
import { parseTenderArenaList } from "../src/sources/tenderarena.mjs";
import { parseEzakDetail, parseEzakList } from "../src/sources/ezak-watchlist.mjs";
import { extractCandidateOriginUrls, resolveAggregatorLeads } from "../src/origin-resolver.mjs";
import { selectNenSummaries } from "../src/sources/nen.mjs";

test("Poptávky.cz přečte JSON-LD, cenu a deadline", () => {
  const demand = { "@type": "Demand", identifier: "2050851", name: "Reklamní a marketingové služby", description: "Lokalita:\n- Křetín\nTermín pro podání nabídek:\n- 15. 08. 2026 12:00", mainEntityOfPage: { url: "https://example.test/1" } };
  const html = `<script type="application/ld+json">${JSON.stringify(demand)}</script><li>Datum publikace: <strong>7. 8. 2026 08:44</strong></li><li>Odhad ceny: <strong>3 000 000 Kč</strong></li>`;
  const row = parsePoptavkyDetail(html, "https://example.test/1");
  assert.equal(row.sourceId, "2050851");
  assert.equal(row.value.amount, 3_000_000);
  assert.match(row.deadline, /^2026-08-15/);
});

test("Poptávej.cz přečte veřejnou zakázku", () => {
  const html = `<h1>Marketingová strategie</h1><p class="popis">Předmět: marketingové služby Lokalita: Praha Termín: do října</p><div class="title">Datum vyhlášení zadavatelem:</div><div class="value">7.8.2026</div><div class="title">Datum pro podání nabídky:</div><div class="value"><b>14.8.2026</b></div><div class="title">Předpokládaná hodnota:</div><div class="value cena">1 700 000 Kč</div><div class="title">Druh veřejné zakázky:</div><div class="value">Zakázka na služby</div><div class="title">Číslo zakázky:</div><div class="value">VZ697018</div>`;
  const row = parsePoptavejDetail(html, "https://example.test/verejna-zakazka/VZ697018/x");
  assert.equal(row.sourceId, "VZ697018");
  assert.match(row.deadline, /^2026-08-14/);
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
  };
  const { rows } = resolveAggregatorLeads([lead], [official]);
  assert.equal(rows[0].source, "tenderarena");
  assert.equal(rows[0].discoverySource, "poptavky");
  assert.equal(rows[0].originStatus, "resolved");
});
