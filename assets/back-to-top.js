(() => {
  "use strict";

  const btn = document.getElementById("back-to-top");
  if (!btn) return;

  const SHOW_AFTER = 280;

  function sync() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const show = y > SHOW_AFTER;
    btn.classList.toggle("is-visible", show);
    if (show) btn.removeAttribute("hidden");
    else btn.setAttribute("hidden", "");
  }

  btn.addEventListener("click", () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync, { passive: true });
  sync();
})();
