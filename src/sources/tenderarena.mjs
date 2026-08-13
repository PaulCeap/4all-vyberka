const LIST_URL = "https://api.tenderarena.cz/ta/profil/seznam-zakazek/noveUverejneneZakazky";

function epochOrNull(value) {
  if (!value) return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function parseTenderArenaList(payload) {
  return (payload?.polozky || []).map((row) => ({
    source: "tenderarena",
    sourceId: row.systemoveCislo || String(row.id),
    url: `https://tenderarena.cz/dodavatel/zakazka/${encodeURIComponent(row.id)}`,
    title: row.nazev,
    buyer: row.uredniNazevZadavatele || "Neuvedený zadavatel",
    summary: "",
    country: "CZ",
    region: "Česko",
    publishedAt: null,
    deadline: epochOrNull(row.lhutaProPodaniNabidek || row.lhutaProDoruceniZadostiOUcast),
    procedureType: "Veřejná zakázka v TenderArena",
    opportunityType: "public-tender",
    status: row.stav === "NEUKONCENA" ? "open" : "unknown",
    cpv: [],
    originStatus: "verified",
  })).filter((row) => row.sourceId && row.title);
}

export async function fetchTenderArena({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(LIST_URL, {
    headers: { accept: "application/json", "user-agent": "4ALL-vyberka/1.0 (hello@4all.cz)" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`TenderArena odpověděla ${response.status}.`);
  return parseTenderArenaList(await response.json());
}
