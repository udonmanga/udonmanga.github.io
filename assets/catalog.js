(() => {
  "use strict";

  const CATEGORY_LABELS = {
    all: "All",
    series: "Series",
    anthology: "Anthologies",
    oneshot: "Oneshots",
    doujin: "Doujins",
  };

  const state = {
    catalog: null,
    query: "",
    category: "all",
    sort: "released",
  };

  const els = {
    name: document.getElementById("site-name"),
    subtitle: document.getElementById("site-subtitle"),
    links: document.getElementById("header-links"),
    search: document.getElementById("search"),
    latest: document.getElementById("latest-releases"),
    progress: document.getElementById("progress-list"),
    progressEmpty: document.getElementById("progress-empty"),
    filters: document.getElementById("category-filters"),
    sort: document.getElementById("sort"),
    grid: document.getElementById("title-grid"),
    meta: document.getElementById("result-meta"),
    empty: document.getElementById("empty-state"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalize(text) {
    return String(text ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category || "Series";
  }

  function coverSrc(path) {
    const raw = String(path || "").trim();
    if (!raw) return "assets/placeholder-cover.svg";
    return raw;
  }

  /** Display-only: 029.5 → 29.5, 004 → 4. Cubari URLs keep padded keys. */
  function displayChapter(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return "";
    return text.replace(/(^|\.)0+(\d)/g, "$1$2");
  }

  function applyAccent(accent) {
    if (accent) document.documentElement.style.setProperty("--accent", accent);
  }

  function renderHeader(site) {
    document.title = "UMD Translations";
    els.name.textContent = site.name || "Udon Mango D";
    els.subtitle.textContent =
      site.subtitle || "Translations of Type-Moon Works";
    applyAccent(site.accent);

    const links = [];
    if (site.discord_url) {
      links.push(["Discord", site.discord_url]);
    }
    if (site.recruitment_url) {
      links.push(["Recruitment", site.recruitment_url]);
    }

    if (!links.length) {
      els.links.hidden = true;
      els.links.innerHTML = "";
      return;
    }

    els.links.hidden = false;
    els.links.innerHTML = links
      .map(
        ([label, href]) =>
          `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`
      )
      .join("");
  }

  function renderLatest(releases) {
    const rows = (releases || []).slice(0, 10);
    if (!rows.length) {
      els.latest.innerHTML =
        '<p class="empty" style="padding:1rem">No releases listed yet.</p>';
      return;
    }

    els.latest.innerHTML = rows
      .map((row) => {
        const chapterBits = [`Chapter ${escapeHtml(displayChapter(row.chapter_number))}`];
        if (row.chapter_title) chapterBits.push(escapeHtml(row.chapter_title));
        return `
          <a class="latest-row" href="${escapeHtml(row.cubari_url)}" rel="noopener noreferrer" target="_blank">
            <img src="${escapeHtml(coverSrc(row.cover))}" alt="" loading="lazy" width="48" height="48" />
            <div class="meta">
              <div class="series">${escapeHtml(row.series_title)}</div>
              <div class="chapter">${chapterBits.join(" · ")}</div>
            </div>
            <div class="date">${escapeHtml(row.released_display || "")}</div>
            <span class="cta">Read</span>
          </a>
        `;
      })
      .join("");
  }

  function renderProgress(payload) {
    const items = (payload && payload.items) || [];
    if (!els.progress) return;
    if (!items.length) {
      els.progress.innerHTML = "";
      if (els.progressEmpty) els.progressEmpty.hidden = false;
      return;
    }
    if (els.progressEmpty) els.progressEmpty.hidden = true;

    els.progress.innerHTML = items
      .map((row) => {
        const chapter = displayChapter(row.chapter);
        const since = row.since ? ` · since ${escapeHtml(row.since)}` : "";
        const body = `
          <img src="${escapeHtml(coverSrc(row.cover))}" alt="" loading="lazy" width="48" height="48" />
          <div>
            <div class="series">${escapeHtml(row.series_title || row.sheet_series || "")}</div>
            <div class="detail">
              Chapter ${escapeHtml(chapter)} —
              <span class="stage">${escapeHtml(row.stage || "")}</span>${since}
            </div>
          </div>
        `;
        const href = (row.cubari_series_url || "").trim();
        if (href) {
          return `<a class="progress-card" href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${body}</a>`;
        }
        return `<div class="progress-card">${body}</div>`;
      })
      .join("");
  }

  function renderFilters() {
    const keys = ["all", "series", "anthology", "oneshot", "doujin"];
    els.filters.innerHTML = keys
      .map((key) => {
        const pressed = state.category === key ? "true" : "false";
        return `<button type="button" class="filter-btn" data-category="${key}" aria-pressed="${pressed}">${escapeHtml(CATEGORY_LABELS[key])}</button>`;
      })
      .join("");
  }

  function searchBlob(title) {
    const parts = [
      title.title,
      title.original_title,
      ...(title.alt_titles || []),
      ...(title.authors || []),
      ...(title.artists || []),
      categoryLabel(title.category),
    ];
    return normalize(parts.filter(Boolean).join(" "));
  }

  function filteredTitles() {
    const q = normalize(state.query.trim());
    let list = (state.catalog.titles || []).slice();

    if (state.category !== "all") {
      list = list.filter((t) => (t.category || "series") === state.category);
    }
    if (q) {
      list = list.filter((t) => searchBlob(t).includes(q));
    }

    if (state.sort === "title-asc") {
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    } else if (state.sort === "title-desc") {
      list.sort((a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: "base" }));
    } else {
      list.sort((a, b) => (b.released_at || 0) - (a.released_at || 0));
    }
    return list;
  }

  function cardHtml(t) {
    const category = t.category || "series";
    const chapterLabel = t.latest_chapter_number
      ? `Chapter ${escapeHtml(displayChapter(t.latest_chapter_number))}`
      : "latest chapter";
    const titleLine = t.latest_chapter_title
      ? `${chapterLabel} — ${escapeHtml(t.latest_chapter_title)}`
      : chapterLabel;
    const seriesUrl = escapeHtml(t.cubari_series_url || "");
    const latestUrl = escapeHtml(t.cubari_latest_url || t.cubari_series_url || "");
    const canSeries = Boolean(t.cubari_series_url);
    const canLatest = Boolean(t.cubari_latest_url || t.cubari_series_url);

    return `
      <article class="project-card">
        <a class="cover-link" href="${seriesUrl}" rel="noopener noreferrer" target="_blank" ${canSeries ? "" : "tabindex='-1' aria-disabled='true'"}>
          <img src="${escapeHtml(coverSrc(t.cover))}" alt="" loading="lazy" width="300" height="450" />
        </a>
        <div class="card-body">
          <span class="category ${escapeHtml(category)}">${escapeHtml(categoryLabel(category))}</span>
          <h3>
            <a href="${seriesUrl}" rel="noopener noreferrer" target="_blank">${escapeHtml(t.title)}</a>
          </h3>
          <p class="latest-line">Latest: ${titleLine}</p>
          ${
            t.released_display
              ? `<p class="released-line">Released ${escapeHtml(t.released_display)}</p>`
              : ""
          }
          <div class="card-actions">
            <a class="secondary" href="${seriesUrl}" rel="noopener noreferrer" target="_blank" ${canSeries ? "" : "aria-disabled='true'"}>View all chapters</a>
            <a class="primary" href="${latestUrl}" rel="noopener noreferrer" target="_blank" ${canLatest ? "" : "aria-disabled='true'"}>Read ${chapterLabel}</a>
          </div>
        </div>
      </article>
    `;
  }

  function renderCards() {
    const list = filteredTitles();
    els.meta.textContent = `${list.length} project${list.length === 1 ? "" : "s"}`;
    els.empty.hidden = list.length > 0;
    els.grid.hidden = list.length === 0;
    els.grid.className = "card-grid";
    els.grid.innerHTML = list.map(cardHtml).join("");
  }

  function bind() {
    els.search.addEventListener("input", () => {
      state.query = els.search.value;
      renderCards();
    });

    els.sort.addEventListener("change", () => {
      state.sort = els.sort.value;
      renderCards();
    });

    els.filters.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-category]");
      if (!btn) return;
      state.category = btn.getAttribute("data-category") || "all";
      renderFilters();
      renderCards();
    });
  }

  async function init() {
    bind();
    renderFilters();

    const [catalogRes, progressRes] = await Promise.all([
      fetch("data/catalog.json", { cache: "no-cache" }),
      fetch("data/progress.json", { cache: "no-cache" }),
    ]);
    if (!catalogRes.ok) {
      throw new Error(`Failed to load catalog.json (${catalogRes.status})`);
    }
    const catalog = await catalogRes.json();
    state.catalog = catalog;

    renderHeader(catalog.site || {});
    renderLatest(catalog.latest_releases || []);
    renderCards();

    if (progressRes.ok) {
      renderProgress(await progressRes.json());
    } else {
      renderProgress({ items: [] });
    }
  }

  init().catch((err) => {
    console.error(err);
    els.grid.innerHTML = "";
    els.empty.hidden = false;
    els.empty.textContent = "Could not load catalogue data.";
  });
})();
