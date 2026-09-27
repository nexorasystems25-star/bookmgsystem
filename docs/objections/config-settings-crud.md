# Objections — Config Settings CRUD

Spec: `docs/superpowers/specs/2026-09-26-config-settings-crud-design.md`
Review mode: spec (inline fallback — advocatus-diaboli subagent unavailable; model
resolution error "Big Pickle/." twice, then orchestrator ran the six-category pass).
Status: **all dispositions written 2026-09-27** — gate cleared.

| # | Category | Tag | Objection | Disposition |
|---|----------|-----|-----------|-------------|
| O1 | Premise | BLOCKING | Editing "academic year" is not what the app means by `academic_year`: `filterYear` re-keys at app-time from the picker (`activeYear`), config is only the default. AC2 "repaint" vacuous; contract undefined. | **Default-year only.** Panel renamed "Default academic year"; config year changes the menu default only; manual picker selection preserved; new year becomes selectable-but-empty. Contract section added to spec. |
| O2 | Design | BLOCKING | Server-side `YYYY/YYYY` validator can't know the dataset's real year space; a format-valid but non-matching year silently becomes a default → empty menu. | **Split validation.** Server: shape only `^\d{4}\s*\/\s*\d{2,4}$`. Client: pre-validate membership against `availableYears()` before POST. |
| O3 | Completeness | NON-BLOCKING | `runConfig` writes `Config!A2:D2` blind; missing/mismatched tab writes at the wrong offset forever (Issued-tab lesson). | **Accepted — implemented.** Header guard (`academic_year, daily_payment_target, currency, last_synced`) failing `{ok:false}` before any write + README provisioning bullet. |
| O4 | Operability | NON-BLOCKING | Single-row last-writer-wins race between concurrent admins; CAS on `last_synced` fights sync's own writes. | **Accepted — documented** as a deliberate limitation in the spec non-goals. |
| O5 | Security | PASS | Admin-only `requireAuth(req,res,["admin"])` before `createClient`, mirroring `api/student.js:6`; 401/403/400/500 semantics and bearer client path consistent; no open write endpoint. | — |
| O6 | Operability | NON-BLOCKING | `sessionStorage`→`localStorage` swap silently flips a returning offline admin back online on first load. | **Accepted — implemented.** One-line migration: on init, write-through legacy `sessionStorage` value into `localStorage` if absent. |
| O7 | Completeness | NON-BLOCKING | `runAndRefresh`'s `finally` re-reads even on POST failure (`js/write.js:25-31`) — unstated contract, removable by a future editor. | **Accepted — implemented.** Spec sentence preserves the contract. |

Commit: (to be recorded when plan + spec are tracked).