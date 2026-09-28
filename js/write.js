(() => {
  const root = window.CEC = window.CEC || {};

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  const METHODS = ["Cash", "MTN MoMo", "Telecel"];
  const GENDERS = ["male", "female"];
  const CONFIG_SOURCES = ["live", "offline"];

  // Pure combobox filter, kept outside the DOM so the write bindings stay testable.
  function filterStudents(students, query) {
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return (students || []).slice();
    return (students || []).filter(s => s && (
      String(s.name || "").toLowerCase().indexOf(q) !== -1 ||
      String(s.className || "").toLowerCase().indexOf(q) !== -1 ||
      String(s.studentId || "").toLowerCase().indexOf(q) !== -1
    ));
  }
  root.studentLookup = { filter: filterStudents };

  async function post(op, body) {
    const headers = { "Content-Type": "application/json" };
    const s = root.session && root.session.load();
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    const res = await fetch("api/" + op, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || ("Write failed (HTTP " + res.status + ")"));
    }
    return data;
  }

  async function runAndRefresh(op, body) {
    try {
      await post(op, body);
    } finally {
      await root.refreshAll();
    }
  }

  root.write = {
    recordPayment: p => runAndRefresh("payment", p),
    registerStudent: s => runAndRefresh("student", s),
    issueBooks: i => runAndRefresh("issue", i),
    adjustStock: s => runAndRefresh("stock", s),
    updateConfig: p => runAndRefresh("config", p)
  };

  // O2 split validation: the server only checks shape, so the client additionally requires
  // the year to exist in the dataset — a typo must not become a selectable-but-empty default.
  function validateConfigDraft(draft, data) {
    const year = String((draft && draft.year) || "").trim();
    if (!year) return { ok: false, error: "Academic year is required." };
    const years = root.viewModels.availableYears((data && data.students) || [], (data && data.config) || {});
    if (!years.length) return { ok: false, error: "No academic years found in the loaded data." };
    if (years.indexOf(year) === -1) {
      return { ok: false, error: 'Academic year "' + year + '" is not in the loaded data. Pick one of: ' + years.join(", ") };
    }
    // Number("") and Number(null) are both 0, so emptiness is checked before the conversion.
    const rawTarget = draft && draft.target != null ? String(draft.target).trim() : "";
    if (!rawTarget) return { ok: false, error: "Daily payment target is required." };
    const target = Number(rawTarget);
    if (!isFinite(target) || target < 0) return { ok: false, error: "Daily payment target must be zero or more." };
    const currency = String((draft && draft.currency) || "").trim();
    if (!currency) return { ok: false, error: "Currency is required." };
    if (currency.length > 10) return { ok: false, error: "Currency must be 10 characters or fewer." };
    const source = String((draft && draft.source) || "live");
    if (CONFIG_SOURCES.indexOf(source) === -1) return { ok: false, error: "Select live or offline as the data source." };
    return {
      ok: true,
      payload: { academic_year: year, daily_payment_target: target, currency: currency },
      source: source
    };
  }

  // O7: the local data-source flag flips only after a successful save. `apply` is injected so
  // the ordering is testable without a DOM.
  function applyConfigResult(result, source, apply) {
    if (!result || result.ok !== true) {
      return { applied: false, error: (result && result.error) || "Settings were not saved." };
    }
    apply(source === "offline");
    return { applied: true, error: "" };
  }

  root.configForm = { validate: validateConfigDraft, applyResult: applyConfigResult };

  // Client-side validation for the inline NEW-student block of a combined payment. Mirrors
  // api/_lib.validateStudentPayload, returning the raw `class` key the server expects.
  function validateNewStudentPayload(newStudent) {
    const n = newStudent || {};
    const name = String(n.name || "").trim();
    if (!name) return { ok: false, error: "Student name is required." };
    const klass = String(n.class || "").trim();
    if (!klass) return { ok: false, error: "Class is required." };
    if (GENDERS.indexOf(n.gender) === -1) return { ok: false, error: "Select a gender." };
    const fee = Number(n.books_fee);
    const total = Number(n.books_total);
    const exbooks = Number(n.exbooks || 0);
    if (!(fee >= 0) || !(total >= 0) || !(exbooks >= 0)) return { ok: false, error: "Books fee, total and exercise books must be zero or more." };
    return { ok: true, payload: { name: name, class: klass, gender: n.gender, books_fee: fee, books_total: total, exbooks: exbooks } };
  }

  // The payment combobox offers "＋ Add new student" when nothing matches; the Issue dialog
  // never does (its students must already exist).
  function shouldOfferAddNew(isPaymentDialog, matches) {
    return isPaymentDialog && (matches || []).length === 0;
  }

  root.paymentForm = { newStudentPayload: validateNewStudentPayload, shouldOfferAddNew: shouldOfferAddNew };

  const dialogs = {
    payment: document.getElementById("dlgPayment"),
    student: document.getElementById("dlgStudent"),
    issue: document.getElementById("dlgIssue"),
    stock: document.getElementById("dlgStock"),
    config: document.getElementById("dlgConfig")
  };

  let studentBooks = [];
  let studentFees = [];
  let paymentStudents = [];
  let issueOpts = null;
  let stockOpts = null;
  let stockMode = "textbook";
  let studentMode = "both";
  let newStudentMode = "both";

  function showError(dlgId, msg) {
    const el = dlgId.querySelector("[data-error]");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function clearError(dlgId) {
    const el = dlgId.querySelector("[data-error]");
    if (el) el.hidden = true;
  }

  function openDialog(name, mode) {
    const dlg = dialogs[name];
    if (!dlg) return;
    clearError(dlg);
    if (name === "student") studentMode = mode === "textbook" ? "textbook" : mode === "exbooks" ? "exbooks" : "both";
    if (name === "stock") stockMode = mode === "exbooks" ? "exbooks" : "textbook";
    populate(name).then(() => dlg.showModal());
  }

  document.querySelectorAll("[data-action]").forEach(btn => {
    const action = btn.dataset.action;
    if (action in dialogs) {
      btn.addEventListener("click", () => openDialog(action));
    } else if (action === "stock-ex") {
      btn.addEventListener("click", () => openDialog("stock", "exbooks"));
    } else if (action === "student-txt") {
      btn.addEventListener("click", () => openDialog("student", "textbook"));
    } else if (action === "student-ex") {
      btn.addEventListener("click", () => openDialog("student", "exbooks"));
    }
  });

  document.querySelectorAll("[data-edit-config]").forEach(btn => {
    // app.js loads first and stubs a toast on this same click; retract it before the dialog opens.
    btn.addEventListener("click", () => { hideToast(); openDialog("config"); });
  });

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dlg = btn.closest("dialog");
      if (dlg) dlg.close();
    });
  });

  dialogs.stock.addEventListener("close", () => {
    stockMode = "textbook";
  });

  dialogs.payment.addEventListener("close", () => {
    resetNewStudent(dialogs.payment);
  });

  async function populate(name) {
    if (name === "config") {
      const data = await root.getAllData();
      const cfg = data.config || {};
      dialogs.config.querySelector("[data-year]").value = cfg.activeYear || "";
      dialogs.config.querySelector("[data-target]").value = cfg.dailyTarget != null ? String(cfg.dailyTarget) : "";
      dialogs.config.querySelector("[data-currency]").value = cfg.currency || "";
      dialogs.config.querySelector("[data-source]").value = root.forceOffline ? "offline" : "live";
      return;
    }
    const opts = await root.fetchOptions();
    if (name === "student") {
      studentBooks = opts.books;
      studentFees = opts.classFees;
      const classSel = applyStudentMode();
      fillClassFields(classSel.value);
    }
    if (name === "payment") {
      paymentStudents = opts.students;
      studentBooks = opts.books;
      studentFees = opts.classFees;
      const studentSel = dialogs.payment.querySelector("[data-student]");
      studentSel.innerHTML = '<option value="">Select student…</option>' + opts.students
        .map(s => '<option value="' + esc(s.studentId) + '">' + esc(s.name) + " (" + esc(s.className) + ")</option>")
        .join("");
      resetStudentCombo(dialogs.payment);
      resetNewStudent(dialogs.payment);
    }
    if (name === "issue") {
      issueOpts = opts;
      const studentSel = dialogs.issue.querySelector("[data-student]");
      studentSel.innerHTML = '<option value="">Select student…</option>' + opts.students
        .map(s => '<option value="' + esc(s.studentId) + '">' + esc(s.name) + " (" + esc(s.className) + ")</option>")
        .join("");
      resetStudentCombo(dialogs.issue);
      renderIssueBooks("");
    }
    if (name === "stock") {
      stockOpts = opts;
      const ex = stockMode === "exbooks";
      const cats = root.viewModels[ex ? "exerciseBookCategories" : "bookCategories"](opts.books);
      const classSel = dialogs.stock.querySelector("[data-class]");
      classSel.innerHTML = '<option value="">' + (ex ? "Select size…" : "Select class…") + "</option>" + cats
        .map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>")
        .join("");
      const title = dialogs.stock.querySelector(".modal-head h3");
      if (title) title.textContent = ex ? "Adjust stock — ExBooks" : "Adjust stock — Books";
      renderStockBooks("");
    }
  }

  function renderIssueBooks(studentId) {
    const box = dialogs.issue.querySelector("[data-books]");
    if (!box || !issueOpts) return;
    const student = (issueOpts.students || []).find(s => s.studentId === studentId);
    if (!student) {
      box.innerHTML = '<p class="empty-note">Select a student to see their available books.</p>';
      return;
    }
    const textbooks = root.viewModels.issueEligibleBooks(issueOpts.books, student, issueOpts.issued);
    const exbooks = root.viewModels.issueEligibleExBooks(issueOpts.books, student, issueOpts.issued, issueOpts.classFees);
    if (!textbooks.length && !exbooks.length) {
      box.innerHTML = '<p class="empty-note">No books available for ' + esc(student.name) + " right now.</p>";
      return;
    }
    const parts = [];
    if (textbooks.length) {
      parts.push('<h4 class="book-group-head">Textbooks</h4>');
      textbooks.forEach(b => {
        parts.push(
          '<label class="book-option"><input type="checkbox" data-book-check value="' + esc(b.bookId) + '">' +
          '<span class="book-name">' + esc(b.subject) + "<small>" + esc(b.publisher) + " · stock " + b.stockQty + "</small></span>" +
          '<span class="price">GH₵' + Number(b.price) + "</span></label>"
        );
      });
    }
    if (exbooks.length) {
      parts.push('<h4 class="book-group-head">ExBooks</h4>');
      exbooks.forEach(x => {
        parts.push(
          '<label class="book-option"><input type="checkbox" data-exbook-check value="' + esc(x.book.bookId) + '" data-qty="' + x.qty + '">' +
          '<span class="book-name">' + esc(x.book.subject) + " (" + esc(x.book.category) + ")" +
          " · need " + x.required + (x.qty < x.required ? " · " + x.qty + " left" : "") +
          " · stock " + x.stock + "</span>" +
          '<span class="price">×' + x.qty + "</span></label>"
        );
      });
    }
    box.innerHTML = parts.join("");
  }

  function renderStockBooks(className) {
    const box = dialogs.stock.querySelector("[data-stock-list]");
    if (!box || !stockOpts) return;
    if (!className) {
      box.innerHTML = '<p class="empty-note">' + (stockMode === "exbooks" ? "Select an exercise size to see its books." : "Select a class to see its books.") + "</p>";
      return;
    }
    const classBooks = stockOpts.books.filter(b => b.category === className);
    if (!classBooks.length) {
      box.innerHTML = '<p class="empty-note">No books for ' + esc(className) + " right now.</p>";
      return;
    }
    box.innerHTML = classBooks.map(b =>
      '<label class="book-option"><span class="book-name">' + esc(b.subject) +
      '<small>' + esc(b.publisher) + " · stock " + b.stockQty + "</small></span>" +
      '<input type="number" class="qty" step="1" data-qty data-book="' + esc(b.bookId) + '" placeholder="0"></label>'
    ).join("");
  }

  function readValue(dlg, sel) {
    const el = dlg.querySelector(sel);
    return el ? el.value : "";
  }

  function applyStudentMode() {
    const ex = studentMode === "exbooks";
    const txt = studentMode === "textbook";
    const classSel = dialogs.student.querySelector("[data-class]");
    const cats = root.viewModels[ex ? "exerciseBookCategories" : "bookCategories"](studentBooks);
    classSel.innerHTML = '<option value="">' + (ex ? "Select size…" : "Select class…") + "</option>" + cats
      .map(c => '<option value="' + esc(c) + '">' + esc(root.viewModels.classOptionLabel(c, studentBooks, studentFees)) + "</option>")
      .join("");
    const heading = dialogs.student.querySelector("[data-student-heading]");
    if (heading) heading.textContent = ex ? "Register student — ExBooks" : txt ? "Register student — Textbooks" : "Register student";
    dialogs.student.querySelectorAll("[data-mode-show]").forEach(row => {
      const show = row.dataset.modeShow.split(",").indexOf(studentMode) !== -1;
      row.hidden = !show;
      row.style.display = show ? "" : "none";
      const input = row.querySelector("input");
      if (input) input.required = show;
    });
    dialogs.student.querySelectorAll("[data-student-modes] [data-mode]").forEach(btn => {
      const active = btn.dataset.mode === studentMode;
      btn.classList.toggle("btn-primary", active);
      btn.classList.toggle("btn-light", !active);
    });
    return classSel;
  }

  function applyNewStudentMode() {
    const ex = newStudentMode === "exbooks";
    const txt = newStudentMode === "textbook";
    const classSel = dialogs.payment.querySelector("[data-new-class]");
    const cats = root.viewModels[ex ? "exerciseBookCategories" : "bookCategories"](studentBooks);
    classSel.innerHTML = '<option value="">' + (ex ? "Select size…" : "Select class…") + "</option>" + cats
      .map(c => '<option value="' + esc(c) + '">' + esc(root.viewModels.classOptionLabel(c, studentBooks, studentFees)) + "</option>")
      .join("");
    const heading = dialogs.payment.querySelector("[data-new-heading]");
    if (heading) heading.textContent = ex ? "New student — ExBooks" : txt ? "New student — Textbooks" : "New student";
    dialogs.payment.querySelectorAll("[data-new-mode-show]").forEach(row => {
      const show = row.dataset.modeShow.split(",").indexOf(newStudentMode) !== -1;
      row.hidden = !show;
      row.style.display = show ? "" : "none";
    });
    dialogs.payment.querySelectorAll("[data-new-modes] [data-mode]").forEach(btn => {
      const active = btn.dataset.mode === newStudentMode;
      btn.classList.toggle("btn-primary", active);
      btn.classList.toggle("btn-light", !active);
    });
    return classSel;
  }

  function fillClassFields(className) {
    const info = root.viewModels.classBookInfo(studentBooks, className, studentFees);
    dialogs.student.querySelector("[data-total]").value = info.count > 0 ? String(info.count) : "";
    dialogs.student.querySelector("[data-fee]").value = info.fee > 0 ? String(info.fee) : "";
    dialogs.student.querySelector("[data-exbooks]").value = info.exbooks > 0 ? String(info.exbooks) : "";
  }

  dialogs.student.querySelector("[data-class]").addEventListener("change", () => {
    fillClassFields(readValue(dialogs.student, "[data-class]"));
  });

  dialogs.student.querySelectorAll("[data-student-modes] [data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      studentMode = btn.dataset.mode === "textbook" || btn.dataset.mode === "exbooks" ? btn.dataset.mode : "both";
      const classSel = applyStudentMode();
      fillClassFields(classSel.value);
    });
  });

  dialogs.payment.querySelector("[data-new-class]").addEventListener("change", () => {
    refreshNewStudentTotals(dialogs.payment);
  });

  dialogs.payment.querySelectorAll("[data-new-modes] [data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      newStudentMode = btn.dataset.mode === "textbook" || btn.dataset.mode === "exbooks" ? btn.dataset.mode : "both";
      applyNewStudentMode();
      refreshNewStudentTotals(dialogs.payment);
    });
  });

  dialogs.payment.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const amount = Number(readValue(dlg, "[data-amount]"));
    if (!(amount > 0)) return showError(dlg, "Amount must be a positive number.");
    const method = readValue(dlg, "[data-method]");
    if (METHODS.indexOf(method) === -1) return showError(dlg, "Select a payment method.");
    const studentId = readValue(dlg, "[data-student]");
    if (!studentId) return showError(dlg, "Select a student.");
    const payload = { student_id: studentId, amount: amount, method: method };
    if (studentId === "NEW") {
      const checked = validateNewStudentPayload({
        name: readValue(dlg, "[data-new-name]"),
        class: readValue(dlg, "[data-new-class]"),
        gender: readValue(dlg, "[data-new-gender]"),
        books_fee: readValue(dlg, "[data-new-fee]"),
        books_total: readValue(dlg, "[data-new-total]"),
        exbooks: readValue(dlg, "[data-new-exbooks]")
      });
      if (!checked.ok) return showError(dlg, checked.error);
      const q = root.viewModels.purchasePayload(newStudentMode, {
        fee: checked.payload.books_fee, total: checked.payload.books_total, exbooks: checked.payload.exbooks
      });
      payload.new_student = {
        name: checked.payload.name, class: checked.payload.class, gender: checked.payload.gender,
        books_fee: q.fee, books_total: q.total, exbooks: q.exbooks
      };
    }
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.recordPayment(payload);
      dlg.close();
      showToast(studentId === "NEW" ? "Student registered and payment recorded." : "Payment recorded.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.student.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const name = readValue(dlg, "[data-name]").trim();
    const klass = readValue(dlg, "[data-class]").trim();
    const gender = readValue(dlg, "[data-gender]");
    const fee = Number(readValue(dlg, "[data-fee]"));
    const total = Number(readValue(dlg, "[data-total]"));
    const exbooks = Number(readValue(dlg, "[data-exbooks]"));
    if (!name) return showError(dlg, "Student name is required.");
    if (!klass) return showError(dlg, "Class is required.");
    if (GENDERS.indexOf(gender) === -1) return showError(dlg, "Select a gender.");
    if (!(fee >= 0) || !(total >= 0) || !(exbooks >= 0)) return showError(dlg, "Books fee, total and exercise books must be zero or more.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      const payload = root.viewModels.purchasePayload(studentMode, { fee, total, exbooks });
      await root.write.registerStudent({ name, class: klass, gender, books_fee: payload.fee, books_total: payload.total, exbooks: payload.exbooks });
      dlg.close();
      showToast("Student registered.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.issue.querySelector("[data-student]").addEventListener("change", e => {
    renderIssueBooks(e.currentTarget.value);
  });

  function comboStudents(dlg) {
    if (dlg === dialogs.payment) return paymentStudents;
    return issueOpts ? issueOpts.students : [];
  }

  function resetStudentCombo(dlg) {
    const input = dlg.querySelector("[data-student-input]");
    const list = dlg.querySelector("[data-student-list]");
    if (input) input.value = "";
    if (list) { list.innerHTML = ""; list.hidden = true; }
  }

  function renderStudentList(dlg, query, active) {
    const list = dlg.querySelector("[data-student-list]");
    if (!list || !comboStudents(dlg).length) return;
    const matches = filterStudents(comboStudents(dlg), query);
    if (!matches.length) {
      if (shouldOfferAddNew(dlg === dialogs.payment, matches)) {
        list.innerHTML = '<li class="combo-option" data-add-new><span class="combo-name">＋ Add new student</span></li>';
        list.hidden = false;
        return;
      }
      list.innerHTML = '<li class="combo-empty">No students match.</li>';
      list.hidden = false;
      return;
    }
    list.innerHTML = matches.map((s, i) =>
      '<li class="combo-option' + (i === active ? " active" : "") + '" data-student-option data-id="' + esc(s.studentId) + '">' +
      '<span class="combo-name">' + esc(s.name) + '</span><small class="combo-class">' + esc(s.className) + " · " + esc(s.studentId) + "</small></li>"
    ).join("");
    list.hidden = false;
  }

  function commitStudentOption(dlg, option) {
    const input = dlg.querySelector("[data-student-input]");
    const hidden = dlg.querySelector("[data-student]");
    const list = dlg.querySelector("[data-student-list]");
    if (option.dataset && option.dataset.addNew !== undefined) {
      commitAddNewStudent(dlg);
      return;
    }
    const student = comboStudents(dlg).find(s => s.studentId === option.dataset.id);
    if (!student) return;
    hidden.value = student.studentId;
    if (input) input.value = student.name + " (" + student.className + ")";
    if (list) { list.innerHTML = ""; list.hidden = true; }
    hideNewStudent(dlg);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function refreshNewStudentTotals(dlg) {
    if (!dlg.querySelector("[data-new-section]")) return;
    const info = root.viewModels.classBookInfo(studentBooks, readValue(dlg, "[data-new-class]"), studentFees);
    const field = (sel, val) => { const el = dlg.querySelector(sel); if (el) el.value = val; };
    const show = modeShow => modeShow.split(",").indexOf(newStudentMode) !== -1;
    field("[data-new-total]", show("both,textbook") && info.count > 0 ? String(info.count) : "");
    field("[data-new-fee]", show("both,textbook") && info.fee > 0 ? String(info.fee) : "");
    field("[data-new-exbooks]", show("both,exbooks") && info.exbooks > 0 ? String(info.exbooks) : "");
  }

  function hideNewStudent(dlg) {
    const section = dlg.querySelector("[data-new-section]");
    if (!section) return;
    section.hidden = true;
    section.style.display = "none";
  }

  function commitAddNewStudent(dlg) {
    const hidden = dlg.querySelector("[data-student]");
    if (hidden) hidden.value = "NEW";
    const input = dlg.querySelector("[data-student-input]");
    if (input) input.value = "";
    const list = dlg.querySelector("[data-student-list]");
    if (list) { list.innerHTML = ""; list.hidden = true; }
    const section = dlg.querySelector("[data-new-section]");
    if (!section) return;
    newStudentMode = "both";
    applyNewStudentMode();
    refreshNewStudentTotals(dlg);
    section.hidden = false;
    section.style.display = "";
    const name = dlg.querySelector("[data-new-name]");
    if (name && name.focus) name.focus();
  }

  function resetNewStudent(dlg) {
    const hidden = dlg.querySelector("[data-student]");
    if (hidden) hidden.value = "";
    newStudentMode = "both";
    applyNewStudentMode();
    hideNewStudent(dlg);
    refreshNewStudentTotals(dlg);
  }

  function bindStudentCombo(name) {
    const dlg = dialogs[name];
    if (!dlg) return;
    const input = dlg.querySelector("[data-student-input]");
    const list = dlg.querySelector("[data-student-list]");
    if (!input || !list) return;
    let active = -1;
    input.addEventListener("input", () => {
      active = -1;
      renderStudentList(dlg, input.value, -1);
    });
    input.addEventListener("keydown", e => {
      const rows = list.hidden ? [] : list.querySelectorAll("[data-student-option],[data-add-new]");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) {
          active = 0;
          renderStudentList(dlg, input.value, 0);
        } else if (rows.length) {
          active = (active + 1) % rows.length;
          renderStudentList(dlg, input.value, active);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!rows.length) return;
        active = (active - 1 + rows.length) % rows.length;
        renderStudentList(dlg, input.value, active);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const pick = rows[active >= 0 ? active : 0];
        if (pick) commitStudentOption(dlg, pick);
        return;
      }
      if (e.key === "Escape") {
        if (!list.hidden) { list.hidden = true; e.preventDefault(); }
        return;
      }
    });
    list.addEventListener("mousedown", e => {
      const option = e.target && e.target.closest ? e.target.closest("[data-student-option],[data-add-new]") : null;
      if (option) { e.preventDefault(); commitStudentOption(dlg, option); }
    });
  }

  bindStudentCombo("payment");
  bindStudentCombo("issue");

  dialogs.stock.querySelector("[data-class]").addEventListener("change", e => {
    renderStockBooks(e.currentTarget.value);
  });

  dialogs.issue.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const studentId = readValue(dlg, "[data-student]");
    const textbookIds = Array.prototype.slice.call(dlg.querySelectorAll("[data-book-check]:checked"))
      .map(cb => cb.value);
    const exbooks = Array.prototype.slice.call(dlg.querySelectorAll("[data-exbook-check]:checked"))
      .map(cb => ({ book_id: cb.value, qty: Number(cb.dataset.qty) }));
    const books = textbookIds.concat(exbooks);
    if (!studentId) return showError(dlg, "Select a student.");
    if (!books.length) return showError(dlg, "Tick at least one book to issue.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.issueBooks({ student_id: studentId, books });
      dlg.close();
      showToast("Books issued.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.stock.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const adjustments = Array.prototype.slice.call(dlg.querySelectorAll("[data-qty]"))
      .filter(inp => {
        const v = Number(inp.value);
        return v !== 0 && Number.isInteger(v);
      })
      .map(inp => ({ book_id: inp.dataset.book, stock_delta: Number(inp.value) }));
    if (!adjustments.length) return showError(dlg, "Enter a quantity for at least one book.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.adjustStock({ stock_adjustments: adjustments });
      dlg.close();
      showToast("Stock adjusted.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.config.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const checked = validateConfigDraft({
      year: readValue(dlg, "[data-year]"),
      target: readValue(dlg, "[data-target]"),
      currency: readValue(dlg, "[data-currency]"),
      source: readValue(dlg, "[data-source]")
    }, await root.getAllData());
    if (!checked.ok) return showError(dlg, checked.error);
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.updateConfig(checked.payload);
      // O7: a failed POST throws above, so nothing has flipped locally by the time we get here.
      applyConfigResult({ ok: true }, checked.source, offline => { root.forceOffline = offline; });
      dlg.close();
      showToast("Settings updated.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function hideToast() {
    const toast = document.getElementById("toast");
    if (!toast) return;
    clearTimeout(window.__toastTimer);
    toast.classList.remove("show");
  }
})();
