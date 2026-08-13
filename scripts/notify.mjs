import { readFile } from "node:fs/promises";
import { buildNotification, sendNotification } from "../src/notification.mjs";

const dataset = JSON.parse(await readFile("public/data/tenders.json", "utf8"));
const recipients = String(process.env.ALERT_EMAILS || "")
  .split(/[,;]/)
  .map((value) => value.trim())
  .filter(Boolean);
const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM;
const dryRun = process.argv.includes("--dry-run");
const message = buildNotification(dataset);

if (message.count === 0) {
  console.log("Žádné nové příležitosti — e-mail se neposílá.");
} else if (dryRun) {
  console.log(`${message.subject}\n${message.text}`);
} else if (!apiKey || !from || recipients.length === 0) {
  console.log("E-mailové upozornění není nakonfigurované — chybí RESEND_API_KEY, RESEND_FROM nebo ALERT_EMAILS.");
} else {
  const result = await sendNotification({ dataset, apiKey, from, recipients });
  console.log(`Odesláno upozornění na ${recipients.length} adres (${result.count} nových, ID ${result.id}).`);
}
