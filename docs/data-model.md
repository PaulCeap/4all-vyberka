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
    "closingSoon": 2,
    "invalidRows": 0
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
| `url` | string | Odkaz na původní záznam; radarové agregátory se do publikovaného souboru nedostanou |
| `title`, `buyer`, `summary` | string | Název, zadavatel a krátký popis; u ověřených zakázek je popis z věcných podkladů |
| `country`, `region` | string | Místo plnění |
| `publishedAt`, `deadline` | ISO datetime / null | Klíčové termíny |
| `deadlineTimeKnown` | boolean | Čas lhůty byl ve zdroji uveden přesně; jinak web ukáže jen datum |
| `value` | object / null | `amount` a `currency` bez DPH dle zdroje |
| `cpv` | string[] | CPV bez pomlček |
| `procedureType` | string | Typ řízení / charakter zakázky |
| `opportunityType` | string | `public-tender`, `commercial-demand` nebo `market-signal` |
| `status` | string | `open`, `unknown` apod. |
| `firstSeenAt`, `lastSeenAt` | ISO datetime | Lokální historie sledování |
| `fingerprint` | string | Krátký SHA-256 pro mezizdrojovou deduplikaci |
| `verifiedFacts` | object[] | Stručné ověřené poznatky s odkazem na konkrétní věcný dokument |
| `factsReviewedAt` | ISO datetime / null | Čas posledního ověření výtahu |
| `relevance` | object | Výsledek scoringu |

Úplný seznam příloh a původ radarového tipu zůstávají v pracovním souboru `data/tender-state.json`. Veřejná karta obsahuje jen odkaz na zakázku a na podklady ke konkrétním poznatkům. Změna důležitých dokumentů zneplatní starý výtah, zatímco přidaný formulář nikoli.

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
Statistika `closingSoon` zahrnuje jen položky se známým termínem do sedmi dní. Prošlé zakázky se nepublikují.
