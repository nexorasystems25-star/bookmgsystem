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
    button.addEventListener("click", () => showToast("Payment entry will be wired in a later stage."));
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

  async function renderDashboard() {
    const data = await CEC.getDashboardData();
    const cur = data.currency;

    document.getElementById("metricTotalStudents").textContent = data.kpis.totalStudents;
    document.getElementById("metricStudentsFoot").textContent = "+" + data.kpis.enrolledThisTerm;
    document.getElementById("metricPaymentsToday").textContent = CEC.derive.formatAmount(data.kpis.paymentsToday, cur);
    document.getElementById("metricPaymentsFoot").textContent = data.kpis.dailyPct + "%";
    document.getElementById("metricReadyToIssue").textContent = data.kpis.readyToIssue;
    document.getElementById("metricReadyFoot").textContent = data.kpis.waiting;
    document.getElementById("metricOutstanding").textContent = CEC.derive.formatAmount(data.kpis.outstandingAmount, cur);
    document.getElementById("metricOutstandingFoot").textContent = "Across " + data.kpis.outstandingCount + " students";

    const chartBars = document.getElementById("chartBars");
    const chartX = document.getElementById("chartX");
    const maxTotal = Math.max.apply(null, data.chart.total.concat([1]));
    chartBars.innerHTML = data.chart.total
      .map(v => `<i style="height:${Math.round((v / maxTotal) * 100)}%"></i>`)
      .join("");
    chartX.innerHTML = data.chart.labels.map(l => `<span>${l}</span>`).join("");

    document.getElementById("donutPct").textContent = data.readiness.coveredPct + "%";
    document.getElementById("readyCount").textContent = data.readiness.ready;
    document.getElementById("waitingCount").textContent = data.readiness.waiting;
    document.getElementById("uncoveredCount").textContent = data.readiness.uncovered;
    document.getElementById("stockLowCount").textContent = data.stockLowCount;

    document.getElementById("recentPaymentsBody").innerHTML = data.recentPayments
      .map(p => `
        <tr>
          <td><b>${p.studentName}</b><small>${p.id}</small></td>
          <td>${p.className}</td>
          <td>${CEC.derive.formatAmount(p.amount, cur)}</td>
          <td><span class="method ${p.methodClass}">${p.method}</span></td>
          <td><span class="pill success">${p.status}</span></td>
        </tr>`)
      .join("");

    document.getElementById("activityFeed").innerHTML = data.activityFeed
      .map(a => `
        <div class="activity-item">
          <span class="activity-icon ${a.color}">${a.icon}</span>
          <div><b>${a.title}</b><p>${a.description}</p><small>${a.timeLabel}</small></div>
        </div>`)
      .join("");

    const fresh = document.getElementById("dataFreshness");
    fresh.textContent = data.lastSynced ? "Synced " + new Date(data.lastSynced).toLocaleString() : "";

    const pill = document.getElementById("offlinePill");
    if (data.offline) {
      pill.hidden = false;
      pill.textContent = data.lastSynced
        ? "Offline mode — data from " + new Date(data.lastSynced).toLocaleDateString()
        : "Offline mode — snapshot data";
    } else {
      pill.hidden = true;
    }
  }

  renderDashboard().catch(err => {
    console.error("Dashboard load failed:", err);
    showToast("Could not load dashboard data.");
  });
})();
