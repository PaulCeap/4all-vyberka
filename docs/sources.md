# Zdroje dat a limity

## Co znamená nalezený a ověřený tip

Sběr původního záznamu a posouzení, zda jde o marketingový nebo komunikační tendr, jsou dvě různé kontroly. `originStatus: verified` znamená, že záznam přišel přímo z původního systému nebo oficiálního oznámení. `originStatus: resolved` znamená, že tip z agregátoru byl spárován s konkrétním původním záznamem (shoda alespoň 72 bodů bez nejednoznačného konkurenta). Ani jeden stav nepotvrzuje oborovou vhodnost nebo splnění kvalifikace.

Před bodovým řazením se ověřuje věcný předmět: marketing, PR a vztahy s médii, komunikace, obsah, grafické a produkční služby, samostatná výroba videí, podcastů a fotografií, eventy a související strategie či školení. Zakázka nemusí být součástí kampaně. Samotná vedlejší zmínka o videu, textu nebo fotografii nestačí; pozice externího redaktora či provoz novin jsou mimo záběr. `scoreTender` potom řadí způsobilé kandidáty z popisu a případného ověřeného výtahu. Název a CPV slouží v prvním průchodu k nalezení kandidáta; samy o sobě veřejnou kartu nezaloží. Veřejný práh je 42 bodů. Konkrétní obchodní nebo kvalifikační vhodnost se automaticky nepotvrzuje.

## Hlavní oficiální zdroje

### Zakázky GOV

- Hlavní zdroj projektu: státní portál [Zakázky GOV](https://zakazky.gov.cz/verejne-zakazky).
- Výchozí endpoint poskytuje nové zakázky za posledních 24 hodin napříč zapojenými systémy.
- Vrací NIPEZ identifikátor, název, zadavatele, popis, datum publikace, lhůtu a stav.
- Denní feed doplňují přímé dotazy do zdrojových profilů (zejména NEN a E-ZAK), které kontrolují i starší stále otevřené zakázky. Tím se pokryje první spuštění projektu i výpadek delší než 24 hodin.

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
- Zachytí hlavně nadlimitní zakázky. Oznámení je oficiální zdroj a zároveň vodítko ke konkrétnímu profilu zadavatele; pokud profil najdeme, karta vede přímo na něj.
- API může vracet několik lotů; adaptér vezme nejbližší lhůtu včetně času, sloučí popisy a přečte odkazy na profil a dokumentaci.

### E-ZAKAZKY

- Je-li v oznámení TED odkaz na profil v E-ZAKAZKY, agent na profilu vyhledá konkrétní zakázku, přečte její detail, aktuální lhůtu a seznam příloh.
- Veřejná karta pak odkazuje na zakázku na profilu zadavatele; oznámení TED slouží jako doplňující oficiální popis, pokud profil vlastní souhrn nemá.

### NEN

- Veřejný seznam Národního elektronického nástroje doplňuje hlavně zakázky malého rozsahu.
- Adaptér používá 20 cílených dotazů podle služeb 4ALL, včetně videa, natáčení, podcastů a focení, a stáhne nejvýše 80 detailů za běh. Limit rozděluje napříč dotazy po jednotlivých pozicích, takže širší výraz nemůže vytlačit pozdější specializované dotazy. Dotazy běží postupně, protože souběžné dotazy NEN vracely chybu 503; timeout jednoho nezahodí ostatní výsledky.
- Z detailu čte popis, CPV, předpokládanou hodnotu, datum publikace a lhůtu. Vše následně projde stejným scoringem; samotná shoda vyhledávacího dotazu nestačí k publikaci.

### Profily Proebiz

- Agent kontroluje poslední tři stránky veřejného seznamu původních profilů zadavatelů na [Proebiz](https://profily.proebiz.com/verejne-zakazky) a u stále otevřených zakázek čte přímo detail, popis, lhůtu a seznam příloh.
- Tím zachytí i menší zakázky, které v dosavadních sledovaných nástrojích nebyly. Starší otevřené zakázky, které ze seznamu vypadnou, se kontrolují přes uložený přímý odkaz.

## Poptávky.cz a Poptávej.cz: pouze radar

- Agent denně čte veřejně dostupné kategorie reklamy a tisku, ale tyto weby nepovažuje za původní zdroj.
- U tipu nejprve hledá konkrétní odchozí odkaz na profil zadavatele. Podporovaný profil otevře a přečte jeho detail. Jinak porovná název, identifikátor, zadavatele, lhůtu a hodnotu s položkami z oficiálních zdrojů; u dosud nenalezených veřejných zakázek zkusí i cílené hledání v NEN.
- Do veřejného přehledu a bodování vstupují jen údaje získané z původního nebo jiného oficiálního zdroje. Text ani odhad ceny agregátoru se do ověřeného záznamu nekopírují. Veřejný datový soubor neobsahuje ani název a odkaz agregátoru; informace o cestě nalezení zůstává pouze v interní evidenci.
- Nejednoznačné a nedohledané tipy zůstávají v `data/radar-leads.json` pro další denní pokus; na webu se nezobrazí.
- Kontakty za paywallem agregátorů nejsou součástí sběru a agent se je nepokouší obcházet.

## MediaGuru, Médiář a Marketing & Media

- RSS kanály se kontrolují na aktivní formulace jako „hledá agenturu“, „vybírá partnera“ nebo „vypsala tendr“. Vedle obecného kanálu MediaGuru se čtou jeho tematické kanály marketingu, reklamy a PR; duplicitní články se sloučí podle odkazu.
- Článek je samostatný zdroj zprávy o komerčním tendru. U těchto médií se nevyžaduje veřejná stránka zadavatele; ta ani nemusí existovat. Původ se interně označuje `media-report`, nikoli jako ověřené úřední zadání.
- Oznámení o již vybraném vítězi se vyřazují. Tyto položky jsou označené jako komerční tendry / mediální signály.
- Protože často nemají veřejný deadline, zůstávají v přehledu nejvýše 120 dní a před reakcí vyžadují ruční ověření.

## Ruční vstup

`data/manual/*.json` slouží pro tipy z e-mailových upozornění, menších profilů nebo placených databází. Agent tyto záznamy zpracuje úplně stejným scoringem a deduplikací.

## Právní a provozní poznámka

Web zobrazuje pouze pracovní výběr a odkazuje na původní zdroj. Nenahrazuje zadávací dokumentaci ani kontrolu změn, vysvětlení a prodloužení lhůt. Pro produkční provoz doporučujeme jednou měsíčně zkontrolovat dostupnost endpointů a výsledky na vzorku známých zakázek.
