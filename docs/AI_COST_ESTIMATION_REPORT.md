# AI Cost Estimation Report

**Project:** Madrasa EMS — Super Admin AI Advisor  
**Date:** 2026-07-09  
**Phase:** 1 foundation + Phase 2 projections

---

## 1. Cost Principles (Mandatory)

| Rule | Phase 1 | Phase 2 |
|------|---------|---------|
| No continuous repo reading | ✅ CI/manual only | ✅ |
| No full repo to LLM | ✅ PSC ≤ 32 KB | ✅ |
| Changed-file-only updates | ✅ incremental | ✅ + LLM enrich |
| Full refresh 6/12 months | ✅ configurable | ✅ |
| Local summaries first | ✅ zero LLM | ✅ |
| Answer cache | ✅ local | ✅ cloud + local |

---

## 2. Phase 1 Cost (Current)

| Activity | LLM tokens | Cost |
|----------|------------|------|
| CMI full build | **0** | **$0** |
| CMI incremental | **0** | **$0** |
| Local retrieval | **0** | **$0** |
| Local recommendation stub | **0** | **$0** |
| Disk (`.cmi/` ~6 MB) | — | **$0** |

**Phase 1 monthly cost: $0** (no cloud AI invoked)

**Developer time:** ~15 seconds per `cmi:build` on EMS workspace.

---

## 3. Phase 2 Projected Costs

Assumptions:
- Gemini 2.5 Flash ~$0.075/1M input, ~$0.30/1M output (verify current pricing)
- 20 incremental merges/month, ~8 files changed each
- 150 SA software queries/month
- 40% cache hit rate after month 1
- Full CMI LLM enrich 2×/year (~550 files batch summarized)

### 3.1 Indexing costs

| Item | Frequency | Tokens (est.) | Monthly cost |
|------|-----------|---------------|--------------|
| Incremental LLM file summary | 160 files/mo | ~400 in + 200 out each | **$0.50 – $2.00** |
| Full refresh LLM batch | 2×/year | ~550 files | **$0.15/mo amortized** |
| Local incremental (no change) | Most commits | 0 | **$0** |

### 3.2 Query costs

| Item | Volume | Tokens/query | Monthly cost |
|------|--------|--------------|--------------|
| Software advisor (cache miss) | 90 queries | ~6K in + 1.5K out | **$4 – $12** |
| Software advisor (cache hit) | 60 queries | 0 | **$0** |

### 3.3 Infrastructure

| Item | Monthly |
|------|---------|
| Firestore CMI mirror (optional) | $1 – $3 |
| Cloud Functions `saAdvisorAsk` | $1 – $2 |
| Secret Manager | < $1 |
| Cloud Storage graph blobs | < $1 |

---

## 4. Monthly Total Estimates

| Scenario | SA queries | Merges | **Total/month** |
|----------|------------|--------|-----------------|
| **A — Minimal** | 30 | 5 | **$2 – $5** |
| **B — Moderate** | 150 | 20 | **$8 – $18** |
| **C — Heavy** | 500 (capped) | 40 | **$25 – $45** |

**Hard cap recommendation:** $50/month platform budget with auto-stop.

---

## 5. Cost Comparison: Architectures

| Approach | Monthly (moderate) |
|----------|-------------------|
| Naive: full repo per query | **$500+** ❌ |
| Phase 1 local CMI only | **$0** ✅ |
| Phase 2 hybrid (recommended) | **$8 – $18** ✅ |
| Full local LLM (GPU) | **$80 – $200** |
| Vector DB + cloud LLM | **$15 – $30** |

---

## 6. Cost Controls Implemented (Phase 1)

- [x] Local index — no LLM
- [x] contentHash skip unchanged files
- [x] PSC 32 KB cap in `retrieve.js`
- [x] Answer cache in `.cmi/cache/answers/`
- [x] `nextFullRefreshDue` in meta (6 months default)
- [x] Incremental via `git diff` path list

## Phase 2 additions (planned)

- [ ] Per-admin daily query limit
- [ ] Platform monthly token budget
- [ ] Cloud answer cache in Firestore
- [ ] LLM enrich **changed files only**
- [ ] Cost dashboard in SA console

---

## 7. ROI

| Manual task | Time saved | Value |
|-------------|------------|-------|
| "Where is X implemented?" | 30–60 min | High |
| Architecture audit quarterly | 8 hrs | High |
| Test gap review | 2 hrs | Medium |

**Break-even:** ~2 hours SA time/month vs **~$15** AI cost at moderate use.

---

## 8. 12-Month Projection (Moderate)

| Month | Indexing | Queries | Infra | Total |
|-------|----------|---------|-------|-------|
| 1–2 (Phase 1 only) | $0 | $0 | $0 | **$0** |
| 3–12 (Phase 2 live) | ~$1.5 | ~$10 | ~$3 | **~$14.50/mo** |

**Annual Phase 2:** ~**$130 – $200** (excluding dev build cost)

---

## 9. Conclusion

Phase 1 foundation costs **nothing** to operate. Phase 2 hybrid advisor targets **$8–18/month** at moderate Super Admin use — versus **orders of magnitude more** without CMI retrieval and caching.

---

*See also: `AI_COST_CONTROL_PLAN.md`*
