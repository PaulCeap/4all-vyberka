import { NATIONAL_SEARCH_URL } from "../config.mjs";

export async function fetchZakazkyGov({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(NATIONAL_SEARCH_URL, {
    headers: { accept: "application/json", "user-agent": "4ALL-vyberka/1.0 (hello@4all.cz)" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Zakázky GOV odpověděly ${response.status}.`);
  const payload = await response.json();
  const rows = payload.zakazky_za_24_h || [];
  return rows.map((row) => ({
    source: "zakazky-gov",
    sourceId: row.identifikator_NIPEZ,
    url: `https://zakazky.gov.cz/verejne-zakazky/detail-zakazky/${encodeURIComponent(row.identifikator_NIPEZ)}`,
    title: row.nazev_verejne_zakazky,
    buyer: row.nazev_zadavatele,
    summary: row.popis_predmetu,
    country: "CZ",
    region: "Česko",
    publishedAt: row.datum_uverejneni_na_zakazky_gov,
    deadline: row.lhuta_pro_podani,
    procedureType: row.typ_zadavaciho_postupu?.replaceAll("_", " ") || "Veřejná zakázka",
    status: row.stav?.includes("AKTIVNI") ? "open" : "unknown",
    cpv: [],
    originStatus: "verified",
  }));
}
