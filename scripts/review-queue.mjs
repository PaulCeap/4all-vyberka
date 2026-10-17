import { readFile } from "node:fs/promises";
import { pendingDocumentReviews } from "../src/document-review.mjs";

const state = JSON.parse(await readFile("data/tender-state.json", "utf8"));
const notes = JSON.parse(await readFile("data/verified-notes.json", "utf8"));
const pending = pendingDocumentReviews(state.tenders, notes);
console.log(JSON.stringify({ pendingCount: pending.length, tenders: pending }, null, 2));
