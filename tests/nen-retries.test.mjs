import test from "node:test";
import assert from "node:assert/strict";
import { fetchNen } from "../src/sources/nen.mjs";
import { restoreNenRetries, nenDetailUrl, failedNenDetail, selectNenRetries } from "../src/nen-retries.mjs";
import { processingOverview } from "../src/processing-state.mjs";

const now = new Date("2026-10-25T10:00:00Z"), tomorrow = new Date("2026-10-26T10:00:00Z");
const row = (n) => ({ kod: `N006/26/V0000000${n}`, nazev: `Monitoring médií ${n}`, zadavatelNazev: "Město Test" });
const html = (data) => `<meta name="initialReduxState" content="${encodeURIComponent(JSON.stringify(data))}">`;
function mockNen({ searchRows = [], failed = [], searchFailure = false, calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    if (!url.includes("detail-zakazky")) return searchFailure ? new Response("", { status: 403 }) : new Response(html({
      collectionStore: { collections: { "verejne-zakazky-seznam": { collection: searchRows } } },
    }));
    const code = url.split("/").at(-1).replaceAll("-", "/");
    if (failed.includes(code)) return new Response("", { status: 403 });
    return new Response(html({ detailObjectStore: { objects: { item: { object: {
      kod: code, nazev: `Monitoring ${code}`, zadavatelNazev: "Město Test", popisPredmet: "Monitoring médií",
      podaniLhuta: "2026-11-10T10:00:00Z", stavZP: "neukoncena",
    } } } } }));
  };
}
const persisted = (rows) => JSON.parse(JSON.stringify({ warnings: rows.warnings, retryQueue: rows.retryQueue }));

test("failed NEN detail survives serialization and is retried after disappearing from search", async () => {
  const first = await fetchNen({ now, fetchImpl: mockNen({ searchRows: [row(1), row(2)], failed: [row(1).kod] }) });
  assert.equal(first.length, 1);
  assert.equal(first.retryQueue[0].code, row(1).kod);
  assert.equal(first.retryQueue[0].title, row(1).nazev);
  assert.equal(first.retryQueue[0].attempts, 1);
  const calls = [];
  const second = await fetchNen({ now: tomorrow, previousSource: persisted(first), fetchImpl: mockNen({ searchRows: [row(2)], calls }) });
  assert.equal(second.length, 2);
  assert.ok(calls.includes(nenDetailUrl(row(1).kod)));
  assert.deepEqual(second.retryQueue, []);
});

test("a total NEN detail outage preserves all discovered addresses", async () => {
  const rows = await fetchNen({ now, fetchImpl: mockNen({ searchRows: [row(1), row(2)], failed: [row(1).kod, row(2).kod] }) });
  assert.equal(rows.length, 0);
  assert.equal(rows.retryQueue.length, 2);
  assert.ok(rows.warnings.some((s) => s.includes("adresy zůstávají uložené")));
});

test("stored NEN addresses are retried even when every search fails", async () => {
  const previousSource = { retryQueue: [failedNenDetail(row(1), new Error("HTTP 503"), null, now)] };
  const rows = await fetchNen({ now: tomorrow, previousSource, fetchImpl: mockNen({ searchFailure: true }) });
  assert.equal(rows[0].sourceId, row(1).kod);
  assert.deepEqual(rows.retryQueue, []);
});

test("repeated failures retain first failure time and continue beyond three runs", async () => {
  const old = { ...failedNenDetail(row(1), new Error("HTTP 503"), null, now), attempts: 3 };
  const rows = await fetchNen({ now: tomorrow, previousSource: { retryQueue: [old] }, fetchImpl: mockNen({ failed: [row(1).kod] }) });
  assert.equal(rows.retryQueue[0].attempts, 4);
  assert.equal(rows.retryQueue[0].firstFailedAt, now.toISOString());
  assert.equal(rows.retryQueue[0].lastAttemptAt, tomorrow.toISOString());
});

test("bounded retry batches retain unattempted addresses and prefer the oldest next time", async () => {
  const entries = [1, 2, 3].map((n) => failedNenDetail(row(n), new Error("HTTP 503"), null, now));
  const calls = [];
  const first = await fetchNen({ now: tomorrow, retryLimit: 1, previousSource: { retryQueue: entries },
    fetchImpl: mockNen({ searchRows: [row(4)], failed: [row(1).kod], calls }) });
  assert.equal(first.retryQueue.length, 3);
  assert.equal(calls.filter((u) => u.includes("detail-zakazky")).length, 2);
  assert.equal(selectNenRetries(restoreNenRetries(persisted(first)), 1)[0].code, row(2).kod);
});

test("the same queued and searched address is fetched once per run", async () => {
  const calls = [];
  await fetchNen({ now, previousSource: { retryQueue: [failedNenDetail(row(1), new Error("HTTP 503"), null, now)] },
    fetchImpl: mockNen({ searchRows: [row(1)], calls }) });
  assert.equal(calls.filter((u) => u.includes("detail-zakazky")).length, 1);
});

test("previous warning-only failures migrate once without permitting unrelated URLs", () => {
  const warning = `Detail: ${nenDetailUrl(row(1).kod)}: HTTP 503`;
  const queue = restoreNenRetries({ warnings: [warning, warning, "Detail: https://example.org/private: HTTP 503"] }, now);
  assert.equal(queue.size, 1);
  assert.equal([...queue.values()][0].code, row(1).kod);
  assert.equal(restoreNenRetries({ retryQueue: [], warnings: [warning] }, now).size, 0);
  assert.equal(nenDetailUrl("../../example.org"), null);
});

test("processing overview exposes failed details independently of document review", () => {
  const failed = failedNenDetail(row(1), new Error("HTTP 503"), null, now);
  const overview = processingOverview({ tenders: [], counts: {} }, { leads: [], counts: {} },
    [{ id: "nen", ok: true, warnings: [], retryQueue: [failed] }], [], now);
  assert.equal(overview.status, "attention");
  assert.equal(overview.items[0].status, "retry");
  assert.equal(overview.items[0].url, failed.url);
  assert.match(overview.items[0].reason, /při dalším denním sběru/);
});
