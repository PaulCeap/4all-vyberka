# Zdroje dat a limity

## Zakázky GOV

- Oficiální český agregátor na `zakazky.gov.cz`.
- Výchozí endpoint poskytuje nové zakázky za posledních 24 hodin napříč zapojenými systémy.
- Vrací NIPEZ identifikátor, název, zadavatele, popis, datum publikace, lhůtu a stav.
- Denní workflow je záměrně navázané na 24hodinové okno. Při plánované odstávce delší než den je vhodné workflow po obnově doplnit ručními tipy.

## TED

- Oficiální Search API Úředního věstníku EU: `POST https://api.ted.europa.eu/v3/notices/search`.
- Nevyžaduje autentizaci.
- Dotaz vybírá soutěžní oznámení českých zadavatelů za posledních osm dní.
- Zachytí hlavně nadlimitní zakázky, proto doplňuje, ale nenahrazuje český agregátor.
- API může vracet několik lotů; adaptér vezme nejbližší lhůtu a sloučí popisy.

## NEN

- Veřejný seznam Národního elektronického nástroje doplňuje hlavně zakázky malého rozsahu.
- Adaptér používá několik úzkých dotazů podle služeb 4ALL, spojí výsledky a stáhne nejvýše 60 detailů za běh.
- Z detailu čte popis, CPV, předpokládanou hodnotu, datum publikace a lhůtu. Vše následně projde stejným scoringem; samotná shoda vyhledávacího dotazu nestačí k publikaci.

## Poptávky.cz a Poptávej.cz

- Agent denně čte veřejně dostupné kategorie reklamy a tisku a načte detaily nejnovějších položek.
- Zachytí veřejné zakázky malého rozsahu i komerční poptávky, které nemusí být v NEN nebo TED.
- Kontaktní údaje mohou být dostupné až po přihlášení; přehled proto vždy odkazuje na původní detail.

## E-ZAK, TenderArena a profily zadavatelů

- Profil Správy železnic v E-ZAK je sledován přímo v seznamu otevřených nabídek.
- Další E-ZAK profily a TenderArena jsou pokryté především přes oficiální agregátor Zakázky GOV; přímé profily lze doplňovat do watchlistu podle obchodní priority.

## MediaGuru, Médiář a Marketing & Media

- RSS kanály se kontrolují na aktivní formulace jako „hledá agenturu“ nebo „vyhlašuje tendr“.
- Oznámení o již vybraném vítězi se vyřazují. Tyto položky jsou označené jako komerční tendry / mediální signály.
- Protože často nemají veřejný deadline, zůstávají v přehledu nejvýše 120 dní a před reakcí vyžadují ruční ověření.

## Ruční vstup

`data/manual/*.json` slouží pro tipy z e-mailových upozornění, menších profilů nebo placených databází. Agent tyto záznamy zpracuje úplně stejným scoringem a deduplikací.

## Právní a provozní poznámka

Web zobrazuje pouze pracovní výběr a odkazuje na původní zdroj. Nenahrazuje zadávací dokumentaci ani kontrolu změn, vysvětlení a prodloužení lhůt. Pro produkční provoz doporučujeme jednou měsíčně zkontrolovat dostupnost endpointů a výsledky na vzorku známých zakázek.
