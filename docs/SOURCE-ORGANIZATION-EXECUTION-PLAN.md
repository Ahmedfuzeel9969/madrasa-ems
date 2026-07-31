# Source organization — execution plan (approval-controlled)

**Companion:** `docs/SOURCE-ORGANIZATION-CURRENT-STATUS.md`  
**Updated:** 2026-07-18  
**Model:** Audit → Plan → **Approval** → One phase only → Tests → Build verify → Smoke → Completion report → **Stop**

Never begin the next phase automatically.

### Mandatory — dependency scan before every future slice

Before selecting a candidate, scan and score risk (Very Low → Critical).  
Only **Very Low** or **Low** may migrate without extra approval.  
Medium+ → do not migrate; pick another candidate.  
Details and permanent dashboard: `docs/MIGRATION-PROGRESS.md` (update after every slice; never recreate).

---

## Current position (from live audit)

| Phase | Status |
|-------|--------|
| Documentation maps (Phase 1 content) | **Done** on disk |
| Phase 2 utility pilot (`ems-utils`) | **Already executed** on disk (prior Slice #1) — needs **ratification or rollback**, not silent re-run |
| Phase 0 baseline (Git/backup/hashes) | **Not done** — **no Git repository** |
| Phase 3+ shared utils / modules | **Not started** |

---

## Approval gate (every phase)

```text
Approval for THIS phase only
  → execute phase
  → npm run verify:regression
  → npm run build:hosting (or build:production)
  → Android/Electron only if phase plan says so (verification, not feature work)
  → manual smoke (if runtime touched)
  → write phase completion report
  → STOP — request approval for next phase
```

### Forever forbidden unless a dedicated approved phase says otherwise

- Android UI / APK feature work  
- Auth / Firebase behavior / sync logic / IDB schema changes  
- Deploy Firebase  
- Rename project folder to `madrasa-ems`  
- Rename `functions/lib`  
- Split `index.html`  
- Mass file moves  
- Business workflow changes  

---

## Phase 0 — Baseline and safeguards

**Status:** **NEXT RECOMMENDED** (awaiting approval)  
**Objective:** Make further migration reversible and measurable. No source movement.

### Includes

| Item | Detail |
|------|--------|
| VCS | Initialize Git **or** document external VCS; achieve clean status or documented exceptions |
| Backup / branch / tag | `npm run backup:snapshot` (or full backup); create branch/tag `pre-src-org` if Git exists |
| Baseline hashes | Hash critical roots: `index.html`, `ems-utils.js`, `src/shared/utils/ems-utils.js`, `ems-idb-engine.js`, `auth.js`, `package.json`, `scripts/prepare-hosting.js` |
| Build verification | `npm run build:hosting` — confirm green without code moves |
| Regression | `npm run verify:regression` |
| Source vs generated | Document that `dist/`, `android/**/build`, `android/**/assets/public` are **generated**, not source-of-truth |

### Files affected

Documentation / tooling only (e.g. hash manifest under `docs/` or `backups/`). **No runtime JS moves.**

### Compatibility / risks / rollback

| | |
|--|--|
| Compatibility | N/A — no runtime path changes |
| Risks | Low; Git init may need `.gitignore` review so `node_modules`/`dist`/`android/build` stay excluded |
| Rollback | Delete new Git metadata only if explicitly requested; restore from backup |

### Required tests / deliverables / completion

- Tests: `verify:regression`, `build:hosting`  
- Deliverable: `docs/SOURCE-ORG-PHASE-0-REPORT.md` + hash list + Git status evidence  
- Completion: baseline recorded; generated dirs classified; **approval requested for next phase**

### Forbidden

Any move/rename of runtime source; APK feature work; Firebase deploy.

---

## Phase 1 — Missing architecture maps

**Status:** **Complete on disk** (content delivered). Optional **doc refresh** only if approved.

**Objective:** Ensure boot / IDB / Firebase / globals maps exist and match reality.

| Required doc | On disk? |
|--------------|----------|
| `RUNTIME-BOOT-SEQUENCE.md` | Yes |
| `INDEXEDDB-MAP.md` | Yes |
| `FIREBASE-MAP.md` | Yes |
| `GLOBALS-MAP.md` (+ raw inventory) | Yes |

### If a refresh is approved later

- Update banners that still say “no source moves”  
- Document root `ems-utils.js` wrapper → `src/shared/utils/ems-utils.js`  
- **Still no runtime movement**

### Forbidden

Runtime source edits.

---

## Phase 2 — First utility pilot

**Status on disk:** **Already executed** (see CURRENT-STATUS §B).  
**Plan rule:** Do **not** re-execute until separately approved. Prefer **ratify** or **rollback**.

### Original objective

Pilot one pure utility with copy + compatibility wrapper; ≤2–4 source files.

### Selected candidate: `ems-utils.js`

| Check | Result |
|-------|--------|
| App init? | **No** |
| Opens IndexedDB? | **No** |
| Calls Firebase? | **No** |
| Script-order fragile beyond early defer? | Loaded early; wrapper preserves root URL |
| Mutates critical globals? | Sets `EmsUtils` + optional `printDiv` only |
| Controls major module? | **No** |

### What already happened (do not redo blindly)

| Old path | New path | Compatibility |
|----------|----------|---------------|
| Root full `ems-utils.js` | `src/shared/utils/ems-utils.js` | Root wrapper + `prepare-hosting` copies `src/` |
| — | `package.json` `build:production` alias | Script only |

### Risks

Sync-XHR wrapper on some WebView edge cases; dual paths until HTML points at `src/` (not required yet).

### Rollback procedure

Replace root wrapper with full body from `src/shared/utils/ems-utils.js`; optionally remove `src/` file after confirmation.

### Required tests (when ratifying)

`verify:regression`, `build:hosting`; optional Android **verification** build only if approved for that gate.

### Completion criteria for ratification

Written note: “Phase 2 ratified” **or** “Phase 2 rolled back” in a phase report. Then **STOP**.

### Forbidden

Touching auth/boot/IDB/Firebase/sync/registration/attendance/finance/`index.html`.

---

## Phase 3 — Shared low-risk utilities

**Status:** Not started — **requires approval after Phase 0 (+ Phase 2 ratification)**  

**Objective:** Move only proven pure helpers (constants / formatters / validators / small helpers).

### Candidate pool (propose after purity audit; do not assume)

| Candidate | Old path | Proposed new path | Notes |
|-----------|----------|-------------------|-------|
| Query helpers (if pure) | `ems-query-utils.js` | `src/shared/utils/ems-query-utils.js` | Update Electron `package.json` `build.files` if moved |
| Debug pipeline | `ems-data-pipeline-debug.js` | `src/shared/utils/` | Lower product risk |
| Master data (if constants-only) | `ems-master-data.js` | `src/shared/constants/` | Verify no DOM side effects |
| Cache policy (if constants-only) | `cache-policy.js` | `src/shared/constants/` | Verify |

**Max files per approved sub-slice:** 2–4.

### Compatibility method

Same as Slice #1: **copy** → root **wrapper** → keep `index.html` URL → ensure `prepare-hosting` copies `src/` (already true).

### Risks

False “pure” files with boot side effects; Electron packaging misses.

### Rollback

Restore root full file from canonical copy; remove new `src/` entries.

### Tests

`verify:regression`, `build:hosting`; smoke only if loaders change.

### Forbidden

Auth, boot, database, sync, registration, attendance, finance, mobile shell, `index.html` split.

---

## Phase 4 onward — Module-by-module migration

**Status:** Not started. Order by **actual coupling** (see `DEPENDENCY-MAP.md` / `MODULE-INVENTORY.md`).

| Order | Module | Est. files | Dependency risk | Wrapper needed? | HTML templates? |
|-------|--------|------------|-----------------|-----------------|-----------------|
| 4a | Announcements | 1–3 | Medium | Yes (lazy path) | Likely in `index.html` |
| 4b | Training | 1–2 | Medium | Yes | Likely |
| 4c | Complaints (+ cloud helper later) | 2–4 | Medium–high | Yes | Likely |
| 4d | Curriculum | 1–3 | Medium–high | Yes | Likely |
| 4e | Exams | 1–3 | Medium–high | Yes | Likely |
| 4f | Printing helpers (`ems-idcard`, slips) | 2–4 | Medium | Yes | Print CSS/HTML |
| 4g | Settings builders (`sys-*`) | 5–8 | Medium–high | Yes | Heavy UI in HTML |
| 4h | Dashboard | 2–4 | High | Yes | Yes |
| 4i | Registration (+ import suite) | 15–25 | **Critical** | Yes | **Heavy** |
| 4j | Attendance | 3–6 | **Critical** | Yes | Yes |
| 4k | Finance + ledger | 3–6 | **Critical** | Yes | Yes |
| 4l | Auth + boot loaders | 10–20 | **Critical** | Yes | Landing/login in HTML |
| 4m | IDB / sync / Firebase path modules | 10–20 | **Critical** | Yes | No split of DB names |
| 4n | `index.html` template extraction | Many | **Critical** | Compatibility loader | **Yes — last** |

Each row = **separate approval**.

### Per-module phase template (required fields)

Every approved module phase must restate: objective, files, old/new paths, compatibility method, risks, rollback, tests, deliverables, completion criteria, forbidden areas.

---

## Optional parallel tracks (separate approvals — not “next” by default)

| Track | When | Notes |
|-------|------|-------|
| Folder rename → `madrasa-ems` | After builds green + no hardcoded absolute source paths | Copy-validate; not part of `src/` moves |
| `functions/lib` clarify/rename | After full `require` + deploy map | Handwritten source today |
| Android verification build | Only as gate after a runtime-touching phase | Not source-org progress |

---

## Recommendation — next single phase

**Approve Phase 0 — Baseline and safeguards** next.

Rationale:

1. There is **no Git repo** — migrations are currently hard to reverse via VCS.  
2. Architecture maps (Phase 1) already exist.  
3. Phase 2 (`ems-utils`) is **already on disk**; ratify it as part of Phase 0 report or a tiny Phase 2-ratify step **after** Phase 0.  
4. Do **not** start Phase 3 file moves until Phase 0 is done.

---

## Explicit confirmation (this document delivery)

Creating/updating these plan/status **docs** does not move runtime source.  
**No new migration was performed while writing this plan.**  
**Stop here — wait for approval before Phase 0 execution.**
