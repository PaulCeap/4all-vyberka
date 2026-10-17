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

const pragueOffset = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Prague", timeZoneName: "shortOffset",
});

function offsetMinutes(timestamp) {
  const label = pragueOffset.formatToParts(new Date(timestamp))
    .find((part) => part.type === "timeZoneName")?.value || "";
  const match = label.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Nelze určit časové pásmo: ${label}`);
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0));
}

export function czechDate(value, endOfDay = false) {
  const match = String(value).match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const localHour = hour === undefined ? (endOfDay ? 23 : 12) : Number(hour);
  const localMinute = minute === undefined ? (endOfDay ? 59 : 0) : Number(minute);
  const local = Date.UTC(Number(year), Number(month) - 1, Number(day), localHour, localMinute);
  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() + 1 !== Number(month)
    || check.getUTCDate() !== Number(day) || localHour > 23 || localMinute > 59) return null;
  let utc = local - offsetMinutes(local) * 60_000;
  utc = local - offsetMinutes(utc) * 60_000;
  return new Date(utc).toISOString();
}

export function money(value = "") {
  const match = plainText(value).match(/([\d\s\u00a0\u202f]+)\s*(Kč|CZK)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/\D/g, ""));
  return amount ? { amount, currency: "CZK" } : null;
}

export async function getText(url, { fetchImpl = fetch, retries = 1, timeoutMs = 20_000, retryDelayMs = 350 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "4ALL-Vyberka/1.0 (+https://vyberka.4all.cz)" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const error = new Error(`${url}: HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.text();
    } catch (error) {
      if (attempt === retries || error.status && ![408, 429].includes(error.status) && error.status < 500) throw error;
      if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
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
