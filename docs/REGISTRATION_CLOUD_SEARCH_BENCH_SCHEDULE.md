# Registration Cloud Search Benchmark — Schedule & Runbook

**Sprint:** 2 follow-up  
**Date:** 9 July 2026  
**Status:** ⏳ Scheduled (requires live credentials)

---

## Why Scheduled

Cloud search latency depends on:

- Firebase authenticated session (`firebase.auth().currentUser`)
- Tenant ID with indexed registration data (10k–100k records)
- Network RTT to Cloud Functions / Typesense
- `searchTenantRegistrations` CF deployment

The Vitest suite validates **code wiring only**. Real cloud timing must be measured in a logged-in browser.

---

## Prerequisites

1. EMS hosted or `npm run dev` with Firebase config
2. Gmail login completed (tenant session active)
3. Registration repository hydrated (Admission list shows records)
4. `navigator.onLine === true`
5. Cloud stack loaded (`cloud/ems-enterprise-search.js` via lazy admission load)

---

## Quick Run (Recommended)

1. Login to EMS
2. Open **Admission** tab (loads enterprise search)
3. Open browser DevTools → Console
4. Load harness (if not bundled):

```javascript
var s = document.createElement('script');
s.src = 'bench/reg-cloud-search-bench.js?v=' + Date.now();
document.head.appendChild(s);
```

5. Run benchmark:

```javascript
emsRegCloudSearchBench().then(function (r) {
  console.table(r.queries);
  if (r.cacheRepeat) console.log('Cache repeat:', r.cacheRepeat);
  console.log(JSON.stringify(r, null, 2));
});
```

6. Save results:

```javascript
emsRegCloudSearchBench({ queries: [
  { label: 'exact-id', q: 'STD-000042' },
  { label: 'broad', q: 'محمد' },
  { label: 'phone', q: '0300' }
]}).then(emsRegCloudSearchBenchDownload);
```

Copy output to `docs/reg-cloud-search-bench-live.json` when complete.

---

## Alternative: Bench HTML Page

Navigate to `/bench/reg-cloud-search-bench.html` **on the same origin** after login.

Note: standalone page does not auto-load Firebase/router — use main app console method for accurate results.

---

## Query Matrix

| Label | Example query | Expected (online @ 100k) |
|-------|---------------|---------------------------|
| exact-id | `STD-000042` | <50ms (`id-direct`) |
| narrow-prefix | `STD-00` | <200ms |
| broad-name | `طالب` / `محمد` | **<500ms** (cloud CF) |
| phone-prefix | `0300` | <800ms |
| cnic-prefix | `35202` | <800ms |
| cache-repeat | Same query twice | <5ms (2nd run) |

---

## Compare Against Local Baseline

From `docs/idb-browser-bench.json`:

| Scale | Local search (offline path) |
|-------|----------------------------|
| 10k | 291ms |
| 50k | 1.4s |
| 100k | **4.4s** |

Sprint 2 goal: online cloud path **<500ms** for broad queries @ 100k.

---

## Flags That Affect Results

| Flag | Effect |
|------|--------|
| `EMS_REG_FORCE_LOCAL_SEARCH=true` | Forces local path — do not use for cloud bench |
| `EMS_OFFLINE_ONLY=true` | Skips cloud |
| `navigator.onLine=false` | Local fallback only |

---

## When Complete

Update `docs/REGISTRATION_SEARCH_BENCHMARK_REPORT.md` with a **Live Cloud Results** section and attach `docs/reg-cloud-search-bench-live.json`.

Until then, projected cloud gains (300–800ms) remain valid based on CF architecture.
