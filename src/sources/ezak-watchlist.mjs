import { czechDate, getText, mapLimited, money, plainText } from "./html-utils.mjs";

export const PROFILES = [
  { source: "ezak-jmk", buyer: "Jihomoravský kraj a jeho organizace", base: "https://zakazky.krajbezkorupce.cz/" },
  { source: "ezak-sz", buyer: "Správa železnic, státní organizace", base: "https://zakazky.spravazeleznic.cz/" },
];

export function parseEzakList(html) {
  const paths = [...new Set(
    [...String(html).matchAll(/href=["']([^"']*contract_display_\d+\.html)/gi)].map((match) => match[1]),
  )];
  const pages = [...String(html).matchAll(/[?&]page=(\d+)/gi)].map((match) => Number(match[1]));
  return { paths, pageCount: Math.max(1, ...pages) };
}

export function parseEzakDetail(html, url, profile) {
  const sourceId = html.match(/Systémové číslo:\s*<b>([^<]+)/i)?.[1]?.trim()
    || url.match(/contract_display_(\d+)/i)?.[1];
  const title = plainText(html.match(/<li>Název:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  if (!sourceId || !title) return null;
  const summary = plainText(html.match(/Stručný popis předmětu:<br\s*\/?>\s*([\s\S]*?)<\/p>/i)?.[1]);
  const deadline = plainText(html.match(/Nabídku podat do:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const published = plainText(html.match(/Datum zahájení:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const value = html.match(/Předpokládaná hodnota:[\s\S]{0,140}?<b>([\s\S]*?)<\/b>/i)?.[1];
  const kind = plainText(html.match(/Druh(?: veřejné)? zakázky:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const region = plainText(html.match(/<h4>Místo plnění<\/h4>[\s\S]{0,240}?<li>([\s\S]*?)<\/li>/i)?.[1]);
  const buyer = plainText(html.match(/Úřední název:\s*<b>([\s\S]*?)<\/b>/i)?.[1]);
  const subjectItems = String(html).match(/id=["']body_subject_items["'][^>]*>([\s\S]*?)(?:<h3\b|$)/i)?.[1] || "";
  const cpv = [...new Set([...subjectItems.matchAll(/\b(\d{8})-\d\b/g)].map((match) => match[1]))];
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
    cpv,
    procedureType: kind || "Veřejná zakázka",
    opportunityType: "public-tender",
    originStatus: "verified",
  };
}

export async function fetchEzakWatchlist({
  fetchImpl = fetch,
  limit = Number(process.env.EZAK_DETAIL_LIMIT || 80),
  pageLimit = Number(process.env.EZAK_PAGE_LIMIT || 10),
} = {}) {
  const settled = await Promise.allSettled(PROFILES.map(async (profile) => {
    const listUrl = new URL("contract_index.html?type=all&state=OFFERS", profile.base).href;
    const firstHtml = await getText(listUrl, { fetchImpl });
    const first = parseEzakList(firstHtml);
    const remainingPages = Array.from(
      { length: Math.max(0, Math.min(first.pageCount, pageLimit) - 1) },
      (_, index) => index + 2,
    );
    const pageRows = await mapLimited(remainingPages, async (page) => {
      const pageUrl = new URL(listUrl);
      pageUrl.searchParams.set("page", String(page));
      return parseEzakList(await getText(pageUrl.href, { fetchImpl })).paths;
    });
    const paths = [...new Set([...first.paths, ...pageRows.flat()])].slice(0, limit);
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
