import { getText, plainText } from "./html-utils.mjs";
import { searchable } from "../model.mjs";

const FEEDS = [
  { source: "mediaguru", url: "https://www.mediaguru.cz/rss/nejnovejsi" },
  { source: "mediaguru", url: "https://www.mediaguru.cz/rss/marketing" },
  { source: "mediaguru", url: "https://www.mediaguru.cz/rss/reklama" },
  { source: "mediaguru", url: "https://www.mediaguru.cz/rss/pr" },
  { source: "mediar", url: "https://www.mediar.cz/feed/" },
  { source: "mam", url: "https://www.mam.cz/feed/" },
];
const ACTIVE = [
  /\b(?:hleda|hledaji|poptava|poptavaji|vybira|vybiraji|shani)\b.{0,60}\b(?:agenturu|partnera|dodavatele|produkci|produkcni spolecnost|studio)\b/,
  /\b(?:vypsal|vypsala|vyhlasuje|vyhlasila|vypisuje|otevrel|otevrela)\b.{0,35}\b(?:tendr|vyberove rizeni)\b/,
  /\b(?:vyberove rizeni|tendr na)\b/,
];
const CLOSED = [
  /\b(?:vybral|vybrala|zvolil|zvolila)\b.{0,35}\b(?:agenturu|partnera|dodavatele)\b/,
  /\b(?:ziskal|ziskala|vyhral|vyhrala)\b.{0,35}\b(?:tendr|vyberove rizeni)\b/,
  /\b(?:vitezem|vitez|vitezkou)\b.{0,25}\b(?:tendru|vyberoveho rizeni)\b/,
  /\b(?:ukoncil|ukoncila)\b.{0,25}\b(?:tendr|vyberove rizeni)\b/,
  /\bsveruje agenture\b/,
];

function tag(item, name) {
  return plainText(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]);
}

export function parseMediaFeed(xml, source) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([, item], index) => {
    const title = tag(item, "title");
    const summary = tag(item, "description");
    const text = searchable(`${title} ${summary}`);
    if (!ACTIVE.some((pattern) => pattern.test(text)) || CLOSED.some((pattern) => pattern.test(text))) return [];
    const url = tag(item, "link");
    return [{
      source,
      sourceId: url || `${source}-${index}-${title}`,
      url,
      title,
      buyer: "Komerční zadavatel",
      summary,
      publishedAt: tag(item, "pubDate"),
      deadline: null,
      procedureType: "Komerční výběrové řízení — mediální signál",
      opportunityType: "market-signal",
      status: "signal",
      originStatus: "media-report",
    }];
  });
}

export async function fetchMediaSignals({ fetchImpl = fetch } = {}) {
  const settled = await Promise.allSettled(FEEDS.map(async (feed) => parseMediaFeed(await getText(feed.url, { fetchImpl }), feed.source)));
  if (settled.every((result) => result.status === "rejected")) throw new Error("Nejsou dostupné žádné mediální RSS zdroje.");
  for (const [index, result] of settled.entries()) {
    if (result.status === "rejected") console.warn(`Mediální RSS ${FEEDS[index].url}: ${result.reason.message}`);
  }
  const rows = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return [...new Map(rows.map((row) => [row.url, row])).values()];
}
