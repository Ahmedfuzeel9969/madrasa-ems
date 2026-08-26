# شعبۂ حاضری — جامع آڈٹ (26 اگست 2026)

## نتیجہ

موجودہ نظام میں عام طالب علم/کلاس حاضری کے لیے canonical شناخت موجود ہے: `Attendance/att_rec_{YYYY-MM}_students_{class}_all`۔ اسی record کی tenant-scoped local durable copy اور outbox copy بھی بنتی ہے؛ یہ تین الگ حاضریاں نہیں بلکہ offline-first نظام کی تین تہیں ہیں۔ تاہم legacy period sheets، event attendance، اور بعض cloud readers اب بھی ایک سے زیادہ physical records پڑھتے ہیں۔ ان راستوں کو مکمل طور پر canonical نہ کیا گیا تو double count، stale overwrite اور مختلف screens پر مختلف نتیجہ آ سکتا ہے۔

## ترجیحی خرابیاں

### P0 — پرانی offline تبدیلی نئی cloud تبدیلی کو overwrite کر سکتی ہے

- `checkRemoteVersion` مقامی `clientUpdatedAt` کا cloud سے تقابل کرتا ہے (`ems-offline-write.js:191-210`)۔
- مگر full attendance اور patch دونوں کا `clientUpdatedAt` اصل edit کے وقت نہیں، outbox flush کے وقت `Date.now()` سے بنتا ہے (`ems-offline-write.js:171-180`, `898-899`)۔
- نتیجہ: کئی گھنٹے/دن پرانی offline row sync ہوتے وقت “ابھی نئی” دکھائی دے سکتی ہے اور دوسرے device کی نئی marking/clear کو overwrite کر سکتی ہے۔ device clock غلط ہو تو مسئلہ مزید بڑھتا ہے۔
- حل: ہر mutation پر edit-time revision محفوظ کریں؛ server transaction میں base revision/precondition چیک کریں؛ conflict پر field/cell merge یا انسانی resolution دیں۔ flush-time timestamp کو concurrency authority نہ بنائیں۔

### P0 — Firestore rules attendance document کی ساخت اور دائرہ validate نہیں کرتے

- rules صرف module-level create/update/delete اجازت چیک کرتے ہیں (`firestore.rules:499-504`)۔
- client UI اپنے ہی staff attendance کی تبدیلی روکتا ہے (`attendance.js:80-103`) لیکن server rule ایسا نہیں کرتا۔ مجاز attendance staff براہِ راست SDK/REST سے اپنا یا غیر متعلق class کا record، arbitrary fields، یا غلط doc id لکھ سکتا ہے۔
- حل: doc-id pattern، allowed fields/status values، tenant/department، class/teacher assignment اور self-edit پابندی server-side rules یا callable function میں نافذ کریں۔ Emulator rule tests لازمی ہوں۔

### P1 — Parent attendance API legacy + canonical sheets کو double-count کرتا ہے

- `fetchAttendance` پورا `Attendance` collection پڑھ کر ہر matching ماہانہ document کی اسی student/day entry جمع کرتا ہے (`functions/lib/parent-data.js:116-139`)۔
- legacy per-period اور canonical `all` sheet دونوں موجود ہوں تو ایک ہی دن کئی بار `days` میں آتا اور summary کئی بار بڑھتی ہے۔ status conflict کی final-state policy بھی نہیں۔
- حل: صرف canonical student-class sheet query کریں، یا `{studentId, date}` سے dedupe کر کے deterministic winner منتخب کریں؛ legacy/event/staff docs واضح طور پر exclude کریں۔

### P1 — Cloud AttendanceSummary ایک طالب علم کو ایک ہی دن متعدد status buckets میں شمار کر سکتا ہے

- recompute code ہر document scan کرتا اور P/A/L کے الگ Sets رکھتا ہے (`functions/lib/tenant-dashboard-stats.js:193-260`)۔
- ایک legacy sheet میں P اور canonical sheet میں A ہو تو uid presentSet اور absentSet دونوں میں جاتا ہے؛ اس لیے P+A+L roster سے زیادہ ہو سکتا ہے۔ frontend میں dedupe tests ہیں مگر Cloud Function میں وہ final-state helper استعمال نہیں ہوتا۔
- حل: تمام candidates سے پہلے per-person/day final state بنائیں، پھر صرف ایک bucket میں ڈالیں؛ document type/schema filtering شامل کریں۔

### P1 — Event attendance دو مستقل جگہوں پر محفوظ ہے

- مکمل event list `ModuleData` blob (`ems_att_events_db`) میں لکھی جاتی ہے، پھر ہر event `Attendance/att_evt_{id}` میں بھی لکھا جاتا ہے (`attendance.js:5758-5894`)۔
- delete میں blob سے row ہٹتی ہے مگر Attendance doc صرف tombstone بنتا ہے۔ دونوں writes atomic نہیں؛ پہلی کامیاب اور دوسری ناکام ہو سکتی ہے۔ یہ واقعی دو sources of truth ہیں۔
- حل: ایک canonical model منتخب کریں۔ تجویز: `AttendanceEvents/{eventId}` + participant sub/compact map؛ list اسی collection سے بنے۔ عبوری migration میں dual-write reconciliation job، checksum اور cutover flag رکھیں، پھر blob read/write بند کریں۔

### P1 — ایک ہی document کے full-row اور patch outbox entries الگ identities ہیں

- queue key میں `type` شامل ہے (`tenant|type|docId`)؛ اس لیے `attendance` اور `attendance_patch` ایک doc کے لیے بیک وقت رہ سکتے ہیں (`ems-offline-write.js:128-135`, `819-838`)۔
- full flush `merge:false` کرتا ہے جبکہ patch update/merge کرتا ہے (`839-913`)۔ retry/order بدلنے پر full snapshot patch کے بعد چل کر unrelated نئی cells یا clears واپس بدل سکتا ہے۔
- حل: attendance doc کے لیے queue identity صرف `{tenantId, docId}` ہو؛ operations ایک ordered mutation log یا واحد coalesced patch میں بدلیں؛ full replace صرف create/migration کے لیے۔

### P2 — meaningful-data gate remarks/late کو براہِ راست نہیں دیکھتا

- `attHasMeaningfulAttendanceData` records, locks, periodRecords اور timestamp دیکھتا ہے، remarks/late نہیں (`attendance.js:1308-1316`)۔
- timestamp نہ رکھنے والے legacy/imported remarks-only record کو خالی سمجھا جا سکتا ہے، جس سے cloud fallback یا merge میں note/late data چھپ سکتا ہے۔
- حل: remarks اور late کو gate میں شامل کریں؛ imported documents کے schemaVersion اور timestamp backfill کریں۔

### P2 — live/local reconciliation پورے record کی timestamp-based winner policy استعمال کرتی ہے

- `attReconcileAttendanceRecord` صرف جس record کا timestamp بڑا ہو اسے مکمل winner بناتا ہے (`attendance.js:1318-1326`)۔
- مختلف devices نے مختلف طلبہ/دن بدلے ہوں تو نئی timestamp والی پوری copy پرانی مگر غیر متصادم تبدیلیاں بھی گرا سکتی ہے۔ cloud patch granular ہے مگر initial load/background reconciliation granular merge نہیں۔
- حل: cell-level metadata/revision یا server mutation log؛ کم از کم records/periodRecords کو uid/day/period سطح پر merge اور clear tombstones کے ساتھ reconcile کریں۔

### P2 — timetable integration test suite ٹوٹی ہوئی ہے

- attendance tests میں 226 میں سے 218 پاس اور 8 fail ہوئے۔ تمام 8 `ems-attendance-timetable-phase3.test.js` میں `attHealTimetableLocally is not defined` ہیں۔ function production code میں موجود ہے (`attendance.js:4644`) مگر test extraction slice اسے شامل نہیں کرتا۔
- یہ production failure ثابت نہیں کرتا، لیکن timetable add/edit/archive/reload/offline/tenant isolation کے 8 اہم regression checks اس وقت قابلِ اعتماد نہیں۔
- حل: brittle source slicing ختم کر کے helpers کو importable module بنائیں یا test harness میں مکمل dependency شامل کریں۔

### P3 — performance/scale risks

- parent API پورا Attendance collection پڑھتا ہے؛ monthly constrained query نہیں (`functions/lib/parent-data.js:118`)۔
- Cloud summary ہر attendance write پر ماہ کے تمام docs دوبارہ پڑھ سکتا ہے (`tenant-dashboard-stats.js:193-266`, trigger `500-518`)؛ بڑی درسگاہ اور متعدد period sheets میں read cost/latency بڑھے گی۔
- حل: canonical-only query، schema fields (`month`, `kind`, `classId`) اور incremental per-day/person aggregation؛ scheduled repair job بطور safety net۔

## کہاں کیا محفوظ ہو رہا ہے

| چیز | مقامی durable copy | Cloud canonical/secondary | حیثیت |
|---|---|---|---|
| طلبہ ماہانہ حاضری | tenant-scoped `att_rec_{tenant}_...` (IDB/durable cache) | `Attendance/att_rec_{month}_students_{class}_all` | درست offline replicas؛ الگ logical records نہیں |
| اساتذہ/عملہ | tenant-scoped local key | `Attendance/att_rec_{month}_{teachers|staff}__all` | canonical، مگر legacy keys migration کے بعد بھی retained |
| sync queue | IndexedDB outbox | اسی Attendance doc پر flush | temporary delivery copy؛ SSOT نہیں، مگر full/patch identity درست کرنی ہے |
| legacy period sheets | retained local/cloud records | `..._{periodId}` | reporting سے exclude/migrate/archive ضروری |
| event attendance | `ems_att_events_db` مکمل blob | `Attendance/att_evt_{id}` | حقیقی dual source؛ ختم کرنا ضروری |
| timetable/config | tenant-scoped ModuleData | legacy `Attendance_Config/periods` read source بھی | attendance marks نہیں، مگر register behavior پر اثرانداز |
| AttendanceSummary/DashboardStats | cache نہیں/derived | Cloud derived docs | source نہیں؛ canonical data سے rebuild ہونے چاہئیں |
| Archive_Attendance | archive copy | archive collection | historical destination؛ live queries سے الگ رکھیں |

## اصلاحی roadmap

### مرحلہ 0 — حفاظت اور baseline (1–2 دن)

1. production export/backup اور tenant-wise inventory لیں: canonical, legacy period, event, tombstone، malformed ids۔
2. invariant report بنائیں: ایک person/day کے متعدد status، P+A+L > roster، orphan users/classes، pending/dead outbox۔
3. migration تک destructive cleanup نہ کریں؛ dual sources کو read-only evidence کے طور پر رکھیں۔

### مرحلہ 1 — data loss اور authorization بند کریں (3–5 دن)

1. edit-time mutation revision + server transaction/precondition نافذ کریں۔
2. attendance outbox کو doc-level single ordered identity دیں؛ full replace محدود کریں۔
3. Firestore rules/function validation: schema, doc kind/id, allowed fields/status، assignment اور self-edit۔
4. دو-device tests: same cell conflict، different cells merge، offline clear، clock skew، tenant switch۔

### مرحلہ 2 — reads کو canonical کریں (2–4 دن)

1. Parent API اور Cloud AttendanceSummary میں shared final-state dedupe helper لگائیں۔
2. queries میں `kind=register`, `month`, `type=students` یا reliable doc parser سے events/staff/legacy exclude کریں۔
3. dashboard, print, payroll, parent view اور reports پر ایک fixture سے برابر totals ثابت کریں۔

### مرحلہ 3 — event dual-write ختم کریں (3–5 دن)

1. event کے لیے واحد schema/collection منتخب کریں۔
2. blob اور per-event docs کا read-only comparison + deterministic migration کریں۔
3. پہلے canonical read، پھر shadow comparison، پھر blob write بند، آخر میں backup کے بعد legacy archive۔

### مرحلہ 4 — legacy attendance consolidation (3–7 دن)

1. ہر tenant/month/class legacy sheets کو canonical میں cell-level merge کریں؛ conflicts کی report بنائیں، خاموش winner نہ چنیں۔
2. migrated docs پر marker/checksum لگائیں اور rerun idempotent رکھیں۔
3. دو release cycles تک shadow validation، پھر legacy docs live queries سے مکمل خارج اور archive کریں۔

### مرحلہ 5 — testability اور operations (2–4 دن)

1. timetable test harness درست کریں؛ source-text slicing کی جگہ importable pure helpers۔
2. Firebase Emulator integration tests اور outbox crash/retry tests شامل کریں۔
3. monitoring: conflict count، outbox age، duplicate logical keys، invariant breach، summary rebuild mismatch۔

## قبولیت کی شرائط

- ہر tenant/class/month کے لیے صرف ایک live canonical register؛ legacy صرف archive/read-only۔
- ہر person/date کا صرف ایک final status؛ تمام screens/API/summary میں برابر نتیجہ۔
- offline device کسی نئی cloud edit کو خاموشی سے overwrite نہ کرے۔
- self-edit/غیر متعلق class edit صرف UI نہیں، server بھی روکے۔
- event save/delete ایک atomic canonical write ہو۔
- دو devices، offline/online، clear، retry، tenant switch اور archive کے tests سب پاس ہوں۔
- migration dry-run، rollback export، counts/checksums اور sign-off کے بغیر data delete نہ ہو۔

## ٹیسٹ ثبوت

- چلائے گئے attendance-focused unit tests: 31 files، 226 tests۔
- نتیجہ: 30 files پاس؛ 218 tests پاس؛ timetable harness کے 8 tests fail۔
- یہ ابتدائی audit baseline تھا؛ بعد کی نافذ شدہ تبدیلیاں اگلے حصے میں درج ہیں۔

## نفاذ کی تازہ حالت (26 اگست 2026)

مندرجہ بالا اصلاحی کام production source میں نافذ کر دیے گئے ہیں:

- offline mutation کا اصل edit-time محفوظ اور conflict check میں استعمال۔
- ایک attendance document کی full/patch outbox شناخت یکجا اور محفوظ coalescing۔
- Parent API اور Cloud AttendanceSummary کے لیے مشترک canonical final-state dedupe۔
- Event attendance کی نئی dual-write بند؛ `ems_att_events_db` tenant-scoped ModuleData واحد SSOT۔
- remarks/late-only records meaningful شمار۔
- Firestore rules میں attendance doc-id/shape validation اور staff self-edit server-side روک۔
- timetable integration test harness درست۔

تازہ نتیجہ: attendance کے 33 test files اور 233 tests، سب کامیاب۔ Firestore Emulator نے نئی rules file کامیابی سے load/compile کی۔ کسی live tenant کا data حذف یا خودکار طور پر تبدیل نہیں کیا گیا؛ legacy data migration کو backup اور tenant-specific dry-run کے بغیر چلانا محفوظ نہیں ہے۔
