# Madrasa EMS — Disaster Recovery Procedure (Priority 1)

**Status:** Active — mandatory before production migrations  
**Version:** 1.0 (2026-07-08)  
**Scripts:** `scripts/disaster-recovery-backup.js`, `scripts/disaster-recovery-restore.js`

---

## 1. What Is Backed Up

| Tier | Content | Automated? | Recovery method |
|------|---------|------------|-----------------|
| **1 — Config** | `firestore.rules`, `storage.rules`, indexes, `firebase.json` | ✅ Always | Redeploy from `backups/dr-*/config/` |
| **2 — Firestore cloud** | Full project export to GCS | ⚠️ When `gcloud` + `EMS_DR_GCS_BUCKET` set | `gcloud firestore import` |
| **3 — Storage** | Registration photos under `registrations/` | ⚠️ When `gsutil` + bucket accessible | `gsutil cp` restore |
| **4 — Tenant JSON** | Registrations, Rejected, Attendance, Complaints | ✅ With `--tenant=UID` + Admin SDK | Import script or in-app restore |
| **5 — Encrypted local** | AES-256-GCM `.emsbak` bundle | ✅ With passphrase | `disaster-recovery-restore.js` |

### What the OLD snapshot did NOT include (fixed by DR system)

- Student registration records  
- Fee / ledger / attendance business data  
- IndexedDB mirror contents  
- Firebase Storage photo objects  
- Full Firestore database export  

---

## 2. Pre-Flight Checklist (Run Weekly + Before Every Deploy)

```bash
# 1. Full disaster recovery backup (config always; tenant when credentials available)
set EMS_BACKUP_PASSPHRASE=your-strong-passphrase-min-8-chars
set EMS_DR_GCS_BUCKET=your-gcs-bucket-name
npm run backup:full -- --tenant=OWNER_FIREBASE_UID

# 2. Verify recovery simulation (no Firebase required)
npm run backup:verify-dr

# 3. Confirm manifest
type backups\LATEST-DR.txt
```

Expected `dr-manifest.json` checklist: all tiers marked `[OK]` for production sign-off.

---

## 3. Full Backup Commands

### Config-only (fast, no credentials)

```bash
npm run backup:snapshot
```

### Complete DR backup

```bash
# Windows PowerShell
$env:EMS_BACKUP_PASSPHRASE = "your-strong-passphrase"
$env:EMS_DR_GCS_BUCKET = "your-project-backups"
$env:EMS_DR_TENANT = "firebase-owner-uid"
npm run backup:full
```

```bash
# Linux / macOS
EMS_BACKUP_PASSPHRASE=your-pass EMS_DR_GCS_BUCKET=bucket EMS_DR_TENANT=uid npm run backup:full
```

Output directory: `backups/dr-{timestamp}/`

| File | Purpose |
|------|---------|
| `dr-manifest.json` | Master checklist + tier status |
| `config/manifest.json` | Rules snapshot |
| `tenant-export.json` | Plain tenant JSON (protect file permissions) |
| `tenant-encrypted.emsbak` | Encrypted offline copy |
| `storage-mirror/` | Storage objects (when gsutil succeeds) |

### Emulator tenant export (development)

```bash
firebase emulators:start --only firestore
set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
node scripts/seed-emulator-login.js
node scripts/tenant-firestore-export.js --tenant=emulator-tenant-1
```

---

## 4. Recovery Procedures

### Scenario A — Complete machine failure (operator PC lost)

1. Install EMS on new machine; authenticate to Firebase.
2. Locate latest `tenant-encrypted.emsbak` (offline USB / cloud drive).
3. Restore:

```bash
node scripts/disaster-recovery-restore.js ^
  --bundle=backups/dr-2026-07-08T12-00-00/tenant-encrypted.emsbak ^
  --passphrase=your-strong-passphrase
```

4. Verify output: `[VERIFY] PASS — recovery counts match original backup inventory`
5. Import restored JSON to Firestore (if cloud was also lost):

```bash
# Use restored tenant-export-restored.json with Admin import script
# OR in browser (logged in as owner):
#   EmsBackupService.restoreBackup(uid, backupId, { confirmed: true })
```

6. Restore photos from `storage-mirror/` or GCS backup tier.
7. Redeploy config: `npm run deploy:hosting` from restored workspace.

### Scenario B — Firestore data corruption / accidental delete

1. Stop all writes (disable staff accounts temporarily).
2. Import from latest GCS export:

```bash
gcloud firestore import gs://YOUR_BUCKET/ems-dr/firestore-YYYY-MM-DD
```

3. Validate record counts against `dr-manifest.json` → `tiers.tenantExport.inventory`.
4. Refresh DashboardStats from Admin Panel.

### Scenario C — Single tenant rollback (in-app)

1. Admin Panel → **بیک اپ، بحالی و سنک**
2. Select backup → **Validate** (checksum)
3. **Restore** — system creates `pre_restore` backup automatically
4. Confirm restored module counts in report

### Scenario D — Hosting-only rollback

```bash
npm run deploy:safe   # always creates snapshot first
# Rollback: redeploy previous dist from backups/dr-*/config/
```

---

## 5. Recovery Verification

### Automated tests (required before sign-off)

```bash
npm run backup:verify-dr
```

Tests verify:
- AES-256-GCM encrypt/decrypt roundtrip  
- Inventory count computation  
- **Simulated machine failure**: backup → wipe → restore → counts match  

### Manual verification after real restore

| Check | Expected |
|-------|----------|
| Registration count | Matches `dr-manifest.json` → `inventory.registrations` |
| Rejected count | Matches `inventory.rejected` |
| Attendance sheets | Matches `inventory.attendance_registers` |
| Fee collections visible | Dashboard loads without empty state |
| Photos render | Storage objects present |
| Admin login | Owner + staff can authenticate |

---

## 6. Passphrase & Security

- Minimum 8 characters; use a password manager.
- Store passphrase **separately** from `.emsbak` files.
- Encrypted bundle uses scrypt + AES-256-GCM (see `scripts/backup-lib.js`).
- Plain `tenant-export.json` is written only inside protected backup directory — restrict filesystem ACLs.

---

## 7. Operator Escalation

| Symptom | Action |
|---------|--------|
| `[VERIFY] FAIL` on restore | Do not deploy; use earlier backup; contact engineering |
| Tier 4 SKIP (no tenant) | Set `--tenant=` with owner UID; ensure `GOOGLE_APPLICATION_CREDENTIALS` |
| Tier 2 SKIP (no gcloud) | Install Google Cloud SDK; set `EMS_DR_GCS_BUCKET` |
| Empty dashboard after restore | Run `EmsBackupService.validateBackup`; check IDB hydrate |

---

## 8. Sign-Off Criteria (Priority 1 Complete)

- [ ] `npm run backup:verify-dr` — all tests pass  
- [ ] `npm run backup:verify-production` — offline scale PASS (engineering)  
- [ ] **Production operator run** — live tenant with GAC + gcloud (see §9)  
- [ ] At least one production DR backup with all 5 tiers `[OK]` in `dr-manifest.json`  
- [ ] Recovery simulation PASS logged in `docs/DR-PRODUCTION-VERIFICATION-REPORT.json`  
- [ ] Operator trained on Scenario A steps  
- [ ] GCS Firestore export scheduled (Tier 2) for production project  

---

## 9. Production Sign-Off Run (Operator — Required for Full Approval)

Engineering verification passed at **1,000-student scale** offline (`npm run backup:verify-production`).

To complete **live production sign-off**:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "path\to\service-account.json"
$env:EMS_BACKUP_PASSPHRASE = "your-strong-passphrase"
$env:EMS_DR_GCS_BUCKET = "your-gcs-backup-bucket"
$env:EMS_DR_TENANT = "OWNER_FIREBASE_UID"
node scripts/disaster-recovery-backup.js --tenant=$env:EMS_DR_TENANT --passphrase=$env:EMS_BACKUP_PASSPHRASE --strict
node scripts/tenant-firestore-import.js --file=backups\dr-XXX\tenant-export.json  # on staging project first
```

Verify `docs/DR-PRODUCTION-VERIFICATION-REPORT.json` shows `"verdict": "PASS"` and `"allTiersOk": true`.

**Emulator path** (requires Java): `firebase emulators:start --only firestore` then  
`node scripts/dr-production-verification.js --emulator --students=1000`

---

*See also: `docs/PHASE4-BACKUP-PROTOCOL.md`, `scripts/backup-production.js`*
