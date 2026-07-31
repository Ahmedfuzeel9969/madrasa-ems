# Super Admin AI Advisor Phase 2 — Cost Report

**Date:** 2026-07-09  
**Approved budget:** **$50 USD / month hard cap**

---

## Cost Controls Implemented

| Control | Value | Collection |
|---------|-------|------------|
| Monthly hard cap | $50 | `Platform_AdvisorBudget/{yyyy-MM}` |
| Per-admin daily queries | 30 | `Platform_AdvisorLimits/{yyyy-MM-dd}` |
| Platform daily queries | 100 | Same |
| Cache hits | **Free** — no daily increment | `cacheHitsFree: true` |
| Token budget (soft) | 500,000 / month | Config field (informational) |
| PSC size cap | 32 KB | Reduces input tokens per call |
| Default model | `gemini-2.5-flash` | Lower cost vs Pro |

---

## Pricing Model (Estimate)

Based on Gemini 2.5 Flash list pricing used in `cost-tracker.js`:

- Input: **$0.075 / 1M tokens**
- Output: **$0.30 / 1M tokens**

Typical SA advisor call (approximate):

| Component | Tokens (est.) |
|-----------|---------------|
| System prompt | ~200 |
| PSC (32 KB JSON) | ~8,000 |
| Question | ~50–200 |
| Answer (max) | ~2,048 |

**Estimated per fresh query:** ~10k input + ~1.5k output ≈ **$0.001–0.002 USD**

---

## Monthly Capacity (Theoretical)

At ~$0.002/query average (fresh):

- **~25,000 fresh queries** before $50 — but daily limits cap earlier:
  - Platform: 100/day × 30 = **3,000 fresh queries/month max**
  - Realistic blended (50% cache): **~$3–5/month** at full daily platform usage

At hard cap ($50):

- System returns `resource-exhausted` — no further LLM calls until next month
- Cache hits still work (no LLM, no budget charge)

---

## Cost Avoidance Features

1. **Answer cache** — 24h TTL (168h for roadmap domains); identical normalized questions reuse stored answer.
2. **PSC trimming** — Drops file slices until under 32 KB.
3. **Domain budgets** — Retrieval limits files/modules per domain.
4. **Audit `costEstUsd`** — Every non-cache query records estimated cost for reconciliation.

---

## Operator Monitoring

```text
Platform_AdvisorBudget/{current-month}
  costUsdEst, tokensUsedEst, lastUpdated

Platform_AiAuditLog (filter cacheHit == false)
  sum(costEstUsd) for reconciliation
```

**Alert threshold (recommended):** Warn at $40 (80% of cap) via scheduled Cloud Function or manual dashboard review.

---

## Staging Cost Expectation

Staging validation (10–50 test queries): **< $0.10**  
Full staging soak (500 queries, 40% cache): **< $1.00**

Production approval should include revised estimates if `queriesPlatformPerDay` or admin count increases.
