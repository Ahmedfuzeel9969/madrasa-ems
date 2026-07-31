# E9-S2 Sprint Report — Enterprise Registration Search

**Date:** 22 June 2026 · **Cache bust:** `20260621e9s2`

## Changes

| Item | Detail |
|------|--------|
| **Cloud Function** | `searchTenantRegistrations` — multi-field Firestore search (name, id, cnic, phone) |
| **Index sync** | `onRegistrationSearchIndexWrite` → `RegistrationSearchIndex/{id}` |
| **Typesense** | Optional when `TYPESENSE_HOST` + `TYPESENSE_API_KEY` configured |
| **Client** | `ems-enterprise-search.js` — callable first, client Firestore fallback |
| **Updated** | `admission.js` `regListSearch` — UI unchanged |
| **Indexes** | `Registrations`: name, cnic, phone prefix fields |

## Optional Typesense setup

```bash
firebase functions:config:set search.typesense_host="https://YOUR_CLUSTER" search.typesense_key="YOUR_KEY"
firebase deploy --only functions:searchTenantRegistrations,functions:onRegistrationSearchIndexWrite
```

## Verify

```bash
npm test
firebase deploy --only firestore:indexes
```

Hard refresh: **Ctrl+Shift+R**
