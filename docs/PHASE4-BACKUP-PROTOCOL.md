# Madrasa EMS — Phase 4 Backup & Migration Safety Protocol

**Release:** `20260621-perf5`  
**Date:** June 2026  
**Status:** Phase 4 complete — automated local snapshots + manual cloud export workflow

---

## Purpose

Before and after Phase 2 performance deploys, protect production data with:

1. **Local config snapshots** (rules, indexes, hosting manifest)
2. **Cloud Firestore export** (operator-run)
3. **Firebase Storage mirror** (after Storage init)
4. **Tenant JSON backup** (in-app `EmsBackupService`)
5. **Verified rollback path**

---

## Automated tooling

### Local production snapshot

```bash
npm run backup:snapshot          # rules + manifest → backups/{timestamp}/
npm run backup:verify            # snapshot + npm test
npm run backup:production        # snapshot + workspace copy (parent folder)
npm run deploy:safe              # snapshot → preflight → hosting deploy
```

**Output:** `backups/{ISO-timestamp}/manifest.json` + copied rules files  
**Pointer:** `backups/LATEST.txt`

### What the script checks

| Check | Automated? |
|-------|------------|
| `firestore.rules`, `storage.rules`, indexes | ✅ Copied |
| `firebase.json`, `.firebaserc` | ✅ Copied |
| `dist/.hosting-manifest.json` | ✅ If built |
| Storage API initialized | ✅ Probe via `firebase deploy --only storage --dry-run` |
| `npm test` | ✅ With `--verify` |
| Firestore cloud export | ❌ Manual (`gcloud`) |
| Storage object mirror | ❌ Manual (`gsutil`) |

---

## Manual cloud backup (required before photo migration)

### 1. Firestore export

```bash
# Google Cloud (recommended)
gcloud firestore export gs://YOUR_BUCKET/backups/firestore-YYYYMMDD

# Or: Google Cloud Console → Firestore → Import/Export
```

### 2. Storage export (after Console → Storage → Get Started)

```bash
firebase deploy --only storage
gsutil -m cp -r gs://madrasa-mangment-app.firebasestorage.app/registrations ./backups/storage-YYYYMMDD
```

### 3. Tenant data (in-app)

**ایڈمن پینل → بیک اپ، بحالی و سنک** یا:

```javascript
// Browser console (logged in as admin)
EmsBackupService.downloadLocalBackup()
```

---

## Pre-migration validation order

1. `npm run backup:verify`
2. `npm run build:hosting && npm test`
3. Deploy hosting (already live: perf5)
4. Initialize Storage → `firebase deploy --only storage`
5. **سسٹم سیٹنگز → کارکردگی → DashboardStats ریفریش** (once)
6. **سسٹم سیٹنگز → تصویر مائیگریشن** — scan on staging tenant first
7. Run migration batches (size 5, throttled)
8. Verify thumbnails, ID card, edit form

---

## Rollback procedures

| Layer | Rollback |
|-------|----------|
| **Hosting** | Redeploy previous `dist/` from workspace backup or git tag |
| **Firestore data** | Import from `gcloud firestore export` backup |
| **Storage photos** | Objects are additive; `photoBase64` removed only after successful upload per doc |
| **DashboardStats** | Callable `refreshTenantDashboardStats` rebuilds summary |
| **Sys theme/config** | **سسٹم سیٹنگز → آخری Backup بحال کریں** |

**No data loss policy:** Photo migration updates Firestore only after successful Storage upload (`photo-migration.js`).

---

## Sys Settings — کارکردگی tab

Added Phase 4 actions:

- **مقامی JSON بیک اپ** — downloads tenant modules via `EmsBackupService`
- **مائیگریشن چیک لسٹ** — live status (Storage, DashboardStats, record counts)

---

## Sign-off

| Phase | Status |
|-------|--------|
| Phase 1 — Audit | ✅ |
| Phase 2 S1–S5 | ✅ Deployed |
| Phase 3 — Benchmarks | ✅ `docs/BENCHMARK-RESULTS.md` |
| **Phase 4 — Backup & Safety** | ✅ **This document** |
| Phase 5 — UI preservation | ✅ |
| Phase 6 — New features | ✅ Unblocked after cloud backup + Storage live |

**Operator action required:** Run **cloud Firestore export** before first photo migration on production.

---

*See also: `docs/PRE-REFACTOR-BACKUP-CHECKLIST.md`, `scripts/backup-production.js`*
