import { normalizeTender } from "./model.mjs";
import { scoreTender } from "./scoring.mjs";
import { matchConfidence, primaryMatchConfidence, sourceFromOfficialUrl } from "./origin-resolver.mjs";
import { getText } from "./sources/html-utils.mjs";
import { parseEzakDetail } from "./sources/ezak-watchlist.mjs";
import { fetchEzakazkyDetail, fetchEzakazkyDocuments, searchEzakazkyProfile } from "./sources/e-zakazky.mjs";
import { fetchNenDetail, fetchNenDocuments, searchNenForOrigin } from "./sources/nen.mjs";
import { fetchProebizDetail } from "./sources/proebiz.mjs";

export async function preferPrimaryProfiles(rows, {
  searchNen = (title) => searchNenForOrigin(title),
  searchProfile = (url, title) => searchEzakazkyProfile(url, title),
  previousTenders = [],
  now = new Date(),
  minimumScore = 42,
  searchLimit = 20,
} = {}) {
  const previousById = new Map(previousTenders.map((row) => [row.id, row]));
  const primaryRows = rows.filter((row) => row.source === "nen" || row.source === "official-profile" || row.source?.startsWith("ezak-"));
  const output = [];
  const supersededIds = new Set();
  let searched = 0;

  for (const row of rows) {
    let relevant = false;
    try { relevant = scoreTender(normalizeTender(row, now), now, { preliminary: true }).score >= minimumScore; }
    catch { /* neúplný záznam vyřadí validace datové sady */ }
    if (!["ted", "zakazky-gov"].includes(row.source) || !relevant) {
      output.push(row);
      continue;
    }
    let matches = primaryRows.filter((candidate) => primaryMatchConfidence(row, candidate) >= 72);
    if (!matches.length && searched < searchLimit) {
      for (const profileUrl of row.candidateProfileUrls || []) {
        if (searched >= searchLimit) break;
        if (!/^https:\/\/www\.e-zakazky\.cz\/profil-zadavatele\//i.test(profileUrl)) continue;
        searched += 1;
        try {
          matches = (await searchProfile(profileUrl, row.title))
            .filter((candidate) => primaryMatchConfidence(row, candidate) >= 72);
          if (matches.length) break;
        } catch { /* zkusíme další profil nebo NEN */ }
      }
    }
    if (!matches.length && searched < searchLimit) {
      searched += 1;
      try {
        matches = (await searchNen(row.title))
          .filter((candidate) => primaryMatchConfidence(row, candidate) >= 72);
      } catch { /* oficiální oznámení zůstane dostupné i při výpadku profilu */ }
    }
    matches = [...new Map(matches.map((candidate) => [candidate.url, candidate])).values()];
    if (matches.length !== 1) {
      output.push(row);
      continue;
    }
    const primary = matches[0];
    const old = previousById.get(`${row.source}:${row.sourceId}`);
    supersededIds.add(`${row.source}:${row.sourceId}`);
    primaryRows.push(primary);
    output.push({
      ...primary,
      summary: primary.summary || row.summary,
      cpv: primary.cpv?.length ? primary.cpv : row.cpv,
      value: primary.value || row.value,
      valueSource: primary.value ? primary.source : row.value ? row.source : null,
      firstSeenAt: old?.firstSeenAt || row.firstSeenAt,
      discoverySource: old?.discoverySource || row.discoverySource,
      discoveryUrl: old?.discoveryUrl || row.discoveryUrl,
      originStatus: old?.originStatus === "resolved" || row.originStatus === "resolved"
        ? "resolved" : primary.originStatus,
      originConfidence: old?.originConfidence || row.originConfidence || null,
    });
  }
  return { rows: output, supersededIds };
}

export async function attachEzakazkyDocuments(rows, {
  fetchDocuments = (url) => fetchEzakazkyDocuments(url),
  now = new Date(),
  minimumScore = 42,
  previousDocuments = new Map(),
} = {}) {
  const output = [];
  for (const row of rows) {
    if (row.source !== "official-profile" || !/e-zakazky\.cz\/profil-zadavatele\//i.test(row.url || "")) {
      output.push(row);
      continue;
    }
    let relevant = false;
    try { relevant = scoreTender(normalizeTender(row, now), now, { preliminary: true }).score >= minimumScore; }
    catch { /* neúplný detail se neobohacuje */ }
    if (!relevant) { output.push(row); continue; }
    let result = null;
    let error = null;
    try { result = await fetchDocuments(row.url); }
    catch (failure) { error = failure.message || String(failure); }
    const fallback = previousDocuments.get(`${row.source}:${row.sourceId}`) || [];
    if (!result?.documents?.length && fallback.length) error ||= "Zdroj vrátil prázdný seznam podkladů.";
    output.push({
      ...row,
      documentsUrl: result?.url || row.url,
      documents: result?.documents?.length ? result.documents : fallback,
      documentsFetchError: error,
      verifiedFacts: [],
      factsReviewedAt: null,
    });
  }
  return output;
}

export async function attachNenDocuments(rows, {
  fetchDocuments = (url) => fetchNenDocuments(url),
  now = new Date(),
  minimumScore = 42,
  previousDocuments = new Map(),
} = {}) {
  const byUrl = new Map();
  for (const row of rows) {
    if (row.source !== "nen" || !row.url) continue;
    let relevant = false;
    try { relevant = scoreTender(normalizeTender(row, now), now, { preliminary: true }).score >= minimumScore; }
    catch { /* neúplný záznam neobohacujeme */ }
    if (!relevant || byUrl.has(row.url)) continue;
    byUrl.set(row.url, null);
  }
  for (const url of byUrl.keys()) {
    try { byUrl.set(url, await fetchDocuments(url)); }
    catch (failure) { byUrl.set(url, { error: failure.message || String(failure) }); }
  }
  return rows.map((row) => {
    if (!byUrl.has(row.url)) return row;
    const result = byUrl.get(row.url);
    const fallback = previousDocuments.get(`${row.source}:${row.sourceId}`) || [];
    return {
      ...row,
      documentsUrl: result?.url || `${row.url.replace(/\/$/, "")}/zadavaci-dokumentace`,
      documents: result?.documents?.length ? result.documents : fallback,
      documentsFetchError: result?.error || (!result?.documents?.length && fallback.length ? "Zdroj vrátil prázdný seznam podkladů." : null),
      verifiedFacts: [],
      factsReviewedAt: null,
    };
  });
}

export async function refreshSavedProfiles(rows, { fetchDetail } = {}) {
  const refreshed = [];
  for (let index = 0; index < rows.length; index += 6) {
    const batch = rows.slice(index, index + 6);
    const results = await Promise.allSettled(batch.map((row) => fetchDetail(row.url)));
    for (let offset = 0; offset < batch.length; offset += 1) {
      const old = batch[offset];
      const fresh = results[offset].status === "fulfilled" ? results[offset].value : null;
      refreshed.push({
        ...old,
        ...(fresh || {}),
        profileFetchError: fresh ? null : results[offset].status === "rejected"
          ? results[offset].reason.message : "Profil nevrátil aktuální detail zakázky.",
        firstSeenAt: old.firstSeenAt,
        discoverySource: old.discoverySource,
        discoveryUrl: old.discoveryUrl,
        originStatus: old.originStatus,
        originConfidence: old.originConfidence,
        documents: fresh?.documents || [],
        verifiedFacts: [],
        factsReviewedAt: null,
      });
    }
  }
  return refreshed;
}

export async function refreshSavedNenProfiles(rows, options = {}) {
  return refreshSavedProfiles(rows, { fetchDetail: (url) => fetchNenDetail(url), ...options });
}

export async function fetchOriginalDetail(url, { fetchImpl = fetch } = {}) {
  const source = sourceFromOfficialUrl(url);
  if (source === "nen" && /\/detail-zakazky\//.test(new URL(url).pathname)) {
    return fetchNenDetail(url, { fetchImpl });
  }
  if (source === "proebiz" && /^\/verejne-zakazky\/\d+\/?$/.test(new URL(url).pathname)) {
    return fetchProebizDetail(url, { fetchImpl });
  }
  if (source === "official-profile" && /e-zakazky\.cz\/profil-zadavatele\//i.test(url)) {
    return fetchEzakazkyDetail(url, { fetchImpl });
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
  onChecked = () => {},
} = {}) {
  const discovered = [];
  const checkedUrls = new Set(officialRows.map((row) => row.url).filter(Boolean));

  // Odkaz z radaru je jen vodítko: musí se otevřít a získat vlastní záznam.
  const ordered = [...leads].sort((a, b) =>
    String(a.lastOriginCheckAt || "").localeCompare(String(b.lastOriginCheckAt || "")) ||
    String(a.firstSeenAt || "").localeCompare(String(b.firstSeenAt || "")));
  for (const lead of ordered) {
    for (const url of lead.candidateOriginUrls || []) {
      if (!sourceFromOfficialUrl(url) || checkedUrls.has(url)) continue;
      checkedUrls.add(url);
      onChecked(lead);
      try {
        const detail = await fetchDetail(url);
        if (detail && matchConfidence(lead, detail) >= 72) discovered.push(detail);
      } catch { /* nepřístupný zdroj zůstane pouze interním tipem */ }
    }
  }

  let searched = 0;
  for (const lead of ordered) {
    if (lead.opportunityType !== "public-tender" || searched >= searchLimit) continue;
    try {
      if (scoreTender(normalizeTender(lead, now), now, { preliminary: true }).score < minimumScore) continue;
    } catch { continue; }
    const alreadyFound = [...officialRows, ...discovered]
      .some((official) => matchConfidence(lead, official) >= 72);
    if (alreadyFound) continue;
    searched += 1;
    onChecked(lead);
    try {
      const candidates = await searchNen(lead.title);
      discovered.push(...candidates.filter((candidate) => matchConfidence(lead, candidate) >= 72));
    } catch { /* výpadek cíleného dotazu neohrozí ostatní zdroje */ }
  }

  return discovered;
}
