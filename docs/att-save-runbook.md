# حاضری محفوظ — Runbook (Local-First)

## ترتیب
1. **اس آلے پر محفوظ** — IndexedDB/localStorage (فوری)
2. **Outbox قطار** — reboot/tab close کے بعد بھی
3. **Firebase** — پس منظر میں، UI نہیں روکتا

## Status chip
| Chip | مطلب |
|------|------|
| اس آلے پر محفوظ ✓ | لوکل OK |
| سنک انتظار… | قطار میں |
| اس آلے پر + Firebase ✓ | cloud synced |
| cloud تنازعہ | VERSION_CONFLICT — «مقامی کاپی دوبارہ بھیجیں» |

## سنک قطار panel
- Status chip پر کلک → `#att-save-queue-panel`
- **دوبارہ بھیجیں** → `emsOfflineRetryFailedSync` / flush
- **مقامی کاپی دوبارہ بھیجیں** → `forceLocal` (version check skip)

## Offline → Online
- `online` event + 30s interval → `emsOfflineFlushAll`
- ڈیٹا ضائع نہیں — صرف cloud pending

## فائلیں
- `att-save-status.js` — UI + status
- `attendance.js` — `saveAttState`, deferred cloud batch
- `att-collective.js` — bulk local + batch flush
- `ems-offline-write.js` — outbox + Firestore flush

## لاگ
Console: `[EMS att-save]` prefix
