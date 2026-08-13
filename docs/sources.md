# Zdroje dat a limity

## Hlavní oficiální zdroje

### Zakázky GOV

- Hlavní zdroj projektu: státní portál [Zakázky GOV](https://zakazky.gov.cz/verejne-zakazky).
- Výchozí endpoint poskytuje nové zakázky za posledních 24 hodin napříč zapojenými systémy.
- Vrací NIPEZ identifikátor, název, zadavatele, popis, datum publikace, lhůtu a stav.
- Denní workflow je záměrně navázané na 24hodinové okno. Při plánované odstávce delší než den je vhodné workflow po obnově doplnit ručními tipy.

### TenderArena

- Agent čte přímo veřejný seznam nově uveřejněných zakázek z API TenderArena.
- Ukládá systémové číslo, zadavatele, lhůtu a přímý veřejný detail v TenderArena.
- Přímý adaptér je záměrný i přes překryv se Zakázky GOV: slouží jako kontrola výpadků, rychlá cesta k originálu a další vstup pro deduplikaci.

### E-ZAK Jihomoravského kraje a další profily

- Přímý watchlist obsahuje [E-ZAK Jihomoravského kraje](https://zakazky.krajbezkorupce.cz/), který zahrnuje kraj, jeho příspěvkové organizace a centrální nákupy CEJIZA.
- Přímo se kontroluje také profil Správy železnic. Každý profil selhává izolovaně, takže odstávka jednoho nezastaví ostatní.
- Další krajské či městské E-ZAK profily lze přidat jedním záznamem do `PROFILES` v `src/sources/ezak-watchlist.mjs`.

## Další oficiální zdroje

### TED

- Oficiální Search API Úředního věstníku EU: `POST https://api.ted.europa.eu/v3/notices/search`.
- Nevyžaduje autentizaci.
- Dotaz vybírá soutěžní oznámení českých zadavatelů za posledních osm dní.
- Zachytí hlavně nadlimitní zakázky, proto doplňuje, ale nenahrazuje český agregátor.
- API může vracet několik lotů; adaptér vezme nejbližší lhůtu a sloučí popisy.

### NEN

- Veřejný seznam Národního elektronického nástroje doplňuje hlavně zakázky malého rozsahu.
- Adaptér používá několik úzkých dotazů podle služeb 4ALL, spojí výsledky a stáhne nejvýše 60 detailů za běh.
- Z detailu čte popis, CPV, předpokládanou hodnotu, datum publikace a lhůtu. Vše následně projde stejným scoringem; samotná shoda vyhledávacího dotazu nestačí k publikaci.

## Poptávky.cz a Poptávej.cz: pouze radar

- Agent denně čte veřejně dostupné kategorie reklamy a tisku, ale tyto weby nepovažuje za původní zdroj.
- U relevantního tipu nejprve hledá konkrétní odchozí odkaz na oficiální profil. Když chybí, porovná název, identifikátor, lhůtu a hodnotu s položkami ze Zakázky GOV, TenderArena, NEN, TED a E-ZAK.
- Při bezpečné shodě karta odkazuje přímo na originál a jen uvádí „zachyceno přes Poptávky.cz/Poptávej.cz“.
- Když se původ nepodaří spolehlivě určit, tip může zůstat v přehledu, ale je výrazně označený jako neověřený a tlačítko nepředstírá, že vede na zadavatele.
- Kontakty za paywallem agregátorů nejsou součástí sběru a agent se je nepokouší obcházet.

## MediaGuru, Médiář a Marketing & Media

- RSS kanály se kontrolují na aktivní formulace jako „hledá agenturu“ nebo „vyhlašuje tendr“.
- Oznámení o již vybraném vítězi se vyřazují. Tyto položky jsou označené jako komerční tendry / mediální signály.
- Protože často nemají veřejný deadline, zůstávají v přehledu nejvýše 120 dní a před reakcí vyžadují ruční ověření.

## Ruční vstup

`data/manual/*.json` slouží pro tipy z e-mailových upozornění, menších profilů nebo placených databází. Agent tyto záznamy zpracuje úplně stejným scoringem a deduplikací.

## Právní a provozní poznámka

Web zobrazuje pouze pracovní výběr a odkazuje na původní zdroj. Nenahrazuje zadávací dokumentaci ani kontrolu změn, vysvětlení a prodloužení lhůt. Pro produkční provoz doporučujeme jednou měsíčně zkontrolovat dostupnost endpointů a výsledky na vzorku známých zakázek.
