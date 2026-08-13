function richness(tender) {
  return (tender.summary?.length || 0) + (tender.cpv?.length || 0) * 40 + (tender.value ? 100 : 0);
}

function mergeTender(primary, secondary) {
  const richer = richness(secondary) > richness(primary) ? secondary : primary;
  return {
    ...primary,
    summary: richer.summary || primary.summary,
    cpv: [...new Set([...(primary.cpv || []), ...(secondary.cpv || [])])],
    value: primary.value || secondary.value,
    deadline: primary.deadline || secondary.deadline,
    publishedAt: primary.publishedAt || secondary.publishedAt,
    firstSeenAt: [primary.firstSeenAt, secondary.firstSeenAt].filter(Boolean).sort()[0],
    lastSeenAt: [primary.lastSeenAt, secondary.lastSeenAt].filter(Boolean).sort().at(-1),
    discoverySource: primary.discoverySource || secondary.discoverySource || null,
    discoveryUrl: primary.discoveryUrl || secondary.discoveryUrl || null,
    originStatus: primary.originStatus === "resolved" || secondary.originStatus === "resolved"
      ? "resolved"
      : primary.originStatus || secondary.originStatus,
    originConfidence: Math.max(primary.originConfidence || 0, secondary.originConfidence || 0) || null,
    duplicateSources: [...new Set([
      ...(primary.duplicateSources || [primary.source]),
      ...(secondary.duplicateSources || [secondary.source]),
    ])],
  };
}

export function deduplicateTenders(tenders) {
  const bySourceId = new Map();
  for (const tender of tenders) {
    const key = `${tender.source}:${tender.sourceId}`;
    bySourceId.set(key, bySourceId.has(key) ? mergeTender(bySourceId.get(key), tender) : tender);
  }

  const byFingerprint = new Map();
  for (const tender of bySourceId.values()) {
    const key = tender.fingerprint;
    byFingerprint.set(key, byFingerprint.has(key) ? mergeTender(byFingerprint.get(key), tender) : tender);
  }
  return [...byFingerprint.values()];
}
