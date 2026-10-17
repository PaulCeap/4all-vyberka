# Architektura a provoz

## Tok dat

```mermaid
flowchart LR
  Z[Zakázky GOV / 24 h] --> C[Sběr oficiálních zdrojů]
  TA[TenderArena / nové zakázky] --> C
  NEN[NEN / cílené otevřené zakázky] --> C
  T[TED Search API / 8 dní] --> C
  E[E-ZAK JMK a watchlist] --> C
  M[Ruční JSON tipy] --> C
  R[Poptávky.cz / Poptávej.cz radar] --> O[Dohledání originálu]
  C --> O
  O --> N[Normalizace]
  N --> D[Deduplikace]
  D --> S[Scoring 4ALL]
  S --> J[public/data/tenders.json]
  J --> W[Statický web]
  G[GitHub Actions denně] --> C
  J --> P[GitHub main]
  P --> V[vyberka.4all.cz / VPS]
  P --> B[GitHub Pages / záloha]
```

## Provozní rozhodnutí

- **Bez databáze:** několik stovek otevřených tipů se bezpečně vejde do verzovaného JSON. Historie změn je přímo v Gitu a hosting nemá serverovou část.
- **Bez tajných klíčů:** hlavní zdroje jsou veřejné. První nasazení proto funguje bez správy secrets.
- **Překryv TEDu:** dotaz sahá osm dní zpět, aby krátký výpadek workflow nevytvořil mezeru. Deduplikace zabrání opakovanému publikování.
- **Český agregátor:** Zakázky GOV uvádí zakázky z různých systémů na jednom místě a poskytuje stručný popis, zadavatele, publikaci a lhůtu.
- **Fail-safe:** když oficiální zdroje nevrátí žádnou použitelnou položku, agent skončí chybou a nepřepíše data prázdným souborem. Při výpadku jednotlivého zdroje použije ostatní a stav zapíše do `sources`. Neplatný jednotlivý řádek přeskočí a započte do diagnostiky.
- **Termíny:** prošlé zakázky se nezobrazují. Chybějící termín se nepočítá mezi blížící se lhůty; česká data se převádějí podle letního nebo zimního času a čas se v přehledu ukazuje jen tehdy, když ho zdroj skutečně uvedl.
- **Agregátory nejsou autorita:** Poptávky.cz a Poptávej.cz pouze vytvoří lead. Odkaz se musí otevřít a přečíst nebo se lead musí jednoznačně spojit s již načteným oficiálním záznamem. Teprve údaje oficiálního záznamu se bodují a publikují. Nedohledané tipy čekají mimo web na další pokus.

## Denní běh

Workflow běží v 04:20 UTC (v Praze podle sezóny 05:20 nebo 06:20). Pořadí:

1. čistá instalace a testy,
2. načtení zdrojů,
3. spojení s existující historií,
4. normalizace, deduplikace a přepočet relevance,
5. commit pouze při změně dat,
6. server synchronizuje nová data a web z GitHubu do minuty; GitHub Pages zůstává záložním výstupem.

Workflow lze kdykoli spustit ručně v záložce Actions. Díky `concurrency` se dva denní běhy nepřepisují.

## Deduplikace

První klíč je `source + sourceId`. Druhý, mezizdrojový klíč je SHA-256 fingerprint z normalizovaného názvu zadavatele, názvu zakázky a dne lhůty. Při sloučení se zachová delší popis, CPV z obou zdrojů, nejstarší `firstSeenAt` a seznam zdrojů.

## Budoucí rozšíření

- e-mailový nebo Slack digest jen pro skóre 75+,
- jednoduchá redakční vrstva (`nové / posoudit / go / no-go`),
- LLM druhý průchod nad zadávací dokumentací až po levném pravidlovém filtru,
- sběr z placeného zdroje přes nový adaptér v `src/sources/`,
- zpětná vazba z vyhraných/prohraných příležitostí pro kalibraci vah.
