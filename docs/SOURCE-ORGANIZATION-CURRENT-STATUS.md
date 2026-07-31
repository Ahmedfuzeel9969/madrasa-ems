# Source organization — current status audit

**Audit date:** 2026-07-18  
**Project root audited:**  
`F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)`  

**Method:** Live filesystem inspection only. Not based on chat memory.  
**This audit performed:** documentation only.  
**Explicit confirmation:** **No new migration was performed during this audit.** No files were moved, renamed, deleted, or wrapped as part of this task.

---

## Executive summary

| Question | Finding |
|----------|---------|
| Are architecture docs present? | **Yes** — all ten required docs exist |
| Has any runtime source already been reorganized? | **Yes** — Migration Slice #1 (`ems-utils`) is already on disk |
| Does `src/` exist as a real tree? | **Yes** — only `src/shared/utils/ems-utils.js` |
| Is the project a Git repository? | **No** — no `.git` in project root, parent, or `F:\WPS` |
| Was Android work part of source organization? | **No** — verification gate only; Capacitor copied generated web assets |

**Current organization progress:** Documentation complete; **one** low-risk utility already piloted; professional `src/` layout is **not** broadly implemented.

---

## A. Documentation status

| File | Exists | ~Size | ~Lines | Creation / modification | Complete? | Reflects current source? | Missing / stale |
|------|--------|-------|--------|-------------------------|-----------|--------------------------|-----------------|
| `README.md` | Yes | 7.7 KB | 176 | Present; updated ~2026-07-18 00:39 | **Yes** (ops + links) | **Mostly** — mentions Slice #1 | Folder still nested StackBlitz name |
| `docs/ARCHITECTURE.md` | Yes | 14.2 KB | 200 | 2026-07-18 00:04 | **Yes** | **Partially stale** — banner still says “No source moves” | Should note `src/` + utils wrapper |
| `docs/FOLDER-MAP.md` | Yes | 15.7 KB | 207 | 2026-07-18 00:05 | **Yes** | **Partially stale** — audited as “docs only” | `src/` tree not fully described as live |
| `docs/MODULE-INVENTORY.md` | Yes | 13.0 KB | 248 | 2026-07-18 00:06 | **Yes** | **Mostly** | Banner “No source migration” outdated |
| `docs/DEPENDENCY-MAP.md` | Yes | 9.4 KB | 187 | 2026-07-18 00:06 | **Yes** | **Mostly** | Does not describe utils wrapper load path |
| `docs/SOURCE-MIGRATION-PLAN.md` | Yes | 12.5 KB | 235 | 2026-07-18 00:07 | **Yes** (plan) | **Partially stale** — said Slice A not started | Needs sync with executed Slice #1 |
| `docs/RUNTIME-BOOT-SEQUENCE.md` | Yes | 8.8 KB | 168 | 2026-07-18 00:26 | **Yes** | **Yes** (boot chain) | Minor: does not mention wrapper XHR for utils |
| `docs/INDEXEDDB-MAP.md` | Yes | 6.6 KB | 123 | 2026-07-18 00:26 | **Yes** | **Yes** | Optional: deeper attendance key inventory |
| `docs/FIREBASE-MAP.md` | Yes | 7.6 KB | 145 | 2026-07-18 00:26 | **Yes** | **Yes** | Full CF export list is summarized, not every export line |
| `docs/GLOBALS-MAP.md` | Yes | 4.9 KB | 90 | 2026-07-18 00:39 | **Yes** (curated + pointer) | **Yes** | Full list in companion raw file |

### Related docs (not in required ten)

| File | Exists | Notes |
|------|--------|-------|
| `docs/GLOBALS-INVENTORY-RAW.md` | Yes | ~128 KB / 2142 lines — auto-extracted globals |
| `docs/MIGRATION-SLICE-01.md` | Yes | Records Slice #1 as complete (automated gates) |
| `docs/SOURCE-ORGANIZATION-CURRENT-STATUS.md` | **This file** | Created by this audit |
| `docs/SOURCE-ORGANIZATION-EXECUTION-PLAN.md` | Created with this audit | Staged approval plan |

### Main sections (required docs)

| Doc | Main sections |
|-----|---------------|
| `README.md` | Purpose, platforms, modules, install, build/deploy/test, dirs, offline summary, status |
| `ARCHITECTURE.md` | Layers, startup, login, tenant, IDB, offline, sync, pull/push, Android/Electron, SW, build |
| `FOLDER-MAP.md` | Dir classification, `functions/lib`, root JS inventory, cloud map, duplicates |
| `MODULE-INVENTORY.md` | Per-module files/deps/stores/paths/tests + future `src/` tree |
| `DEPENDENCY-MAP.md` | Load order, globals, loaders, cycles, DOM/IDB/Firebase touchers |
| `SOURCE-MIGRATION-PLAN.md` | Safety rules, phases, risk matrix, folder rename, gates |
| `RUNTIME-BOOT-SEQUENCE.md` | Stages 0–10 with files/functions + sequence diagram |
| `INDEXEDDB-MAP.md` | All IDB DBs/stores/versions/relationships + forbidden renames |
| `FIREBASE-MAP.md` | Project, auth, collections, pull/push, Functions deploy |
| `GLOBALS-MAP.md` | Risk, critical globals, `JamiaApp` absence, raw inventory link |

---

## B. Runtime source changes already on disk

**Cannot claim “No runtime source file has been moved…”** — changes **already exist** from a prior approved Slice #1.

### Affected files table

| File | Previous location | Current location | Change type | Runtime impact |
|------|-------------------|------------------|-------------|----------------|
| `ems-utils.js` (implementation body) | Project root `ems-utils.js` | `src/shared/utils/ems-utils.js` | **Copied** then root **replaced by wrapper** | Canonical logic now under `src/`; still reaches runtime via wrapper |
| `ems-utils.js` (root) | Full UMD implementation | Root path kept | **Edited / replaced by compatibility wrapper** | Still loaded by `index.html`; sync-XHR loads canonical (browser) or `require` (Node) |
| `src/shared/utils/ems-utils.js` | Did not exist | `src/shared/utils/ems-utils.js` | **Added** (canonical copy) | Active when wrapper loads it |
| `scripts/prepare-hosting.js` | No `src/` copy step | Same path | **Edited** (build plumbing) | `dist/` includes `src/` so Hosting/Android/Electron can resolve canonical URL |
| `package.json` | No `build:production` | Same path | **Edited** (script alias only) | `build:production` → `build:hosting`; no app logic change |

### Explicitly not changed (spot-check)

- `index.html` still references:  
  `<script defer src="ems-utils.js?v=20260620p5"></script>`  
  (does **not** point directly at `src/…`)
- No evidence in this audit of moves for: `auth.js`, `ems-idb-engine.js`, sync/offline-write, registration, attendance, ledger, `ems-mobile-shell.js`, `functions/lib` rename, project folder rename.

### Hashes (filesystem)

| Path | Bytes | SHA256 (prefix) |
|------|-------|-----------------|
| `ems-utils.js` (wrapper) | 1942 | `0A979BB258E1C894…` |
| `src/shared/utils/ems-utils.js` | 4933 | `2C0C1AB524417FE6…` |

Canonical file has **no** `indexedDB` / `firebase` / app init calls (grep clean).

---

## C. Current `src/` status

| Question | Answer |
|----------|--------|
| Does `src/` exist? | **Yes** |
| Complete tree | `src/shared/utils/ems-utils.js` only |
| File role | **Active canonical runtime source** (not a placeholder) |
| Root relationship | Root `ems-utils.js` is a **compatibility wrapper**, not a duplicate full body |
| Used by `index.html`? | **Indirectly** — HTML loads root wrapper; wrapper loads `src/shared/utils/ems-utils.js` |
| Used by loaders? | Post-auth / lazy loaders do not list `ems-utils` separately; early defer list uses root path |
| Present in `dist/`? | **Yes** — `dist/src/shared/utils/ems-utils.js` and `dist/ems-utils.js` |
| Present in Android assets? | **Yes** — under `android/app/src/main/assets/public/` (Capacitor copy of `dist/`) |

```text
src/
  shared/
    utils/
      ems-utils.js    ← canonical implementation
```

Documentation examples of a full `src/app|core|modules|…` tree are **plans only** — **not** implemented except the single utils file above.

---

## D. Git evidence

### Commands requested

| Command | Result |
|---------|--------|
| `git status --short` | **Failed** — `fatal: not a git repository` |
| `git diff --stat` | **N/A** — no repo |
| `git diff --name-status` | **N/A** — no repo |

### Search for `.git`

| Path | `.git` present? |
|------|-----------------|
| Project root | **No** |
| `F:\WPS\stackblitz-starters-nbktzqft (4)` | **No** |
| `F:\WPS` | **No** |

### Therefore

| Item | Status |
|------|--------|
| Untracked / modified / deleted / renamed (Git) | **Cannot be listed** — no Git database |
| Last relevant commit | **None available** |
| Android-generated files polluting Git | **N/A** (no Git); Android/dist artifacts **do** exist on disk as generated output |

**Implication for Phase 0:** Baseline must include initializing Git (or documenting an external VCS) before further migration phases. **No commit was made during this audit.**

---

## E. Android work separation

### Why Android build was run previously

Per `docs/MIGRATION-SLICE-01.md` and prior Slice #1 gates: **`npm run android:build:debug` was a verification gate** after the utils wrapper + `src/` hosting copy — not a UI/feature task.

### Separation checklist

| Question | Answer |
|----------|--------|
| Only a verification build? | **Yes** (intent and recorded purpose) |
| Did it change organization source? | **No** — did not redesign modules; may refresh generated assets |
| Capacitor copied web assets into Android? | **Yes** — `android/app/src/main/assets/public/` contains `ems-utils.js` and `src/shared/utils/ems-utils.js` |
| Generated Android files changed? | **Yes** — assets public tree + debug APK under `android/app/build/outputs/apk/debug/` |
| Is any Android change “source organization progress”? | **No** — treat as **build artifact / verification side effect** only |

**Source-organization progress** = docs + the single `ems-utils` pilot under `src/`.  
**Not** source-organization progress = APK, Gradle outputs, Capacitor asset mirrors.

Debug APK present on disk: `android/app/build/outputs/apk/debug/app-debug.apk` = **True** (artifact only).

---

## F. What this audit did / did not do

| Done | Not done |
|------|----------|
| Filesystem + doc inventory | Move/rename/delete runtime source |
| Status + execution plan docs | New wrappers |
| Record Git absence | Project folder rename |
| Separate Android artifacts from source work | `functions/lib` rename |
| | Split `index.html` |
| | New APK / Firebase deploy |
| | Modify runtime behavior |

**Explicit confirmation:** **No new migration was performed during this audit.**

---

## G. Recommended next single phase

See `docs/SOURCE-ORGANIZATION-EXECUTION-PLAN.md`.

**Recommendation:** Approve and execute **Phase 0 — Baseline and safeguards** next (Git/backup/hashes), **not** another file move.

Slice #1 (`ems-utils`) is already on disk; further moves should wait until Phase 0 is complete and Phase 2 is formally **ratified** (or rolled back) under the approval gate model.
