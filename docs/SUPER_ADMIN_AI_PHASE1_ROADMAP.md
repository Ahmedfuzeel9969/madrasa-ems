# Super Admin AI — Phase 1 Roadmap

**Project:** Madrasa EMS  
**Date:** 2026-07-09  
**Scope:** Code Memory Foundation + Read-Only Software Advisor APIs  
**Out of scope:** Institution Advisor, LLM gateway, SA UI, auto code changes

---

## 1. Phase 1 Summary

| Part | Deliverable | Status |
|------|-------------|--------|
| **A — CMI** | Local `.cmi/` index, full + incremental | ✅ Done |
| **B — Software Advisor** | Internal APIs, PSC, local stub | ✅ Done |
| **C — Cost control** | Zero LLM, PSC cap, cache, 6mo refresh | ✅ Done |
| **D — Security** | Read-only charter, separation design | ✅ Done |
| **E — Reports** | 7 planning documents | ✅ Done |

---

## 2. Implementation Timeline

| Week | Milestone | Output |
|------|-----------|--------|
| W1 | CMI schema + local storage | `scripts/cmi/storage.js` |
| W1 | File walker + extractors | `extractors.js`, `build-index.js` |
| W2 | Module/feature registry + graph | roll-ups, `graph.json` |
| W2 | Doc ingest (ADR, roadmap, bugs) | `ingest-docs.js` |
| W2 | Retrieval + PSC 32KB | `retrieve.js` |
| W3 | Advisor read-only API | `advisor-api.js` |
| W3 | CLI + npm scripts + tests | 10 unit tests pass |
| W3 | Documentation pack | 7 reports |

**Estimated Phase 1 effort:** **~8–10 dev-days** (foundation complete)

---

## 3. Estimated Monthly Cost

| Phase | Cost |
|-------|------|
| **Phase 1 (now)** | **$0** — no LLM, local disk only |
| Phase 2 (+ LLM gateway) | $8 – $18 moderate use |
| Phase 3 (+ Institution OMP) | +$2 – $5 |

See `AI_COST_ESTIMATION_REPORT.md`.

---

## 4. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Local summaries too shallow | Medium | Medium | Phase 2 LLM enrich changed files only |
| `.cmi` lost on clean machine | High | Low | `npm run cmi:build` in 15s |
| Git unavailable | Medium | Low | SHA `unknown`; contentHash still works |
| Index noise from docs/ | Low | Low | Tune ingest patterns |
| Phase 1 stub confuses users | Medium | Low | Label "local stub — Phase 2 LLM" |
| Accidental scope creep to Institution AI | Medium | High | Explicit out-of-scope gate |

---

## 5. Rollout Strategy

### Stage 1 — Developer validation (now)
1. Run `npm run cmi:build`
2. Run `npm run cmi:status`
3. Run `npm run cmi:ask "registration security"`
4. Run `npx vitest run tests/unit/cmi-foundation.test.js`
5. Review `.cmi/meta/current.json`

### Stage 2 — CI integration (Phase 1.5)
1. Add CI step: `npm run cmi:incremental` on merge to main
2. Optional: upload `.cmi/meta/current.json` as artifact
3. Fail CI if CMI build breaks (test job)

### Stage 3 — Phase 2 gateway (future)
1. Deploy `saAdvisorAsk` to staging
2. SA-only smoke tests
3. Enable SA console panel
4. Production with rate limits

**No production EMS user impact** — Phase 1 is dev/SA tooling only.

---

## 6. Rollback Strategy

| Scenario | Rollback action |
|----------|-----------------|
| Bad CMI build | Delete `.cmi/` → `npm run cmi:build` |
| Corrupt meta | Restore from CI artifact or full rebuild |
| Incremental error | Delete `.cmi/`, full rebuild |
| Advisor API regression | Revert `scripts/cmi/*` via git |
| Phase 2 gateway issues | Disable `saAdvisorAsk`; CLI still works on local CMI |
| Cost overrun (Phase 2) | Hard stop flag; use local stub only |

**CMI is disposable** — always regenerable from source + docs.

---

## 7. Test Strategy

### Unit tests (implemented)
`tests/unit/cmi-foundation.test.js` — **10 tests**

| Test | Validates |
|------|-----------|
| Meta after build | version, gitSha, refresh due |
| File records | admission.js hash + summary |
| Module/feature roll-ups | registration, registration-drafts |
| Dependency graph | nodes + edges |
| Doc ingest | decisions, roadmap, bugs |
| PSC 32KB cap | withinLimit |
| Read-only charter | no mutation flags |
| Local recommendation | stub mode, pscBytes |
| npm scripts | cmi:build, incremental |
| gitignore | .cmi/ excluded |

### Manual QA checklist
- [ ] `cmi:build` on clean clone
- [ ] `cmi:incremental` after editing one file
- [ ] `cmi:ask` returns hints with weakness/bug types
- [ ] PSC bytes ≤ 32768 for broad queries
- [ ] No writes to source files during any command

### Phase 2 tests (planned)
- SA auth deny non-SA
- Gateway audit row created
- Cache hit zero tokens
- Rate limit blocks 31st query

### Regression
- Include `cmi-foundation.test.js` in main vitest suite
- Run before release tags

---

## 8. Phase 2 Preview (Not Started)

| Item | Effort |
|------|--------|
| `saAdvisorAsk` Cloud Function | 5 days |
| Secret Manager platform key | 1 day |
| LLM enrich changed files (CI) | 4 days |
| SA superadmin.js panel | 5 days |
| Platform_AiAuditLog | 2 days |
| Firestore CMI mirror (optional) | 3 days |

**Gate:** Phase 1 tests green + SA sign-off on CMI quality.

---

## 9. Explicitly NOT in Phase 1

- ❌ Institution Advisor / OMP
- ❌ Coding assistant / auto-fix
- ❌ LLM calls
- ❌ Super Admin UI panel
- ❌ Firestore sync
- ❌ Tenant data access
- ❌ Automatic deploy/commit/migration

---

## 10. Commands Reference

```bash
# First-time / 6-month full refresh
npm run cmi:build
npm run cmi:build -- --months=12

# After code changes (git repo)
npm run cmi:incremental

# Status
npm run cmi:status

# Local advisor stub (read-only)
npm run cmi:ask "What are registration security weaknesses?"

# Tests
npx vitest run tests/unit/cmi-foundation.test.js
```

---

## 11. Document Index (Phase 1 Deliverables)

| # | Report |
|---|--------|
| 1 | `CMI_IMPLEMENTATION_PLAN.md` |
| 2 | `CMI_DATABASE_DESIGN.md` |
| 3 | `SOFTWARE_ADVISOR_ARCHITECTURE.md` |
| 4 | `SOFTWARE_ADVISOR_SECURITY_PLAN.md` |
| 5 | `AI_COST_ESTIMATION_REPORT.md` |
| 6 | `HISTORICAL_BUG_MEMORY_DESIGN.md` |
| 7 | `SUPER_ADMIN_AI_PHASE1_ROADMAP.md` (this document) |

---

## 12. Success Criteria — Phase 1 Complete

- [x] Full codebase scanned once into `.cmi/`
- [x] 8 memory layers populated
- [x] Incremental update path exists
- [x] git SHA + indexed time + change detection
- [x] Read-only advisor internal API
- [x] PSC ≤ 32 KB enforced
- [x] Answer cache implemented
- [x] 6-month full refresh scheduled in meta
- [x] 10 unit tests pass
- [x] 7 reports delivered
- [x] Zero LLM cost in Phase 1

---

## 13. Conclusion

Phase 1 establishes the **permanent software memory** required for a cost-efficient Super Admin AI Advisor. The system **remembers** EMS architecture without repeatedly reading the codebase or invoking AI.

**Next step (requires approval):** Phase 2 — `saAdvisorAsk` gateway + SA UI + optional LLM summary enrichment.

---

*Foundation built 2026-07-09 — 548 files indexed, 26 historical bugs, 30 ADRs.*
