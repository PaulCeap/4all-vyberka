import { searchable } from "./model.mjs";
export const REVIEW_VERSION = "2026-10-24-2";

function reviewPriority(document) {
  const name = searchable(document.name).replace(/[_-]+/g, " ");
  if (/\.(cer|txt)$/.test(name) ||
      /sifrovac|verejny klic|kryci\w* list|cestn\w* prohlasen|pod-dodavatel|poddodavatel|stret zajmu|sankc|provozni rad|pozadavky na elektronickou komunikaci/.test(name)) return -1;
  if (/vysvetleni|(^|\W)vzd(\W|$)|zmena zadavac/.test(name)) return 95;
  if (/smlouv|ramcov.*dohod/.test(name)) return 55;
  if (/cenov.*kalkulac|rozpocet/.test(name)) return 65;
  if (/priloh/.test(name)) return 60;
  if (/zadavaci dokumentace|(^|\W)zd(\W|$)/.test(name)) return 100;
  if (/pozadavky.*kvalifikac|kvalifikac.*pozadavky/.test(name)) return 90;
  if (/soupis plneni|technick.*specifikac|libreto|vyzva/.test(name)) return 70;
  if (/smlouv|zadani|cenov.*kalkulac|rozpocet/.test(name)) return 55;
  return -1;
}

function documentKey(document) {
  return searchable(document.name)
    .replace(/[_-]+/g, " ")
    .replace(/\.(pdf|docx?|xlsx?|zip)$/, "")
    .replace(/\bfinal\b/g, "")
    .replace(/\bpodepsan\w*\b/g, "")
    .replace(/\s+/g, " ").trim();
}

export function reviewDocuments(documents = [], limit = 3) {
  const ranked = documents
    .map((document, index) => ({ document, index, priority: reviewPriority(document) }))
    .filter(({ priority }) => priority >= 0)
    .sort((a, b) => b.priority - a.priority ||
      Number(/\.pdf$/i.test(b.document.name)) - Number(/\.pdf$/i.test(a.document.name)) ||
      a.index - b.index);
  const seen = new Set();
  return ranked.filter(({ document }) => {
    const key = documentKey(document);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).map(({ document }) => document);
}

export function reviewSnapshot(documents = []) {
  return reviewDocuments(documents).map((document) => document.url).sort();
}

export function pendingDocumentReviews(tenders = [], notes = {}) {
  return tenders.flatMap((tender) => {
    const documents = reviewDocuments(tender.documents);
    if (!documents.length) return [];
    const current = reviewSnapshot(tender.documents);
    const previous = (notes[tender.id]?.documentSnapshot || []).slice().sort();
    const note = notes[tender.id];
    const currentMethod = note?.method !== "automatic-extraction" || note.reviewVersion === REVIEW_VERSION;
    if (JSON.stringify(current) === JSON.stringify(previous) && note?.complete !== false && currentMethod) return [];
    return [{ id: tender.id, title: tender.title, documents: documents.map(({ name, url }) => ({ name, url })) }];
  });
}
