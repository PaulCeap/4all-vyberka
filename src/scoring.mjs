import { NEGATIVE_SIGNALS, SERVICE_AREAS } from "./config.mjs";
import { searchable } from "./model.mjs";
import { assessScope } from "./scope.mjs";

function daysUntil(value, now) {
  if (!value) return null;
  return Math.ceil((new Date(value) - now) / 86_400_000);
}

function cpvMatches(codes, prefixes) {
  return codes.some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
}

export function scoreTender(tender, now = new Date(), { preliminary = false } = {}) {
  const scope = assessScope(tender);
  const titleText = searchable(tender.title);
  const summaryText = searchable(tender.summary);
  const factsText = tender.factsReviewedAt
    ? searchable((tender.verifiedFacts || []).map((fact) => fact.text).join(". ")) : "";
  const haystack = searchable(`${tender.title}. ${tender.summary}. ${factsText}`);
  const categoryScores = [];
  const reasons = [];
  let hasContentMatch = false;
  let hasTitleMatch = false;

  for (const area of SERVICE_AREAS) {
    let categoryScore = 0;
    let contentMatched = false;
    const matched = [];
    for (const [keyword, points] of area.keywords) {
      const term = searchable(keyword);
      if (titleText.includes(term)) hasTitleMatch = true;
      if (summaryText.includes(term)) {
        categoryScore += points;
        matched.push(keyword);
        hasContentMatch = true;
        contentMatched = true;
      } else if (factsText.includes(term)) {
        categoryScore += preliminary ? points : Math.ceil(points * 0.5);
        matched.push(keyword);
        hasContentMatch = true;
        contentMatched = true;
      } else if (titleText.includes(term)) {
        categoryScore += preliminary ? points : Math.ceil(points * 0.25);
      }
    }
    if (cpvMatches(tender.cpv || [], area.cpvPrefixes)) {
      categoryScore += preliminary ? 24 : 10;
      matched.push("odpovídající CPV");
    }
    if (scope.contentAreas.includes(area.id)) {
      categoryScore = Math.max(categoryScore, 28);
      if (!matched.length) matched.push("přímá poptávka služby");
      hasContentMatch = true;
      contentMatched = true;
    }
    categoryScore = Math.min(categoryScore, 50);
    if (categoryScore > 0 && (preliminary || contentMatched)) {
      categoryScores.push({ id: area.id, label: area.label, score: categoryScore, matched });
    }
  }

  categoryScores.sort((a, b) => b.score - a.score);
  let score = categoryScores[0]?.score || 0;
  if (categoryScores[1]) score += Math.min(18, Math.round(categoryScores[1].score * 0.45));
  if (categoryScores[2]) score += Math.min(8, Math.round(categoryScores[2].score * 0.2));

  if (preliminary && hasTitleMatch) {
    score += 12;
  } else if (hasContentMatch) {
    score += 12;
    reasons.push(tender.factsReviewedAt ? "obor potvrzuje ověřený výtah zadání" : "obor potvrzuje popis zakázky");
  }
  if (searchable(tender.procedureType).includes("sluzb")) {
    score += 5;
    reasons.push("jde o zakázku na služby");
  }
  if (tender.opportunityType === "market-signal") {
    score += 20;
    reasons.push("aktivní komerční výběrové řízení zachycené v médiích");
  }

  const negativeSignals = [];
  for (const [signal, penalty] of NEGATIVE_SIGNALS) {
    if (haystack.includes(searchable(signal))) {
      negativeSignals.push(signal);
      score -= penalty;
    }
  }

  const deadlineDays = daysUntil(tender.deadline, now);
  if (deadlineDays !== null) {
    if (deadlineDays < 0) score -= 50;
    else if (deadlineDays <= 3) {
      score -= 8;
      negativeSignals.push("velmi krátká lhůta");
    } else if (deadlineDays >= 7) {
      score += 4;
      reasons.push("zbývá alespoň týden na reakci");
    }
  }

  // Název a CPV pomáhají najít kandidáta. Samy o sobě nepotvrdí shodu pro veřejnou kartu.
  if (!preliminary && !hasContentMatch) score = Math.min(score, 39);
  // Skóre řadí zakázky až poté, co jejich předmět spadá do služeb 4ALL.
  if (!preliminary && !scope.eligible) score = Math.min(score, 39);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const categories = categoryScores.slice(0, 3).map(({ id, label, score: categoryScore }) => ({
    id,
    label,
    score: categoryScore,
  }));
  const topicReasons = [];
  for (const category of categoryScores.slice(0, 2)) {
    const words = category.matched.filter((word) => word !== "odpovídající CPV").slice(0, 2);
    if (words.length) topicReasons.push(`${category.label}: ${words.join(", ")}`);
  }
  reasons.unshift(...topicReasons);

  return {
    score,
    level: score >= 75 ? "strong" : score >= 55 ? "good" : score >= 42 ? "watch" : "low",
    reasons: [...new Set(reasons)].slice(0, 5),
    negativeSignals: [...new Set(negativeSignals)].slice(0, 4),
    categories,
    deadlineDays,
  };
}
