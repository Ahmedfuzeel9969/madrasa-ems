# AI System Security Report

**Project:** Madrasa EMS  
**Audit type:** Read-only deep audit  
**Date:** 2026-07-09

---

## 1. Security Model Overview

The AI stack uses a **defense-in-depth** pattern:

| Layer | Mechanism | Location |
|-------|-----------|----------|
| 1 | Client access gate | `emsAiCanUse()` |
| 2 | Online-only enforcement | `emsAiIsOnlineReady()` |
| 3 | Client content filter | `emsAiClientGuard()` |
| 4 | Firebase Auth | Callable context |
| 5 | Tenant staff gate | `assertTenantStaffAccess()` |
| 6 | SCP schema validation | `validateContextPack()` |
| 7 | Domain question filter | `assertOnDomainQuestion()` |
| 8 | Output sanitization | `sanitizeModelOutput()` |
| 9 | Audit logging | `AiAuditLog` |
| 10 | Firestore rules | `ai_config`, `AiAuditLog` |

This is **stronger than typical client-only LLM integrations**, but several gaps remain.

---

## 2. Data Access Analysis — Can AI Read…?

### 2.1 Registration data

| Question | Answer |
|----------|--------|
| Can AI read **all** registration records? | **No** — not directly |
| Can AI read **selected student** registration-derived data? | **Yes** — via `student_performance` SCP |

**What is sent to Gemini for a student query:**
- Student id, name, class, type
- Phone **masked** (`***` + last 4 digits)
- Attendance aggregates (3 months)
- Fee net payable, paid, outstanding (numbers)
- Exam trend (last 6 records: name, %, grade, date)
- Discipline: complaint count + **recent sample** (date, type, first 80 chars of details)

**What is NOT sent by design:**
- Full CNIC / B-Form
- Complete registration form fields
- Raw photo blobs
- Full parent PII block
- Bulk student lists

**Risk:** Any staff who knows a `studentId` can trigger analysis for that student — **no department-scoped RBAC** on student SCP builder.

**Verdict:** **Partial read** — summary-level student data, not full registration database.

---

### 2.2 Finance data

| Question | Answer |
|----------|--------|
| Can AI read all finance/ledger? | **No** |
| Can AI read finance aggregates? | **Yes** |

**Sources:**
- `institution_kpi`: `totalIncome`, `totalArrears`, `ledgerExpenseToday` from dashboard stats
- `student_performance`: per-student fee paid/outstanding
- `institutional_deep_dive`: department/class fee collection rates, arrears counts

**Not sent:** Individual receipt lines, staff salary, vendor payments, full ledger journal.

**Verdict:** **Aggregate finance read** — institutional and per-student fee summaries only.

---

### 2.3 Staff data

| Question | Answer |
|----------|--------|
| Can AI read staff records? | **Minimal** |

**Sent:** Teacher/staff **headcounts** in institution KPI only.  
**Not sent:** Staff salaries, credentials, personal files, attendance as staff.

**Verdict:** **Headcount only** — not meaningful staff PII exposure.

---

### 2.4 Parent data

| Question | Answer |
|----------|--------|
| Can parents use AI? | **No** |
| Can AI read parent portal data? | **No direct path** |

**Controls:**
- Client: `emsAiCanUse()` blocks `parent` role
- Server: `assertTenantStaffAccess()` throws if active `Parent_Links` doc exists

**Verdict:** **Blocked** — Phase 1 explicitly denies parents.

---

### 2.5 Super Admin data

| Question | Answer |
|----------|--------|
| Can AI read platform/super-admin data? | **No** |
| Can Super Admin configure tenant AI? | **Yes** — Firestore rules allow SA read/write `ai_config` |

**No AI callable** accepts platform-wide queries. Super Admin has no AI UI; configuration is manual via Firestore or tenant owner settings.

**Verdict:** **No SA data exposure to LLM**; SA has config access only.

---

## 3. Risk Register

### Critical / High

| ID | Risk | Severity | Detail |
|----|------|----------|--------|
| R1 | **API keys in Firestore plaintext** | **High** | `ai_config.providers.gemini.apiKey` stored in tenant doc; owner UI writes directly. Compromise of owner account or Firestore export exposes key. |
| R2 | **No rate limiting on `aiAsk`** | **High** | Any staff can spam queries → Gemini cost abuse, DoS. |
| R3 | **Broad student access by ID** | **High** | No check that staff may view that student's department/class before SCP build. |
| R4 | **Third-party data processor (Google)** | **High** | Student names, discipline snippets, fee status sent to Gemini API — GDPR/FERPA-style consent and DPA considerations. |

### Medium

| ID | Risk | Severity | Detail |
|----|------|----------|--------|
| R5 | **Intent bypasses domain guard** | **Medium** | Valid intent auto-passes `assertOnDomainQuestion` — off-topic questions allowed if intent set. |
| R6 | **RBAC permission not enforced** | **Medium** | `ai.assistant.use` defined but `emsAiCanUse()` uses coarse owner/staff check. |
| R7 | **Discipline text leakage** | **Medium** | Up to 80 chars of complaint `details` sent to external LLM. |
| R8 | **Audit log readable by all staff** | **Medium** | `AiAuditLog` includes `questionPreview` (280 chars) — any staff can read others' queries. |
| R9 | **Secret Manager path unreliable** | **Medium** | `@google-cloud/secret-manager` dynamically required but not in `functions/package.json`. |
| R10 | **No automated security tests** | **Medium** | Regressions in guardrails undetected. |

### Low

| ID | Risk | Severity | Detail |
|----|------|----------|--------|
| R11 | **Model hallucination on sparse SCP** | **Low** | Prompt says don't invent data; not guaranteed. |
| R12 | **getAiAssistantStatus info leak** | **Low** | Reveals model name, enabled state — low sensitivity. |
| R13 | **Local SCP from stale cache** | **Low** | AI may analyze outdated offline data. |

---

## 4. Prompt Injection & Abuse

| Vector | Mitigation | Residual risk |
|--------|------------|---------------|
| User question injection | Domain regex + intent hints | Medium — intent leniency weakens |
| Malicious data in student name/complaint fields | Fields flow into SCP JSON | Medium — field content reaches LLM |
| API key exfiltration via model | Output sanitization redacts `sk-`, `AIza` patterns | Low |
| Replay / automation abuse | None | **High** — no rate limit |
| Cross-tenant access | tenantId validated vs auth + SCP | Low |

---

## 5. Privacy Controls Present vs Missing

| Control | Status |
|---------|--------|
| API keys off client | ✓ |
| SCP size cap (64 KB) | ✓ |
| Phone masking | ✓ |
| No bulk export to LLM | ✓ |
| Parent block | ✓ |
| Server audit | ✓ |
| Tenant opt-out (`enabled: false`) | ✓ |
| CNIC redaction pipeline | ✗ |
| Field-level consent per tenant | ✗ |
| Data residency control | ✗ |
| Query rate limits | ✗ |
| Staff-scope data filtering | ✗ |
| Audit log UI with retention policy | ✗ |
| PII minimization toggle | ✗ |

---

## 6. Firestore Rules (AI-relevant)

```
SystemSettings_Config/ai_config
  read:  owner OR superAdmin
  write: owner OR superAdmin

AiAuditLog/{logId}
  read:  canReadTenantStaff
  write: false (Admin SDK only)
```

**Observation:** Staff cannot read API keys (good). Staff **can** read all AI audit entries including question previews (may be undesirable for sensitive queries).

---

## 7. Offline Security

When offline, AI calls are blocked client-side — **no accidental cloud leakage**.  
There is **no offline LLM** that could leak data locally.

---

## 8. Compliance Considerations (Madrasa / Education Context)

1. **Student PII to US cloud LLM** — names and behavioral/discipline summaries may require explicit institutional policy.
2. **Urdu content moderation** — relies on Gemini safety; no custom madrasa content policy layer.
3. **Audit retention** — no documented retention/deletion for `AiAuditLog`.
4. **Owner key custody** — shared madrasa devices with owner login increase key exposure.

---

## 9. Security Recommendations (Report-only)

| Priority | Recommendation |
|----------|----------------|
| P0 | Move API keys to Secret Manager; store only secret ref in Firestore |
| P0 | Add per-tenant + per-user rate limits on `aiAsk` |
| P1 | Enforce `ai.assistant.use` + department scope before SCP build |
| P1 | Strip or hash student names in SCP when `privacyMode` enabled |
| P1 | Restrict `AiAuditLog` read to owner/admin roles |
| P2 | Add AI security unit tests (guardrails, tenant gate, SCP validation) |
| P2 | Tenant DPA toggle + disclaimer in UI before first AI use |
| P3 | Audit log retention job (90-day purge) |

---

## 10. Security Score

| Dimension | Score /100 | Notes |
|-----------|------------|-------|
| Authentication & authorization | 70 | Staff gate good; RBAC/scoping weak |
| Data minimization | 65 | SCP pattern good; names/discipline leak |
| Key management | 45 | Plaintext Firestore keys |
| Abuse prevention | 40 | No rate limits |
| Audit & accountability | 75 | Server writes; staff-readable |
| Third-party risk | 55 | Gemini only; no DPA tooling |
| **Overall AI security** | **62 / 100** | |

---

*End of AI System Security Report*
