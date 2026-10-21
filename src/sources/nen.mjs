import { czechDate, plainText } from "./html-utils.mjs";

const NEN_BASE = "https://nen.nipez.cz";
const SEARCH_TERMS = [
  "komunikační strategie", "komunikační kampaň", "public relations", "PR služby",
  "marketingové služby", "propagace", "sociální sítě", "tvorba obsahu",
  "mediální", "reklamní kampaň", "event", "produkční", "mediální trénink",
  "zajištění akcí", "organizace akcí", "organizace konferencí", "pořádání akcí",
  "video", "natáčení", "audiovizuální", "podcast", "fotografické", "focení", "grafické práce",
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

function nenDateTime(value) {
  if (!value) return null;
  const text = String(value);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? czechDate(`${match[3]}. ${match[2]}. ${match[1]} ${match[4]}:${match[5]}`) : text;
}

function firstParticipationDeadline(item, summary) {
  // NEN keeps the procedure "unfinished" after entry has closed. Later
  // preliminary bids can be submitted only by admitted participants.
  const entryFields = ["podaniPredZajemLhuta", "podaniZadostLhuta", "podaniPredNabLhuta", "podaniLhuta", "podaniNavrhLhuta"];
  const entry = entryFields.map((field) => item[field]).filter(Boolean);
  const candidates = entry.length ? entry : [summary.podaniLhuta].filter(Boolean);
  return candidates.map(nenDateTime).filter((value) => value && Number.isFinite(new Date(value).valueOf()))
    .sort((left, right) => new Date(left) - new Date(right))[0] || null;
}

export function parseNenDetail(html, url, summary = {}) {
  const state = reduxState(html);
  const container = Object.values(state.detailObjectStore?.objects || {})[0];
  const item = container?.object;
  if (!item?.kod || !item?.nazev) return null;
  const deadline = firstParticipationDeadline(item, summary);
  return {
    source: "nen",
    sourceId: item.kod,
    url,
    title: item.nazev,
    buyer: item.zadavatelNazev || summary.zadavatelNazev,
    summary: item.popisPredmet || "",
    country: "CZ",
    region: item.hlavniMistoNUTS || "Česko",
    publishedAt: nenDateTime(item.datumProfil),
    deadline,
    deadlineTimeKnown: Boolean(deadline && /T\d{2}:\d{2}/.test(deadline)),
    value: item.predpokladHodnota
      ? { amount: Number(item.predpokladHodnota), currency: currency(item.predpokladMenaNazev) }
      : null,
    cpv: [item.cpvPredmetuKod || item.nipezPredmetuKod].filter(Boolean),
    procedureType: [item.druhVZ, item.druhZRNazev].filter(Boolean).join(" / "),
    status: item.stavZP === "neukoncena" ? "open" : "unknown",
    originStatus: "verified",
  };
}

export async function fetchNenDetail(url, { fetchImpl = fetch } = {}) {
  return parseNenDetail(await getHtml(url, fetchImpl), url);
}

export function parseNenDocuments(html, detailUrlValue) {
  const documents = [];
  for (const [, row] of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = row.match(/<a\b[^>]*href=["']([^"']*\/file\?id=\d+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const type = plainText(row.match(/data-title=["']Typ dokumentu["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]);
    documents.push({
      name: plainText(link[2]),
      type: type || "Dokument",
      url: new URL(link[1], detailUrlValue).href,
    });
  }
  return documents;
}

export async function fetchNenDocuments(detailUrlValue, { fetchImpl = fetch } = {}) {
  const url = `${detailUrlValue.replace(/\/$/, "")}/zadavaci-dokumentace`;
  return { url, documents: parseNenDocuments(await getHtml(url, fetchImpl), detailUrlValue) };
}

export async function searchNenForOrigin(title, { fetchImpl = fetch, limit = 5 } = {}) {
  const route = encodeURIComponent(`p:vz:stavZP=neukoncena&query=${title}`);
  const state = reduxState(await getHtml(`${NEN_BASE}/verejne-zakazky/${route}`, fetchImpl));
  const collection = state.collectionStore?.collections?.["verejne-zakazky-seznam"]?.collection;
  if (!Array.isArray(collection)) throw new Error("NEN změnil formát vyhledávání.");
  const results = [];
  for (const row of collection.slice(0, limit)) {
    try {
      const url = detailUrl(row.kod);
      const detail = parseNenDetail(await getHtml(url, fetchImpl), url, row);
      if (detail) results.push(detail);
    } catch { /* další kandidát může být dostupný */ }
  }
  return results;
}

export function selectNenSummaries(buckets, limit) {
  const selected = [];
  const seen = new Set();
  const maximum = Math.max(0, Number(limit) || 0);
  const positions = buckets.map(() => 0);

  // Projdeme první výsledek každého dotazu, potom druhý atd. Jeden široký
  // dotaz tak nemůže spotřebovat celý limit dřív, než se dostane na ostatní.
  let addedInRound = true;
  while (addedInRound && selected.length < maximum) {
    addedInRound = false;
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
      const bucket = buckets[bucketIndex];
      let row;
      while (positions[bucketIndex] < bucket.length) {
        row = bucket[positions[bucketIndex]];
        positions[bucketIndex] += 1;
        if (row?.kod && !seen.has(row.kod)) break;
        row = undefined;
      }
      if (!row) continue;
      selected.push(row);
      seen.add(row.kod);
      addedInRound = true;
      if (selected.length >= maximum) break;
    }
  }

  return selected;
}

export async function fetchNen({ fetchImpl = fetch } = {}) {
  const buckets = [];
  let successfulSearches = 0;
  for (const term of SEARCH_TERMS) {
    try {
      const route = encodeURIComponent(`p:vz:stavZP=neukoncena&query=${term}`);
      const state = reduxState(await getHtml(`${NEN_BASE}/verejne-zakazky/${route}`, fetchImpl));
      const collection = state.collectionStore?.collections?.["verejne-zakazky-seznam"]?.collection;
      if (!Array.isArray(collection)) throw new Error("NEN změnil formát vyhledávání.");
      buckets.push(collection);
      successfulSearches += 1;
    } catch (error) {
      console.warn(`NEN: dotaz „${term}“ selhal: ${error.message}`);
    }
  }
  if (!successfulSearches) throw new Error("NEN: selhaly všechny vyhledávací dotazy.");

  const rows = selectNenSummaries(buckets, Number(process.env.NEN_DETAIL_LIMIT || 80));
  const results = [];
  for (let index = 0; index < rows.length; index += 6) {
    const batch = rows.slice(index, index + 6);
    const details = await Promise.allSettled(batch.map(async (row) => {
      const url = detailUrl(row.kod);
      const detail = parseNenDetail(await getHtml(url, fetchImpl), url, row);
      if (!detail) throw new Error(`NEN detail ${row.kod} je prázdný.`);
      return detail;
    }));
    for (const detail of details) if (detail.status === "fulfilled") results.push(detail.value);
  }
  if (rows.length && !results.length) throw new Error("NEN: nepodařilo se načíst žádný detail zakázky.");
  return results;
}
