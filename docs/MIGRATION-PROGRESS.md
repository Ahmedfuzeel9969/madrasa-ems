# Migration progress dashboard

**Permanent file — update after every approved slice; do not recreate.**  
**Last updated:** 2026-07-20 (after Slice #2)

---

## Mandatory rule — dependency scan before every future slice

Before selecting the next migration candidate, perform a **dependency scan** and report:

| Scan item | What to document |
|-----------|------------------|
| Direct imports | What the file loads / requires |
| Reverse dependencies | Which files use it |
| Global variable usage | Reads/writes of `window` / `globalThis` / app globals |
| Browser globals | `document`, `navigator`, `location`, etc. |
| DOM access | Query/create/mutate elements |
| IndexedDB usage | Any IDB open/read/write |
| Firebase usage | Auth / Firestore / Functions / Storage |
| localStorage / sessionStorage | Any web storage |
| Service worker interaction | SW register/update/cache |
| Electron interaction | Listed in Electron `build.files`, `require` from `desktop/` |
| Runtime initialization | Boot / auth / splash / loader involvement |

**Risk score (required):** Very Low · Low · Medium · High · Critical  

**Gate:** Only **Very Low** or **Low** may be migrated without additional approval.  
If **Medium** or above → **do not migrate**; recommend another candidate.

**Workflow:** Assessment (+ scan) → Approval → Migration → Verification → Report → **update this dashboard** → **Stop**

---

## Slice history

| Slice | File | Status | Regression | Build | Rollback |
|-------|------|--------|------------|-------|----------|
| #1 | `ems-utils.js` → `src/shared/utils/ems-utils.js` | **PASS** (verified) | PASS | PASS | YES |
| #2 | `ems-query-utils.js` → `src/shared/utils/ems-query-utils.js` | **PASS** (verified) | PASS | PASS | YES |

Reports: `docs/SLICE01-VERIFICATION-REPORT.md`, `docs/SLICE02-VERIFICATION-REPORT.md`, `docs/SLICE02-ASSESSMENT.md`

---

## Totals

| Metric | Value |
|--------|-------|
| Total utilities migrated | **2** |
| Compatibility wrappers at root | **2** |
| Canonical files under `src/shared/utils/` | **2** |
| Remaining root `*.js` files | **131** (includes Playwright/Vitest configs + wrappers) |
| Remaining root runtime client JS (excl. playwright/vitest configs) | **~119** |
| Remaining high-risk modules (not started) | Auth, boot, IndexedDB, sync/offline-write, Firebase path/pull, registration, attendance, finance/ledger, dashboard, mobile shell, `index.html`, `functions/lib` rename |
| Overall migration percentage (canonical under `src/` vs root runtime JS) | **~1.7%** (2 / ~119) |

---

## Next slice

**Not started.** Awaiting explicit approval.  
Before any candidate: complete the dependency scan above and assign risk ≤ Low.

---

## Stop

Do not automatically continue to the next slice.
