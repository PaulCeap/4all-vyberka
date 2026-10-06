import { PROJECT } from "./config.mjs";

export function isWithinHistory(tender, now = new Date()) {
  const days = tender.opportunityType === "market-signal" ? PROJECT.signalHistoryDays : PROJECT.historyDays;
  const cutoff = now.valueOf() - days * 86_400_000;
  return new Date(tender.deadline || tender.publishedAt || tender.firstSeenAt).valueOf() >= cutoff;
}
