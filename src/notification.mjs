const SITE_URL = "https://vyberka.4all.cz/";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function formatDate(value) {
  if (!value) return "neuvedeno";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Prague",
  }).format(new Date(value));
}

function formatMoney(value) {
  if (!value?.amount) return "hodnota neuvedena";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency", currency: value.currency || "CZK", maximumFractionDigits: 0,
  }).format(value.amount);
}

function countLabel(count) {
  if (count === 1) return "1 nová příležitost";
  if (count >= 2 && count <= 4) return `${count} nové příležitosti`;
  return `${count} nových příležitostí`;
}

function truncate(value, length = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= length ? text : `${text.slice(0, length).trimEnd()}…`;
}

export function selectNewTenders(dataset) {
  return (dataset.tenders || []).filter((tender) =>
    tender.firstSeenAt && tender.firstSeenAt === tender.lastSeenAt);
}

export function buildNotification(dataset) {
  const allNew = selectNewTenders(dataset);
  const shown = allNew.slice(0, 12);
  const hiddenCount = allNew.length - shown.length;
  const title = countLabel(allNew.length);
  const subject = `4ALL Výběrka: ${title}`;
  const rows = shown.map((tender) => {
    const categories = (tender.relevance?.categories || []).map((item) => item.label).join(" · ");
    return `
      <tr><td style="padding:0 0 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #d8d2c8">
          <tr>
            <td width="72" valign="top" style="padding:22px 16px 0 0">
              <div style="width:58px;height:58px;line-height:58px;border-radius:50%;background:#ff7043;color:#171717;text-align:center;font:800 21px/58px Arial,sans-serif">${escapeHtml(tender.relevance?.score ?? "—")}</div>
            </td>
            <td valign="top" style="padding:22px 0 0">
              <div style="margin-bottom:7px;color:#6d6a64;font:700 10px/1.4 Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase">${escapeHtml(categories || "Příležitost")}</div>
              <a href="${escapeHtml(tender.url)}" style="color:#171717;text-decoration:none;font:800 22px/1.1 Arial,sans-serif;letter-spacing:-.03em">${escapeHtml(tender.title)}</a>
              <div style="margin-top:7px;color:#2b5672;font:700 14px/1.4 Arial,sans-serif">${escapeHtml(tender.buyer)}</div>
              <p style="margin:12px 0;color:#5a5752;font:400 14px/1.55 Arial,sans-serif">${escapeHtml(truncate(tender.summary))}</p>
              <div style="color:#6d6a64;font:400 12px/1.5 Arial,sans-serif">Termín: <strong style="color:#171717">${escapeHtml(formatDate(tender.deadline))}</strong> &nbsp;·&nbsp; Hodnota: <strong style="color:#171717">${escapeHtml(formatMoney(tender.value))}</strong></div>
              <a href="${escapeHtml(tender.url)}" style="display:inline-block;margin-top:13px;color:#2b5672;font:800 13px/1.4 Arial,sans-serif;text-underline-offset:4px">Otevřít originální zdroj ↗</a>
            </td>
          </tr>
        </table>
      </td></tr>`;
  }).join("");

  const more = hiddenCount > 0
    ? `<p style="margin:8px 0 24px;color:#6d6a64;font:400 14px/1.5 Arial,sans-serif">A dalších ${hiddenCount} najdete v kompletním přehledu.</p>`
    : "";
  const html = `<!doctype html><html lang="cs"><body style="margin:0;background:#f4f0e8;color:#171717">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f4f0e8"><tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;border-collapse:collapse">
        <tr><td style="padding:28px 30px;background:#171717;color:#fffdf8">
          <div style="font:900 24px/1 Arial,sans-serif">4ALL <span style="padding:0 10px;color:#6d6a64;font-weight:400">|</span> <span style="font:700 12px/1 Arial,sans-serif;letter-spacing:.16em">VÝBĚRKA</span></div>
          <h1 style="margin:38px 0 10px;font:800 46px/.92 Arial,sans-serif;letter-spacing:-.055em">${escapeHtml(title)}.<br><span style="color:#ff7043;font-family:Georgia,serif;font-weight:400">Bez šumu.</span></h1>
          <p style="margin:24px 0 0;color:#c9c5bd;font:400 15px/1.5 Arial,sans-serif">Denní agent našel nové položky odpovídající službám 4ALL.</p>
        </td></tr>
        <tr><td style="padding:30px;background:#fffdf8">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>
          ${more}
          <a href="${SITE_URL}" style="display:inline-block;margin-top:8px;padding:13px 18px;background:#171717;color:#fffdf8;text-decoration:none;font:800 14px/1 Arial,sans-serif">Otevřít celý přehled</a>
        </td></tr>
        <tr><td style="padding:22px 30px;color:#6d6a64;font:400 11px/1.5 Arial,sans-serif">Automatické upozornění 4ALL Výběrka. E-mail odchází pouze při nálezu nové relevantní příležitosti.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  const textRows = shown.map((tender) => [
    `${tender.relevance?.score ?? "—"}/100 — ${tender.title}`,
    tender.buyer,
    `Termín: ${formatDate(tender.deadline)} · Hodnota: ${formatMoney(tender.value)}`,
    tender.url,
  ].join("\n")).join("\n\n");
  const text = `${title}\n\n${textRows}${hiddenCount > 0 ? `\n\nA dalších ${hiddenCount}: ${SITE_URL}` : `\n\nCelý přehled: ${SITE_URL}`}`;
  return { count: allNew.length, subject, html, text };
}

export async function sendNotification({ dataset, apiKey, from, recipients, fetchImpl = fetch }) {
  const message = buildNotification(dataset);
  if (message.count === 0) return { sent: false, reason: "no-new-tenders" };

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `4all-vyberka-${dataset.generatedAt}`,
      "user-agent": "4ALL-vyberka/1.0 (hello@4all.cz)",
    },
    body: JSON.stringify({ from, to: recipients, subject: message.subject, html: message.html, text: message.text }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Odeslání upozornění selhalo (${response.status}): ${payload.message || "neznámá chyba"}`);
  return { sent: true, id: payload.id, count: message.count };
}
