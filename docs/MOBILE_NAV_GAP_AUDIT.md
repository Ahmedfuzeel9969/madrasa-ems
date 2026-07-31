# Mobile Nav Gap Audit — MS Word Architecture

Date: 2026-07-17  
Scope: presentation-only (no Firebase / RBAC / controllers / desktop ribbon logic)

## Verdict

Mobile layout shell is partially in place, but the **contextual submodule strip does not appear** for Registration, Attendance, Complaints, and other modules that use `.reg-topbar`. That breaks the core MS Word mobile model (Content → Submodule Strip → Bottom More).

---

## 1. Why submodule strip is invisible (root cause)

**Intended flow**

```
MODULE_MENUS (#reg-ribbon-menu, #att-ribbon-menu, #cmp-ribbon-menu, …)
  → listSubmodules() reads button.reg-tab
  → #ems-mobile-subnav chips
```

**What actually happens on phone**

1. Phase 1 CSS hides the in-module topbar:
   `html.ems-phone-shell .module-view .reg-topbar { display: none !important; }`
2. All live submodule buttons live **inside** that topbar (e.g. `#reg-ribbon-menu` inside `.reg-topbar`).
3. `listSubmodules()` skips any button where `getComputedStyle(btn).display === 'none'`.
4. With a hidden ancestor, **every** tab reports `display: none`.
5. `subs.length === 0` → strip stays `hidden` and `ems-mobile-has-subnav` is removed.

So the strip is not “missing from HTML” — it is **built empty by a filter bug**.

| Module | Menu selector | Tabs exist in DOM? | Strip on phone today |
|--------|---------------|--------------------|----------------------|
| Dashboard | (none) | — | Hidden (correct) |
| Registration | `#reg-ribbon-menu` | Yes | **Hidden (bug)** |
| Attendance | `#att-ribbon-menu` | Yes | **Hidden (bug)** |
| Complaints | `#cmp-ribbon-menu` | Yes | **Hidden (bug)** |
| Exams / Curriculum / Training / Finance / Ledger / Announcements / Settings | matching `*-ribbon-menu` | Yes | **Hidden (bug)** |
| Super Admin | `#sa-ribbon-menu` | Yes | **Not in MODULE_MENUS** → also empty |
| Admin / Parent / AI | no menu in MODULE_MENUS | — | Hidden (may be OK if no subs) |

---

## 2. Top “line” wasting app space

| Layer | What it is | Issue |
|-------|------------|--------|
| `#ems-mobile-app-header` | Required title `[Current Module]` 48–52px | Spec-required; keep |
| `padding-top: env(safe-area-inset-top)` on that header | Extra inset | With StatusBar `overlay: false`, this can add a **blank band** above the title |
| `.ribbon-wrapper` | Desktop major ribbon | Hidden only when `html.ems-phone-shell` + ≤768px; if class late/missing, ribbon still eats top |
| `#ems-mobile-home` hero | Second title block on Dashboard | Duplicates branding under the module title → feels like another busy top line |

User request: free the unnecessary top occupation for main app content → remove extra safe-area padding / duplicate hero chrome; keep single compact module title.

---

## 3. Spec checklist (where work is incomplete)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Different desktop vs mobile layouts | Partial (mobile shell exists; strip broken) |
| 2 | All major modules via More, not permanent buttons | Done |
| 3 | Single More entry; no top ⋮ | Done |
| 4 | More → module → build strip | **Broken** (strip empty) |
| 5 | Header = module title only, 48–52px | Partial (extra safe-area / duplicate home hero) |
| 6 | Contextual strip from live tabs | **Broken** (computed-style filter) |
| 7 | Horizontal scroll CSS | Done in CSS (unused until strip has items) |
| 8 | Strip above bottom nav | Done (positioning) |
| 9 | Bottom = Home + More; Search/Dept/Alerts in More | Done |
| 10 | State by uid + madrasaId | Done |
| 11 | Registry → RBAC → More → strip | Architecture OK; strip step fails |
| 12 | No business-logic edits | Observed |
| 13 | Validation / screenshots | Strip fail blocks validation; screenshots still pending |

---

## 4. Fix plan (presentation only)

1. **`listSubmodules`**: stop filtering with `getComputedStyle` for phone-hidden ancestors; honor only the button’s own `style.display` / `hidden`.
2. **Optional**: register `superadmin: '#sa-ribbon-menu'` in `MODULE_MENUS` (layout SSOT, not business logic).
3. **Top space**: drop redundant `safe-area-inset-top` on mobile header when native StatusBar does not overlay WebView; slim/hide duplicate dashboard home hero under the title.
4. Re-run regression + rebuild APK.

---

## Confirmation

Business workflows, Firebase, IndexedDB, Sync, Repositories, RBAC, module controllers, and desktop ribbon **behavior** remain untouched. Gap is mobile presentation wiring only.
