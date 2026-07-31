// ============================================================================
// EMS Enterprise Diagnostic — window.emsEnterpriseDiagnostic()
// ============================================================================
(function (global) {
    'use strict';

    var USERS_KEY = 'ems_full_users';

    function safe(fn, fb) {
        try { return fn(); } catch (e) { return fb; }
    }

    function readLocalUsersSize() {
        var getter = typeof global.emsSafeLocalGet === 'function'
            ? global.emsSafeLocalGet
            : function (key) {
                if (global._emsOriginalGetItem) return global._emsOriginalGetItem(key);
                return localStorage.getItem(key);
            };
        var raw = getter(USERS_KEY);
        if (!raw) return { bytes: 0, isSentinel: false, parseCount: 0 };
        var isSentinel = raw.indexOf('__emsIdb') >= 0;
        var parseCount = 0;
        if (!isSentinel) {
            try {
                var arr = JSON.parse(raw);
                if (Array.isArray(arr)) parseCount = arr.length;
            } catch (e) { /* ignore */ }
        }
        return { bytes: raw.length, isSentinel: isSentinel, parseCount: parseCount };
    }

    function countMissingDept(users) {
        if (!Array.isArray(users)) return { total: 0, missing: 0 };
        var missing = 0;
        users.forEach(function (u) {
            if (global.emsRecordNeedsDepartmentMigration && global.emsRecordNeedsDepartmentMigration(u)) {
                missing++;
            }
        });
        return { total: users.length, missing: missing };
    }

    function moduleDataPath(modId) {
        var paths = {
            dashboard: 'emsGetUsersSync / emsGetUsers → Repository (+ DashboardStats KPIs)',
            admission: 'emsRegRepoGetList → Repository → Firestore Registrations',
            attendance: 'attGetUsers → emsGetUsersSync → Repository (+ emsFetchStudentsForClass for register)',
            finance: 'finGetAllUsers → emsGetUsersSync → Repository',
            fees: 'finGetAllUsers → emsGetUsersSync → Repository',
            curriculum: 'emsGetUsersSync → Repository',
            exams: 'exmGetUsers → emsGetUsersSync → Repository',
            complaints: 'emsGetUsersSync → Repository',
            training: 'getUsers → emsGetUsersSync → Repository',
            announcements: 'annGetUsers → emsGetUsersSync → Repository',
            ledger: 'ldgGetUsers → emsGetUsersSync → Repository',
            payroll: 'ldgGetUsers → emsGetUsersSync → Repository',
            reports: 'loadRegistrationRows → emsGetUsersSync → Repository'
        };
        return paths[modId] || 'unknown';
    }

    global.emsEnterpriseDiagnostic = function () {
        var authUid = safe(function () {
            return firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
        }, null);
        var tenantId = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null;
        var repoList = typeof global.emsRegRepoGetList === 'function' ? global.emsRegRepoGetList() : [];
        var liveMeta = typeof global.emsGetRegistrationLiveSyncMeta === 'function'
            ? global.emsGetRegistrationLiveSyncMeta() : {};
        var localMeta = readLocalUsersSize();
        var deptAudit = countMissingDept(repoList);
        var stats = typeof global.emsGetDashboardStats === 'function' ? global.emsGetDashboardStats() : null;

        var report = {
            generatedAt: new Date().toISOString(),
            authentication: {
                currentUserUid: authUid,
                currentTenantId: tenantId,
                tenantRole: global.CURRENT_USER_TENANT_ROLE || null,
                departmentId: typeof global.emsGetDepartmentId === 'function' ? global.emsGetDepartmentId() : null
            },
            firestore: {
                connected: !!global.getDbOrNull && !!global.getDbOrNull(),
                registrationsQueryCount: null,
                queryTruncated: false,
                lastSnapshotTime: liveMeta.lastSnapshotTime || null,
                lastSyncTime: liveMeta.lastSyncTime || null
            },
            repository: {
                loaded: !!global.EMS_REPOSITORY_BOOT_COMPLETE || repoList.length > 0,
                readyFlag: !!global.EMS_REPOSITORY_READY,
                bootComplete: !!global.EMS_REPOSITORY_BOOT_COMPLETE,
                recordsCount: repoList.length,
                hasMore: typeof global.emsRegRepoHasMore === 'function' ? global.emsRegRepoHasMore() : false
            },
            indexedDB: {
                supported: !!global.indexedDB,
                ready: null,
                cachedUsersCount: null
            },
            localStorage: {
                ems_full_users_bytes: localMeta.bytes,
                ems_full_users_isSentinel: localMeta.isSentinel,
                ems_full_users_parseCount: localMeta.parseCount,
                legacyInProductionUse: false
            },
            dashboard: {
                dashboardStatsAvailable: !!(stats && stats.version),
                statsStudentCount: stats && stats.counts ? stats.counts.students : null,
                mergedUserCount: typeof global.emsGetUsersSync === 'function' ? global.emsGetUsersSync().length : 0
            },
            liveSync: {
                listenerActive: typeof global.emsIsRegistrationLiveSyncActive === 'function'
                    ? global.emsIsRegistrationLiveSyncActive() : false,
                snapshotReceived: !!liveMeta.snapshotReceived,
                lastError: liveMeta.lastError || null
            },
            department: {
                missingDepartmentIdsCount: deptAudit.missing,
                totalRepoRecords: deptAudit.total
            },
            moduleDataPaths: {
                dashboard: moduleDataPath('dashboard'),
                attendance: moduleDataPath('attendance'),
                fees: moduleDataPath('fees'),
                finance: moduleDataPath('finance'),
                curriculum: moduleDataPath('curriculum'),
                exams: moduleDataPath('exams'),
                complaints: moduleDataPath('complaints'),
                training: moduleDataPath('training'),
                announcements: moduleDataPath('announcements'),
                ledger: moduleDataPath('ledger'),
                payroll: moduleDataPath('payroll')
            },
            visibility: {
                status: 'PENDING'
            }
        };

        var idbChain = Promise.resolve();
        if (typeof global.emsRegRepoGetIdbCount === 'function') {
            idbChain = global.emsRegRepoGetIdbCount(tenantId).then(function (n) {
                report.indexedDB.ready = true;
                report.indexedDB.cachedUsersCount = n;
            });
        } else if (typeof global.emsIdbGet === 'function') {
            idbChain = global.emsIdbGet(USERS_KEY).then(function (val) {
                report.indexedDB.ready = true;
                report.indexedDB.cachedUsersCount = Array.isArray(val) ? val.length : 0;
            }).catch(function () {
                report.indexedDB.ready = false;
                report.indexedDB.cachedUsersCount = 0;
            });
        } else {
            report.indexedDB.ready = false;
            report.indexedDB.cachedUsersCount = 0;
        }

        var fsChain = Promise.resolve();
        var db = global.getDbOrNull && global.getDbOrNull();
        if (db && tenantId) {
            fsChain = db.collection('All_Madrasas').doc(tenantId).collection('Registrations')
                .limit(1000).get({ source: 'server' }).then(function (snap) {
                    report.firestore.registrationsQueryCount = snap.size;
                    report.firestore.queryTruncated = snap.size >= 1000;
                }).catch(function (err) {
                    report.firestore.registrationsQueryCount = -1;
                    report.firestore.error = err && err.message;
                });
        }

        return idbChain.then(function () {
            return fsChain;
        }).then(function () {
            var repoN = report.repository.recordsCount;
            var fsN = report.firestore.registrationsQueryCount;
            var dashN = report.dashboard.mergedUserCount;
            if (repoN > 0 && dashN === repoN) {
                report.visibility.status = 'PASS';
            } else if (repoN === 0 && fsN === 0) {
                report.visibility.status = 'EMPTY_TENANT';
            } else if (repoN === 0 && fsN > 0) {
                report.visibility.status = 'FAIL_REPO_NOT_HYDRATED';
                report.visibility.rootCauseHint = 'Firestore has data but Repository is empty — boot/live-sync failed';
            } else if (repoN > 0 && dashN === 0) {
                report.visibility.status = 'FAIL_MODULE_READ_PATH';
                report.visibility.rootCauseHint = 'Repository has data but emsGetUsersSync returns empty — ready flag or sync API issue';
            } else {
                report.visibility.status = 'PARTIAL';
                report.visibility.rootCauseHint = 'Counts differ — check department filter or pagination (500 cap)';
            }
            console.log('[EMS Enterprise Diagnostic]');
            console.table({
                tenantId: report.authentication.currentTenantId,
                repoCount: report.repository.recordsCount,
                firestoreCount: report.firestore.registrationsQueryCount,
                mergedCount: report.dashboard.mergedUserCount,
                liveSync: report.liveSync.listenerActive,
                ready: report.repository.readyFlag,
                visibility: report.visibility.status
            });
            return report;
        });
    };

    global.emsDiagRegistrationFlow = global.emsEnterpriseDiagnostic;

    /** One-liner health check — paste in console after login */
    global.emsQuickCheck = function () {
        return global.emsEnterpriseDiagnostic().then(function (r) {
            var ok = r.repository.recordsCount > 0 || (r.firestore.registrationsQueryCount > 0 && r.repository.bootComplete);
            var msg = ok
                ? '✅ OK — repo:' + r.repository.recordsCount + ' firestore:' + r.firestore.registrationsQueryCount
                : '❌ FAIL — repo:' + r.repository.recordsCount + ' firestore:' + r.firestore.registrationsQueryCount
                    + (r.liveSync.lastError ? ' err:' + r.liveSync.lastError : '');
            console.log(msg);
            if (!ok && typeof global.emsForceReloadRegistrationData === 'function') {
                console.log('Retry: await emsForceReloadRegistrationData()');
            }
            return { ok: ok, summary: msg, report: r };
        });
    };

})(typeof window !== 'undefined' ? window : globalThis);
