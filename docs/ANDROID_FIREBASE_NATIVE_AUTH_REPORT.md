# Android Firebase + Native Google Sign-In — Implementation Report

**Date:** 2026-07-15  
**Project:** `madrasa-mangment-app`  
**Status:** Stage 1 COMPLETE · Stage 2 CODE+APK READY · **Device login tests PENDING (not marked complete)**

---

## Stage 1 — Firebase Android registration

| Item | Value |
|------|--------|
| Firebase Android App ID | `1:529775229216:android:24a56f05883932b0e3ff45` |
| Package name | `com.madrasa.ems` |
| applicationId (Gradle) | `com.madrasa.ems` |
| Capacitor `appId` | `com.madrasa.ems` |
| google-services.json | `android/app/google-services.json` |
| project_id in JSON | `madrasa-mangment-app` |
| mobilesdk_app_id | `1:529775229216:android:24a56f05883932b0e3ff45` |
| Apps list | WEB + ANDROID (2 apps) |

### Debug SHA fingerprints registered

| Type | Value |
|------|--------|
| SHA-1 | `5A:B5:7B:AF:A2:1C:37:C3:8F:DA:B5:0C:F5:FA:65:26:CC:0C:3C:42` |
| SHA-256 | `8E:61:1E:6A:70:7B:43:6B:36:11:C4:92:0F:17:D1:99:E4:35:12:C7:BE:A6:7A:51:3E:DE:AE:09:27:57:AD:34` |
| Source | `%USERPROFILE%\.android\debug.keystore` · alias `androiddebugkey` |

### Release SHA fingerprints

**Not registered.** Document separately when a release keystore exists:

```powershell
keytool -list -v -keystore <release.keystore> -alias <alias>
```

Add those SHA-1 / SHA-256 in Firebase Console → Android app → Add fingerprint before shipping signed/release APK.

### Gradle Google Services plugin

| File | Status |
|------|--------|
| `android/build.gradle` | classpath `com.google.gms:google-services:4.4.2` |
| `android/app/build.gradle` | **Hard fail** if `google-services.json` missing; **always** `apply plugin: 'com.google.gms.google-services'` |
| Build evidence | `:app:processDebugGoogleServices` executed |

Also: `resolutionStrategy.force 'androidx.browser:browser:1.8.0'` for Capgo plugin vs AGP 8.7.2 / compileSdk 35.

---

## Stage 2 — Authentication method

| Platform | Method |
|----------|--------|
| Web / mobile browser | Existing Firebase Web Auth (`signInWithPopup` / `signInWithRedirect`) |
| Android Capacitor APK | **Native** `@capgo/capacitor-social-login` → Google ID token → `GoogleAuthProvider.credential` → `signInWithCredential` |

New files / wiring:

- `ems-native-google-auth.js` — platform gate + native login
- `auth.js` — Android path bypasses redirect; uses native flow
- `capacitor.config.json` — SocialLogin google-only providers
- `index.html` — loads native helper before `auth.js`

Web client ID (ID token audience):

`529775229216-h0pmuqqvrhendoa3n71ong4upmiqa3ad.apps.googleusercontent.com`

(client_type 3 from `google-services.json`)

Post-login tenant resolution is unchanged: existing `onAuthStateChanged` → `listenMadrasaProfile` / `madrasaMembers` → tenant DB (`JamiaSystemDB_{madrasaId}`) via current auth pipeline.

---

## New debug APK

| Field | Value |
|-------|--------|
| Path | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Full path | `F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)\android\app\build\outputs\apk\debug\app-debug.apk` |
| Build | `assembleDebug` SUCCESS (includes SocialLogin + Google Services) |
| SHA-256 | `8F42EE5338FDFFE7930625D2A737E9243407A22BC8479E47EB9441530E06E540` |
| Size | ~10.4 MB |

---

## Required device tests (NOT YET RUN)

Do **not** mark Android Firebase complete until all pass:

1. Install rebuilt APK  
2. Open Google account chooser  
3. Sign in with Gmail A  
4. Confirm Firebase UID/email (`auth.currentUser`)  
5. Confirm correct `madrasaId`  
6. Cloud Pull  
7. Create local record + Cloud Push  
8. Close / reopen APK — session + data persist  
9. Switch to Gmail B — institution/DB switches  

### Capture when testing

```powershell
adb logcat -s chromium:V Capacitor:V CapacitorPlugins:V | findstr /i "EMS auth Firebase SocialLogin Google"
```

Record: exact login result · logcat errors · UID/email · madrasaId · Pull result · Push result.

---

## Login-fail checklist (if device fails)

| Question | Current known answer |
|----------|----------------------|
| google-services.json missing? | **No** (present) |
| SHA-1 missing? | **No** (debug SHA registered) |
| Package mismatch? | **No** (`com.madrasa.ems` everywhere) |
| Exact error / logcat / UID? | **Pending device run** |

---

*End of report — device verification required for completion.*
