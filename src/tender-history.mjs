import { PROJECT } from "./config.mjs";
import { deduplicateTenders } from "./deduplicate.mjs";
import { normalizeTender } from "./model.mjs";
import { scoreTender } from "./scoring.mjs";
import { isAggregatorSource } from "./origin-resolver.mjs";
import { isWithinHistory } from "./history.mjs";

export function prepareTenders(rows, previous, now) {
  const previousById = new Map(previous.tenders.map((tender) => [tender.id, tender]));
  const normalized = rows.map((row) => {
    const draft = normalizeTender(row, now);
    const old = previousById.get(draft.id);
    return old ? { ...draft, firstSeenAt: old.firstSeenAt } : draft;
  });
  // Radarové položky už prošly novým pokusem o dohledání originálu výše.
  // Starou kopii nepřidáváme znovu, jinak by po úspěšném spojení zůstal i placený agregátorový duplikát.
  const currentKeys = new Set(normalized.map((tender) => `${tender.source}:${tender.sourceId}`));
  const previousNormalized = previous.tenders
    .filter((tender) => !isAggregatorSource(tender.source))
    .filter((tender) => !currentKeys.has(`${tender.source}:${tender.sourceId}`))
    .map((tender) => normalizeTender(tender, now));
  return deduplicateTenders([...previousNormalized, ...normalized])
    .map((tender) => ({ ...tender, relevance: scoreTender(tender, now) }))
    .filter((tender) => tender.relevance.score >= PROJECT.minimumScore)
    .filter((tender) => isWithinHistory(tender, now))
    .sort((a, b) => b.relevance.score - a.relevance.score || String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 400);
}

export function countNewTenders(tenders, now) {
  return tenders.filter((tender) => tender.firstSeenAt === now.toISOString()).length;
}
