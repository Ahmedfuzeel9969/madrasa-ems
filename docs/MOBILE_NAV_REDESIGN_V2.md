# Mobile Module Navigation Redesign v2

Date: 2026-07-16  
Scope: mobile presentation shell only (no Firebase / sync / RBAC catalog / module business logic changes).

## Root cause (why only ~4 modules were visible)

Phase 2 bottom navigation hard-coded five slots:

`ہوم · رجسٹریشن · حاضری · فیس · مزید`

and hid the desktop `.ribbon-tabs` on phone (`html.ems-phone-shell`). Remaining modules lived only inside a secondary full-width “More” sheet fed by a second hardcoded `MORE_TABS` list — easy to miss, not the primary chrome, and not derived from the live ribbon/RBAC registry. Result: most permitted majors felt inaccessible on Android.

## Architecture (SSOT)

```
Ribbon DOM + sysLayoutGetConfig().ribbon.order
  → isModuleTabAllowed / tab.style.display
  → emsMobileListPermittedModules()
  → ⋮ compact popover (+ bottom “مزید”)
  → navigateToModule / tab click
  → sysLayoutGetModuleMenus() → .reg-tab buttons
  → contextual #ems-mobile-subnav
```

## Major-module inventory

| Module id | Label | Status | Submodules source |
|-----------|--------|--------|-------------------|
| dashboard | ڈیش بورڈ / مرکزی صفحہ | working | none (home KPIs) |
| admission | رجسٹریشن | working | `#reg-ribbon-menu` |
| attendance | حاضری | working | `#att-ribbon-menu` |
| curriculum | نصاب | working | `#cur-ribbon-menu` |
| training | تربیت و نظم | working | `#tar-ribbon-menu` |
| complaints | شکایات | working | `#cmp-ribbon-menu` |
| exams | امتحانات | working | `#exam-ribbon-menu` |
| finance | فیس سسٹم | working | `#fin-ribbon-menu` |
| ledger | مالیات و تنخواہ | working | `#ldg-ribbon-menu` |
| announcements | اعلانات و فیصلے | working | `#ann-ribbon-menu` |
| ai-studio | AI تجزیات | partial | none (badge جزوی) |
| sys-settings | سسٹم سیٹنگز | working | `#sys-ribbon-menu` |
| admin-panel | ایڈمن پینل | working | role-gated |
| parent-portal | والدین پورٹل | working | role-gated |
| guest-demo | ڈیمو | partial | guest-only |
| superadmin | سپر ایڈمن | working | SA-only |

Unavailable/placeholder entries are omitted from the menu. Partial modules appear with a `جزوی` badge when permitted.

## Role visibility matrix (same rules as desktop)

| Role | Typical majors shown |
|------|----------------------|
| Owner / admin | All unlocked institution modules + admin-panel when `isMadrasaAdmin` |
| Staff / teacher | Modules allowed by `emsCheckFullModuleAccess` / staff perms — never admin-panel / superadmin / parent-portal |
| Parent | parent-portal (+ parent allow-list) |
| Guest | guest-demo only (when enabled) |
| Super admin | + superadmin |

Mobile does **not** re-implement RBAC; it filters with `isModuleTabAllowed` and `tab.style.display !== 'none'`.

## Files changed

- `ems-mobile-shell.js` — rewrite (⋮ menu, subnav, persistence, bottom nav)
- `index.html` — mobile header, subnav, compact menu, bottom nav slots
- `style.css` — header / popover / subnav styles; removed full-sheet More UI
- `sys-layout-builder.js` — export `sysLayoutGetModuleMenus` / `sysLayoutGetRibbonLabels`
- `tests/unit/ems-mobile-nav-v2.test.js` — dedicated tests
- `package.json` — `verify:regression` script

## Persistence

Key: `ems_mobile_nav_v1:{authUid}:{madrasaId}`  
Stores last major tab + submodule panel. Foreign keys cleared on restore after account/tenant switch.

## Tests

```bash
npm run verify:regression
```

Result (2026-07-16): **21 passed** (mobile-nav-v2 + registration-mobile-s6 + p6-rbac-edge).

## Screenshots

Real-device APK screenshots require a connected phone after install. Capture checklist:

1. Header showing current module + ⋮  
2. Compact ⋮ popover (~240–320px) listing all permitted majors  
3. Admission selected → submodule chips (طلباء / اساتذہ / …)  
4. Switch to Attendance → previous sub-bar replaced  
5. Bottom: ہوم / تلاش / شعبہ / اطلاعات / مزید  

## Business logic confirmation

No changes to Firebase Auth, Cloud Pull/Push, IndexedDB, sync queue, registration/attendance repositories, or RBAC permission catalogs. Desktop ribbon markup and click handlers unchanged; mobile only mirrors them.

## APK

See build output path and SHA-256 in the completion message after `npm run android:build:debug`.
