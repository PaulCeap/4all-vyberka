import { reviewSnapshot } from "./document-review.mjs";

export function attachVerifiedNotes(rows, notes = {}) {
  return rows.map((row) => {
    const note = notes[`${row.source}:${row.sourceId}`];
    if (!note || !Array.isArray(row.documents) || !row.documents.length) return row;
    const current = reviewSnapshot(row.documents);
    const snapshot = (note.documentSnapshot || []).slice().sort();
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) return row;
    return {
      ...row,
      summary: note.method === "automatic-extraction" && (row.summary || "").length >= 120
        ? row.summary : note.summary || row.summary,
      verifiedFacts: note.facts,
      factsReviewedAt: note.reviewedAt,
    };
  });
}
