// ============================================================================
// EMS Performance Settings UI (Phase 2 Sprint 3)
// ============================================================================
(function (global) {
    'use strict';

    function el(id) {
        return document.getElementById(id);
    }

    function setHtml(id, html) {
        var node = el(id);
        if (node) node.innerHTML = html;
    }

    global.emsPerfSettingsRenderUI = function () {
        var idbHtml = '<span style="color:#94a3b8;">IndexedDB دستیاب نہیں</span>';
        var backendName = (global.emsRepo && typeof global.emsRepo.backendName === 'function')
            ? global.emsRepo.backendName()
            : null;

        if (backendName === 'native') {
            idbHtml = 'Backend: <b>Native (SQLite / fs-JSON)</b>';
            setHtml('perf-idb-status', idbHtml);
            if (global.emsDesktop && global.emsDesktop.isDesktop && typeof global.emsDesktop.getAppInfo === 'function') {
                global.emsDesktop.getAppInfo().then(function (info) {
                    if (!info || !info.dbEngine) return;
                    setHtml('perf-idb-status', idbHtml + ' — <b>' + info.dbEngine + '</b>');
                }).catch(function () { /* ignore */ });
            }
        } else {
            var idbPromise = typeof global.emsIdbStats === 'function'
                ? global.emsIdbStats()
                : Promise.resolve({ supported: false, keys: 0 });

            idbPromise.then(function (stats) {
                if (stats.supported) {
                    idbHtml = 'IndexedDB: <b>' + stats.keys + '</b> بڑے ذخیرے';
                }
                if (backendName) {
                    idbHtml += ' · Backend: <b>' + backendName + '</b>';
                }
                setHtml('perf-idb-status', idbHtml);
            });
        }

        var users = [];
        var rejected = [];
        if (typeof global.emsRegRepoGetList === 'function') {
            try { users = global.emsRegRepoGetList() || []; } catch (eUsers) { users = []; }
        }
        if (!users.length && typeof global.emsCacheGet === 'function') {
            users = global.emsCacheGet('ems_full_users', []);
        }
        if (typeof global.emsCacheGet === 'function') {
            rejected = global.emsCacheGet('ems_rejected_users', []);
        }
        var syncActive = typeof global.emsIsRegistrationSyncActive === 'function'
            && global.emsIsRegistrationSyncActive();
        var statsDoc = typeof global.emsGetDashboardStats === 'function'
            ? global.emsGetDashboardStats()
            : null;

        var desktopLine = '';
        if (global.emsDesktop && global.emsDesktop.isDesktop && typeof global.emsDesktop.getAppInfo === 'function') {
            global.emsDesktop.getAppInfo().then(function (info) {
                if (!info) return;
                var modeLabel = info.bundleMode === 'local'
                    ? 'مقامی dist (' + (info.bundleFileCount || '?') + ' فائلیں)'
                    : (info.bundleMode === 'remote-fallback' ? 'آن لائن (fallback)' : 'آن لائن');
                setHtml('perf-desktop-bundle',
                    '<div style="font-size:13px;color:#475569;margin-bottom:12px;">' +
                    '<i class="fas fa-desktop"></i> Desktop bundle: <b>' + modeLabel + '</b>' +
                    (info.bundleBuiltAt ? ' — built ' + info.bundleBuiltAt : '') +
                    '</div>');
            }).catch(function () { /* ignore */ });
        }

        setHtml('perf-local-summary',
            '<ul style="margin:0;padding-right:18px;font-size:13px;color:#475569;">' +
            '<li>رجسٹریشن (مقامی): <b>' + users.length + '</b></li>' +
            '<li>مسترد: <b>' + rejected.length + '</b></li>' +
            '<li>Registration meta listener: <b>' + (syncActive ? 'فعال' : 'موقوف/بند') + '</b></li>' +
            '<li>DashboardStats: <b>' + (statsDoc && statsDoc.version >= 2 ? 'موجود' : 'ابھی نہیں') + '</b></li>' +
            '</ul>');

        global.emsPerfRenderOnlineMode();
        global.emsPerfRenderNativeAccount();
    };

    global.emsPerfRenderNativeAccount = function () {
        var panel = el('ems-native-account-panel');
        var emailEl = el('ems-native-account-email');
        if (!panel) return;
        var isNative = typeof global.emsIsNativeApp === 'function' && global.emsIsNativeApp();
        panel.style.display = isNative ? 'block' : 'none';
        if (!isNative || !emailEl) return;
        var label = typeof global.emsGetNativeAccountLabel === 'function'
            ? global.emsGetNativeAccountLabel()
            : '—';
        var snap = typeof global.emsReadOfflineSession === 'function'
            ? global.emsReadOfflineSession()
            : null;
        var tenant = snap && snap.tenantId ? snap.tenantId : (global.CURRENT_MADRASA_TENANT_ID || '—');
        emailEl.innerHTML = '<i class="fas fa-user-circle"></i> ' + label +
            '<div style="font-size:12px;color:#64748b;font-weight:400;margin-top:4px;">Tenant: ' + tenant + '</div>';
    };

    global.emsPerfRenderOnlineMode = function () {
        var status = typeof global.emsGetOnlineStatus === 'function'
            ? global.emsGetOnlineStatus()
            : { enabled: false };
        var enabled = !!status.enabled;
        var toggleBtn = el('ems-online-toggle-btn');
        var pushBtn = el('ems-cloud-push-btn');
        var pullBtn = el('ems-cloud-pull-btn');

        var parts = [];
        parts.push('حالت: <b>' + (enabled ? 'آن لائن موڈ فعال' : 'آف لائن موڈ (default)') + '</b>');
        if (status.persisted === true && !enabled) {
            parts.push('محفوظ ترجیح: <b>آن لائن</b> (ابھی آف لائن)');
        } else if (status.persisted === false && enabled) {
            parts.push('محفوظ ترجیح: <b>آف لائن</b> (ابھی آن لائن)');
        }
        if (enabled) {
            parts.push('Firebase: <b>' + (status.firebaseReady ? 'تیار' : 'لوڈ ہو رہا…') + '</b>');
            parts.push('لاگ اِن: <b>' + (status.signedIn ? 'ہاں' : 'نہیں (سنک کے لیے لاگ اِن ضروری)') + '</b>');
            parts.push('نیٹ ورک: <b>' + (status.networkAvailable ? 'دستیاب' : 'غیر دستیاب') + '</b>');
            if (status.sync) {
                parts.push('ماڈیول قطار: <b>' + (status.sync.pending || 0) + '</b>');
                if (status.sync.failed) parts.push('ناکام: <b>' + status.sync.failed + '</b>');
            }
        }
        setHtml('ems-online-mode-status', parts.join(' · '));

        if (typeof global.emsPendingSyncCount === 'function') {
            global.emsPendingSyncCount().then(function (outboxPending) {
                if (outboxPending == null) return;
                var extra = parts.slice();
                if (enabled) {
                    extra.push('آف لائن قطار: <b>' + outboxPending + '</b>');
                }
                setHtml('ems-online-mode-status', extra.join(' · '));
            }).catch(function () { /* ignore */ });
        }

        if (toggleBtn) {
            toggleBtn.className = enabled ? 'btn btn-danger' : 'btn btn-success';
            toggleBtn.innerHTML = enabled
                ? '<i class="fas fa-power-off"></i> آف لائن موڈ پر جائیں'
                : '<i class="fas fa-power-off"></i> آن لائن موڈ آن کریں';
        }
        var syncDisabled = !enabled;
        if (pushBtn) pushBtn.disabled = syncDisabled || !(status.signedIn);
        if (pullBtn) pullBtn.disabled = syncDisabled || !(status.signedIn);
        var dashBtn = el('perf-dash-refresh-btn');
        if (dashBtn) dashBtn.disabled = syncDisabled || !(status.signedIn);
    };

    function logAction(msg) {
        var log = el('perf-action-log');
        if (log) log.innerHTML = '<div>' + msg + '</div>' + log.innerHTML;
    }

    global.emsPerfToggleOnlineMode = function () {
        var enabled = typeof global.emsGetOnlineStatus === 'function' && global.emsGetOnlineStatus().enabled;
        if (enabled) {
            if (typeof global.emsDisableOnlineMode === 'function') {
                global.emsDisableOnlineMode({ reload: true });
            }
            logAction('آف لائن موڈ فعال — صفحہ ری لوڈ ہو رہا ہے…');
            return;
        }
        var btn = el('ems-online-toggle-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> آن لائن ہو رہا…'; }
        var p = typeof global.emsEnableOnlineMode === 'function'
            ? global.emsEnableOnlineMode()
            : Promise.resolve({ enabled: false });
        p.then(function (st) {
            logAction('آن لائن موڈ فعال — Firebase ' + (st && st.firebaseReady ? 'تیار' : 'لوڈ ہوا') + '۔ سنک کے لیے لاگ اِن کریں۔');
        }).catch(function (e) {
            logAction('آن لائن موڈ ناکام: ' + (e && e.message ? e.message : e));
        }).then(function () {
            if (btn) btn.disabled = false;
            global.emsPerfRenderOnlineMode();
        });
    };

    var GATE_MSG = {
        offline_mode: 'پہلے آن لائن موڈ آن کریں۔',
        no_network: 'انٹرنیٹ دستیاب نہیں۔',
        not_signed_in: 'پہلے Firebase میں لاگ اِن کریں۔',
        no_tenant: 'ادارہ (tenant) دستیاب نہیں۔'
    };

    global.emsPerfCloudPush = function () {
        var btn = el('ems-cloud-push-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> اپ لوڈ…'; }
        var p = typeof global.emsCloudPushNow === 'function' ? global.emsCloudPushNow() : Promise.resolve({ ok: false, reason: 'offline_mode' });
        p.then(function (r) {
            if (r && r.ok) logAction('اپ لوڈ مکمل — تبدیلیاں Firebase میں محفوظ۔');
            else logAction('اپ لوڈ رکا: ' + (GATE_MSG[r && r.reason] || (r && r.error) || 'نامعلوم'));
        }).then(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Firebase میں اپ لوڈ'; }
            global.emsPerfRenderOnlineMode();
        });
    };

    global.emsPerfCloudPull = function () {
        if (typeof global.emsCloudPullExecute === 'function') {
            return global.emsCloudPullExecute({ scope: 'all' }).then(function (r) {
                if (r && r.ok !== false && r.reason !== 'cancelled') {
                    logAction('ڈاؤن لوڈ مکمل — Firebase سے تازہ ڈیٹا آ گیا۔');
                } else if (r && r.reason === 'cancelled') {
                    logAction('ڈاؤن لوڈ منسوخ۔');
                } else {
                    logAction('ڈاؤن لوڈ رکا: ' + (GATE_MSG[r && r.reason] || (r && r.error) || 'نامعلوم'));
                }
                global.emsPerfRenderOnlineMode();
                return r;
            });
        }
        var btn = el('ems-cloud-pull-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ڈاؤن لوڈ…'; }
        var p = typeof global.emsCloudPullNow === 'function' ? global.emsCloudPullNow() : Promise.resolve({ ok: false, reason: 'offline_mode' });
        p.then(function (r) {
            if (r && r.ok) logAction('ڈاؤن لوڈ مکمل — Firebase سے تازہ ڈیٹا آ گیا۔');
            else logAction('ڈاؤن لوڈ رکا: ' + (GATE_MSG[r && r.reason] || (r && r.error) || 'نامعلوم'));
        }).then(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Firebase سے ڈاؤن لوڈ'; }
            global.emsPerfRenderOnlineMode();
        });
    };

    global.emsPerfRefreshDashboardStats = function () {
        var btn = el('perf-dash-refresh-btn');
        var log = el('perf-action-log');
        var status = typeof global.emsGetOnlineStatus === 'function'
            ? global.emsGetOnlineStatus()
            : { enabled: false, signedIn: false };
        if (!status.enabled || !status.signedIn) {
            if (log) log.textContent = GATE_MSG.offline_mode + ' ' + GATE_MSG.not_signed_in;
            return;
        }
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ریفریش...';
        }
        if (log) log.textContent = 'DashboardStats rebuild شروع...';

        var p = typeof global.emsRefreshDashboardStats === 'function'
            ? global.emsRefreshDashboardStats()
            : Promise.resolve(null);

        p.then(function (res) {
            if (log) {
                log.textContent = res
                    ? '✅ مکمل — counts: ' + JSON.stringify(res.counts || {})
                    : '⚠️ callable ناکام یا Firebase functions دستیاب نہیں';
            }
            global.emsPerfSettingsRenderUI();
        }).finally(function () {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync"></i> DashboardStats ریفریش';
            }
        });
    };

    global.emsPerfHydrateIdb = function () {
        var log = el('perf-action-log');
        if (log) log.textContent = 'IndexedDB سے memory cache hydrate...';
        if (typeof global.emsIdbHydrateCache !== 'function') {
            if (log) log.textContent = 'IndexedDB module نہیں ملا';
            return;
        }
        global.emsIdbHydrateCache().then(function (r) {
            if (log) log.textContent = '✅ ' + r.hydrated + ' keys hydrated';
            global.emsPerfSettingsRenderUI();
        });
    };

    global.emsPerfDownloadTenantBackup = function () {
        var log = el('perf-action-log');
        if (typeof global.EmsBackupService === 'undefined' ||
            typeof global.EmsBackupService.downloadLocalBackup !== 'function') {
            if (log) log.textContent = '⚠️ EmsBackupService دستیاب نہیں — ایڈمن پینل → بیک اپ استعمال کریں';
            return;
        }
        if (log) log.textContent = 'مقامی JSON بیک اپ ڈاؤنلوڈ...';
        try {
            global.EmsBackupService.downloadLocalBackup();
            if (log) log.textContent = '✅ JSON بیک اپ ڈاؤنلوڈ شروع';
        } catch (e) {
            if (log) log.textContent = '⚠️ بیک اپ ناکام: ' + (e.message || e);
        }
    };

    global.emsPerfMigrationChecklist = function () {
        var log = el('perf-action-log');
        var lines = [];
        var users = typeof global.emsCacheGet === 'function'
            ? global.emsCacheGet('ems_full_users', [])
            : [];
        var statsDoc = typeof global.emsGetDashboardStats === 'function'
            ? global.emsGetDashboardStats()
            : null;
        lines.push('رجسٹریشن: ' + users.length + ' ریکارڈ');
        lines.push('DashboardStats: ' + (statsDoc && statsDoc.version >= 2 ? '✅' : '⚠️ refresh کریں'));
        lines.push('Storage: Console میں initialize → firebase deploy --only storage');
        lines.push('Cloud backup: npm run backup:snapshot (rules) + gcloud firestore export');
        lines.push('تصویر مائیگریشن: Storage live کے بعد چلائیں');
        if (log) log.innerHTML = lines.map(function (l) { return '<div>' + l + '</div>'; }).join('');
    };

    global.emsPerfArchiveAcademicYear = function () {
        var log = el('perf-action-log');
        var year = typeof global.emsGetAcademicYear === 'function' ? global.emsGetAcademicYear() : '';
        var input = window.prompt('آرکائیو کرنے کا تعلیمی سال (مثلاً 2023-2024):', year);
        if (!input) return;
        if (log) log.textContent = 'تعلیمی سال ' + input + ' آرکائیو ہو رہا ہے...';
        var p = typeof global.emsArchiveRunYear === 'function'
            ? global.emsArchiveRunYear(input)
            : Promise.reject(new Error('ems-academic-archive.js نہیں ملا'));
        p.then(function (res) {
            var stats = res && res.stats ? res.stats : res;
            if (log) log.textContent = '✅ آرکائیو مکمل — ' + JSON.stringify(stats || {});
            global.emsPerfSettingsRenderUI();
        }).catch(function (err) {
            if (log) log.textContent = '⚠️ آرکائیو ناکام: ' + (err.message || err);
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
