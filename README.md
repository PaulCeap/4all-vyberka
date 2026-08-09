# 4ALL Výběrka

Denně aktualizovaný předvýběr veřejných zakázek, poptávek a komerčních tendrů relevantních pro komunikační agenturu [4ALL](https://www.4all.cz/). Projekt spojuje sběr z oficiálních i oborových zdrojů, transparentní bodování, deduplikaci a statický web pro `vyberka.4all.cz`.

**Živý web:** [vyberka.4all.cz](https://vyberka.4all.cz/)


## Co je hotové

- oficiální český zdroj **Zakázky GOV** (novinky za posledních 24 hodin),
- cílený průběžný výběr z **NEN** pro menší české zakázky,
- evropský **TED Search API** jako doplňkový a záložní zdroj,
- marketingové kategorie **Poptávky.cz** a **Poptávej.cz**,
- přímý watchlist profilu **E-ZAK Správy železnic** a nepřímé pokrytí dalších profilů přes Zakázky GOV,
- komerční tendry z RSS **MediaGuru**, **Médiáře** a **Marketing & Media**,
- volitelný ruční vstup přes JSON v `data/manual/`,
- jednotný datový model a spojování duplikátů napříč zdroji,
- vysvětlitelné skóre 0–100 podle nabídky 4ALL,
- responzivní web s hledáním, filtry, řazením a lokálně uloženými favority,
- denní GitHub Actions workflow a automatické nasazení na GitHub Pages,
- testy scoringu a deduplikace.

## Rychlý start

Požadavek: Node.js 22 nebo novější.

```bash
npm ci
npm run agent
npm run dev
```

Web poběží na adrese vypsané v terminálu. Kompletní kontrola projektu:

```bash
npm run check
```

Pro bezpečný běh bez internetu lze použít připravená data:

```bash
AGENT_NOW=2026-08-09T10:00:00Z npm run agent:fixtures
```

## Jak agent rozhoduje

Scoring je záměrně čitelný a verzovaný v `src/config.mjs` a `src/scoring.mjs`:

1. hledá silné fráze a CPV kódy v šesti oblastech služeb 4ALL,
2. přidává body za shodu přímo v názvu, zakázku na služby a použitelnou lhůtu,
3. odečítá body za stavebnictví, právní služby, hardware a další zjevně nerelevantní předměty,
4. publikuje jen zakázky se skóre alespoň 42,
5. u každé zakázky uloží důvody, kategorie a negativní signály.

Skóre je předvýběr, nikoli automatické doporučení k podání nabídky. Před rozhodnutím je nutné otevřít původní zdroj a ověřit kvalifikaci, dokumentaci, lhůty, rozpočet a kapacitu týmu.

## Konfigurace

| Proměnná | Výchozí | Význam |
|---|---:|---|
| `MIN_RELEVANCE_SCORE` | `42` | Minimální publikované skóre |
| `HISTORY_DAYS` | `45` | Jak dlouho držet starší tipy |
| `SIGNAL_HISTORY_DAYS` | `120` | Jak dlouho držet komerční mediální signály |
| `TED_LOOKBACK_DAYS` | `8` | Překryv dotazu do TEDu pro odolnost proti výpadku |
| `NEN_DETAIL_LIMIT` | `60` | Nejvyšší počet NEN detailů načtených v jednom běhu |
| `POPTAVKY_DETAIL_LIMIT` | `30` | Nejvyšší počet detailů z Poptávky.cz |
| `POPTAVEJ_DETAIL_LIMIT` | `30` | Nejvyšší počet detailů z Poptávej.cz |
| `EZAK_DETAIL_LIMIT` | `40` | Nejvyšší počet detailů z jednoho E-ZAK profilu |
| `AGENT_NOW` | aktuální čas | Pevný čas pro testy/reprodukci |

Ruční tip vložte jako jeden objekt nebo pole objektů do `data/manual/*.json`. Strukturu lze převzít z `data/fixtures/incoming.json`.

## Dokumentace

- [Architektura a provoz](docs/architecture.md)
- [Datový model](docs/data-model.md)
- [Nasazení na GitHub Pages a DNS](docs/deployment.md)
- [Zdroje dat a limity](docs/sources.md)

## Struktura

```text
src/                    agent, scoring, normalizace, zdroje
public/                 statický web a publikovaná data
data/manual/            volitelné ruční tipy
data/fixtures/          reprodukovatelná testovací data
tests/                  automatické testy
.github/workflows/      denní běh a GitHub Pages
docs/                   provozní dokumentace
```

## Licence a odpovědnost

Kód lze licencovat dle rozhodnutí 4ALL. Data pocházejí z odkazovaných veřejných zdrojů; rozhodující je vždy aktuální znění na profilu zadavatele.
