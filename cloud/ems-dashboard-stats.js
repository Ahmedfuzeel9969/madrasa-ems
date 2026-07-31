// ============================================================================
// EMS Dashboard Stats — read pre-aggregated DashboardStats/current (Phase 2 S2)
// ============================================================================
(function (global) {
    'use strict';

    var state = { unsub: null, lastStats: null, active: false };

    function getTenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var required = global.emsRequireTenantId();
            if (required) return required;
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        return global.CURRENT_MADRASA_TENANT_ID || null;
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    function formatRs(n) {
        return 'Rs ' + (Number(n) || 0).toLocaleString();
    }

    /** Apply server stats to KPI cards. Returns true if applied. */
    global.emsApplyDashboardStats = function (stats, options) {
        if (!stats || stats.version < 2) return false;
        options = options || {};
        state.lastStats = stats;

        var skipHeadcounts = options.skipHeadcounts === true
            || global.EMS_OFFLINE_FIRST_SSOT === true;

        if (stats.counts && !skipHeadcounts) {
            if (!options.skipDeptFilter) {
                setText('dash-total-students', stats.counts.students);
                setText('dash-total-teachers', stats.counts.teachers);
                setText('dash-total-staff', stats.counts.staff);
            }
            setText('dash-inst-total-students', stats.counts.students);
            setText('dash-total-announcements', stats.counts.announcements);
        } else if (stats.counts) {
            setText('dash-total-announcements', stats.counts.announcements);
        }

        if (stats.finance) {
            setText('dash-total-income', formatRs(stats.finance.totalIncome));
            setText('dash-total-expense', formatRs(stats.finance.ledgerExpenseToday));
            setText('dash-remaining-fee', formatRs(stats.finance.totalArrears));
            if (document.getElementById('dash-fin-income')) {
                setText('dash-fin-income', formatRs(stats.finance.totalIncome));
            }
            if (document.getElementById('dash-fin-expense')) {
                setText('dash-fin-expense', formatRs(stats.finance.ledgerExpenseToday));
            }
        }

        if (stats.attendance) {
            var totalStudents = stats.counts ? stats.counts.students : 0;
            if (typeof global.emsFilterByDepartment === 'function' && options.users) {
                totalStudents = global.emsFilterByDepartment(options.users)
                    .filter(function (u) { return u.type === 'student'; }).length;
            }
            var pct = totalStudents > 0
                ? Math.round((stats.attendance.todayPresent / totalStudents) * 100)
                : 0;
            setText('dash-att-rate', pct + '%');
            var el = document.getElementById('dash-att-rate');
            if (el) el.title = 'DashboardStats (Firestore)';
        }

        return true;
    };

    global.emsGetDashboardStats = function () {
        return state.lastStats;
    };

    global.emsStartDashboardStatsListener = function () {
        if (global.EMS_OFFLINE_FIRST_SSOT === true) {
            if (typeof global.emsDashApplyRepoCounts === 'function') {
                try { global.emsDashApplyRepoCounts(); } catch (e) { /* ignore */ }
            }
            return;
        }
        if (state.active) return;
        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) return;

        state.active = true;
        try {
            state.unsub = db.collection('All_Madrasas').doc(tid)
                .collection('DashboardStats').doc('current')
                .onSnapshot(function (doc) {
                    if (!doc.exists) {
                        if (typeof global.emsRefreshDashboardStats === 'function') {
                            global.emsRefreshDashboardStats().catch(function () { /* ignore */ });
                        }
                        return;
                    }
                    var stats = doc.data();
                    if (typeof global.emsPipelineDebug === 'function') {
                        global.emsPipelineDebug('dashboard_stats_snapshot', {
                            queryPath: 'All_Madrasas/' + tid + '/DashboardStats/current',
                            recordCount: stats && stats.counts ? stats.counts.students : null,
                            source: 'firestore',
                            cacheHit: false,
                            filters: { doc: 'current' }
                        });
                    }
                    global.emsApplyDashboardStats(stats, {
                        skipDeptFilter: false,
                        skipHeadcounts: global.EMS_OFFLINE_FIRST_SSOT === true
                    });
                    try {
                        if (typeof global.emsDashApplyRepoCounts === 'function') {
                            global.emsDashApplyRepoCounts();
                        }
                    } catch (dashErr) {
                        console.warn('[EMS] dashboard repo count reconcile:', dashErr);
                    }

                    if (document.getElementById('module-dashboard') &&
                        document.getElementById('module-dashboard').classList.contains('active') &&
                        typeof global.emsRenderDashboardPanels === 'function') {
                        global.emsRenderDashboardPanels();
                    }
                }, function () { /* permission */ });
        } catch (e) {
            state.active = false;
        }
    };

    global.emsStopDashboardStatsListener = function () {
        if (state.unsub) {
            try { state.unsub(); } catch (e) { /* ignore */ }
            state.unsub = null;
        }
        state.active = false;
    };

    global.emsRefreshDashboardStats = function () {
        if (!firebase.functions) return Promise.resolve(null);
        var tid = getTenantId();
        if (!tid) return Promise.resolve(null);
        return firebase.functions().httpsCallable('refreshTenantDashboardStats')({ tenantId: tid })
            .then(function (res) { return res.data; })
            .catch(function () { return null; });
    };
})(typeof window !== 'undefined' ? window : globalThis);
