// ============================================================================
// EMS Department Migration — Phase D (local backfill + optional Firestore sync)
// ============================================================================
(function (global) {
    'use strict';

    var LOG_KEY = 'ems_dept_migration_log';
    var MIGRATION_VERSION = 1;

    var ARRAY_TARGETS = [
        { key: 'ems_full_users', label: 'رجسٹریشن (منظور)' },
        { key: 'ems_rejected_users', label: 'مسترد شدہ' },
        { key: 'ems_fee_collections', label: 'فیس وصولی', fromStudent: true },
        { key: 'ems_full_ledger', label: 'روزنامچہ' },
        { key: 'ems_announcements', label: 'اعلانات' },
        { key: 'ems_full_announcements', label: 'اعلانات (مکمل)' },
        { key: 'ems_full_exams', label: 'امتحانی نمبرات', fromStudent: true },
        { key: 'ems_tar_prayer', label: 'تربیت: نماز' },
        { key: 'ems_tar_ethics', label: 'تربیت: اخلاق' },
        { key: 'ems_tar_discipline', label: 'تربیت: نظم' },
        { key: 'ems_tar_reform', label: 'تربیت: اصلاح' },
        { key: 'ems_tar_awards', label: 'تربیت: انعامات' },
        { key: 'ems_tar_warnings', label: 'تربیت: تنبیہات' },
        { key: 'ems_cur_plans', label: 'نصاب: منصوبے' },
        { key: 'ems_cur_daily', label: 'نصاب: روزانہ' },
        { key: 'ems_payroll_history', label: 'تنخواہ تاریخ', fromStaff: true }
    ];

    function readJson(key, fb) {
        try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : '[]')); }
        catch (e) { return fb != null ? fb : []; }
    }

    function writeJson(key, val) {
        if (global.emsSaveModuleData) {
            return global.emsSaveModuleData(key, typeof val === 'string' ? val : JSON.stringify(val));
        }
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        return Promise.resolve();
    }

    function infer(record, userMap, target) {
        if (target && target.fromStudent && record.studentId && userMap[record.studentId]) {
            return global.emsInferDepartmentId(userMap[record.studentId]);
        }
        if (target && target.fromStaff && record.staffId && userMap[record.staffId]) {
            return global.emsInferDepartmentId(userMap[record.staffId]);
        }
        return global.emsInferDepartmentId(record);
    }

    function buildUserMap() {
        var map = {};
        var list = [];
        if (typeof global.emsRegRepoGetList === 'function') {
            list = global.emsRegRepoGetList() || [];
        }
        if (!list.length && typeof global.emsGetUsersMerged === 'function') {
            list = global.emsGetUsersMerged() || [];
        }
        list.forEach(function (u) {
            if (u && u.id) map[u.id] = u;
        });
        return map;
    }

    /** Boot-time: stamp departmentId on in-memory + Firestore registration records missing it */
    global.emsDeptMigrationEnsureRegistrations = function () {
        var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
        var tenantId = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null;
        var list = typeof global.emsRegRepoGetList === 'function' ? (global.emsRegRepoGetList() || []) : [];
        if (!list.length) return Promise.resolve({ updated: 0, skipped: true });

        var needs = list.filter(function (r) {
            return global.emsRecordNeedsDepartmentMigration && global.emsRecordNeedsDepartmentMigration(r);
        });
        if (!needs.length) return Promise.resolve({ updated: 0 });

        var updated = 0;
        needs.forEach(function (r) {
            r.departmentId = global.emsInferDepartmentId(r);
            if (typeof global.emsRegRepoUpsert === 'function') {
                global.emsRegRepoUpsert(r);
            }
            updated++;
        });

        if (!db || !tenantId || !needs.length) {
            return Promise.resolve({ updated: updated, localOnly: true });
        }

        var base = db.collection('All_Madrasas').doc(tenantId).collection('Registrations');
        var batch = db.batch();
        var batchCount = 0;
        var commits = [];

        needs.forEach(function (r) {
            if (!r.id) return;
            batch.set(base.doc(r.id), { departmentId: r.departmentId }, { merge: true });
            batchCount++;
            if (batchCount >= 400) {
                commits.push(batch.commit());
                batch = db.batch();
                batchCount = 0;
            }
        });
        if (batchCount > 0) commits.push(batch.commit());

        return Promise.all(commits).then(function () {
            return { updated: updated, firestore: true };
        }).catch(function () {
            return { updated: updated, firestore: false };
        });
    };

    function scanArrayTarget(target, userMap) {
        var arr = readJson(target.key, []);
        if (!Array.isArray(arr)) return { key: target.key, label: target.label, total: 0, missing: 0 };
        var missing = 0;
        arr.forEach(function (r) {
            if (global.emsRecordNeedsDepartmentMigration(r)) missing++;
        });
        return { key: target.key, label: target.label, total: arr.length, missing: missing };
    }

    function scanAttendanceKeys() {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf('att_rec_') === 0) keys.push(k);
        }
        var missing = 0;
        keys.forEach(function (k) {
            try {
                var sheet = JSON.parse(localStorage.getItem(k) || '{}');
                if (sheet && global.emsRecordNeedsDepartmentMigration(sheet)) missing++;
            } catch (e) { /* ignore */ }
        });
        return { key: 'att_rec_*', label: 'حاضری رجسٹر', total: keys.length, missing: missing, keys: keys };
    }

    global.emsDeptMigrationScan = function () {
        var userMap = buildUserMap();
        var stores = ARRAY_TARGETS.map(function (t) { return scanArrayTarget(t, userMap); });
        stores.push(scanAttendanceKeys());
        var complaints = { key: 'indexeddb:complaints', label: 'شکایات (IndexedDB)', total: 0, missing: 0, async: true };
        var totalMissing = stores.reduce(function (s, x) { return s + (x.missing || 0); }, 0);
        var totalRecords = stores.reduce(function (s, x) { return s + (x.total || 0); }, 0);
        return {
            version: MIGRATION_VERSION,
            stores: stores,
            complaints: complaints,
            totalMissing: totalMissing,
            totalRecords: totalRecords,
            defaultDepartment: global.EMS_DEPARTMENT_DEFAULT || 'boys_dars'
        };
    };

    global.emsDeptMigrationScanComplaints = function () {
        if (!global.CmpIDB || typeof global.CmpIDB.getAll !== 'function') {
            return Promise.resolve({ total: 0, missing: 0 });
        }
        return global.CmpIDB.getAll().then(function (rows) {
            rows = rows || [];
            var missing = rows.filter(function (r) { return global.emsRecordNeedsDepartmentMigration(r); }).length;
            return { total: rows.length, missing: missing };
        }).catch(function () { return { total: 0, missing: 0 }; });
    };

    function migrateArray(target, userMap, stats) {
        var arr = readJson(target.key, []);
        if (!Array.isArray(arr) || !arr.length) return;
        var changed = false;
        arr.forEach(function (r) {
            if (!global.emsRecordNeedsDepartmentMigration(r)) return;
            r.departmentId = infer(r, userMap, target);
            changed = true;
            stats.updated++;
        });
        if (changed) {
            writeJson(target.key, arr);
            stats.keys.push(target.key);
        }
    }

    function migrateAttendance(stats) {
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k.indexOf('att_rec_') !== 0) continue;
            try {
                var sheet = JSON.parse(localStorage.getItem(k) || '{}');
                if (!sheet || !global.emsRecordNeedsDepartmentMigration(sheet)) continue;
                sheet.departmentId = global.emsInferDepartmentId(sheet);
                localStorage.setItem(k, JSON.stringify(sheet));
                stats.updated++;
                stats.keys.push(k);
            } catch (e) { /* ignore */ }
        }
    }

    global.emsDeptMigrationApplyLocal = function (options) {
        options = options || {};
        var stats = { updated: 0, keys: [], startedAt: Date.now() };
        var userMap = buildUserMap();
        global._emsSuppressSync = !!options.suppressSync;
        try {
            ARRAY_TARGETS.forEach(function (t) { migrateArray(t, userMap, stats); });
            migrateAttendance(stats);
        } finally {
            global._emsSuppressSync = false;
        }
        var complaintPromise = Promise.resolve({ updated: 0 });
        if (global.CmpIDB && typeof global.CmpIDB.getAll === 'function') {
            complaintPromise = global.CmpIDB.getAll().then(function (rows) {
                if (!Array.isArray(rows) || !rows.length) return { updated: 0 };
                var n = 0;
                rows.forEach(function (r) {
                    if (!global.emsRecordNeedsDepartmentMigration(r)) return;
                    r.departmentId = global.emsInferDepartmentId(r);
                    n++;
                });
                if (n && typeof global.CmpIDB.saveAll === 'function') {
                    return global.CmpIDB.saveAll(rows).then(function () {
                        return { updated: n };
                    });
                }
                return { updated: 0 };
            }).catch(function () { return { updated: 0 }; });
        }
        return complaintPromise.then(function (cmp) {
            stats.complaintsUpdated = cmp.updated || 0;
            stats.updated += stats.complaintsUpdated;
            stats.finishedAt = Date.now();
            stats.actor = typeof global.sysActorName === 'function' ? global.sysActorName() : 'admin';
            var log = readJson(LOG_KEY, { runs: [] });
            if (!log.runs) log.runs = [];
            log.runs.push({ type: 'local', stats: stats, at: Date.now() });
            if (log.runs.length > 20) log.runs = log.runs.slice(-20);
            log.lastLocal = stats;
            writeJson(LOG_KEY, log);
            if (typeof global.emsRefreshDepartmentModules === 'function') {
                global.emsRefreshDepartmentModules();
            }
            return stats;
        });
    };

    global.emsDeptMigrationApplyFirestore = function (options) {
        options = options || {};
        var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
        var tenantId = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null;
        if (!db || !tenantId) {
            return Promise.reject(new Error('Firestore یا tenant دستیاب نہیں — لاگ ان چیک کریں'));
        }
        var base = db.collection('All_Madrasas').doc(tenantId);
        var collections = [
            { name: 'Registrations', label: 'Registrations' },
            { name: 'Rejected', label: 'Rejected' },
            { name: 'LedgerEntries', label: 'LedgerEntries' },
            { name: 'Announcements', label: 'Announcements' }
        ];
        var stats = { updated: 0, collections: {}, errors: [] };

        function migrateCol(colName) {
            return base.collection(colName).get().then(function (snap) {
                var batch = db.batch();
                var batchCount = 0;
                var colUpdated = 0;
                var commits = [];

                function flush() {
                    if (batchCount === 0) return Promise.resolve();
                    commits.push(batch.commit());
                    batch = db.batch();
                    batchCount = 0;
                }

                snap.forEach(function (doc) {
                    var data = doc.data();
                    if (!global.emsRecordNeedsDepartmentMigration(data)) return;
                    batch.set(doc.ref, { departmentId: global.emsInferDepartmentId(data) }, { merge: true });
                    batchCount++;
                    colUpdated++;
                    if (batchCount >= 400) {
                        commits.push(batch.commit());
                        batch = db.batch();
                        batchCount = 0;
                    }
                });
                if (batchCount > 0) commits.push(batch.commit());
                return Promise.all(commits).then(function () {
                    stats.collections[colName] = colUpdated;
                    stats.updated += colUpdated;
                });
            }).catch(function (err) {
                stats.errors.push(colName + ': ' + (err.message || String(err)));
            });
        }

        return collections.reduce(function (chain, col) {
            return chain.then(function () { return migrateCol(col.name); });
        }, Promise.resolve()).then(function () {
            stats.finishedAt = Date.now();
            var log = readJson(LOG_KEY, { runs: [] });
            if (!log.runs) log.runs = [];
            log.runs.push({ type: 'firestore', stats: stats, at: Date.now() });
            if (log.runs.length > 20) log.runs = log.runs.slice(-20);
            log.lastFirestore = stats;
            writeJson(LOG_KEY, log);
            return stats;
        });
    };

    global.emsDeptMigrationGetStatus = function () {
        return readJson(LOG_KEY, { runs: [] });
    };

    global.emsDeptMigrationRenderUI = function () {
        var summary = document.getElementById('dept-mig-summary');
        var tbody = document.querySelector('#dept-mig-table tbody');
        var logEl = document.getElementById('dept-mig-log');
        if (!summary || !tbody) return;

        var scan = global.emsDeptMigrationScan();
        summary.innerHTML = '<div class="cmp-stat-strip">' +
            '<div class="cmp-stat"><div class="cmp-stat-v" id="dept-mig-missing-count">' + scan.totalMissing + '</div><div class="cmp-stat-l">بغیر departmentId</div></div>' +
            '<div class="cmp-stat"><div class="cmp-stat-v" id="dept-mig-total-count">' + scan.totalRecords + '</div><div class="cmp-stat-l">کل مقامی ریکارڈ</div></div>' +
            '<div class="cmp-stat"><div class="cmp-stat-v">' + scan.defaultDepartment + '</div><div class="cmp-stat-l">ڈیفالٹ (نامعلوم)</div></div>' +
            '</div>';

        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">شکایات اسکین...</td></tr>';
        global.emsDeptMigrationScanComplaints().then(function (cmp) {
            scan.complaints.total = cmp.total;
            scan.complaints.missing = cmp.missing;
            scan.totalMissing += cmp.missing;
            scan.totalRecords += cmp.total;
            var rows = scan.stores.concat([scan.complaints]);
            tbody.innerHTML = rows.map(function (r) {
                return '<tr><td>' + (r.label || r.key) + '</td><td>' + (r.total || 0) + '</td><td>' + (r.missing || 0) + '</td>' +
                    '<td>' + ((r.missing || 0) > 0 ? '<span style="color:#d97706;">درکار</span>' : '<span style="color:#16a34a;">مکمل</span>') + '</td></tr>';
            }).join('');
            summary.querySelector('#dept-mig-missing-count').textContent = scan.totalMissing;
            var totEl = summary.querySelector('#dept-mig-total-count');
            if (totEl) totEl.textContent = scan.totalRecords;
        });

        if (logEl) {
            var log = global.emsDeptMigrationGetStatus();
            var last = (log.runs || []).slice(-5).reverse();
            logEl.innerHTML = last.length ? last.map(function (r) {
                var s = r.stats || {};
                return '<div style="font-size:12px;padding:6px 0;border-bottom:1px dashed #e2e8f0;">' +
                    new Date(r.at).toLocaleString('ur-PK') + ' — ' + r.type + ': ' + (s.updated || 0) + ' اپڈیٹ' +
                    (s.errors && s.errors.length ? ' <span style="color:#dc2626;">(' + s.errors.join('; ') + ')</span>' : '') +
                    '</div>';
            }).join('') : '<p style="color:#94a3b8;font-size:13px;">ابھی کوئی مائیگریشن نہیں چلی</p>';
        }
    };

    global.emsDeptMigrationRunLocal = function () {
        if (!confirm('تمام مقامی ریکارڈز میں departmentId بھر دی جائے گی۔ جاری رکھیں؟')) return Promise.resolve(null);
        var btn = document.getElementById('dept-mig-run-local');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> چل رہا ہے...'; }
        return global.emsDeptMigrationApplyLocal({ suppressSync: false }).then(function (stats) {
            if (typeof global.showToast === 'function') {
                global.showToast('مقامی مائیگریشن: ' + stats.updated + ' ریکارڈ اپڈیٹ', 'success');
            }
            global.emsDeptMigrationRenderUI();
            return stats;
        }).catch(function (err) {
            if (typeof global.showToast === 'function') global.showToast(err.message || 'مائیگریشن ناکام', 'error');
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-database"></i> مقامی Backfill'; }
        });
    };

    global.emsDeptMigrationRunFirestore = function () {
        if (!confirm('Firestore میں بھی departmentId merge ہو گی۔ جاری رکھیں؟')) return Promise.resolve(null);
        var btn = document.getElementById('dept-mig-run-firestore');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Firestore...'; }
        return global.emsDeptMigrationApplyFirestore().then(function (stats) {
            if (typeof global.showToast === 'function') {
                var msg = 'Firestore: ' + stats.updated + ' دستاویزات';
                global.showToast(stats.errors.length ? msg + ' (کچھ ایرر)' : msg, stats.errors.length ? 'warning' : 'success');
            }
            global.emsDeptMigrationRenderUI();
            return stats;
        }).catch(function (err) {
            if (typeof global.showToast === 'function') global.showToast(err.message || 'Firestore ناکام', 'error');
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Firestore Sync'; }
        });
    };

})(window);
