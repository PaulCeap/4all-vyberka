import { reviewSnapshot } from "./document-review.mjs";

// A manual review wins only while it describes the current attachments.
// A stale manual snapshot must not hide a successful newer automatic review.
export function currentNotes(rows, automatic = {}, manual = {}) {
  const selected = {};
  for (const row of rows) {
    const id = row.id || `${row.source}:${row.sourceId}`;
    const snapshot = JSON.stringify(reviewSnapshot(row.documents));
    const note = [manual[id], automatic[id]].find((item) => item &&
      JSON.stringify((item.documentSnapshot || []).slice().sort()) === snapshot);
    if (note) selected[id] = note;
  }
  return selected;
}

export function attachVerifiedNotes(rows, notes = {}) {
  return rows.map((row) => {
    const note = notes[`${row.source}:${row.sourceId}`];
    if (!note || !Array.isArray(row.documents) || !row.documents.length) return row;
    const current = reviewSnapshot(row.documents);
    const snapshot = (note.documentSnapshot || []).slice().sort();
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) return row;
    // Some profiles omit a value that is stated in the reviewed documents.
    // A current value from the primary profile always takes precedence.
    const reviewedValue = Number(note.value?.amount) > 0 && note.valueSource
      ? note.value : null;
    return {
      ...row,
      value: row.value || reviewedValue,
      valueSource: row.value ? row.valueSource : reviewedValue ? note.valueSource : row.valueSource,
      summary: note.method === "automatic-extraction" && (row.summary || "").length >= 120
        ? row.summary : note.summary || row.summary,
      verifiedFacts: note.facts,
      factsReviewedAt: note.reviewedAt,
      reviewComplete: note.complete !== false,
      reviewWarnings: note.warnings || [],
    };
  });
}
