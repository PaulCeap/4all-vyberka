import { czechDate, getText, mapLimited, money, plainText } from "./html-utils.mjs";

const CATEGORY_URL = "https://www.poptavej.cz/verejne-zakazky/reklama-a-tisk";

function field(html, label) {
  return plainText(html.match(new RegExp(`${label}:[\\s\\S]{0,180}?<div class=["']value[^"']*["']>([\\s\\S]*?)<\\/div>`, "i"))?.[1]);
}

export function parsePoptavejDetail(html, url) {
  const title = plainText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const summary = plainText(html.match(/<p class=["']popis["']>([\s\S]*?)<\/p>/i)?.[1]);
  const sourceId = html.match(/Číslo zakázky:[\s\S]{0,160}?<div class=["']value["']>\s*([^<]+)/i)?.[1]?.trim()
    || url.match(/\/(VZ\d+)\//i)?.[1];
  if (!title || !sourceId) return null;
  const deadline = field(html, "Datum pro podání nabídky");
  const published = field(html, "Datum vyhlášení zadavatelem");
  const expectedValue = field(html, "Předpokládaná hodnota");
  const location = summary.match(/Lokalita:\s*-?\s*(.+?)(?=\s+Termín|$)/i)?.[1];
  return {
    source: "poptavej",
    sourceId,
    url,
    title,
    buyer: "Zadavatel z Poptávej.cz",
    summary,
    region: plainText(location || "Česko"),
    publishedAt: czechDate(published),
    deadline: czechDate(deadline),
    value: money(expectedValue),
    procedureType: field(html, "Druh veřejné zakázky") || "Veřejná zakázka",
    opportunityType: "public-tender",
  };
}

export async function fetchPoptavej({ fetchImpl = fetch, limit = Number(process.env.POPTAVEJ_DETAIL_LIMIT || 30) } = {}) {
  const html = await getText(CATEGORY_URL, { fetchImpl });
  const paths = [...new Set([...html.matchAll(/href=["'](\/verejna-zakazka\/[^"'#?]+)/gi)].map((match) => match[1]))].slice(0, limit);
  return mapLimited(paths, async (path) => {
    const url = new URL(path, CATEGORY_URL).href;
    return parsePoptavejDetail(await getText(url, { fetchImpl }), url);
  });
}
