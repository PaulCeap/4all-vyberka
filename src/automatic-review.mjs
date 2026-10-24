import { spawn } from "node:child_process";
import { assessScope } from "./scope.mjs";
import { cleanText, searchable } from "./model.mjs";
import { extractBudget } from "./assessment.mjs";
import { REVIEW_VERSION } from "./document-review.mjs";

const MAX_BATCH = 8;
const ADMIN = /cestne prohlasen|kryci list|osobni udaj|obchodni rejstrik|podpisove pravo|elektronick[a-z]* podpis|bankovni spojeni|zadavatel si vyhrazuje|je opravnen predlozit|rovnocenny doklad|referencni.{0,20}prostredi|nen-ref\.nipez/i;
const PRICE = /(?:cen|hodnot).{0,90}\d[\d\s.,]*\s*(?:kc|eur|milion|mil\.)/i;
const QUALIFICATION = /(?:minimalne|alespon|nejmene|pozadovan).{0,90}(?:referenc|vyznamn.{0,12}zakazk|obrat)/i;
const EVALUATION = /(?:hodnotic.{0,20}kriter|vah.{0,20}kriter).{0,90}\d{1,3}\s*%/i;

export function isCurrentReviewCandidate(tender, now, historyDays = 45, openNoDeadlineDays = 365) {
  if (tender.status === "closed") return false;
  if (tender.deadline) return new Date(tender.deadline) > now;
  const published = new Date(tender.publishedAt || tender.firstSeenAt || 0);
  const allowedDays = tender.status === "open" ? openNoDeadlineDays : historyDays;
  return Number.isFinite(published.valueOf()) &&
    published <= now && published >= new Date(now.valueOf() - allowedDays * 86_400_000);
}

export function buildExtractiveNote(tender, extracted, now = new Date()) {
  const choices = [];
  for (const document of extracted) {
    if (!document.text) continue;
    const paragraphs = document.text.split(/\n\s*\n/).flatMap((block) => block.replace(/\n/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])|(?<=\.)\s+(?=\d+\.\d+\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/u));
    for (const paragraph of paragraphs) {
      const text = cleanText(paragraph).replace(/^\d+(?:\.\d+)*\s+/, "");
      if (text.length < 55 || text.length > 1200) continue;
      const plain = searchable(text);
      if (ADMIN.test(plain)) continue;
      if (/zadavaci dokumentace.{0,60}ve smyslu|sidlo:.{0,150}ico|nazev verejne zakazky:.*systemove cislo/.test(plain)) continue;
      const letters = text.replace(/[^A-Za-zÁ-Žá-ž]/gu, "");
      if (letters.length > 40 && letters === letters.toLocaleUpperCase("cs")) continue;
      const scope = assessScope({ title: "", summary: text });
      const service = scope.contentAreas.length > 0;
      const subject = /predmet.{0,35}(zakazk|plneni)|plnenim.{0,25}zakazk/.test(plain);
      const kind = service ? "scope" : PRICE.test(plain) ? "price" :
        QUALIFICATION.test(plain) ? "qualification" : EVALUATION.test(plain) ? "evaluation" : null;
      if (!kind) continue;
      const score = (service ? 50 : 0) + (subject ? 20 : 0) + (kind !== "scope" ? 8 : 0) + Math.min(text.length / 40, 8);
      choices.push({ text, url: document.url, score, service, kind });
    }
  }
  choices.sort((a, b) => b.score - a.score);
  const selected = [];
  const seen = new Set();
  const counts = new Map();
  for (const choice of choices) {
    const key = searchable(choice.text).slice(0, 100);
    if (seen.has(key) || (counts.get(choice.kind) || 0) >= 1) continue;
    seen.add(key);
    counts.set(choice.kind, (counts.get(choice.kind) || 0) + 1);
    selected.push(choice);
    if (selected.length === 4) break;
  }
  if (!selected.some((choice) => choice.service)) return null;
  const subject = selected.find((choice) => choice.service);
  const budget = extractBudget(extracted);
  return {
    reviewedAt: now.toISOString(),
    documentSnapshot: extracted.filter((item) => item.text).map((item) => item.url).sort(),
    method: "automatic-extraction",
    reviewVersion: REVIEW_VERSION,
    summary: subject.text,
    facts: selected.map(({ text, url, kind }) => ({ text, url, kind })),
    ...(budget || {}),
  };
}

function extractDocuments(tender) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["scripts/extract-documents.py"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    const errors = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 5_000_000) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.stdin.on("error", reject);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString("utf8").slice(0, 300) || `Extraktor skončil kódem ${code}`));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Extraktor nevrátil platná data.")); }
    });
    child.stdin.end(JSON.stringify(tender));
  });
}

export async function reviewPendingDocuments(pending, candidates, now = new Date(), { extract = extractDocuments, limit = MAX_BATCH } = {}) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const results = [];
  const notes = {};
  for (const item of pending.slice(0, limit)) {
    try {
      const extracted = await extract(item);
      const candidate = byId.get(item.id);
      const note = buildExtractiveNote(candidate, extracted.documents || [], now);
      const failed = (extracted.documents || []).filter((document) => !document.text);
      const warnings = failed.map((document) => `${document.name || document.url}: ${document.error || "Nelze přečíst"}`);
      if (!note) throw new Error(failed.length ? warnings.join("; ") : "Z přečtených podkladů se nepodařilo potvrdit předmět služby; vyžaduje věcnou kontrolu.");
      // Keep sourced facts from readable documents, but never label an
      // incomplete set as completely reviewed or remove its retry.
      notes[item.id] = { ...note, documentSnapshot: item.documents.map((d) => d.url).sort(),
        complete: failed.length === 0, warnings };
      results.push({ id: item.id, status: failed.length ? "partial" : "reviewed", facts: note.facts.length,
        error: warnings.length ? warnings.join("; ").slice(0, 350) : null });
    } catch (error) {
      results.push({ id: item.id, status: "failed", error: String(error.message || error).slice(0, 350) });
    }
  }
  for (const item of pending.slice(limit)) results.push({ id: item.id, status: "next-run" });
  return { notes, results };
}
