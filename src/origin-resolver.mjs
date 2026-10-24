import { searchable } from "./model.mjs";

const AGGREGATORS = new Set(["poptavky", "poptavej"]);
const STOP_WORDS = new Set([
  "a", "i", "k", "na", "nad", "od", "po", "pod", "pro", "s", "se", "u", "v", "ve", "z", "za",
  "do", "sluzby", "sluzeb", "verejna", "verejne", "zakazka", "zakazky", "poptavka", "realizace",
]);

export function isAggregatorSource(source) {
  return AGGREGATORS.has(source);
}

export function isAggregatorUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ["poptavej.cz", "poptavky.cz"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

export function sourceFromOfficialUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "zakazky.gov.cz" || host.endsWith(".zakazky.gov.cz")) return "zakazky-gov";
    if (host === "tenderarena.cz" || host.endsWith(".tenderarena.cz")) return "tenderarena";
    if (host === "nen.nipez.cz") return "nen";
    if (host === "profily.proebiz.com") return "proebiz";
    if (host === "ted.europa.eu") return "ted";
    if (host === "zakazky.krajbezkorupce.cz") return "ezak-jmk";
    if (host === "zakazky.spravazeleznic.cz") return "ezak-sz";
    if (host.endsWith(".cz") && (host.startsWith("zakazky.") || host.startsWith("ezak.") || host.includes("e-zakazky"))) return "official-profile";
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

export function matchConfidence(lead, official) {
  if (!official?.url || !official?.title || !sourceFromOfficialUrl(official.url)) return 0;
  const titleMatch = overlap(lead.title, official.title);
  const buyer = searchable(lead.buyer);
  if (buyer && !/^(neuveden|zadavatel z)/.test(buyer) && overlap(lead.buyer, official.buyer) < 0.6) return 0;
  const identifiers = `${lead.title} ${lead.summary || ""}`.match(/\b(?:RVZ\d{10}|[NP]\d{2,3}[/\-]\d{2}[/\-]V\d{8}|[NP]\d{2}V\d{8})\b/gi) || [];
  const identifierMatch = identifiers.some((id) =>
    searchable(official.sourceId).replace(/[^a-z0-9]/g, "") === searchable(id).replace(/[^a-z0-9]/g, ""));
  const directLink = lead.candidateOriginUrls?.includes(official.url);
  if (!identifierMatch && !directLink && lead.deadline && official.deadline &&
      !sameDay(lead.deadline, official.deadline)) return 0;
  if (titleMatch < (identifierMatch ? 0.45 : 0.82)) return 0;
  if (!identifierMatch && !directLink && !sameDay(lead.deadline, official.deadline) && titleMatch < 0.92) return 0;
  if (!identifierMatch && !directLink && !sameDay(lead.deadline, official.deadline) && words(lead.title).size < 4) return 0;
  let score = titleMatch * 85;
  if (sameDay(lead.deadline, official.deadline)) score += 10;
  if (identifierMatch) score = Math.max(score, 98);
  else if (directLink) score = Math.max(score, 92);
  return Math.min(100, Math.round(score));
}

// A secondary official notice may contain an older deadline. Accept the
// current primary profile only with an exact named buyer/title and a profile
// link from that notice. Aggregator matching remains deliberately stricter.
export function primaryMatchConfidence(notice, primary) {
  const confidence = matchConfidence(notice, primary);
  if (confidence >= 72) return confidence;
  if (!["ted", "zakazky-gov"].includes(notice.source)) return confidence;
  if (!searchable(notice.buyer) || /^(neuveden|zadavatel z)/.test(searchable(notice.buyer))) return 0;
  if (searchable(notice.buyer) !== searchable(primary.buyer) || searchable(notice.title) !== searchable(primary.title)) return 0;
  if (words(notice.title).size < 4) return 0;
  const linked = (notice.candidateProfileUrls || []).some((url) => {
    try {
      const profile = new URL(url), detail = new URL(primary.url);
      // E-zakazky publishes both /Profil-Zadavatele and /profil-zadavatele.
      const path = (u) => /(^|\.)e-zakazky\.cz$/.test(u.hostname) ? u.pathname.toLowerCase() : u.pathname;
      const prefix = path(profile).replace(/\/$/, "");
      return profile.origin === detail.origin && prefix.length > 1 &&
        (path(detail) === prefix || path(detail).startsWith(`${prefix}/`));
    } catch { return false; }
  });
  const distance = Math.abs(new Date(notice.deadline) - new Date(primary.deadline));
  return linked && distance <= 90 * 86400_000 ? 96 : 0;
}

export function resolveAggregatorLeads(leads, officialRows) {
  const resolved = [];
  const matchedKeys = new Set();

  for (const lead of leads.filter(Boolean)) {
    const candidates = officialRows
      .map((official) => ({ official, confidence: matchConfidence(lead, official) }))
      .sort((a, b) => b.confidence - a.confidence);
    const match = candidates[0];
    const competing = candidates[1];
    const unambiguous = !competing || competing.confidence < 72 ||
      competing.confidence <= match.confidence - 8 ||
      competing.official.url === match.official.url;
    if (match?.confidence >= 72 && unambiguous) {
      matchedKeys.add(`${match.official.source}:${match.official.sourceId}`);
      resolved.push({
        ...match.official,
        firstSeenAt: lead.firstSeenAt || match.official.firstSeenAt,
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
