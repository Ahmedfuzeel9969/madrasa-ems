# Super Admin AI Advisor Phase 2 — Security Report

**Date:** 2026-07-09  
**Scope:** Staging-only SA Platform Advisor  
**Verdict:** **Conditional pass for staging** — production blocked until separate approval

---

## Threat Model Summary

| Asset | Risk | Mitigation |
|-------|------|------------|
| Gemini API key | Exfiltration | Secret Manager (`platform-gemini-advisor-key`); never sent to client |
| Full codebase | Over-disclosure to LLM | Server-side CMI retrieval; PSC summaries only; 32 KB cap |
| Tenant data | Cross-tenant leak | No tenant context in SA advisor; separate from `aiAsk` |
| Privilege escalation | Non-SA access | `assertSuperAdminAccess` + Firestore rules SA-only read |
| Prompt injection | Off-domain actions | `guardrails.validateQuestion`; system prompt read-only charter |
| Hallucinated citations | False assurance | Tags validated against PSC; invalid tags stripped |
| Cost abuse | Budget drain | Per-admin (30/day) + platform (100/day) + $50/month hard stop |
| Audit gap | Non-repudiation | Every ask logged to `Platform_AiAuditLog` (incl. cache hits) |

---

## Access Control

- **Callable functions:** `saAdvisorAsk`, `saAdvisorGetStatus` require authenticated Super Admin (claims + Firestore `SuperAdmins` / `Platform_Users`).
- **Firestore rules:** All `Platform_Cmi*`, `Platform_AdvisorCache`, `Platform_AdvisorLimits` — client **write denied**. CMI/budget read SA-only where applicable.
- **Client payload:** Only `{ question, moduleId?, language? }` — no SCP/PSC from browser.

---

## Data Minimization

PSC includes: file paths, short summaries, module/feature IDs, weakness/bug/decision metadata — **not** full file bodies or `.env` contents. CMI build excludes secrets by design (Phase 1).

Output sanitization redacts `AIza…` and `sk-…` patterns before returning to client.

---

## Secret Handling

| Path | Status |
|------|--------|
| Primary | GCP Secret Manager `platform-gemini-advisor-key` |
| Fallback (dev only) | `PLATFORM_GEMINI_ADVISOR_KEY` env / `functions.config().sa_advisor.gemini_key` |

**Recommendation:** Disable env/config fallbacks in production; IAM grant `secretAccessor` only to Cloud Functions service account.

---

## Known Residual Risks

1. **Staging flag on live hosting** — UI visible to all Super Admins once deployed; mitigated by `stagingEnabled` gate and no `enabled: true`.
2. **CMI sync script** — Runs with admin credentials locally; operator must protect ADC/service account keys.
3. **Tenant AI keys** — Existing `ai_config` plaintext keys (pre-existing); out of Phase 2 scope but noted in platform audit.
4. **Cache poisoning** — Low risk; cache writes only via Admin SDK after validated PSC + SA-only trigger path.

---

## Compliance Checklist (12 Approval Conditions)

| Condition | Security status |
|-----------|-----------------|
| Staging only | ✅ Gated by config |
| `enabled: false` | ✅ Default enforced |
| $50 cap | ✅ Transactional budget check |
| Cache hits free | ✅ No rate-limit increment on hit |
| No full repo | ✅ Retrieval + PSC cap |
| 32 KB PSC | ✅ Enforced server-side |
| Secret Manager | ✅ Implemented (+ dev fallback) |
| Audit all queries | ✅ Including failures and cache |
| Strip bad citations | ✅ Type-normalized validation |
| No Institution Advisor | ✅ Not built |
| No auto code changes | ✅ No mutation endpoints |
| No prod without approval | ✅ Not deployed |

---

## Pre-Production Requirements

1. Remove or lock dev key fallbacks in `platform-key-vault.js`.
2. Run staging penetration test: non-SA caller, oversized question, off-domain prompts, budget exhaustion.
3. Verify audit log retention policy (recommend 90+ days, export to cold storage).
4. Separate production approval before `enabled: true`.
