# Super Admin AI Advisor Phase 2 — Test Report

**Date:** 2026-07-09  
**Runner:** Vitest 3.2.6

---

## Automated Test Results

### SA Advisor Phase 2 (`tests/unit/sa-advisor-phase2.test.js`)

| Suite | Tests | Result |
|-------|-------|--------|
| Config & staging flag | 5 | ✅ Pass |
| Guardrails | 3 | ✅ Pass |
| PSC builder | 1 | ✅ Pass |
| Citations | 2 | ✅ Pass |
| Cache | 2 | ✅ Pass |
| Cost tracker | 1 | ✅ Pass |
| **Total** | **14** | **✅ 14/14 pass** |

**Command:**
```bash
npm test -- tests/unit/sa-advisor-phase2.test.js
```

### CMI Phase 1 regression (`tests/unit/cmi-foundation.test.js`)

| Tests | Result |
|-------|--------|
| 10 | ✅ Pass |

**Command:**
```bash
npm test -- tests/unit/cmi-foundation.test.js
```

---

## Coverage by Approval Condition

| Condition | Test evidence |
|-----------|---------------|
| Staging flag | `isAdvisorAllowed` staging vs disabled vs production |
| `enabled: false` default | `DEFAULT_CONFIG.enabled === false` |
| $50 cap | `monthlyCostCapUsd: 50` assertion |
| Cache hits free | Logic in `rate-limits.js` (integration test pending post-deploy) |
| No full repo | PSC JSON has no `function(` bodies; summaries only |
| 32 KB PSC | `psc.bytes <= 32768` with mock 40-file bundle |
| Secret Manager | Manual / staging integration (requires GCP) |
| Audit all queries | Manual / staging integration |
| Citation strip | Hallucinated `[file:fake]` and `[weak:FAKE]` removed; valid `[weak:w1]` kept |
| No Institution Advisor | N/A — not in codebase |
| No auto code changes | No mutation APIs in module exports |

---

## Manual / Staging Tests Required (Post-Deploy)

| # | Test | Expected |
|---|------|----------|
| 1 | Non-SA user calls `saAdvisorAsk` | `permission-denied` |
| 2 | SA calls with `stagingEnabled: true`, `enabled: false` | Success |
| 3 | Same question twice | Second response `cacheHit: true`; daily limit unchanged |
| 4 | 31st query same day (same admin) | `resource-exhausted` |
| 5 | Missing CMI sync | `failed-precondition` CMI message |
| 6 | Missing Secret Manager key | `failed-precondition` key message |
| 7 | Audit log entry per query | `Platform_AiAuditLog` document created |
| 8 | UI panel loads status | Budget, CMI version, staging badge |
| 9 | Off-domain question "deploy now" | `invalid-argument` |
| 10 | Budget at $50 | Hard stop on fresh queries; cache still works |

---

## Not Run (This Session)

- Full suite (`npm test` — 530+ tests): recommended before staging deploy
- E2E Playwright for SA advisor panel
- Live Gemini integration (requires secret + deployed functions)
- `npm run cmi:sync-firestore` against production Firestore (requires credentials)

---

## Verdict

**Unit tests: PASS (14/14 Phase 2, 10/10 CMI regression)**  
**Integration/staging: PENDING deploy + manual checklist above**
