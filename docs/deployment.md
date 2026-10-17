# Nasazení `vyberka.4all.cz`

## Aktuální provoz

Repozitář je `PaulCeap/4all-vyberka`. GitHub Actions denně spustí sběr a případnou změnu `public/data/tenders.json` uloží do větve `main`. VPS pravidelně synchronizuje tuto větev a publikuje pouze podadresář `public/` do `/srv/4all/4all-vyberka/current`. Caddy obsluhuje HTTPS na `vyberka.4all.cz`; DNS subdomény směřuje na VPS, nikoli na GitHub Pages.

Na serveru běží synchronizace přes `4all-sync.timer` a `4all-sync.service`. Nasazený commit lze zkontrolovat v `/var/lib/4all-deploy/4all-vyberka-deployed.json`. Konfigurace synchronizace a Caddy je ve společném nasazovacím projektu 4all. Workflow GitHub Pages a `public/CNAME` zůstávají v repozitáři jako záložní cesta, ale živou doménu nyní neobsluhují.

## Ověření

1. V GitHub Actions zkontrolujte poslední běh `Denní monitoring zakázek`.
2. V `public/data/tenders.json` ověřte `generatedAt`, stav jednotlivých `sources` a `stats.invalidRows`.
3. Na serveru porovnejte `revision` v nasazovacím potvrzení s posledním commitem `main`.
4. Na webu ověřte čas aktualizace, odkaz na zdroj a skutečnou lhůtu alespoň jednoho tipu.

## Běžná správa

- Vahy a slovník: `src/config.mjs`.
- Publikační práh: proměnná `MIN_RELEVANCE_SCORE` ve workflow nebo hodnota v konfiguraci.
- Ruční tipy: JSON v `data/manual/`.
- Čas běhu: `cron` v `.github/workflows/daily-agent.yml` je v UTC.

## E-mailové upozornění na nové příležitosti

Po denním sběru může workflow poslat jeden souhrnný e-mail. Odesílá se pouze tehdy, když agent v aktuálním běhu poprvé zachytí alespoň jednu relevantní položku. Používá [Resend Email API](https://resend.com/docs/api-reference/emails/send-email); repozitář neobsahuje API klíč ani adresy příjemců.

1. V Resend ověřte odesílací doménu, například `4all.cz`, a vytvořte API klíč s oprávněním pouze k odesílání.
2. V GitHubu otevřete **Settings → Secrets and variables → Actions**.
3. Do **Repository secrets** přidejte:
   - `RESEND_API_KEY` — API klíč služby Resend;
   - `ALERT_EMAILS` — jednu nebo více adres oddělených čárkou.
4. Do **Repository variables** přidejte `RESEND_FROM`, například `4ALL Výběrka <vyberka@4all.cz>`.
5. Ručně spusťte workflow. Pokud v běhu není nová položka, správně se vypíše, že se e-mail neposílá.

Bez těchto tří hodnot denní sběr a nasazení fungují dál; pouze se přeskočí e-mail. Lokální náhled obsahu lze vypsat příkazem `npm run notify:dry-run` po běhu agenta.

Samotný web a výsledný JSON jsou veřejně dostupné; nevkládejte do nich neveřejné obchodní poznámky ani osobní hodnocení.
