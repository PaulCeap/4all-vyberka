import { searchable } from "./model.mjs";

export function extractBudget(documents) {
  const found = [];
  for (const document of documents) {
    const text = searchable(document.text || "");
    const pattern = /predpokladan\w* hodnot\w*[^\d]{0,100}(\d[\d\s.,]*?)\s*(?:,-|\.-)?\s*(mil\.?|milion\w*)?\s*(kc|czk|eur)\b/g;
    for (const match of text.matchAll(pattern)) {
      let number = match[1].replace(/\s/g, "").replace(/[.,]-?$/, "");
      if (number.includes(",")) number = number.replace(/\./g, "").replace(",", ".");
      else if (/^\d{1,3}(\.\d{3})+$/.test(number)) number = number.replace(/\./g, "");
      const amount = Number(number) * (match[2] ? 1_000_000 : 1);
      if (Number.isFinite(amount) && amount > 0) found.push({
        value: { amount, currency: match[3] === "eur" ? "EUR" : "CZK" }, valueSource: document.url,
      });
    }
  }
  const distinct = new Set(found.map((item) => JSON.stringify(item.value)));
  // Conflicting values, lots or amendments require a human decision.
  return distinct.size === 1 ? found[0] : null;
}

export function assessOpportunity(tender) {
  const facts = tender.verifiedFacts || [];
  const requirements = facts.filter((fact) => fact.kind === "qualification" || /referenc|obrat|kvalifikac/.test(searchable(fact.text)));
  const evaluation = facts.filter((fact) => fact.kind === "evaluation" || /hodnotic|hodnocen|vah.{0,20}%/.test(searchable(fact.text)));
  const gaps = [];
  if (!tender.value) gaps.push("Rozpočet není doložený.");
  if (!tender.deadline) gaps.push("Lhůta pro reakci není doložená.");
  if (!requirements.length) gaps.push("Kvalifikační požadavky nejsou ve výtahu ověřené.");
  if (!evaluation.length) gaps.push("Pravidla hodnocení nabídek nejsou ve výtahu ověřená.");
  if (tender.reviewComplete === false) gaps.push("Část podkladů se zatím nepodařilo přečíst.");
  return {
    status: gaps.length ? "needs-information" : "ready-for-decision",
    label: gaps.length ? "Doplnit podklady pro rozhodnutí" : "Podklady připravené k rozhodnutí",
    requirements, evaluation, gaps,
    internalChecks: ["Porovnat požadované reference s našimi.", "Ověřit kapacitu týmu a náklady realizace."],
    explanation: "Shoda vyjadřuje oborovou relevanci. Rozpočet je hodnota zadání, nikoli odhad zisku nebo šance na výhru.",
  };
}
