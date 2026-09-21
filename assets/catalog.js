(() => {
  "use strict";

  const STATUS_LABELS = {
    all: "All",
    ongoing: "Ongoing",
    completed: "Completed",
    "indefinite-hiatus": "Indefinite Hiatus",
    stalled: "Stalled",
  };

  const state = {
    catalog: null,
    query: "",
    status: "all",
    sort: "released",
  };

  const els = {
    name: document.getElementById("site-name"),
    subtitle: document.getElementById("site-subtitle"),
    links: document.getElementById("header-links"),
    search: document.getElementById("search"),
    latest: document.getElementById("latest-releases"),
    filters: document.getElementById("status-filters"),
    sort: document.getElementById("sort"),
    grid: document.getElementById("title-grid"),
    meta: document.getElementById("result-meta"),
    empty: document.getElementById("empty-state"),
    generated: document.getElementById("generated-at"),
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

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || "Ongoing";
  }

  function coverSrc(path) {
    const raw = String(path || "").trim();
    if (!raw) return "assets/placeholder-cover.svg";
    return raw;
  }

  function applyAccent(accent) {
    if (accent) document.documentElement.style.setProperty("--accent", accent);
  }

  function renderHeader(site) {
    document.title = site.name || "UMD";
    els.name.textContent = site.name || "UMD";
    els.subtitle.textContent =
      site.subtitle || "Type-Moon manga translations. Read on Cubari.";
    applyAccent(site.accent);

    const links = [];
    if (site.discord_url) {
      links.push([
        "Discord",
        site.discord_url,
      ]);
    }
    if (site.recruitment_url) {
      links.push(["Recruitment", site.recruitment_url]);
    }
    if (site.hub_url) {
      links.push(["Beast's Lair hub", site.hub_url]);
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
        const chapterBits = [`Ch. ${escapeHtml(row.chapter_number)}`];
        if (row.chapter_title) chapterBits.push(escapeHtml(row.chapter_title));
        return `
          <a class="latest-row" href="${escapeHtml(row.cubari_url)}" rel="noopener noreferrer" target="_blank">
            <img src="${escapeHtml(coverSrc(row.cover))}" alt="" loading="lazy" width="48" height="48" />
            <div class="meta">
              <div class="series">${escapeHtml(row.series_title)}</div>
              <div class="chapter">${chapterBits.join(" · ")}</div>
            </div>
            <div class="date">${escapeHtml(row.released_display || "")}</div>
            <span class="cta">Read on Cubari</span>
          </a>
        `;
      })
      .join("");
  }

  function renderFilters() {
    const keys = ["all", "ongoing", "completed", "indefinite-hiatus", "stalled"];
    els.filters.innerHTML = keys
      .map((key) => {
        const pressed = state.status === key ? "true" : "false";
        return `<button type="button" class="filter-btn" data-status="${key}" aria-pressed="${pressed}">${escapeHtml(STATUS_LABELS[key])}</button>`;
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
    ];
    return normalize(parts.filter(Boolean).join(" "));
  }

  function filteredTitles() {
    const q = normalize(state.query.trim());
    let list = (state.catalog.titles || []).slice();

    if (state.status !== "all") {
      list = list.filter((t) => (t.status || "ongoing") === state.status);
    }
    if (q) {
      list = list.filter((t) => searchBlob(t).includes(q));
    }

    if (state.sort === "title-asc") {
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    } else if (state.sort === "title-desc") {
      list.sort((a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: "base" }));
    } else {
      list.sort(
        (a, b) => (b.released_at || 0) - (a.released_at || 0)
      );
    }
    return list;
  }

  function renderCards() {
    const list = filteredTitles();
    els.meta.textContent = `${list.length} project${list.length === 1 ? "" : "s"}`;
    els.empty.hidden = list.length > 0;
    els.grid.hidden = list.length === 0;

    els.grid.innerHTML = list
      .map((t) => {
        const status = t.status || "ongoing";
        const latestLabel =
          status === "completed" ? "Final release" : "Latest";
        const chapterLabel = t.latest_chapter_number
          ? `Chapter ${escapeHtml(t.latest_chapter_number)}`
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
              <span class="status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
              <h3>
                <a href="${seriesUrl}" rel="noopener noreferrer" target="_blank">${escapeHtml(t.title)}</a>
              </h3>
              <p class="latest-line">${escapeHtml(latestLabel)}: ${titleLine}</p>
              ${
                t.released_display
                  ? `<p class="released-line">Released ${escapeHtml(t.released_display)}</p>`
                  : ""
              }
              <div class="card-actions">
                <a class="secondary" href="${seriesUrl}" rel="noopener noreferrer" target="_blank" ${canSeries ? "" : "aria-disabled='true'"}>View all chapters on Cubari</a>
                <a class="primary" href="${latestUrl}" rel="noopener noreferrer" target="_blank" ${canLatest ? "" : "aria-disabled='true'"}>Read ${chapterLabel} on Cubari</a>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
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
      const btn = event.target.closest("button[data-status]");
      if (!btn) return;
      state.status = btn.getAttribute("data-status") || "all";
      renderFilters();
      renderCards();
    });
  }

  async function init() {
    bind();
    renderFilters();

    const res = await fetch("data/catalog.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load catalog.json (${res.status})`);
    const catalog = await res.json();
    state.catalog = catalog;

    renderHeader(catalog.site || {});
    renderLatest(catalog.latest_releases || []);
    renderCards();

    if (catalog.generated_at) {
      const d = new Date(catalog.generated_at * 1000);
      els.generated.textContent = `Catalogue generated ${d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;
    }
  }

  init().catch((err) => {
    console.error(err);
    els.grid.innerHTML = "";
    els.empty.hidden = false;
    els.empty.textContent = "Could not load catalogue data.";
  });
})();
