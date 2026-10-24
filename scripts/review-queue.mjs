import { appendFile, readFile } from "node:fs/promises";

const dataset = JSON.parse(await readFile("public/data/tenders.json", "utf8"));
const queue = JSON.parse(await readFile("data/review-queue.json", "utf8"));
const processing = dataset.processing || {};
console.log(JSON.stringify({ published: dataset.tenders.length, reviews: queue.counts,
  radar: processing.radar, outstanding: processing.items || [] }, null, 2));
const clean = (value) => String(value || "").replace(/[\r\n|]/g, " ").slice(0, 350);
if (process.env.GITHUB_STEP_SUMMARY && !process.argv.includes("--check")) {
  const rows = (processing.items || []).map((item) =>
    `| ${clean(item.title)} | ${clean(item.status)} | ${clean(item.reason)} |`).join("\n");
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Zpracování zakázek\n\nPublikováno: ${dataset.tenders.length}. Čeká na automatický pokus: ${queue.pendingCount || 0}. Vyžaduje kontrolu: ${queue.attentionCount || 0}.\n\n| Zakázka | Stav | Důvod |\n|---|---|---|\n${rows}\n`);
}
// Publish good results before surfacing exhausted automatic retries.
const stuck = (queue.tenders || []).filter((item) => item.status === "needs-review" && item.attempts >= 3);
if (process.argv.includes("--check") && stuck.length) {
  console.error(`${stuck.length} zakázek vyčerpalo automatické pokusy. Důvody jsou v přehledu zpracování.`);
  process.exitCode = 1;
}
