import { isAggregatorSource, isAggregatorUrl, sourceFromOfficialUrl } from "./origin-resolver.mjs";

export function publicDataset(dataset) {
  return {
    ...dataset,
    sources: dataset.sources.filter((source) => !isAggregatorSource(source.id)),
    tenders: dataset.tenders
      .filter((tender) => !isAggregatorSource(tender.source))
      .filter((tender) => !isAggregatorUrl(tender.url))
      .filter((tender) => !tender.discoverySource || sourceFromOfficialUrl(tender.url))
      .map((tender) => {
        const { discoverySource, discoveryUrl, originStatus, originConfidence,
          candidateProfileUrls, duplicateSources, ...publicTender } = tender;
        return publicTender;
      }),
  };
}
