import { cleanText } from "../model.mjs";

export function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function plainText(value = "") {
  return cleanText(decodeHtml(value));
}

export function czechDate(value, endOfDay = false) {
  const match = String(value).match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day),
    hour === undefined ? (endOfDay ? 21 : 10) : Number(hour) - 2,
    minute === undefined ? (endOfDay ? 59 : 0) : Number(minute)));
  return date.toISOString();
}

export function money(value = "") {
  const match = plainText(value).match(/([\d\s\u00a0\u202f]+)\s*(Kč|CZK)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/\D/g, ""));
  return amount ? { amount, currency: "CZK" } : null;
}

export async function getText(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "4ALL-Vyberka/1.0 (+https://vyberka.4all.cz)" },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

export async function mapLimited(items, worker, limit = 6) {
  const result = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        const value = await worker(item);
        if (value) result.push(value);
      } catch {
        // Jeden nedostupný detail nesmí zastavit celý denní sběr.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result;
}
