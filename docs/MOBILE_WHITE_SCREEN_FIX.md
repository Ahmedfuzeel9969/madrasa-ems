# Mobile requests review + white-screen fix

## Prior mobile asks (this arc) → status

| # | Request | Status |
|---|---------|--------|
| 1 | All major modules via ⋮ / More (not only ~4) | Done |
| 2 | Contextual submodule strip from live tabs | Done (after getComputedStyle bug fix) |
| 3 | Maximize workspace; hide desktop ribbon on phone | Done |
| 4 | Remove top ⋮ duplicate; single More entry | Done |
| 5 | Slim bottom bar (no Search/Dept/Alerts permanent) | Done |
| 6 | Remove Home button | Done |
| 7 | Remove top module-title header; free top for content | Done |
| 8 | Fill bottom strip with submodule buttons + horizontal scroll | Done |
| 9 | Regression gate + APK SHA after green tests | Done (then white screen reported) |
| 10 | **White screen after install/open** | **Root cause fixed (this pass)** |

## White screen — root cause

Boot sequence could dismiss `#ems-boot-splash` while:

1. `body.ems-locked` still hid `.ems-app-shell`, and  
2. `html.ems-offline-no-signin` hid `#ems-landing` with `display: none !important`.

`emsShowLanding()` set `style.display = 'flex'`, which **loses to `!important`**, so nothing painted → light `body` background = white screen (common on returning native / failed instant boot).

## Fix (presentation/boot UI only)

- `portal-access.js`: clear `ems-offline-no-signin` before showing landing  
- `ems-boot-gate.js`: keep splash until UI ready; `emsRecoverBlankBootUi()` safety net  
- `index.html`: cache-bust + 12s recovery call  

Business/Firebase/RBAC/repos unchanged.
