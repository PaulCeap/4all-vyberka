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

export async function fetchTed({ now = new Date(), fetchImpl = fetch } = {}) {
  const since = new Date(now.valueOf() - PROJECT.tedLookbackDays * 86_400_000);
  const query = `publication-date >= ${compactDate(since)} AND buyer-country = CZE AND form-type = competition`;
  const fields = [
    "publication-number", "publication-date", "form-type", "notice-title", "buyer-name",
    "classification-cpv", "description-proc", "description-lot",
    "deadline-receipt-tender-date-lot", "estimated-value-proc", "estimated-value-cur-proc",
    "contract-nature", "procedure-type",
  ];
  const tenders = [];
  for (let page = 1; page <= 4; page += 1) {
    const response = await fetchImpl(TED_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "4ALL-vyberka/1.0 (hello@4all.cz)" },
      body: JSON.stringify({ query, fields, limit: 250, page }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`TED odpověděl ${response.status}.`);
    const payload = await response.json();
    for (const row of payload.notices || []) {
      const deadline = (row["deadline-receipt-tender-date-lot"] || []).filter(Boolean).sort()[0] || null;
      const descriptions = [i18n(row["description-proc"]), i18n(row["description-lot"])].filter(Boolean);
      const value = Number(row["estimated-value-proc"]);
      tenders.push({
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
        value: Number.isFinite(value) && value > 0
          ? { amount: value, currency: row["estimated-value-cur-proc"] || "CZK" }
          : null,
        cpv: row["classification-cpv"] || [],
        procedureType: Array.isArray(row["contract-nature"])
          ? row["contract-nature"].join(", ")
          : row["procedure-type"] || "Veřejná zakázka",
        status: "open",
      });
    }
    if ((payload.notices || []).length < 250) break;
  }
  return tenders;
}
