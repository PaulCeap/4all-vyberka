import { searchable } from "./model.mjs";

const AGGREGATORS = new Set(["poptavky", "poptavej"]);
const STOP_WORDS = new Set([
  "a", "i", "k", "na", "nad", "od", "po", "pod", "pro", "s", "se", "u", "v", "ve", "z", "za",
  "do", "sluzby", "sluzeb", "verejna", "verejne", "zakazka", "zakazky", "poptavka", "realizace",
]);

export function isAggregatorSource(source) {
  return AGGREGATORS.has(source);
}

export function sourceFromOfficialUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "zakazky.gov.cz" || host.endsWith(".zakazky.gov.cz")) return "zakazky-gov";
    if (host === "tenderarena.cz" || host.endsWith(".tenderarena.cz")) return "tenderarena";
    if (host === "nen.nipez.cz") return "nen";
    if (host === "ted.europa.eu") return "ted";
    if (host === "zakazky.krajbezkorupce.cz") return "ezak-jmk";
    if (host === "zakazky.spravazeleznic.cz") return "ezak-sz";
    if (host.startsWith("zakazky.") || host.startsWith("ezak.") || host.includes("e-zakazky")) return "official-profile";
    if (host.endsWith(".gov.cz") || host.endsWith(".cz") && /(^|\.)(mesto|obec|kraj|urad)/.test(host)) return "official-web";
  } catch { /* neplatný odkaz není kandidát */ }
  return null;
}

export function extractCandidateOriginUrls(html, pageUrl) {
  const urls = [];
  for (const match of String(html).matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], pageUrl).href;
      const path = new URL(url).pathname.toLowerCase();
      const isSpecificDetail = /detail-zakazky|\/zakazka\/|contract_display_|verejn[a-z-]*zakaz|profil.*zakaz/.test(path);
      if (sourceFromOfficialUrl(url) && isSpecificDetail) urls.push(url);
    } catch { /* relativní nebo poškozený odkaz přeskočíme */ }
  }
  return [...new Set(urls)];
}

function words(value) {
  return new Set(searchable(value).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function overlap(left, right) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((word) => b.has(word)).length;
  return (2 * common) / (a.size + b.size);
}

function sameDay(left, right) {
  return Boolean(left && right && String(left).slice(0, 10) === String(right).slice(0, 10));
}

function matchConfidence(lead, official) {
  let score = overlap(lead.title, official.title) * 82;
  if (sameDay(lead.deadline, official.deadline)) score += 10;
  if (lead.value?.amount && official.value?.amount) {
    const ratio = Math.min(lead.value.amount, official.value.amount) / Math.max(lead.value.amount, official.value.amount);
    if (ratio > 0.97) score += 8;
  }
  const identifiers = `${lead.title} ${lead.summary || ""}`.match(/\b[NP]\d{2}V\d{8}\b|\bN\d{3,}-\d{2,}\b/gi) || [];
  if (identifiers.some((id) => searchable(official.sourceId).includes(searchable(id)))) score = Math.max(score, 98);
  return Math.min(100, Math.round(score));
}

function directOrigin(lead) {
  const url = lead.candidateOriginUrls?.find((candidate) => sourceFromOfficialUrl(candidate));
  if (!url) return null;
  return {
    ...lead,
    source: sourceFromOfficialUrl(url),
    url,
    discoverySource: lead.source,
    discoveryUrl: lead.url,
    originStatus: "resolved",
    originConfidence: 100,
  };
}

export function resolveAggregatorLeads(leads, officialRows) {
  const resolved = [];
  const matchedKeys = new Set();

  for (const lead of leads.filter(Boolean)) {
    const direct = directOrigin(lead);
    if (direct) {
      resolved.push(direct);
      continue;
    }

    const candidates = officialRows
      .map((official) => ({ official, confidence: matchConfidence(lead, official) }))
      .sort((a, b) => b.confidence - a.confidence);
    const match = candidates[0];
    if (match?.confidence >= 72) {
      matchedKeys.add(`${match.official.source}:${match.official.sourceId}`);
      resolved.push({
        ...match.official,
        discoverySource: lead.source,
        discoveryUrl: lead.url,
        originStatus: "resolved",
        originConfidence: match.confidence,
      });
      continue;
    }

    resolved.push({
      ...lead,
      discoverySource: lead.source,
      discoveryUrl: lead.url,
      originStatus: "unresolved",
      originConfidence: match?.confidence || 0,
    });
  }

  return { rows: resolved, matchedKeys };
}
