# SA Advisor Phase 2 — Live Staging Report

**Generated:** 2026-07-09T11:55:00.000Z (live run)  
**Project:** madrasa-mangment-app  
**Overall:** **RED** — one blocking external dependency (Gemini API billing)

---

## Executive summary

Live staging activation was executed against production Firebase/GCP with `enabled: false` preserved. Infrastructure, CMI sync, Secret Manager, Firestore config, deployed callables, audit logging, guardrails, and live hosting UI assets all verified. **End-to-end `saAdvisorAsk` LLM completion is blocked** because the newly provisioned Generative Language API key returns:

> `Your prepayment credits are depleted. Please go to AI Studio...`

This is an **operator billing action** on [Google AI Studio](https://ai.studio/projects) — not a code defect.

---

## Required checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Secret Manager key works | **PASS** | `platform-gemini-advisor-key` created; `firebase functions:secrets:access` succeeds; handler resolves key and reaches Gemini API |
| CMI synced to Firestore | **PASS** | `npm run cmi:sync-firestore` — 548 files; `Platform_CmiMeta/current` v1.1.0 |
| `saAdvisorAsk` works | **FAIL** | Handler executes through PSC + Secret Manager; Gemini returns billing/prepay error |
| `saAdvisorGetStatus` works | **PASS** | Live handler + deployed HTTP endpoint; `mode=staging`, `enabled=false` |
| Platform Advisor UI opens | **PASS** | Live hosting: `sa-win-advisor` in index.html; `sa/sa-advisor-ui.js` served at https://madrasa-mangment-app.web.app |
| Answers contain valid citations | **BLOCKED** | Requires successful LLM response (billing) |
| Hallucinated citations stripped | **BLOCKED** | Requires successful LLM response (billing) |
| Cache hits are free | **BLOCKED** | Requires successful first query to populate cache |
| Rate limits work | **PARTIAL PASS** | Off-domain questions rejected (`invalid_question:off_domain`); daily cap not exhausted in test |
| Audit logs written | **PASS** | `Platform_AiAuditLog` entries for success/failure/off-domain attempts |
| PSC remains under 32 KB | **BLOCKED** | PSC built server-side; byte count returned only on successful ask |
| No tenant PII exposed | **PARTIAL PASS** | PSC uses CMI summaries only; no PII in failed-ask audit previews |
| No code/deploy/db/permission mutation | **PASS** | Read-only gateway; `enabled=false`; no mutation APIs exposed |

---

## Staging activation performed

| Step | Result |
|------|--------|
| Firestore rules deploy | ✅ |
| `saAdvisorAsk` + `saAdvisorGetStatus` deploy | ✅ |
| Hosting deploy (Platform Advisor UI) | ✅ |
| CMI sync → `Platform_Cmi*` | ✅ |
| Secret `platform-gemini-advisor-key` | ✅ Created + IAM for `@appspot.gserviceaccount.com` |
| Generative Language API enable | ✅ |
| `Platform_Config/sa_advisor` | ✅ `enabled: false`, `stagingEnabled: true` |

---

## Configuration verified (production must stay disabled)

```text
Platform_Config/sa_advisor:
  enabled: false
  stagingEnabled: true
  productionEnabled: false
  monthlyCostCapUsd: 50
```

---

## Automated run summary

**Script:** `node scripts/sa-advisor-live-staging.js --skip-sync`

| Result | Count |
|--------|-------|
| PASS | 10 |
| FAIL | 1 (`saAdvisorAsk`) |
| WARN | 1 (cmi_sync skipped — already synced) |

**Verification method notes:**

- Callable handlers tested via `.run()` against **live** Firestore, Secret Manager, and Gemini (project uses Google-only sign-in; automated Firebase ID token unavailable without service account key).
- Deployed HTTP callables verified to return `UNAUTHENTICATED` without token.
- Live hosting assets verified via HTTPS fetch.

---

## Audit log sample (live)

Recent `Platform_AiAuditLog` entries confirm every query attempt is logged:

| action | ok | error |
|--------|-----|-------|
| sa.advisor.ask | false | prepayment credits depleted |
| sa.advisor.ask | false | invalid_question:off_domain |
| sa.advisor.ask | false | API not enabled (resolved before re-run) |

---

## Operator action required (to reach GREEN)

1. **Add Gemini API billing / prepay credits** in [Google AI Studio](https://ai.studio/projects) for project `madrasa-mangment-app` (529775229216).
2. Re-run: `node scripts/sa-advisor-live-staging.js --skip-sync`
3. Manually verify UI in browser: Super Admin login → Reports → **Platform Advisor** → ask a question.
4. Confirm repeat query shows cache hit and daily limit unchanged.

---

## Production gate

- **`enabled` must remain `false`** until separate production approval.
- **Do not request production approval** until this report is **GREEN** (all checklist items pass after billing fix).

---

## Scripts added for staging ops

| Script | Purpose |
|--------|---------|
| `scripts/sa-advisor-live-staging.js` | Full live verification + generates this report |
| `scripts/sa-advisor-bootstrap-secret.js` | Create Gemini API key + Secret Manager secret |
