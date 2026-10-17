import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildDataset } from "./dataset.mjs";
import { attachEzakazkyDocuments, attachNenDocuments, findOriginalRows, preferPrimaryProfiles, refreshSavedNenProfiles, refreshSavedProfiles } from "./origin-discovery.mjs";
import { isAggregatorSource, resolveAggregatorLeads } from "./origin-resolver.mjs";
import { fetchManual } from "./sources/manual.mjs";
import { fetchNen } from "./sources/nen.mjs";
import { fetchPoptavky } from "./sources/poptavky.mjs";
import { fetchPoptavej } from "./sources/poptavej.mjs";
import { fetchMediaSignals } from "./sources/media-signals.mjs";
import { fetchEzakWatchlist } from "./sources/ezak-watchlist.mjs";
import { fetchEzakazkyDetail } from "./sources/e-zakazky.mjs";
import { fetchTed, fetchTedNotice } from "./sources/ted.mjs";
import { fetchTenderArena } from "./sources/tenderarena.mjs";
import { fetchZakazkyGov } from "./sources/zakazky-gov.mjs";
import { attachVerifiedNotes } from "./verified-notes.mjs";
import { publicDataset } from "./publication.mjs";

const OUTPUT = "public/data/tenders.json";
const STATE = "data/tender-state.json";
const RADAR_STATE = "data/radar-leads.json";
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

async function collect(previous = { tenders: [] }, previousRadar = { leads: [] }) {
  if (fixturesMode) {
    return { rows: await loadJson(FIXTURES, []), sources: [{ id: "fixtures", ok: true }], pendingLeads: [] };
  }
  const officialCollectors = [
    ["zakazky-gov", () => fetchZakazkyGov()],
    ["tenderarena", () => fetchTenderArena()],
    ["nen", () => fetchNen()],
    ["ted", () => fetchTed({ now })],
    ["ezak-watchlist", () => fetchEzakWatchlist()],
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
  const savedProfiles = previous.tenders.filter((row) => row.source === "official-profile" &&
    /e-zakazky\.cz\/profil-zadavatele\//i.test(row.url || "") && !currentIds.has(row.id));
  const refreshedProfiles = await refreshSavedProfiles(savedProfiles, { fetchDetail: fetchEzakazkyDetail });
  const primary = await preferPrimaryProfiles([...refreshedProfiles, ...refreshedNen, ...refreshedSecondary, ...currentOfficial], {
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
  const nenDocumentsRows = await attachNenDocuments([...primary.rows, ...originalRows], { now });
  const documentsRows = await attachEzakazkyDocuments(nenDocumentsRows, { now });
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
  };
}

const loadedPrevious = await loadJson(STATE, await loadJson(OUTPUT, { schemaVersion: 1, tenders: [] }));
const demoIds = new Set(["zakazky-gov:RVZ-DEMO-001", "manual:DEMO-002", "manual:DEMO-003"]);
const previous = fixturesMode
  ? { ...loadedPrevious, tenders: [] }
  : { ...loadedPrevious, tenders: loadedPrevious.tenders.filter((tender) => !demoIds.has(tender.id)) };
const previousRadar = fixturesMode ? { leads: [] } : await loadJson(RADAR_STATE, { leads: [] });
const { rows, sources, pendingLeads, supersededIds = new Set() } = await collect(previous, previousRadar);
const currentPrevious = { ...previous, tenders: previous.tenders.filter((row) => !supersededIds.has(row.id)) };
const { dataset, invalidRows } = buildDataset({ rows, sources, previous: currentPrevious, now, fixturesMode });
await mkdir("public/data", { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(publicDataset(dataset), null, 2)}\n`);
if (!fixturesMode) {
  await mkdir("data", { recursive: true });
  await writeFile(STATE, `${JSON.stringify(dataset, null, 2)}\n`);
  await writeFile(RADAR_STATE, `${JSON.stringify({ updatedAt: now.toISOString(), leads: pendingLeads }, null, 2)}\n`);
}
console.log(`Uloženo ${dataset.tenders.length} relevantních zakázek (${dataset.stats.newThisRun} nových).`);
if (invalidRows.length) console.warn(`Přeskočeno ${invalidRows.length} neplatných položek: ${JSON.stringify(invalidRows.slice(0, 5))}`);
for (const source of sources) {
  console.log(`${source.ok ? "✓" : "!"} ${source.id}: ${source.count || 0}${source.error ? ` — ${source.error}` : ""}`);
}
