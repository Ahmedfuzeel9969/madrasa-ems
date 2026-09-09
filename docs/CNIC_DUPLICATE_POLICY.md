# CNIC Duplicate Policy (People Phase 4)

**Effective:** 2026-09-09  
**Enforcement:** client gate `ems-registration-duplicates.js` (D1 hard) + owner override

## Rule

One person = one registration identity across the tenant.

| Field | Severity | Scope |
|-------|----------|--------|
| Personal CNIC (13 digits) | **Hard block (D1)** | Cross-type: student ↔ teacher ↔ staff |
| B-Form | Hard (D2) | Same as CNIC |
| Personal phone | Hard (D3) | Cross-type |
| Name + father | Soft warn (D4) | Informational |
| Name + class / roll | Soft (D5–D6) | Informational |

## Cross-type

A student CNIC **blocks** registering the same CNIC as teacher/staff (and vice versa).  
This is intentional: the same national ID must not appear as two people in one madrasa.

Guardian CNIC (`grdCnic`) / guarantor CNIC (`guaCnic`) on a student record also participate in D1 scans when they match a candidate’s personal CNIC — treat carefully when a guardian later joins as staff.

## Override

Only owner/admin (`emsRegCanOverrideHardDuplicate`) may save despite a hard match. Overrides are audited (`duplicate_override`).

## Changing policy later

If the institution needs **same-type-only** CNIC uniqueness (allow one CNIC as student and separately as teacher):

1. In `ems-registration-duplicates.js` → `scanRecord()`, skip when `rec.type !== candidate.type`.
2. Update this doc and add a unit test for cross-type allow.
3. Redeploy hosting.

Until then, keep cross-type hard block.
