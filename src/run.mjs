import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildDataset } from "./dataset.mjs";
import { pendingDocumentReviews } from "./document-review.mjs";
import { isCurrentReviewCandidate, reviewPendingDocuments } from "./automatic-review.mjs";
import { attachEzakazkyDocuments, attachNenDocuments, findOriginalRows, preferPrimaryProfiles, refreshSavedNenProfiles, refreshSavedProfiles } from "./origin-discovery.mjs";
import { isAggregatorSource, resolveAggregatorLeads } from "./origin-resolver.mjs";
import { fetchManual } from "./sources/manual.mjs";
import { fetchNen, fetchNenDetail } from "./sources/nen.mjs";
import { fetchPoptavky } from "./sources/poptavky.mjs";
import { fetchPoptavej } from "./sources/poptavej.mjs";
import { fetchMediaSignals } from "./sources/media-signals.mjs";
import { fetchEzakWatchlist } from "./sources/ezak-watchlist.mjs";
import { fetchEzakazkyDetail } from "./sources/e-zakazky.mjs";
import { fetchTed, fetchTedNotice } from "./sources/ted.mjs";
import { fetchTenderArena } from "./sources/tenderarena.mjs";
import { fetchProebiz, fetchProebizDetail } from "./sources/proebiz.mjs";
import { fetchZakazkyGov } from "./sources/zakazky-gov.mjs";
import { attachVerifiedNotes } from "./verified-notes.mjs";
import { publicDataset } from "./publication.mjs";
import { normalizeTender } from "./model.mjs";
import { scoreTender } from "./scoring.mjs";
import { PROJECT } from "./config.mjs";

const OUTPUT = "public/data/tenders.json";
const STATE = "data/tender-state.json";
const RADAR_STATE = "data/radar-leads.json";
const REVIEW_QUEUE = "data/review-queue.json";
const AUTOMATIC_NOTES = "data/automatic-notes.json";
const FIXTURES = "data/fixtures/incoming.json";
const now = process.env.AGENT_NOW ? new Date(process.env.AGENT_NOW) : new Date();
const fixturesMode = process.argv.includes("--fixtures");

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function runCollectors(collectors) {
  const settled = await Promise.allSettled(collectors.map(([, run]) => run()));
  return {
    settled,
    sources: settled.map((result, index) => ({
      id: collectors[index][0],
      ok: result.status === "fulfilled",
      count: result.status === "fulfilled" ? result.value.length : 0,
      error: result.status === "rejected" ? result.reason.message : undefined,
    })),
    rows: settled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  };
}

async function collect(previous = { tenders: [] }, previousRadar = { leads: [] }, previousReview = { tenders: [] }) {
  if (fixturesMode) {
    return { rows: await loadJson(FIXTURES, []), sources: [{ id: "fixtures", ok: true }], pendingLeads: [] };
  }
  const officialCollectors = [
    ["zakazky-gov", () => fetchZakazkyGov()],
    ["tenderarena", () => fetchTenderArena()],
    ["nen", () => fetchNen()],
    ["ted", () => fetchTed({ now })],
    ["ezak-watchlist", () => fetchEzakWatchlist()],
    ["proebiz", () => fetchProebiz({ now })],
  ];
  const supportingCollectors = [
    ["media-signals", () => fetchMediaSignals()],
    ["manual", () => fetchManual()],
  ];
  const radarCollectors = [
    ["poptavky", () => fetchPoptavky()],
    ["poptavej", () => fetchPoptavej()],
  ];

  const [official, supporting, radar] = await Promise.all([
    runCollectors(officialCollectors),
    runCollectors(supportingCollectors),
    runCollectors(radarCollectors),
  ]);
  const sources = [...official.sources, ...supporting.sources, ...radar.sources];
  if (!official.rows.some(Boolean)) {
    throw new Error(`Oficiální zdroje nevrátily žádnou zakázku: ${official.sources.map((source) => `${source.id}: ${source.error || `${source.count} položek`}`).join("; ")}`);
  }
  const currentOfficial = official.rows.filter(Boolean);
  const currentIds = new Set(currentOfficial.map((row) => `${row.source}:${row.sourceId}`));
  const savedSecondary = previous.tenders.filter((row) =>
    ["ted", "zakazky-gov"].includes(row.source) && !currentIds.has(row.id));
  const refreshedSecondary = [];
  for (const old of savedSecondary) {
    if (old.source !== "ted") { refreshedSecondary.push(old); continue; }
    let fresh = null;
    try { fresh = await fetchTedNotice(old.sourceId); }
    catch { /* starší oznámení lze stále dohledávat podle uložených údajů */ }
    refreshedSecondary.push(fresh ? {
      ...old, ...fresh, firstSeenAt: old.firstSeenAt,
      discoverySource: old.discoverySource, discoveryUrl: old.discoveryUrl,
      originStatus: old.originStatus, originConfidence: old.originConfidence,
    } : old);
  }
  const savedNen = previous.tenders.filter((row) => row.source === "nen" && !currentIds.has(row.id));
  const refreshedNen = await refreshSavedNenProfiles(savedNen);
  const reviewNen = (previousReview.tenders || []).filter((item) => {
    if (!item.id?.startsWith("nen:") || currentIds.has(item.id) || previous.tenders.some((row) => row.id === item.id)) return false;
    const year = Number(item.id.match(/^nen:N\d{3}\/(\d{2})\//)?.[1]);
    return year >= now.getUTCFullYear() % 100;
  }).slice(0, 10);
  const recoveredReviews = await Promise.allSettled(reviewNen.map((item) => {
    const url = `https://nen.nipez.cz/verejne-zakazky/detail-zakazky/${item.id.slice(4).replaceAll("/", "-")}`;
    return fetchNenDetail(url);
  }));
  const reviewSourceErrors = [];
  const recoveredNen = recoveredReviews.flatMap((result, index) => {
    if (result.status === "fulfilled" && result.value) return [result.value];
    reviewSourceErrors.push({ id: reviewNen[index].id, title: reviewNen[index].title,
      error: result.status === "rejected" ? result.reason.message : "Původní detail se nenačetl." });
    return [];
  });
  const savedProfiles = previous.tenders.filter((row) => row.source === "official-profile" &&
    /e-zakazky\.cz\/profil-zadavatele\//i.test(row.url || "") && !currentIds.has(row.id));
  const refreshedProfiles = await refreshSavedProfiles(savedProfiles, { fetchDetail: fetchEzakazkyDetail });
  const savedProebiz = previous.tenders.filter((row) => row.source === "proebiz" && !currentIds.has(row.id));
  const refreshedProebiz = await refreshSavedProfiles(savedProebiz, { fetchDetail: fetchProebizDetail });
  const primary = await preferPrimaryProfiles([...refreshedProfiles, ...refreshedProebiz, ...refreshedNen, ...recoveredNen, ...refreshedSecondary, ...currentOfficial], {
    previousTenders: previous.tenders, now,
  });

  const previousUnresolved = [
    ...previousRadar.leads,
    ...previous.tenders.filter((tender) => isAggregatorSource(tender.source) && tender.originStatus !== "resolved"),
  ].filter((lead) => {
    if (lead.deadline && new Date(lead.deadline) <= now) return false;
    return new Date(lead.lastSeenAt || lead.firstSeenAt || 0) >= new Date(now.valueOf() - 45 * 86_400_000);
  });
  const leadMap = new Map();
  for (const lead of previousUnresolved) leadMap.set(`${lead.source}:${lead.sourceId}`, lead);
  for (const lead of radar.rows.filter(Boolean)) {
    const key = `${lead.source}:${lead.sourceId}`;
    leadMap.set(key, {
      ...lead,
      firstSeenAt: leadMap.get(key)?.firstSeenAt || now.toISOString(),
      lastSeenAt: now.toISOString(),
      lastOriginCheckAt: leadMap.get(key)?.lastOriginCheckAt || null,
      originCheckAttempts: leadMap.get(key)?.originCheckAttempts || 0,
    });
  }
  const leads = [...leadMap.values()];
  const firstPass = resolveAggregatorLeads(leads, primary.rows);
  const unmatched = firstPass.rows.filter((row) => row.originStatus === "unresolved");
  const checkedIds = new Set();
  const originalRows = await findOriginalRows(unmatched, primary.rows, {
    now, onChecked: (lead) => checkedIds.add(`${lead.source}:${lead.sourceId}`),
  });
  const previousDocuments = new Map([...previous.tenders, ...(previousReview.tenders || [])]
    .filter((row) => row.documents?.length).map((row) => [row.id, row.documents]));
  const nenDocumentsRows = await attachNenDocuments([...primary.rows, ...originalRows], { now, previousDocuments });
  const documentsRows = await attachEzakazkyDocuments(nenDocumentsRows, { now, previousDocuments });
  const officialRows = attachVerifiedNotes(documentsRows, await loadJson("data/verified-notes.json", {}));
  const resolution = resolveAggregatorLeads(leads, officialRows);
  const aggregatorSource = sources.find((source) => source.id === "poptavky");
  if (aggregatorSource) aggregatorSource.resolved = resolution.rows.filter((row) => row.discoverySource === "poptavky" && row.originStatus === "resolved").length;
  const poptavejSource = sources.find((source) => source.id === "poptavej");
  if (poptavejSource) poptavejSource.resolved = resolution.rows.filter((row) => row.discoverySource === "poptavej" && row.originStatus === "resolved").length;

  const pendingLeads = resolution.rows.filter((row) => row.originStatus === "unresolved")
    .map((row) => checkedIds.has(`${row.source}:${row.sourceId}`) ? {
      ...row, lastOriginCheckAt: now.toISOString(),
      originCheckAttempts: (row.originCheckAttempts || 0) + 1,
    } : row);
  for (const source of sources.filter((item) => isAggregatorSource(item.id))) {
    source.pending = pendingLeads.filter((lead) => lead.discoverySource === source.id).length;
  }
  return {
    rows: [...officialRows, ...supporting.rows,
      ...resolution.rows.filter((row) => row.originStatus === "resolved")],
    sources,
    pendingLeads,
    supersededIds: primary.supersededIds,
    reviewSourceErrors,
  };
}

const loadedPrevious = await loadJson(STATE, await loadJson(OUTPUT, { schemaVersion: 1, tenders: [] }));
const demoIds = new Set(["zakazky-gov:RVZ-DEMO-001", "manual:DEMO-002", "manual:DEMO-003"]);
const previous = fixturesMode
  ? { ...loadedPrevious, tenders: [] }
  : { ...loadedPrevious, tenders: loadedPrevious.tenders.filter((tender) => !demoIds.has(tender.id)) };
const previousRadar = fixturesMode ? { leads: [] } : await loadJson(RADAR_STATE, { leads: [] });
const previousReview = fixturesMode ? { tenders: [] } : await loadJson(REVIEW_QUEUE, { tenders: [] });
const { rows, sources, pendingLeads, supersededIds = new Set(), reviewSourceErrors = [] } = await collect(previous, previousRadar, previousReview);
let enrichedRows = rows;
let reviewResult = { results: [] };
let reviewQueue = { updatedAt: now.toISOString(), pendingCount: 0, tenders: [] };
if (!fixturesMode) {
  const manualNotes = await loadJson("data/verified-notes.json", {});
  const automaticNotes = await loadJson(AUTOMATIC_NOTES, {});
  const candidates = new Map();
  for (const row of rows) {
    if (isAggregatorSource(row?.source) || row?.originStatus === "unresolved") continue;
    try {
      const candidate = normalizeTender(row, now);
      if (!isCurrentReviewCandidate(candidate, now, PROJECT.historyDays, PROJECT.openNoDeadlineDays)) continue;
      if (scoreTender(candidate, now, { preliminary: true }).score < PROJECT.minimumScore) continue;
      if ((candidate.documents?.length || 0) > (candidates.get(candidate.id)?.documents?.length || 0)) {
        candidates.set(candidate.id, candidate);
      }
    } catch { /* neúplný kandidát nemá podklady k posouzení */ }
  }
  const pending = pendingDocumentReviews([...candidates.values()], { ...automaticNotes, ...manualNotes });
  reviewResult = await reviewPendingDocuments(pending, [...candidates.values()], now);
  const updatedNotes = { ...automaticNotes, ...reviewResult.notes };
  enrichedRows = attachVerifiedNotes(rows, updatedNotes);
  await writeFile(AUTOMATIC_NOTES, `${JSON.stringify(updatedNotes, null, 2)}\n`);
  const remaining = pendingDocumentReviews([...candidates.values()], { ...updatedNotes, ...manualNotes });
  const results = new Map(reviewResult.results.map((item) => [item.id, item]));
  const remainingById = new Map(remaining.map((item) => [item.id, { ...item,
    status: results.get(item.id)?.status || "pending", error: results.get(item.id)?.error || null }]));
  const sourceErrors = [...new Map([...reviewSourceErrors, ...rows.filter((row) => row.documentsFetchError).flatMap((row) => {
    try {
      return isCurrentReviewCandidate(normalizeTender(row, now), now, PROJECT.historyDays, PROJECT.openNoDeadlineDays)
        ? [{ id: `${row.source}:${row.sourceId}`, title: row.title, error: row.documentsFetchError }] : [];
    } catch { return []; }
  })].map((item) => [item.id, item])).values()];
  for (const error of sourceErrors) if (!remainingById.has(error.id)) {
    const previousItem = (previousReview.tenders || []).find((item) => item.id === error.id);
    remainingById.set(error.id, { ...previousItem, id: error.id, title: error.title,
      documents: previousItem?.documents || [], status: "source-error", error: error.error });
  }
  reviewQueue = {
    updatedAt: now.toISOString(),
    reviewedCount: reviewResult.results.filter((item) => item.status === "reviewed").length,
    pendingCount: remainingById.size,
    failedCount: reviewResult.results.filter((item) => item.status === "failed").length + sourceErrors.length,
    sourceErrors,
    tenders: [...remainingById.values()],
  };
}
const currentPrevious = { ...previous, tenders: previous.tenders.filter((row) => !supersededIds.has(row.id)) };
const { dataset, invalidRows } = buildDataset({ rows: enrichedRows, sources, previous: currentPrevious, now, fixturesMode });
await mkdir("public/data", { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(publicDataset(dataset), null, 2)}\n`);
if (!fixturesMode) {
  await mkdir("data", { recursive: true });
  await writeFile(STATE, `${JSON.stringify(dataset, null, 2)}\n`);
  await writeFile(RADAR_STATE, `${JSON.stringify({ updatedAt: now.toISOString(), leads: pendingLeads }, null, 2)}\n`);
  await writeFile(REVIEW_QUEUE, `${JSON.stringify(reviewQueue, null, 2)}\n`);
}
console.log(`Uloženo ${dataset.tenders.length} relevantních zakázek (${dataset.stats.newThisRun} nových).`);
if (!fixturesMode) console.log(`Podklady: ${reviewQueue.reviewedCount} přečteno, ${reviewQueue.pendingCount} čeká, ${reviewQueue.failedCount} chyb.`);
if (invalidRows.length) console.warn(`Přeskočeno ${invalidRows.length} neplatných položek: ${JSON.stringify(invalidRows.slice(0, 5))}`);
for (const source of sources) {
  console.log(`${source.ok ? "✓" : "!"} ${source.id}: ${source.count || 0}${source.error ? ` — ${source.error}` : ""}`);
}
