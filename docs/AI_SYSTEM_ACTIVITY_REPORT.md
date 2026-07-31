# AI System Activity Report

**Project:** Madrasa EMS  
**Audit type:** Read-only deep audit  
**Date:** 2026-07-09

---

## 1. Objective A — What AI Features Currently Exist?

### 1.1 Implemented (in codebase)

| Feature | Description | UI | Status |
|---------|-------------|-----|--------|
| **Chat assistant (FAB)** | Urdu RTL floating panel — ask analytical questions | Yes (`#ems-ai-fab-root`) | **Active** |
| **AI Analytics Studio** | Department/class/date deep-dive institutional analysis | Yes (ribbon "AI تجزیات") | **Active** |
| **Student 360° AI analysis** | One-click AI commentary from dashboard 360 report | Yes (`#btn-360-ai`) | **Active** |
| **Institution KPI summary** | Executive-style KPI commentary | Yes (FAB intent) | **Active** |
| **Class comparison analysis** | Compare two classes on attendance/exams | Yes (FAB intent) | **Active** |
| **Owner AI settings** | Enable/disable, Gemini model, API key storage | Yes (`sys-win-ai`) | **Active** |
| **Server status probe** | `getAiAssistantStatus` from settings | Yes (probe button) | **Active** |
| **AI audit logging** | Per-query server audit to Firestore | No UI (backend only) | **Active** |

### 1.2 Partially implemented

| Feature | Description | Status |
|---------|-------------|--------|
| **Multi-LLM support** | Router + OpenAI/Anthropic adapters exist | **Partial** — stubs throw errors |
| **Secret Manager key vault** | Code path in `key-vault.js` | **Partial** — dep not in `package.json` |
| **RBAC-scoped AI access** | `ai.assistant.use` in RBAC catalog | **Partial** — not enforced client-side |
| **FAB deep-dive intent** | `institutional_deep_dive` shown in FAB | **Partial** — macro builder lazy-loaded for Studio |
| **Report generation** | AI produces narrative text, not PDF/export | **Partial** — commentary only |

### 1.3 Placeholders only

| Feature | Location | Status |
|---------|----------|--------|
| OpenAI provider | `functions/lib/ai/providers/openai-provider.js` | **Placeholder** |
| Anthropic provider | `functions/lib/ai/providers/anthropic-provider.js` | **Placeholder** |
| Registration AI assist | `emsRegAiAssist`, `emsRegAiRulesFallback` | **Placeholder** — docs only |
| Registration analytics AI | Phase E in roadmap | **Placeholder** |
| AI duplicate explanation | Registration Phase 2 docs | **Placeholder** |
| AI form auto-fill | Global comparison gap #36 | **Placeholder** |
| AI document OCR/classification | Roadmap | **Placeholder** |
| Predictive enrollment | Roadmap | **Placeholder** |
| Super Admin AI panel | No UI in `superadmin.js` | **Placeholder** |

### 1.4 Not connected to UI

| Component | Notes |
|-----------|-------|
| `AiAuditLog` reader UI | Logs written; no admin viewer |
| OpenAI / Anthropic providers | Server code only, unusable |
| `ai.assistant.use` RBAC enforcement | Permission exists; AI ignores it |
| Platform-level AI analytics | No cross-tenant SA dashboard |
| Finance module AI hooks | None in `finance.js` |
| Registration module AI hooks | None in `registration-ui.js` / `admission.js` |
| Parent portal AI | Parents blocked at server |

### 1.5 Hidden / non-obvious AI modules

No covert or undocumented AI runtimes were found. The entire AI surface is under:
- `cloud/ems-ai-*.js`
- `functions/lib/ai/`

**Not AI:** Enterprise search (Typesense), duplicate detection (fuzzy rules), dashboard stats aggregation.

---

## 2. Activity Level Matrix

| Feature | Active | Partially active | Inactive | Experimental |
|---------|:------:|:----------------:|:--------:|:------------:|
| Gemini chat assistant (FAB) | ✓ | | | |
| AI Studio deep dive | ✓ | | | |
| 360° student AI button | ✓ | | | |
| Institution KPI intent | ✓ | | | |
| Class compare intent | ✓ | | | |
| Owner AI settings | ✓ | | | |
| AI audit trail (write) | ✓ | | | |
| Multi-provider router | | ✓ | | |
| Secret Manager keys | | ✓ | | |
| RBAC `ai.assistant.use` | | ✓ | | |
| Registration AI assistant | | | ✓ | |
| Finance AI insights | | | ✓ | |
| Parent AI chat | | | ✓ | |
| Super Admin AI advisor | | | ✓ | |
| OpenAI / Claude | | | ✓ | |
| Offline AI fallback | | | ✓ | |
| Vector / semantic search | | | ✓ | |
| AI report PDF export | | | ✓ | |
| Automated tests for AI | | | ✓ | |
| Local/on-device LLM | | | ✓ | |
| Beta labeling | | | | ✓ |

**Experimental note:** UI labels assistant as **"Beta"** — production-capable but not feature-complete.

---

## 3. Question B–E Summary

### B. Fully working (when configured)

Requires: online mode, Firebase Functions deployed, owner-configured Gemini API key (or server env key), signed-in owner/staff.

1. Urdu analytical chat via FAB  
2. AI Studio institutional deep dive  
3. Student 360° → AI panel handoff  
4. AI settings save/load (owner)  
5. Server-side audit logging  
6. Parent denial at gateway  

### C. Partially implemented

1. Multi-LLM (Gemini only works)  
2. RBAC fine-grained AI permissions  
3. FAB `institutional_deep_dive` without Studio preload  
4. Secret Manager integration  
5. `getAiAssistantStatus` omits `institutional_deep_dive` in `allowedIntents` array (gateway mismatch)  

### D. Placeholders only

1. Registration Phase E AI (`emsRegAiAssist`)  
2. OpenAI / Anthropic providers  
3. Offline rule-based fallback  
4. Super Admin AI UI  
5. All 5 "AI & Intelligence" gaps from global comparison doc  

### E. Not connected to UI

1. Audit log viewer  
2. Provider stubs  
3. RBAC permission wiring  
4. Finance / registration / parent / SA modules  

---

## 4. Operational Prerequisites

For AI to appear **active** to end users:

| Prerequisite | Without it |
|--------------|------------|
| Cloud / online EMS mode | FAB shows offline banner |
| `aiAsk` function deployed | `functions_unavailable` error |
| Gemini API key in `ai_config` or env | `ai_key_missing` |
| `enabled !== false` in ai_config | `ai_disabled` |
| User is owner or active staff | `ai_access_denied` / permission-denied |
| Local student/cache data populated | Empty or weak SCP → "insufficient data" responses |

---

## 5. Test Coverage

| Area | Tests found |
|------|-------------|
| AI unit tests | **None** |
| AI e2e tests | **None** |
| Gateway mock tests | **None** |
| SCP builder tests | **None** |

AI activity is **unverified by automated test suite** (530+ tests pass, zero AI-specific).

---

## 6. Usage Surface Summary

```
Active UI surfaces:     4  (FAB, Studio, Settings, 360 button)
Active server APIs:     2  (aiAsk, getAiAssistantStatus)
Active intents:         4  (all via gateway schema)
Planned doc features:  10+ (Registration Phase E, global gaps)
Inactive modules:       6+ (finance, registration, parent, SA, providers, offline)
```

---

## 7. Conclusion

The EMS AI system is **narrow but functional**: an Urdu institutional analytics consultant for staff, not a broad AI platform. Most "AI features" referenced in registration roadmap documents **do not exist in code**. Activity is concentrated in the **analytics commentary** lane; all other AI categories are inactive or placeholder.

---

*End of AI System Activity Report*
