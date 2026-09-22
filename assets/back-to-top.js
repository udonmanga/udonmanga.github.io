(() => {
  "use strict";

  const btn = document.getElementById("back-to-top");
  if (!btn) return;

  const SHOW_AFTER = 400;

  function sync() {
    const show = window.scrollY > SHOW_AFTER;
    btn.classList.toggle("is-visible", show);
    btn.toggleAttribute("hidden", !show);
  }

  btn.addEventListener("click", () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  window.addEventListener("scroll", sync, { passive: true });
  sync();
})();
