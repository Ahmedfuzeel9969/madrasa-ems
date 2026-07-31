# Super Admin AI Advisor Phase 2 — Implementation Report

**Date:** 2026-07-09  
**Status:** Staging implementation complete (code only — no production deploy)  
**Project:** madrasa-mangment-app

---

## Summary

Phase 2 delivers a **Super Admin–only Platform Advisor** backed by cloud-synced CMI, server-built PSC (32 KB cap), Gemini via Secret Manager, answer cache, rate limits, audit logging, and citation validation. Tenant `aiAsk` is unchanged.

---

## Components Delivered

| Component | Location | Notes |
|-----------|----------|-------|
| CMI Firestore sync | `scripts/cmi-sync-firestore.js`, `npm run cmi:sync-firestore` | Uploads `.cmi/` → `Platform_Cmi*`; seeds `Platform_Config/sa_advisor` |
| LLM gateway | `functions/lib/sa-advisor/gateway.js` | `saAdvisorAsk`, `saAdvisorGetStatus` |
| Access control | `functions/lib/sa-advisor/access.js` | Super Admin only |
| Secret Manager key | `functions/lib/sa-advisor/platform-key-vault.js` | Secret: `platform-gemini-advisor-key` |
| CMI loader | `functions/lib/sa-advisor/cmi-store.js` | Firestore bundle + memory cache |
| Retrieval | `functions/lib/sa-advisor/retrieve.js` | Domain-aware slice selection |
| PSC builder | `functions/lib/sa-advisor/psc-builder.js` | Hard 32 KB cap, summaries only |
| Prompts / guardrails | `prompts.js`, `guardrails.js` | Read-only charter, off-domain block |
| Answer cache | `functions/lib/sa-advisor/cache.js` | `Platform_AdvisorCache` |
| Rate limits | `functions/lib/sa-advisor/rate-limits.js` | Daily per-admin + platform; **cache hits free** |
| Cost tracker | `functions/lib/sa-advisor/cost-tracker.js` | `Platform_AdvisorBudget`, $50 cap |
| Audit log | `functions/lib/sa-advisor/audit.js` | `Platform_AiAuditLog` — every query |
| Citations | `functions/lib/sa-advisor/citations.js` | Merge + strip hallucinated tags |
| Config / flags | `functions/lib/sa-advisor/config.js` | `enabled: false`, `stagingEnabled: true` |
| Cloud exports | `functions/index.js` | `saAdvisorAsk`, `saAdvisorGetStatus` |
| Firestore rules | `firestore.rules` | SA read CMI/budget; Admin SDK writes only |
| Super Admin UI | `sa/sa-advisor-ui.js`, `#sa-win-advisor` | Reports → Platform Advisor tab |
| Nav / loader | `sa/sa-nav.js`, `superadmin.js`, `ems-lazy-loader.js` | Panel wiring |
| Unit tests | `tests/unit/sa-advisor-phase2.test.js` | 14 tests |

---

## Approval Conditions — Implementation Mapping

| # | Condition | Implementation |
|---|-----------|----------------|
| 1 | Staging only | `stagingEnabled: true` in sync seed; UI labeled staging |
| 2 | `enabled` must stay false | Default + sync seed `enabled: false` |
| 3 | $50 monthly hard cap | `monthlyCostCapUsd: 50`, `hardStopAtCap: true` |
| 4 | Cache hits free | `checkRateLimits(..., { cacheHit: true })` skips counters |
| 5 | No full repo to LLM | Server retrieval + PSC summaries only |
| 6 | PSC cap 32 KB | `PSC_MAX_BYTES = 32768`, enforced in `buildPSC` |
| 7 | Secret Manager for key | `platform-key-vault.js` → `@google-cloud/secret-manager` |
| 8 | Audit every query | `writeSaAudit` on success, failure, and cache hit |
| 9 | Strip hallucinated citations | `stripInvalidCitationTags` + `mergeAndValidateCitations` |
| 10 | No Institution Advisor | Not implemented (SA only) |
| 11 | No automatic code changes | Read-only prompts; no mutation APIs |
| 12 | No prod deploy without approval | **Not deployed** in this phase |

---

## Staging Activation Steps (Operator)

1. `npm run cmi:build`
2. `npm run cmi:sync-firestore` (requires ADC / service account)
3. Create Secret Manager secret `platform-gemini-advisor-key` in GCP project
4. Deploy (staging):  
   `firebase deploy --only firestore:rules,functions:saAdvisorAsk,functions:saAdvisorGetStatus`
5. Verify `Platform_Config/sa_advisor`: `enabled: false`, `stagingEnabled: true`
6. Super Admin → Reports → **Platform Advisor**

---

## Out of Scope (By Design)

- Production `enabled: true`
- Institution / tenant advisor
- Automatic code edits or deploy
- Full functions deploy to production without separate approval

---

## Files Changed (Phase 2)

**New:** `functions/lib/sa-advisor/*` (14 modules), `scripts/cmi-sync-firestore.js`, `sa/sa-advisor-ui.js`, `tests/unit/sa-advisor-phase2.test.js`, this report pack.

**Modified:** `functions/index.js`, `functions/package.json`, `firestore.rules`, `package.json`, `index.html`, `sa/sa-nav.js`, `superadmin.js`, `ems-lazy-loader.js`.
