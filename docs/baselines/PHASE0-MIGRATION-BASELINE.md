# Phase 0 — Official migration baseline

**Baseline ID:** `PHASE0-2026-07-18`  
**Recorded:** 2026-07-18 (local) / hashes stamped `2026-07-17T20:27:06.705Z` UTC  
**Project root:** `F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)`  

**Freeze rule:** No further source-file migration until this baseline is accepted and the next phase is explicitly approved.

---

## 1. Complete project backup

| Field | Value |
|-------|-------|
| Command | `npm run backup` → `scripts/backup-workspace.js` |
| Destination | `F:\WPS\stackblitz-starters-nbktzqft (4)\ems-backup-2026-07-17T20-26-59` |
| Result | **Done** (`[backup] Done`) |
| Excludes (by script) | `node_modules`, `dist`, `.firebase`, `.git` |
| Includes | Source tree including `android/` project sources, `src/`, docs, functions source, etc. |

This backup is the **primary rollback snapshot** until Git exists.

---

## 2. Runtime source hashes

| Artifact | Path |
|----------|------|
| Full inventory (506 files) | `docs/baselines/PHASE0-RUNTIME-HASHES-latest.json` |
| Timestamped copy | `docs/baselines/PHASE0-RUNTIME-HASHES-2026-07-17T20-27-06-705Z.json` |
| Generator | `scripts/phase0-baseline-hashes.js` |

| Metric | Value |
|--------|-------|
| File count | **506** |
| Total bytes hashed | **69,218,866** (~66 MB) |
| Algorithm | SHA-256 |

### Excluded from hash inventory (generated / heavy)

- `node_modules/`, `functions/node_modules/`
- `dist/`
- `android/` (entire tree — Capacitor/Gradle generated + synced assets)
- `backups/`, `.firebase/`, `.cmi/`
- `desktop/release/`
- `test-results/`, Playwright reports

### Critical file hashes (subset)

| File | SHA-256 |
|------|---------|
| `ems-utils.js` (wrapper) | `0A979BB258E1C8949F5336F54F0D657F9FFDDFEF0C90F0BD0DEDD462BE973A08` |
| `src/shared/utils/ems-utils.js` | `2C0C1AB524417FE62581222DD414E60D443FA1EA1F85AFDAF47A01A7284999B7` |
| `index.html` | `ECE19207BEBB6917D528C8DE7A8129055D66A26ACC147BEFF980A7AED1809D51` |
| `scripts/prepare-hosting.js` | `634E9804136D5779D74197BA81686917F8B3D1051EE97F298502763192297E38` |
| `package.json` | `9E75AA46DEB57AF5910C9C8F85EF71D8C726C09984BBA7F6BAC6A57A0E0CBD97` |

Re-generate later: `node scripts/phase0-baseline-hashes.js`

---

## 3. Build status

| Check | Result | Detail |
|-------|--------|--------|
| `npm run build:hosting` | **PASS** | 198 files, 5.44 MB; `src/` copied |
| `dist/.hosting-manifest.json` `builtAt` | `2026-07-17T20:27:18.903Z` | Post-baseline rebuild |
| Cache bust validation | **OK** | `20260712_saas_lockdown_masterpiece` |

---

## 4. Regression status

| Check | Result |
|-------|--------|
| `npm run verify:regression` | **PASS** |
| Tests | 25 passed (3 files) |
| Also | `node --check ems-mobile-shell.js` OK |

---

## 5. Android verification status

**No new APK was built during this freeze.** Status of the **prior Slice #1 verification APK**:

| Field | Value |
|-------|-------|
| Exists | **Yes** |
| Path | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Size | 7,740,666 bytes |
| mtime | 2026-07-18 00:37:52 (local) |
| SHA-256 | `DF228C140A1CBAC419C50046004702638FE2CDB15B6CEB0735D51DB9C676AF8B` |
| Role | Verification artifact only — **not** source-organization progress |

Capacitor public assets under `android/app/src/main/assets/public/` are **generated** mirrors of `dist/` and remain outside the hash baseline inventory.

---

## 6. Slice #1 freeze state

| Item | Status |
|------|--------|
| Verification report | `docs/SLICE01-VERIFICATION-REPORT.md` → **PASS** |
| Further utility moves | **Frozen** |
| Git | **Not initialized** (see `docs/GIT-INTRODUCTION-PROPOSAL.md`) |

---

## 7. How to use this baseline

1. Before any new migration slice: re-run hashes and diff against `PHASE0-RUNTIME-HASHES-latest.json`.  
2. On failure: restore from `ems-backup-2026-07-17T20-26-59` (or later approved backups).  
3. After Git exists: tag `baseline/phase0-2026-07-18` pointing at this state.

---

## 8. Explicit confirmation

- Complete backup created.  
- Runtime hashes recorded.  
- Build + regression recorded.  
- Android verification status recorded (existing APK; no new build this freeze).  
- **No additional files migrated** during Phase 0 baseline work beyond documentation/tooling scripts for verification and hashing.
