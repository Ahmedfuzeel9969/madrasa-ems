# CMI Database Design

**Project:** Madrasa EMS — Code Memory Index  
**Date:** 2026-07-09  
**Phase:** 1 — Local storage (`.cmi/`)

---

## 1. Design Goals

- Persistent structured memory across advisor sessions
- Incremental updates without full re-scan
- Queryable layers for retrieval (files, modules, features, weaknesses)
- Future-compatible with Firestore sync (Phase 2)
- No tenant/student data in CMI

---

## 2. Storage Topology (Phase 1 — Local)

```
.cmi/
├── meta/
│   └── current.json              # Index metadata pointer
├── files/
│   └── {fileId}.json             # One per indexable file
├── modules/
│   └── {moduleId}.json           # Rolled-up module records
├── features/
│   └── {featureId}.json          # Product feature map
├── dependencies/
│   └── graph.json                # Import/callable graph
├── weaknesses/
│   └── {weakId}.json             # Known issues
├── tests/
│   └── history/
│       └── {runId}.json          # Vitest/CI snapshots
├── decisions/
│   └── {decisionId}.json         # ADR records
├── roadmap/
│   └── snapshots/
│       └── {snapshotId}.json     # Roadmap doc snapshots
├── bugs/
│   └── {bugId}.json              # Historical bug memory
└── cache/
    └── answers/
        └── {sha256}.json         # Cached advisor stub responses
```

**fileId** = first 16 hex chars of SHA-256(normalized relative path)

---

## 3. Schema Definitions

### 3.1 `meta/current.json`

```json
{
  "schemaVersion": 1,
  "cmiVersion": "1.1.0",
  "gitSha": "abc123...",
  "gitBranch": "main",
  "buildMode": "full",
  "indexedAt": "ISO-8601",
  "lastIncrementalAt": "ISO-8601",
  "lastFullRefreshAt": "ISO-8601",
  "nextFullRefreshDue": "ISO-8601",
  "fullRefreshMonths": 6,
  "fileCount": 548,
  "filesScanned": 548,
  "filesUpdated": 548,
  "filesSkipped": 0,
  "ingested": {
    "decisions": 30,
    "roadmap": 16,
    "weaknesses": 13,
    "bugs": 26,
    "tests": 0
  }
}
```

### 3.2 `files/{fileId}.json`

```json
{
  "fileId": "a1b2c3d4e5f67890",
  "path": "admission.js",
  "gitSha": "abc123",
  "contentHash": "sha256-hex",
  "language": "js",
  "moduleId": "registration",
  "featureIds": ["registration-drafts"],
  "linkedTests": ["tests/unit/ems-registration-drafts-phasea.test.js"],
  "indexMethod": "local",
  "indexedAt": "ISO-8601",
  "status": "active",
  "summaryShort": "...",
  "summaryDetailed": "...",
  "lineCount": 4200,
  "imports": ["./registration-ui.js"],
  "exports": ["processRegistration"],
  "flags": ["EMS_REG_DRAFTS_ENABLED"],
  "callables": [],
  "securityHints": [],
  "todoCount": 0
}
```

### 3.3 `modules/{moduleId}.json`

```json
{
  "moduleId": "registration",
  "labelUr": "رجسٹریشن",
  "fileIds": ["..."],
  "fileCount": 24,
  "entryPoints": ["processRegistration", "emsRegSaveDraft"],
  "summary": "registration module with 24 indexed files.",
  "summaryDetailed": "path: summary\n...",
  "linkedTestCount": 8,
  "lastRollupAt": "ISO-8601"
}
```

### 3.4 `features/{featureId}.json`

```json
{
  "featureId": "registration-drafts",
  "label": "Phase A Draft Admission",
  "moduleIds": ["registration"],
  "fileIds": ["..."],
  "flagKeys": ["EMS_REG_DRAFTS_ENABLED"],
  "status": "active",
  "summary": "Phase A Draft Admission — 4 related files indexed.",
  "lastRollupAt": "ISO-8601"
}
```

### 3.5 `dependencies/graph.json`

```json
{
  "builtAt": "ISO-8601",
  "nodes": [{ "id": "fileId", "path": "...", "moduleId": "..." }],
  "edges": [{ "from": "admission.js", "to": "./registration-ui.js", "type": "imports" }]
}
```

### 3.6 `weaknesses/{weakId}.json`

```json
{
  "weakId": "weak-notest-abc123",
  "severity": "medium",
  "category": "testing",
  "title": "No linked unit test detected: finance.js",
  "fileIds": ["..."],
  "moduleIds": ["finance"],
  "status": "open",
  "source": "cmi-auto",
  "discoveredAt": "2026-07-09"
}
```

### 3.7 `decisions/{decisionId}.json`

```json
{
  "decisionId": "adr-abc123",
  "title": "Registration Phase A Architecture",
  "date": "2026-07-08",
  "status": "accepted",
  "context": "excerpt...",
  "docRefs": ["docs/REGISTRATION_PHASEA_ARCHITECTURE.md"],
  "source": "cmi-doc-ingest",
  "ingestedAt": "ISO-8601"
}
```

### 3.8 `roadmap/snapshots/{snapshotId}.json`

```json
{
  "snapshotId": "road-abc123",
  "docPath": "docs/REGISTRATION_PHASE2_IMPLEMENTATION_PLAN.md",
  "title": "...",
  "contentHash": "sha256",
  "lockedMentions": 4,
  "phases": ["Phase A", "Phase B"],
  "excerpt": "...",
  "capturedAt": "ISO-8601"
}
```

### 3.9 `bugs/{bugId}.json`

```json
{
  "bugId": "bug-abc123",
  "title": "Registration Legacy Fix Report",
  "docRefs": ["docs/REGISTRATION_LEGACY_FIX_REPORT.md"],
  "category": "general",
  "status": "resolved",
  "summary": "...",
  "lessons": "...",
  "contentHash": "sha256",
  "recordedAt": "ISO-8601"
}
```

### 3.10 `tests/history/{runId}.json`

```json
{
  "runId": "vitest-2026-07-09",
  "gitSha": "abc123",
  "suite": "vitest",
  "passed": 540,
  "failed": 0,
  "skipped": 6,
  "durationMs": 19830,
  "moduleBreakdown": {}
}
```

---

## 4. Phase 2 Firestore Mirror (Planned)

```
Platform_CodeMemory/
  meta/current
  files/{fileId}
  modules/{moduleId}
  features/{featureId}
  weaknesses/{weakId}
  ...
```

| Aspect | Local `.cmi/` | Firestore |
|--------|---------------|-----------|
| Primary Phase 1 | ✅ | ❌ |
| CI indexer write | ✅ | Phase 2 |
| SA runtime read | Local dev / CLI | Production SA console |
| Sync | Manual upload job | `cmi-sync-to-firestore.js` |

---

## 5. Indexing & Query Indexes

### Local retrieval (Phase 1)
- Linear scan with token scoring — acceptable for ~550 files
- Module/feature direct key lookup by ID

### Future Firestore indexes
- `files.path` ASC
- `files.moduleId` + `files.indexedAt`
- `weaknesses.status` + `weaknesses.severity`
- `bugs.status` + `bugs.category`

---

## 6. Versioning & Migration

| Event | Version bump | Example |
|-------|--------------|---------|
| Full rebuild | MINOR reset PATCH | 1.0.0 → 1.1.0 |
| Incremental | PATCH +1 | 1.1.0 → 1.1.1 |
| Schema change | MAJOR | 1.x → 2.0.0 |

**Migration:** Keep last 3 full snapshots in `.cmi/snapshots/` (Phase 2) for rollback.

---

## 7. Size Estimates

| Layer | Records (EMS) | Size |
|-------|---------------|------|
| files | ~550 | ~4 MB |
| modules | 12 | ~40 KB |
| features | 9 | ~20 KB |
| dependencies | 1 graph | ~800 KB |
| weaknesses | ~100 | ~80 KB |
| decisions | ~30 | ~60 KB |
| roadmap | ~16 | ~40 KB |
| bugs | ~26 | ~50 KB |
| **Total** | | **~5–6 MB** |

---

## 8. Data Integrity

- `contentHash` detects file changes without git
- `gitSha` in meta tracks commit baseline
- Soft-delete: `status: "deleted"` on removed files (Phase 2)
- Ingest docs keyed by contentHash — skip if unchanged

---

*See also: `AI_CODE_MEMORY_DESIGN.md` (prior audit), `CMI_IMPLEMENTATION_PLAN.md`*
