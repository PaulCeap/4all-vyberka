# Datový model

Publikovaný soubor `public/data/tenders.json` má `schemaVersion: 1` a následující tvar:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-09T10:00:00.000Z",
  "stats": {
    "total": 12,
    "newThisRun": 3,
    "strong": 4,
    "closingSoon": 2
  },
  "sources": [
    { "id": "zakazky-gov", "ok": true, "count": 23 }
  ],
  "tenders": []
}
```

## Tender

| Pole | Typ | Popis |
|---|---|---|
| `id` | string | Stabilní klíč `source:sourceId` |
| `source`, `sourceId` | string | Původ a identifikátor u zdroje |
| `url` | string | Odkaz na oficiální detail |
| `title`, `buyer`, `summary` | string | Normalizované texty |
| `country`, `region` | string | Místo plnění |
| `publishedAt`, `deadline` | ISO datetime / null | Klíčové termíny |
| `value` | object / null | `amount` a `currency` bez DPH dle zdroje |
| `cpv` | string[] | CPV bez pomlček |
| `procedureType` | string | Typ řízení / charakter zakázky |
| `opportunityType` | string | `public-tender`, `commercial-demand` nebo `market-signal` |
| `status` | string | `open`, `unknown` apod. |
| `firstSeenAt`, `lastSeenAt` | ISO datetime | Lokální historie sledování |
| `fingerprint` | string | Krátký SHA-256 pro mezizdrojovou deduplikaci |
| `duplicateSources` | string[] / undefined | Zdroje sloučeného záznamu |
| `relevance` | object | Výsledek scoringu |

## Relevance

```json
{
  "score": 84,
  "level": "strong",
  "reasons": ["PR & komunikace: public relations, komunikační strategie"],
  "negativeSignals": [],
  "categories": [
    { "id": "pr", "label": "PR & komunikace", "score": 44 }
  ],
  "deadlineDays": 18
}
```

Úrovně: `strong` od 75, `good` od 55, `watch` od 42 a `low` pod publikačním prahem.
