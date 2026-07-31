# AI Roadmap Recommendations

**Project:** Madrasa EMS  
**Audit type:** Read-only deep audit  
**Date:** 2026-07-09  
**Constraint:** Recommendations only — no implementation in this audit

---

## 1. Current State Snapshot

| Metric | Value |
|--------|-------|
| Production AI modules | 9 client + 12 server files |
| Active LLM provider | Gemini only |
| UI surfaces | FAB, AI Studio, Settings, 360 button |
| Automated AI tests | 0 |
| Registration AI | Documented only (Phase E) |
| Offline AI | None |

---

## 2. Final Scores (Out of 100)

| Dimension | Score | Summary |
|-----------|-------|---------|
| **AI architecture** | **74** | Strong SCP + gateway + audit; weak RBAC wiring, no rate limits, no tests |
| **AI usefulness** | **56** | Good Urdu KPI consultant; no registration/finance/action AI |
| **AI security** | **62** | Parent block + server keys good; plaintext Firestore keys, broad staff access |
| **AI integration** | **54** | Core analytics wired; most EMS modules disconnected |
| **AI readiness** | **47** | Requires online + API key setup; Beta; single provider; untested |
| **Global competitiveness** | **33** | 0/5 AI intelligence features implemented vs own global comparison |

**Overall AI maturity:** **54 / 100** (average of above)

---

## 3. Strategic Direction

### Recommended north star
**"Bounded institutional intelligence"** — extend existing SCP/gateway to more modules **without** becoming an unconstrained chatbot over raw PII.

### Not recommended
- Open-ended "chat with all madrasa data"
- Client-side API keys
- Auto-executing AI actions without human approval
- Local LLM as primary path for Urdu education domain

---

## 4. Roadmap Phases

### Phase 0 — Hardening (2–3 weeks) — **Do first**

| Item | Rationale | Priority |
|------|-----------|----------|
| Move Gemini keys to Secret Manager | R1 security — plaintext Firestore | P0 |
| Rate limit `aiAsk` per user/tenant | Cost abuse | P0 |
| Wire `ai.assistant.use` in `emsAiCanUse` | RBAC alignment | P1 |
| Department scope check on student SCP | Row-level access | P1 |
| AI unit tests (guardrails, SCP, gateway mocks) | Regression safety | P1 |
| Fix `getAiAssistantStatus` allowedIntents | Include `institutional_deep_dive` | P2 |
| Add `@google-cloud/secret-manager` to functions deps | Secret path reliability | P2 |
| Owner UI: privacy disclaimer + opt-in | Compliance | P2 |

**Exit criteria:** Security score target ≥ 75; 15+ AI unit tests green.

---

### Phase 1 — Deepen existing assistant (3–4 weeks)

| Item | Description |
|------|-------------|
| AI audit viewer | Owner-only UI for `AiAuditLog` |
| Export AI answer | Copy / PDF snippet from FAB & Studio |
| Cost estimate display | Show token usage in audit meta |
| Stale-data indicator | Show SCP `generatedAt` in UI |
| Enable OpenAI OR Claude (one) | Premium tenant option — not both initially |
| FAB/studio loader unify | Ensure deep-dive works from FAB |

**Exit criteria:** Useful score target ≥ 65; owner can review AI usage.

---

### Phase 2 — Registration AI (Phase E alignment) (4–6 weeks)

Align with `docs/REGISTRATION_PHASE2_IMPLEMENTATION_PLAN.md` E2:

| Capability | Approach |
|------------|----------|
| Duplicate explanation | SCP with duplicate match summary — no raw CNIC |
| Field correction hints | Rules offline + LLM online |
| NL search parse | Intent `registration_search` → structured filter object (human confirms) |
| Form-fill suggestions | Opt-in per field; never auto-submit |
| Offline fallback | `emsRegAiRulesFallback` — validation messages only |

**Reuse:** `ems-ai-orchestrator.js`, gateway, guardrails — new SCP builders in `ems-registration-ai-context.js` (future).

**Exit criteria:** Registration staff AI chip in `registration-ui.js`; offline rules work without LLM.

---

### Phase 3 — Finance & reporting AI (3–4 weeks)

| Capability | SCP source |
|------------|------------|
| Defaulter cluster analysis | Fee aggregates by class |
| Collection forecast narrative | Monthly collection trends |
| "Explain this student's fee status" | Per-student finance SCP (from finance.js indexes) |

**Integration point:** Finance module toolbar + FAB handoff (mirror 360 pattern).

---

### Phase 4 — Super Admin Platform Advisor (5 weeks)

Per `SUPER_ADMIN_AI_ADVISOR_PROPOSAL.md`:

- Isolated `saAiAdvisorAsk` callable
- CI codebase index
- SA console panel
- Read-only architecture/security/release reports

**Exit criteria:** SA generates weekly health report without student PII.

---

### Phase 5 — Advanced intelligence (8+ weeks) — **Optional / competitive**

| Feature | Technology | Notes |
|---------|------------|-------|
| Semantic search | Embeddings + vector store (Typesense vector or Vertex) | High effort |
| Document OCR | Cloud Vision + Gemini extraction | Registration docs |
| Predictive enrollment | Time-series + ML model | Needs historical data maturity |
| Parent FAQ chatbot | Scoped parent callable — **separate** from staff AI | Privacy review required |

---

## 5. Priority Matrix

```
Impact ↑
  │  P0 Hardening          Registration AI
  │  SA Advisor            Finance AI
  │                        Semantic search
  └────────────────────────────────→ Effort
         Low                    High
```

**Recommended sequence:** P0 → Phase 1 → Registration AI → SA Advisor → Finance AI → Advanced

---

## 6. Local AI vs Cloud AI — Recommendation

| Use case | Local | Cloud | Winner |
|----------|-------|-------|--------|
| Urdu analytical reports | Poor quality | Gemini strong | **Cloud** |
| Offline field registration | Required | Unavailable | **Rules engine** (not LLM) |
| Codebase SA audit | Possible (dev) | Better reasoning | **Cloud** (SA online) |
| Privacy-sensitive CNIC | Safer local | Risk third party | **Neither** — don't send CNIC |
| Cost at scale | HW cost | Pay per token | **Cloud** at current volume |

**Policy recommendation:**
- **Cloud Gemini** for staff analytics and SA advisor
- **Deterministic rules** for offline registration (not local LLM)
- **Local retrieval only** (future) for doc search index — synthesis still cloud

---

## 7. Cost Roadmap

| Phase | Est. incremental monthly cost (100 tenants, moderate use) |
|-------|-----------------------------------------------------------|
| Current (analytics only) | $10 – $80 |
| + Registration AI | +$30 – $150 |
| + SA Advisor | +$5 – $25 (platform) |
| + Semantic search | +$50 – $200 (embeddings storage) |

**Mitigation:** Rate limits, SCP size caps, Flash models, tenant `enabled` toggle, usage dashboard.

---

## 8. Testing Roadmap

| Test type | Target |
|-----------|--------|
| Unit | SCP builders, guardrails, context-schema |
| Functions | gateway auth mocks, key-vault, audit |
| E2E | FAB submit (emulator + mock Gemini) |
| Security | Parent denied, tenant mismatch, oversize SCP |
| Load | Rate limit behavior under burst |

**Goal:** 25+ AI tests by end of Phase 0.

---

## 9. KPIs to Track Post-Roadmap

| KPI | Baseline | 12-month target |
|-----|----------|-----------------|
| AI architecture score | 74 | 85 |
| AI usefulness score | 56 | 75 |
| AI security score | 62 | 80 |
| Global AI features implemented | 0/5 | 3/5 |
| AI unit tests | 0 | 40+ |
| Tenants with AI enabled | Unknown | 60%+ |
| Avg queries/tenant/month | Unknown | Monitor + cap |

---

## 10. Quick Wins (No new features)

1. Add "Beta — verify before action" disclaimer in FAB/Studio footer  
2. Show `generatedAt` timestamp on AI answers  
3. Document owner API key setup in sys-settings help text  
4. Hide `institutional_deep_dive` from FAB until macro module loaded  
5. Add AI section to deploy preflight (verify `aiAsk` exported)

---

## 11. Decisions Required from Leadership

| Decision | Options |
|----------|---------|
| Student names to Google | Allow / mask / tenant opt-out |
| Registration AI timing | After Phase A drafts stable vs parallel |
| Second LLM provider | OpenAI vs Anthropic vs none |
| SA Advisor priority | Before or after Registration AI |
| Parent AI ever? | Phase 5+ with separate gateway |

---

## 12. Conclusion

Madrasa EMS has a **credible Phase 1 AI foundation** worth investing in — but it is **not yet competitive globally** and **not production-hardened**. The highest ROI path is:

1. **Secure the gateway** (keys, rate limits, RBAC)  
2. **Extend SCP to registration** (reuse architecture)  
3. **Add SA Platform Advisor** (platform differentiation)  
4. **Defer** vector search and local LLM until volume justifies cost

**No code was changed in this audit.** All recommendations are advisory.

---

## Appendix — Report Index

| Report | Path |
|--------|------|
| Architecture | `docs/AI_SYSTEM_ARCHITECTURE_REPORT.md` |
| Activity | `docs/AI_SYSTEM_ACTIVITY_REPORT.md` |
| Security | `docs/AI_SYSTEM_SECURITY_REPORT.md` |
| Strengths & Weaknesses | `docs/AI_SYSTEM_STRENGTHS_AND_WEAKNESSES.md` |
| SA Advisor Proposal | `docs/SUPER_ADMIN_AI_ADVISOR_PROPOSAL.md` |
| Roadmap (this document) | `docs/AI_ROADMAP_RECOMMENDATIONS.md` |

---

*End of AI Roadmap Recommendations*
