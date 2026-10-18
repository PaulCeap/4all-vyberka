import { PROJECT } from "./config.mjs";
import { deduplicateTenders } from "./deduplicate.mjs";
import { normalizeTender, validateDataset } from "./model.mjs";
import { scoreTender } from "./scoring.mjs";
import { isAggregatorSource, sourceFromOfficialUrl } from "./origin-resolver.mjs";

const OFFICIAL_SOURCES = new Set([
  "zakazky-gov", "tenderarena", "nen", "ted", "ezak-jmk", "ezak-sz",
  "official-profile", "official-web", "proebiz",
]);

export function buildDataset({ rows, sources, previous, now, fixturesMode = false, project = PROJECT }) {
  const previousTenders = previous?.tenders || [];
  const previousById = new Map(previousTenders.map((tender) => [tender.id, tender]));
  const normalized = [];
  const invalidRows = [];

  for (const row of rows) {
    if (!fixturesMode && (isAggregatorSource(row?.source) || row?.originStatus === "unresolved")) continue;
    try {
      const draft = normalizeTender(row, now);
      const old = previousById.get(draft.id);
      normalized.push(old ? { ...draft, firstSeenAt: old.firstSeenAt } : draft);
    } catch (error) {
      invalidRows.push({ source: row?.source || "unknown", error: error.message });
    }
  }

  if (!fixturesMode && !normalized.some((tender) => OFFICIAL_SOURCES.has(tender.source))) {
    throw new Error("Oficiální zdroje nevrátily žádnou použitelnou zakázku; předchozí data zůstávají beze změny.");
  }

  const currentKeys = new Set(normalized.map((tender) => tender.id));
  const previousNormalized = previousTenders
    .filter((tender) => !isAggregatorSource(tender.source))
    .filter((tender) => !tender.discoverySource ||
      (sourceFromOfficialUrl(tender.url) && !/^(neuveden|zadavatel z)/i.test(tender.buyer || "")))
    .filter((tender) => !currentKeys.has(tender.id))
    .map((tender) => normalizeTender(tender, now));
  const tenders = deduplicateTenders([...previousNormalized, ...normalized])
    .map((tender) => ({ ...tender, relevance: scoreTender(tender, now) }))
    .filter((tender) => tender.relevance.score >= project.minimumScore)
    .filter((tender) => {
      if (tender.status === "closed") return false;
      if (tender.deadline) return new Date(tender.deadline).valueOf() > now.valueOf();
      const historyDays = tender.opportunityType === "market-signal" ? project.signalHistoryDays :
        tender.status === "open" ? project.openNoDeadlineDays : project.historyDays;
      const itemCutoff = now.valueOf() - historyDays * 86_400_000;
      return new Date(tender.publishedAt || tender.firstSeenAt).valueOf() >= itemCutoff;
    })
    .sort((a, b) => b.relevance.score - a.relevance.score || String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 400);

  const dataset = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    project: project.name,
    filters: { minimumScore: project.minimumScore, historyDays: project.historyDays },
    stats: {
      total: tenders.length,
      newThisRun: tenders.filter((tender) => tender.firstSeenAt === tender.lastSeenAt).length,
      strong: tenders.filter((tender) => tender.relevance.level === "strong").length,
      closingSoon: tenders.filter((tender) => {
        const days = tender.relevance.deadlineDays;
        return Number.isFinite(days) && days >= 0 && days <= 7;
      }).length,
      unresolvedOrigin: tenders.filter((tender) => tender.originStatus === "unresolved").length,
      invalidRows: invalidRows.length,
    },
    sources,
    tenders,
  };

  validateDataset(dataset);
  return { dataset, invalidRows };
}
