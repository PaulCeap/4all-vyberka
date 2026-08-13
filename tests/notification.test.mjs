import test from "node:test";
import assert from "node:assert/strict";
import { buildNotification, selectNewTenders, sendNotification } from "../src/notification.mjs";

const dataset = {
  generatedAt: "2026-08-14T04:20:00.000Z",
  tenders: [
    {
      id: "nen:1", title: "Komunikační kampaň", buyer: "Město Test", summary: "Tvorba kampaně.",
      url: "https://example.test/1", firstSeenAt: "2026-08-14T04:20:00.000Z", lastSeenAt: "2026-08-14T04:20:00.000Z",
      deadline: "2026-09-01T10:00:00Z", value: { amount: 2_000_000, currency: "CZK" },
      relevance: { score: 82, categories: [{ label: "PR & komunikace" }] },
    },
    {
      id: "nen:2", title: "Starší zakázka", buyer: "Kraj", summary: "Starší tip.",
      url: "https://example.test/2", firstSeenAt: "2026-08-10T04:20:00.000Z", lastSeenAt: "2026-08-14T04:20:00.000Z",
      relevance: { score: 60, categories: [] },
    },
  ],
};

test("upozornění vybere jen položky poprvé viděné v aktuálním běhu", () => {
  assert.deepEqual(selectNewTenders(dataset).map((tender) => tender.id), ["nen:1"]);
  const message = buildNotification(dataset);
  assert.equal(message.count, 1);
  assert.match(message.subject, /1 nová příležitost/);
  assert.match(message.html, /Komunikační kampaň/);
  assert.doesNotMatch(message.html, /Starší zakázka/);
});

test("odeslání používá Resend API a idempotentní klíč běhu", async () => {
  let request;
  const result = await sendNotification({
    dataset,
    apiKey: "test-key",
    from: "4ALL <vyberka@example.test>",
    recipients: ["team@example.test"],
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "email-123" }), { status: 200 });
    },
  });
  assert.equal(result.sent, true);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.options.headers["idempotency-key"], `4all-vyberka-${dataset.generatedAt}`);
  assert.deepEqual(JSON.parse(request.options.body).to, ["team@example.test"]);
});
