# E10-S1 Sprint Report — Import Queue & Virtual Tables

**Date:** 22 June 2026 · **Cache bust:** `20260622e10s1`

## Changes

| Item | Detail |
|------|--------|
| **Import Queue** | `ems-import-queue.js` — 500-record chunks, states pending/processing/completed/failed/partial |
| **Import wiring** | `ems-import-export.js` — queue for >500 records; staging jobs >100 use queue |
| **Virtual tables** | complaints, ledger entries, exam marks grid, promotion list, curriculum plan list |
| **CF batch** | `bulkImportRegistrations` MAX_BATCH → 500 |

## Queue states

`pending` → `processing` → `completed` | `failed` | `partial`

Jobs stored in `localStorage` key `ems_import_queue_v1`.

## Verify

```bash
npm test
```

Hard refresh: **Ctrl+Shift+R**

Import test: 500+ row Excel → wizard → process; watch queue progress in import history.

## Virtual tables

Large lists render via `emsVirtualTableMount` — UI/design unchanged, scroll performance improved.
