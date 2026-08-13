import { czechDate, getText, mapLimited, money, plainText } from "./html-utils.mjs";
import { extractCandidateOriginUrls } from "../origin-resolver.mjs";

const CATEGORY_URL = "https://www.poptavky.cz/poptavky/reklama-tisk";

export function parsePoptavkyDetail(html, url) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let demand;
  for (const [, body] of scripts) {
    try {
      const parsed = JSON.parse(body.trim());
      if (parsed?.["@type"] === "Demand") demand = parsed;
    } catch { /* neplatný pomocný JSON-LD přeskočíme */ }
  }
  if (!demand?.identifier || !demand?.name) return null;
  const description = plainText(demand.description);
  const publishedBlock = html.match(/Datum publikace:\s*(?:<[^>]+>)*\s*([\d.\s:]+)/i)?.[1];
  const priceBlock = html.match(/Odhad ceny:[\s\S]{0,100}?<strong>([\s\S]*?)<\/strong>/i)?.[1];
  const deadlineBlock = description.match(/Termín pro podání nabídek:\s*-?\s*([\d.\s:]+)/i)?.[1];
  const location = description.match(/Lokalita:\s*-?\s*([^\n]+?)(?=\s+Termín|$)/i)?.[1];
  return {
    source: "poptavky",
    sourceId: String(demand.identifier),
    url: demand.mainEntityOfPage?.url || url,
    title: demand.name,
    buyer: "Zadavatel z Poptávky.cz",
    summary: description,
    region: plainText(location || "Česko"),
    publishedAt: czechDate(publishedBlock),
    deadline: czechDate(deadlineBlock),
    value: money(priceBlock),
    procedureType: /veřejn[éá] zakáz/i.test(description) ? "Veřejná zakázka na služby" : "Komerční poptávka",
    opportunityType: /veřejn[éá] zakáz/i.test(description) ? "public-tender" : "commercial-demand",
    candidateOriginUrls: extractCandidateOriginUrls(html, url),
    originStatus: "unresolved",
  };
}

export async function fetchPoptavky({ fetchImpl = fetch, limit = Number(process.env.POPTAVKY_DETAIL_LIMIT || 30) } = {}) {
  const html = await getText(CATEGORY_URL, { fetchImpl });
  const urls = [...new Set([...html.matchAll(/href=["'](https:\/\/www\.poptavky\.cz\/poptavka\/[^"'#?]+)/gi)].map((match) => match[1]))].slice(0, limit);
  return mapLimited(urls, async (url) => parsePoptavkyDetail(await getText(url, { fetchImpl }), url));
}
