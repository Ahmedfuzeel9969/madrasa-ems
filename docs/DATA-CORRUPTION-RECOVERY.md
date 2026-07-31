# Data Corruption Detection & Recovery (Priority 3)

**Status:** Active  
**Module:** `ems-data-corruption.js` (loads before `ems-data-cache.js`)  
**Integration:** `ems-data-cache.js` `parseValue`, `core.js` `getData`

---

## Problem

When localStorage (or large-blob IDB mirror) contains **invalid JSON**, the cache layer previously returned `[]` / `{}` / `null` silently. Users interpreted this as "all records deleted" rather than corrupted storage.

---

## Detection

Corruption is reported when:

1. Raw stored value is **non-empty**, and
2. `JSON.parse` throws.

The system then:

- Registers the key in `emsDataCorruptionList()`
- Returns a **sentinel** (`__emsDataCorrupt: true`) instead of an empty fallback
- Shows **`showTopAlert`** (Urdu warning — not an empty-list state)
- Logs `[EMS:corruption]` to the console

Check programmatically:

```javascript
if (window.emsIsCorruptData(value)) {
  // Do not render as "no records" — corruption UX already shown
}
```

---

## Safe automatic recovery

**Only when safe:** one automatic attempt per corrupt key via IndexedDB KV mirror (`emsIdbKvGet`).

Flow:

1. Corrupt read → `emsDataCorruptionScheduleRecover(key)`
2. `emsDataCorruptionTryRecover(key)` reads IDB mirror
3. If mirror JSON is valid → rewrite local cache via `emsCacheSet`, clear corruption registry, toast success, fire `ems-data-recovered`

If IDB mirror is missing or also invalid → toast warns to use manual recovery (no destructive auto-delete).

---

## Manual recovery options

| Option | When to use |
|--------|-------------|
| **Cloud Sync / Pull** | Online; tenant has cloud data |
| **DR encrypted backup** | `npm run backup:restore` with verified bundle |
| **Quarantine key** | `emsDataCorruptionQuarantineKey(key)` then re-pull module |
| **Registration rebuild** | Registration repo empty due to corrupt legacy blob |

Hints API:

```javascript
window.emsDataCorruptionGetRecoveryHint('ems_full_users');
```

---

## Operator checklist

1. Note the key from the alert (e.g. `ems_full_users`).
2. Wait for automatic IDB recovery toast.
3. If still corrupt: run Cloud Pull for that module or full tenant.
4. If offline-only: restore from latest DR backup.
5. As last resort: quarantine key, pull fresh copy, verify counts in diagnostic panel.

---

## Tests

```bash
npm test -- tests/unit/ems-data-corruption.test.js
```

Proves: corrupt JSON is detected, warning fires, empty fallback is not returned, IDB recovery path works.
