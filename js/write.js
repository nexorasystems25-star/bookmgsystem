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

  function openDialog(name) {
    const dlg = dialogs[name];
    if (!dlg) return;
    clearError(dlg);
    populate(name).then(() => dlg.showModal());
  }

  document.querySelectorAll("[data-action]").forEach(btn => {
    const action = btn.dataset.action;
    if (action in dialogs) {
      btn.addEventListener("click", () => openDialog(action));
    }
  });

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dlg = btn.closest("dialog");
      if (dlg) dlg.close();
    });
  });

  async function populate(name) {
    const opts = await root.fetchOptions();
    if (name === "student") {
      studentBooks = opts.books;
      studentFees = opts.classFees;
      const classSel = dialogs.student.querySelector("[data-class]");
      classSel.innerHTML = '<option value="">Select class…</option>' + root.viewModels.bookCategories(studentBooks)
        .map(c => '<option value="' + esc(c) + '">' + esc(root.viewModels.classOptionLabel(c, studentBooks, studentFees)) + "</option>")
        .join("");
      fillClassFields(classSel.value);
    }
    if (name === "payment" || name === "issue") {
      const studentSel = dialogs[name].querySelector("[data-student]");
      studentSel.innerHTML = '<option value="">Select student…</option>' + opts.students
        .map(s => '<option value="' + esc(s.studentId) + '">' + esc(s.name) + " (" + esc(s.className) + ")</option>")
        .join("");
    }
    if (name === "issue" || name === "stock") {
      const bookSel = dialogs[name].querySelector("[data-book]");
      bookSel.innerHTML = '<option value="">Select book…</option>' + opts.books
        .map(b => '<option value="' + esc(b.bookId) + '" data-stock="' + b.stockQty + '">' + esc(b.subject) + " — " + esc(b.publisher) + " (stock " + b.stockQty + ")</option>")
        .join("");
    }
  }

  function readValue(dlg, sel) {
    const el = dlg.querySelector(sel);
    return el ? el.value : "";
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
      await root.write.registerStudent({ name, class: klass, gender, books_fee: fee, books_total: total, exbooks });
      dlg.close();
      showToast("Student registered.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.issue.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const studentId = readValue(dlg, "[data-student]");
    const bookId = readValue(dlg, "[data-book]");
    const qty = Number(readValue(dlg, "[data-qty]"));
    if (!studentId) return showError(dlg, "Select a student.");
    if (!bookId) return showError(dlg, "Select a book.");
    if (!Number.isInteger(qty) || qty < 1) return showError(dlg, "Quantity must be a positive whole number.");
    const bookSell = dlg.querySelector("[data-book]");
    if (qty > Number(bookSell.selectedOptions[0].dataset.stock)) return showError(dlg, "Quantity exceeds current stock.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.issueBooks({ student_id: studentId, book_id: bookId, qty });
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
    const bookId = readValue(dlg, "[data-book]");
    const delta = Number(readValue(dlg, "[data-delta]"));
    if (!bookId) return showError(dlg, "Select a book.");
    if (!Number.isInteger(delta) || delta === 0) return showError(dlg, "Adjustment must be a non-zero whole number (use − to reduce).");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.adjustStock({ book_id: bookId, stock_delta: delta });
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
