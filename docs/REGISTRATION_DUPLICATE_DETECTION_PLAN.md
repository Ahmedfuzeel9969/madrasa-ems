# Registration Duplicate Detection Plan

**Date:** 9 July 2026  
**Phase:** 1 — Priority 3  
**Status:** Design document (pre-implementation)

---

## Problem Statement

Duplicate students can be admitted when staff manually enter records. Duplicate detection exists **only during CSV/Excel import** (`smartValidate` in `ems-import-export.js` L832–849) and checks duplicates **within the import file only** — not against the existing registration database.

---

## Current State

### Import-only detection

| Field | Checked | Scope | Normalization |
|-------|---------|-------|---------------|
| CNIC / B-Form | ✅ | Within import file | Strip non-digits |
| Phone | ✅ | Within import file | Strip non-digits, min 7 chars |
| Name | ❌ | — | — |
| Father name | ❌ | — | — |
| Roll number | ❌ | — | — |

### Manual admission (`processRegistration`)

- No duplicate check before save
- No warning dialog on potential duplicate
- Auto-ID prevents ID collision but not person duplication

---

## Target Duplicate Rules

### Hard duplicates (block save — require override)

| Rule ID | Fields | Match Logic | Example |
|---------|--------|-------------|---------|
| D1 | CNIC | Exact match after digit normalization | `35202-1234567-1` = `3520212345671` |
| D2 | B-Form | Same as CNIC (alias field `bform`, `cnic`) | — |
| D3 | Phone | Exact match after digit normalization (≥10 digits) | `0300-1234567` = `03001234567` |

### Soft duplicates (warn — allow override with reason)

| Rule ID | Fields | Match Logic | Threshold |
|---------|--------|-------------|-----------|
| D4 | Name + Father name | Case-insensitive exact match | Both fields must match |
| D5 | Name + Class | Same name in same class | Fuzzy optional in Phase 2 |
| D6 | Roll number | Exact match within tenant | `madrasaRollNo` or `rollNo` |
| D7 | Name + Phone (partial) | Name match + phone last 7 digits | Catch typos in CNIC |

### Fuzzy duplicates (Phase 2 — AI assistant)

| Rule ID | Fields | Match Logic |
|---------|--------|-------------|
| D8 | Name | Levenshtein distance ≤ 2 | "محمد علی" ≈ "محمد على" |
| D9 | Father name + CNIC partial | First 5 CNIC digits + fname | Family duplicate |

---

## Proposed API

### `emsRegCheckDuplicates(candidate, opts)`

**Location:** New file `ems-registration-duplicates.js` (or section in repository)

```javascript
// Input
candidate = {
  name, fname, cnic, phone, bform,
  rollNo, madrasaRollNo, class, type, id  // id excluded from self-match
}
opts = {
  scope: 'approved' | 'rejected' | 'all',  // default 'approved'
  excludeId: 'STD-05',                      // when editing
  mode: 'hard' | 'soft' | 'all'            // default 'all'
}

// Output
{
  hasHard: true,
  hasSoft: true,
  matches: [
    {
      rule: 'D1',
      severity: 'hard',
      field: 'cnic',
      value: '3520212345671',
      existingId: 'STD-042',
      existingName: 'محمد علی',
      existingClass: 'جماعت ہفتم'
    }
  ]
}
```

### Implementation strategy

```
emsRegCheckDuplicates(candidate)
  │
  ├─ 1. Normalize candidate fields
  │     cnicNorm = digits only
  │     phoneNorm = digits only (last 10)
  │     nameNorm = trim + lowercase
  │
  ├─ 2. Build lookup keys
  │     keys = [cnic:{norm}, phone:{norm}, roll:{norm}]
  │
  ├─ 3. Query repo indexes
  │     Option A: Scan emsRegRepoForEach (works to ~50k in RAM)
  │     Option B: IDB secondary indexes (new — recommended)
  │       Collection: {tenantId}__reg_dup_index
  │       Keys: cnic:{norm} → id, phone:{norm} → id
  │
  ├─ 4. Apply rules D1–D7
  │
  └─ 5. Return matches (exclude candidate.id)
```

### Secondary index (recommended for scale)

| Index Key | Value | Updated On |
|-----------|-------|------------|
| `cnic:{digits}` | `{ id, name }` | upsert, delete |
| `phone:{digits}` | `{ id, name }` | upsert, delete |
| `roll:{rollNo}` | `{ id, name }` | upsert, delete |
| `namefname:{hash}` | `[{ id, name, class }]` | upsert, delete |

Maintained incrementally in `repoMirrorPut` / `repoMirrorRemove` — same pattern as search index.

---

## UI Integration

### On save (approve)

```
processRegistration(type, 'approved')
  │
  ├─ Build candidate from form fields
  ├─ emsRegCheckDuplicates(candidate, { excludeId: currentEditingId })
  │
  ├─ If hasHard:
  │    Show modal: "⚠️ یہ شناختی نمبر پہلے سے موجود ہے"
  │    Display existing record summary
  │    Options: [منسوخ] [پھر بھی محفوظ کریں — Owner only]
  │
  ├─ If hasSoft (no hard):
  │    Show warning: "⚠️ ممکنہ duplicate — کیا جاری رکھیں؟"
  │    Options: [منسوخ] [جاری رکھیں] [موجودہ ریکارڈ دیکھیں]
  │
  └─ On override: log to audit trail with reason
```

### On field blur (real-time — Phase 1b)

| Field | Trigger | Feedback |
|-------|---------|----------|
| CNIC | `onblur` | Inline red/green indicator |
| Phone | `onblur` | Inline indicator |
| Name + Father | `onblur` (both filled) | Soft warning badge |

### Import enhancement

Extend `smartValidate` to call `emsRegCheckDuplicates` against repo for each record (batch mode with progress bar).

---

## Normalization Rules

| Field | Rule | Example |
|-------|------|---------|
| CNIC | Remove all non-digits; must be 13 digits for hard match | `35202-1234567-1` → `3520212345671` |
| B-Form | Same as CNIC; also check `bform`, `cnic`, `bForm` field aliases | — |
| Phone | Remove non-digits; take last 10–11 digits | `+92-300-1234567` → `3001234567` |
| Name | Trim, collapse whitespace, lowercase | " محمد  علی " → "محمد علی" |
| Father name | Same as name | — |
| Roll | Trim, uppercase | "roll-05" → "ROLL-05" |

---

## Performance

| Scale | Index lookup | Full scan fallback |
|-------|-------------|-------------------|
| 1k | <5ms | <20ms |
| 10k | <10ms | <100ms |
| 50k | <20ms | <800ms |
| 100k | <30ms | Not used (index mandatory) |

Index build: piggyback on existing `repoMirrorPut` — negligible overhead per save.

---

## Permissions

| Action | Who can override hard duplicate |
|--------|-------------------------------|
| View duplicate warning | All staff with `admission:create` |
| Override hard duplicate | Owner only (or `admission:approve1`) |
| Override soft duplicate | Any staff with `admission:create` |
| Audit log on override | Required with reason text |

---

## Test Plan

| Test | Input | Expected |
|------|-------|----------|
| D1 hard block | Same CNIC as STD-01 | Block + show STD-01 |
| D1 edit self | Edit STD-01, same CNIC | Allow (excludeId) |
| D4 soft warn | Same name+fname, different CNIC | Warning, allow continue |
| D6 roll dup | Same rollNo | Soft warning |
| Import cross-check | Import row with existing CNIC | Flag in step 5 |
| Offline | No network | Local index check works |
| Empty CNIC | No CNIC entered | Skip D1, check D4 only |

---

## Implementation Phases

### Phase 1a (Week 1–2)

- [ ] `emsRegCheckDuplicates` with RAM scan (no new index)
- [ ] Hard block UI on save for CNIC/phone
- [ ] Audit log on override
- [ ] Unit tests

### Phase 1b (Week 3)

- [ ] Secondary duplicate index in IDB
- [ ] Real-time CNIC/phone blur check
- [ ] Import cross-check against repo

### Phase 2

- [ ] Fuzzy name matching (D8)
- [ ] AI-assisted duplicate review
- [ ] Merge duplicate tool

---

## Estimated Score Impact

| Dimension | Before | After P3 |
|-----------|--------|----------|
| Security | 58 | 65 |
| User Experience | 62 | 70 |
| Global Readiness | 42 | 50 |

---

*Next step: Implement Phase 1a with RAM scan — no new IDB stores, minimal risk.*
