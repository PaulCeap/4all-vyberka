const state = {
  tenders: [],
  query: "",
  category: "all",
  type: "all",
  minScore: 42,
  sort: "score",
  savedOnly: false,
  saved: new Set(JSON.parse(localStorage.getItem("4all-saved-tenders") || "[]")),
  expanded: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const list = $("#tender-list");

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character]));

const formatDate = (value, includeTime = false) => {
  if (!value) return "Neuvedeno";
  return new Intl.DateTimeFormat("cs-CZ", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
};

const formatMoney = (value) => {
  if (!value?.amount) return "Neuvedeno";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency", currency: value.currency || "CZK", maximumFractionDigits: 0,
  }).format(value.amount);
};

const sourceLabel = (source) => ({
  "zakazky-gov": "Zakázky GOV", nen: "NEN", ted: "TED", manual: "Ruční tip",
  poptavky: "Poptávky.cz", poptavej: "Poptávej.cz", mediaguru: "MediaGuru",
  mediar: "Médiář", mam: "MAM",
  "ezak-sz": "E-ZAK Správa železnic",
}[source] || source);
const typeLabel = (type) => ({
  "public-tender": "Veřejná zakázka", "commercial-demand": "Poptávka", "market-signal": "Komerční tendr",
}[type] || "Příležitost");

function filteredTenders() {
  const query = state.query.toLocaleLowerCase("cs").trim();
  return state.tenders
    .filter((tender) => tender.relevance.score >= state.minScore)
    .filter((tender) => state.category === "all" || tender.relevance.categories.some((category) => category.id === state.category))
    .filter((tender) => state.type === "all" || tender.opportunityType === state.type)
    .filter((tender) => !state.savedOnly || state.saved.has(tender.id))
    .filter((tender) => !query || `${tender.title} ${tender.buyer} ${tender.summary}`.toLocaleLowerCase("cs").includes(query))
    .sort((a, b) => {
      if (state.sort === "deadline") return (a.deadline || "9999").localeCompare(b.deadline || "9999");
      if (state.sort === "newest") return (b.publishedAt || b.firstSeenAt).localeCompare(a.publishedAt || a.firstSeenAt);
      return b.relevance.score - a.relevance.score;
    });
}

function cardTemplate(tender) {
  const scoreColor = tender.relevance.score >= 75 ? "#1c9c66" : tender.relevance.score >= 55 ? "#ff7043" : "#a9872b";
  const isNew = Date.now() - new Date(tender.firstSeenAt).valueOf() < 36 * 60 * 60 * 1000;
  const isSaved = state.saved.has(tender.id);
  const isExpanded = state.expanded.has(tender.id);
  const summary = tender.summary || "Zdroj neposkytl stručný popis. Ověřte zadávací dokumentaci.";
  const canExpand = summary.length > 210;
  const summaryId = `summary-${tender.id}`;
  const days = tender.relevance.deadlineDays;
  const deadlineLabel = days === null ? "Neuvedeno" : days < 0 ? "Po termínu" : days === 0 ? "Dnes" : `${days} ${days === 1 ? "den" : days < 5 ? "dny" : "dní"}`;
  return `
    <article class="tender-card" data-id="${escapeHtml(tender.id)}">
      <div class="score" style="--score:${tender.relevance.score};--score-color:${scoreColor}" aria-label="Shoda ${tender.relevance.score} ze 100">
        <strong>${tender.relevance.score}</strong><span>shoda</span>
      </div>
      <div class="card-main">
        <div class="card-meta">
          <span class="source-tag">${escapeHtml(sourceLabel(tender.source))}</span>
          <span class="type-tag type-${escapeHtml(tender.opportunityType)}">${escapeHtml(typeLabel(tender.opportunityType))}</span>
          ${isNew ? '<span class="new-tag">Nové</span>' : ""}
        </div>
        <h3>${escapeHtml(tender.title)}</h3>
        <p class="buyer">${escapeHtml(tender.buyer)}</p>
        <p class="summary${isExpanded ? " expanded" : ""}" id="${escapeHtml(summaryId)}">${escapeHtml(summary)}</p>
        ${canExpand ? `<button class="summary-toggle" type="button" data-expand="${escapeHtml(tender.id)}" aria-controls="${escapeHtml(summaryId)}" aria-expanded="${isExpanded}">${isExpanded ? "Skrýt popis ↑" : "Zobrazit více ↓"}</button>` : ""}
        <div class="match-tags">${tender.relevance.categories.map((category) => `<span>${escapeHtml(category.label)}</span>`).join("")}</div>
        ${tender.relevance.reasons[0] ? `<p class="reason">${escapeHtml(tender.relevance.reasons[0])}</p>` : ""}
      </div>
      <div class="card-side">
        <div>
          <div class="side-row ${days !== null && days <= 7 ? "deadline-soon" : ""}"><span>Deadline</span><strong>${escapeHtml(deadlineLabel)}</strong></div>
          <div class="side-row"><span>Termín</span><strong>${escapeHtml(formatDate(tender.deadline))}</strong></div>
          <div class="side-row"><span>Hodnota</span><strong>${escapeHtml(formatMoney(tender.value))}</strong></div>
          <div class="side-row"><span>Zveřejněno</span><strong>${escapeHtml(formatDate(tender.publishedAt))}</strong></div>
        </div>
        <a class="source-link" href="${escapeHtml(tender.url)}" target="_blank" rel="noreferrer">Otevřít u zdroje ↗</a>
      </div>
      <button class="save-button" type="button" aria-label="${isSaved ? "Odebrat z uložených" : "Uložit zakázku"}" aria-pressed="${isSaved}" data-save="${escapeHtml(tender.id)}">${isSaved ? "★" : "☆"}</button>
    </article>`;
}

function render() {
  const items = filteredTenders();
  list.innerHTML = items.map(cardTemplate).join("");
  list.setAttribute("aria-busy", "false");
  $("#result-count").textContent = `${items.length} ${items.length === 1 ? "zakázka" : items.length < 5 ? "zakázky" : "zakázek"} odpovídá filtru`;
  $("#empty-state").hidden = items.length > 0;
  list.hidden = items.length === 0;
}

function resetFilters() {
  state.query = "";
  state.category = "all";
  state.type = "all";
  state.minScore = 42;
  state.savedOnly = false;
  $("#search").value = "";
  $("#score-filter").value = "42";
  $("#type-filter").value = "all";
  $("#saved-filter").setAttribute("aria-pressed", "false");
  $("#saved-filter").textContent = "☆ Uložené";
  document.querySelectorAll(".chip").forEach((chip) => {
    const active = chip.dataset.category === "all";
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  render();
}

async function init() {
  try {
    const response = await fetch("./data/tenders.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dataset = await response.json();
    state.tenders = dataset.tenders || [];
    $("#stat-total").textContent = dataset.stats?.total ?? state.tenders.length;
    $("#stat-strong").textContent = dataset.stats?.strong ?? "0";
    $("#stat-soon").textContent = dataset.stats?.closingSoon ?? "0";
    $("#updated-at").textContent = `Aktualizováno ${formatDate(dataset.generatedAt, true)}`;
    render();
  } catch (error) {
    list.innerHTML = `<div class="empty-state"><span>!</span><h3>Data se nepodařilo načíst.</h3><p>Zkuste stránku obnovit. Pokud problém trvá, zkontrolujte poslední denní běh.</p></div>`;
    list.setAttribute("aria-busy", "false");
    $("#updated-at").textContent = "Aktualizace není dostupná";
  }
}

$("#search").addEventListener("input", (event) => { state.query = event.target.value; render(); });
$("#score-filter").addEventListener("change", (event) => { state.minScore = Number(event.target.value); render(); });
$("#type-filter").addEventListener("change", (event) => { state.type = event.target.value; render(); });
$("#sort").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
$("#saved-filter").addEventListener("click", (event) => {
  state.savedOnly = !state.savedOnly;
  event.currentTarget.setAttribute("aria-pressed", String(state.savedOnly));
  event.currentTarget.textContent = state.savedOnly ? "★ Jen uložené" : "☆ Uložené";
  render();
});
$("#category-chips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-category]");
  if (!chip) return;
  state.category = chip.dataset.category;
  document.querySelectorAll(".chip").forEach((item) => {
    const active = item === chip;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  render();
});
list.addEventListener("click", (event) => {
  const expandButton = event.target.closest("[data-expand]");
  if (expandButton) {
    const id = expandButton.dataset.expand;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    render();
    document.querySelector(`[data-expand="${CSS.escape(id)}"]`)?.focus();
    return;
  }
  const button = event.target.closest("[data-save]");
  if (!button) return;
  const id = button.dataset.save;
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  localStorage.setItem("4all-saved-tenders", JSON.stringify([...state.saved]));
  render();
});
$("#reset-filters").addEventListener("click", resetFilters);

init();
