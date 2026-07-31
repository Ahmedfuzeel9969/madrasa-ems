# Migration Slice #1 — `ems-utils.js`

**Status:** In progress → complete after gates  
**Date:** 2026-07-18  
**Scope:** Copy-only of pure utils + compatibility wrapper. No auth/boot/DB/sync/module moves.

## What changed

| Path | Role |
|------|------|
| `src/shared/utils/ems-utils.js` | **Canonical** implementation (copy of former root file) |
| `ems-utils.js` (root) | **Compatibility wrapper** — Node `require` re-export; browser sync-loads canonical |
| `scripts/prepare-hosting.js` | Now copies `src/` into `dist/` |
| `package.json` | Added `build:production` → `build:hosting` |

## Preserved globals

- `EmsUtils` (`sanitize`, `escAttr`, `saEmailDocKey`, `resolvePullConflict`, `simpleHash`, `stampCloudVersion`)
- `printDiv`

## Not changed

`index.html`, auth, boot, firebase, sync, database, registration, attendance, ledger, mobile shell.

## Gates

- [ ] `npm run verify:regression`
- [ ] `npm run build:production` (alias of `build:hosting`)
- [ ] `npm run android:build:debug`
- [ ] Manual: Web / Android / Electron — login, offline boot, registration, attendance, sync queue

## Rollback

Restore root `ems-utils.js` from git history of the pre-wrapper file (or copy body back from `src/shared/utils/ems-utils.js` as a full inline file) and optionally remove `src/` copy.
