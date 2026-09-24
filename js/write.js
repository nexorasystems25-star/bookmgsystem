(() => {
  const root = window.CEC = window.CEC || {};

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  const METHODS = ["Cash", "MTN MoMo", "Telecel"];
  const GENDERS = ["male", "female"];

  async function post(op, body) {
    const res = await fetch("api/" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    adjustStock: s => runAndRefresh("stock", s)
  };

  const dialogs = {
    payment: document.getElementById("dlgPayment"),
    student: document.getElementById("dlgStudent"),
    issue: document.getElementById("dlgIssue"),
    stock: document.getElementById("dlgStock")
  };

  let studentBooks = [];
  let studentFees = [];
  let issueOpts = null;
  let stockOpts = null;
  let stockMode = "textbook";
  let studentMode = "both";

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

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dlg = btn.closest("dialog");
      if (dlg) dlg.close();
    });
  });

  dialogs.stock.addEventListener("close", () => {
    stockMode = "textbook";
  });

  dialogs.student.addEventListener("close", () => {
    studentMode = "both";
  });

  async function populate(name) {
    const opts = await root.fetchOptions();
    if (name === "student") {
      studentBooks = opts.books;
      studentFees = opts.classFees;
      const classSel = applyStudentMode();
      fillClassFields(classSel.value);
    }
    if (name === "payment") {
      const studentSel = dialogs.payment.querySelector("[data-student]");
      studentSel.innerHTML = '<option value="">Select student…</option>' + opts.students
        .map(s => '<option value="' + esc(s.studentId) + '">' + esc(s.name) + " (" + esc(s.className) + ")</option>")
        .join("");
    }
    if (name === "issue") {
      issueOpts = opts;
      const studentSel = dialogs.issue.querySelector("[data-student]");
      studentSel.innerHTML = '<option value="">Select student…</option>' + opts.students
        .map(s => '<option value="' + esc(s.studentId) + '">' + esc(s.name) + " (" + esc(s.className) + ")</option>")
        .join("");
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
    const eligible = root.viewModels.issueEligibleBooks(issueOpts.books, student, issueOpts.activity);
    if (!eligible.length) {
      box.innerHTML = '<p class="empty-note">No books available for ' + esc(student.name) + " right now.</p>";
      return;
    }
    box.innerHTML = eligible.map(b =>
      '<label class="book-option"><input type="checkbox" data-book-check value="' + esc(b.bookId) + '">' +
      '<span class="book-name">' + esc(b.subject) + "<small>" + esc(b.publisher) + " · stock " + b.stockQty + "</small></span>" +
      '<span class="price">GH₵' + Number(b.price) + "</span></label>"
    ).join("");
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

  dialogs.payment.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const amount = Number(readValue(dlg, "[data-amount]"));
    if (!(amount > 0)) return showError(dlg, "Amount must be a positive number.");
    const method = readValue(dlg, "[data-method]");
    if (METHODS.indexOf(method) === -1) return showError(dlg, "Select a payment method.");
    const studentId = readValue(dlg, "[data-student]");
    if (!studentId) return showError(dlg, "Select a student.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.recordPayment({ student_id: studentId, amount, method });
      dlg.close();
      showToast("Payment recorded.");
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

  dialogs.stock.querySelector("[data-class]").addEventListener("change", e => {
    renderStockBooks(e.currentTarget.value);
  });

  dialogs.issue.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const studentId = readValue(dlg, "[data-student]");
    const books = Array.prototype.slice.call(dlg.querySelectorAll("[data-book-check]:checked"))
      .map(cb => cb.value);
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

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }
})();
