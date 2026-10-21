import { PROJECT, TED_SEARCH_URL } from "../config.mjs";

function i18n(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const selected = value.ces ?? value.eng ?? Object.values(value)[0];
  return Array.isArray(selected) ? selected.join(" ") : selected || "";
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

const FIELDS = [
    "publication-number", "publication-date", "form-type", "notice-title", "buyer-name",
    "classification-cpv", "description-proc", "description-lot",
    "deadline-receipt-tender-date-lot", "deadline-receipt-tender-time-lot",
    "buyer-profile", "document-url-lot", "estimated-value-proc", "estimated-value-cur-proc",
    "contract-nature", "procedure-type",
];

function deadlineFromNotice(row) {
  const date = (row["deadline-receipt-tender-date-lot"] || []).filter(Boolean).sort()[0];
  const time = (row["deadline-receipt-tender-time-lot"] || []).filter(Boolean).sort()[0];
  if (!date) return null;
  if (!time) return date;
  return `${date.slice(0, 10)}T${time}`;
}

export function parseTedNotice(row) {
  const deadline = deadlineFromNotice(row);
  const descriptions = [i18n(row["description-proc"]), i18n(row["description-lot"])].filter(Boolean);
  const value = Number(row["estimated-value-proc"]);
  return {
    source: "ted",
    sourceId: row["publication-number"],
    url: row.links?.html?.CES || row.links?.htmlDirect?.CES || `https://ted.europa.eu/cs/notice/-/detail/${row["publication-number"]}`,
    title: i18n(row["notice-title"]).replace(/^Česko\s*[–-]\s*[^–-]+\s*[–-]\s*/i, ""),
    buyer: i18n(row["buyer-name"]),
    summary: [...new Set(descriptions)].join(" "),
    country: "CZ",
    region: "Česko",
    publishedAt: row["publication-date"],
    deadline,
    deadlineTimeKnown: Boolean((row["deadline-receipt-tender-time-lot"] || []).length ||
      /T\d{2}:\d{2}/.test(String(deadline || ""))),
    value: Number.isFinite(value) && value > 0
      ? { amount: value, currency: row["estimated-value-cur-proc"] || "CZK" }
      : null,
    cpv: row["classification-cpv"] || [],
    procedureType: Array.isArray(row["contract-nature"])
      ? row["contract-nature"].join(", ")
      : row["procedure-type"] || "Veřejná zakázka",
    candidateProfileUrls: [...new Set([
      ...(row["document-url-lot"] || []), ...(row["buyer-profile"] || []),
    ].filter((url) => {
      try { return new URL(url).protocol === "https:"; } catch { return false; }
    }))],
    status: "open",
  };
}

async function searchTed(query, { fetchImpl = fetch, page = 1, limit = 250 } = {}) {
  const response = await fetchImpl(TED_SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "4ALL-vyberka/1.0 (hello@4all.cz)" },
    body: JSON.stringify({ query, fields: FIELDS, limit, page }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`TED odpověděl ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload?.notices)) throw new Error("TED změnil formát odpovědi.");
  return payload.notices;
}

export async function fetchTedNotice(publicationNumber, { fetchImpl = fetch } = {}) {
  if (!/^\d{6}-\d{4}$/.test(publicationNumber)) return null;
  const notices = await searchTed(`publication-number = ${publicationNumber}`, { fetchImpl, limit: 10 });
  const row = notices.find((notice) => notice["publication-number"] === publicationNumber);
  return row ? parseTedNotice(row) : null;
}

export async function fetchTed({ now = new Date(), fetchImpl = fetch } = {}) {
  const since = new Date(now.valueOf() - PROJECT.tedLookbackDays * 86_400_000);
  const recoverySince = new Date(now.valueOf() - PROJECT.historyDays * 86_400_000);
  const queries = [`publication-date >= ${compactDate(since)} AND buyer-country = CZE AND form-type = competition`];
  // Event notices often use Czech administrative wording rather than "event".
  // Revisit older notices after a missed run or a relevance-rule correction.
  if (recoverySince < since) {
    const eventCodes = ["79950000", "79951000", "79952000"];
    queries.push(`publication-date >= ${compactDate(recoverySince)} AND publication-date < ${compactDate(since)} AND buyer-country = CZE AND form-type = competition AND (${eventCodes.map((code) => `classification-cpv = ${code}`).join(" OR ")})`);
  }
  const tenders = new Map();
  for (const [index, query] of queries.entries()) {
    try {
      for (let page = 1; page <= 4; page += 1) {
        const notices = await searchTed(query, { fetchImpl, page });
        for (const row of notices) {
          const tender = parseTedNotice(row);
          tenders.set(tender.sourceId, tender);
        }
        if (notices.length < 250) break;
      }
    } catch (error) {
      if (index === 0) throw error;
      console.warn(`TED: zpětná kontrola akcí selhala: ${error.message}`);
    }
  }
  return [...tenders.values()];
}
