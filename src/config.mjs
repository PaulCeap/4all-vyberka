export const PROJECT = {
  name: "4ALL Výběrka",
  siteUrl: "https://vyberka.4all.cz",
  country: "CZE",
  minimumScore: Number(process.env.MIN_RELEVANCE_SCORE || 42),
  historyDays: Number(process.env.HISTORY_DAYS || 45),
  signalHistoryDays: Number(process.env.SIGNAL_HISTORY_DAYS || 120),
  tedLookbackDays: Number(process.env.TED_LOOKBACK_DAYS || 8),
};

export const SERVICE_AREAS = [
  {
    id: "content",
    label: "Tvorba obsahu",
    keywords: [
      ["tvorba obsahu", 18], ["obsahová strategie", 16], ["copywriting", 15],
      ["video", 9], ["podcast", 13], ["fotograf", 9], ["redakční", 10],
      ["sociální sítě", 15], ["social media", 15], ["audiovizuální", 11],
      ["tisková zpráva", 12], ["newsletter", 10], ["grafické práce", 10],
      ["tiskových zpráv", 12], ["sociálních sítí", 15], ["marketingového obsahu", 12],
    ],
    cpvPrefixes: ["7934", "921", "923122", "798225", "799610"],
  },
  {
    id: "pr",
    label: "PR & komunikace",
    keywords: [
      ["public relations", 20], ["pr služby", 18], ["mediální komunikace", 18],
      ["krizová komunikace", 18], ["komunikační strategie", 18],
      ["komunikační kampaň", 17], ["vztahy s médii", 17], ["media relations", 17],
      ["interní komunikace", 14], ["komunikační služby", 12], ["propagace", 9],
      ["tiskových zpráv", 12], ["komunikace s redakcemi", 14],
      ["komunikace s veřejností", 16], ["komunikačních aktivit", 12],
    ],
    cpvPrefixes: ["794162", "79341", "793414"],
  },
  {
    id: "marketing",
    label: "Marketing & eventy",
    keywords: [
      ["marketingová kampaň", 18], ["marketingové služby", 17], ["marketingová strategie", 17],
      ["marketingové strategie", 17], ["marketingových aktivit", 12], ["reklamních kampaní", 16],
      ["reklamní kampaň", 16], ["kreativní kampaň", 17], ["branding", 15],
      ["mediální prostor", 17], ["mediálního prostoru", 17], ["media buying", 17], ["influencer", 14],
      ["event", 12], ["konference", 10], ["produkce akce", 14],
      ["eventová agentura", 20], ["festival", 9], ["sampling", 11],
      ["organizace akce", 14], ["veřejná akce", 9], ["ppc", 12], ["online reklama", 13],
    ],
    cpvPrefixes: ["79342", "7934", "7995", "79952", "79956"],
  },
  {
    id: "strategy",
    label: "Strategie & analýzy",
    keywords: [
      ["marketingový výzkum", 16], ["analýza trhu", 15], ["komunikační audit", 17],
      ["mediální analýza", 17], ["strategické poradenství", 13], ["strategie značky", 17],
      ["výzkum veřejného mínění", 16], ["průzkum veřejného mínění", 16],
      ["marketingová analýza", 16], ["evaluace kampaně", 15],
    ],
    cpvPrefixes: ["7931", "79311", "79315", "79413"],
  },
  {
    id: "ai",
    label: "AI & automatizace",
    keywords: [
      ["umělá inteligence", 16], ["artificial intelligence", 16], ["generativní ai", 19],
      ["automatizace obsahu", 20], ["automatizace marketingu", 20], ["ai školení", 19],
      ["chytrý asistent", 15], ["chatbot", 12], ["ai strategie", 18],
    ],
    cpvPrefixes: [],
  },
  {
    id: "training",
    label: "Školení & media training",
    keywords: [
      ["mediální trénink", 22], ["media training", 22], ["školení komunikace", 19],
      ["prezentační dovednosti", 17], ["komunikační dovednosti", 16],
      ["školení marketingu", 18], ["školení sociálních sítí", 19],
      ["moderování", 11], ["workshop komunikace", 18],
    ],
    cpvPrefixes: ["8051", "805220"],
  },
];

export const NEGATIVE_SIGNALS = [
  ["stavební práce", 38], ["rekonstrukce", 32], ["projektová dokumentace stavby", 30],
  ["úklidové služby", 35], ["dodávka vozidel", 35], ["zdravotnický materiál", 35],
  ["právní služby", 32], ["účetní audit", 26], ["kybernetická bezpečnost", 24],
  ["penetration test", 30], ["penetrační test", 30], ["softwarové licence", 28],
  ["dodávka hardware", 30], ["pojištění", 30], ["stravování", 30],
];

export const NATIONAL_SEARCH_URL =
  "https://api.isd.nipez.cz/isd/seznam/zakazek/zakazky-za-24-hodin";
export const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";
