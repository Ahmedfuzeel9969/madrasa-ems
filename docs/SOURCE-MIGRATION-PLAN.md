# Source migration plan — Madrasa EMS

> **Plan only.** Do not execute file moves, renames, or `index.html` splits until each phase is explicitly approved.  
> Companion docs: `ARCHITECTURE.md`, `FOLDER-MAP.md`, `MODULE-INVENTORY.md`, `DEPENDENCY-MAP.md`, root `README.md`.  
> Prepared: 2026-07-17.

---

## Critical safety rule (always)

This is a **running production system** with real institutional data.

**Never (without a dedicated approved data plan):**

- Rewrite the project in one pass  
- Move all files at once  
- Rename imports blindly  
- Delete legacy files before proven redundant  
- Change runtime behavior “while cleaning”  
- Modify Firebase paths  
- Change IndexedDB names or schemas (`ems_durable_v1`)  
- Change synchronization logic or outbox semantics  
- Change business workflows  
- Break Android, Web, Electron, or Hosting builds  

The working system must remain functional throughout.

---

## Confirmation — current task status

| Deliverable | Status |
|-------------|--------|
| `README.md` | Created (documentation) |
| `docs/ARCHITECTURE.md` | Created |
| `docs/FOLDER-MAP.md` | Created |
| `docs/MODULE-INVENTORY.md` | Created |
| `docs/DEPENDENCY-MAP.md` | Created |
| `docs/SOURCE-MIGRATION-PLAN.md` | This file |
| Runtime / source migration | **Not started** |
| Project folder rename to `madrasa-ems` | **Not started** |
| `functions/lib` rename | **Not started** |
| `index.html` split | **Not started** |

**Explicit confirmation: no runtime application source was changed as part of this documentation phase.** Only new/updated documentation files under the project root and `docs/` were added for this effort.

---

## Target structure (evidence-adjusted)

```text
src/
  app/boot|shell|navigation|auth/
  core/database|sync|security|backup|firebase/
  modules/registration|attendance|exams|finance|complaints|curriculum|…
  shared/ui|utils|constants|validation/
  platform/web|android|electron/
```

Native trees **`android/`**, **`desktop/`**, and **`functions/`** remain top-level.  
Hosting artifact remains **`dist/`** (generated).

See `MODULE-INVENTORY.md` §18 for the full proposed tree.

---

## Phase 0 — Documentation (THIS PHASE)

**Scope:** Write architecture + maps + this plan.  
**Files affected:** documentation only (~6 files).  
**Exit criteria:** Stakeholder review and approval before Phase 1 code.

---

## Phase 1 — First safe migration slice (after approval)

### Preferred candidates (low risk)

| Candidate | Why |
|-----------|-----|
| `ems-utils.js` | Small (~5 KB), shared helpers, early load but likely low side effects |
| Pure helpers extracted from larger files later | Only after identifying pure functions |
| `ems-query-utils.js` | Second candidate — **must** update Electron `package.json` `build.files` |
| `ems-data-pipeline-debug.js` | Debug-only |
| Pure validation helpers (if isolated) | After extraction without behavior change |
| Shared UI helpers with **no** global side effects on load | e.g. subsets of `ems-ui-kit.js` only if proven inert at import |

### Explicitly NOT first slice

Authentication, database, sync, `index.html`, registration, attendance, ledger/finance, mobile boot.

### Procedure for each moved file

1. `npm run backup:snapshot` (or fuller backup)  
2. **Copy** to new `src/…` path  
3. Leave **compatibility wrapper** at old path that loads/re-exports behavior (script-tag compatible)  
4. Update `index.html` / dynamic loader lists only if switching primary URL  
5. Run gates (below)  
6. Compare behavior on Web + Android smoke  
7. Remove old file **only after** proven safe and approved  

### Proposed first slice (concrete)

**Slice A (recommended):**

1. Create `src/shared/utils/ems-utils.js` (copy)  
2. Keep root `ems-utils.js` as thin loader: either duplicate content temporarily or `document.write`/`script` inject — prefer **identical copy + root re-export script** that defines the same globals from the new file via one extra script, OR keep root file as the sole loader that fetches the new path  
3. Update `index.html` defer `src` to new path **or** keep root path pointing at wrapper (safer first)  
4. Run full gate  

**Estimated files touched:** 2–4 (new file + wrapper + possibly `index.html` + prepare-hosting already copies tree once `src/` exists — confirm `prepare-hosting.js` copies nested dirs; it walks root except excluded dirs, so `src/` would be included automatically unless excluded).

**Action before Slice A:** Confirm `scripts/prepare-hosting.js` `EXCLUDE_DIR` does **not** need to exclude `src/` (it should copy `src/` into `dist/`). Do **not** add `src` to exclude list.

---

## Required testing gate (every slice)

**Minimum:**

```bash
npm run verify:regression
```

**Also run where applicable:**

| Gate | Command / check |
|------|-----------------|
| Web production build | `npm run build:hosting` |
| Hosting verify | `npm run verify:hosting` |
| Android asset sync | `npm run android:sync` |
| Android APK | `npm run android:build:debug` (or release when appropriate) |
| Electron | `npm run desktop:build` or at least `desktop:dev:local` smoke |
| Offline boot | Manual / device: reopen app offline |
| Local persistence | Save → kill → reopen |
| Login | Web + native Google path |
| Sync queue | Create offline mutation → online flush |
| Cloud Pull/Push | Spot-check registration/attendance after sync |

**No slice is accepted with a failing regression test.**

---

## Phase 2 — Project folder normalization (plan only)

### Current

```text
F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)
```

### Proposed

```text
F:\WPS\madrasa-ems
```

(or `F:\WPS\stackblitz-starters-nbktzqft (4)\madrasa-ems` if keeping outer folder)

### Do not rename the live folder until approved.

### Checklist before relocate

| Area | Action |
|------|--------|
| Backup | Full workspace + DR snapshot; verify restore notes |
| Git | Ensure clean status or committed docs; update remotes only if needed; avoid rewriting history |
| Firebase | `.firebaserc`, `firebase.json` are relative — usually OK; re-login/CI paths if absolute |
| Capacitor / Android | `webDir: dist` relative; regenerate assets via `android:sync`; ignore absolute paths inside `android/**/build` intermediates |
| Electron | Relative `desktop/`; rebuild |
| Scripts | Prefer relative `__dirname`; grep for hardcoded `F:\WPS\stackblitz…` in **source** scripts (manifests regenerate) |
| IDE / Cursor | Re-open folder; update multi-root workspaces if any |
| Build scripts | Re-run `build:hosting`, `verify:hosting`, `android:sync`, desktop smoke |
| Validation after | `npm test`, `verify:regression`, login smoke, offline reopen |

### Copy vs move

1. **Copy** entire tree to `madrasa-ems`  
2. Validate from the copy  
3. Only then retire old path (keep old as cold backup for one release cycle)

---

## Phase 3 — Clarify `functions/lib` (plan only)

| Finding | `functions/lib` is **hand-written source**, not compiled output |
| Proposed options | (A) Rename to `functions/src` and update all `require('./lib/…')` → `./src/…`; (B) Keep `lib/` name, document as source; (C) Introduce compile later → then `src/` + `lib/` or `dist/` |
| Blockers before rename | Map every `require`, Firebase deploy, `functions/test`, CI |
| Estimate | ~50+ modules + `index.js` + tests · **1 approved PR** |

---

## Phase 4+ — Gradual module migration (one module per approval)

Suggested order:

| Step | Scope | Est. files | Risk |
|------|-------|------------|------|
| 4a | Pure shared utils (`ems-utils`, maybe query-utils) | 2–5 | Low |
| 4b | Printing / theme helpers (idcard/slip CSS extract only if inert) | 2–8 | Low–med |
| 4c | Small isolated modules (e.g. announcements) | 1–3 | Med |
| 4d | Registration (+ import suite) | 15–25 | **High** |
| 4e | Attendance | 3–6 | **High** |
| 4f | Exams / curriculum / training | 3–8 | Med–high |
| 4g | Finance + ledger | 3–6 | **Critical** |
| 4h | Auth + boot loaders | 10–20 | **Critical** |
| 4i | Split `index.html` last | templates → many files | **Critical** |

Each step: separate approval + report + full gate.

---

## `index.html` reduction plan (do not split yet)

### Classification of current ~6,283 lines

| Class | Contents (to be tagged in a future audit pass) |
|-------|--------------------------------------------------|
| Static shell | App chrome, ribbon, mobile placeholders |
| Landing / login UI | Pre-auth screens |
| Module templates | Registration, attendance, ledger, … panels |
| Modal windows | Shared dialogs |
| Inline styles | Large CSS blocks |
| Inline scripts | Any remaining non-defer logic |
| Generated fragments | Rare; prefer not to hand-edit generated bits |

### Safe extraction approach (future)

1. Inventory sections with HTML comments markers (add markers without moving)  
2. Extract **one** inert template file under `src/app/templates/` or `src/modules/*/templates/`  
3. Load via existing method or thin compatibility loader that injects HTML into the same DOM IDs  
4. **Never** remove markup from `index.html` until the loader is proven (blank-page ban)  
5. Split styles only after templates stable  

Target dirs:

```text
src/app/templates/
src/modules/*/templates/
src/shared/modals/
```

---

## Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Broken script path after move | High | High (blank app) | Compatibility wrappers; keep old URL working |
| Missed dynamic loader entry | High | High | Update `ems-post-auth-loader.js` + `ems-lazy-loader.js` + cloud loader |
| Electron package miss | Medium | Medium | Update `package.json` `build.files` |
| Hosting omit `src/` | Low | High | Ensure prepare-hosting copies `src/`; verify manifest |
| Accidental IDB/Firebase rename | Low if careful | **Critical** | Hard ban in review checklist |
| Sync/outbox behavior drift | Medium if moving sync early | **Critical** | Defer sync moves to late phases |
| Android white screen regression | Medium | High | Boot files last; device smoke each slice |
| Dual `sync-engine` confusion | Medium | High | Call-site map before consolidate |
| Folder relocate breaks CI paths | Medium | Medium | Prefer copy-validate; relative paths |
| Premature delete of “unused” | Medium | High | Quarantine; mark unknown; delete only after usage proof |

---

## Estimated files affected per phase

| Phase | Description | Est. files touched |
|-------|-------------|--------------------|
| 0 | Documentation | 6 docs (+ README) |
| Folder relocate | Copy/rename workspace | Path-wide; 0 logic files if copy |
| Functions clarify | Rename `lib`→`src` (optional) | ~50–70 |
| Slice A utils | First safe move | **2–4** |
| Shared UI helpers | Next low-risk | **3–10** |
| Per small module | e.g. announcements | **1–5** |
| Registration | Full module | **15–25** |
| Attendance | Full module | **3–6** |
| Finance/ledger | Full module | **3–6** |
| Auth/boot | Boot chain | **10–20** |
| `index.html` split | Templates over multiple PRs | **20–80+** eventual |
| Entire `src/` migration | All client JS | **~120+** root JS + cloud/sa |

---

## Approval gates (summary)

```text
Phase 0 docs ──approve──► Slice A (utils)
                              │
                              ├──approve──► more shared
                              │
                              ├──approve──► folder rename (optional parallel track)
                              │
                              ├──approve──► functions/lib clarify (optional parallel)
                              │
                              └──approve──► one module at a time ──► index.html last
```

---

## What “done” looks like long-term

- Clear `src/` layout with thin root compatibility or updated single loader manifests  
- `index.html` reduced to shell + loader  
- `functions` naming matches reality (source vs output)  
- Project directory named `madrasa-ems`  
- **Zero** intentional behavior change; data paths and IDB unchanged  
- All platforms green on the testing gate  

---

## Immediate ask

Please review:

1. `README.md`  
2. `docs/ARCHITECTURE.md`  
3. `docs/FOLDER-MAP.md`  
4. `docs/MODULE-INVENTORY.md`  
5. `docs/DEPENDENCY-MAP.md`  
6. This plan (risk matrix + Slice A)

**Reply with approval (or requested edits) before any source file is moved.**
