const NEN_BASE = "https://nen.nipez.cz";
const SEARCH_TERMS = [
  "komunikační strategie", "komunikační kampaň", "public relations", "marketingové služby",
  "propagace", "sociální sítě", "tvorba obsahu", "mediální", "reklamní kampaň",
  "event", "moderování", "mediální trénink", "AI školení",
];

function reduxState(html) {
  const doubleQuoted = html.match(/<meta name="initialReduxState" content="([^"]+)"/i);
  const singleQuoted = html.match(/<meta name='initialReduxState' content='([^']+)'/i);
  const content = doubleQuoted?.[1] || singleQuoted?.[1];
  if (!content) throw new Error("NEN stránka neobsahuje očekávaná data.");
  return JSON.parse(decodeURIComponent(content));
}

async function getHtml(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html", "user-agent": "4ALL-vyberka/1.0 (hello@4all.cz)" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`NEN odpověděl ${response.status}.`);
  return response.text();
}

function detailUrl(code) {
  return `${NEN_BASE}/verejne-zakazky/detail-zakazky/${code.replaceAll("/", "-")}`;
}

function currency(value) {
  const text = String(value || "").toLocaleLowerCase("cs");
  if (text.includes("koruna") || text.includes("czk")) return "CZK";
  if (text.includes("euro") || text.includes("eur")) return "EUR";
  return "CZK";
}

export async function fetchNen({ fetchImpl = fetch } = {}) {
  const summaries = new Map();
  for (const term of SEARCH_TERMS) {
    const route = encodeURIComponent(`p:vz:stavZP=neukoncena&query=${term}`);
    const state = reduxState(await getHtml(`${NEN_BASE}/verejne-zakazky/${route}`, fetchImpl));
    const collection = state.collectionStore?.collections?.["verejne-zakazky-seznam"]?.collection || [];
    for (const row of collection) summaries.set(row.kod, row);
  }

  const rows = [...summaries.values()].slice(0, Number(process.env.NEN_DETAIL_LIMIT || 60));
  const results = [];
  for (let index = 0; index < rows.length; index += 6) {
    const batch = rows.slice(index, index + 6);
    const details = await Promise.allSettled(batch.map(async (row) => {
      const url = detailUrl(row.kod);
      const state = reduxState(await getHtml(url, fetchImpl));
      const container = Object.values(state.detailObjectStore?.objects || {})[0];
      const item = container?.object;
      if (!item) throw new Error(`NEN detail ${row.kod} je prázdný.`);
      return {
        source: "nen",
        sourceId: item.kod || row.kod,
        url,
        title: item.nazev || row.nazev,
        buyer: item.zadavatelNazev || row.zadavatelNazev,
        summary: item.popisPredmet || "",
        country: "CZ",
        region: item.hlavniMistoNUTS || "Česko",
        publishedAt: item.datumProfil || null,
        deadline: item.podaniLhuta || row.podaniLhuta || null,
        value: item.predpokladHodnota
          ? { amount: Number(item.predpokladHodnota), currency: currency(item.predpokladMenaNazev) }
          : null,
        cpv: [item.cpvPredmetuKod || item.nipezPredmetuKod].filter(Boolean),
        procedureType: [item.druhVZ, item.druhZRNazev].filter(Boolean).join(" / "),
        status: item.stavZP === "neukoncena" ? "open" : "unknown",
      };
    }));
    for (const detail of details) if (detail.status === "fulfilled") results.push(detail.value);
  }
  return results;
}
