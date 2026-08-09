# Nasazení na GitHub Pages a `vyberka.4all.cz`

## 1. Vytvoření GitHub repozitáře

V GitHubu vytvořte prázdný repozitář, například `4all-vyberka`. Potom z lokální složky nastavte vzdálený repozitář a odešlete větev `main`:

```bash
git remote add origin git@github.com:VASE-ORGANIZACE/4all-vyberka.git
git branch -M main
git push -u origin main
```

Pokud používáte HTTPS, nahraďte SSH adresu HTTPS adresou z GitHubu.

## 2. Zapnutí GitHub Pages

V repozitáři otevřete **Settings → Pages** a u **Build and deployment / Source** zvolte **GitHub Actions**. Workflow `Nasazení webu` vytvoří a publikuje web automaticky při každém pushi do `main`.

V **Settings → Actions → General → Workflow permissions** povolte **Read and write permissions**, aby denní agent mohl commitovat aktualizovaný JSON.

## 3. DNS subdomény

U správce DNS zóny `4all.cz` vytvořte:

| Typ | Název | Hodnota |
|---|---|---|
| `CNAME` | `vyberka` | `VASE-ORGANIZACE.github.io` |

Tečku na konci cíle použijte podle požadavků DNS správce. Soubor `public/CNAME` už obsahuje `vyberka.4all.cz`.

Po propagaci DNS se v **Settings → Pages → Custom domain** musí zobrazit `vyberka.4all.cz`. Zapněte **Enforce HTTPS**; nabídka se může objevit až po vystavení certifikátu.

## 4. Ověření

1. V **Actions** musí být zelené workflow `Denní monitoring zakázek` i `Nasazení webu`.
2. Ručně spusťte denní monitoring přes **Run workflow**.
3. Zkontrolujte, že se změnil `public/data/tenders.json` a proběhlo nové nasazení.
4. Na webu ověřte čas aktualizace, odkazy na zdroje a jeden známý relevantní tip.

## 5. Běžná správa

- Vahy a slovník: `src/config.mjs`.
- Publikační práh: proměnná `MIN_RELEVANCE_SCORE` ve workflow nebo hodnota v konfiguraci.
- Ruční tipy: JSON v `data/manual/`.
- Čas běhu: `cron` v `.github/workflows/daily-agent.yml` je v UTC.

Repozitář může být veřejný i soukromý podle tarifu a pravidel organizace. Samotný web a výsledný JSON jsou při GitHub Pages veřejně dostupné; nevkládejte do nich neveřejné obchodní poznámky ani osobní hodnocení.
