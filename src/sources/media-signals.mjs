import { getText, plainText } from "./html-utils.mjs";
import { searchable } from "../model.mjs";

const FEEDS = [
  { source: "mediaguru", url: "https://www.mediaguru.cz/rss/nejnovejsi" },
  { source: "mediar", url: "https://www.mediar.cz/feed/" },
  { source: "mam", url: "https://www.mam.cz/feed/" },
];
const ACTIVE = ["hleda agenturu", "hledaji agenturu", "hleda partnera", "hledaji partnera", "vyberove rizeni", "vyhlasuje tendr", "vyhlasila tendr", "tendr na", "poptava agenturu"];
const CLOSED = ["vybral agenturu", "vybrala agenturu", "ziskala tendr", "ziskal tendr", "vitezem tendru", "sveruje agenture"];

function tag(item, name) {
  return plainText(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]);
}

export function parseMediaFeed(xml, source) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([, item], index) => {
    const title = tag(item, "title");
    const summary = tag(item, "description");
    const text = searchable(`${title} ${summary}`);
    if (!ACTIVE.some((phrase) => text.includes(phrase)) || CLOSED.some((phrase) => text.includes(phrase))) return [];
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
    }];
  });
}

export async function fetchMediaSignals({ fetchImpl = fetch } = {}) {
  const settled = await Promise.allSettled(FEEDS.map(async (feed) => parseMediaFeed(await getText(feed.url, { fetchImpl }), feed.source)));
  if (settled.every((result) => result.status === "rejected")) throw new Error("Nejsou dostupné žádné mediální RSS zdroje.");
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}
