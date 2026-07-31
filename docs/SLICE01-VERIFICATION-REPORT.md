# Slice #1 verification report — `ems-utils.js`

**Date:** 2026-07-18  
**Scope:** Already-implemented utility migration only  
**Verifier script:** `scripts/verify-slice01-ems-utils.js` (exit 0 — all checks passed)  
**No further migration performed in this freeze.**

---

## Layout under test

| Path | Role | SHA-256 |
|------|------|---------|
| `src/shared/utils/ems-utils.js` | Canonical implementation (original UMD body) | `2C0C1AB524417FE62581222DD414E60D443FA1EA1F85AFDAF47A01A7284999B7` |
| `ems-utils.js` (root) | Compatibility wrapper only | `0A979BB258E1C8949F5336F54F0D657F9FFDDFEF0C90F0BD0DEDD462BE973A08` |

`index.html` still loads: `ems-utils.js?v=20260620p5` (unchanged path).

---

## 1. Behavioral identity vs original implementation

The canonical file **is** the pre-migration implementation body (UMD factory + `printDiv` installer). The root file no longer contains that body.

| Check | Result |
|-------|--------|
| Canonical contains `sanitize` / conflict / hash / stamp logic | **Yes** |
| Wrapper contains duplicate function bodies | **No** (grep: no `function sanitize`, no `stampCloudVersion` impl) |
| Node `require('./ems-utils.js')` === `require('./src/shared/utils/ems-utils.js')` | **Yes** (same `module.exports` object / same function refs) |
| Pure API outputs match for wrapper vs canonical | **Yes** (all cases below) |

**Conclusion:** Runtime logic is single-sourced in `src/shared/utils/ems-utils.js`. Behavior of exported APIs matches the original implementation.

---

## 2. Exported API compatibility matrix

`EmsUtils` exports (module + `globalThis.EmsUtils`):

| Export | Type | Wrapper forwards? | Parity test | Notes |
|--------|------|-------------------|-------------|-------|
| `sanitize` | function | **Yes** | PASS | HTML escape; `null`/`undefined` → `''` |
| `escAttr` | function | **Yes** | PASS | Delegates to `sanitize` |
| `saEmailDocKey` | function | **Yes** | PASS | Email → SuperAdmin doc key |
| `resolvePullConflict` | function | **Yes** | PASS | 5 conflict cases identical JSON |
| `simpleHash` | function | **Yes** | PASS | djb2-style hex string |
| `stampCloudVersion` | function | **Yes** | PASS | Increments `_version`, sets `clientUpdatedAt` |

### Side-effect global (not on `module.exports`)

| Global | Installed by | Wrapper forwards? |
|--------|--------------|-------------------|
| `printDiv` | Canonical second IIFE (idempotent if already defined) | **Yes** (browser: full file eval; Node: runs on require of canonical) |

No other exports were present on the original module object.

---

## 3. Runtime behavior change assessment

| Concern | Finding |
|---------|---------|
| Auth / boot / IDB / Firebase / sync | **Untouched** |
| `index.html` script URL | **Unchanged** (still root `ems-utils.js`) |
| Hosting / Android resolution of canonical | Requires `src/` in `dist/` — `prepare-hosting.js` copies `src/` |
| Browser load mechanism | Sync XHR + `eval` of canonical (preserves defer order) |
| API surface | **Identical** six functions + `printDiv` |

**Residual risk (not a logic change):** browser path depends on relative URL `src/shared/utils/ems-utils.js` being reachable (true in `dist/` and Capacitor assets after hosting build/sync). Node/Vitest use `require` and do not use XHR.

---

## 4. Duplicate logic / dead code

| Question | Answer |
|----------|--------|
| Duplicate implementation in root + src? | **No** — root is loader/re-export only |
| Dead code introduced? | **No** — wrapper lines are required for Node + browser forwarding |
| Orphan unused exports? | **No** |

---

## 5. Automated verification log

```text
scripts/verify-slice01-ems-utils.js → passed: true, failedCount: 0
checks: export_key_parity, sanitize, escAttr, saEmailDocKey, simpleHash,
        resolvePullConflict, stampCloudVersion, same_function_identity_via_wrapper_require,
        wrapper_has_no_duplicate_impl, globalThis_EmsUtils_after_canonical
```

Also re-run during baseline window:

- `npm run verify:regression` → **25/25 PASS**
- `npm run build:hosting` → **OK** (198 files, `src/` included)

---

## 6. Verdict

| Criterion | Status |
|-----------|--------|
| Canonical identical in behavior to original utils | **PASS** |
| Wrapper forwards every exported API | **PASS** |
| No intentional runtime behavior change | **PASS** |
| No duplicate logic | **PASS** |
| No dead code | **PASS** |

**Slice #1 is verified acceptable to freeze as the migration baseline.**

Rollback (if ever required): replace root `ems-utils.js` with the full contents of `src/shared/utils/ems-utils.js`, then optionally remove the `src/` copy after confirming loaders.
