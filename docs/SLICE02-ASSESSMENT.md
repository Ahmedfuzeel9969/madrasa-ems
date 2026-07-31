# Slice #2 assessment — `ems-query-utils.js`

**Status:** Assessment complete → proceeding under Phase 2 approval (one utility only).  
**Date:** 2026-07-20

| Field | Detail |
|-------|--------|
| **File name** | `ems-query-utils.js` |
| **Current location** | Project root |
| **Proposed new location** | `src/shared/utils/ems-query-utils.js` |
| **Purpose** | Pure filter / search / sort / paginate helpers shared by browser repository and Electron native DB |
| **Dependencies** | **None** (no DOM, IndexedDB, Firebase, or network) |
| **Exported APIs** | `normalizeRegistrationStatus`, `isActiveRegistrationStatus`, `filterActiveRegistrations`, `matchFilter`, `matchSearch`, `applySort`, `pageFromAll`, `countFromAll`, `canStreamTopK` via `EmsQueryUtils` / `module.exports` |
| **Risk level** | **Low** |
| **Why safe** | File header states no storage/DOM; not in forbidden modules; early defer load only; Electron already lists this file — root wrapper + add `src/...` to `build.files` |

### Rejected alternatives (this phase)

| File | Why not |
|------|---------|
| `ems-data-pipeline-debug.js` | Calls `firebase.auth()`, tenant globals |
| `cache-policy.js` | Mutates `localStorage` / dirty flags (sync-adjacent) |

**index.html / auth / IDB / sync / modules:** not modified.
