# موجودہ Test System کا Audit

## موجودہ حالت

- 152 کے قریب unit/helper test files اور 22 E2E specs موجود ہیں۔
- مکمل run: 736 passed، 15 failed۔
- focused security/registration/desktop/DR tests پاس ہیں، مگر زیادہ تر source-string assertions یا mocked browser harness ہیں۔

## اہم ناکامیاں

1. Android asset synchronization test: حقیقی drift۔
2. backup snapshot test: `EBUSY`۔
3. login/portal tests: code/UI اب پانچ portals کی پرانی expectation سے مختلف۔
4. متعدد loader tests پرانے `20260709_phase_a_drafts` cache-bust سے hard-coded ہیں۔
5. announcements test پرانی pre-kill-switch exact rule string مانگتا ہے۔
6. archive test expected helper موجودہ attendance file میں نہیں پاتا۔
7. project smoke timeout۔
8. dist E2E میں identity/login tests fail/timeout اور مکمل run hang۔

## Weak assertions

- بہت سے security tests صرف `toContain()` سے rule text دیکھتے ہیں؛ Firebase Rules emulator کے allow/deny scenarios نہیں چلاتے۔
- Super Admin smoke صرف DOM visibility/script load چیک کرتا ہے؛ direct URL/Firestore/CF authorization نہیں۔
- “function wired” tests function existence کو behavior سمجھتے ہیں۔
- multi-device tests shared mock snapshot استعمال کرتے ہیں، حقیقی Firebase latency/timestamps/rules نہیں۔
- offline tests registration/fee subset ہیں؛ complaints کا الگ tenant-less queue test موجود نہیں۔
- Android test drift detect کرتا ہے مگر APK runtime behavior نہیں۔
- desktop tests source/config inspect کرتے ہیں؛ packaged executable اور crash recovery نہیں۔

## Critical paths جن کے حقیقی tests نہیں

- Tenant A offline queue → Tenant B login/switch
- suspended tenant کے تمام Rules اور تمام callables
- AI permission by module/department، rate limit، provider privacy
- Settings import stored XSS
- AI key exfiltration resistance
- direct Firestore role matrix
- old session after deactivation/role change
- parent/staff direct URL and callable abuse
- cloud tombstone conflict
- simultaneous name/class/delete across 3 devices
- physical Android force-close/restart
- packaged Windows update/crash/SQLite corruption
- combined 50k related records

## Bundle coverage

- current `dist` verify ہوتا ہے۔
- Android assets stale ہیں۔
- Windows packaged release کا current source hash/version gate نہیں۔
- کچھ tests root source serve کرتے ہیں، کچھ `dist`؛ report میں دونوں کے نتائج الگ نہ کرنے سے false confidence بنتی ہے۔

## سفارش

Release gate میں Firebase Rules emulator matrix، callable suspension suite، tenant-switch outbox suite، Settings XSS DOM suite، signed Android smoke، packaged Electron smoke، اور deterministic test timeouts لازمی کیے جائیں۔
