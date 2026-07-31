# E7-S1 Sprint Report — Registration Repository

**Date:** 22 June 2026 · **Cache bust:** `20260621e7s1`

## Changes

| Item | Detail |
|------|--------|
| **Removed** | Full `Registrations` + `Rejected` `onSnapshot` listeners |
| **Added** | `ems-registration-repository.js` — initial 100, Load More, prefix search, single-doc fetch |
| **Added** | `RegistrationMeta/current` single-doc listener for multi-user sync hint |
| **Updated** | `admission.js` — repo integration, async edit, Load More button |
| **Updated** | `finance.js` — `finGetAllUsers` → `emsCacheGet` |
| **Indexes** | `Registrations`: `name`, `type + timestamp` |
| **Docs** | `ENTERPRISE-ARCHITECTURE-DIRECTIVE.md`, `ENTERPRISE-ROADMAP.md` |

## Performance impact (expected)

| Metric | Before | After E7-S1 |
|--------|--------|-------------|
| Registration tab Firestore reads | N (all docs) | **100 initial** + load more |
| Listener docs on edit | N re-download | **0** (meta doc only) |
| Login registration sync | Full collection | **Deferred paginated** |

## Next (E7-S2)

- Finance/attendance paginated student pickers
- Universal `emsCacheGet` migration
- Deploy firestore indexes: `firebase deploy --only firestore:indexes`

## Verify

```bash
npm test
npm run benchmark
```
