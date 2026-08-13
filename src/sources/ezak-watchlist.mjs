import { czechDate, getText, mapLimited, money, plainText } from "./html-utils.mjs";

export const PROFILES = [
  { source: "ezak-jmk", buyer: "Jihomoravský kraj a jeho organizace", base: "https://zakazky.krajbezkorupce.cz/" },
  { source: "ezak-sz", buyer: "Správa železnic, státní organizace", base: "https://zakazky.spravazeleznic.cz/" },
];

export function parseEzakDetail(html, url, profile) {
  const sourceId = html.match(/Systémové číslo:\s*<b>([^<]+)/i)?.[1]?.trim()
    || url.match(/contract_display_(\d+)/i)?.[1];
  const title = plainText(html.match(/<li>Název:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  if (!sourceId || !title) return null;
  const summary = plainText(html.match(/Stručný popis předmětu:<br\s*\/?>\s*([\s\S]*?)<\/p>/i)?.[1]);
  const deadline = plainText(html.match(/Nabídku podat do:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const published = plainText(html.match(/Datum zahájení:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const value = html.match(/Předpokládaná hodnota:[\s\S]{0,140}?<b>([\s\S]*?)<\/b>/i)?.[1];
  const kind = plainText(html.match(/Druh zakázky:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const region = plainText(html.match(/<h4>Místo plnění<\/h4>[\s\S]{0,240}?<li>([\s\S]*?)<\/li>/i)?.[1]);
  const buyer = plainText(html.match(/Úřední název:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  return {
    source: profile.source,
    sourceId,
    url,
    title,
    buyer: buyer || profile.buyer,
    summary,
    region: region || "Česko",
    publishedAt: czechDate(published),
    deadline: czechDate(deadline),
    value: money(value),
    procedureType: kind || "Veřejná zakázka",
    opportunityType: "public-tender",
    originStatus: "verified",
  };
}

export async function fetchEzakWatchlist({ fetchImpl = fetch, limit = Number(process.env.EZAK_DETAIL_LIMIT || 40) } = {}) {
  const settled = await Promise.allSettled(PROFILES.map(async (profile) => {
    const listUrl = new URL("contract_index.html?type=all&state=OFFERS", profile.base).href;
    const html = await getText(listUrl, { fetchImpl });
    const paths = [...new Set([...html.matchAll(/href=["']([^"']*contract_display_\d+\.html)/gi)].map((match) => match[1]))].slice(0, limit);
    return mapLimited(paths, async (path) => {
      const url = new URL(path, profile.base).href;
      return parseEzakDetail(await getText(url, { fetchImpl }), url, profile);
    });
  }));
  const rows = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!rows.length && settled.every((result) => result.status === "rejected")) {
    throw new Error(settled.map((result) => result.reason?.message).filter(Boolean).join("; "));
  }
  return rows;
}
