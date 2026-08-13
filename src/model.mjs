import { createHash } from "node:crypto";

export function cleanText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchable(value = "") {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs");
}

export function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function tenderFingerprint(tender) {
  const genericBuyer = /^(neuveden|zadavatel z)/i.test(cleanText(tender.buyer));
  const basis = [
    tender.buyer,
    tender.title,
    tender.deadline?.slice(0, 10),
    genericBuyer ? `${tender.source}:${tender.sourceId}` : "",
  ]
    .map(searchable)
    .join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 20);
}

export function normalizeTender(input, now = new Date()) {
  const source = cleanText(input.source || "manual").toLowerCase();
  const sourceId = cleanText(input.sourceId || input.externalId || input.id);
  const title = cleanText(input.title);
  const buyer = cleanText(input.buyer || "Neuvedený zadavatel");
  const aggregatorSource = source === "poptavky" || source === "poptavej";
  const suppliedOriginStatus = cleanText(input.originStatus || "").toLowerCase();

  if (!sourceId || !title) {
    throw new Error("Zakázka musí obsahovat sourceId a title.");
  }

  const tender = {
    id: `${source}:${sourceId}`,
    source,
    sourceId,
    url: String(input.url || "").trim(),
    title,
    buyer,
    summary: cleanText(input.summary || input.description || ""),
    country: input.country || "CZ",
    region: cleanText(input.region || "Česko"),
    publishedAt: isoOrNull(input.publishedAt),
    deadline: isoOrNull(input.deadline),
    value: input.value?.amount
      ? { amount: Number(input.value.amount), currency: input.value.currency || "CZK" }
      : null,
    cpv: [...new Set((input.cpv || []).map((code) => cleanText(code).replace(/\D/g, "").slice(0, 8)).filter(Boolean))],
    procedureType: cleanText(input.procedureType || "Neuvedeno"),
    opportunityType: cleanText(input.opportunityType || "public-tender"),
    firstSeenAt: isoOrNull(input.firstSeenAt) || now.toISOString(),
    lastSeenAt: isoOrNull(input.lastSeenAt) || now.toISOString(),
    status: input.status || "open",
    discoverySource: cleanText(input.discoverySource || "").toLowerCase() || null,
    discoveryUrl: String(input.discoveryUrl || "").trim() || null,
    originStatus: aggregatorSource && suppliedOriginStatus !== "resolved"
      ? "unresolved"
      : suppliedOriginStatus || "verified",
    originConfidence: Number.isFinite(Number(input.originConfidence)) ? Number(input.originConfidence) : null,
  };

  tender.fingerprint = tenderFingerprint(tender);
  return tender;
}

export function validateDataset(dataset) {
  if (!dataset || dataset.schemaVersion !== 1 || !Array.isArray(dataset.tenders)) {
    throw new Error("Neplatný datový soubor zakázek.");
  }
  const ids = new Set();
  for (const tender of dataset.tenders) {
    for (const key of ["id", "title", "buyer", "source", "fingerprint"]) {
      if (!tender[key]) throw new Error(`Zakázce chybí pole ${key}.`);
    }
    if (ids.has(tender.id)) throw new Error(`Duplicitní id ${tender.id}.`);
    ids.add(tender.id);
    if (typeof tender.relevance?.score !== "number") {
      throw new Error(`Zakázce ${tender.id} chybí relevance.score.`);
    }
  }
  return true;
}
