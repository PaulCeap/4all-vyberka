import { createHash } from "node:crypto";
import { reviewSnapshot } from "./document-review.mjs";
import { scoreTender } from "./scoring.mjs";
import { normalizeTender } from "./model.mjs";

export const PROCESSING_VERSION = "2026-10-24-2";
const timestamp = (now) => now.toISOString();
const later = (now, hours) => new Date(now.valueOf() + hours * 3600_000).toISOString();
const key = (row) => row.id || `${row.source}:${row.sourceId}`;
const signature = (row) => createHash("sha256").update(JSON.stringify([
  PROCESSING_VERSION, row.title, row.summary, row.deadline, reviewSnapshot(row.documents),
])).digest("hex");

export function dueReviews(pending, candidates, previous = {}, now = new Date()) {
  const old = new Map((previous.tenders || []).map((row) => [row.id, row]));
  const byId = new Map(candidates.map((row) => [row.id, row]));
  return pending.filter((item) => {
    const saved = old.get(item.id);
    if (!saved || saved.signature !== signature(byId.get(item.id) || item)) return true;
    return saved.status !== "needs-review" && (!saved.nextAttemptAt || new Date(saved.nextAttemptAt) <= now);
  }).sort((a, b) => String(old.get(a.id)?.lastAttemptAt || "").localeCompare(String(old.get(b.id)?.lastAttemptAt || "")) || a.id.localeCompare(b.id));
}

export function buildReviewState({ candidates, remaining, results, sourceErrors = [], previous = {}, now }) {
  const old = new Map((previous.tenders || []).map((row) => [row.id, row]));
  const current = new Map(candidates.map((row) => [row.id, row]));
  const outstanding = new Map(remaining.map((row) => [row.id, row]));
  const attempted = new Map(results.map((row) => [row.id, row]));
  const errors = new Map(sourceErrors.map((row) => [row.id, row]));
  const entries = [];
  for (const id of new Set([...old.keys(), ...current.keys(), ...errors.keys()])) {
    const saved = old.get(id) || {};
    const candidate = current.get(id) || { ...saved, ...errors.get(id) };
    const result = attempted.get(id);
    const sourceError = errors.get(id);
    const sig = signature(candidate);
    const same = saved.signature === sig;
    let attempts = same ? saved.attempts || 0 : 0;
    let status = "reviewed", error = null, nextAttemptAt = null;
    let lastAttemptAt = same ? saved.lastAttemptAt || null : null;
    if (outstanding.has(id) || sourceError) {
      if (result && result.status !== "next-run" || sourceError) { attempts += 1; lastAttemptAt = timestamp(now); }
      error = [result?.error, sourceError?.error].filter(Boolean).join("; ") || (same ? saved.error : null);
      if (error) {
        status = attempts >= 3 ? "needs-review" : "retry";
        nextAttemptAt = status === "retry" ? later(now, Math.min(24, 2 ** attempts)) : null;
        if (!result && !sourceError && same) nextAttemptAt = saved.nextAttemptAt;
      } else status = "pending";
    } else if (current.has(id) && !reviewSnapshot(candidate.documents).length && !candidate.factsReviewedAt) {
      status = "needs-review";
      error = "Zdroj nemá dostupné rozpoznané věcné přílohy. Posouzení vychází jen z popisu zadání.";
    } else if (!current.has(id)) {
      status = candidate.deadline && new Date(candidate.deadline) <= now ? "expired" : "inactive";
      error = status === "inactive" ? "Zakázka není v aktuálním seznamu kandidátů; předchozí stav zůstal uložený." : null;
    }
    entries.push({ ...candidate, id, signature: sig, status, error, attempts,
      firstQueuedAt: saved.firstQueuedAt || timestamp(now), lastAttemptAt, nextAttemptAt,
      updatedAt: timestamp(now), documents: candidate.documents || outstanding.get(id)?.documents || [] });
  }
  const counts = Object.fromEntries(["pending", "retry", "needs-review", "reviewed", "expired", "inactive"].map((s) => [s, entries.filter((item) => item.status === s).length]));
  return { updatedAt: timestamp(now), counts, reviewedCount: results.filter((r) => r.status === "reviewed").length,
    pendingCount: counts.pending + counts.retry, attentionCount: counts["needs-review"],
    failedCount: entries.filter((item) => item.attempts > 0 && ["retry", "needs-review"].includes(item.status)).length,
    sourceErrors: [...errors.values()], tenders: entries };
}

export function classifyLead(lead, now) {
  if (lead.originStatus === "resolved") return { ...lead, processingStatus: "resolved", processingReason: "Spojeno s ověřeným originálem." };
  if (lead.deadline && new Date(lead.deadline) <= now) return { ...lead, processingStatus: "expired", processingReason: "Lhůta již uplynula." };
  if (new Date(lead.lastSeenAt || lead.firstSeenAt || 0) < new Date(now.valueOf() - 45 * 86400_000)) {
    return { ...lead, processingStatus: "expired", processingReason: "Zdroj tip více než 45 dní nepotvrdil." };
  }
  let score = 0;
  try { score = scoreTender(normalizeTender(lead, now), now, { preliminary: true }).score; } catch { /* invalid tip */ }
  if (score < 42) return { ...lead, preliminaryScore: score, processingStatus: "rejected", processingReason: "Předběžný popis nedokládá službu 4ALL. Znovu se posoudí při změně zdroje nebo pravidel." };
  if (lead.opportunityType === "commercial-demand") return { ...lead, preliminaryScore: score,
    processingStatus: "needs-verification", processingReason: "Komerční poptávka: doplnit ověřeného zadavatele a původní zadání; agregátor je pouze tip." };
  if ((lead.originCheckAttempts || 0) >= 3) return { ...lead, preliminaryScore: score,
    processingStatus: "needs-verification", processingReason: "Originál se nepodařilo jednoznačně ověřit po opakovaných pokusech. Vyžaduje kontrolu zdroje." };
  return { ...lead, preliminaryScore: score, processingStatus: "pending", processingReason: "Čeká na dohledání oficiálního zadání." };
}

export function radarDataset(leads, previous, now) {
  const all = new Map((previous.leads || []).map((row) => [key(row), row]));
  for (const row of leads) all.set(key(row), row);
  const classified = [...all.values()].map((lead) => classifyLead(lead, now));
  const counts = Object.fromEntries(["pending", "resolved", "rejected", "expired", "needs-verification"].map((s) => [s, classified.filter((item) => item.processingStatus === s).length]));
  return { updatedAt: timestamp(now), counts, leads: classified };
}

export function processingOverview(review, radar, sources, published, now) {
  const issues = review.tenders.filter((r) => ["pending", "retry", "needs-review"].includes(r.status)).map((r) => ({
    id: r.id, title: r.title, status: r.status, reason: r.error || "Čeká na přečtení podkladů.",
    url: r.url || null, nextAttemptAt: r.nextAttemptAt, attempts: r.attempts,
    published: published.some((t) => t.id === r.id),
  }));
  const tips = radar.leads.filter((r) => ["pending", "needs-verification"].includes(r.processingStatus)).map((r) => ({
    id: key(r), title: r.title, status: r.processingStatus, reason: r.processingReason,
    url: r.url, attempts: r.originCheckAttempts || 0, published: false,
  }));
  return { updatedAt: timestamp(now), status: issues.length || tips.length || sources.some((s) => !s.ok || s.warnings?.length) ? "attention" : "ok",
    reviews: review.counts || {}, radar: radar.counts || {},
    sources: sources.filter((s) => !s.ok || s.warnings?.length).map((s) => ({ id: s.id,
      error: s.error || `${s.warnings.length} dotazů nebo detailů se nepodařilo načíst; ostatní výsledky byly zpracovány.` })),
    items: [...issues, ...tips],
    history: radar.leads.filter((r) => ["rejected", "expired", "resolved"].includes(r.processingStatus)).map((r) => ({
      id: key(r), title: r.title, status: r.processingStatus, reason: r.processingReason, url: r.url,
    })) };
}
