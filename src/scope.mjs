import { searchable } from "./model.mjs";

const eventNoun = String.raw`(?:akc(?:e|i|ich|im|emi)|konferenc(?:e|i|ich|im|emi)|seminar(?:e|u|um|ich|em|y)|workshop(?:u|y|um|ech|em)?|zasedan(?:i|im))`;

// Věcný předmět zakázky je oddělený od bodového řazení i od ověření zdroje.
const SERVICES = [
  {
    id: "marketing",
    patterns: [
      /\b(?:marketingov\w*|reklamn\w*)\s+(?:kampan\w*|sluzb\w*|strateg\w*|aktiv\w*)\b/,
      /\b(?:branding|strategie znack\w*|medialn\w* prostor\w*|nakup medii|media buying|reklamn\w* ploch\w*|online reklam\w*|ppc kampan\w*)\b/,
      /\b(?:eventov\w* agentur\w*|eventov\w* marketing|produkce akc\w*|produkce event\w*|produkcni zajisteni akc\w*|produkcni zajisteni konferenc\w*|organizac\w* akc\w*|organizac\w* event\w*|organizac\w* konferenc\w*)\b/,
      /\b(?:zajisten\w*|organizac\w*|realizac\w*)\s+eventov\w* akc\w*\b/,
      new RegExp(String.raw`\b(?:technick\w* a organizacn\w*|organizacn\w* a technick\w*) (?:zajisten\w*|podpor\w*)\b[^.!?;]{0,65}\b${eventNoun}\b`),
      new RegExp(String.raw`\b(?:poradan\w*|organizacn\w* zajisten\w*)\s+${eventNoun}\b`),
      /\b(?:zajisten\w*|organizac\w*|produkce)\s+(?:mezinarodn\w*\s+|zaverecn\w*\s+|odborn\w*\s+)?konferenc(?:e|i|im|ich|emi)\b/,
    ],
  },
  {
    id: "pr",
    patterns: [
      /\b(?:public relations|pr sluzb\w*|pr agentur\w*|vztah\w* s medi\w*|media relations|medialn\w* komunikac\w*|medialn\w* monitoring\w*|krizov\w* komunikac\w*)\b/,
      /\b(?:komunikacn\w*)\s+(?:kampan\w*|strateg\w*|sluzb\w*|aktiv\w*|audit\w*)\b/,
      /\b(?:tiskov\w* zpr\w*)\b/,
      /\bmonitoring\w*\s+(?:medi\w*|tisk\w*|socialn\w* sit\w*)\b/,
      /\banalyz\w*\s+medialn\w*\s+obsah\w*\b/,
    ],
  },
  {
    id: "content",
    patterns: [
      /\b(?:sprav\w* socialn\w* sit\w*|sprav\w* social media|tvorb\w* obsahu|tvorb\w* text\w*|tvorb\w* newsletter\w*|obsahov\w* strateg\w*|copywriting|grafick\w* prac\w*|grafick\w* sluzb\w*)\b/,
      /\b(?:grafick\w* priprav\w*|priprav\w* grafick\w* material\w*|grafick\w* zpracovan\w*)\b/,
    ],
  },
  {
    id: "strategy",
    patterns: [
      /\b(?:marketingov\w* vyzkum\w*|analyz\w* trhu|medialn\w* analyz\w*|evaluac\w* kampan\w*|vyzkum\w* verejn\w* minen\w*)\b/,
      /\b(?:vyzkum\w*|pruzkum\w*) trhu\b/,
    ],
  },
  {
    id: "training",
    patterns: [
      /\b(?:medialn\w* trenink\w*|media training|skolen\w* marketing\w*|skolen\w* komunikac\w*|skolen\w* socialn\w* sit\w*)\b/,
    ],
  },
  {
    id: "ai",
    patterns: [/\b(?:automatizac\w* marketing\w*|automatizac\w* obsahu)\b/],
  },
];

const creativeAction = String.raw`(?:vyrob\w*|tvorb\w*|produk\w*|natac\w*|nahrav\w*|strih\w*|postproduk\w*|poriz\w*)`;
const genericAction = String.raw`(?:zajist\w*|zpracov\w*|dodavk\w*|realizac\w*)`;
const productionOutput = String.raw`(?:video|videa|videi|videu|videem|videoklip\w*|videospot\w*|film\w*|spot|spoty|spotu|podcast\w*|fotograf\w*|fotek|fotka\w*|grafick\w* vystup\w*)`;
const PRODUCTION = [
  new RegExp(String.raw`\b${creativeAction}\b[^.!?;]{0,55}\b${productionOutput}\b`),
  new RegExp(String.raw`\b${genericAction}\b[^.!?;]{0,16}\b${productionOutput}\b`),
  /\bprodukcn\w* zajisten\w* (?:natacen\w*|focen\w*|fotografovan\w*|podcast\w*|film\w*|vide\w*)\b/,
  /\b(?:videoprodukc\w*|podcastov\w* produkc\w*|audiovizualn\w* produkc\w*|audiovizualn\w* obsah\w*|fotografick\w* sluzb\w*|fotografovan\w*|focen\w*|videospot\w*|reklamn\w* spot\w*)\b/,
  new RegExp(String.raw`\b${productionOutput}\b[^.!?;]{0,25}\b${creativeAction}\b`),
];

const OUTSIDE = [
  /\bexterni redaktor\b/,
];

function matches(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

export function assessScope(tender) {
  const title = searchable(tender.title);
  const content = searchable(`${tender.summary || ""} ${tender.factsReviewedAt
    ? (tender.verifiedFacts || []).map((fact) => fact.text).join(" ") : ""}`);
  const device = /\b(?:bronchoskop|endoskop|gastroskop|kolonoskop)\w*\b/.test(title) ||
    /\b(?:pc|pocitac\w*|notebook\w*|videotechnik\w*)\b/.test(title) &&
    /dodavk|nakup|porizen|^(?:pc|pocitac\w*|notebook\w*|videotechnik\w*)\b/.test(title);
  const excluded = device || matches(OUTSIDE, `${title} ${content}`);
  const titleAreas = SERVICES.filter((service) => matches(service.patterns, title)).map((service) => service.id);
  const contentAreas = SERVICES.filter((service) => matches(service.patterns, content)).map((service) => service.id);
  if (matches(PRODUCTION, title)) titleAreas.push("content");
  if (matches(PRODUCTION, content)) contentAreas.push("content");
  return {
    eligible: !excluded && Boolean(titleAreas.length || contentAreas.length),
    contentAreas: excluded ? [] : [...new Set(contentAreas)],
    excluded,
  };
}
