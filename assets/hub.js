(() => {
  "use strict";

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

  function coverSrc(path) {
    const raw = String(path || "").trim();
    if (!raw) return "assets/placeholder-cover.svg";
    return raw;
  }

  const page = document.body.dataset.hubPage || "";
  const dataUrl = document.body.dataset.hubData || "";
  const els = {
    search: document.getElementById("search"),
    grid: document.getElementById("hub-grid"),
    meta: document.getElementById("result-meta"),
    empty: document.getElementById("empty-state"),
    links: document.getElementById("header-links"),
  };

  let items = [];

  function renderHeaderLinks(site) {
    if (!els.links) return;
    const links = [];
    if (site.hub_url) links.push(["Beast’s Lair", site.hub_url]);
    if (site.discord_url) links.push(["Discord", site.discord_url]);
    if (site.recruitment_url) links.push(["Recruitment", site.recruitment_url]);
    if (!links.length) {
      els.links.hidden = true;
      els.links.innerHTML = "";
      return;
    }
    els.links.hidden = false;
    els.links.innerHTML = links
      .map(([label, href], i) => {
        const sep =
          i > 0 ? '<span class="header-links-sep" aria-hidden="true">·</span>' : "";
        return `${sep}<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
      })
      .join("");
  }

  function cardHtml(item) {
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

  function render() {
    const q = normalize((els.search && els.search.value) || "");
    let list = items.slice();
    if (q) {
      list = list.filter((item) => normalize(item.title).includes(q));
    }
    if (els.meta) {
      els.meta.textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
    }
    if (els.empty) els.empty.hidden = list.length > 0;
    if (els.grid) {
      els.grid.hidden = list.length === 0;
      els.grid.innerHTML = list.map(cardHtml).join("");
    }
  }

  async function init() {
    if (!dataUrl || !els.grid) return;
    if (els.search) {
      els.search.addEventListener("input", render);
    }
    const [hubRes, siteRes] = await Promise.all([
      fetch(dataUrl, { cache: "no-cache" }),
      fetch("data/site.json", { cache: "no-cache" }),
    ]);
    if (!hubRes.ok) throw new Error(`Failed to load ${dataUrl}`);
    const payload = await hubRes.json();
    items = payload.items || [];
    if (siteRes.ok) {
      try {
        renderHeaderLinks(await siteRes.json());
      } catch (_) {
        /* ignore site.json parse errors */
      }
    }
    render();
  }

  init().catch((err) => {
    console.error(err);
    if (els.empty) {
      els.empty.hidden = false;
      els.empty.textContent = "Could not load this section.";
    }
  });
})();
