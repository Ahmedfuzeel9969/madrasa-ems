# Enterprise Login — Phase 8: Delivery, Audit Storage, Parent Push

**Date:** 2026-06-19  
**Builds on:** Phase 1–7

---

## Summary

Phase 8 activates the notification pipeline: **SMTP/FCM delivery for key expiry queue**, **scheduled SecurityLog export to Cloud Storage**, and **parent push/email when admin replies**.

---

## Changes

### 1. Key Expiry Delivery Processor

| Component | Detail |
|-----------|--------|
| `scheduledDeliverKeyExpiryNotifications` | Every 6h — processes queued `KeyExpiryNotifications` |
| `notification-delivery.js` | SMTP (nodemailer) + FCM to `OwnerDeviceTokens` |
| Policy | `enableEmailDelivery`, `enablePushDelivery` |

SMTP config:
```powershell
firebase functions:config:set ems.smtp_host="smtp.example.com" ems.smtp_user="..." ems.smtp_pass="..." ems.smtp_from="noreply@example.com"
```

### 2. Scheduled Audit Export

| Function | Detail |
|----------|--------|
| `scheduledSecurityLogExport` | Daily → `gs://{bucket}/ems-audit/{tenantId}/...json` |
| `triggerSecurityLogExport` | Owner on-demand storage export |
| Metadata | `TenantSettings/auditExport` |

### 3. Parent Reply Notifications

| Trigger | `onParentMessageCreated` when `direction === 'out'` |
| Channels | FCM, email, in-app `Announcements` |
| Callables | `registerParentDeviceToken`, `registerOwnerDeviceToken` |
| Client | `ems-push-register.js` |

Set VAPID: Admin panel → **بیک اپ و سنک** → Push / FCM (Phase 9)

---

*End of Phase 8 Report*
