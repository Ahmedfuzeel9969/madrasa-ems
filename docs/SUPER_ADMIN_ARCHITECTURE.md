# Super Admin Platform — Enterprise Architecture & 20-Phase Roadmap

> تمام communication اردو میں۔ Source code انگریزی (بین الاقوامی معیار)۔
> یہ دستاویز معماری (architecture) اور مرحلہ وار roadmap کی single source of truth ہے۔

---

## 1. Design Principles (بنیادی اصول)

1. **Security-first** — ہر sensitive action server-side (Cloud Functions) پر validate ہوتا ہے۔ Client کبھی براہِ راست privilege نہیں بڑھا سکتا۔
2. **Scalable** — paginated queries، pre-aggregated stats، اور server-side batch processing۔ Target: 1,000,000+ users۔
3. **Modular** — ہر section کی الگ فائل۔ کوئی monolithic file نہیں۔
4. **Multi-tenant** — مرکزی `Platform_Users` registry؛ ہر user ایک یا زیادہ tenants (مدارس/ادارے) کا رکن ہو سکتا ہے۔
5. **Auditable** — ہر اہم عمل immutable audit log میں۔ Logs کبھی edit/delete نہیں ہوتے۔
6. **Provider-agnostic payments** — Stripe + Manual + مستقبل کے providers ایک abstraction کے پیچھے۔
7. **Maintainable** — shared RBAC config client اور functions دونوں استعمال کرتے ہیں۔

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Super Admin SPA (Frontend)               │
│  sa/sa-core.js (router)                                   │
│  sa/rbac-config.js (shared roles + permissions)           │
│  sa/sa-api.js (callable wrapper + graceful fallback)      │
│  sa/platform-users.js (Platform_Users helper)             │
│  sa/sa-*.js (15 section modules)                          │
└───────────────┬──────────────────────────────────────────┘
                │ HTTPS Callable / onSnapshot
┌───────────────▼──────────────────────────────────────────┐
│            Firebase Cloud Functions (Admin API)           │
│  functions/lib/rbac.js      → custom claims, role sync    │
│  functions/lib/users.js     → lifecycle, status, bulk     │
│  functions/lib/logger.js    → immutable audit + errors    │
│  functions/lib/payments.js  → provider abstraction        │
│  functions/lib/security.js  → sessions, force logout      │
│  functions/lib/stats.js     → scheduled aggregation       │
└───────────────┬──────────────────────────────────────────┘
                │ Admin SDK
┌───────────────▼──────────────────────────────────────────┐
│                     Firebase Backend                      │
│  Auth (Custom Claims)  Firestore  Storage  (BigQuery →)   │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Firestore Data Model

```
Platform_Users/{uid}
  uid, fullName, email, phone, photoURL, provider
  createdAt, lastLoginAt, accountStatus (active|inactive|suspended|banned)
  globalRoles: [roleId]            // platform-level roles
  tenants: { <tenantId>: { role, joinedAt, status } }   // multi-tenant
  subscriptionRef, flags
  /loginHistory/{eventId}          // CF write
  /devices/{deviceId}              // CF write
  /sessions/{sessionId}

Platform_Roles/{roleId}
  name, nameUr, description, level, permissions:[permId], isSystem

Platform_AuditLog/{logId}          // CF write ONLY (immutable)
Platform_SecurityEvents/{eventId}  // CF write ONLY
Platform_Subscriptions/{uid}       // SaaS engine
Platform_Payments/{paymentId}      // transactions
Platform_Invoices/{invoiceId}
Platform_Config/system             // site/branding/api settings
Platform_Stats/current             // live aggregated KPIs
Platform_Stats/daily_{YYYY-MM-DD}  // historical snapshots
Platform_Notifications/{id}
Platform_Backups/{backupId}
Platform_Licenses/{licenseId}

-- موجودہ (برقرار + linked) --
All_Madrasas/{uid}    → tenant profile (Platform_Users سے linked)
SuperAdmins/{uid}     → bootstrap platform admins
System_Settings/*     → legacy global toggles (migrate تدریجاً)
```

---

## 4. RBAC Model

- **Roles** (8 default): `super_admin`, `admin`, `manager`, `moderator`, `editor`, `teacher`, `student`, `accountant`
- **Permissions** granular: `resource.action` (مثلاً `users.suspend`, `payments.refund`)
- **Custom Claims**: user کے roles + اہم permissions Auth token میں sync ہوتے ہیں → Firestore rules تیز و محفوظ۔
- **Source of truth**: `sa/rbac-config.js` (client) == `functions/lib/rbac-config.js` (server)۔ دونوں ایک جیسے رہیں۔

---

## 5. Payment Abstraction

```
PaymentProvider (interface)
  ├── StripeProvider    (online, webhook-driven)
  └── ManualProvider    (bank transfer / cash, admin approval)
```
نیا provider شامل کرنے کے لیے صرف ایک نیا class + register کریں۔ Core logic تبدیل نہیں ہوتی۔

---

## 6. 20-Phase Roadmap

| Phase | عنوان | دائرہ کار | حالت |
|------|-------|-----------|------|
| **0** | Foundation | Cloud Functions scaffold، RBAC config، audit logger، Platform_Users، rules v2، API client | **جاری** |
| **1** | Core Admin | Dashboard (live stats)، User Management UI، RBAC UI، Module Access، Audit Log UI | اگلا |
| 2 | Subscription Engine | 6 plans، lifecycle (upgrade/downgrade/renew/cancel) | منصوبہ |
| 3 | Payment — Manual | Bank/Cash، approval workflow، invoices | منصوبہ |
| 4 | Payment — Stripe | Checkout، webhooks، refunds | منصوبہ |
| 5 | Security Center | Failed logins، sessions، force logout، device revoke | منصوبہ |
| 6 | Notification Center | System/user/group، email (SendGrid) | منصوبہ |
| 7 | Analytics & Reports | Aggregations، PDF/Excel export | منصوبہ |
| 8 | System Configuration | Branding، languages، API/email/security settings | منصوبہ |
| 9 | Backup & Recovery | Manual/scheduled backup، controlled restore | منصوبہ |
| 10 | Content Management | Documents/media، versioning | منصوبہ |
| 11 | License Management | Create/activate/expire/revoke | منصوبہ |
| 12 | Developer Console | Error/API/performance logs، diagnostics | منصوبہ |
| 13 | Advanced RBAC | Custom roles UI، permission groups، delegation | منصوبہ |
| 14 | Multi-tenant Scaling | Tenant isolation، per-tenant quotas | منصوبہ |
| 15 | Analytics Pipeline | BigQuery export، dashboards | منصوبہ |
| 16 | MFA & Hardening | Super admin MFA، rate limiting، anomaly detection | منصوبہ |
| 17 | Mobile / Push | FCM push، SMS gateway | منصوبہ |
| 18 | Localization | Multi-language UI framework | منصوبہ |
| 19 | Performance & QA | Load testing، indexes tuning، caching | منصوبہ |
| 20 | Production Launch | Hosting + CDN، monitoring، runbooks | منصوبہ |

---

## 7. Deployment Notes

```bash
# Functions dependencies
cd functions && npm install

# Local emulation
firebase emulators:start

# Deploy (rules + indexes + functions)
firebase deploy --only firestore:rules,firestore:indexes,functions
```

- Stripe keys: `firebase functions:config:set stripe.secret="sk_..." stripe.webhook="whsec_..."`
- Functions deploy کے بغیر client **graceful fallback** میں چلتا رہے گا (موجودہ client-side logic)۔
