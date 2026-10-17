export function attachVerifiedNotes(rows, notes = {}) {
  return rows.map((row) => {
    const note = notes[`${row.source}:${row.sourceId}`];
    if (!note || !Array.isArray(row.documents) || !row.documents.length) return row;
    const current = row.documents.map((document) => document.url).sort();
    const snapshot = (note.documentSnapshot || []).slice().sort();
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) return row;
    return {
      ...row,
      verifiedFacts: note.facts,
      factsReviewedAt: note.reviewedAt,
    };
  });
}
