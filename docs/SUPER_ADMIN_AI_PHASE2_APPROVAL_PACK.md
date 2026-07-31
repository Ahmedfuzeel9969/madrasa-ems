# Super Admin AI — Phase 2 Approval Pack

**Date:** 2026-07-09  
**For:** Super Admin / Platform owner sign-off  
**Status:** Awaiting approval — **do not implement until signed**

---

## 1. What Phase 2 Adds

Phase 1 gave EMS a **permanent software memory** (548 files, 8 layers, $0 AI cost).

Phase 2 adds **Super Admin cloud advisor**:

| # | Component | One-line summary |
|---|-----------|------------------|
| 1 | **`saAdvisorAsk`** | SA-only callable; server builds context, returns Urdu/EN advice |
| 2 | **SA UI panel** | New "Platform Advisor" tab in Super Admin console |
| 3 | **LLM gateway** | Isolated Gemini path — not tenant `aiAsk` |
| 4 | **Secret Manager** | Platform key `platform-gemini-advisor-key` |
| 5 | **Answer cache** | Firestore `Platform_AdvisorCache` — 24h–7d TTL |
| 6 | **Rate limits** | 30 queries/admin/day; 100 platform/day |
| 7 | **Audit log** | Every question → `Platform_AiAuditLog` |
| 8 | **PSC slice selection** | Domain-aware retrieval; ≤ 32 KB |
| 9 | **Citations** | Structured CMI IDs + validated LLM tags |
| 10 | **Cost guardrails** | $50/mo cap; cache hits free; no full-repo LLM |

---

## 2. Key Architecture Decision

**Client sends only the question.**  
**Server builds PSC from synced CMI.**  

This prevents tampering and ensures cost control — unlike tenant AI where the client sends SCP.

---

## 3. What Is NOT in Phase 2

- ❌ Institution Advisor / tenant KPI advice  
- ❌ Automatic code changes, deploy, migrations  
- ❌ Production enablement (staging first)  
- ❌ LLM indexing of entire codebase per query  
- ❌ Coding assistant / auto-fix  

---

## 4. New Infrastructure

```
CI:  cmi:build  →  cmi:sync-firestore  →  Platform_CodeMemory/*
Runtime:  SA UI  →  saAdvisorAsk  →  Secret Manager  →  Gemini
           ↓              ↓
    Platform_AdvisorCache   Platform_AiAuditLog
```

---

## 5. Estimates

| Metric | Value |
|--------|-------|
| **Implementation time** | ~23 dev-days (~5 weeks) |
| **Monthly cost (moderate)** | $8 – $15 |
| **Monthly cost (cap)** | $50 hard stop |
| **New unit tests** | 25+ |
| **New callables** | 2 (`saAdvisorAsk`, `saAdvisorGetStatus`) |
| **New SA UI** | 1 panel (`sa-win-advisor`) |

---

## 6. Rollout (After Build)

1. Staging deploy only  
2. `enabled: false` on production  
3. 1 week SA QA on staging  
4. Separate production enable approval  

---

## 7. Rollback

- Disable `Platform_Config/sa_advisor.enabled`  
- Phase 1 local CMI + CLI still works  
- Delete cache collection if needed  

---

## 8. Risks (Top 5)

| Risk | Mitigation |
|------|------------|
| LLM cost spike | Rate limits + $50 cap |
| Hallucinated advice | Citations validated against CMI |
| CMI stale in cloud | CI sync on merge; UI shows version |
| Confusion with tenant AI | Separate UI, callable, keys |
| Secret exposure | Secret Manager + output redaction |

---

## 9. Approval Decisions Required

| Decision | Recommendation |
|----------|----------------|
| Proceed with Phase 2 implementation? | ☐ Yes ☐ No |
| Staging-only until further approval? | ☐ Yes (recommended) |
| Cache hits exempt from rate limit? | ☐ Yes (recommended) |
| Monthly budget cap | $50 ☐ / Other: ___ |
| Default language | Urdu ☐ |
| LLM model | Gemini 2.5 Flash ☐ |

---

## 10. Full Design Reference

All technical detail: **`SUPER_ADMIN_AI_PHASE2_DESIGN.md`**

Phase 1 foundation: **`SUPER_ADMIN_AI_PHASE1_ROADMAP.md`**

---

*Sign-off required before any Phase 2 code or deployment.*
