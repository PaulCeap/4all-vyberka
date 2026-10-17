import { normalizeTender } from "./model.mjs";
import { scoreTender } from "./scoring.mjs";
import { matchConfidence, sourceFromOfficialUrl } from "./origin-resolver.mjs";
import { getText } from "./sources/html-utils.mjs";
import { parseEzakDetail } from "./sources/ezak-watchlist.mjs";
import { fetchNenDetail, searchNenForOrigin } from "./sources/nen.mjs";

export async function fetchOriginalDetail(url, { fetchImpl = fetch } = {}) {
  const source = sourceFromOfficialUrl(url);
  if (source === "nen" && /\/detail-zakazky\//.test(new URL(url).pathname)) {
    return fetchNenDetail(url, { fetchImpl });
  }
  if (["ezak-jmk", "ezak-sz", "official-profile"].includes(source) &&
      /\/contract_display_\d+\.html$/.test(new URL(url).pathname)) {
    return parseEzakDetail(await getText(url, { fetchImpl }), url, { source, buyer: "" });
  }
  return null;
}

export async function findOriginalRows(leads, officialRows, {
  fetchImpl = fetch,
  fetchDetail = (url) => fetchOriginalDetail(url, { fetchImpl }),
  searchNen = (title) => searchNenForOrigin(title, { fetchImpl }),
  now = new Date(),
  minimumScore = 42,
  searchLimit = 12,
} = {}) {
  const discovered = [];
  const checkedUrls = new Set(officialRows.map((row) => row.url).filter(Boolean));

  // Odkaz z radaru je jen vodítko: musí se otevřít a získat vlastní záznam.
  for (const lead of leads) {
    for (const url of lead.candidateOriginUrls || []) {
      if (!sourceFromOfficialUrl(url) || checkedUrls.has(url)) continue;
      checkedUrls.add(url);
      try {
        const detail = await fetchDetail(url);
        if (detail && matchConfidence(lead, detail) >= 72) discovered.push(detail);
      } catch { /* nepřístupný zdroj zůstane pouze interním tipem */ }
    }
  }

  let searched = 0;
  for (const lead of leads) {
    if (lead.opportunityType !== "public-tender" || searched >= searchLimit) continue;
    if (scoreTender(normalizeTender(lead, now), now).score < minimumScore) continue;
    const alreadyFound = [...officialRows, ...discovered]
      .some((official) => matchConfidence(lead, official) >= 72);
    if (alreadyFound) continue;
    searched += 1;
    try {
      const candidates = await searchNen(lead.title);
      discovered.push(...candidates.filter((candidate) => matchConfidence(lead, candidate) >= 72));
    } catch { /* výpadek cíleného dotazu neohrozí ostatní zdroje */ }
  }

  return discovered;
}
