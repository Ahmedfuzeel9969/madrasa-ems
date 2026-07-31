// ============================================================================
// EMS Enterprise Diagnostics UI — System Settings → Diagnostics
// ============================================================================
(function (global) {
    'use strict';

    var lastReport = null;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function row(label, value) {
        return '<tr><td style="padding:6px 10px;font-weight:600;color:#475569;white-space:nowrap;">'
            + esc(label) + '</td><td style="padding:6px 10px;font-family:monospace;font-size:12px;word-break:break-all;">'
            + esc(value) + '</td></tr>';
    }

    function renderReport(report) {
        lastReport = report;
        var el = document.getElementById('ems-diag-report-body');
        if (!el || !report) return;

        var auth = report.authentication || {};
        var repo = report.repository || {};
        var fs = report.firestore || {};
        var idb = report.indexedDB || {};
        var live = report.liveSync || {};
        var dash = report.dashboard || {};
        var vis = report.visibility || {};

        el.innerHTML = '<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;">'
            + row('Auth UID', auth.currentUserUid)
            + row('Tenant ID', auth.currentTenantId)
            + row('Tenant Role', auth.tenantRole)
            + row('Department', auth.departmentId)
            + row('Repository Ready', repo.readyFlag)
            + row('Boot Complete', report.bootComplete)
            + row('Repository Count', repo.recordsCount)
            + row('IndexedDB Users', idb.cachedUsersCount)
            + row('Memory Repo Count', repo.recordsCount)
            + row('IDB-Only Boot', report.idbOnlyBoot ? 'yes' : 'no')
            + row('Firestore Registrations', fs.registrationsQueryCount)
            + row('Live Sync Active', live.listenerActive)
            + row('Snapshot Received', live.snapshotReceived)
            + row('Last Sync', live.lastSyncTime ? new Date(live.lastSyncTime).toLocaleString() : '—')
            + row('Sync Error', live.lastError || '—')
            + row('DashboardStats', dash.dashboardStatsAvailable)
            + row('Stats Students', dash.statsStudentCount)
            + row('Visibility', vis.status)
            + row('Hint', vis.rootCauseHint || '—')
            + '</table>';
    }

    global.emsDiagnosticsUIRun = function () {
        var status = document.getElementById('ems-diag-status');
        if (status) status.textContent = 'لوڈ ہو رہا ہے...';
        var fn = global.emsEnterpriseDiagnostic;
        if (typeof fn !== 'function') {
            if (status) status.textContent = 'emsEnterpriseDiagnostic دستیاب نہیں';
            return Promise.resolve(null);
        }
        return fn().then(function (report) {
            report.bootComplete = !!global.EMS_REPOSITORY_BOOT_COMPLETE;
            report.idbOnlyBoot = global.EMS_REGISTRATION_IDB_ONLY_BOOT === true
                || (global.EMS_DESKTOP_UNLIMITED === true);
            renderReport(report);
            if (status) status.textContent = 'تازہ ترین: ' + new Date().toLocaleTimeString();
            return report;
        }).catch(function (err) {
            if (status) status.textContent = 'خرابی: ' + (err && err.message);
            return null;
        });
    };

    global.emsDiagnosticsUIExport = function () {
        if (!lastReport) {
            global.emsDiagnosticsUIRun().then(function (r) {
                if (r) global.emsDiagnosticsUIExport();
            });
            return;
        }
        var blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ems-diagnostic-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    global.emsDiagnosticsUIInit = function () {
        var btnRun = document.getElementById('ems-diag-btn-run');
        var btnExport = document.getElementById('ems-diag-btn-export');
        if (btnRun && !btnRun._bound) {
            btnRun._bound = true;
            btnRun.addEventListener('click', function () { global.emsDiagnosticsUIRun(); });
        }
        if (btnExport && !btnExport._bound) {
            btnExport._bound = true;
            btnExport.addEventListener('click', function () { global.emsDiagnosticsUIExport(); });
        }
        var btnRebuild = document.getElementById('ems-diag-btn-rebuild-cache');
        if (btnRebuild && !btnRebuild._bound) {
            btnRebuild._bound = true;
            btnRebuild.addEventListener('click', function () {
                var runSync = (typeof global.emsCloudPullExecute === 'function')
                    ? function () { return global.emsCloudPullExecute({ scope: 'registrations' }); }
                    : ((typeof global.emsForceCloudDisasterRecoverySync === 'function')
                        ? function () { return global.emsForceCloudDisasterRecoverySync(); }
                        : (typeof global.regRepoDisasterRecoverySync === 'function'
                            ? global.regRepoDisasterRecoverySync
                            : null));
                if (!runSync) {
                    if (typeof global.showToast === 'function') {
                        global.showToast('Cloud Sync not loaded — open Registration module first', 'error');
                    }
                    return;
                }
                btnRebuild.disabled = true;
                Promise.resolve(runSync()).then(function () {
                    btnRebuild.disabled = false;
                    global.emsDiagnosticsUIRun();
                }).catch(function () {
                    btnRebuild.disabled = false;
                });
            });
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
