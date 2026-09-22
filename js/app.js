(() => {
  const sidebar = document.getElementById("sidebar");
  const mobileMenu = document.getElementById("mobileMenu");
  const toast = document.getElementById("toast");

  mobileMenu?.addEventListener("click", () => sidebar.classList.toggle("open"));

  document.querySelectorAll(".nav-item").forEach(link => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
      link.classList.add("active");
      const page = link.dataset.page;
      const title = page === "dashboard" ? "Dashboard" : link.textContent.trim();
      document.getElementById("pageTitle").textContent = title;
      sidebar.classList.remove("open");
      if (page !== "dashboard") {
        showToast(`${title} module is ready for the next implementation stage.`);
      }
    });
  });

  document.querySelectorAll("[data-action='payment']").forEach(button => {
    button.addEventListener("click", () => showToast("Payment entry will be connected to Google Sheets in Stage 2."));
  });

  document.querySelector(".notice-close")?.addEventListener("click", e => {
    e.currentTarget.closest(".notice").remove();
  });

  document.querySelectorAll(".workspace-select, .icon-btn, .text-btn, .more-btn, .btn-light, .stock-alert button").forEach(button => {
    if (button.dataset.action || button.classList.contains("notice-close")) return;
    button.addEventListener("click", () => showToast("This control will be wired during the corresponding implementation stage."));
  });

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }
})();
