(() => {
  const sidebar = document.getElementById("sidebar");
  const mobileMenu = document.getElementById("mobileMenu");
  const toast = document.getElementById("toast");

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  const PAGES = CEC.viewModels.PAGES;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  const menuRoot = document.getElementById("menuRoot");
  let openMenuEl = null;

  function closeMenu() {
    if (!openMenuEl) return;
    openMenuEl.remove();
    document.querySelectorAll("[aria-expanded]").forEach(b => b.setAttribute("aria-expanded", "false"));
    openMenuEl = null;
  }

  function openMenu(anchor, panelHtml) {
    closeMenu();
    const rect = anchor.getBoundingClientRect();
    const panel = document.createElement("div");
    panel.className = "menu-panel";
    panel.setAttribute("role", "menu");
    panel.innerHTML = panelHtml;
    panel.style.position = "fixed";
    panel.style.top = Math.max(8, rect.bottom + 6) + "px";
    panel.style.left = Math.max(8, rect.left) + "px";
    panel.addEventListener("click", () => {});
    menuRoot.appendChild(panel);
    openMenuEl = panel;
    anchor.setAttribute("aria-expanded", "true");
  }

  function bindMenuToggle(anchor, buildPanel) {
    anchor.addEventListener("click", ev => {
      ev.stopPropagation();
      ev.preventDefault();
      if (openMenuEl) closeMenu();
      else openMenu(anchor, buildPanel());
    });
  }

  document.addEventListener("click", ev => {
    if (openMenuEl && !openMenuEl.contains(ev.target)) closeMenu();
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") closeMenu();
  });

  mobileMenu?.addEventListener("click", () => sidebar.classList.toggle("open"));

  document.querySelector(".notice-close")?.addEventListener("click", e => {
    e.currentTarget.closest(".notice").remove();
  });

  document.querySelectorAll("[data-go]").forEach(btn => {
    btn.addEventListener("click", () => { location.hash = btn.dataset.go; });
  });

  document.querySelectorAll(".more-btn, .btn.btn-light:not([data-close]), .profile-mini").forEach(button => {
    button.addEventListener("click", () => showToast("This control is wired in the Controls stage (export, menus, profile)."));
  });

  function renderWorkspaceYears(anchor) {
    if (!currentData) {
      showToast("Data not loaded yet.");
      return;
    }
    const years = CEC.viewModels.availableYears(currentData.students, currentData.config);
    if (!years.length) {
      showToast("No academic years found yet.");
      return;
    }
    const cur = activeYear || currentData.config.activeYear || "";
    openMenu(anchor, years.map(y =>
      '<button class="menu-item" role="menuitem" data-year="' + esc(y) + '">' +
        esc(y) +
        (y === cur ? ' <span class="menu-check">✓</span>' : "") +
      "</button>").join(""));
    menuRoot.querySelector('[data-year="' + cur + '"]')?.scrollIntoView({ block: "nearest" });
  }

  const workspaceSelect = document.querySelector(".workspace-select");
  if (workspaceSelect) {
    workspaceSelect.addEventListener("click", ev => {
      ev.stopPropagation();
      ev.preventDefault();
      if (openMenuEl) closeMenu();
      else renderWorkspaceYears(workspaceSelect);
    });
    menuRoot.addEventListener("click", ev => {
      const item = ev.target.closest("[data-year]");
      if (!item) return;
      ev.stopPropagation();
      const year = item.dataset.year;
      const b = workspaceSelect.querySelector("b");
      if (b) b.textContent = year;
      activeYear = year;
      closeMenu();
      if (currentData) {
        const page = CEC.viewModels.pageForHash(location.hash);
        renderers[page](viewData());
      }
      showToast("Switched to " + year);
    });
  }

  const notificationBtn = document.querySelector(".notification");
  function renderBell() {
    if (!notificationBtn || !currentData) return;
    const alerts = CEC.viewModels.notifications(viewData());
    const dot = notificationBtn.querySelector("i");
    if (dot) dot.hidden = alerts.length === 0;
  }
  if (notificationBtn) {
    bindMenuToggle(notificationBtn, () => {
      if (!currentData) return "";
      const alerts = CEC.viewModels.notifications(viewData());
      return alerts.length
        ? alerts.map(a =>
            '<button class="menu-item bell-item" role="menuitem" data-href="' + a.href + '">' +
              '<span class="bell-icon ' + a.color + '">' + a.icon + "</span>" +
              "<span><b>" + esc(a.title) + "</b><small>" + esc(a.desc) + "</small>" +
              (a.timeLabel ? "<small>" + esc(a.timeLabel) + "</small>" : "") +
              "</span></button>").join("")
        : '<div class="bell-empty">All clear — no alerts today.</div>';
    });
    menuRoot.addEventListener("click", ev => {
      const item = ev.target.closest("[data-href]");
      if (!item) return;
      ev.stopPropagation();
      closeMenu();
      location.hash = item.dataset.href;
    });
  }

  const searchBtn = document.querySelector('[aria-label="Search"]');
  const searchInput = document.getElementById("studentSearch");
  if (searchBtn) {
    function openSearchPanel() {
      const prefill = searchInput ? searchInput.value.trim() : "";
      openMenu(searchBtn, '<div class="search-panel">' +
        '<input class="search-input" type="search" placeholder="Search students, books, payments…" value="' + esc(prefill) + '">' +
        '<div class="search-results"></div></div>');
      const input = menuRoot.querySelector(".search-input");
      if (input) {
        input.focus();
        runSearch();
      }
    }
    searchBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      ev.preventDefault();
      if (openMenuEl) closeMenu();
      else openSearchPanel();
    });
    menuRoot.addEventListener("input", ev => {
      if (!ev.target.classList.contains("search-input")) return;
      ev.stopPropagation();
      runSearch();
    });
    menuRoot.addEventListener("click", ev => {
      const hit = ev.target.closest("[data-search-go]");
      if (!hit) return;
      ev.stopPropagation();
      closeMenu();
      const page = hit.dataset.searchGo;
      const q = hit.dataset.searchQ || "";
      if (page === "students" && searchInput) {
        searchInput.value = q;
        location.hash = "#students";
        if (CEC.viewModels.pageForHash(location.hash) === "students") {
          renderStudents(viewData());
        }
      } else {
        location.hash = "#" + page;
      }
    });

    function runSearch() {
      const panel = document.querySelector(".search-panel");
      if (!panel) return;
      const input = panel.querySelector(".search-input");
      const results = document.querySelector(".search-results");
      if (!input || !results) return;
      const query = input.value.trim();
      if (!currentData) { results.innerHTML = ""; return; }
      const g = CEC.viewModels.globalSearch(viewData(), query);
      if (!query) {
        results.innerHTML = '<div class="search-hint">Type to search students, books, and payments.</div>';
        return;
      }
      const allEmpty = !g.students.length && !g.books.length && !g.payments.length;
      if (allEmpty) {
        results.innerHTML = '<div class="search-hint">No results for &ldquo;' + esc(query) + "&rdquo;.</div>";
        return;
      }
      const rows = (label, arr, go, fields) =>
        arr.length ? '<div class="search-group"><h4>' + label + "</h4>" +
          arr.map(r =>
            '<button class="menu-item search-hit" role="menuitem" data-search-go="' + go + '" data-search-q="' + esc(query) + '">' +
              fields(r).map(f => "<span>" + esc(f) + "</span>").join("") +
            "</button>").join("") + "</div>" : "";
      results.innerHTML =
        rows("Students", g.students, "students", s => [s.name, s.studentId, s.className]) +
        rows("Books", g.books, "books", b => [b.subject, b.publisher]) +
        rows("Payments", g.payments, "payments", p => [p.studentName, p.paymentId]);
    }
  }

  function statusPillClass(status) {
    return status === "ready" ? "success" : status === "waiting" ? "warn" : "muted";
  }

  function stockPillClass(status) {
    return status === "OK" ? "success" : status === "Low" ? "warn" : "out";
  }

  function emptyRow(cols, label) {
    return `<tr><td colspan="${cols}" class="empty-cell">${label || "No data yet."}</td></tr>`;
  }

  let currentData = null;

  let activeYear = "";

  function viewData() {
    if (!currentData) return currentData;
    if (!activeYear) activeYear = currentData.config.activeYear || "";
    return currentData === null ? null : CEC.viewModels.filterYear(currentData, activeYear || currentData.config.activeYear || "");
  }

  function renderShell(data) {
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

  function renderDashboard(data) {
    const cur = data.config.currency;
    const dash = CEC.derive.buildDashboard(data.students, data.payments, data.activity, data.books, data.config);

    document.getElementById("metricTotalStudents").textContent = dash.kpis.totalStudents;
    document.getElementById("metricStudentsFoot").textContent = "+" + dash.kpis.enrolledThisTerm;
    document.getElementById("metricPaymentsToday").textContent = CEC.derive.formatAmount(dash.kpis.paymentsToday, cur);
    document.getElementById("metricPaymentsFoot").textContent = dash.kpis.dailyPct + "%";
    document.getElementById("metricReadyToIssue").textContent = dash.kpis.readyToIssue;
    document.getElementById("metricReadyFoot").textContent = dash.kpis.waiting;
    document.getElementById("metricOutstanding").textContent = CEC.derive.formatAmount(dash.kpis.outstandingAmount, cur);
    document.getElementById("metricOutstandingFoot").textContent = "Across " + dash.kpis.outstandingCount + " students";

    const chartBars = document.getElementById("chartBars");
    const chartX = document.getElementById("chartX");
    const maxTotal = Math.max.apply(null, dash.chart.total.concat([1]));
    chartBars.innerHTML = dash.chart.total
      .map(v => `<i style="height:${Math.round((v / maxTotal) * 100)}%"></i>`)
      .join("");
    chartX.innerHTML = dash.chart.labels.map(l => `<span>${l}</span>`).join("");

    document.getElementById("donutPct").textContent = dash.readiness.coveredPct + "%";
    document.getElementById("readyCount").textContent = dash.readiness.ready;
    document.getElementById("waitingCount").textContent = dash.readiness.waiting;
    document.getElementById("uncoveredCount").textContent = dash.readiness.uncovered;
    document.getElementById("stockLowCount").textContent = dash.stockLowCount;

    document.getElementById("recentPaymentsBody").innerHTML = dash.recentPayments
      .map(p => `
        <tr>
          <td><b>${esc(p.studentName)}</b><small>${esc(p.id)}</small></td>
          <td>${esc(p.className)}</td>
          <td>${CEC.derive.formatAmount(p.amount, cur)}</td>
          <td><span class="method ${p.methodClass}">${esc(p.method)}</span></td>
          <td><span class="pill success">${esc(p.status)}</span></td>
        </tr>`)
      .join("");

    document.getElementById("activityFeed").innerHTML = dash.activityFeed
      .map(a => `
        <div class="activity-item">
          <span class="activity-icon ${a.color}">${a.icon}</span>
          <div><b>${esc(a.title)}</b><p>${esc(a.description)}</p><small>${a.timeLabel}</small></div>
        </div>`)
      .join("");

    renderShell(data);
  }

  function renderStudents(data) {
    const cur = data.config.currency;
    const q = document.getElementById("studentSearch").value.trim().toLowerCase();
    const rows = data.students.filter(s =>
      !q ||
      s.name.toLowerCase().indexOf(q) !== -1 ||
      s.studentId.toLowerCase().indexOf(q) !== -1 ||
      s.className.toLowerCase().indexOf(q) !== -1
    );
    document.getElementById("studentsBody").innerHTML = rows.length
      ? rows.map(s => {
          const balance = CEC.viewModels.studentOutstanding(s);
          return `
        <tr>
          <td>${esc(s.studentId)}</td>
          <td><b>${esc(s.name)}</b></td>
          <td>${esc(s.className)}</td>
          <td>${esc(s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : "")}</td>
          <td>${CEC.derive.formatAmount(s.booksPaid, cur)}</td>
          <td>${balance > 0 ? CEC.derive.formatAmount(balance, cur) : '<span class="positive">Paid</span>'}</td>
          <td><span class="pill ${statusPillClass(s.status)}">${esc(s.status)}</span></td>
        </tr>`;
        }).join("")
      : emptyRow(7);
    document.getElementById("studentCount").textContent = rows.length + " of " + data.students.length;
  }

  function renderPayments(data) {
    const cur = data.config.currency;
    document.getElementById("methodChips").innerHTML = CEC.viewModels.methodSummary(data.payments)
      .map(m => `
        <div class="chip">
          <small>${esc(m.label)}</small>
          <b>${CEC.derive.formatAmount(m.total, cur)}</b>
          <span>${m.share}% of collections</span>
        </div>`)
      .join("");

    const rows = data.payments.slice().sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) || String(b.paymentId).localeCompare(String(a.paymentId)));
    document.getElementById("paymentsBody").innerHTML = rows.length
      ? rows.map(p => `
        <tr>
          <td>${esc(p.paymentId)}</td>
          <td><b>${esc(p.studentName)}</b><small>${esc(p.studentId)}</small></td>
          <td>${esc(p.className)}</td>
          <td>${CEC.derive.formatAmount(p.amount, cur)}</td>
          <td><span class="method ${CEC.viewModels.classifyMethod(p.method)}">${esc(p.method)}</span></td>
          <td>${esc(p.date)}</td>
          <td><span class="pill success">${esc(p.status || "Recorded")}</span></td>
        </tr>`).join("")
      : emptyRow(7);
  }

  function renderBooks(data) {
    const cur = data.config.currency;
    document.getElementById("booksBody").innerHTML = data.books.length
      ? data.books.map(b => `
        <tr>
          <td>${esc(b.bookId)}</td>
          <td><b>${esc(b.subject)}</b><small>${esc(b.category)}</small></td>
          <td>${esc(b.publisher)}</td>
          <td>${CEC.derive.formatAmount(b.price, cur)}</td>
          <td>${b.stockQty}${b.stockQty <= b.lowStockThreshold ? ' <span class="pill warn">Low</span>' : ""}</td>
        </tr>`).join("")
      : emptyRow(5);
  }

  function renderInventory(data) {
    const inv = CEC.viewModels.stockStatus(data.books);
    document.getElementById("inventoryCards").innerHTML = [
      { label: "Total titles", val: inv.totalTitles, cls: "blue", glyph: "▤" },
      { label: "In stock", val: inv.okCount, cls: "green", glyph: "✓" },
      { label: "Low stock", val: inv.lowCount, cls: "amber", glyph: "!" },
      { label: "Out of stock", val: inv.outCount, cls: "red", glyph: "!" }
    ].map(c => `
      <article class="metric-card">
        <div class="metric-top"><span>${c.label}</span><span class="metric-icon ${c.cls}">${c.glyph}</span></div>
        <strong>${c.val}</strong>
      </article>`).join("");

    document.getElementById("inventoryBody").innerHTML = inv.rows.length
      ? inv.rows.map(r => `
        <tr>
          <td><b>${esc(r.subject)}</b><small>${esc(r.publisher)}</small></td>
          <td>${esc(r.category)}</td>
          <td>${r.stockQty}</td>
          <td>${r.lowStockThreshold}</td>
          <td><span class="pill ${stockPillClass(r.status)}">${r.status}</span></td>
        </tr>`).join("")
      : emptyRow(5);
  }

  function renderIssuing(data) {
    const readiness = CEC.derive.buildReadiness(data.students);
    document.getElementById("issueReadyCount").textContent = readiness.ready;
    document.getElementById("issueWaitingCount").textContent = readiness.waiting;
    document.getElementById("issueUncoveredCount").textContent = readiness.uncovered;

    const ready = data.students.filter(s => s.status === "ready");
    document.getElementById("issueStudentsBody").innerHTML = ready.length
      ? ready.map(s => `
        <tr>
          <td><b>${esc(s.name)}</b><small>${esc(s.studentId)}</small></td>
          <td>${esc(s.className)}</td>
          <td><span class="pill success">Ready</span></td>
        </tr>`).join("")
      : emptyRow(3, "No students ready to issue yet.");

    const inv = CEC.viewModels.stockStatus(data.books);
    document.getElementById("issueBooksBody").innerHTML = inv.rows.length
      ? inv.rows.map(r => `
        <tr>
          <td><b>${esc(r.subject)}</b></td>
          <td>${r.stockQty}</td>
          <td><span class="pill ${stockPillClass(r.status)}">${r.status}</span></td>
        </tr>`).join("")
      : emptyRow(3);
  }

  function renderReports(data) {
    const cur = data.config.currency;
    const summary = CEC.viewModels.methodSummary(data.payments);
    const outstandingAmount = data.students.reduce((n, s) => n + CEC.viewModels.studentOutstanding(s), 0);
    document.getElementById("reportCash").textContent = CEC.derive.formatAmount(summary[0].total, cur);
    document.getElementById("reportMomo").textContent = CEC.derive.formatAmount(summary[1].total, cur);
    document.getElementById("reportTelecel").textContent = CEC.derive.formatAmount(summary[2].total, cur);
    document.getElementById("reportOutstanding").textContent = CEC.derive.formatAmount(outstandingAmount, cur);

    const classRows = CEC.viewModels.classTotals(data.payments);
    document.getElementById("reportClassBody").innerHTML = classRows.length
      ? classRows.map(r => `
        <tr>
          <td><b>${esc(r.className)}</b></td>
          <td>${CEC.derive.formatAmount(r.total, cur)}</td>
        </tr>`).join("")
      : emptyRow(2);

    const outRows = CEC.viewModels.outstandingList(data.students).slice(0, 10);
    document.getElementById("reportOutstandingBody").innerHTML = outRows.length
      ? outRows.map(r => `
        <tr>
          <td><b>${esc(r.name)}</b><small>${esc(r.studentId)}</small></td>
          <td>${esc(r.className)}</td>
          <td>${CEC.derive.formatAmount(r.balance, cur)}</td>
        </tr>`).join("")
      : emptyRow(3);
  }

  function renderSettings(data) {
    const cur = data.config.currency;
    const sys = data.config.activeYear || "—";
    const yrEl = document.getElementById("settingsYear");
    if (!activeYear || activeYear === sys) {
      yrEl.textContent = sys;
    } else {
      yrEl.innerHTML = esc(activeYear) + ' <small class="muted">(system: ' + esc(sys) + ")</small>";
    }
    document.getElementById("settingsTarget").textContent = CEC.derive.formatAmount(data.config.dailyTarget, cur) + " / day";
    document.getElementById("settingsCurrency").textContent = cur;
    document.getElementById("settingsStatus").textContent = data.offline ? "Offline (snapshot data)" : "Live (Google Sheets)";
  }

  const renderers = {
    dashboard: renderDashboard,
    students: renderStudents,
    payments: renderPayments,
    books: renderBooks,
    inventory: renderInventory,
    issuing: renderIssuing,
    reports: renderReports,
    settings: renderSettings
  };

  function setActiveNav(page) {
    document.querySelectorAll(".nav-item").forEach(item =>
      item.classList.toggle("active", item.dataset.page === page));
    sidebar.classList.remove("open");
  }

  function updateShell(page) {
    document.getElementById("pageTitle").textContent = PAGES[page].title;
    document.querySelectorAll(".page").forEach(sec => {
      sec.hidden = sec.id !== "page-" + page;
    });
  }

  async function route() {
    const page = CEC.viewModels.pageForHash(location.hash);
    setActiveNav(page);
    updateShell(page);
    currentData = await CEC.getAllData();
    if (!activeYear) activeYear = currentData.config.activeYear || "";
    renderers[page](viewData());
    renderBell();
  }

  async function refreshAll() {
    CEC.clearCache();
    await route();
  }

  const studentSearch = document.getElementById("studentSearch");
  if (studentSearch) {
    studentSearch.addEventListener("input", () => {
      if (currentData && CEC.viewModels.pageForHash(location.hash) === "students") {
        renderStudents(viewData());
      }
    });
  }

  window.CEC = window.CEC || {};
  window.CEC.refreshAll = refreshAll;

  window.addEventListener("hashchange", () => {
    route().catch(err => {
      console.error("Navigation load failed:", err);
      showToast("Could not load this view.");
    });
  });

  route().catch(err => {
    console.error("Dashboard load failed:", err);
    showToast("Could not load dashboard data.");
  });
})();