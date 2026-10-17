import { searchable } from "../model.mjs";
import { czechDate, getText, money, plainText } from "./html-utils.mjs";

const BASE = "https://www.e-zakazky.cz";

function profileParts(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.e-zakazky.cz") return null;
  const match = url.pathname.match(/^\/profil-zadavatele\/([0-9a-f-]{36})/i);
  return match ? { guid: match[1], url: `${BASE}/profil-zadavatele/${match[1]}` } : null;
}

async function apiRows(path, params, fetchImpl) {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const payload = JSON.parse(await getText(url.href, { fetchImpl }));
  if (!Array.isArray(payload?.data)) throw new Error("E-ZAKAZKY změnily formát veřejného seznamu.");
  return payload.data;
}

export function parseEzakazkyDetail(html, url) {
  const title = plainText(html.match(/<tr class=["']hlavicka["'][^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>/i)?.[1]);
  const buyer = plainText(html.match(/<h1>Detail zak[\s\S]*?<span>([\s\S]*?)<\/span>/i)?.[1]);
  const fields = new Map();
  for (const [, row] of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((match) => ({ kind: match[1].toLowerCase(), text: plainText(match[2]) }));
    for (let index = 0; index + 1 < cells.length; index += 2) {
      if (cells[index].kind === "th" && cells[index + 1].kind === "td") {
        fields.set(cells[index].text.replace(/:$/, ""), cells[index + 1].text);
      }
    }
  }
  const sourceId = fields.get("Identifikátor");
  if (!title || !buyer || !sourceId) return null;
  return {
    source: "official-profile",
    sourceId,
    url,
    title,
    buyer,
    summary: "",
    region: "Česko",
    publishedAt: czechDate(fields.get("Datum uveřejnění na profilu")),
    deadline: czechDate(fields.get("Konec lhůty pro podání nabídek")),
    deadlineTimeKnown: /\b\d{1,2}:\d{2}\b/.test(fields.get("Konec lhůty pro podání nabídek") || ""),
    value: money(fields.get("Předpokládaná hodnota VZ")),
    cpv: [fields.get("Hlavní CPV kód")?.match(/\b\d{8}\b/)?.[0]].filter(Boolean),
    procedureType: fields.get("Druh řízení") || "Veřejná zakázka",
    status: /neukončena/i.test(fields.get("Status") || "") ? "open"
      : /zadána|zrušena|ukončeno/i.test(fields.get("Status") || "") ? "closed" : "unknown",
    originStatus: "verified",
  };
}

export async function fetchEzakazkyDetail(url, { fetchImpl = fetch } = {}) {
  if (!profileParts(url) || !/\/zakazka\/P\d{2}V\d{8}$/i.test(new URL(url).pathname)) return null;
  return parseEzakazkyDetail(await getText(url, { fetchImpl }), url);
}

export async function searchEzakazkyProfile(profileUrl, title, { fetchImpl = fetch } = {}) {
  const profile = profileParts(profileUrl);
  if (!profile) return [];
  const html = await getText(profile.url, { fetchImpl });
  const buyerId = html.match(/"loadParams":\{"zadavatelId":(\d+),"statusId":1\}/)?.[1];
  if (!buyerId) throw new Error("E-ZAKAZKY změnily formát profilu zadavatele.");
  const matches = [];
  for (let skip = 0; skip < 500; skip += 100) {
    const rows = await apiRows("/api/ZakazkyApi/GetZakazkyZadavatel", {
      zadavatelId: buyerId, statusId: 1, skip, take: 100,
    }, fetchImpl);
    matches.push(...rows.filter((row) => searchable(row.Nazev) === searchable(title)));
    if (matches.length || rows.length < 100) break;
  }
  const details = await Promise.all(matches.slice(0, 3).map((row) => fetchEzakazkyDetail(
    `${profile.url}/zakazka/${row.ZakazkaIdentifikator}`, { fetchImpl },
  )));
  return details.filter(Boolean);
}

export async function fetchEzakazkyDocuments(detailUrl, { fetchImpl = fetch } = {}) {
  if (!profileParts(detailUrl)) throw new Error("Neplatný profil E-ZAKAZKY.");
  const html = await getText(detailUrl, { fetchImpl });
  const contractId = html.match(/"loadParams":\{"zakazkaId":(\d+)\}/)?.[1];
  if (!contractId) throw new Error("E-ZAKAZKY neobsahují seznam dokumentů.");
  const rows = await apiRows("/api/ZakazkyApi/GetDokumenty", {
    zakazkaId: contractId, skip: 0, take: 100,
  }, fetchImpl);
  return {
    url: detailUrl,
    documents: rows.filter((row) => !row.Smazan && row.GuidSouboru).map((row) => ({
      name: row.NazevDokumentu,
      type: row.TypDokumentu || "Dokument",
      url: `${BASE}/stazenisouboru/${row.GuidSouboru}`,
    })),
  };
}
