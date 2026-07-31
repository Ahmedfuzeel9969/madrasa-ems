# Pre-Refactor Backup Checklist (Phase 4)

**Automated:** `npm run backup:snapshot` · **Full protocol:** `docs/PHASE4-BACKUP-PROTOCOL.md`

**Required before photo migration and major production changes.**

## 1. Firestore export

```bash
# Replace BUCKET and DATE
gcloud firestore export gs://YOUR_BUCKET/backups/firestore-YYYYMMDD
# Or Firebase CLI (if configured):
firebase firestore:export ./backups/firestore-YYYYMMDD
```

## 2. Firebase Storage export

```bash
# gsutil mirror for tenant registration photos after first Storage uploads
gsutil -m cp -r gs://madrasa-mangment-app.firebasestorage.app/registrations ./backups/storage-registrations-YYYYMMDD
```

## 3. Security rules snapshot

```bash
cp firestore.rules ./backups/firestore.rules-YYYYMMDD
cp storage.rules ./backups/storage.rules-YYYYMMDD
cp firestore.indexes.json ./backups/firestore.indexes-YYYYMMDD
```

## 4. Deploy storage rules (one-time, before photo migration)

```bash
npm run build:hosting
firebase deploy --only storage
```

## 5. Staging validation order

1. Deploy hosting + storage rules to staging / test tenant
2. Create one new registration with photo — verify `photoUrl` in Firestore (no `photoBase64`)
3. Run **سسٹم سیٹنگز → تصویر مائیگریشن** scan
4. Run migration on staging tenant only
5. Verify list thumbnails + edit form + ID card
6. Run `npm test`

## 6. Production migration

1. Full Firestore + Storage backup (sections 1–3)
2. Deploy during low-traffic window
3. Run photo migration UI (batch size 5, auto-throttled)
4. Monitor Firestore read/write quotas
5. Keep backup for 30 days minimum

## 7. Rollback

- Hosting: redeploy previous `dist/` from backup tag
- Firestore: restore from export (Google Cloud Console → Import)
- Photos: Storage objects are additive; old `photoBase64` removed only after successful migration per doc

**No production data loss:** migration updates docs in place only after successful Storage upload.
