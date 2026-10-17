import { czechDate, getText, mapLimited, plainText } from "./html-utils.mjs";

const BASE = "https://profily.proebiz.com";

export function parseProebizList(html) {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 5) return [];
    const path = cells[0].match(/href=["'](\/verejne-zakazky\/\d+)["']/i)?.[1];
    if (!path) return [];
    return [{
      url: new URL(path, BASE).href,
      title: plainText(cells[0]),
      buyer: plainText(cells[1]),
      procedureType: plainText(cells[2]),
      publishedAt: czechDate(plainText(cells[3])),
      deadline: czechDate(plainText(cells[4])),
    }];
  });
}

function detailFields(html) {
  const fields = new Map();
  for (const [, label, value] of String(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    fields.set(plainText(label), plainText(value));
  }
  return fields;
}

export function parseProebizDetail(html, url) {
  const id = new URL(url).pathname.match(/^\/verejne-zakazky\/(\d+)\/?$/)?.[1];
  if (!id) return null;
  const fields = detailFields(html);
  const title = fields.get("Název veřejné zakázky");
  const buyer = fields.get("Název zadavatele");
  if (!title || !buyer) return null;
  const documents = [...String(html).matchAll(/<a\b[^>]*href=["'](\/tender\/\d+\/attachments\/download\/\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, path, name]) => ({ name: plainText(name), type: "Dokument", url: new URL(path, BASE).href }))
    .filter((document) => document.name);
  const status = fields.get("Stav zakázky") || "";
  return {
    source: "proebiz", sourceId: id, url, title, buyer,
    summary: fields.get("Stručný popis předmětu") || "",
    country: "CZ", region: "Česko",
    publishedAt: czechDate(fields.get("Datum zveřejnění na profilu zadavatele")),
    deadline: czechDate(fields.get("Lhůta pro podání nabídek")),
    deadlineTimeKnown: /\b\d{1,2}:\d{2}\b/.test(fields.get("Lhůta pro podání nabídek") || ""),
    cpv: [fields.get("Hlavní CPV kód")?.match(/\b\d{8}\b/)?.[0]].filter(Boolean),
    procedureType: fields.get("Druh veřejné zakázky") || "Veřejná zakázka",
    status: /neukončená/i.test(status) ? "open" : status ? "closed" : "unknown",
    documentsUrl: url, documents,
    originStatus: "verified",
  };
}

export async function fetchProebizDetail(url, { fetchImpl = fetch } = {}) {
  return parseProebizDetail(await getText(url, { fetchImpl }), url);
}

export async function fetchProebiz({
  fetchImpl = fetch, now = new Date(), pageLimit = Number(process.env.PROEBIZ_PAGE_LIMIT || 3),
  detailLimit = Number(process.env.PROEBIZ_DETAIL_LIMIT || 60),
} = {}) {
  const pages = await Promise.allSettled(Array.from({ length: pageLimit }, (_, index) =>
    getText(`${BASE}/verejne-zakazky?page=${index + 1}`, { fetchImpl }).then(parseProebizList)));
  if (pages.every((page) => page.status === "rejected")) {
    throw new Error("Proebiz: nepodařilo se načíst seznam zakázek.");
  }
  const listed = [...new Map(pages.flatMap((page) => page.status === "fulfilled" ? page.value : [])
    .map((row) => [row.url, row])).values()]
    .filter((row) => !row.deadline || new Date(row.deadline) > now)
    .slice(0, detailLimit);
  const results = await mapLimited(listed, (row) => fetchProebizDetail(row.url, { fetchImpl }));
  if (listed.length && !results.length) throw new Error("Proebiz: nepodařilo se načíst žádný detail zakázky.");
  return results.filter((row) => row.status !== "closed");
}
