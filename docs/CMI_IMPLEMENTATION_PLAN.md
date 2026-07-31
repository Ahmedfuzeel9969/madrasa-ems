# CMI Implementation Plan

**Project:** Madrasa EMS — Super Admin AI Advisor Phase 1  
**Date:** 2026-07-09  
**Status:** Foundation implemented (local CMI + read-only advisor API)

---

## 1. Objective

Implement **Part A** of Phase 1: a permanent **Code Memory Index (CMI)** stored locally under `.cmi/`, built once and updated incrementally — **without** full AI advisor, Institution Advisor, or any automatic code changes.

---

## 2. What Was Implemented (Phase 1)

| Component | Path | Status |
|-----------|------|--------|
| Full index builder | `scripts/cmi-build.js` | ✅ |
| Incremental updater | `scripts/cmi-incremental.js` | ✅ |
| Status / local ask CLI | `scripts/cmi-status.js` | ✅ |
| Core library | `scripts/cmi/*` | ✅ |
| Read-only advisor API | `scripts/cmi/advisor-api.js` | ✅ (stub, no LLM) |
| Unit tests | `tests/unit/cmi-foundation.test.js` | ✅ 10 tests |
| npm scripts | `cmi:build`, `cmi:incremental`, `cmi:status`, `cmi:ask` | ✅ |
| Local storage | `.cmi/` (gitignored) | ✅ |

**First build result:** 548 files indexed; 30 ADRs; 16 roadmap snapshots; 26 historical bugs; auto weaknesses.

---

## 3. Architecture Overview

```
npm run cmi:build
       ↓
scripts/cmi/build-index.js
       ↓
walkIndexableFiles → per-file local analysis
       ↓
.cmi/files/*.json
       ↓
module/feature roll-up + dependency graph
       ↓
ingest-docs (ADR, roadmap, bugs, weaknesses)
       ↓
.cmi/meta/current.json
```

**Incremental:**
```
npm run cmi:incremental
       ↓
git diff since last meta.gitSha
       ↓
re-index changed paths only
       ↓
patch cmiVersion (1.1.0 → 1.1.1)
```

---

## 4. Memory Layers Implemented

| Layer | Storage | Builder |
|-------|---------|---------|
| File summaries | `.cmi/files/{fileId}.json` | `extractors.js` + `build-index.js` |
| Module summaries | `.cmi/modules/{moduleId}.json` | `module-registry.js` roll-up |
| Dependency map | `.cmi/dependencies/graph.json` | import/callable edges |
| Feature map | `.cmi/features/{featureId}.json` | `feature-registry.js` |
| Known weaknesses | `.cmi/weaknesses/*.json` | auto heuristics + security doc |
| Test history | `.cmi/tests/history/*.json` | optional vitest JSON ingest |
| Decision history | `.cmi/decisions/*.json` | docs parser (ADR) |
| Roadmap history | `.cmi/roadmap/snapshots/*.json` | roadmap doc parser |
| Historical bug memory | `.cmi/bugs/*.json` | fix/report doc parser |

---

## 5. Indexing Rules

### Included
- `*.js`, `*.html`, `*.css`, `*.json`, `*.md`, `*.rules`
- `functions/`, `cloud/`, `scripts/`, `docs/`, `tests/`, `sa/`

### Excluded
- `node_modules/`, `dist/`, `android/`, `backups/`, `.cmi/`, `.git/`

### Per-file record fields
- `contentHash` (SHA-256), `gitSha`, `indexedAt`
- `summaryShort`, `summaryDetailed` (local deterministic — **no LLM in Phase 1**)
- `exports`, `imports`, `flags`, `callables`, `linkedTests`
- `securityHints`, `todoCount`, `moduleId`, `featureIds`

---

## 6. Git SHA & Change Detection

| Field | Location | Purpose |
|-------|----------|---------|
| `gitSha` | `meta/current.json` | Last indexed commit |
| `indexedAt` | meta | Wall-clock timestamp |
| `lastIncrementalAt` | meta | Last partial update |
| `lastFullRefreshAt` | meta | Last full rebuild |
| `nextFullRefreshDue` | meta | 6 months default |

**Changed-file detection:** `git diff --name-only {lastSha} HEAD`  
**Fallback:** If git unavailable, SHA = `unknown`; incremental still works via contentHash on explicit paths.

---

## 7. Phase 1 vs Phase 2

| Capability | Phase 1 (now) | Phase 2 (future) |
|------------|---------------|------------------|
| Local CMI | ✅ | Firestore mirror optional |
| Local summaries | ✅ | + LLM enrich changed files |
| Retrieval + PSC | ✅ | Same |
| LLM answers | ❌ local stub only | `saAdvisorAsk` gateway |
| SA UI panel | ❌ CLI only | superadmin.js |
| Answer cache | ✅ local files | + Firestore cache |
| Audit log | ❌ | Platform_AiAuditLog |

---

## 8. Commands

```bash
npm run cmi:build              # Full index (first time / 6-month refresh)
npm run cmi:build -- --months=12
npm run cmi:incremental        # Changed files only
npm run cmi:status             # Memory status
npm run cmi:ask "registration security gaps"
```

---

## 9. Validation Checklist

- [x] Full scan completes without error
- [x] `.cmi/meta/current.json` written
- [x] File count > 50
- [x] Module roll-ups for registration, ai-assistant
- [x] Dependency graph populated
- [x] ADR/roadmap/bug ingestion
- [x] PSC ≤ 32 KB in retrieval tests
- [x] Read-only charter enforced in advisor API
- [x] 10 unit tests pass

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Local summaries less rich than LLM | Phase 2 batch enrich on changed files only |
| No git in some environments | contentHash diff; manual path list |
| `.cmi` lost on clean clone | Rebuild via `cmi:build` (~15s) |
| Index includes backup docs noise | Exclude `backups/`; tune ingest patterns |
| Large repo growth | Incremental + 6-month full refresh |

---

## 11. Estimated Effort (Remaining to Phase 2)

| Task | Effort |
|------|--------|
| Firestore CMI sync (optional) | 3 days |
| LLM enrich changed files (CI) | 4 days |
| `saAdvisorAsk` gateway | 5 days |
| SA UI panel | 5 days |
| Platform audit + Secret Manager | 3 days |
| **Phase 2 total** | **~20 dev-days** |

Phase 1 foundation: **~8 dev-days equivalent** (completed).

---

*See also: `CMI_DATABASE_DESIGN.md`, `SUPER_ADMIN_AI_PHASE1_ROADMAP.md`*
