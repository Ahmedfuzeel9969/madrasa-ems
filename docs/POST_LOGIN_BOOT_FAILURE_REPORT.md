# Post-Login Boot Failure Report

Date: 2026-07-17  
Platform: Android Capacitor (`com.madrasa.ems`)

## Exact failing stage

**Stage:** `waitForDb` immediately after native Google → Firebase `signInWithCredential` succeeded.

**Chain where it stopped:**

1. Native Google Sign-In — OK  
2. Firebase `signInWithCredential` — OK (`auth.currentUser` present)  
3. Toast “گوگل لاگ ان کامیاب” — shown **too early**  
4. `emsFinalizeNativeInstantBootMode()` — set `EMS_OFFLINE_ONLY = true` **too early**  
5. `emsDismissLoginUi()` — hid landing **without** unlocking `.ems-app-shell`  
6. `listenMadrasaProfile` → offline session missing → `waitForDb`  
7. `waitForDb` saw `EMS_OFFLINE_ONLY` → called `onFailure` immediately  
8. Failure toast: “ڈیٹا بیس سے رابطہ نہیں… پہلے آن لائن لاگ اِن کریں”  
9. Landing hidden + shell still `display:none` → **white screen**

## Root cause

In `auth.js` → `emsRunGoogleSignIn` (native path), after Firebase credential success the code called:

- `emsFinalizeNativeInstantBootMode()` which forces `EMS_OFFLINE_ONLY = true`
- then `listenMadrasaProfile(user)`
- then `emsDismissLoginUi()` (hides login, does **not** call `setAppShellVisible(true)`)
- then success toast

`waitForDb()` short-circuits when `emsIsOfflineOnly()` is true and invokes the failure callback. Fresh first login has no offline session, so both cloud wait and offline boot fail → blank UI.

## Contradictory toasts

| Message | File | Function | Condition |
|---------|------|----------|-----------|
| `✅ گوگل لاگ ان کامیاب!` | `auth.js` | `emsRunGoogleSignIn` | Shown right after native plugin/Firebase credential, **before** membership/DB |
| `ڈیٹا بیس سے رابطہ نہیں… پہلے آن لائن لاگ اِن کریں` | `auth.js` | `listenMadrasaProfile` → `waitForDb` onFailure | `EMS_OFFLINE_ONLY` or no Firestore + offline boot failed |

Auth source mismatch: success used credential `cred.user`; failure path treated app as offline-only even though Firebase user existed.

## Fix applied

1. Do **not** call `emsFinalizeNativeInstantBootMode()` until `unlockAppScreen()` (after madrasaId + local/cloud boot).  
2. Keep `EMS_OFFLINE_ONLY = false` during post-login membership resolve.  
3. Do **not** dismiss landing / claim success until unlock.  
4. Confirm `firebase.auth().currentUser` + `getIdToken()` before continuing.  
5. Red recovery panel + diagnostics JSON + 30s watchdog.  
6. `waitForDb` no longer short-circuits when a pending native Google Firebase user is live.

## Files changed

- `auth.js`
- `ems-native-app-boot.js` (comment / contract clarification)
- `index.html` (cache bust)
- this report

## Real-device validation

Pending on device after installing the new APK:

1. Admin portal → Google → account  
2. Expect: “Firebase تصدیق… ادارہ لوڈ” then dashboard (not immediate “کامیاب” + “آن لائن پہلے”)  
3. Confirm UID / madrasaId in diagnostics if failure panel appears  
4. Offline reopen after one successful online unlock  

## APK

- Path: `android/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256: `97D7AF37172F36905DDAB9F5912E8F12909C66C8377C546B4F57BACC8801B73A`
- Regression (nav): 25/25 PASS
- Note: Completion on-device requires dashboard after login + offline reopen; this build fixes the identified boot-chain bug.