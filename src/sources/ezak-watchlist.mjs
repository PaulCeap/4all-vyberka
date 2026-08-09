import { czechDate, getText, mapLimited, money, plainText } from "./html-utils.mjs";

const PROFILES = [
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
  return {
    source: profile.source,
    sourceId,
    url,
    title,
    buyer: profile.buyer,
    summary,
    region: region || "Česko",
    publishedAt: czechDate(published),
    deadline: czechDate(deadline),
    value: money(value),
    procedureType: kind || "Veřejná zakázka",
    opportunityType: "public-tender",
  };
}

export async function fetchEzakWatchlist({ fetchImpl = fetch, limit = Number(process.env.EZAK_DETAIL_LIMIT || 40) } = {}) {
  const rows = [];
  for (const profile of PROFILES) {
    const listUrl = new URL("contract_index.html?type=all&state=OFFERS", profile.base).href;
    const html = await getText(listUrl, { fetchImpl });
    const paths = [...new Set([...html.matchAll(/href=["']([^"']*contract_display_\d+\.html)/gi)].map((match) => match[1]))].slice(0, limit);
    rows.push(...await mapLimited(paths, async (path) => {
      const url = new URL(path, profile.base).href;
      return parseEzakDetail(await getText(url, { fetchImpl }), url, profile);
    }));
  }
  return rows;
}
