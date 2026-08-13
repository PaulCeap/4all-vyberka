import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PROJECT } from "./config.mjs";
import { deduplicateTenders } from "./deduplicate.mjs";
import { normalizeTender, validateDataset } from "./model.mjs";
import { scoreTender } from "./scoring.mjs";
import { isAggregatorSource, resolveAggregatorLeads } from "./origin-resolver.mjs";
import { fetchManual } from "./sources/manual.mjs";
import { fetchNen } from "./sources/nen.mjs";
import { fetchPoptavky } from "./sources/poptavky.mjs";
import { fetchPoptavej } from "./sources/poptavej.mjs";
import { fetchMediaSignals } from "./sources/media-signals.mjs";
import { fetchEzakWatchlist } from "./sources/ezak-watchlist.mjs";
import { fetchTed } from "./sources/ted.mjs";
import { fetchTenderArena } from "./sources/tenderarena.mjs";
import { fetchZakazkyGov } from "./sources/zakazky-gov.mjs";

const OUTPUT = "public/data/tenders.json";
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

async function collect(previous = { tenders: [] }) {
  if (fixturesMode) {
    return { rows: await loadJson(FIXTURES, []), sources: [{ id: "fixtures", ok: true }] };
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
  if (!official.sources.some((source) => source.ok)) {
    throw new Error(`Selhaly všechny oficiální síťové zdroje: ${official.sources.map((source) => `${source.id}: ${source.error || "ok"}`).join("; ")}`);
  }

  const previousUnresolved = previous.tenders.filter((tender) =>
    isAggregatorSource(tender.source) && tender.originStatus !== "resolved");
  const resolution = resolveAggregatorLeads([...radar.rows, ...previousUnresolved], official.rows);
  const aggregatorSource = sources.find((source) => source.id === "poptavky");
  if (aggregatorSource) aggregatorSource.resolved = resolution.rows.filter((row) => row.discoverySource === "poptavky" && row.originStatus === "resolved").length;
  const poptavejSource = sources.find((source) => source.id === "poptavej");
  if (poptavejSource) poptavejSource.resolved = resolution.rows.filter((row) => row.discoverySource === "poptavej" && row.originStatus === "resolved").length;

  return {
    rows: [...official.rows, ...supporting.rows, ...resolution.rows],
    sources,
  };
}

const loadedPrevious = await loadJson(OUTPUT, { schemaVersion: 1, tenders: [] });
const demoIds = new Set(["zakazky-gov:RVZ-DEMO-001", "manual:DEMO-002", "manual:DEMO-003"]);
const previous = fixturesMode
  ? { ...loadedPrevious, tenders: [] }
  : { ...loadedPrevious, tenders: loadedPrevious.tenders.filter((tender) => !demoIds.has(tender.id)) };
const { rows, sources } = await collect(previous);
const previousById = new Map(previous.tenders.map((tender) => [tender.id, tender]));
const normalized = rows.map((row) => {
  const draft = normalizeTender(row, now);
  const old = previousById.get(draft.id);
  return old ? { ...draft, firstSeenAt: old.firstSeenAt } : draft;
});
// Radarové položky už prošly novým pokusem o dohledání originálu výše.
// Starou kopii nepřidáváme znovu, jinak by po úspěšném spojení zůstal i placený agregátorový duplikát.
const previousNormalized = previous.tenders
  .filter((tender) => !isAggregatorSource(tender.source))
  .map((tender) => normalizeTender(tender, now));
const tenders = deduplicateTenders([...previousNormalized, ...normalized])
  .map((tender) => ({ ...tender, relevance: scoreTender(tender, now) }))
  .filter((tender) => tender.relevance.score >= PROJECT.minimumScore)
  .filter((tender) => {
    const historyDays = tender.opportunityType === "market-signal" ? PROJECT.signalHistoryDays : PROJECT.historyDays;
    const itemCutoff = new Date(now.valueOf() - historyDays * 86_400_000);
    if (tender.deadline) return new Date(tender.deadline) >= itemCutoff;
    return new Date(tender.publishedAt || tender.firstSeenAt) >= itemCutoff;
  })
  .sort((a, b) => b.relevance.score - a.relevance.score || String(a.deadline).localeCompare(String(b.deadline)))
  .slice(0, 400);

const dataset = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  project: PROJECT.name,
  filters: { minimumScore: PROJECT.minimumScore, historyDays: PROJECT.historyDays },
  stats: {
    total: tenders.length,
    newThisRun: tenders.filter((tender) => tender.firstSeenAt === tender.lastSeenAt).length,
    strong: tenders.filter((tender) => tender.relevance.level === "strong").length,
    closingSoon: tenders.filter((tender) => tender.relevance.deadlineDays >= 0 && tender.relevance.deadlineDays <= 7).length,
    unresolvedOrigin: tenders.filter((tender) => tender.originStatus === "unresolved").length,
  },
  sources,
  tenders,
};

validateDataset(dataset);
await mkdir("public/data", { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Uloženo ${tenders.length} relevantních zakázek (${dataset.stats.newThisRun} nových).`);
for (const source of sources) {
  console.log(`${source.ok ? "✓" : "!"} ${source.id}: ${source.count || 0}${source.error ? ` — ${source.error}` : ""}`);
}
