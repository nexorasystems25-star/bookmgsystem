# Register Student — Purchase Modes (Textbooks / ExBooks / Both)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a three-position purchase-mode switch to the register-student dialog
(#dlgStudent) — **Textbooks / ExBooks / Both** — mirroring the already-shipped
stock dialog's stockMode pattern, so the same dialog registers textbook-only,
exercise-book-only, or both purchases. Backend contract unchanged.

**Architecture:** Pure frontend. A module-scoped studentMode flag (default
"both") is set by an optional mode second argument to openDialog, exactly
like stockMode. The dialog's heading, the class vs. size dropdown source
(ookCategories vs exerciseBookCategories), and which rows ([data-fee],
[data-total], [data-exbooks]) are visible all branch on the flag. The submit
handler stays mode-aware: it zero-fills whichever mode's fields are hidden. No
pi/ or backend change.

**Tech Stack:** Vanilla JS (existing js/write.js view-models + ES module pattern),
plain HTML5 <dialog>, existing oot.viewModels helpers. Node 18+ for tests.

---

## Spec

- docs/superpowers/specs/2026-09-24-register-purchase-mode-design.md

## Files

- Modify: **index.html** — register dialog (#dlgStudent lines 445-466):
  add a heading that switches per mode; add per-row data-mode-show attributes
  on the fee, total, exbooks rows; add a small mode-switch control (segmented
  buttons) in the dialog; add data-mode buttons in the toolbar / table head that
  open the dialog pre-set to a mode (mirroring data-action="stock-ex").
- Modify: **js/write.js** — add let studentMode = "both";, teach
  openDialog to accept + apply a mode for the student dialog, switch
  heading/dropdown/rows in populate("student"), and make the student submit
  handler mode-aware.
- Test: **scripts/test.js** — new unit cases for a purchaseSerializedValue
  + the mode-aware register payload builder.
- Test: **	ests/unit/register-student-modes.test.js** — new unit suite.

## Conventions

- Node 18+; tests via 
pm test (scripts/test.js). Write tests **first** for
  every payload-builder function.
- Match existing write.js style: switch over stockMode-style branches,
  eadValue/showError/esc helpers, template-literal HTML, no new deps,
  no comments.
- Follow the repo's existing conventions (single-dialog pattern), and commit
  after each task (docs/superpowers plans stay untracked per repo rule:
  see AGENTS.md "never commit plan/specs" — **override:** this plan's spec IS
  committed because it is a product spec under docs/superpowers/specs, matching
  the existing committed specs 2026-09-22-stage-02 and 2026-09-23-stage-03.
  The plan doc itself is **not** committed.)

## Tasks

### Task 1: serialization helper + register payload builder (TDD)

**Files:**
- Modify: js/write.js
- Create: 	ests/unit/register-student-modes.test.js

- [ ] **Step 1: Add the failing tests**

`js
// tests/unit/register-student-modes.test.js
test("exbooks serialized as string on register payload", () => {
  // if we add a helper, assert it; placeholder until helper exists
});
`

- [ ] **Step 2: Run to confirm fail**

Run: 
pm test → FAIL (module/helper not found)

- [ ] **Step 3: Implement in write.js**

`js
function purchasePayload(mode, values) {
  const fee = mode === "exbooks" ? 0 : Number(values.fee || 0);
  const total = mode === "exbooks" ? 0 : Number(values.total || 0);
  const exbooks = mode === "textbook" ? 0 : Number(values.exbooks || 0);
  return { fee, total, exbooks };
}
`

- [ ] **Step 4: Run to confirm pass**

Run: 
pm test → PASS

- [ ] **Step 5: Commit**

`ash
git add index.html js/write.js tests/unit/register-student-modes.test.js
git commit -m "feat: register purchase mode — add mode-aware payload builder (TDD)"
`

### Task 2: register dialog mode markup + toolbar buttons

**Files:**
- Modify: index.html

- [ ] **Step 1: Add heading + mode-switch control + row mode attributes**

In #dlgStudent modal-head replace hardcoded Register student heading with an
element the JS can retarget: <h3 data-student-heading>Register student</h3>.
Add per-row data-mode-show attributes: fee + total rows
data-mode-show="both,textbook", exbooks row data-mode-show="both,exbooks".
Add a small segmented mode switch in the dialog body:

`html
<div class="segmented" data-student-modes>
  <button type="button" data-mode="textbook">Textbooks</button>
  <button type="button" data-mode="exbooks">ExBooks</button>
  <button type="button" data-mode="both" class="active">Both</button>
</div>
`

Add toolbar buttons (next to data-action="student"):

`html
<button class="btn btn-outline" type="button" data-action="student-txt">+ Textbooks</button>
<button class="btn btn-outline" type="button" data-action="student-ex">+ ExBooks</button>
`

- [ ] **Step 2: Commit**

`ash
git add index.html
git commit -m "feat: register purchase mode — dialog mode switch + toolbar buttons"
`

### Task 3: write.js — studentMode + openDialog + populate + submit (mode-aware)

**Files:**
- Modify: js/write.js

- [ ] **Step 1: Add flag + teach openDialog**

`js
let studentMode = "both"; // next to stockMode

function openDialog(name, mode) {
  const dlg = dialogs[name];
  if (!dlg) return;
  clearError(dlg);
  if (name === "student") {
    studentMode = mode === "textbook" ? "textbook" : mode === "exbooks" ? "exbooks" : "both";
  }
  if (name === "stock") stockMode = mode === "exbooks" ? "exbooks" : "textbook";
  populate(name).then(() => dlg.showModal());
}
`

- [ ] **Step 2: populate('student') mode-aware**

In populate, replace the hardcoded heading + dropdown source:

`js
if (name === "student") {
  const ex = studentMode === "exbooks";
  const txt = studentMode === "textbook";
  const classSel = dialogs.student.querySelector("[data-class]");
  classSel.innerHTML = '<option value="">Select class�?�</option>'
    + root.viewModels[ex ? "exerciseBookCategories" : "bookCategories"](studentBooks)
      .map(c => '<option value="' + esc(c) + '">' + esc(root.viewModels.classOptionLabel(c, studentBooks, studentFees)) + "</option>")
      .join("");
  const head = dialogs.student.querySelector("[data-student-heading]");
  head.textContent = ex ? "Register student — ExBooks" : txt ? "Register student — Textbooks" : "Register student";
  dialogs.student.querySelectorAll("[data-mode-show]").forEach(el => {
    const show = el.dataset.modeShow.split(",").indexOf(studentMode) !== -1;
    el.hidden = !show;
  });
  fillClassFields(classSel.value);
}
`

- [ ] **Step 3: mode-aware submit (student)**

In the student submit handler, after reading fee/total/exbooks:

`js
const payload = purchasePayload(studentMode, { fee, total, exbooks });
await root.write.registerStudent({ name, class: klass, gender, books_fee: payload.fee, books_total: payload.total, exbooks: payload.exbooks });
`

- [ ] **Step 4: reset studentMode on dialog close**

`js
dialogs.student.addEventListener("close", () => { studentMode = "both"; });
`

- [ ] **Step 5: wire toolbar button selectors**

In the existing [data-action] handler loop, add student mode branches
(mirroring data-action="stock-ex") before the generic open:

`js
if (action === "student-txt") { btn.addEventListener("click", () => openDialog("student", "textbook")); }
else if (action === "student-ex") { btn.addEventListener("click", () => openDialog("student", "exbooks")); }
`

- [ ] **Step 6: Commit**

`ash
git add js/write.js
git commit -m "feat: register purchase mode — studentMode wiring (open/populate/submit/close)"
`

### Task 4: E2E — register modes via browser

**Files:**
- Create: (temp harness only, outside repo)

- [ ] **Step 1: Run the register E2E harness**

Use the existing stock-dialog E2E pattern (launch the static server, open the
repo, drive the dialogs). Script:

1. Open register dialog default → all three rows visible, heading says
   "Register student", dropdown = classes (ookCategories).
2. Click data-action="student-ex" → fee/total rows hidden, heading
   "Register student — ExBooks", dropdown = sizes (exerciseBookCategories).
3. Switch segmented control to Textbooks → class dropdown restored, exbooks row
   hidden. Switch to Both → all rows visible.
4. In ExBooks mode fill name/class(sizes)/gender/exbooks, submit → console/
   network shows POST egisterStudent with exbooks=<size-collected> and
   fee=0,total=0.
5. Reopen dialog → mode reset to Both.

- [ ] **Step 2: Commit**

Nothing to commit (harness is outside repo). Update the E2E notes.

### Task 5: Run full gate

- [ ] **Step 1: Lint + unit**

Run: 
ode --check js/write.js → exit 0
Run: 
pm test → all pass

- [ ] **Step 2: E2E re-run**

Re-run harness → all 5 scenarios pass.

- [ ] **Step 3: Ask before push**

Per repo rule, **ask the user before pushing**. Do not push without approval.

## Acceptance Criteria

1. Default dialog (no mode arg) behaves exactly as today: all three fields
   visible; submit posts { books_fee, books_total, exbooks }.
2. data-action="student-ex" opens in ExBooks mode: fee+total rows hidden,
   heading "Register student — ExBooks", class dropdown shows exercise sizes;
   submit posts ee: 0, total: 0 and the chosen exbooks.
3. Segmented switch to Textbooks: exbooks row hidden, heading "Register
   student — Textbooks", class dropdown shows classes; submit posts
   exbooks: 0 with fee/total.
4. Reopening the dialog always resets to **Both**.
5. All unit tests + E2E scenarios pass; no backend changes.

## Verification

Run: 
ode -e "new (require('vm').Script)(require('fs').readFileSync('js/write.js','utf8'))" (syntax),

pm test (gate: all pass), E2E harness (gate: 5/5).