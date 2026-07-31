# Mobile MS Word Navigation Architecture

Presentation-only redesign. Desktop ribbon, Firebase, IndexedDB, Sync, Repositories, RBAC, and module controllers are untouched.

## Before → After (mobile)

```
BEFORE (phone)
┌──────────────────────────────┐
│ Ribbon (desktop clone)       │
│ Submodule ribbon             │
│ [⋮] + title / duplicate menus│
├──────────────────────────────┤
│ Content (squeezed)           │
├──────────────────────────────┤
│ Home Search Dept Alerts More │
└──────────────────────────────┘

AFTER (phone)
┌──────────────────────────────┐
│ [ Current Module Name ]      │  ← 48–52px title only
├──────────────────────────────┤
│ Content (maximized)          │
├──────────────────────────────┤
│ Students | Teachers | … →    │  ← scrollable submodule strip
├──────────────────────────────┤
│      [ Home ]   [ More ]     │  ← only two permanent actions
└──────────────────────────────┘
```

Desktop remains: Major Ribbon → Submodule Ribbon → Content.

## Flow

```
Module Registry (DOM ribbon + MODULE_MENUS)
        ↓
RBAC Filter (isModuleTabAllowed)
        ↓
Bottom More menu (single entry)
        ↓
Selected major module
        ↓
Submodule Registry (live .reg-tab buttons)
        ↓
Scrollable submodule strip
        ↓
Module content
```

## Rules enforced

| Rule | Status |
|------|--------|
| Different desktop vs mobile layouts | Yes |
| All major modules via More only | Yes |
| No top ⋮ / duplicate menus | Yes |
| Header = current module title | Yes |
| Submodule strip from live tabs | Yes |
| Strip hidden when no submodules (e.g. Dashboard) | Yes |
| Strip above bottom nav | Yes |
| Bottom nav Home + More only | Yes |
| Search / Dept / Alerts inside More | Yes |
| Nav state scoped to uid + madrasaId | Yes |

## Files touched (presentation)

- `index.html` — header, subnav, bottom nav markup
- `ems-mobile-shell.js` — menu / strip / state
- `style.css` — phone shell layout
- `tests/unit/ems-mobile-nav-v2.test.js`
- this doc

## Not modified

Firebase, IndexedDB, Sync, Repositories, RBAC, module controllers, business workflows, desktop ribbon.

## APK (debug) — post subnav-fix gate

- Path: `android/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256: `B874E86D3879376981BE16EE40D7A76D1868C412EA94F6561480F477610436B8`
- Regression: `verify:regression` → **25/25 PASS** (includes previously failing subnav mock test)
- Source ↔ asset parity: `ems-mobile-shell.js` SHA-256 matched in repo and `android/.../assets/public/`
- Prior APK `C6F459E0…` is **not** accepted as final (stale/partial package risk)
- Screenshots: pending until a device/emulator is attached (`adb devices`)
