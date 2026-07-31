# Cross-Module Results

| Flow | موجودہ نتیجہ | خطرہ |
|---|---|---|
| Registration → repository → admission table | focused + browser tests PASS | real Firebase hydration unverified |
| Registration → dashboard | mixed source paths | dashboard direct localStorage stale ہو سکتا ہے |
| Registration → finance | mixed source paths | finance میں direct global keys کثرت سے |
| Student → attendance/exam/complaint/AI | identity aliases استعمال | rename/class change propagation end-to-end unverified |
| Complaints → cloud | per-document sync | tenant-less offline queue release blocker |
| Complaints → AI | discipline aggregation | unauthorized staff AI context risk |
| Settings → all modules | CSS/dictionary/layout hooks | imported profile stored XSS اور invalid schema risk |
| Suspension → Rules/APIs | core action helpers gated | کئی reads/callables bypass |
| Role change → old session | UI/client refresh paths | server custom claims/session revocation practical test نہیں |
| Class → curriculum → exams | code relationships موجود | merge/delete historical preservation unverified |
| Offline → online | unified outbox tests PASS | legacy/complaint side queues inconsistent |
| Web → Android | FAIL | stale core, IDB, offline writer، HTML، loader |
| Web → Windows | architecture divergent | desktop default offline-only |

## مکمل student lifecycle

Repository CRUD، duplicate، audit اور pagination focused tests پاس ہوئے؛ مگر ایک ہی synthetic student کو admission سے class/curriculum/attendance/exam/result/fees/complaint/dashboard/report/AI تک حقیقی UI اور Firebase کے ساتھ چلانے کے لیے authenticated isolated tenant دستیاب نہیں تھا۔ نتیجہ: **UNVERIFIED**۔

## مکمل staff lifecycle

Phase A/B/C action-level rule text verified ہے؛ appointment، department، role change، deactivation، old session اور direct callable abuse کا real authorization lifecycle **UNVERIFIED**۔

## Dashboard correctness

Dashboard pre-aggregated stats path موجود ہے، مگر fallback direct localStorage arrays بھی پڑھتا ہے۔ کسی authenticated tenant میں ہر KPI کو source collection کے exact count/amount سے compare نہیں کیا گیا؛ dashboard accuracy **UNVERIFIED**۔

## Cross-module release judgement

Repository foundation بہتر ہے، مگر parallel persistence paths اور side queues integrated consistency کو توڑتے ہیں۔ خاص طور پر complaint queue اور suspension gaps کی وجہ سے cross-module isolation ثابت نہیں۔
