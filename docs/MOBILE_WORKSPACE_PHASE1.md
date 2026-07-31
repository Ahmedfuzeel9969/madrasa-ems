# Mobile Workspace Optimization — Phase 1

Date: 2026-07-16  
Scope: presentation only (Option A + bottom submodule strip)

## Before / after viewport (estimated, 700px-tall phone content area)

| Chrome | Before | After |
|--------|--------|-------|
| Ribbon strip | ~50px | **0** (hidden) |
| Mobile header | ~60px | **~48–52px** (light) |
| Submodule bar | ~50px top | **~44px bottom** (only if subs) |
| Module reg-topbar | ~40px | **0** (hidden) |
| Bottom nav | ~72px | ~56–64px |
| **Usable content** | **~55–65%** | **~75–80%** (dashboard; ~70–78% with subnav) |

Net gain on registration/attendance forms: roughly **+15–20%** vertical space (ribbon + top subnav + slimmed header/topbar).

## Layout after

```
[ ماڈیول نام                        ⋮ ]   ← light 48–52px
[ …………… Content / forms / tables ……… ]
[ طلباء | اساتذہ | … ]                 ← only if module has subs
[ ہوم | تلاش | شعبہ | اطلاعات | مزید ]
```

## Modules audited (toolbars)

| Module | Action |
|--------|--------|
| All with `.reg-topbar` | Hidden on phone (tabs mirrored in bottom subnav) |
| Dashboard | Compact KPIs; charts stay collapsed; denser cards |
| Registration | Smaller card padding; wider tables; compact search |
| Ribbon | Fully hidden on `html.ems-phone-shell` |

## ⋮ menu contents

Utilities: شعبہ · کلاؤڈ سنک · ترتیبات · سائن آؤٹ  
Then permitted major modules (same RBAC as desktop).

## Files changed

- `ems-mobile-shell.js`
- `index.html`
- `style.css`
- `tests/unit/ems-mobile-nav-v2.test.js`
- `docs/MOBILE_WORKSPACE_PHASE1.md` (this file)

## Business logic

Untouched: Firebase, IndexedDB, sync, repositories, RBAC catalogs, module switchers (still click existing DOM controls).

## Screenshots

Capture on device after APK install (portrait/landscape phone + tablet). Annotate usable height vs chrome.

## Tests

`npm run verify:regression`
