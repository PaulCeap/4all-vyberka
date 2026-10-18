import test from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/dataset.mjs";
import { normalizeTender } from "../src/model.mjs";
import { scoreTender } from "../src/scoring.mjs";

const now = new Date("2026-10-17T10:00:00Z");
const project = { name: "Test", minimumScore: 42, historyDays: 45, openNoDeadlineDays: 365, signalHistoryDays: 120 };
const tender = (sourceId, deadline) => ({
  source: "zakazky-gov", sourceId,
  url: `https://zakazky.gov.cz/test/${sourceId}`,
  title: `Komunikační a marketingová kampaň ${sourceId}`,
  buyer: "Město Test",
  summary: "PR služby, public relations, komunikační strategie, tvorba obsahu, video, správa sociálních sítí, marketingová kampaň a eventová agentura.",
  publishedAt: "2026-10-16T08:00:00Z",
  deadline,
  cpv: ["79340000"],
  procedureType: "Služby",
});
const make = (rows, previous = { tenders: [] }) => buildDataset({ rows, sources: [], previous, now, project });

test("do týdne se nepočítá chybějící termín a prošlá zakázka se nezobrazuje", () => {
  assert.ok(scoreTender(normalizeTender(tender("prosla", "2026-10-16T10:00:00Z"), now), now).score >= project.minimumScore);
  const { dataset } = make([
    tender("bez-terminu", null),
    tender("brzy", "2026-10-20T10:00:00Z"),
    tender("prosla", "2026-10-16T10:00:00Z"),
  ]);
  assert.deepEqual(dataset.tenders.map((item) => item.sourceId).sort(), ["bez-terminu", "brzy"]);
  assert.equal(dataset.stats.total, 2);
  assert.equal(dataset.stats.closingSoon, 1);
});

test("výslovně otevřená letošní zakázka bez termínu se neztratí po 45 dnech", () => {
  const active = { ...tender("dlouhodoba", null), status: "open", publishedAt: "2026-03-04T08:00:00Z" };
  const stale = { ...tender("historicka", null), status: "open", publishedAt: "2021-03-04T08:00:00Z" };
  const unknown = { ...tender("nejista", null), status: "unknown", publishedAt: "2026-03-04T08:00:00Z" };
  const { dataset } = make([active, stale, unknown]);
  assert.deepEqual(dataset.tenders.map((item) => item.sourceId), ["dlouhodoba"]);
});

test("NEN bez lhůty není aktuální tip jen proto, že řízení ještě není ukončené", () => {
  const undated = { ...tender("nen-bez-lhuty", null), source: "nen", status: "open" };
  const expired = { ...tender("nen-prosly", "2026-07-14T12:00:00Z"), source: "nen", status: "open" };
  const active = { ...tender("nen-aktivni", "2026-10-30T12:00:00Z"), source: "nen", status: "open" };
  const { dataset } = make([undated, expired, active]);
  assert.deepEqual(dataset.tenders.map((item) => item.sourceId), ["nen-aktivni"]);
});

test("chybný řádek se přeskočí, ale platná oficiální zakázka zůstane", () => {
  const { dataset, invalidRows } = make([null, tender("platna", "2026-10-25T10:00:00Z")]);
  assert.equal(dataset.tenders.length, 1);
  assert.equal(dataset.stats.invalidRows, 1);
  assert.equal(invalidRows[0].source, "unknown");
});

test("bez použitelného oficiálního zdroje se nový přehled nevydá", () => {
  assert.throws(() => make([{ ...tender("rucni", null), source: "manual" }]), /Oficiální zdroje/);
  assert.throws(() => make([{ ...tender("neplatna", null), title: "" }]), /Oficiální zdroje/);
});

test("tipy z Poptávej a Poptávky se nikdy nehodnotí ani nezobrazí samy", () => {
  const radar = { ...tender("radar", "2026-10-25T10:00:00Z"), source: "poptavej",
    url: "https://www.poptavej.cz/verejna-zakazka/VZ123/x", summary: "Velmi lákavý popis z radaru." };
  const previous = { tenders: [radar] };
  const { dataset } = make([radar, tender("original", "2026-10-25T10:00:00Z")], previous);
  assert.deepEqual(dataset.tenders.map((item) => item.sourceId), ["original"]);
});
