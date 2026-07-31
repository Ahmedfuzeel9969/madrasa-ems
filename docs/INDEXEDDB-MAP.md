# IndexedDB map — Madrasa EMS

> **Mandatory** map of offline persistence.  
> **Never rename** database names, object stores, indexes, or persistence keys without an approved data migration.  
> Audited: 2026-07-18.

---

## Critical invariant

| Item | Value | Rule |
|------|-------|------|
| Primary durable DB | `ems_durable_v1` | **Never rename** |
| Primary version | `4` (`DB_VERSION` in `ems-idb-engine.js`) | Schema changes only via additive upgrades |
| Tenant isolation | Keys / records carry `tenantId` / tenant-scoped collection keys | Do not break isolation |
| localStorage bridge keys | `ems_*`, `att_rec_*`, `ems_persisted_tenant_id_v1`, … | Do not rename casually |

---

## Database inventory

| Database name | Version | Defining file(s) | Role |
|---------------|---------|------------------|------|
| `ems_durable_v1` | 4 | `ems-idb-engine.js` | Primary durable store (KV + records + collections + search) |
| `ems_sync_cursors_v1` | 1 | `ems-sync-cursor-idb.js` | Per-key pull cursors (replaces fragile localStorage cursor fields) |
| `EMS_OfflineWriteDB` | 2 | `ems-offline-write.js` | Mutation outbox + dead letter |
| `EMS_SyncDB` | 1 | `sync-engine.js` **and** `cloud/sync-engine.js` | Legacy/cloud sync queue + module cache (**dual file surfaces**) |
| `EMS_DirectSyncDB` | 1 | `cloud/direct-firestore.js` | Direct Firestore mutation queue |
| `EMS_ComplaintsSyncDB` | 1 | `cloud/complaints-firestore.js` | Complaints offline queue |

Bench harnesses also open `ems_durable_v1` (`bench/*`) — test-only.

Electron may use **SQLite** via `desktop/native-db*.js` in parallel for desktop — separate from these IndexedDB names; do not conflate.

---

## 1. `ems_durable_v1` (heart of offline)

**File:** `ems-idb-engine.js`  
**Open:** `indexedDB.open('ems_durable_v1', 4)` via internal `openDb()`.

### Object stores

| Store | Const | Key path / keys | Indexes | Purpose |
|-------|-------|-----------------|---------|---------|
| `kv` | `KV_STORE` | Out-of-line keys (string) | (primary key only; prefix scans via `IDBKeyRange`) | Durable mirror of `ems_*` / large values |
| `records` | `REC_STORE` | `_pk` | `tenant` → `tenantId`; `tenant_type` → `[tenantId, type]`; `tenant_status` → `[tenantId, status]` | Record-level scale foundation |
| `collections` | `COL_STORE` | `_pk` | `col` → `_col`; `col_ts_desc` → `[_col, _tsNeg]`; `col_ts_asc` → `[_col, _ts]`; `col_type_ts_desc` → `[_col, type, _tsNeg]` | Repository/collection backend |
| `search_tokens` | `SEARCH_STORE` | `_pk` | `col_token` → `[_col, token]`; `col_row` → `[_col, rowId]` | Inverted search index |

### Migration versions

| From → To | Change |
|-----------|--------|
| (create) | `kv`, `records` (+ tenant indexes), `collections` (+ `col` index) |
| `< 3` → 3 | Add `col_ts_desc`, `col_ts_asc`, `col_type_ts_desc`; backfill `_ts` / `_tsNeg` / `type` |
| `< 4` → 4 | Create `search_tokens` + indexes |

Search index logical version: `SEARCH_INDEX_VERSION = 3` (`emsSearchIndexVersion()`).

### Public APIs (selected)

`emsIdbReady`, `emsIdbPersistRequest`, `emsIdbStorageEstimate`, `emsIdbKvSet/Get/Delete/Keys`, collection/record helpers, search index rebuild paths (see file).

### Relationships

```text
UI / modules
  → ems-repository / ems-registration-repository / ems-data-cache
  → emsIdbKv* / collections / records
  → ems_durable_v1

Search UI
  → search_tokens (same DB)
```

---

## 2. `ems_sync_cursors_v1`

**File:** `ems-sync-cursor-idb.js`  
**Version:** 1  
**Store:** `cursors` — `keyPath: 'key'`  
**Legacy:** Migrates from `localStorage` `ems_cache_meta` pullCursor fields (`LEGACY_META_KEY`, flag `ems_sync_cursor_idb_migrated_v1`).  
**Broadcast:** `BroadcastChannel('ems-sync-cursor-v1')` for cross-tab cache.

**Relationship:** Used by cloud pull to resume incremental sync without clobbering concurrent tabs.

---

## 3. `EMS_OfflineWriteDB` (sync queue / outbox)

**File:** `ems-offline-write.js`  
**Version:** 2  

| Store | Key | Purpose |
|-------|-----|---------|
| `queue` | `id` autoIncrement | Pending mutations (attendance `att_rec_*`, module blobs, …) |
| `dead_letter` | `id` autoIncrement | Failed / exhausted retries |

**Flags / related keys:** `ems_unified_outbox_migrated_v2`, `ems_att_keys_index`.  
**Flush:** Retries with backoff; pushes via cloud mutation helpers (`emsCloudEmitMutation` / Firestore).  
**UI:** `ems-sync-failure-ui.js` reads failure counts.

**Relationship:**

```text
Module save → offline write (local durable + queue)
  → online flush → Firebase
  → failures → dead_letter + sync failure UI
```

---

## 4. `EMS_SyncDB` (dual surface)

**Files:** `sync-engine.js` (root) and `cloud/sync-engine.js` (same DB name).  
**Version:** 1  

| Store | Key | Purpose |
|-------|-----|---------|
| `sync_queue` | `id` autoIncrement | Sync queue |
| `module_cache` | `key` | Module cache |

**Risk:** Two script files target the same DB name. Consolidate only after call-site mapping (`docs/DEPENDENCY-MAP.md`). **Do not rename DB.**

---

## 5. `EMS_DirectSyncDB`

**File:** `cloud/direct-firestore.js`  
**Version:** 1  
**Store:** `queue` (`id` autoIncrement)  
**Role:** Direct Firestore write queue when cloud stack loaded.

---

## 6. `EMS_ComplaintsSyncDB`

**File:** `cloud/complaints-firestore.js`  
**Version:** 1  
**Store:** complaints queue store (`QUEUE_STORE`, `keyPath: 'id'`)  
**Role:** Complaints offline → cloud.

---

## Backup / export stores

| Mechanism | Location | Notes |
|-----------|----------|-------|
| Workspace / DR scripts | `scripts/backup-*.js`, `backups/` | Filesystem snapshots — not IndexedDB |
| Cloud backup service | `cloud/backup-service.js` | Uses Firebase + local data APIs |
| Durable KV | `ems_durable_v1` / `kv` | Source of truth for many `ems_*` blobs |

There is **no separate IndexedDB named “backup”**; backups read from durable DB + cloud.

---

## Persistence keys (non-IDB, related)

| Key | Role |
|-----|------|
| `ems_persisted_tenant_id_v1` | Boot tenant restore (`localStorage`) |
| `ems_*` | General app keys (often mirrored to IDB `kv`) |
| `att_rec_*` | Attendance records (offline write + cache) |
| `ems_cache_meta` | Legacy cursor meta (migrated to cursor DB) |

**Do not rename** these without a migration plan.

---

## Forbidden actions

- Rename any database in this document  
- Drop/rebuild stores in production without versioned upgrade + backup  
- Change tenant field semantics on `records` indexes  
- “Clean up” dual `EMS_SyncDB` writers without tests  

See also: `docs/RUNTIME-BOOT-SEQUENCE.md`, `docs/ARCHITECTURE.md`.
