const CODE = /^N\d{3}\/\d{2}\/[A-Z]\d+$/;
const URL_CODE = /https:\/\/nen\.nipez\.cz\/verejne-zakazky\/detail-zakazky\/(N\d{3}-\d{2}-[A-Z]\d+)(?=[:/\s]|$)/;

export function nenDetailUrl(code) {
  return CODE.test(code || "")
    ? `https://nen.nipez.cz/verejne-zakazky/detail-zakazky/${code.replaceAll("/", "-")}` : null;
}

// Persist failed details independently of tomorrow's search results. URLs are
// rebuilt from validated NEN codes rather than fetched from stored messages.
export function restoreNenRetries(source = {}, now = new Date()) {
  const queue = new Map();
  for (const entry of source.retryQueue || []) {
    const url = nenDetailUrl(entry.code);
    if (!url) continue;
    queue.set(entry.code, { ...entry, url });
  }
  // One-time migration of failures saved by the previous collector version.
  if (!Array.isArray(source.retryQueue)) for (const warning of source.warnings || []) {
    const code = String(warning).match(URL_CODE)?.[1]?.replaceAll("-", "/");
    const url = nenDetailUrl(code);
    if (!url || queue.has(code)) continue;
    queue.set(code, { code, url, title: `NEN ${code}`, summary: { kod: code },
      attempts: 1, firstFailedAt: now.toISOString(), lastAttemptAt: null,
      error: String(warning).slice(0, 500) });
  }
  return queue;
}

export function selectNenRetries(queue, limit = 20) {
  return [...queue.values()].sort((a, b) =>
    String(a.lastAttemptAt || "").localeCompare(String(b.lastAttemptAt || "")) || a.code.localeCompare(b.code)
  ).slice(0, Math.max(0, limit));
}

export function removeRefreshedNenRetries(source, refreshedRows) {
  // A saved detail can recover in the later profile refresh of the same run.
  // A retained stale row must never be mistaken for successful retrieval.
  const recovered = new Set(refreshedRows.filter((row) => row.source === "nen" && row.profileFetchError === null)
    .map((row) => row.sourceId));
  return { ...source, retryQueue: (source.retryQueue || []).filter((entry) => !recovered.has(entry.code)) };
}

export function failedNenDetail(summary, error, old, now) {
  const code = summary.kod;
  const url = nenDetailUrl(code);
  const message = String(error.message || error);
  return { code, url, title: summary.nazev || old?.title || `NEN ${code}`,
    summary: { kod: code, nazev: summary.nazev, zadavatelNazev: summary.zadavatelNazev,
      podaniLhuta: summary.podaniLhuta },
    attempts: (old?.attempts || 0) + 1, firstFailedAt: old?.firstFailedAt || now.toISOString(),
    lastAttemptAt: now.toISOString(), error: (message.startsWith(`${url}: `) ? message.slice(url.length + 2) : message).slice(0, 500) };
}
