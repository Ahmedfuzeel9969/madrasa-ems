# Git introduction proposal (do not initialize yet)

**Status:** Proposal only — **do not run `git init` until explicitly approved.**  
**Context:** Project currently has **no** `.git` directory (confirmed under project root, parent, and `F:\WPS`).  
**Existing:** `.gitignore` already present and useful.

---

## 1. Where to initialize

**Recommended root:**

```text
F:\WPS\stackblitz-starters-nbktzqft (4)\stackblitz-starters-nbktzqft (4)
```

(i.e. the real app root that contains `package.json`, `index.html`, `functions/`).

**Do not** initialize at `F:\WPS` (too broad) or only at the outer `stackblitz-starters-nbktzqft (4)` wrapper unless that wrapper will become the sole project home after a future rename.

**Later (separate approval):** after folder rename to `madrasa-ems`, either:

- move/rename the directory then keep the same `.git`, or  
- init only after the rename if rename happens first.

---

## 2. What to ignore (generated / secrets / noise)

Use and extend the existing `.gitignore`. Keep **out of version control**:

| Path / pattern | Why |
|----------------|-----|
| `node_modules/` | Dependencies — restore via `npm install` |
| `functions/node_modules/` | Same |
| `dist/` | Hosting build output — `npm run build:hosting` |
| `android/` | **Already ignored** in current `.gitignore` — Capacitor/Gradle; regenerate via `android:sync` / Android Studio |
| `.capacitor/` | Capacitor local |
| `desktop/release/` | Electron build output |
| `.firebase/` | CLI cache |
| `.cmi/` | Local CMI index |
| `backups/*` | Local snapshots (keep `backups/.gitkeep` if desired) |
| `test-results/`, `playwright-report/`, `blob-report/` | Test artifacts |
| `*.keystore`, keystore properties | Secrets |
| `.env` | Secrets |
| `logs`, coverage, `.eslintcache` | Tooling noise |

### Recommendation on `android/`

**Keep `android/` out of Git** (current policy), **or** (alternative, larger repo) track only the Capacitor Android **project skeleton** while ignoring `android/**/build/`, `.gradle/`, and `android/app/src/main/assets/public/`.

For migration safety, **current ignore-all-android policy is acceptable** if every machine can recreate the Android wrapper from Capacitor + documented plugins. Document the recreate command: `npm run android:sync`.

### Recommendation on `dist/`

**Always ignore.** Never commit Hosting artifacts.

### Recommendation on sibling backups

`ems-backup-*` folders live **outside** the repo root (parent directory) — good. Do not move them inside the repo without ignoring them.

---

## 3. First commit contents (when approved)

Suggested initial commit after `git init`:

1. All runtime source: root JS/HTML/CSS, `src/`, `cloud/`, `sa/`, `vendor/` (if licensed OK), `scripts/`, `tests/`, `docs/`  
2. `functions/` source (`index.js`, `lib/`, `package.json`) — not `node_modules`  
3. Config: `package.json`, lockfile, `firebase.json`, rules, `capacitor.config.json`, `.gitignore`, `.firebaserc` (if team shares project)  
4. `desktop/` main/preload/native sources — not `release/`  

Then tag:

```text
baseline/phase0-2026-07-18
```

matching `docs/baselines/PHASE0-MIGRATION-BASELINE.md`.

---

## 4. Rollback model after each migration slice

| Layer | Mechanism |
|-------|-----------|
| **Preferred (after Git)** | `git switch -c slice-N` → change → verify → merge; on failure `git restore` / `git switch` back / `git reset --hard baseline/phase0-…` (only on unpushed slice branches) |
| **Tag per slice** | `slice/01-ems-utils`, `slice/02-…` after green gates |
| **Filesystem backup** | Keep `npm run backup` (or `backup:snapshot`) before each slice until Git is trusted |
| **Hash diff** | Re-run `node scripts/phase0-baseline-hashes.js` and diff JSON against previous baseline |

**Never** use destructive Git history rewrite on a shared remote without explicit approval.

---

## 5. Safe init sequence (for future approval — do not run now)

1. Confirm backup `ems-backup-2026-07-17T20-26-59` (or newer) exists.  
2. Review `.gitignore` (android/dist/node_modules).  
3. `git init` in app root.  
4. `git add -A` then review `git status` for accidental secrets/APK/dist.  
5. First commit + tag `baseline/phase0-2026-07-18`.  
6. Optional: add remote later; no force-push rules needed until remote exists.

---

## 6. Explicit non-actions

- **Git is not initialized by this document.**  
- No remotes, commits, or tags created here.  
- No folder rename, no `functions/lib` rename, no further file migration.

Await approval before any `git init` or Phase 1 continuation.
