(() => {
  "use strict";

  const CATEGORY_LABELS = {
    all: "All",
    series: "Series",
    anthology: "Anthologies",
    oneshot: "Oneshots",
    doujin: "Doujins",
  };

  const PROGRESS_PAGE_SIZE = 6;
  const PROGRESS_CHAPTERS_SHOWN = 3;

  const SECTIONS = {
    manga: {
      search: "Search titles…",
      searchLabel: "Search titles",
    },
    "light-novels": {
      title: "Light Novels",
      blurb: "Completed novel translations.",
      data: "data/light-novels.json",
      search: "Search light novels…",
      searchLabel: "Search light novels",
      empty: "No light novels match your search.",
      noun: "light novel",
    },
    "fgo-profiles": {
      title: "FGO Profiles",
      blurb: "Servant profiles, materials, and lines translations.",
      data: "data/fgo-profiles.json",
      search: "Search profiles…",
      searchLabel: "Search profiles",
      empty: "No profiles match your search.",
      noun: "profile",
    },
    miscellaneous: {
      title: "Miscellaneous",
      blurb: "Interviews, timelines, screenplays, and other translations.",
      data: "data/miscellaneous.json",
      search: "Search miscellaneous…",
      searchLabel: "Search miscellaneous",
      empty: "No items match your search.",
      noun: "item",
    },
  };

  const state = {
    catalog: null,
    progressGroups: [],
    progressPage: 0,
    expandedSeries: new Set(),
    query: "",
    category: "all",
    sort: "released",
    section: "manga",
    hubCache: {},
  };

  const els = {
    name: document.getElementById("site-name"),
    subtitle: document.getElementById("site-subtitle"),
    links: document.getElementById("header-links"),
    search: document.getElementById("search"),
    latestSection: document.querySelector("section.latest"),
    progressSection: document.getElementById("in-progress"),
    latest: document.getElementById("latest-releases"),
    viewManga: document.getElementById("view-manga"),
    viewHub: document.getElementById("view-hub"),
    hubHeading: document.getElementById("hub-heading"),
    hubBlurb: document.getElementById("hub-blurb"),
    hubGrid: document.getElementById("hub-grid"),
    hubMeta: document.getElementById("hub-meta"),
    hubEmpty: document.getElementById("hub-empty"),
    nav: document.getElementById("site-nav"),
    searchLabel: document.getElementById("search-label"),
    progress: document.getElementById("progress-list"),
    progressEmpty: document.getElementById("progress-empty"),
    progressPager: document.getElementById("progress-pager"),
    progressPrev: document.getElementById("progress-prev"),
    progressNext: document.getElementById("progress-next"),
    progressPageMeta: document.getElementById("progress-page-meta"),
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
    els.name.textContent = site.name || "UMD Translations";
    els.subtitle.textContent =
      site.subtitle || "Translations of Type-Moon Works";
    applyAccent(site.accent);

    const links = [];
    if (site.hub_url) {
      links.push(["Beast’s Lair", site.hub_url]);
    }
    if (site.discord_url) {
      links.push(["Discord", site.discord_url]);
    }
    if (site.recruitment_url) {
      links.push(["Recruitment", site.recruitment_url]);
    }

    // Keep static HTML if site.json has no links (avoid wiping the header).
    if (!els.links || !links.length) return;

    els.links.hidden = false;
    els.links.innerHTML = links
      .map(([label, href], i) => {
        const sep =
          i > 0 ? '<span class="nav-ext-sep" aria-hidden="true">·</span>' : "";
        return `${sep}<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
      })
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

  function chapterSortValue(raw) {
    const n = parseFloat(String(raw ?? "").replace(/^0+(?=\d)/, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function groupProgress(items) {
    const groups = new Map();
    for (const row of items || []) {
      const id = String(row.series_id || row.series_title || row.sheet_series || "unknown");
      if (!groups.has(id)) {
        groups.set(id, {
          id,
          title: row.series_title || row.sheet_series || "",
          cover: row.cover,
          url: (row.cubari_series_url || "").trim(),
          chapters: [],
        });
      }
      groups.get(id).chapters.push(row);
    }
    const list = [...groups.values()];
    for (const group of list) {
      group.chapters.sort((a, b) => chapterSortValue(a.chapter) - chapterSortValue(b.chapter));
    }
    return list;
  }

  const PROGRESS_STEPS = [
    "Translating",
    "Translation Checking",
    "Proofreading",
    "Typesetting",
    "Quality Checking",
  ];

  function stageBar(stage) {
    const index = PROGRESS_STEPS.indexOf(stage);
    if (index < 0) return "";
    const segs = PROGRESS_STEPS.map((name, i) => {
      const cls = i < index ? "done" : i === index ? "current" : "";
      return `<span class="stage-seg ${cls}" title="${escapeHtml(name)}"></span>`;
    }).join("");
    return `<div class="stage-bar" role="progressbar" aria-valuemin="1" aria-valuemax="${PROGRESS_STEPS.length}" aria-valuenow="${index + 1}" aria-valuetext="${escapeHtml(stage)}">${segs}</div>`;
  }

  function progressChapterRows(group) {
    const expanded = state.expandedSeries.has(group.id);
    const chapters = group.chapters;
    const visible =
      expanded || chapters.length <= PROGRESS_CHAPTERS_SHOWN
        ? chapters
        : chapters.slice(0, PROGRESS_CHAPTERS_SHOWN);
    const rows = visible
      .map((row) => {
        const stage = row.stage || "";
        const since = row.since
          ? `<span class="since">since ${escapeHtml(row.since)}</span>`
          : "";
        return `
          <div class="progress-chapter">
            <div class="progress-chapter-top">
              <span class="ch">Chapter ${escapeHtml(displayChapter(row.chapter))}</span>
              <span class="stage">${escapeHtml(stage)}</span>
            </div>
            ${stageBar(stage)}
            ${since}
          </div>
        `;
      })
      .join("");
    const hiddenCount = chapters.length - visible.length;
    const toggle =
      chapters.length > PROGRESS_CHAPTERS_SHOWN
        ? `<button type="button" class="progress-more" data-series="${escapeHtml(group.id)}">${
            expanded ? "Show less" : `Show ${hiddenCount} more`
          }</button>`
        : "";
    return rows + toggle;
  }

  function renderProgressPage() {
    const groups = state.progressGroups || [];
    if (!els.progress) return;

    if (!groups.length) {
      els.progress.innerHTML = "";
      if (els.progressEmpty) els.progressEmpty.hidden = false;
      if (els.progressPager) els.progressPager.hidden = true;
      return;
    }
    if (els.progressEmpty) els.progressEmpty.hidden = true;

    const pageCount = Math.max(1, Math.ceil(groups.length / PROGRESS_PAGE_SIZE));
    if (state.progressPage >= pageCount) state.progressPage = pageCount - 1;
    if (state.progressPage < 0) state.progressPage = 0;

    const start = state.progressPage * PROGRESS_PAGE_SIZE;
    const pageItems = groups.slice(start, start + PROGRESS_PAGE_SIZE);
    const end = start + pageItems.length;

    els.progress.innerHTML = pageItems
      .map((group) => {
        const title = escapeHtml(group.title);
        const titleHtml = group.url
          ? `<a href="${escapeHtml(group.url)}" rel="noopener noreferrer" target="_blank">${title}</a>`
          : title;
        const count = group.chapters.length;
        return `
          <article class="progress-card progress-series">
            <img src="${escapeHtml(coverSrc(group.cover))}" alt="" loading="lazy" width="52" height="52" />
            <div>
              <div class="series">${titleHtml}</div>
              <div class="detail">${count} chapter${count === 1 ? "" : "s"} in progress</div>
              <div class="progress-chapters">${progressChapterRows(group)}</div>
            </div>
          </article>
        `;
      })
      .join("");

    if (els.progressPager) {
      els.progressPager.hidden = groups.length <= PROGRESS_PAGE_SIZE;
    }
    if (els.progressPageMeta) {
      els.progressPageMeta.textContent = `${start + 1}–${end} of ${groups.length}`;
    }
    if (els.progressPrev) els.progressPrev.disabled = state.progressPage <= 0;
    if (els.progressNext) {
      els.progressNext.disabled = state.progressPage >= pageCount - 1;
    }
  }

  function renderProgress(payload) {
    state.progressGroups = groupProgress((payload && payload.items) || []);
    state.progressPage = 0;
    state.expandedSeries = new Set();
    renderProgressPage();
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
    const isOneshot = category === "oneshot";
    const chapterLabel = t.latest_chapter_number
      ? `Chapter ${escapeHtml(displayChapter(t.latest_chapter_number))}`
      : "latest chapter";
    const titleLine = t.latest_chapter_title
      ? `${chapterLabel} — ${escapeHtml(t.latest_chapter_title)}`
      : chapterLabel;
    const seriesUrl = escapeHtml(t.cubari_series_url || "");
    const latestUrl = escapeHtml(t.cubari_latest_url || t.cubari_series_url || "");
    // Oneshots: open the chapter directly (cover / title / read).
    const primaryUrl = isOneshot ? latestUrl || seriesUrl : seriesUrl;
    const canPrimary = Boolean(primaryUrl);
    const canLatest = Boolean(t.cubari_latest_url || t.cubari_series_url);
    const canSeries = Boolean(t.cubari_series_url);

    return `
      <article class="project-card">
        <a class="cover-link" href="${primaryUrl}" rel="noopener noreferrer" target="_blank" ${canPrimary ? "" : "tabindex='-1' aria-disabled='true'"}>
          <img src="${escapeHtml(coverSrc(t.cover))}" alt="" loading="lazy" width="300" height="450" />
        </a>
        <div class="card-body">
          <span class="category ${escapeHtml(category)}">${escapeHtml(categoryLabel(category))}</span>
          <h3>
            <a href="${primaryUrl}" rel="noopener noreferrer" target="_blank">${escapeHtml(t.title)}</a>
          </h3>
          <p class="latest-line">Latest: ${titleLine}</p>
          ${
            t.released_display
              ? `<p class="released-line">Released ${escapeHtml(t.released_display)}</p>`
              : ""
          }
          <div class="card-actions">
            ${
              isOneshot
                ? ""
                : `<a class="secondary" href="${seriesUrl}" rel="noopener noreferrer" target="_blank" ${canSeries ? "" : "aria-disabled='true'"}>View all chapters</a>`
            }
            <a class="primary" href="${latestUrl}" rel="noopener noreferrer" target="_blank" ${canLatest ? "" : "aria-disabled='true'"}>Read ${chapterLabel}</a>
          </div>
        </div>
      </article>
    `;
  }

  function syncSearchLayout() {
    const searching = Boolean(normalize(state.query.trim()));
    const onManga = state.section === "manga";
    if (els.latestSection) els.latestSection.hidden = !onManga || searching;
    if (els.progressSection) els.progressSection.hidden = !onManga || searching;
  }

  function sectionFromHash() {
    const key = (location.hash || "").replace(/^#/, "");
    return SECTIONS[key] ? key : "manga";
  }

  function hubCardHtml(item) {
    const links = (item.links || []).filter((l) => l && l.url);
    const primary = links[0];
    const coverHref = primary ? primary.url : "#";
    const actions = links
      .map((link, i) => {
        const cls = i === 0 ? "primary" : "secondary";
        return `<a class="${cls}" href="${escapeHtml(link.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(link.label || "Open")}</a>`;
      })
      .join("");
    return `
      <article class="project-card hub-card">
        <a class="cover-link" href="${escapeHtml(coverHref)}" rel="noopener noreferrer" target="_blank">
          <img src="${escapeHtml(coverSrc(item.cover))}" alt="" loading="lazy" width="300" height="450" />
        </a>
        <div class="card-body">
          <h3>
            <a href="${escapeHtml(coverHref)}" rel="noopener noreferrer" target="_blank">${escapeHtml(item.title)}</a>
          </h3>
          <div class="card-actions">${actions}</div>
        </div>
      </article>
    `;
  }

  function renderHub() {
    const spec = SECTIONS[state.section];
    if (!spec || state.section === "manga" || !els.hubGrid) return;
    const items = state.hubCache[state.section] || [];
    const q = normalize(state.query.trim());
    const list = q
      ? items.filter((item) => normalize(item.title).includes(q))
      : items.slice();
    if (els.hubHeading) els.hubHeading.textContent = spec.title;
    if (els.hubBlurb) els.hubBlurb.textContent = spec.blurb;
    if (els.hubMeta) {
      const noun = list.length === 1 ? spec.noun : `${spec.noun}s`;
      els.hubMeta.textContent = `${list.length} ${noun}`;
    }
    if (els.hubEmpty) {
      els.hubEmpty.hidden = list.length > 0;
      els.hubEmpty.textContent = spec.empty;
    }
    els.hubGrid.hidden = list.length === 0;
    els.hubGrid.innerHTML = list.map(hubCardHtml).join("");
  }

  async function ensureHub(section) {
    if (state.hubCache[section]) return;
    const spec = SECTIONS[section];
    if (!spec || !spec.data) return;
    const res = await fetch(spec.data, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${spec.data}`);
    const payload = await res.json();
    state.hubCache[section] = payload.items || [];
  }

  function applySectionChrome() {
    const spec = SECTIONS[state.section] || SECTIONS.manga;
    const onManga = state.section === "manga";
    if (els.viewManga) els.viewManga.hidden = !onManga;
    if (els.viewHub) els.viewHub.hidden = onManga;
    if (els.search) els.search.placeholder = spec.search;
    if (els.searchLabel) els.searchLabel.textContent = spec.searchLabel;
    if (els.nav) {
      for (const link of els.nav.querySelectorAll("[data-section]")) {
        const current = link.getAttribute("data-section") === state.section;
        if (current) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    }
    document.title =
      onManga || !spec.title ? "UMD Translations" : `${spec.title} — UMD Translations`;
    document.documentElement.classList.remove("boot-hub");
    syncSearchLayout();
  }

  async function showSection(section, { updateHash = true } = {}) {
    const next = SECTIONS[section] ? section : "manga";
    state.section = next;
    if (updateHash) {
      const hash = next === "manga" ? "#manga" : `#${next}`;
      if (location.hash !== hash) history.pushState(null, "", hash);
    }
    applySectionChrome();
    if (next === "manga") {
      renderCards();
      return;
    }
    try {
      await ensureHub(next);
      renderHub();
    } catch (err) {
      console.error(err);
      if (els.hubGrid) els.hubGrid.innerHTML = "";
      if (els.hubEmpty) {
        els.hubEmpty.hidden = false;
        els.hubEmpty.textContent = "Could not load this section.";
      }
    }
  }

  function renderCards() {
    const list = filteredTitles();
    els.meta.textContent = `${list.length} project${list.length === 1 ? "" : "s"}`;
    els.empty.hidden = list.length > 0;
    els.grid.hidden = list.length === 0;
    els.grid.className = "card-grid";
    els.grid.innerHTML = list.map(cardHtml).join("");
    syncSearchLayout();
  }

  function bind() {
    els.search.addEventListener("input", () => {
      state.query = els.search.value;
      if (state.section === "manga") renderCards();
      else renderHub();
    });

    els.sort.addEventListener("change", () => {
      state.sort = els.sort.value;
      renderCards();
    });

    if (els.progress) {
      els.progress.addEventListener("click", (event) => {
        const btn = event.target.closest("button.progress-more");
        if (!btn) return;
        const id = btn.getAttribute("data-series") || "";
        if (!id) return;
        if (state.expandedSeries.has(id)) state.expandedSeries.delete(id);
        else state.expandedSeries.add(id);
        renderProgressPage();
      });
    }

    if (els.nav) {
      els.nav.addEventListener("click", (event) => {
        const link = event.target.closest("[data-section]");
        if (!link) return;
        event.preventDefault();
        showSection(link.getAttribute("data-section") || "manga");
      });
    }

    window.addEventListener("hashchange", () => {
      const next = sectionFromHash();
      if (next !== state.section) showSection(next, { updateHash: false });
    });

    if (els.progressPrev) {
      els.progressPrev.addEventListener("click", () => {
        state.progressPage -= 1;
        renderProgressPage();
      });
    }
    if (els.progressNext) {
      els.progressNext.addEventListener("click", () => {
        state.progressPage += 1;
        renderProgressPage();
      });
    }

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

    const [catalogRes, progressRes, siteRes] = await Promise.all([
      fetch("data/catalog.json", { cache: "no-cache" }),
      fetch("data/progress.json", { cache: "no-cache" }),
      fetch("data/site.json", { cache: "no-cache" }),
    ]);
    if (!catalogRes.ok) {
      throw new Error(`Failed to load catalog.json (${catalogRes.status})`);
    }
    const catalog = await catalogRes.json();
    state.catalog = catalog;

    let site = catalog.site || {};
    if (siteRes.ok) {
      try {
        const fromFile = await siteRes.json();
        if (fromFile && typeof fromFile === "object") site = { ...site, ...fromFile };
      } catch (_) {
        /* keep catalog.site */
      }
    }
    renderHeader(site);
    renderLatest(catalog.latest_releases || []);
    renderCards();

    if (progressRes.ok) {
      renderProgress(await progressRes.json());
    } else {
      renderProgress({ items: [] });
    }

    await showSection(sectionFromHash(), { updateHash: false });
  }

  init().catch((err) => {
    console.error(err);
    els.grid.innerHTML = "";
    els.empty.hidden = false;
    els.empty.textContent = "Could not load catalogue data.";
  });
})();
