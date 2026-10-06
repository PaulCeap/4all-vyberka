import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAggregatorLeads } from "../src/origin-resolver.mjs";
import { prepareTenders, countNewTenders } from "../src/tender-history.mjs";

const { official, lead } = JSON.parse(await readFile(new URL("./fixtures/lom-dns.json", import.meta.url), "utf8"));
const now = new Date("2026-10-05T11:38:56.424Z");

test("ted:646731-2026 a poptavej:VZ861003 se spojí napříč běhy bez nové zakázky", () => {
  const previous = { tenders: [official] };
  const resolution = resolveAggregatorLeads([lead], [], { previousRows: previous.tenders, now });
  assert.deepEqual([...resolution.matchedKeys], [official.id]);
  const tenders = prepareTenders(resolution.rows, previous, now);
  assert.equal(tenders.length, 1);
  assert.equal(tenders[0].id, official.id);
  assert.equal(tenders[0].buyer, "LOM PRAHA s.p.");
  assert.equal(tenders[0].firstSeenAt, official.firstSeenAt);
  assert.equal(tenders[0].lastSeenAt, now.toISOString());
  assert.equal(tenders[0].originStatus, "resolved");
  assert.equal(tenders[0].discoveryUrl, lead.url);
  assert.equal(tenders[0].deadline, null);
  assert.equal(countNewTenders(tenders, now), 0);
  // Také opraví již uložený falešný agregátorový duplikát při dalším běhu.
  const retry = resolveAggregatorLeads([lead], [], { previousRows: [official, lead], now });
  assert.equal(prepareTenders(retry.rows, { tenders: [official, lead] }, now).length, 1);
});

test("aktuální oficiální verze má přednost před historickou", () => {
  const current = { ...official, summary: "Aktualizovaný oficiální popis", deadline: "2026-10-30T10:00:00Z" };
  const { rows } = resolveAggregatorLeads([lead], [current], { previousRows: [official], now });
  assert.equal(rows[0].summary, current.summary);
  assert.equal(rows[0].deadline, current.deadline);
  const tenders = prepareTenders([current, ...rows], { tenders: [official] }, now);
  assert.equal(tenders.length, 1);
  assert.equal(tenders[0].firstSeenAt, official.firstSeenAt);
  assert.equal(countNewTenders(tenders, now), 0);
});

test("historie neposkytuje staré, uzavřené, neověřené ani agregátorové kandidáty", () => {
  const invalid = [
    { ...official, firstSeenAt: "2026-01-01T00:00:00Z" },
    { ...official, deadline: "2026-01-01T00:00:00Z" },
    ...["closed", "cancelled", "awarded"].map((status) => ({ ...official, status })),
    { ...official, originStatus: "unresolved" },
    { ...official, source: "poptavej" },
    { ...official, url: "https://www.poptavej.cz/verejna-zakazka/VZ861003" },
    { ...official, opportunityType: "market-signal" },
  ];
  for (const candidate of invalid) {
    const { rows } = resolveAggregatorLeads([lead], [], { previousRows: [candidate], now });
    assert.equal(rows[0].originStatus, "unresolved", JSON.stringify(candidate));
  }
});

test("platný termín udržuje starší záznam a nové zakázky se počítají jen v aktuálním běhu", () => {
  const older = { ...official, firstSeenAt: "2026-01-01T00:00:00Z", deadline: "2026-10-30T10:00:00Z" };
  assert.equal(resolveAggregatorLeads([lead], [], { previousRows: [older], now }).rows[0].originStatus, "resolved");
  assert.equal(countNewTenders([official], now), 0);
  const newLead = { ...lead, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString() };
  assert.equal(countNewTenders(prepareTenders([newLead], { tenders: [] }, now), now), 1);
});
