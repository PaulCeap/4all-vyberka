import { NEGATIVE_SIGNALS, SERVICE_AREAS } from "./config.mjs";
import { searchable } from "./model.mjs";

function daysUntil(value, now) {
  if (!value) return null;
  return Math.ceil((new Date(value) - now) / 86_400_000);
}

function cpvMatches(codes, prefixes) {
  return codes.some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
}

export function scoreTender(tender, now = new Date()) {
  const haystack = searchable(`${tender.title}. ${tender.summary}`);
  const categoryScores = [];
  const reasons = [];

  for (const area of SERVICE_AREAS) {
    let categoryScore = 0;
    const matched = [];
    for (const [keyword, points] of area.keywords) {
      if (haystack.includes(searchable(keyword))) {
        categoryScore += points;
        matched.push(keyword);
      }
    }
    if (cpvMatches(tender.cpv || [], area.cpvPrefixes)) {
      categoryScore += 24;
      matched.push("odpovídající CPV");
    }
    categoryScore = Math.min(categoryScore, 50);
    if (categoryScore > 0) {
      categoryScores.push({ id: area.id, label: area.label, score: categoryScore, matched });
    }
  }

  categoryScores.sort((a, b) => b.score - a.score);
  let score = categoryScores[0]?.score || 0;
  if (categoryScores[1]) score += Math.min(18, Math.round(categoryScores[1].score * 0.45));
  if (categoryScores[2]) score += Math.min(8, Math.round(categoryScores[2].score * 0.2));

  const titleText = searchable(tender.title);
  if (categoryScores.some((category) => category.matched.some((word) => titleText.includes(searchable(word))))) {
    score += 12;
    reasons.push("klíčové téma je přímo v názvu");
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

  score = Math.max(0, Math.min(100, Math.round(score)));
  const categories = categoryScores.slice(0, 3).map(({ id, label, score: categoryScore }) => ({
    id,
    label,
    score: categoryScore,
  }));
  for (const category of categoryScores.slice(0, 2)) {
    const words = category.matched.filter((word) => word !== "odpovídající CPV").slice(0, 2);
    reasons.unshift(words.length
      ? `${category.label}: ${words.join(", ")}`
      : `${category.label}: odpovídající CPV`);
  }

  return {
    score,
    level: score >= 75 ? "strong" : score >= 55 ? "good" : score >= 42 ? "watch" : "low",
    reasons: [...new Set(reasons)].slice(0, 5),
    negativeSignals: [...new Set(negativeSignals)].slice(0, 4),
    categories,
    deadlineDays,
  };
}
