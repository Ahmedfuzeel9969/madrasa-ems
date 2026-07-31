// ============================================================================
// ادارہ ایڈمن کنٹرول پینل (Madrasa Admin Control) — Stage 1 + Stage 2
// ----------------------------------------------------------------------------
// Stage 1: عملہ مینجمنٹ، شعبہ جات کی تفویض، تیار شدہ ٹیمپلیٹس
// Stage 2: شعبے کے اندر تفصیلی اعمال (View/Create/Edit/Delete/Export)،
//          عارضی اجازتیں (1/7/30 دن، خودکار اختتام)، اجازت ہسٹری (کس نے/کب)
//
// ڈیٹا: Firestore (ModuleData) + IndexedDB queue؛ localStorage صرف UI cache
// ============================================================================
(function () {
    'use strict';

    function apTenantDoc(db, tenantId) {
        if (typeof window.emsFirestoreTenantDocRef === 'function') {
            return window.emsFirestoreTenantDocRef(db, tenantId);
        }
        return db.collection('All_Madrasas').doc(tenantId);
    }

    function apTenantSubCol(db, tenantId, sub) {
        if (typeof window.emsFirestoreSubColRef === 'function') {
            return window.emsFirestoreSubColRef(db, tenantId, sub);
        }
        return apTenantDoc(db, tenantId).collection(sub);
    }

    var DB_USERS = (window.DB && window.DB.users) ? window.DB.users : 'ems_full_users';
    var DB_STAFF_PERM = 'ems_staff_permissions';
    var DB_PARENT_PERM = 'ems_parent_permissions';
    var DB_PARENT_MSG = 'ems_parent_messages';

    // PARENT_VIEWS, PARENT_MSG_CATEGORIES, apGetParentPerm, parentCanView,
    // parentSubmitMessage — see parent-shared.js (loaded before this module)

    // عملہ کے لیے قابلِ کنٹرول شعبے (موجودہ ماڈیولز)
    window.ADMIN_STAFF_MODULES = [
        { id: 'dashboard', name: 'ڈیش بورڈ', icon: 'fa-chart-line' },
        { id: 'admission', name: 'داخلہ / رجسٹریشن', icon: 'fa-user-plus' },
        { id: 'attendance', name: 'حاضری', icon: 'fa-calendar-check' },
        { id: 'exams', name: 'امتحانات', icon: 'fa-graduation-cap' },
        { id: 'curriculum', name: 'نصاب', icon: 'fa-book-open' },
        { id: 'training', name: 'تربیت و نظم', icon: 'fa-mosque' },
        { id: 'finance', name: 'فیس سسٹم', icon: 'fa-money-bill-wave' },
        { id: 'ledger', name: 'مالیات و تنخواہ', icon: 'fa-wallet' },
        { id: 'complaints', name: 'شکایات', icon: 'fa-exclamation-triangle' },
        { id: 'announcements', name: 'اعلانات و فیصلے', icon: 'fa-bullhorn' }
    ];

    // ہر شعبے کے اندر معیاری اعمال (Stage 2)
    window.ADMIN_ACTIONS = [
        { id: 'view', name: 'دیکھیں', icon: 'fa-eye' },
        { id: 'create', name: 'بنائیں', icon: 'fa-plus' },
        { id: 'edit', name: 'ترمیم', icon: 'fa-pen' },
        { id: 'delete', name: 'حذف', icon: 'fa-trash' },
        { id: 'export', name: 'رپورٹ/ایکسپورٹ', icon: 'fa-file-export' },
        { id: 'print', name: 'پرنٹ', icon: 'fa-print' },
        { id: 'import', name: 'بلک امپورٹ', icon: 'fa-file-import' },
        { id: 'approve1', name: 'منظوری سطح 1', icon: 'fa-check' },
        { id: 'approve2', name: 'منظوری سطح 2', icon: 'fa-check-double' }
    ];

    // عارضی اجازت کے دورانیے
    window.ADMIN_TEMP_DURATIONS = [
        { id: 1, name: '1 دن' },
        { id: 7, name: '7 دن' },
        { id: 30, name: '30 دن' }
    ];

    function apKeyTtlOptionsHtml() {
        var opts = window.ACCESS_KEY_TTL_OPTIONS || [{ days: 365, label: '365 دن' }];
        var saved = window.EMS_TENANT_KEY_TTL_DAYS || 365;
        try {
            var raw = localStorage.getItem('ems_access_key_ttl_days');
            if (raw) saved = parseInt(raw, 10) || saved;
        } catch (e) { /* ignore */ }
        return opts.map(function (o) {
            return '<option value="' + o.days + '"' + (o.days === saved ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');
    }

    function apGetKeyTtlMs(selectId) {
        var el = document.getElementById(selectId);
        var days = el ? parseInt(el.value, 10) : (window.EMS_TENANT_KEY_TTL_DAYS || 365);
        if (!days || days < 1) days = window.EMS_TENANT_KEY_TTL_DAYS || 365;
        try { localStorage.setItem('ems_access_key_ttl_days', String(days)); } catch (e) { /* ignore */ }
        if (typeof window.emsAccessKeyTtlMs === 'function') return window.emsAccessKeyTtlMs(days);
        return days * 86400000;
    }

    window.apLoadTenantKeySettings = function () {
        var uid = apGetUid();
        var sel = document.getElementById('ap-tenant-key-ttl');
        var status = document.getElementById('ap-tenant-key-ttl-status');
        if (!uid || typeof window.emsLoadTenantAccessKeySettings !== 'function') return Promise.resolve();
        return window.emsLoadTenantAccessKeySettings(uid).then(function (s) {
            window.EMS_TENANT_KEY_TTL_DAYS = s.defaultTtlDays || 365;
            if (sel) sel.value = String(window.EMS_TENANT_KEY_TTL_DAYS);
            if (status) status.textContent = s.updatedBy ? ('آخری تبدیلی: ' + (s.updatedBy || '')) : '';
            try { localStorage.setItem('ems_access_key_ttl_days', String(window.EMS_TENANT_KEY_TTL_DAYS)); } catch (e) { /* ignore */ }
        });
    };

    window.apSaveTenantKeySettings = function () {
        var uid = apGetUid();
        var sel = document.getElementById('ap-tenant-key-ttl');
        if (!uid || !sel || typeof window.emsSaveTenantAccessKeySettings !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var days = parseInt(sel.value, 10) || 365;
        window.emsSaveTenantAccessKeySettings(uid, { defaultTtlDays: days }).then(function () {
            window.EMS_TENANT_KEY_TTL_DAYS = days;
            apToast('ڈیفالٹ TTL محفوظ: ' + days + ' دن', 'success');
            var status = document.getElementById('ap-tenant-key-ttl-status');
            if (status) status.textContent = 'محفوظ — ' + days + ' دن';
        }).catch(function (e) { apToast('محفوظ ناکام: ' + e.message, 'error'); });
    };

    window.apLoadSecurityPolicy = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsLoadTenantSecurityPolicy !== 'function') return Promise.resolve();
        return window.emsLoadTenantSecurityPolicy(uid).then(function (p) {
            var el = function (id) { return document.getElementById(id); };
            if (el('ap-sp-require-key')) el('ap-sp-require-key').checked = !!p.requireAccessKey;
            if (el('ap-sp-expiry-alerts')) el('ap-sp-expiry-alerts').checked = !!p.enableKeyExpiryAlerts;
            if (el('ap-sp-notify-owner')) el('ap-sp-notify-owner').checked = !!p.notifyOwnerOnKeyExpiry;
            if (el('ap-sp-email-delivery')) el('ap-sp-email-delivery').checked = p.enableEmailDelivery !== false;
            if (el('ap-sp-push-delivery')) el('ap-sp-push-delivery').checked = p.enablePushDelivery !== false;
            if (el('ap-sp-parent-reply-push')) el('ap-sp-parent-reply-push').checked = p.notifyParentOnAdminReply !== false;
            if (el('ap-sp-audit-schedule')) el('ap-sp-audit-schedule').checked = p.enableScheduledAuditExport !== false;
            if (el('ap-sp-compliance-retention')) el('ap-sp-compliance-retention').checked = p.enableComplianceRetention !== false;
            if (el('ap-sp-audit-retention-days')) el('ap-sp-audit-retention-days').value = String(p.auditRetentionDays || 365);
            if (el('ap-sp-session-registry')) el('ap-sp-session-registry').checked = p.enableLoginSessionRegistry !== false;
            if (el('ap-sp-max-sessions')) el('ap-sp-max-sessions').value = String(p.maxActiveSessionsPerUser || 5);
            if (el('ap-sp-trusted-device')) el('ap-sp-trusted-device').checked = !!p.requireTrustedDeviceForStaff;
            if (el('ap-sp-trusted-parent')) el('ap-sp-trusted-parent').checked = !!p.requireTrustedDeviceForParents;
            if (el('ap-sp-trusted-expiry-days')) el('ap-sp-trusted-expiry-days').value = String(p.trustedDeviceExpiryDays || 0);
            if (el('ap-sp-trusted-notify')) el('ap-sp-trusted-notify').checked = p.notifyOwnerOnTrustedDeviceRequest !== false;
            if (el('ap-sp-device-rate-limit')) el('ap-sp-device-rate-limit').value = String(p.trustedDeviceMaxRequestsPerDay || 0);
            if (el('ap-sp-webhook-enable')) el('ap-sp-webhook-enable').checked = !!p.enableSecurityWebhooks;
            if (el('ap-sp-webhook-url')) el('ap-sp-webhook-url').value = p.securityWebhookUrl || '';
            if (el('ap-sp-webhook-secret')) el('ap-sp-webhook-secret').value = p.securityWebhookSecret || '';
            if (el('ap-sp-alert-digest')) el('ap-sp-alert-digest').checked = !!p.enableSecurityAlertDigest;
            if (el('ap-sp-alert-threshold')) el('ap-sp-alert-threshold').value = String(p.securityAlertThreshold7d != null ? p.securityAlertThreshold7d : 5);
            if (el('ap-sp-alert-notify')) el('ap-sp-alert-notify').checked = p.notifyOwnerOnSecurityAlert !== false;
            if (el('ap-sp-ip-allowlist')) el('ap-sp-ip-allowlist').checked = !!p.enableIpAllowlist;
            if (el('ap-sp-ip-ranges')) el('ap-sp-ip-ranges').value = (p.allowedIpRanges || []).join('\n');
            if (el('ap-sp-country-allowlist')) el('ap-sp-country-allowlist').checked = !!p.enableCountryAllowlist;
            if (el('ap-sp-countries')) el('ap-sp-countries').value = (p.allowedCountries || []).join(', ');
            if (el('ap-sp-brute-force')) el('ap-sp-brute-force').checked = !!p.enableLoginBruteForceProtection;
            if (el('ap-sp-max-login-failures')) el('ap-sp-max-login-failures').value = String(p.maxLoginFailuresPerEmail != null ? p.maxLoginFailuresPerEmail : 5);
            if (el('ap-sp-lockout-minutes')) el('ap-sp-lockout-minutes').value = String(p.loginLockoutMinutes != null ? p.loginLockoutMinutes : 15);
            if (el('ap-sp-session-anomaly')) el('ap-sp-session-anomaly').checked = !!p.enableSessionAnomalyDetection;
            if (el('ap-sp-session-anomaly-notify')) el('ap-sp-session-anomaly-notify').checked = p.notifyOwnerOnSessionAnomaly !== false;
            if (el('ap-sp-session-anomaly-max')) el('ap-sp-session-anomaly-max').value = String(p.sessionAnomalyMaxPerHour != null ? p.sessionAnomalyMaxPerHour : 3);
            if (el('ap-sp-parent-cf')) el('ap-sp-parent-cf').checked = !!p.parentDataCfOnly;
            if (el('ap-sp-msg-cf')) el('ap-sp-msg-cf').checked = !!p.parentMessagingCfOnly;
            if (el('ap-sp-staff-rbac')) el('ap-sp-staff-rbac').checked = !!p.enforceStaffRbac;
            if (el('ap-sp-reminder-days')) el('ap-sp-reminder-days').value = String(p.keyRotationReminderDays || 30);
        });
    };

    window.apSaveSecurityPolicy = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsSaveTenantSecurityPolicy !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var patch = {
            requireAccessKey: !!(document.getElementById('ap-sp-require-key') || {}).checked,
            enableKeyExpiryAlerts: !!(document.getElementById('ap-sp-expiry-alerts') || {}).checked,
            notifyOwnerOnKeyExpiry: !!(document.getElementById('ap-sp-notify-owner') || {}).checked,
            enableEmailDelivery: !!(document.getElementById('ap-sp-email-delivery') || {}).checked,
            enablePushDelivery: !!(document.getElementById('ap-sp-push-delivery') || {}).checked,
            notifyParentOnAdminReply: !!(document.getElementById('ap-sp-parent-reply-push') || {}).checked,
            enableScheduledAuditExport: !!(document.getElementById('ap-sp-audit-schedule') || {}).checked,
            enableComplianceRetention: !!(document.getElementById('ap-sp-compliance-retention') || {}).checked,
            auditRetentionDays: parseInt((document.getElementById('ap-sp-audit-retention-days') || {}).value, 10) || 365,
            enableLoginSessionRegistry: !!(document.getElementById('ap-sp-session-registry') || {}).checked,
            maxActiveSessionsPerUser: parseInt((document.getElementById('ap-sp-max-sessions') || {}).value, 10) || 5,
            requireTrustedDeviceForStaff: !!(document.getElementById('ap-sp-trusted-device') || {}).checked,
            requireTrustedDeviceForParents: !!(document.getElementById('ap-sp-trusted-parent') || {}).checked,
            trustedDeviceExpiryDays: parseInt((document.getElementById('ap-sp-trusted-expiry-days') || {}).value, 10) || 0,
            notifyOwnerOnTrustedDeviceRequest: !!(document.getElementById('ap-sp-trusted-notify') || {}).checked,
            trustedDeviceMaxRequestsPerDay: parseInt((document.getElementById('ap-sp-device-rate-limit') || {}).value, 10) || 0,
            enableSecurityWebhooks: !!(document.getElementById('ap-sp-webhook-enable') || {}).checked,
            securityWebhookUrl: ((document.getElementById('ap-sp-webhook-url') || {}).value || '').trim(),
            securityWebhookSecret: ((document.getElementById('ap-sp-webhook-secret') || {}).value || '').trim(),
            enableSecurityAlertDigest: !!(document.getElementById('ap-sp-alert-digest') || {}).checked,
            securityAlertThreshold7d: parseInt((document.getElementById('ap-sp-alert-threshold') || {}).value, 10) || 0,
            notifyOwnerOnSecurityAlert: !!(document.getElementById('ap-sp-alert-notify') || {}).checked,
            enableIpAllowlist: !!(document.getElementById('ap-sp-ip-allowlist') || {}).checked,
            allowedIpRanges: (((document.getElementById('ap-sp-ip-ranges') || {}).value || '')
                .split(/[,;\s\n]+/).filter(Boolean)),
            enableCountryAllowlist: !!(document.getElementById('ap-sp-country-allowlist') || {}).checked,
            allowedCountries: (((document.getElementById('ap-sp-countries') || {}).value || '')
                .split(/[,;\s\n]+/).filter(Boolean)),
            enableLoginBruteForceProtection: !!(document.getElementById('ap-sp-brute-force') || {}).checked,
            maxLoginFailuresPerEmail: parseInt((document.getElementById('ap-sp-max-login-failures') || {}).value, 10) || 5,
            loginLockoutMinutes: parseInt((document.getElementById('ap-sp-lockout-minutes') || {}).value, 10) || 15,
            enableSessionAnomalyDetection: !!(document.getElementById('ap-sp-session-anomaly') || {}).checked,
            notifyOwnerOnSessionAnomaly: !!(document.getElementById('ap-sp-session-anomaly-notify') || {}).checked,
            sessionAnomalyMaxPerHour: parseInt((document.getElementById('ap-sp-session-anomaly-max') || {}).value, 10) || 3,
            parentDataCfOnly: !!(document.getElementById('ap-sp-parent-cf') || {}).checked,
            parentMessagingCfOnly: !!(document.getElementById('ap-sp-msg-cf') || {}).checked,
            enforceStaffRbac: !!(document.getElementById('ap-sp-staff-rbac') || {}).checked,
            keyRotationReminderDays: parseInt((document.getElementById('ap-sp-reminder-days') || {}).value, 10) || 30
        };
        window.emsSaveTenantSecurityPolicy(uid, patch).then(function () {
            apToast('سیکیورٹی پالیسی محفوظ ہو گئی۔', 'success');
            var st = document.getElementById('ap-security-policy-status');
            if (st) st.textContent = 'محفوظ';
        }).catch(function (e) { apToast('محفوظ ناکام: ' + e.message, 'error'); });
    };

    window.apLoadKeyAlerts = function () {
        var tbody = document.getElementById('ap-key-alerts-tbody');
        var summary = document.getElementById('ap-key-alerts-summary');
        var uid = apGetUid();
        if (!tbody || !uid || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('getKeyExpiryAlerts', { tenantId: uid }).then(function (res) {
            var alerts = (res && res.alerts) ? res.alerts : [];
            if (summary) summary.textContent = alerts.length ? (alerts.length + ' فعال reminder') : 'کوئی reminder نہیں';
            if (!alerts.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#16a085;">کوئی reminder نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = alerts.map(function (a) {
                var badge = a.status === 'expired'
                    ? '<span class="ap-badge ap-badge-off">ختم</span>'
                    : '<span class="ap-badge ap-badge-temp">' + (a.daysLeft || '?') + ' دن</span>';
                var dismiss = '<button type="button" class="btn btn-outline btn-sm" onclick="window.apDismissKeyAlert(\'' + apEscAttr(a.id) + '\')"><i class="fas fa-check"></i></button>';
                return '<tr><td>' + (a.type === 'teacher' ? 'استاد' : 'والد') + '</td><td>' + apEsc(a.name) + '</td><td>' + badge + '</td>' +
                    '<td><small>' + apEsc(a.dateKey || '') + '</small></td><td>' + dismiss + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apDismissKeyAlert = function (alertId) {
        var uid = apGetUid();
        if (!uid || !alertId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('dismissKeyExpiryAlert', { tenantId: uid, alertId: alertId }).then(function () {
            apToast('Reminder dismiss ہو گیا۔', 'success');
            window.apLoadKeyAlerts();
        }).catch(function (e) { apToast('Dismiss ناکام: ' + e.message, 'error'); });
    };

    window.apExportSecurityLog = function (format) {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        format = format || 'json';
        apToast('Security log export...', 'warning');
        window.emsCallFunction('exportSecurityLog', { tenantId: uid, format: format, limit: 1000 }).then(function (res) {
            if (!res) { apToast('Export ناکام', 'error'); return; }
            var blob;
            var filename = 'ems-security-log-' + uid + '-' + Date.now();
            if (res.format === 'csv') {
                blob = new Blob([res.content || ''], { type: 'text/csv;charset=utf-8' });
                filename += '.csv';
            } else {
                blob = new Blob([JSON.stringify({ events: res.events, exportedAt: res.exportedAt }, null, 2)], { type: 'application/json' });
                filename += '.json';
            }
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
            apToast('Export مکمل: ' + (res.count || 0) + ' واقعات', 'success');
        }).catch(function (e) { apToast('Export ناکام: ' + e.message, 'error'); });
    };

    window.apLoadAuditExportStatus = function () {
        var uid = apGetUid();
        var elStatus = document.getElementById('ap-audit-export-status');
        if (!uid || !elStatus) return;
        var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
        if (!db) { elStatus.textContent = '—'; return; }
        apTenantSubCol(db, uid, 'TenantSettings').doc('auditExport').get()
            .then(function (doc) {
                if (!doc.exists) { elStatus.textContent = 'ابھی کوئی Cloud Storage export نہیں'; return; }
                var d = doc.data() || {};
                elStatus.textContent = 'آخری export: ' + (d.lastCount || 0) + ' واقعات — ' + (d.lastPath || '-');
            })
            .catch(function () { elStatus.textContent = '—'; });
    };

    window.apTriggerAuditExportToStorage = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        apToast('Cloud Storage export...', 'warning');
        window.emsCallFunction('triggerSecurityLogExport', { tenantId: uid, limit: 2000 }).then(function (res) {
            if (!res || !res.ok) { apToast('Storage export ناکام', 'error'); return; }
            apToast('Storage export: ' + (res.count || 0) + ' واقعات', 'success');
            window.apLoadAuditExportStatus();
            if (typeof window.apLoadAuditExportHistory === 'function') window.apLoadAuditExportHistory();
        }).catch(function (e) { apToast('Storage export ناکام: ' + e.message, 'error'); });
    };

    window.apDownloadAuditExportSignedUrl = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        apToast('Signed URL...', 'warning');
        window.emsCallFunction('getAuditExportDownloadUrl', { tenantId: uid }).then(function (res) {
            if (!res || !res.url) { apToast('Download URL ناکام', 'error'); return; }
            window.open(res.url, '_blank');
            apToast('Download link کھل گیا (15 منٹ valid)', 'success');
        }).catch(function (e) { apToast('Download ناکام: ' + e.message, 'error'); });
    };

    window.apLoadNotificationDelivery = function () {
        var uid = apGetUid();
        var input = document.getElementById('ap-fcm-vapid-key');
        var status = document.getElementById('ap-fcm-vapid-status');
        if (!uid || typeof window.emsLoadTenantNotificationDelivery !== 'function') return Promise.resolve();
        return window.emsLoadTenantNotificationDelivery(uid).then(function (d) {
            if (input) input.value = d.fcmVapidKey || '';
            if (status) status.textContent = d.fcmVapidKey ? 'VAPID محفوظ' : 'VAPID درکار (Firebase Console → Cloud Messaging)';
        });
    };

    window.apSaveNotificationDelivery = function () {
        var uid = apGetUid();
        var input = document.getElementById('ap-fcm-vapid-key');
        if (!uid || !input || typeof window.emsSaveTenantNotificationDelivery !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        window.emsSaveTenantNotificationDelivery(uid, { fcmVapidKey: input.value.trim() }).then(function () {
            apToast('VAPID key محفوظ ہو گئی۔', 'success');
            var status = document.getElementById('ap-fcm-vapid-status');
            if (status) status.textContent = 'محفوظ';
            if (typeof window.emsRegisterPushTokenIfAvailable === 'function') {
                window.emsRegisterPushTokenIfAvailable();
            }
        }).catch(function (e) { apToast('محفوظ ناکام: ' + e.message, 'error'); });
    };

    window.apLoadFailedNotifications = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-failed-notify-tbody');
        var summary = document.getElementById('ap-failed-notify-summary');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('getFailedNotifications', { tenantId: uid, limit: 50 }).then(function (res) {
            var items = (res && res.items) ? res.items : [];
            if (summary) summary.textContent = items.length ? (items.length + ' ناکام notification') : 'کوئی failed notification نہیں';
            if (!items.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#16a085;">سب ٹھیک</td></tr>';
                return;
            }
            tbody.innerHTML = items.map(function (it) {
                var typeLabel = it.type === 'parent_push' ? 'Parent push' : 'Key expiry';
                var retry = '<button type="button" class="btn btn-outline btn-sm" onclick="window.apRetryFailedNotification(\'' +
                    apEscAttr(it.type) + '\',\'' + apEscAttr(it.id) + '\')"><i class="fas fa-redo"></i> Retry</button>';
                return '<tr><td>' + typeLabel + '</td><td>' + apEsc(it.targetName) + '</td><td><small>' +
                    apEsc(it.error || '-') + '</small></td><td>' + (it.attempts || 0) + '</td><td>' + retry + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apRetryFailedNotification = function (type, notifyId) {
        var uid = apGetUid();
        if (!uid || !notifyId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('retryFailedNotification', {
            tenantId: uid,
            notifyId: notifyId,
            type: type || 'key_expiry'
        }).then(function (res) {
            apToast('Retry: ' + ((res && res.status) || 'ok'), res && res.ok ? 'success' : 'warning');
            window.apLoadFailedNotifications();
            if (typeof window.apLoadNotificationStats === 'function') window.apLoadNotificationStats();
        }).catch(function (e) { apToast('Retry ناکام: ' + e.message, 'error'); });
    };

    window.apRetryAllFailedNotifications = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') return;
        apToast('تمام failed notifications retry...', 'warning');
        window.emsCallFunction('retryAllFailedNotifications', { tenantId: uid }).then(function (res) {
            apToast('Retry مکمل: ' + (res.succeeded || 0) + '/' + (res.total || 0), 'success');
            window.apLoadFailedNotifications();
            if (typeof window.apLoadNotificationStats === 'function') window.apLoadNotificationStats();
        }).catch(function (e) { apToast('Bulk retry ناکام: ' + e.message, 'error'); });
    };

    window.apLoadNotificationStats = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-notify-stats');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getNotificationDeliveryStats', { tenantId: uid }).then(function (res) {
            var t = (res && res.stats && res.stats.totals) ? res.stats.totals : {};
            box.innerHTML = '<span style="margin-left:12px;">✓ Sent: <strong>' + (t.sent || 0) +
                '</strong></span><span style="margin-left:12px;">⏳ Queued: <strong>' + (t.queued || 0) +
                '</strong></span><span style="margin-left:12px;color:#c0392b;">✗ Failed: <strong>' + (t.failed || 0) +
                '</strong></span><span style="margin-left:12px;">📱 In-app: <strong>' + (t.inApp || 0) + '</strong></span>';
        }).catch(function () { box.textContent = '—'; });
    };

    window.apLoadAuditExportHistory = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-audit-exports-tbody');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('listAuditExportHistory', { tenantId: uid, limit: 15 }).then(function (res) {
            var rows = (res && res.exports) ? res.exports : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">کوئی export نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (r) {
                var dl = '<button type="button" class="btn btn-outline btn-sm" onclick="window.apDownloadAuditExportByPath(\'' +
                    apEscAttr(r.path || '') + '\')"><i class="fas fa-download"></i></button>';
                return '<tr><td style="font-size:11px;">' + apFormatBackupDate(r.exportedAt) +
                    '</td><td>' + (r.count || 0) + '</td><td><small>' + apEsc(r.source || '-') +
                    '</small></td><td>' + dl + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apDownloadAuditExportByPath = function (path) {
        var uid = apGetUid();
        if (!uid || !path || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('getAuditExportDownloadUrl', { tenantId: uid, path: path }).then(function (res) {
            if (!res || !res.url) { apToast('Download URL ناکام', 'error'); return; }
            window.open(res.url, '_blank');
        }).catch(function (e) { apToast('Download ناکام: ' + e.message, 'error'); });
    };

    window.apLoadLoginSessions = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-login-sessions-tbody');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('listLoginSessions', { tenantId: uid, limit: 25, activeOnly: true }).then(function (res) {
            var rows = (res && res.sessions) ? res.sessions : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">کوئی active session نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (s) {
                var revoke = s.revoked ? '—' : ('<button type="button" class="btn btn-outline btn-sm" onclick="window.apRevokeLoginSession(\'' +
                    apEscAttr(s.sessionId) + '\')"><i class="fas fa-ban"></i></button>');
                return '<tr><td style="font-size:11px;">' + apEsc(s.email || s.uid) +
                    '</td><td>' + apEsc(s.deviceLabel || '-') + '</td><td>' + apEsc(s.portal || '-') +
                    '</td><td style="font-size:11px;">' + apFormatBackupDate(s.lastSeenAt) + '</td><td>' + revoke + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apRevokeLoginSession = function (sessionId) {
        var uid = apGetUid();
        if (!uid || !sessionId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('revokeLoginSession', { tenantId: uid, sessionId: sessionId }).then(function () {
            apToast('Session revoke ہو گیا۔', 'success');
            window.apLoadLoginSessions();
        }).catch(function (e) { apToast('Revoke ناکام: ' + e.message, 'error'); });
    };

    window.apLoadNotificationAnalytics = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-notify-analytics-tbody');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('getNotificationAnalytics', { tenantId: uid, days: 7 }).then(function (res) {
            var rows = (res && res.days) ? res.days : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">ابھی analytics نہیں — کل scheduled rollup چلے گا</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (r) {
                var t = r.totals || {};
                return '<tr><td>' + apEsc(r.dateKey) + '</td><td>' + (t.sent || 0) +
                    '</td><td style="color:#c0392b;">' + (t.failed || 0) +
                    '</td><td>' + (t.queued || 0) + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apLoadSsoPolicy = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsLoadTenantSsoPolicy !== 'function') return Promise.resolve();
        return window.emsLoadTenantSsoPolicy(uid).then(function (p) {
            var elStaff = document.getElementById('ap-sso-enforce-staff');
            var elParent = document.getElementById('ap-sso-enforce-parent');
            var elGoogle = document.getElementById('ap-sso-google-only');
            var elDomains = document.getElementById('ap-sso-domains');
            if (elStaff) elStaff.checked = !!p.enforceStaffEmailDomain;
            if (elParent) elParent.checked = !!p.enforceParentEmailDomain;
            if (elGoogle) elGoogle.checked = !!p.enforceGoogleSignInOnly;
            if (elDomains) elDomains.value = (p.allowedEmailDomains || []).join(', ');
            var elOidcEn = document.getElementById('ap-sso-oidc-enable');
            var elOidcId = document.getElementById('ap-sso-oidc-provider-id');
            var elOidcIssuer = document.getElementById('ap-sso-oidc-issuer');
            var elOidcClient = document.getElementById('ap-sso-oidc-client-id');
            var elSamlEn = document.getElementById('ap-sso-saml-enable');
            var elSamlId = document.getElementById('ap-sso-saml-provider-id');
            var elSamlEntity = document.getElementById('ap-sso-saml-entity-id');
            var elSamlUrl = document.getElementById('ap-sso-saml-sso-url');
            var elExtra = document.getElementById('ap-sso-extra-providers');
            if (elOidcEn) elOidcEn.checked = !!p.oidcEnabled;
            if (elOidcId) elOidcId.value = p.oidcProviderId || '';
            if (elOidcIssuer) elOidcIssuer.value = p.oidcIssuerUrl || '';
            if (elOidcClient) elOidcClient.value = p.oidcClientId || '';
            if (elSamlEn) elSamlEn.checked = !!p.samlEnabled;
            if (elSamlId) elSamlId.value = p.samlProviderId || '';
            if (elSamlEntity) elSamlEntity.value = p.samlEntityId || '';
            if (elSamlUrl) elSamlUrl.value = p.samlSsoUrl || '';
            if (elExtra) elExtra.value = (p.allowedSignInProviders || []).join(', ');
        });
    };

    window.apLoadSsoProviderSummary = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-sso-provider-summary');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getSsoProviderSummary', { tenantId: uid }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var o = res.oidc || {};
            var s = res.saml || {};
            box.innerHTML = 'Allowed: <strong>' + apEsc((res.allowedProviders || []).join(', ') || 'google.com') +
                '</strong> • OIDC: <strong>' + (o.enabled ? (o.discoveryValid ? 'valid' : 'pending') : 'off') +
                '</strong> • SAML: <strong>' + (s.enabled ? 'on' : 'off') + '</strong>';
        }).catch(function () {
            box.textContent = 'SSO summary لوڈ ناکام';
        });
    };

    window.apValidateOidcIssuer = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var issuer = ((document.getElementById('ap-sso-oidc-issuer') || {}).value || '').trim();
        if (!issuer) {
            apToast('OIDC Issuer URL درج کریں۔', 'error'); return;
        }
        window.emsCallFunction('validateOidcIssuerConfig', { tenantId: uid, issuerUrl: issuer }).then(function (res) {
            var d = (res && res.discovery) ? res.discovery : {};
            apToast('OIDC discovery OK — ' + (d.issuer || issuer), 'success');
            if (typeof window.apLoadSsoProviderSummary === 'function') window.apLoadSsoProviderSummary();
        }).catch(function (e) { apToast('OIDC validate ناکام: ' + e.message, 'error'); });
    };

    window.apSaveSsoPolicy = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsSaveTenantSsoPolicy !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var domains = (document.getElementById('ap-sso-domains') || {}).value || '';
        window.emsSaveTenantSsoPolicy(uid, {
            enforceStaffEmailDomain: !!(document.getElementById('ap-sso-enforce-staff') || {}).checked,
            enforceParentEmailDomain: !!(document.getElementById('ap-sso-enforce-parent') || {}).checked,
            enforceGoogleSignInOnly: !!(document.getElementById('ap-sso-google-only') || {}).checked,
            allowedEmailDomains: domains.split(/[,;\s]+/).filter(Boolean),
            provider: 'google',
            oidcEnabled: !!(document.getElementById('ap-sso-oidc-enable') || {}).checked,
            oidcProviderId: ((document.getElementById('ap-sso-oidc-provider-id') || {}).value || '').trim(),
            oidcIssuerUrl: ((document.getElementById('ap-sso-oidc-issuer') || {}).value || '').trim(),
            oidcClientId: ((document.getElementById('ap-sso-oidc-client-id') || {}).value || '').trim(),
            samlEnabled: !!(document.getElementById('ap-sso-saml-enable') || {}).checked,
            samlProviderId: ((document.getElementById('ap-sso-saml-provider-id') || {}).value || '').trim(),
            samlEntityId: ((document.getElementById('ap-sso-saml-entity-id') || {}).value || '').trim(),
            samlSsoUrl: ((document.getElementById('ap-sso-saml-sso-url') || {}).value || '').trim(),
            allowedSignInProviders: (((document.getElementById('ap-sso-extra-providers') || {}).value || '')
                .split(/[,;\s]+/).filter(Boolean))
        }).then(function () {
            apToast('SSO / domain policy محفوظ۔', 'success');
            if (typeof window.apLoadSsoProviderSummary === 'function') window.apLoadSsoProviderSummary();
        }).catch(function (e) { apToast('محفوظ ناکام: ' + e.message, 'error'); });
    };

    window.apLoadTrustedDevices = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-trusted-devices-tbody');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('listTrustedDevices', { tenantId: uid }).then(function (res) {
            var rows = (res && res.devices) ? res.devices : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">کوئی device نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (d) {
                var actions = '';
                if (d.status === 'pending') {
                    actions = '<button type="button" class="btn btn-success btn-sm" onclick="window.apApproveTrustedDevice(\'' +
                        apEscAttr(d.deviceId) + '\')"><i class="fas fa-check"></i></button> ' +
                        '<button type="button" class="btn btn-outline btn-sm" onclick="window.apRejectTrustedDevice(\'' +
                        apEscAttr(d.deviceId) + '\')"><i class="fas fa-times"></i></button>';
                } else if (d.status === 'approved') {
                    actions = '<button type="button" class="btn btn-danger btn-sm" onclick="window.apRevokeTrustedDevice(\'' +
                        apEscAttr(d.deviceId) + '\')"><i class="fas fa-ban"></i> Revoke</button>';
                } else {
                    actions = apEsc(d.status || '-');
                }
                return '<tr><td style="font-size:11px;">' + apEsc(d.email || d.uid) +
                    '</td><td>' + apEsc(d.deviceLabel || '-') + '</td><td>' + apEsc(d.status) +
                    '</td><td style="font-size:11px;">' + apFormatBackupDate(d.requestedAt || d.updatedAt) +
                    '</td><td>' + actions + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apApproveTrustedDevice = function (deviceId) {
        var uid = apGetUid();
        if (!uid || !deviceId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('approveTrustedDevice', { tenantId: uid, deviceId: deviceId }).then(function () {
            apToast('Device approve ہو گیا۔', 'success');
            window.apLoadTrustedDevices();
        }).catch(function (e) { apToast('Approve ناکام: ' + e.message, 'error'); });
    };

    window.apRejectTrustedDevice = function (deviceId) {
        var uid = apGetUid();
        if (!uid || !deviceId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('rejectTrustedDevice', { tenantId: uid, deviceId: deviceId }).then(function () {
            apToast('Device reject ہو گیا۔', 'success');
            window.apLoadTrustedDevices();
        }).catch(function (e) { apToast('Reject ناکام: ' + e.message, 'error'); });
    };

    window.apRevokeTrustedDevice = function (deviceId) {
        var uid = apGetUid();
        if (!uid || !deviceId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('revokeTrustedDevice', { tenantId: uid, deviceId: deviceId }).then(function () {
            apToast('Device revoke ہو گیا۔', 'success');
            window.apLoadTrustedDevices();
            if (typeof window.apLoadTrustedDeviceStats === 'function') window.apLoadTrustedDeviceStats();
        }).catch(function (e) { apToast('Revoke ناکام: ' + e.message, 'error'); });
    };

    window.apApproveAllPendingTrustedDevices = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('approveAllPendingTrustedDevices', { tenantId: uid }).then(function (res) {
            apToast((res && res.approved) ? (res.approved + ' devices approve ہو گئیں۔') : 'کوئی pending device نہیں۔', 'success');
            window.apLoadTrustedDevices();
            if (typeof window.apLoadTrustedDeviceStats === 'function') window.apLoadTrustedDeviceStats();
            if (typeof window.apLoadSecurityEvents === 'function') window.apLoadSecurityEvents();
        }).catch(function (e) { apToast('Bulk approve ناکام: ' + e.message, 'error'); });
    };

    window.apLoadTrustedDeviceStats = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-trusted-device-stats');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getTrustedDeviceStats', { tenantId: uid }).then(function (res) {
            var s = (res && res.stats) ? res.stats : {};
            box.innerHTML = 'Pending: <strong>' + (s.pending || 0) + '</strong> • Approved: <strong>' + (s.approved || 0) +
                '</strong> • Rejected: <strong>' + (s.rejected || 0) + '</strong> • Revoked: <strong>' + (s.revoked || 0) +
                '</strong> • Expired: <strong>' + (s.expired || 0) + '</strong>';
        }).catch(function () {
            box.textContent = 'Stats لوڈ ناکام';
        });
    };

    window.apExportSecurityEvents = function (format) {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var catEl = document.getElementById('ap-security-events-filter');
        var category = catEl ? catEl.value : 'all';
        window.emsCallFunction('exportSecurityEvents', {
            tenantId: uid,
            category: category,
            format: format || 'json',
            limit: 200
        }).then(function (res) {
            if (!res) return;
            var blob;
            var name = 'security-events-' + category + '.' + (res.format || 'json');
            if (res.format === 'csv' && res.content) {
                blob = new Blob([res.content], { type: 'text/csv;charset=utf-8' });
            } else {
                blob = new Blob([JSON.stringify(res.events || [], null, 2)], { type: 'application/json' });
            }
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
            apToast('Security events export (' + (res.count || 0) + ')', 'success');
        }).catch(function (e) { apToast('Export ناکام: ' + e.message, 'error'); });
    };

    window.apLoadLoginSecurityOverview = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-login-security-overview');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getLoginSecurityOverview', { tenantId: uid }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var td = res.trustedDevices || {};
            var ev = res.securityEvents7d || {};
            var pol = res.policies || {};
            box.innerHTML = 'Active sessions: <strong>' + (res.activeSessions || 0) +
                '</strong> • Devices pending: <strong>' + (td.pending || 0) +
                '</strong> • 7d SSO blocks: <strong>' + (ev.ssoDenied || 0) +
                '</strong> • MFA blocks: <strong>' + (ev.mfaBlocks || 0) +
                '</strong> • Lockouts 7d: <strong>' + (ev.lockouts || 0) +
                '</strong> • Active lockouts: <strong>' + ((res.loginLockouts && res.loginLockouts.active) || 0) +
                '</strong> • Webhook: <strong>' + (pol.enableSecurityWebhooks ? 'ON' : 'off') +
                '</strong> • Brute-force: <strong>' + (pol.enableLoginBruteForceProtection ? 'ON' : 'off') +
                '</strong> • Session anomaly: <strong>' + (pol.enableSessionAnomalyDetection ? 'ON' : 'off') +
                '</strong> • Anomalies 7d: <strong>' + (ev.sessionAnomalies || 0) +
                '</strong> • OIDC: <strong>' + (pol.oidcEnabled ? 'ON' : 'off') +
                '</strong> • SAML: <strong>' + (pol.samlEnabled ? 'ON' : 'off') + '</strong>';
        }).catch(function () {
            box.textContent = 'Overview لوڈ ناکام';
        });
    };

    window.apLoadLoginSecurityHealth = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-login-security-health');
        var tbody = document.getElementById('ap-login-security-health-tbody');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('getLoginSecurityHealthCheck', { tenantId: uid }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var sc = res.scoring || {};
            box.innerHTML = 'Readiness score: <strong>' + (res.readinessScore || 0) + '%</strong>' +
                ' • Pass: <strong>' + (sc.pass || 0) + '</strong> • Warn: <strong>' + (sc.warn || 0) +
                '</strong> • Fail: <strong>' + (sc.fail || 0) + '</strong> • Production ready: <strong>' +
                (res.productionReady ? 'YES' : 'no') + '</strong>';
            if (!tbody) return;
            var rows = res.checks || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">—</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (c) {
                var color = c.status === 'pass' ? '#16a34a' : (c.status === 'fail' ? '#dc2626' : '#ca8a04');
                return '<tr><td>' + apEsc(c.label || c.id) + '</td><td style="color:' + color + ';font-weight:600;">' +
                    apEsc(c.status) + '</td><td style="font-size:11px;">' + apEsc(c.detail || '') + '</td></tr>';
            }).join('');
        }).catch(function () {
            box.textContent = 'Health check لوڈ ناکام';
            if (tbody) tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apLoadLoginIpSummary = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-login-ip-summary');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getLoginIpPolicySummary', { tenantId: uid }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var geo = res.countryAllowlist || {};
            box.innerHTML = 'IP allowlist: <strong>' + (res.enabled ? 'ON' : 'off') +
                '</strong> • Ranges: <strong>' + ((res.ranges && res.ranges.length) || 0) +
                '</strong> • 7d denied: <strong>' + (res.denied7d || 0) +
                '</strong>' + (res.clientIpHint ? (' • Your IP: <strong>' + apEsc(res.clientIpHint) + '</strong>') : '') +
                '<br>Country: <strong>' + (geo.enabled ? 'ON' : 'off') +
                '</strong> • Allowed: <strong>' + ((geo.countries && geo.countries.length) || 0) +
                '</strong> • 7d denied: <strong>' + (geo.denied7d || 0) +
                '</strong>' + (geo.clientCountryHint ? (' • Your country: <strong>' + apEsc(geo.clientCountryHint) + '</strong>') : '');
        }).catch(function () {
            box.textContent = 'IP summary لوڈ ناکام';
        });
    };

    window.apProbeLoginSecurityBackend = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        window.emsCallFunction('probeLoginSecurityBackend', { tenantId: uid }).then(function (res) {
            if (!res || !res.ok) {
                apToast('Backend probe ناکام', 'error'); return;
            }
            apToast('Backend OK — v' + (res.version || '?') + ' (' + ((res.functions && res.functions.length) || 0) + ' functions)', 'success');
            if (typeof window.apLoadLoginSecurityHealth === 'function') window.apLoadLoginSecurityHealth();
        }).catch(function (e) { apToast('Probe ناکام: ' + e.message, 'error'); });
    };

    window.apLoadLoginLockouts = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-login-lockouts-tbody');
        var summary = document.getElementById('ap-login-lockouts-summary');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('getTenantLoginLockouts', { tenantId: uid }).then(function (res) {
            var rows = (res && res.lockouts) ? res.lockouts : [];
            if (summary) summary.textContent = rows.length ? (rows.length + ' فعال lockout') : 'کوئی فعال lockout نہیں';
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#16a085;">کوئی lockout نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (r) {
                var mins = r.lockedUntil ? Math.max(1, Math.ceil((r.lockedUntil - Date.now()) / 60000)) : 0;
                var unlock = '<button type="button" class="btn btn-outline btn-sm" onclick="window.apUnlockLoginLockout(\'' +
                    apEscAttr(r.email) + '\')"><i class="fas fa-unlock"></i> Unlock</button>';
                return '<tr><td>' + apEsc(r.email) + '</td><td>' + (r.count || 0) + '</td><td>' +
                    (mins ? (mins + ' min') : '—') + '</td><td>' + unlock + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apUnlockLoginLockout = function (email) {
        var uid = apGetUid();
        if (!uid || !email || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('unlockTenantLoginLockout', { tenantId: uid, email: email }).then(function () {
            apToast('Lockout unlock ہو گیا۔', 'success');
            window.apLoadLoginLockouts();
            if (typeof window.apLoadLoginSecurityOverview === 'function') window.apLoadLoginSecurityOverview();
        }).catch(function (e) { apToast('Unlock ناکام: ' + e.message, 'error'); });
    };

    window.apLoadSessionAnomalies = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-session-anomalies-tbody');
        var summary = document.getElementById('ap-session-anomalies-summary');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('listSessionAnomalies', { tenantId: uid, limit: 25, openOnly: true }).then(function (res) {
            var rows = (res && res.anomalies) ? res.anomalies : [];
            if (summary) {
                window.emsCallFunction('getSessionAnomalySummary', { tenantId: uid }).then(function (sum) {
                    if (!sum) return;
                    summary.innerHTML = 'Detection: <strong>' + (sum.enabled ? 'ON' : 'off') +
                        '</strong> • Open 7d: <strong>' + (sum.open7d || 0) +
                        '</strong> • Total 7d: <strong>' + (sum.total7d || 0) + '</strong>';
                }).catch(function () {
                    summary.textContent = rows.length ? (rows.length + ' open anomaly') : 'کوئی open anomaly نہیں';
                });
            }
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#16a085;">کوئی anomaly نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (r) {
                var dismiss = r.dismissed ? '—' : ('<button type="button" class="btn btn-outline btn-sm" onclick="window.apDismissSessionAnomaly(\'' +
                    apEscAttr(r.id) + '\')"><i class="fas fa-check"></i> Dismiss</button>');
                return '<tr><td>' + apEsc(r.type || '-') + '</td><td style="font-size:11px;">' + apEsc(r.email || r.uid || '-') +
                    '</td><td>' + apEsc(r.portal || '-') + '</td><td style="font-size:11px;">' + apEsc(r.detail || '-') +
                    '</td><td>' + dismiss + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apDismissSessionAnomaly = function (anomalyId) {
        var uid = apGetUid();
        if (!uid || !anomalyId || typeof window.emsCallFunction !== 'function') return;
        window.emsCallFunction('dismissSessionAnomaly', { tenantId: uid, anomalyId: anomalyId }).then(function () {
            apToast('Anomaly dismiss ہو گیا۔', 'success');
            window.apLoadSessionAnomalies();
        }).catch(function (e) { apToast('Dismiss ناکام: ' + e.message, 'error'); });
    };

    window.apLoadLoginAuditSummary = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-login-audit-summary');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getLoginAuditSummary', { tenantId: uid, days: 30 }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var c = res.counts || {};
            box.innerHTML = '30d — Security: <strong>' + (c.securityEvents || 0) +
                '</strong> • Sessions: <strong>' + (c.sessions || 0) +
                '</strong> • Anomalies: <strong>' + (c.anomalies || 0) +
                '</strong> • Active lockouts: <strong>' + (c.lockouts || 0) + '</strong>';
        }).catch(function () { box.textContent = 'Audit summary لوڈ ناکام'; });
    };

    window.apExportLoginAudit = function (format) {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        format = format || 'json';
        apToast('Login audit export...', 'warning');
        window.emsCallFunction('exportLoginAudit', { tenantId: uid, format: format, days: 30 }).then(function (res) {
            if (!res) { apToast('Export ناکام', 'error'); return; }
            var blob;
            var filename = 'ems-login-audit-' + uid + '-' + Date.now();
            if (res.format === 'csv') {
                blob = new Blob([res.content || ''], { type: 'text/csv;charset=utf-8' });
                filename += '.csv';
            } else {
                blob = new Blob([JSON.stringify(res.bundle || res, null, 2)], { type: 'application/json' });
                filename += '.json';
            }
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
            apToast('Login audit export مکمل', 'success');
        }).catch(function (e) { apToast('Export ناکام: ' + e.message, 'error'); });
    };

    window.apLoadSecurityAlertSummary = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-security-alert-summary');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getSecurityAlertSummary', { tenantId: uid }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var s = res.summary || {};
            var last = res.lastDigest;
            var lastTxt = last && last.dateKey ? last.dateKey : '—';
            box.innerHTML = 'Digest: <strong>' + (res.enabled ? 'ON' : 'off') +
                '</strong> • Critical 7d: <strong>' + (s.totalCritical || 0) +
                '</strong> / threshold <strong>' + (res.threshold || 0) +
                '</strong> • Alert: <strong>' + (res.alertTriggered ? 'YES' : 'no') +
                '</strong> • Last digest: <strong>' + lastTxt + '</strong>';
        }).catch(function () {
            box.textContent = 'Alert summary لوڈ ناکام';
        });
    };

    window.apLoadSecurityWebhookStatus = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-security-webhook-status');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getSecurityWebhookStatus', { tenantId: uid }).then(function (res) {
            if (!res) { box.textContent = '—'; return; }
            var d = res.delivery7d || {};
            var last = (res.recent && res.recent[0]) ? res.recent[0] : null;
            var lastTxt = last ? (last.ok ? 'OK' : 'FAIL') + ' @ ' + apFormatBackupDate(last.ts) : '—';
            box.innerHTML = 'Webhook: <strong>' + (res.enabled && res.hasUrl ? 'configured' : 'off') +
                '</strong> • 7d delivery OK: <strong>' + (d.success || 0) +
                '</strong> / fail: <strong>' + (d.failed || 0) +
                '</strong> • Last: <strong>' + lastTxt + '</strong>';
        }).catch(function () {
            box.textContent = 'Webhook status لوڈ ناکام';
        });
    };

    window.apTestSecurityWebhook = function () {
        var uid = apGetUid();
        if (!uid || typeof window.emsCallFunction !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        window.emsCallFunction('testSecurityWebhook', { tenantId: uid }).then(function (res) {
            apToast((res && res.ok) ? 'Webhook test کامیاب (' + (res.statusCode || 200) + ')' : 'Webhook test ناکام', (res && res.ok) ? 'success' : 'error');
            if (typeof window.apLoadSecurityWebhookStatus === 'function') window.apLoadSecurityWebhookStatus();
        }).catch(function (e) { apToast('Test ناکام: ' + e.message, 'error'); });
    };

    window.apLoadMfaPolicySummary = function () {
        var uid = apGetUid();
        var box = document.getElementById('ap-mfa-policy-summary');
        if (!uid || !box || typeof window.emsCallFunction !== 'function') return;
        box.textContent = 'لوڈ ہو رہا ہے...';
        window.emsCallFunction('getMfaPolicySummary', { tenantId: uid }).then(function (res) {
            var p = (res && res.policy) ? res.policy : {};
            box.innerHTML = 'Admin MFA: <strong>' + (p.requireMfaForAdmin ? 'ON' : 'off') +
                '</strong> • Staff: <strong>' + (p.requireMfaForStaff ? 'ON' : 'off') +
                '</strong> • Parent: <strong>' + (p.requireMfaForParent ? 'ON' : 'off') +
                '</strong> • 7d MFA blocks: <strong>' + ((res && res.mfaSessionBlocks7d) || 0) + '</strong>';
        }).catch(function () {
            box.textContent = 'MFA summary لوڈ ناکام';
        });
    };

    window.apLoadSecurityEvents = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-security-events-tbody');
        var catEl = document.getElementById('ap-security-events-filter');
        if (!uid || !tbody || typeof window.emsCallFunction !== 'function') return;
        var category = catEl ? catEl.value : 'all';
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.emsCallFunction('getRecentSecurityEvents', { tenantId: uid, category: category, limit: 20 }).then(function (res) {
            var rows = (res && res.events) ? res.events : [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">ابھی device/SSO events نہیں</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map(function (e) {
                return '<tr><td style="font-size:11px;">' + apEsc(e.action || '-') +
                    '</td><td>' + apEsc(e.email || e.uid || '-') +
                    '</td><td style="font-size:11px;">' + apFormatBackupDate(e.clientTs) +
                    '</td><td style="font-size:10px;">' + apEsc(JSON.stringify(e.details || {}).slice(0, 80)) + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لوڈ ناکام</td></tr>';
        });
    };

    window.apLoadKeyExpiryDashboard = function () {
        var tbody = document.getElementById('ap-key-expiry-tbody');
        var summary = document.getElementById('ap-key-expiry-summary');
        var uid = apGetUid();
        if (!tbody || !uid) return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        if (typeof window.emsCallFunction !== 'function') {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Functions دستیاب نہیں</td></tr>';
            return;
        }
        window.emsCallFunction('getAccessKeyExpiryReport', { tenantId: uid }).then(function (report) {
            if (!report) return;
            if (summary) {
                summary.innerHTML = '<span style="color:#dc2626;">' + (report.summary.expired || 0) + ' ختم</span> • ' +
                    '<span style="color:#d97706;">' + (report.summary.expiring || 0) + ' 30 دن میں</span> • ' +
                    'ڈیفالٹ TTL: ' + (report.summary.defaultTtlDays || 365) + ' دن';
            }
            var items = report.items || [];
            if (!items.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#16a085;">کوئی expiring/expired key نہیں 🎉</td></tr>';
                return;
            }
            tbody.innerHTML = items.map(function (it) {
                var badge = it.status === 'expired'
                    ? '<span class="ap-badge ap-badge-off">ختم</span>'
                    : '<span class="ap-badge ap-badge-temp">' + it.daysLeft + ' دن</span>';
                var typeLabel = it.type === 'teacher' ? 'استاد' : 'والد';
                var action = it.type === 'teacher'
                    ? '<button type="button" class="btn btn-warning btn-sm" onclick="window.apOpenStaffModal(\'' + apEscAttr(it.id) + '\')"><i class="fas fa-key"></i> Key</button>'
                    : '<button type="button" class="btn btn-warning btn-sm" onclick="window.apOpenParentModal(\'' + apEscAttr(it.id) + '\')"><i class="fas fa-key"></i> Key</button>';
                return '<tr><td>' + typeLabel + '</td><td>' + apEsc(it.name || it.id) + '<br><small>' + apEsc(it.id) + '</small></td>' +
                    '<td>' + badge + '</td><td>' + (it.daysLeft != null ? it.daysLeft : '—') + '</td><td>' + action + '</td></tr>';
            }).join('');
        }).catch(function () {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">رپورٹ لوڈ ناکام</td></tr>';
        });
    };

    // تیار شدہ ٹیمپلیٹس — اب اعمال کی سطح پر (Stage 2)
    // ہر ٹیمپلیٹ شعبے + ان میں مخصوص اعمال طے کرتا ہے
    window.ADMIN_TEMPLATES = {
        teacher: {
            name: 'استاد (Teacher)', icon: 'fa-chalkboard-teacher',
            actions: {
                dashboard: ['view'],
                admission: ['view', 'print'],
                attendance: ['view', 'create', 'edit'],
                exams: ['view', 'create'],
                curriculum: ['view', 'create'],
                training: ['view', 'create'],
                announcements: ['view'],
                complaints: ['view', 'create']
            }
        },
        accountant: {
            name: 'محاسب (Accountant)', icon: 'fa-calculator',
            actions: {
                dashboard: ['view'],
                finance: ['view', 'create', 'edit', 'export'],
                ledger: ['view', 'create', 'edit', 'export', 'approve1']
            }
        },
        reception: {
            name: 'استقبالیہ عملہ (Reception)', icon: 'fa-concierge-bell',
            actions: {
                dashboard: ['view'],
                admission: ['view', 'create', 'edit', 'print'],
                announcements: ['view']
            }
        },
        exam_officer: {
            name: 'امتحانی افسر (Examination Officer)', icon: 'fa-file-signature',
            actions: {
                dashboard: ['view'],
                exams: ['view', 'create', 'edit', 'delete', 'export'],
                attendance: ['view', 'export']
            }
        },
        edu_supervisor: {
            name: 'نگرانِ تعلیم (Education Supervisor)', icon: 'fa-user-tie',
            actions: {
                dashboard: ['view'],
                attendance: ['view', 'export'],
                exams: ['view', 'export'],
                complaints: ['view', 'edit'],
                announcements: ['view', 'create'],
                ledger: ['view', 'export', 'approve2']
            }
        }
    };

    function apToast(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
    }

    function apModuleName(id) {
        for (var i = 0; i < window.ADMIN_STAFF_MODULES.length; i++) {
            if (window.ADMIN_STAFF_MODULES[i].id === id) return window.ADMIN_STAFF_MODULES[i].name;
        }
        return id;
    }

    function apActionName(id) {
        for (var i = 0; i < window.ADMIN_ACTIONS.length; i++) {
            if (window.ADMIN_ACTIONS[i].id === id) return window.ADMIN_ACTIONS[i].name;
        }
        return id;
    }

    function apParentViewName(id) {
        for (var i = 0; i < window.PARENT_VIEWS.length; i++) {
            if (window.PARENT_VIEWS[i].id === id) return window.PARENT_VIEWS[i].name;
        }
        return id;
    }

    function apMsgCategoryName(id) {
        for (var i = 0; i < window.PARENT_MSG_CATEGORIES.length; i++) {
            if (window.PARENT_MSG_CATEGORIES[i].id === id) return window.PARENT_MSG_CATEGORIES[i].name;
        }
        return id;
    }

    function apNow() { return new Date().toISOString(); }

    function apEsc(v) {
        if (v == null) return '';
        if (typeof window.emsSanitize === 'function') return window.emsSanitize(String(v));
        if (window.EmsUtils && window.EmsUtils.sanitize) return window.EmsUtils.sanitize(String(v));
        return String(v);
    }

    function apEscAttr(v) {
        if (window.EmsUtils && window.EmsUtils.escAttr) return window.EmsUtils.escAttr(v);
        return apEsc(v);
    }

    function apFormatDateTime(iso) {
        if (!iso) return '-';
        try { return new Date(iso).toLocaleString('ur-PK'); }
        catch (e) { return iso; }
    }

    function apCurrentAdmin() {
        try {
            var u = firebase.auth().currentUser;
            return u ? (u.email || u.uid) : 'admin';
        } catch (e) { return 'admin'; }
    }

    window.emsParentAuditActor = apCurrentAdmin;

    // ----------------------- ڈیٹا رسائی (localStorage) -----------------------
    function getUsers() {
        try { return JSON.parse(localStorage.getItem(DB_USERS)) || []; }
        catch (e) { return []; }
    }

    function getAllPerms() {
        try { return JSON.parse(localStorage.getItem(DB_STAFF_PERM)) || {}; }
        catch (e) { return {}; }
    }

    function saveAllPerms(perms) {
        var savePromise;
        if (typeof window.emsSaveModuleData === 'function') {
            savePromise = window.emsSaveModuleData(DB_STAFF_PERM, perms, { mutation: true, autoDelta: true }).then(function (res) {
                if (typeof window.emsLogAudit === 'function') {
                    window.emsLogAudit('admin', 'staff_permissions_save', 'bulk', { count: Object.keys(perms || {}).length });
                }
                return res;
            });
        } else {
            localStorage.setItem(DB_STAFF_PERM, JSON.stringify(perms));
            if (typeof window.emsLogAudit === 'function') {
                window.emsLogAudit('admin', 'staff_permissions_save', 'bulk', { count: Object.keys(perms || {}).length });
            }
            savePromise = Promise.resolve();
        }
        return savePromise;
    }

    function apPushStaffClaimsForStaffId(staffId) {
        var tenantId = typeof window.emsGetTenantId === 'function' ? window.emsGetTenantId() : null;
        var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
        if (!tenantId || !db || !staffId || typeof window.emsSyncStaffClaimsForMember !== 'function') {
            return Promise.resolve({ skipped: true });
        }
        return apTenantSubCol(db, tenantId, 'Staff_Links')
            .where('staffId', '==', staffId)
            .where('status', '==', 'active')
            .limit(5)
            .get()
            .then(function (snap) {
                if (snap.empty) return { synced: 0 };
                var jobs = snap.docs.map(function (doc) {
                    return window.emsSyncStaffClaimsForMember(tenantId, doc.id);
                });
                return Promise.all(jobs).then(function () {
                    return { synced: snap.size };
                });
            })
            .catch(function (e) {
                console.warn('apPushStaffClaimsForStaffId:', e && e.message);
                return { synced: 0, error: e && e.message };
            });
    }

    function getStaffList() {
        return getUsers().filter(function (u) {
            return u && (u.type === 'teacher' || u.type === 'staff');
        });
    }

    function getStudentList() {
        return getUsers().filter(function (u) { return u && u.type === 'student'; });
    }

    function getStudentById(studentId) {
        return getStudentList().filter(function (s) { return s.id === studentId; })[0] || null;
    }

    function emptyActions() {
        var a = {};
        window.ADMIN_ACTIONS.forEach(function (act) { a[act.id] = false; });
        return a;
    }

    function fullActions() {
        var a = {};
        window.ADMIN_ACTIONS.forEach(function (act) { a[act.id] = true; });
        return a;
    }

    function defaultPerm(staffId) {
        var modules = {};
        var actions = {};
        window.ADMIN_STAFF_MODULES.forEach(function (m) {
            modules[m.id] = false;
            actions[m.id] = emptyActions();
        });
        return {
            staffId: staffId,
            status: 'active',
            template: '',
            modules: modules,
            actions: actions,
            temporary: {},   // key: "module.action" -> { expiry, grantedBy, grantedAt }
            history: [],
            updatedAt: apNow(),
            updatedBy: apCurrentAdmin()
        };
    }

    // موجودہ (Stage 1) ڈیٹا کو Stage 2 ڈھانچے میں محفوظ طریقے سے منتقل کریں
    function migratePerm(existing, staffId) {
        var base = defaultPerm(staffId);
        var p = Object.assign(base, existing || {});
        p.modules = p.modules || base.modules;
        p.actions = p.actions || {};
        p.temporary = p.temporary || {};
        p.history = Array.isArray(p.history) ? p.history : [];
        p.status = p.status || 'active';

        window.ADMIN_STAFF_MODULES.forEach(function (m) {
            if (typeof p.modules[m.id] === 'undefined') p.modules[m.id] = false;
            if (!p.actions[m.id]) {
                // پرانے ڈیٹا میں شعبہ آن تھا تو مکمل رسائی فرض کریں (پیچھے سے مطابقت)
                p.actions[m.id] = p.modules[m.id] ? fullActions() : emptyActions();
            } else {
                window.ADMIN_ACTIONS.forEach(function (act) {
                    if (typeof p.actions[m.id][act.id] === 'undefined') p.actions[m.id][act.id] = false;
                });
            }
        });
        return p;
    }

    window.apGetStaffPerm = function (staffId) {
        var perms = getAllPerms();
        return migratePerm(perms[staffId], staffId);
    };

    /** Phase 2: staff action guard — modules میں استعمال */
    window.apCheckStaffAction = function (modId, action) {
        if (typeof window.checkStaffModuleAccess === 'function') {
            return window.checkStaffModuleAccess(modId, action || 'view');
        }
        return true;
    };

    // ----------------------- عارضی اجازت کی صفائی -----------------------------
    // معیادی ختم شدہ عارضی اجازتیں ہٹا کر ہسٹری میں درج کریں
    window.apPurgeExpired = function () {
        var perms = getAllPerms();
        var now = Date.now();
        var changed = false;
        Object.keys(perms).forEach(function (sid) {
            var p = perms[sid];
            if (!p || !p.temporary) return;
            Object.keys(p.temporary).forEach(function (key) {
                var t = p.temporary[key];
                if (t && t.expiry && new Date(t.expiry).getTime() <= now) {
                    p.history = p.history || [];
                    p.history.push({
                        type: 'temp_expired',
                        detail: 'عارضی اجازت ختم: ' + apKeyLabel(key),
                        by: 'system',
                        at: apNow()
                    });
                    delete p.temporary[key];
                    changed = true;
                }
            });
        });
        if (changed) saveAllPerms(perms);
    };

    function apKeyLabel(key) {
        var parts = key.split('.');
        return apModuleName(parts[0]) + ' › ' + apActionName(parts[1]);
    }

    function tempActive(p, mod, action) {
        var t = p.temporary && p.temporary[mod + '.' + action];
        if (!t || !t.expiry) return false;
        return new Date(t.expiry).getTime() > Date.now();
    }

    // --------------------------- اجازت چیک (عوامی) ---------------------------
    // کسی staff کا کسی شعبے میں کوئی خاص عمل کر سکنا (مستقل یا عارضی)
    window.staffCanDo = function (staffId, moduleId, actionId) {
        var p = window.apGetStaffPerm(staffId);
        if (p.status !== 'active') return false;
        if (tempActive(p, moduleId, actionId)) return true;
        return !!(p.modules[moduleId] && p.actions[moduleId] && p.actions[moduleId][actionId]);
    };

    // شعبے تک رسائی (کم از کم کوئی ایک عمل یا عارضی اجازت)
    window.staffCanAccess = function (staffId, moduleId) {
        var p = window.apGetStaffPerm(staffId);
        if (p.status !== 'active') return false;
        if (p.modules[moduleId]) return true;
        var has = false;
        window.ADMIN_ACTIONS.forEach(function (act) {
            if (tempActive(p, moduleId, act.id)) has = true;
        });
        return has;
    };

    // ------------------------------ رینڈرنگ ---------------------------------
    window.apLoadStaff = function () {
        window.apPurgeExpired();
        window.apRenderStaffTable();
        window.apRenderTemplates();
        window.apRenderHistory();
    };

    function assignedModulesSummary(perm) {
        return window.ADMIN_STAFF_MODULES.filter(function (m) {
            return perm.modules[m.id] || window.ADMIN_ACTIONS.some(function (a) { return tempActive(perm, m.id, a.id); });
        });
    }

    function countTemp(perm) {
        return perm.temporary ? Object.keys(perm.temporary).length : 0;
    }

    window.apRenderStaffTable = function () {
        var tbody = document.getElementById('ap-staff-tbody');
        if (!tbody) return;

        var search = (document.getElementById('ap-staff-search') || {}).value || '';
        search = search.trim().toLowerCase();
        var typeFilter = (document.getElementById('ap-staff-type-filter') || {}).value || 'all';
        var statusFilter = (document.getElementById('ap-staff-status-filter') || {}).value || 'all';

        var list = getStaffList().filter(function (s) {
            if (typeFilter !== 'all' && s.type !== typeFilter) return false;
            var perm = window.apGetStaffPerm(s.id);
            if (statusFilter !== 'all' && perm.status !== statusFilter) return false;
            if (search) {
                var hay = ((s.name || '') + ' ' + (s.id || '') + ' ' + (s.position || '')).toLowerCase();
                if (hay.indexOf(search) === -1) return false;
            }
            return true;
        });

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">کوئی عملہ نہیں ملا۔ نیا عملہ شامل کریں یا رجسٹریشن ماڈیول سے اساتذہ/عملہ درج کریں۔</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(function (s) {
            var perm = window.apGetStaffPerm(s.id);
            var assigned = assignedModulesSummary(perm);
            var chips = assigned.length
                ? assigned.map(function (m) { return '<span class="ap-chip">' + m.name + '</span>'; }).join(' ')
                : '<span style="color:#94a3b8; font-size:12px;">کوئی شعبہ تفویض نہیں</span>';

            var tempN = countTemp(perm);
            var tempBadge = tempN > 0 ? ' <span class="ap-badge ap-badge-temp"><i class="fas fa-clock"></i> ' + tempN + ' عارضی</span>' : '';

            var statusBadge = perm.status === 'active'
                ? '<span class="ap-badge ap-badge-on">فعال</span>'
                : '<span class="ap-badge ap-badge-off">غیر فعال</span>';

            var typeLabel = s.type === 'teacher' ? 'استاد' : 'عملہ';

            var toggleBtn = perm.status === 'active'
                ? '<button type="button" class="btn btn-danger btn-sm" onclick="window.apToggleStatus(\'' + apEscAttr(s.id) + '\')" title="غیر فعال کریں"><i class="fas fa-ban"></i></button>'
                : '<button type="button" class="btn btn-success btn-sm" onclick="window.apToggleStatus(\'' + apEscAttr(s.id) + '\')" title="فعال کریں"><i class="fas fa-check"></i></button>';

            return '<tr>' +
                '<td><strong style="color:#0f766e;">' + apEsc(s.name || 'نامعلوم') + '</strong>' +
                '<br><small style="color:#64748b;">' + apEsc(s.id || '-') + ' • ' + typeLabel + '</small></td>' +
                '<td>' + apEsc(s.position || '-') + '</td>' +
                '<td>' + statusBadge + tempBadge + '</td>' +
                '<td>' + chips + '</td>' +
                '<td class="ap-row-actions">' +
                '<button type="button" class="btn btn-primary btn-sm" onclick="window.apOpenStaffModal(\'' + apEscAttr(s.id) + '\')" title="تفصیلی اجازت"><i class="fas fa-sliders-h"></i></button> ' +
                '<button type="button" class="btn btn-outline btn-sm" onclick="window.apOpenHistoryModal(\'' + apEscAttr(s.id) + '\')" title="ہسٹری"><i class="fas fa-history"></i></button> ' +
                toggleBtn +
                '</td></tr>';
        }).join('');
    };

    window.apRenderTemplates = function () {
        var grid = document.getElementById('ap-templates-grid');
        if (!grid) return;
        grid.innerHTML = Object.keys(window.ADMIN_TEMPLATES).map(function (key) {
            var t = window.ADMIN_TEMPLATES[key];
            var rows = Object.keys(t.actions).map(function (mod) {
                var acts = t.actions[mod].map(function (a) { return apActionName(a); }).join('، ');
                return '<div style="font-size:12px; margin-top:4px;"><span class="ap-chip">' + apModuleName(mod) + '</span> <span style="color:#475569;">' + acts + '</span></div>';
            }).join('');
            return '<div class="ap-template-card">' +
                '<h3><i class="fas ' + (t.icon || 'fa-layer-group') + '"></i> ' + t.name + '</h3>' +
                '<div style="margin-top:8px;">' + rows + '</div>' +
                '</div>';
        }).join('');
    };

    // عالمی اجازت ہسٹری (تمام عملہ)
    window.apRenderHistory = function () {
        var tbody = document.getElementById('ap-history-tbody');
        if (!tbody) return;
        var perms = getAllPerms();
        var staffMap = {};
        getStaffList().forEach(function (s) { staffMap[s.id] = s.name || s.id; });

        var rows = [];
        Object.keys(perms).forEach(function (sid) {
            var p = perms[sid];
            (p.history || []).forEach(function (h) {
                rows.push({
                    staff: staffMap[sid] || sid,
                    type: h.type,
                    detail: h.detail,
                    by: h.by,
                    at: h.at
                });
            });
        });
        rows.sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
        rows = rows.slice(0, 200);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">ابھی کوئی تبدیلی ریکارڈ نہیں ہوئی۔</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (r) {
            return '<tr>' +
                '<td>' + apFormatDateTime(r.at) + '</td>' +
                '<td><strong>' + r.staff + '</strong></td>' +
                '<td>' + (r.detail || apHistoryTypeLabel(r.type)) + '</td>' +
                '<td>' + (r.by || '-') + '</td>' +
                '</tr>';
        }).join('');
    };

    function apHistoryTypeLabel(type) {
        var map = {
            created: 'اکاؤنٹ بنایا',
            status_changed: 'اسٹیٹس تبدیل',
            modules_changed: 'شعبے تبدیل',
            actions_changed: 'اعمال تبدیل',
            template_applied: 'ٹیمپلیٹ لاگو',
            temp_granted: 'عارضی اجازت دی',
            temp_removed: 'عارضی اجازت ہٹائی',
            temp_expired: 'عارضی اجازت ختم'
        };
        return map[type] || type;
    }

    // ------------------------- اسٹیٹس toggle --------------------------------
    window.apToggleStatus = function (staffId) {
        var perms = getAllPerms();
        var p = migratePerm(perms[staffId], staffId);
        p.status = (p.status === 'active') ? 'disabled' : 'active';
        p.history.push({
            type: 'status_changed',
            detail: 'اسٹیٹس: ' + (p.status === 'active' ? 'فعال' : 'غیر فعال'),
            by: apCurrentAdmin(),
            at: apNow()
        });
        p.updatedAt = apNow();
        p.updatedBy = apCurrentAdmin();
        perms[staffId] = p;
        saveAllPerms(perms);
        apToast(p.status === 'active' ? 'عملہ فعال کر دیا گیا۔' : 'عملہ غیر فعال کر دیا گیا۔', p.status === 'active' ? 'success' : 'warning');
        window.apRenderStaffTable();
        window.apRenderHistory();
    };

    // ------------------------ تفصیلی اجازت ماڈل -----------------------------
    window.apOpenStaffModal = function (staffId) {
        var staff = getStaffList().filter(function (s) { return s.id === staffId; })[0];
        if (!staff) return;
        var perm = window.apGetStaffPerm(staffId);

        var nameEl = document.getElementById('ap-modal-staff-name');
        if (nameEl) nameEl.textContent = staff.name || staffId;

        var templateOptions = '<option value="">— ٹیمپلیٹ منتخب کریں —</option>' +
            Object.keys(window.ADMIN_TEMPLATES).map(function (k) {
                return '<option value="' + k + '"' + (perm.template === k ? ' selected' : '') + '>' + window.ADMIN_TEMPLATES[k].name + '</option>';
            }).join('');

        // اعمال میٹرکس ٹیبل
        var actionHead = window.ADMIN_ACTIONS.map(function (a) {
            return '<th title="' + a.name + '"><i class="fas ' + a.icon + '"></i><br>' + a.name + '</th>';
        }).join('');

        var matrixRows = window.ADMIN_STAFF_MODULES.map(function (m) {
            var modOn = perm.modules[m.id];
            var actCells = window.ADMIN_ACTIONS.map(function (a) {
                var checked = perm.actions[m.id] && perm.actions[m.id][a.id] ? ' checked' : '';
                return '<td style="text-align:center;"><input type="checkbox" class="ap-act-check" data-mod="' + m.id + '" data-act="' + a.id + '"' + checked + '></td>';
            }).join('');
            return '<tr data-modrow="' + m.id + '">' +
                '<td><label class="ap-modrow-label"><input type="checkbox" class="ap-mod-check" data-mod="' + m.id + '"' + (modOn ? ' checked' : '') + '> <i class="fas ' + m.icon + '"></i> ' + m.name + '</label></td>' +
                actCells +
                '</tr>';
        }).join('');

        // عارضی اجازت — موجودہ فہرست
        var tempListHTML = apRenderTempList(perm);

        // عارضی اجازت — granter
        var modOptions = window.ADMIN_STAFF_MODULES.map(function (m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
        var actOptions = window.ADMIN_ACTIONS.map(function (a) { return '<option value="' + a.id + '">' + a.name + '</option>'; }).join('');
        var durOptions = window.ADMIN_TEMP_DURATIONS.map(function (d) { return '<option value="' + d.id + '">' + d.name + '</option>'; }).join('');

        var body = document.getElementById('ap-staff-modal-body');
        body.innerHTML =
            '<div class="input-group" style="margin-bottom:12px;">' +
            '<label><i class="fas fa-layer-group"></i> تیار شدہ ٹیمپلیٹ لاگو کریں</label>' +
            '<div style="display:flex; gap:8px;">' +
            '<select id="ap-modal-template" class="input-control">' + templateOptions + '</select>' +
            '<button type="button" class="btn btn-outline" onclick="window.apApplyTemplateInModal()" style="white-space:nowrap;">لاگو کریں</button>' +
            '</div></div>' +

            '<div style="background:#f8fafc; padding:6px 12px; border-radius:6px; margin-bottom:10px; font-size:12px; color:#64748b;">' +
            '<i class="fas fa-info-circle"></i> «فعال» کالم شعبے کو آن کرتا ہے؛ ہر عمل (دیکھیں/بنائیں/ترمیم/حذف/رپورٹ) الگ سے کنٹرول ہوتا ہے۔</div>' +

            '<div class="table-responsive"><table class="data-table ap-matrix">' +
            '<thead><tr><th style="text-align:right;">شعبہ (فعال)</th>' + actionHead + '</tr></thead>' +
            '<tbody>' + matrixRows + '</tbody></table></div>' +

            '<div class="ap-temp-section">' +
            '<h4 style="margin:14px 0 8px;"><i class="fas fa-clock"></i> عارضی اجازت دیں</h4>' +
            '<div class="ap-temp-granter">' +
            '<select id="ap-temp-mod" class="input-control">' + modOptions + '</select>' +
            '<select id="ap-temp-act" class="input-control">' + actOptions + '</select>' +
            '<select id="ap-temp-dur" class="input-control">' + durOptions + '</select>' +
            '<button type="button" class="btn btn-warning" onclick="window.apGrantTemp(\'' + staffId + '\')" style="white-space:nowrap;"><i class="fas fa-hourglass-start"></i> دیں</button>' +
            '</div>' +
            '<div id="ap-temp-list" style="margin-top:10px;">' + tempListHTML + '</div>' +
            '</div>' +

            '<div class="ap-temp-section" style="margin-top:14px; border-top:1px dashed #cbd5e1; padding-top:12px;">' +
            '<h4 style="margin:0 0 8px;"><i class="fas fa-key"></i> Teacher Access Key</h4>' +
            '<p style="font-size:12px; color:#64748b; margin:0 0 8px;">استاد لاگ ان کے بعد یہ Key درکار ہوگی۔</p>' +
            '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">' +
            '<select id="ap-teacher-key-ttl" class="input-control" style="max-width:120px;" title="Key کی مدت">' + apKeyTtlOptionsHtml() + '</select>' +
            '<button type="button" class="btn btn-warning" onclick="window.apGenerateTeacherKey(\'' + staffId + '\')"><i class="fas fa-key"></i> Key بنائیں / Reset</button>' +
            '<span id="ap-teacher-key-display" style="font-size:12px;color:#64748b;align-self:center;">—</span>' +
            '</div></div>' +

            '<div class="ap-temp-section" style="margin-top:14px; border-top:1px dashed #cbd5e1; padding-top:12px;">' +
            '<h4 style="margin:0 0 8px;"><i class="fas fa-link"></i> لاگ ان اکاؤنٹ منسلک کریں (Staff Link)</h4>' +
            '<p style="font-size:12px; color:#64748b; margin:0 0 8px;">عملہ کا Firebase ای میل درج کریں۔ پہلی بار لاگ ان پر خود فعال ہو جائے گا۔</p>' +
            '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<input type="email" id="ap-staff-link-email" class="input-control" placeholder="staff@example.com" value="' + (staff.email || staff.gmail || '') + '" style="flex:1; min-width:200px; direction:ltr;">' +
            '<button type="button" class="btn btn-success" onclick="window.apLinkStaffAccount(\'' + staffId + '\')"><i class="fas fa-user-check"></i> منسلک کریں</button>' +
            '</div></div>';

        var saveBtn = document.getElementById('ap-staff-save-btn');
        if (saveBtn) saveBtn.onclick = function () { window.apSaveStaffPerm(staffId); };

        if (typeof window.openModal === 'function') window.openModal('ap-staff-modal');
    };

    function apRenderTempList(perm) {
        var keys = perm.temporary ? Object.keys(perm.temporary) : [];
        if (keys.length === 0) {
            return '<div style="color:#94a3b8; font-size:12px;">کوئی فعال عارضی اجازت نہیں۔</div>';
        }
        return keys.map(function (key) {
            var t = perm.temporary[key];
            var left = Math.max(0, Math.ceil((new Date(t.expiry).getTime() - Date.now()) / 86400000));
            return '<div class="ap-temp-item">' +
                '<span><i class="fas fa-clock"></i> ' + apKeyLabel(key) + '</span>' +
                '<span class="ap-temp-meta">' + left + ' دن باقی • ' + apFormatDateTime(t.expiry) + '</span>' +
                '<button type="button" class="btn btn-danger btn-sm" onclick="window.apRemoveTemp(\'' + perm.staffId + '\',\'' + key + '\')"><i class="fas fa-times"></i></button>' +
                '</div>';
        }).join('');
    }

    window.apGrantTemp = function (staffId) {
        var mod = (document.getElementById('ap-temp-mod') || {}).value;
        var act = (document.getElementById('ap-temp-act') || {}).value;
        var dur = parseInt((document.getElementById('ap-temp-dur') || {}).value, 10) || 1;
        if (!mod || !act) return;

        var perms = getAllPerms();
        var p = migratePerm(perms[staffId], staffId);
        var key = mod + '.' + act;
        var expiryMs = Date.now() + dur * 86400000;
        var expiry = new Date(expiryMs).toISOString();
        p.temporary[key] = { expiry: expiry, expiryAt: expiryMs, grantedBy: apCurrentAdmin(), grantedAt: apNow(), days: dur };
        p.history.push({
            type: 'temp_granted',
            detail: 'عارضی اجازت (' + dur + ' دن): ' + apKeyLabel(key),
            by: apCurrentAdmin(),
            at: apNow()
        });
        p.updatedAt = apNow();
        perms[staffId] = p;
        saveAllPerms(perms);
        apToast(dur + ' دن کی عارضی اجازت دے دی گئی۔', 'success');

        var listEl = document.getElementById('ap-temp-list');
        if (listEl) listEl.innerHTML = apRenderTempList(p);
        window.apRenderStaffTable();
        window.apRenderHistory();
    };

    window.apRemoveTemp = function (staffId, key) {
        var perms = getAllPerms();
        var p = migratePerm(perms[staffId], staffId);
        if (p.temporary[key]) {
            delete p.temporary[key];
            p.history.push({
                type: 'temp_removed',
                detail: 'عارضی اجازت ہٹائی: ' + apKeyLabel(key),
                by: apCurrentAdmin(),
                at: apNow()
            });
            p.updatedAt = apNow();
            perms[staffId] = p;
            saveAllPerms(perms);
            apToast('عارضی اجازت ہٹا دی گئی۔', 'warning');
            var listEl = document.getElementById('ap-temp-list');
            if (listEl) listEl.innerHTML = apRenderTempList(p);
            window.apRenderStaffTable();
            window.apRenderHistory();
        }
    };

    window.apApplyTemplateInModal = function () {
        var sel = document.getElementById('ap-modal-template');
        if (!sel || !sel.value) { apToast('پہلے ٹیمپلیٹ منتخب کریں۔', 'warning'); return; }
        var tpl = window.ADMIN_TEMPLATES[sel.value];
        if (!tpl) return;

        // پہلے سب صاف کریں
        document.querySelectorAll('#ap-staff-modal-body .ap-mod-check').forEach(function (cb) { cb.checked = false; });
        document.querySelectorAll('#ap-staff-modal-body .ap-act-check').forEach(function (cb) { cb.checked = false; });

        Object.keys(tpl.actions).forEach(function (mod) {
            var modCb = document.querySelector('#ap-staff-modal-body .ap-mod-check[data-mod="' + mod + '"]');
            if (modCb) modCb.checked = true;
            tpl.actions[mod].forEach(function (act) {
                var actCb = document.querySelector('#ap-staff-modal-body .ap-act-check[data-mod="' + mod + '"][data-act="' + act + '"]');
                if (actCb) actCb.checked = true;
            });
        });
        apToast('«' + tpl.name + '» ٹیمپلیٹ لاگو ہو گیا۔ محفوظ کرنا نہ بھولیں۔', 'success');
    };

    window.apSaveStaffPerm = function (staffId) {
        var perms = getAllPerms();
        var oldP = migratePerm(perms[staffId], staffId);

        var newModules = {};
        var newActions = {};
        window.ADMIN_STAFF_MODULES.forEach(function (m) {
            newModules[m.id] = false;
            newActions[m.id] = emptyActions();
        });
        document.querySelectorAll('#ap-staff-modal-body .ap-mod-check').forEach(function (cb) {
            newModules[cb.getAttribute('data-mod')] = cb.checked;
        });
        document.querySelectorAll('#ap-staff-modal-body .ap-act-check').forEach(function (cb) {
            var mod = cb.getAttribute('data-mod');
            var act = cb.getAttribute('data-act');
            if (newActions[mod]) newActions[mod][act] = cb.checked;
        });

        // تبدیلیوں کی ہسٹری (diff)
        var changes = [];
        window.ADMIN_STAFF_MODULES.forEach(function (m) {
            if (oldP.modules[m.id] !== newModules[m.id]) {
                changes.push(apModuleName(m.id) + ': شعبہ ' + (newModules[m.id] ? 'آن' : 'آف'));
            }
            window.ADMIN_ACTIONS.forEach(function (a) {
                var ov = oldP.actions[m.id] ? !!oldP.actions[m.id][a.id] : false;
                var nv = newActions[m.id][a.id];
                if (ov !== nv) {
                    changes.push(apModuleName(m.id) + ' › ' + apActionName(a.id) + ': ' + (nv ? 'اجازت' : 'منسوخ'));
                }
            });
        });

        var tplSel = document.getElementById('ap-modal-template');
        oldP.modules = newModules;
        oldP.actions = newActions;
        oldP.template = tplSel ? tplSel.value : (oldP.template || '');
        oldP.status = oldP.status || 'active';
        oldP.updatedAt = apNow();
        oldP.updatedBy = apCurrentAdmin();

        if (changes.length > 0) {
            oldP.history.push({
                type: 'actions_changed',
                detail: changes.join(' | '),
                by: apCurrentAdmin(),
                at: apNow()
            });
        }

        perms[staffId] = oldP;
        saveAllPerms(perms).then(function () {
            return apPushStaffClaimsForStaffId(staffId);
        }).then(function (syncRes) {
            var msg = changes.length > 0 ? 'اجازتیں محفوظ (' + changes.length + ' تبدیلیاں)۔' : 'محفوظ ہو گیا (کوئی تبدیلی نہیں)۔';
            if (syncRes && syncRes.synced) msg += ' JWT claims تازہ۔';
            apToast(msg, 'success');
        });
        if (typeof window.closeModal === 'function') window.closeModal('ap-staff-modal');
        window.apRenderStaffTable();
        window.apRenderHistory();
    };

    // -------------------------- فی عملہ ہسٹری ماڈل ---------------------------
    window.apOpenHistoryModal = function (staffId) {
        var staff = getStaffList().filter(function (s) { return s.id === staffId; })[0];
        var perm = window.apGetStaffPerm(staffId);
        var nameEl = document.getElementById('ap-history-staff-name');
        if (nameEl) nameEl.textContent = staff ? (staff.name || staffId) : staffId;

        var body = document.getElementById('ap-history-modal-body');
        var hist = (perm.history || []).slice().sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
        if (hist.length === 0) {
            body.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px;">اس عملہ کی کوئی تبدیلی ریکارڈ نہیں۔</div>';
        } else {
            body.innerHTML = '<table class="data-table"><thead><tr><th>تاریخ و وقت</th><th>تبدیلی</th><th>کس نے</th></tr></thead><tbody>' +
                hist.map(function (h) {
                    return '<tr><td style="white-space:nowrap;">' + apFormatDateTime(h.at) + '</td>' +
                        '<td>' + (h.detail || apHistoryTypeLabel(h.type)) + '</td>' +
                        '<td>' + (h.by || '-') + '</td></tr>';
                }).join('') + '</tbody></table>';
        }
        if (typeof window.openModal === 'function') window.openModal('ap-history-modal');
    };

    // --------------------------- نیا عملہ اکاؤنٹ ----------------------------
    window.apOpenCreateStaff = function () {
        var tplSel = document.getElementById('ap-new-template');
        if (tplSel) {
            tplSel.innerHTML = '<option value="">— کوئی نہیں —</option>' +
                Object.keys(window.ADMIN_TEMPLATES).map(function (k) {
                    return '<option value="' + k + '">' + window.ADMIN_TEMPLATES[k].name + '</option>';
                }).join('');
        }
        ['ap-new-name', 'ap-new-position', 'ap-new-phone'].forEach(function (id) {
            var el = document.getElementById(id); if (el) el.value = '';
        });
        var saveBtn = document.getElementById('ap-create-save-btn');
        if (saveBtn) saveBtn.onclick = window.apCreateStaff;
        if (typeof window.openModal === 'function') window.openModal('ap-create-modal');
    };

    function apGenerateStaffId(type) {
        var prefix = type === 'teacher' ? 'TCH' : 'STF';
        var users = getUsers();
        var max = 0;
        users.forEach(function (u) {
            if (u.type === type && typeof u.id === 'string' && u.id.indexOf(prefix + '-') === 0) {
                var n = parseInt(u.id.split('-')[1], 10);
                if (!isNaN(n) && n > max) max = n;
            }
        });
        var next = max + 1;
        return prefix + '-' + (next < 10 ? '0' + next : next);
    }

    window.apCreateStaff = function () {
        var name = (document.getElementById('ap-new-name') || {}).value || '';
        name = name.trim();
        if (!name) { apToast('نام درج کرنا لازمی ہے۔', 'error'); return; }

        var position = (document.getElementById('ap-new-position') || {}).value || '';
        var phone = (document.getElementById('ap-new-phone') || {}).value || '';
        var type = (document.getElementById('ap-new-type') || {}).value || 'teacher';
        var templateKey = (document.getElementById('ap-new-template') || {}).value || '';

        var users = getUsers();
        var newId = apGenerateStaffId(type);
        users.push({
            id: newId,
            type: type,
            name: name,
            position: position.trim(),
            phone: phone.trim(),
            status: 'approved',
            date: new Date().toISOString().split('T')[0],
            createdVia: 'admin-panel'
        });
        localStorage.setItem(DB_USERS, JSON.stringify(users));

        var perms = getAllPerms();
        var p = defaultPerm(newId);
        p.history.push({ type: 'created', detail: 'اکاؤنٹ ایڈمن پینل سے بنایا', by: apCurrentAdmin(), at: apNow() });
        if (templateKey && window.ADMIN_TEMPLATES[templateKey]) {
            var tpl = window.ADMIN_TEMPLATES[templateKey];
            Object.keys(tpl.actions).forEach(function (mod) {
                p.modules[mod] = true;
                tpl.actions[mod].forEach(function (act) { if (p.actions[mod]) p.actions[mod][act] = true; });
            });
            p.template = templateKey;
            p.history.push({ type: 'template_applied', detail: 'ٹیمپلیٹ: ' + tpl.name, by: apCurrentAdmin(), at: apNow() });
        }
        perms[newId] = p;
        saveAllPerms(perms);

        apToast('نیا عملہ «' + name + '» (' + newId + ') شامل ہو گیا۔', 'success');
        if (typeof window.closeModal === 'function') window.closeModal('ap-create-modal');
        window.apRenderStaffTable();
        window.apRenderHistory();
    };

    // ========================================================================
    // Stage 3: والدین رسائی کنٹرول — core helpers in parent-shared.js
    // ========================================================================
    function getAllParentPerms() {
        return typeof window.emsParentGetAllPerms === 'function'
            ? window.emsParentGetAllPerms()
            : (function () { try { return JSON.parse(localStorage.getItem(DB_PARENT_PERM)) || {}; } catch (e) { return {}; } })();
    }
    function saveAllParentPerms(perms) {
        if (typeof window.emsParentSaveAllPerms === 'function') {
            return window.emsParentSaveAllPerms(perms);
        }
        localStorage.setItem(DB_PARENT_PERM, JSON.stringify(perms));
        return Promise.resolve();
    }

    function emptyParentViews() {
        return typeof window.emsParentEmptyViews === 'function'
            ? window.emsParentEmptyViews()
            : {};
    }

    function defaultParentPerm(studentId) {
        var p = typeof window.emsParentDefaultPerm === 'function'
            ? window.emsParentDefaultPerm(studentId)
            : { studentId: studentId, status: 'active', views: {}, temporary: {}, history: [] };
        p.updatedBy = apCurrentAdmin();
        p.updatedAt = apNow();
        return p;
    }

    function migrateParentPerm(existing, studentId) {
        if (typeof window.emsParentMigratePerm === 'function') {
            return window.emsParentMigratePerm(existing, studentId);
        }
        return defaultParentPerm(studentId);
    }

    function parentTempActive(p, viewId) {
        return typeof window.emsParentTempActive === 'function'
            ? window.emsParentTempActive(p, viewId)
            : false;
    }

    window.apPurgeExpiredParent = function () {
        var perms = getAllParentPerms();
        var now = Date.now();
        var changed = false;
        Object.keys(perms).forEach(function (sid) {
            var p = perms[sid];
            if (!p || !p.temporary) return;
            Object.keys(p.temporary).forEach(function (vid) {
                var t = p.temporary[vid];
                if (t && t.expiry && new Date(t.expiry).getTime() <= now) {
                    p.history = p.history || [];
                    p.history.push({ type: 'temp_expired', detail: 'عارضی رسائی ختم: ' + apParentViewName(vid), by: 'system', at: apNow() });
                    delete p.temporary[vid];
                    changed = true;
                }
            });
        });
        if (changed) saveAllParentPerms(perms);
    };

    window.apRenderParentsTable = function () {
        var tbody = document.getElementById('ap-parents-tbody');
        if (!tbody) return;
        window.apPurgeExpiredParent();

        var search = (document.getElementById('ap-parent-search') || {}).value || '';
        search = search.trim().toLowerCase();

        var list = getStudentList().filter(function (s) {
            if (!search) return true;
            var hay = ((s.name || '') + ' ' + (s.id || '') + ' ' + (s.fname || '') + ' ' + (s.class || '')).toLowerCase();
            return hay.indexOf(search) !== -1;
        });

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">کوئی طالبِ علم نہیں ملا۔ رجسٹریشن ماڈیول سے طلبہ درج کریں۔</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(function (s) {
            var perm = window.apGetParentPerm(s.id);
            var allowed = window.PARENT_VIEWS.filter(function (pv) { return perm.views[pv.id] || parentTempActive(perm, pv.id); });
            var chips = allowed.length
                ? allowed.map(function (pv) { return '<span class="ap-chip ap-chip-parent">' + pv.name + '</span>'; }).join(' ')
                : '<span style="color:#94a3b8; font-size:12px;">کوئی رسائی نہیں</span>';
            var tempN = perm.temporary ? Object.keys(perm.temporary).length : 0;
            var tempBadge = tempN > 0 ? ' <span class="ap-badge ap-badge-temp"><i class="fas fa-clock"></i> ' + tempN + '</span>' : '';
            var statusBadge = perm.status === 'active'
                ? '<span class="ap-badge ap-badge-on">فعال</span>'
                : '<span class="ap-badge ap-badge-off">بند</span>';

            return '<tr>' +
                '<td><strong style="color:#0f766e;">' + apEsc(s.name || 'نامعلوم') + '</strong>' +
                '<br><small style="color:#64748b;">' + apEsc(s.id || '-') + ' • ' + apEsc(s.class || '-') + '</small></td>' +
                '<td><i class="fas fa-user"></i> ' + apEsc(s.fname || '-') + '<br><small style="color:#64748b;">' + apEsc(s.phone || '-') + '</small></td>' +
                '<td>' + statusBadge + tempBadge + '</td>' +
                '<td>' + chips + '</td>' +
                '<td class="ap-row-actions">' +
                '<button type="button" class="btn btn-primary btn-sm" onclick="window.apOpenParentModal(\'' + apEscAttr(s.id) + '\')" title="رسائی کنٹرول"><i class="fas fa-sliders-h"></i></button> ' +
                '<button type="button" class="btn btn-outline btn-sm" onclick="window.apOpenParentHistory(\'' + apEscAttr(s.id) + '\')" title="ہسٹری"><i class="fas fa-history"></i></button>' +
                '</td></tr>';
        }).join('');
    };

    window.apOpenParentModal = function (studentId) {
        var student = getStudentById(studentId);
        if (!student) return;
        var perm = window.apGetParentPerm(studentId);

        var nameEl = document.getElementById('ap-parent-modal-name');
        if (nameEl) nameEl.textContent = (student.name || studentId) + ' (والد: ' + (student.fname || '-') + ')';

        var viewsHTML = window.PARENT_VIEWS.map(function (pv) {
            var checked = perm.views[pv.id] ? ' checked' : '';
            return '<label class="ap-mod-toggle">' +
                '<input type="checkbox" class="ap-pview-check" data-view="' + pv.id + '"' + checked + '>' +
                '<span><i class="fas ' + pv.icon + '"></i> ' + pv.name + '</span>' +
                '</label>';
        }).join('');

        var viewOptions = window.PARENT_VIEWS.map(function (pv) { return '<option value="' + pv.id + '">' + pv.name + '</option>'; }).join('');
        var durOptions = window.ADMIN_TEMP_DURATIONS.map(function (d) { return '<option value="' + d.id + '">' + d.name + '</option>'; }).join('');

        var body = document.getElementById('ap-parent-modal-body');
        body.innerHTML =
            '<div style="background:#eff6ff; padding:8px 12px; border-radius:6px; margin-bottom:10px; font-size:12px; color:#1e40af;">' +
            '<i class="fas fa-shield-alt"></i> یہ والد صرف اپنے بچے «' + (student.name || '') + '» کی منتخب معلومات دیکھ سکے گا — کسی دوسرے طالبِ علم کی نہیں۔</div>' +

            '<h4 style="margin:6px 0;"><i class="fas fa-eye"></i> مستقل رسائی (Permanent)</h4>' +
            '<div class="ap-mod-grid">' + viewsHTML + '</div>' +

            '<div class="ap-temp-section">' +
            '<h4 style="margin:10px 0 8px;"><i class="fas fa-clock"></i> عارضی رسائی دیں</h4>' +
            '<div class="ap-temp-granter" style="grid-template-columns:1fr 1fr auto;">' +
            '<select id="ap-ptemp-view" class="input-control">' + viewOptions + '</select>' +
            '<select id="ap-ptemp-dur" class="input-control">' + durOptions + '</select>' +
            '<button type="button" class="btn btn-warning" onclick="window.apGrantParentTemp(\'' + studentId + '\')" style="white-space:nowrap;"><i class="fas fa-hourglass-start"></i> دیں</button>' +
            '</div>' +
            '<div id="ap-ptemp-list" style="margin-top:10px;">' + apRenderParentTempList(perm) + '</div>' +
            '</div>' +

            '<div class="ap-temp-section" style="margin-top:14px; border-top:1px dashed #cbd5e1; padding-top:12px;">' +
            '<h4 style="margin:0 0 8px;"><i class="fas fa-key"></i> Parent Access Key</h4>' +
            '<p style="font-size:12px;color:#64748b;margin:0 0 8px;">ہر طالب علم کی الگ Key — والدین لاگ ان پر درکار۔</p>' +
            '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">' +
            '<select id="ap-parent-key-ttl-' + studentId + '" class="input-control" style="max-width:120px;" title="Key کی مدت">' + apKeyTtlOptionsHtml() + '</select>' +
            '<button type="button" class="btn btn-warning" onclick="window.apGenerateParentKey(\'' + studentId + '\')"><i class="fas fa-key"></i> Key بنائیں / Reset</button>' +
            '<span id="ap-parent-key-display-' + studentId + '" style="font-size:12px;color:#64748b;">—</span>' +
            '</div></div>' +

            '<div class="ap-temp-section" style="margin-top:14px; border-top:1px dashed #cbd5e1; padding-top:12px;">' +
            '<h4 style="margin:0 0 8px;"><i class="fas fa-link"></i> والدین لاگ ان منسلک کریں (Parent Link)</h4>' +
            '<input type="email" id="ap-parent-link-email" class="input-control" placeholder="parent@example.com" value="' + (perm.parentEmail || '') + '" style="direction:ltr; margin-bottom:8px;">' +
            '<button type="button" class="btn btn-success" onclick="window.apLinkParentAccount(\'' + studentId + '\')"><i class="fas fa-user-check"></i> والد منسلک کریں</button>' +
            '</div>';

        var saveBtn = document.getElementById('ap-parent-save-btn');
        if (saveBtn) saveBtn.onclick = function () { window.apSaveParentPerm(studentId); };

        if (typeof window.openModal === 'function') window.openModal('ap-parent-modal');
    };

    function apRenderParentTempList(perm) {
        var keys = perm.temporary ? Object.keys(perm.temporary) : [];
        if (keys.length === 0) return '<div style="color:#94a3b8; font-size:12px;">کوئی فعال عارضی رسائی نہیں۔</div>';
        return keys.map(function (vid) {
            var t = perm.temporary[vid];
            var left = Math.max(0, Math.ceil((new Date(t.expiry).getTime() - Date.now()) / 86400000));
            return '<div class="ap-temp-item">' +
                '<span><i class="fas fa-clock"></i> ' + apParentViewName(vid) + '</span>' +
                '<span class="ap-temp-meta">' + left + ' دن باقی • ' + apFormatDateTime(t.expiry) + '</span>' +
                '<button type="button" class="btn btn-danger btn-sm" onclick="window.apRemoveParentTemp(\'' + perm.studentId + '\',\'' + vid + '\')"><i class="fas fa-times"></i></button>' +
                '</div>';
        }).join('');
    }

    window.apGrantParentTemp = function (studentId) {
        var vid = (document.getElementById('ap-ptemp-view') || {}).value;
        var dur = parseInt((document.getElementById('ap-ptemp-dur') || {}).value, 10) || 1;
        if (!vid) return;
        var perms = getAllParentPerms();
        var p = migrateParentPerm(perms[studentId], studentId);
        p.temporary[vid] = {
            expiry: new Date(Date.now() + dur * 86400000).toISOString(),
            expiryAt: Date.now() + dur * 86400000,
            grantedBy: apCurrentAdmin(),
            grantedAt: apNow(),
            days: dur
        };
        p.history.push({ type: 'temp_granted', detail: 'عارضی رسائی (' + dur + ' دن): ' + apParentViewName(vid), by: apCurrentAdmin(), at: apNow() });
        p.updatedAt = apNow();
        perms[studentId] = p;
        saveAllParentPerms(perms);
        apToast(dur + ' دن کی عارضی رسائی دے دی گئی۔', 'success');
        var listEl = document.getElementById('ap-ptemp-list');
        if (listEl) listEl.innerHTML = apRenderParentTempList(p);
        window.apRenderParentsTable();
    };

    window.apRemoveParentTemp = function (studentId, vid) {
        var perms = getAllParentPerms();
        var p = migrateParentPerm(perms[studentId], studentId);
        if (p.temporary[vid]) {
            delete p.temporary[vid];
            p.history.push({ type: 'temp_removed', detail: 'عارضی رسائی ہٹائی: ' + apParentViewName(vid), by: apCurrentAdmin(), at: apNow() });
            p.updatedAt = apNow();
            perms[studentId] = p;
            saveAllParentPerms(perms);
            apToast('عارضی رسائی ہٹا دی گئی۔', 'warning');
            var listEl = document.getElementById('ap-ptemp-list');
            if (listEl) listEl.innerHTML = apRenderParentTempList(p);
            window.apRenderParentsTable();
        }
    };

    window.apSaveParentPerm = function (studentId) {
        var perms = getAllParentPerms();
        var oldP = migrateParentPerm(perms[studentId], studentId);
        var newViews = emptyParentViews();
        document.querySelectorAll('#ap-parent-modal-body .ap-pview-check').forEach(function (cb) {
            newViews[cb.getAttribute('data-view')] = cb.checked;
        });

        var emailEl = document.getElementById('ap-parent-link-email');
        if (emailEl && emailEl.value.trim()) {
            oldP.parentEmail = emailEl.value.trim().toLowerCase();
        }

        var changes = [];
        window.PARENT_VIEWS.forEach(function (pv) {
            if (!!oldP.views[pv.id] !== !!newViews[pv.id]) {
                changes.push(pv.name + ': ' + (newViews[pv.id] ? 'اجازت' : 'منسوخ'));
            }
        });
        oldP.views = newViews;
        oldP.updatedAt = apNow();
        oldP.updatedBy = apCurrentAdmin();
        if (changes.length > 0) {
            oldP.history.push({ type: 'views_changed', detail: changes.join(' | '), by: apCurrentAdmin(), at: apNow() });
        }
        perms[studentId] = oldP;
        saveAllParentPerms(perms);
        apToast(changes.length > 0 ? 'رسائی محفوظ (' + changes.length + ' تبدیلیاں)۔' : 'محفوظ ہو گیا۔', 'success');
        if (typeof window.closeModal === 'function') window.closeModal('ap-parent-modal');
        window.apRenderParentsTable();
    };

    window.apOpenParentHistory = function (studentId) {
        var student = getStudentById(studentId);
        var perm = window.apGetParentPerm(studentId);
        var nameEl = document.getElementById('ap-history-staff-name');
        if (nameEl) nameEl.textContent = (student ? (student.name || studentId) : studentId) + ' — والد رسائی';
        var body = document.getElementById('ap-history-modal-body');
        var hist = (perm.history || []).slice().sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
        if (hist.length === 0) {
            body.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px;">کوئی تبدیلی ریکارڈ نہیں۔</div>';
        } else {
            body.innerHTML = '<table class="data-table"><thead><tr><th>تاریخ و وقت</th><th>تبدیلی</th><th>کس نے</th></tr></thead><tbody>' +
                hist.map(function (h) {
                    return '<tr><td style="white-space:nowrap;">' + apFormatDateTime(h.at) + '</td><td>' + (h.detail || h.type) + '</td><td>' + (h.by || '-') + '</td></tr>';
                }).join('') + '</tbody></table>';
        }
        if (typeof window.openModal === 'function') window.openModal('ap-history-modal');
    };

    // ========================================================================
    // Stage 3: والدین پیغام رسانی مرکز (Parent Communication Center)
    // ------------------------------------------------------------------------
    // پیغامات studentId کے thread میں محفوظ۔ والد (in) ↔ ادارہ (out)۔
    // تحریری + صوتی دونوں۔ تمام ریکارڈ محفوظ رہتے ہیں۔
    // ========================================================================
    function getAllMessages() {
        try { return JSON.parse(localStorage.getItem(DB_PARENT_MSG)) || []; }
        catch (e) { return []; }
    }
    function saveAllMessages(msgs) {
        if (typeof window.emsSaveModuleData === 'function') {
            return window.emsSaveModuleData(DB_PARENT_MSG, msgs, { mutation: true, autoDelta: true });
        }
        localStorage.setItem(DB_PARENT_MSG, JSON.stringify(msgs));
        return Promise.resolve();
    }

    // parentSubmitMessage, parentGetMessages — see parent-shared.js

    window.apSyncParentMessagesFromFirestore = function () {
        var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
        var tenantId = apGetUid();
        if (!db || !tenantId) return Promise.resolve();
        return apTenantSubCol(db, tenantId, 'ParentMessages')
            .orderBy('createdAt', 'desc').limit(200)
            .get()
            .then(function (snap) {
                if (snap.empty) return;
                var local = getAllMessages();
                var map = {};
                local.forEach(function (m) { if (m && m.id) map[m.id] = m; });
                snap.forEach(function (doc) {
                    var m = doc.data();
                    if (m && m.id) map[m.id] = m;
                });
                return saveAllMessages(Object.keys(map).map(function (k) { return map[k]; }));
            })
            .catch(function () { return Promise.resolve(); });
    };

    window.apRenderCommThreads = function () {
        var tbody = document.getElementById('ap-comm-tbody');
        if (!tbody) return;
        var render = function () {
        var search = (document.getElementById('ap-comm-search') || {}).value || '';
        search = search.trim().toLowerCase();

        var msgs = getAllMessages();
        var threads = {};
        msgs.forEach(function (m) {
            if (!threads[m.studentId]) threads[m.studentId] = { studentId: m.studentId, studentName: m.studentName, last: m, count: 0, unread: 0 };
            var th = threads[m.studentId];
            th.count++;
            if ((m.at || '') >= (th.last.at || '')) th.last = m;
            if (m.direction === 'in' && !m.read) th.unread++;
        });

        var list = Object.keys(threads).map(function (k) { return threads[k]; }).filter(function (th) {
            if (!search) return true;
            return ((th.studentName || '') + ' ' + (th.studentId || '')).toLowerCase().indexOf(search) !== -1;
        });
        list.sort(function (a, b) { return (b.last.at || '').localeCompare(a.last.at || ''); });

        var unreadTotal = msgs.filter(function (m) { return m.direction === 'in' && !m.read; }).length;
        var badgeEl = document.getElementById('ap-comm-unread-badge');
        if (badgeEl) badgeEl.textContent = unreadTotal > 0 ? unreadTotal : '';

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">ابھی کوئی پیغام نہیں۔ «نیا پیغام» سے ٹیسٹ کریں۔</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(function (th) {
            var preview = th.last.format === 'voice' ? '<i class="fas fa-microphone"></i> صوتی پیغام' : (th.last.text || '').slice(0, 40);
            var dirIcon = th.last.direction === 'in' ? '<i class="fas fa-arrow-down" style="color:#16a085;"></i>' : '<i class="fas fa-arrow-up" style="color:#2980b9;"></i>';
            var unread = th.unread > 0 ? '<span class="ap-badge ap-badge-temp">' + th.unread + ' نئے</span>' : '';
            return '<tr>' +
                '<td><strong style="color:#0f766e;">' + th.studentName + '</strong><br><small style="color:#64748b;">' + th.studentId + '</small></td>' +
                '<td>' + apMsgCategoryName(th.last.category) + '</td>' +
                '<td>' + dirIcon + ' ' + preview + '</td>' +
                '<td><small>' + apFormatDateTime(th.last.at) + '</small> ' + unread + '</td>' +
                '<td class="ap-row-actions"><button type="button" class="btn btn-primary btn-sm" onclick="window.apOpenThread(\'' + th.studentId + '\')"><i class="fas fa-comments"></i> کھولیں</button></td>' +
                '</tr>';
        }).join('');
        };
        window.apSyncParentMessagesFromFirestore().then(render).catch(render);
    };

    window.apOpenThread = function (studentId) {
        var student = getStudentById(studentId);
        var nameEl = document.getElementById('ap-thread-name');
        if (nameEl) nameEl.textContent = student ? (student.name || studentId) + ' (والد: ' + (student.fname || '-') + ')' : studentId;

        var tenantId = apGetUid();
        var markRead = Promise.resolve();
        if (tenantId && typeof window.emsCallFunction === 'function') {
            markRead = window.emsCallFunction('markParentMessagesRead', {
                tenantId: tenantId,
                studentId: studentId,
                role: 'staff'
            }).catch(function () { return null; });
        }

        markRead.then(function () {
            var msgs = getAllMessages();
            var changed = false;
            msgs.forEach(function (m) {
                if (m.studentId === studentId && m.direction === 'in' && !m.read) {
                    m.read = true;
                    changed = true;
                }
            });
            if (changed) saveAllMessages(msgs);

            window.AP_THREAD_ID = studentId;
            window.apRenderThreadBody(studentId);
            apVoiceReset('ap-reply-voice');
            var ta = document.getElementById('ap-reply-text');
            if (ta) ta.value = '';
            if (typeof window.openModal === 'function') window.openModal('ap-thread-modal');
            window.apRenderCommThreads();
        });
    };

    window.apRenderThreadBody = function (studentId) {
        var box = document.getElementById('ap-thread-body');
        if (!box) return;
        var msgs = window.parentGetMessages(studentId).slice().sort(function (a, b) { return (a.at || '').localeCompare(b.at || ''); });
        if (msgs.length === 0) {
            box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px;">کوئی پیغام نہیں۔</div>';
            return;
        }
        box.innerHTML = msgs.map(function (m) {
            var side = m.direction === 'in' ? 'ap-bubble-in' : 'ap-bubble-out';
            var who = m.direction === 'in' ? (m.by || 'والد') : ('ادارہ • ' + (m.by || ''));
            var readTag = m.direction === 'in' && m.read ? ' <small style="color:#16a085;">✓ پڑھا</small>' : '';
            if (m.direction === 'out' && m.readByParent) readTag = ' <small style="color:#16a085;">✓ والد نے پڑھا</small>';
            var content = m.format === 'voice'
                ? '<audio controls src="' + (m.voice || '') + '" style="max-width:220px;"></audio>'
                : '<div>' + (m.text || '') + '</div>';
            return '<div class="ap-bubble ' + side + '">' +
                '<div class="ap-bubble-meta">' + who + ' • ' + apMsgCategoryName(m.category) + ' • ' + apFormatDateTime(m.at) + readTag + '</div>' +
                content + '</div>';
        }).join('');
        box.scrollTop = box.scrollHeight;
    };

    window.apSendReply = function () {
        var studentId = window.AP_THREAD_ID;
        if (!studentId) return;
        var ta = document.getElementById('ap-reply-text');
        var text = ta ? ta.value.trim() : '';
        var voice = apVoiceGet('ap-reply-voice');
        if (!text && !voice) { apToast('جواب لکھیں یا صوتی پیغام ریکارڈ کریں۔', 'error'); return; }

        var msgs = getAllMessages();
        var outMsg = {
            id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            studentId: studentId,
            studentName: (getStudentById(studentId) || {}).name || studentId,
            direction: 'out',
            category: 'reply',
            format: voice ? 'voice' : 'text',
            text: text,
            voice: voice || '',
            by: apCurrentAdmin(),
            at: apNow(),
            read: true
        };
        msgs.push(outMsg);
        saveAllMessages(msgs);
        var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
        var tenantId = apGetUid();
        if (db && tenantId) {
            apTenantSubCol(db, tenantId, 'ParentMessages').doc(outMsg.id)
                .set(Object.assign({}, outMsg, { createdAt: firebase.firestore.FieldValue.serverTimestamp() }), { merge: true })
                .catch(function () {});
        }
        if (ta) ta.value = '';
        apVoiceReset('ap-reply-voice');
        apToast('جواب بھیج دیا گیا۔', 'success');
        window.apRenderThreadBody(studentId);
        window.apRenderCommThreads();
    };

    // نیا پیغام (بطور والد) — ٹیسٹنگ/ریکارڈنگ کے لیے (مستقبل میں parent portal)
    window.apOpenComposeMsg = function () {
        var sel = document.getElementById('ap-compose-student');
        if (sel) {
            sel.innerHTML = getStudentList().map(function (s) {
                return '<option value="' + s.id + '">' + (s.name || s.id) + ' (' + (s.class || '-') + ')</option>';
            }).join('');
        }
        var catSel = document.getElementById('ap-compose-category');
        if (catSel) {
            catSel.innerHTML = window.PARENT_MSG_CATEGORIES.map(function (c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
        }
        var ta = document.getElementById('ap-compose-text');
        if (ta) ta.value = '';
        apVoiceReset('ap-compose-voice');
        if (typeof window.openModal === 'function') window.openModal('ap-compose-modal');
    };

    window.apSubmitCompose = function () {
        var studentId = (document.getElementById('ap-compose-student') || {}).value;
        var category = (document.getElementById('ap-compose-category') || {}).value;
        var text = (document.getElementById('ap-compose-text') || {}).value || '';
        text = text.trim();
        var voice = apVoiceGet('ap-compose-voice');
        if (!studentId) { apToast('طالبِ علم منتخب کریں۔', 'error'); return; }
        if (!text && !voice) { apToast('پیغام لکھیں یا صوتی پیغام ریکارڈ کریں۔', 'error'); return; }

        window.parentSubmitMessage(studentId, {
            category: category,
            format: voice ? 'voice' : 'text',
            text: text,
            voice: voice || ''
        });
        apToast('والد کا پیغام موصول ہو گیا۔', 'success');
        if (typeof window.closeModal === 'function') window.closeModal('ap-compose-modal');
        window.apRenderCommThreads();
    };

    // ------------------------------------------------------------------------
    // صوتی ریکارڈنگ helper (MediaRecorder) — base64 dataURL
    // ------------------------------------------------------------------------
    var apVoiceState = {}; // containerId -> { recorder, chunks, dataUrl, stream }

    function apVoiceGet(containerId) {
        return apVoiceState[containerId] ? (apVoiceState[containerId].dataUrl || '') : '';
    }

    function apVoiceReset(containerId) {
        var st = apVoiceState[containerId];
        if (st && st.recorder && st.recorder.state === 'recording') {
            try { st.recorder.stop(); } catch (e) { }
        }
        if (st && st.stream) {
            st.stream.getTracks().forEach(function (t) { t.stop(); });
        }
        apVoiceState[containerId] = { recorder: null, chunks: [], dataUrl: '', stream: null };
        var prev = document.getElementById(containerId + '-preview');
        if (prev) prev.innerHTML = '';
        var btn = document.getElementById(containerId + '-btn');
        if (btn) { btn.classList.remove('ap-rec-active'); btn.innerHTML = '<i class="fas fa-microphone"></i> ریکارڈ کریں'; }
    }

    window.apToggleVoice = function (containerId) {
        var st = apVoiceState[containerId] || (apVoiceState[containerId] = { recorder: null, chunks: [], dataUrl: '', stream: null });
        var btn = document.getElementById(containerId + '-btn');

        if (st.recorder && st.recorder.state === 'recording') {
            st.recorder.stop();
            return;
        }
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !window.MediaRecorder) {
            apToast('اس براؤزر میں صوتی ریکارڈنگ دستیاب نہیں۔', 'error');
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            st.stream = stream;
            st.chunks = [];
            var rec = new MediaRecorder(stream);
            st.recorder = rec;
            rec.ondataavailable = function (e) { if (e.data && e.data.size > 0) st.chunks.push(e.data); };
            rec.onstop = function () {
                var blob = new Blob(st.chunks, { type: 'audio/webm' });
                var reader = new FileReader();
                reader.onloadend = function () {
                    st.dataUrl = reader.result;
                    var prev = document.getElementById(containerId + '-preview');
                    if (prev) prev.innerHTML = '<audio controls src="' + st.dataUrl + '" style="max-width:220px;"></audio> ' +
                        '<button type="button" class="btn btn-danger btn-sm" onclick="window.apClearVoice(\'' + containerId + '\')"><i class="fas fa-trash"></i></button>';
                };
                reader.readAsDataURL(blob);
                if (st.stream) st.stream.getTracks().forEach(function (t) { t.stop(); });
                if (btn) { btn.classList.remove('ap-rec-active'); btn.innerHTML = '<i class="fas fa-microphone"></i> ریکارڈ کریں'; }
            };
            rec.start();
            if (btn) { btn.classList.add('ap-rec-active'); btn.innerHTML = '<i class="fas fa-stop"></i> روکیں'; }
        }).catch(function () {
            apToast('مائیکروفون کی اجازت درکار ہے۔', 'error');
        });
    };

    window.apClearVoice = function (containerId) {
        apVoiceReset(containerId);
    };

    // ------------------------------ بیک اپ و سنک (Phase 1) -------------------
    function apGetUid() {
        if (typeof window.emsGetTenantId === 'function') {
            var tid = window.emsGetTenantId();
            if (tid) return tid;
        }
        if (window.CURRENT_MADRASA_TENANT_ID) return window.CURRENT_MADRASA_TENANT_ID;
        return null;
    }

    function apFormatBackupDate(ts) {
        if (!ts) return '-';
        return new Date(ts).toLocaleString('ur-PK');
    }

    function apUpdateOutboxStrip(pending, failed, deadLetter) {
        var strip = document.getElementById('ap-outbox-pending-strip');
        if (!strip) return;
        pending = pending || 0;
        failed = failed || 0;
        deadLetter = deadLetter || 0;
        if (pending <= 0 && failed <= 0 && deadLetter <= 0) {
            strip.style.display = 'none';
            strip.innerHTML = '';
            return;
        }
        strip.style.display = 'block';
        var msg = '<i class="fas fa-cloud-upload-alt"></i> <strong id="ap-outbox-pending-count">' + pending + '</strong> تبدیلیاں سنک کے منتظر (آف لائن قطار)';
        if (failed > 0) msg += ' — <span style="color:#dc2626;">' + failed + ' ناکام</span>';
        if (deadLetter > 0) msg += ' — <span style="color:#991b1b;">' + deadLetter + ' dead-letter</span>';
        strip.innerHTML = msg;
    }

    function apRenderSyncStatus() {
        var box = document.getElementById('ap-sync-status-box');
        if (!box) return;

        var netAvail = typeof window.emsIsNetworkAvailable === 'function'
            ? window.emsIsNetworkAvailable()
            : !!(window.navigator && window.navigator.onLine);
        var probeState = window.EMS_CLOUD_REACHABLE;
        var netLabel = netAvail ? 'فعال' : 'غیر فعال';
        if (probeState === true) netLabel += ' (Firestore)';
        else if (probeState === false) netLabel += ' (probe failed)';

        box.innerHTML = '<strong>نیٹ ورک:</strong> ' + netLabel + ' | <em style="opacity:.7">قطار لوڈ…</em>';

        var countP = typeof window.emsPendingSyncCount === 'function'
            ? window.emsPendingSyncCount()
            : Promise.resolve(0);
        var stateP = typeof window.emsOfflineGetSyncFailureState === 'function'
            ? window.emsOfflineGetSyncFailureState()
            : Promise.resolve({ pending: 0, failed: 0, deadLetter: 0 });

        Promise.all([countP, stateP]).then(function (results) {
            var outboxPending = results[0] || 0;
            var syncState = results[1] || {};
            var failed = syncState.failed || 0;
            var deadLetter = syncState.deadLetter || 0;
            var parts = [];

            parts.push('<strong>نیٹ ورک:</strong> ' + netLabel);
            parts.push('<strong>آف لائن قطار:</strong> <span id="ap-sync-outbox-count" style="font-size:15px;font-weight:700;color:#b45309;">' + outboxPending + '</span> منتظر اپ لوڈ');
            if (failed > 0) {
                parts.push('<strong style="color:#dc2626;">ناکام:</strong> ' + failed);
            }
            if (deadLetter > 0) {
                parts.push('<strong style="color:#991b1b;">Dead-letter:</strong> ' + deadLetter);
            }
            if (window.EmsSyncEngine && typeof window.EmsSyncEngine.getStatus === 'function') {
                var st = window.EmsSyncEngine.getStatus();
                parts.push('<strong>سنک انجن:</strong> ' + (st.online ? 'آن لائن' : 'آف لائن'));
                parts.push('<strong>Tenant:</strong> ' + (st.uid || '-'));
                if (st.pending) parts.push('<strong>ماڈیول قطار:</strong> ' + st.pending);
            }
            if (window.EmsDirect) {
                parts.push('<strong>Direct FS:</strong> فعال');
            }
            if (window.EmsCachePolicy) {
                var usage = window.EmsCachePolicy.getLocalStorageUsage();
                var limit = window.EmsCachePolicy.LS_SOFT_LIMIT;
                parts.push('<strong>کیشے:</strong> ' + Math.round(usage / 1024) + ' KB / ' + Math.round(limit / 1024) + ' KB');
            }
            box.innerHTML = parts.join(' | ');
            apUpdateOutboxStrip(outboxPending, failed, deadLetter);
        }).catch(function () {
            box.innerHTML = '<strong>نیٹ ورک:</strong> ' + netLabel + ' | <span style="color:#dc2626;">قطار لوڈ ناکام</span>';
        });
    }

    window.apRenderSyncStatus = apRenderSyncStatus;

    window.apRefreshBackupList = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-backup-tbody');
        if (!uid || !tbody || !window.EmsBackupService) return;
        apRenderSyncStatus();
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        window.EmsBackupService.listBackups(uid).then(function (list) {
            if (!list.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">کوئی بیک اپ نہیں ملا</td></tr>';
                return;
            }
            tbody.innerHTML = list.map(function (b) {
                var counts = b.recordCounts || {};
                var summary = Object.keys(counts).slice(0, 4).map(function (k) {
                    return k + ':' + counts[k];
                }).join(', ');
                return '<tr>' +
                    '<td style="font-size:11px;">' + b.id + '</td>' +
                    '<td>' + (b.type || '-') + '</td>' +
                    '<td>' + apFormatBackupDate(b.createdAt) + '</td>' +
                    '<td style="font-size:11px;">' + summary + '</td>' +
                    '<td>' +
                    '<button type="button" class="btn btn-outline btn-sm" onclick="window.apPreviewBackup(\'' + b.id + '\')">پیش نظارہ</button> ' +
                    '<button type="button" class="btn btn-warning btn-sm" onclick="window.apRestoreBackup(\'' + b.id + '\')">بحالی</button>' +
                    '</td></tr>';
            }).join('');
        });
    };

    window.apCreateBackup = function () {
        var uid = apGetUid();
        if (!uid || !window.EmsBackupService) return apToast('لاگ ان یا سروس دستیاب نہیں', 'error');
        apToast('بیک اپ بن رہا ہے...', 'warning');
        var flushChain = Promise.resolve();
        if (window.EmsSyncEngine && typeof window.EmsSyncEngine.flushQueue === 'function') {
            flushChain = flushChain.then(function () { return window.EmsSyncEngine.flushQueue(); });
        }
        if (window.EmsDirect && typeof window.EmsDirect.flushQueue === 'function') {
            flushChain = flushChain.then(function () { return window.EmsDirect.flushQueue(); });
        }
        flushChain.then(function () {
            return window.EmsBackupService.createBackup(uid, 'manual');
        }).then(function (res) {
            apToast('بیک اپ مکمل: ' + res.backupId, 'success');
            window.apRefreshBackupList();
        }).catch(function (e) {
            apToast('بیک اپ ناکام: ' + e.message, 'error');
        });
    };

    window.apPreviewBackup = function (backupId) {
        var uid = apGetUid();
        var box = document.getElementById('ap-backup-preview');
        if (!uid || !box || !window.EmsBackupService) return;
        window.EmsBackupService.previewBackup(uid, backupId).then(function (result) {
            if (!result.valid) {
                box.style.display = 'block';
                box.innerHTML = 'غلط بیک اپ: ' + (result.error || '');
                return;
            }
            var counts = result.preview || {};
            box.style.display = 'block';
            box.innerHTML = '<strong>پیش نظارہ (' + backupId + '):</strong><br>' +
                Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join(' | ') +
                '<br><em>checksum: ' + (result.checksumOk ? 'درست' : 'تنبیہ') + '</em>';
        });
    };

    window.apRestoreBackup = function (backupId) {
        var uid = apGetUid();
        if (!uid || !window.EmsBackupService) return;
        window.EmsBackupService.previewBackup(uid, backupId).then(function (preview) {
            if (!preview.valid) return apToast('بیک اپ درست نہیں', 'error');
            var msg = 'کیا آپ واقعی بحالی کرنا چاہتے ہیں؟\n\nبحالی سے پہلے خودکار pre-restore بیک اپ بنے گا۔';
            if (!confirm(msg)) return;
            apToast('بحالی جاری ہے...', 'warning');
            return window.EmsBackupService.restoreBackup(uid, backupId, { confirmed: true }).then(function (report) {
                apToast('بحالی مکمل: ' + report.restored.length + ' ماڈیول | حالت: ' + report.verification.status, 'success');
                setTimeout(function () { window.location.reload(); }, 2500);
            });
        }).catch(function (e) {
            apToast('بحالی ناکام: ' + e.message, 'error');
        });
    };

    window.apGenerateTeacherKey = function (staffId) {
        var uid = typeof window.emsGetTenantId === 'function' ? window.emsGetTenantId() : (firebase.auth().currentUser && firebase.auth().currentUser.uid);
        if (!uid || typeof window.emsResetTeacherAccessKey !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var ttlMs = apGetKeyTtlMs('ap-teacher-key-ttl');
        window.emsResetTeacherAccessKey(uid, staffId, ttlMs).then(function (key) {
            var el = document.getElementById('ap-teacher-key-display');
            var label = typeof window.emsFormatKeyTtlLabel === 'function' ? window.emsFormatKeyTtlLabel(ttlMs) : '365 دن';
            if (el) el.innerHTML = '<strong style="color:#059669;direction:ltr;">' + key + '</strong> (' + label + ' — صرف ایک بار دکھائیں)';
            apToast('Teacher Access Key: ' + key, 'success');
        }).catch(function (e) { apToast('Key ناکام: ' + e.message, 'error'); });
    };

    window.apGenerateParentKey = function (studentId) {
        var uid = typeof window.emsGetTenantId === 'function' ? window.emsGetTenantId() : (firebase.auth().currentUser && firebase.auth().currentUser.uid);
        if (!uid || typeof window.emsResetParentAccessKey !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        var ttlMs = apGetKeyTtlMs('ap-parent-key-ttl-' + studentId);
        window.emsResetParentAccessKey(uid, studentId, ttlMs).then(function (key) {
            var el = document.getElementById('ap-parent-key-display-' + studentId);
            var label = typeof window.emsFormatKeyTtlLabel === 'function' ? window.emsFormatKeyTtlLabel(ttlMs) : '365 دن';
            if (el) el.innerHTML = '<strong style="color:#059669;direction:ltr;">' + key + '</strong> <span style="font-size:11px;color:#64748b;">(' + label + ')</span>';
            apToast('Parent Access Key: ' + key, 'success');
        }).catch(function (e) { apToast('Key ناکام: ' + e.message, 'error'); });
    };

    window.apLinkStaffAccount = function (staffId) {
        var emailEl = document.getElementById('ap-staff-link-email');
        var email = emailEl ? emailEl.value.trim() : '';
        if (!email) { apToast('عملہ کا ای میل درج کریں۔', 'error'); return; }
        var uid = typeof window.emsGetTenantId === 'function' ? window.emsGetTenantId() : (firebase.auth().currentUser && firebase.auth().currentUser.uid);
        if (!uid || typeof window.emsCreateStaffLink !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        window.emsCreateStaffLink(uid, staffId, email).then(function () {
            var users = getUsers();
            var u = users.find(function (x) { return x.id === staffId; });
            if (u) { u.email = email.toLowerCase(); localStorage.setItem(DB_USERS, JSON.stringify(users)); }
            apToast('Staff Link بھیج دیا — عملہ لاگ ان پر فعال ہوگا۔', 'success');
        }).catch(function (e) { apToast('Link ناکام: ' + e.message, 'error'); });
    };

    window.apLinkParentAccount = function (studentId) {
        var emailEl = document.getElementById('ap-parent-link-email');
        var email = emailEl ? emailEl.value.trim() : '';
        if (!email) { apToast('والد کا ای میل درج کریں۔', 'error'); return; }
        var uid = typeof window.emsGetTenantId === 'function' ? window.emsGetTenantId() : (firebase.auth().currentUser && firebase.auth().currentUser.uid);
        if (!uid || typeof window.emsCreateParentLink !== 'function') {
            apToast('سروس دستیاب نہیں۔', 'error'); return;
        }
        window.emsCreateParentLink(uid, studentId, email).then(function () {
            var perms = getAllParentPerms();
            var p = migrateParentPerm(perms[studentId], studentId);
            p.parentEmail = email.toLowerCase();
            perms[studentId] = p;
            saveAllParentPerms(perms);
            apToast('Parent Link بھیج دیا گیا۔', 'success');
        }).catch(function (e) { apToast('Link ناکام: ' + e.message, 'error'); });
    };

    window.apForceSync = function () {
        apToast('سنک جاری ہے...', 'warning');
        var chain;
        if (typeof window.emsCloudPushNow === 'function') {
            var prep = (typeof window.emsPrepareManualCloudSync === 'function')
                ? window.emsPrepareManualCloudSync()
                : Promise.resolve({ ok: true });
            chain = prep.then(function (prepRes) {
                if (prepRes && prepRes.ok === false) {
                    return Promise.reject(new Error(prepRes.reason || prepRes.error || 'cloud_prep_failed'));
                }
                return window.emsCloudPushNow();
            });
        } else if (window.EmsSyncEngine && typeof window.EmsSyncEngine.flushQueue === 'function') {
            chain = window.EmsSyncEngine.flushQueue();
        } else {
            return apToast('سنک انجن دستیاب نہیں', 'error');
        }
        chain.then(function (r) {
            var flushed = (r && r.results && r.results[0] && r.results[0].flushed) || (r && r.synced) || 0;
            apToast('سنک مکمل' + (flushed ? ': ' + flushed + ' آپریشن' : ''), 'success');
            apRenderSyncStatus();
        }).catch(function (e) {
            apToast('سنک ناکام: ' + (e && e.message ? e.message : String(e)), 'error');
            apRenderSyncStatus();
        });
    };

    window.apLoadSecurityLog = function () {
        var uid = apGetUid();
        var tbody = document.getElementById('ap-security-tbody');
        if (!uid || !tbody) return;
        var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
        if (!db) return;
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">لوڈ ہو رہا ہے...</td></tr>';
        apTenantSubCol(db, uid, 'SecurityLog')
            .limit(100000)
            .get()
            .then(function (snap) {
                if (snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">کوئی واقعہ نہیں</td></tr>';
                    return;
                }
                var rows = snap.docs.map(function (d) {
                    var x = d.data();
                    return { action: x.action, email: x.email, ts: x.clientTs || 0 };
                });
                rows.sort(function (a, b) { return b.ts - a.ts; });
                tbody.innerHTML = rows.slice(0, 20).map(function (x) {
                    return '<tr><td>' + (x.action || '-') + '</td><td style="font-size:11px;">' +
                        (x.email || '-') + '</td><td style="font-size:11px;">' +
                        apFormatBackupDate(x.ts) + '</td></tr>';
                }).join('');
            })
            .catch(function () {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">لوڈ ناکام</td></tr>';
            });
    };

    // ------------------------------ اِنٹ -------------------------------------
    window.initAdminPanel = function () {
        window.apLoadStaff();
        if (typeof window.apLoadTenantKeySettings === 'function') {
            window.apLoadTenantKeySettings();
        }
        if (typeof window.apLoadSecurityPolicy === 'function') {
            window.apLoadSecurityPolicy();
        }
        if (typeof window.apLoadNotificationDelivery === 'function') {
            window.apLoadNotificationDelivery();
        }
    };

    function apBindModuleListeners() {
        if (window._apListenersBound) return;
        window._apListenersBound = true;
        var dd = document.getElementById('main-ap-dropdown');
        if (dd) {
            dd.addEventListener('change', function () {
                document.querySelectorAll('#module-admin-panel .ap-tab-content').forEach(function (el) {
                    el.style.display = 'none';
                });
                var panel = document.getElementById(this.value);
                if (panel) panel.style.display = 'block';
                if (this.value === 'ap-win-history') window.apRenderHistory();
                if (this.value === 'ap-win-parents' && typeof window.apRenderParentsTable === 'function') window.apRenderParentsTable();
                if (this.value === 'ap-win-comm' && typeof window.apRenderCommThreads === 'function') window.apRenderCommThreads();
                if (this.value === 'ap-win-backup' && typeof window.apRefreshBackupList === 'function') {
                    window.apRefreshBackupList();
                    if (typeof window.apLoadSecurityLog === 'function') window.apLoadSecurityLog();
                    if (typeof window.apLoadTenantKeySettings === 'function') window.apLoadTenantKeySettings();
                    if (typeof window.apLoadSecurityPolicy === 'function') window.apLoadSecurityPolicy();
                    if (typeof window.apLoadNotificationDelivery === 'function') window.apLoadNotificationDelivery();
                    if (typeof window.apLoadAuditExportStatus === 'function') window.apLoadAuditExportStatus();
                    if (typeof window.apLoadFailedNotifications === 'function') window.apLoadFailedNotifications();
                    if (typeof window.apLoadNotificationStats === 'function') window.apLoadNotificationStats();
                    if (typeof window.apLoadAuditExportHistory === 'function') window.apLoadAuditExportHistory();
                    if (typeof window.apLoadLoginSessions === 'function') window.apLoadLoginSessions();
                    if (typeof window.apLoadNotificationAnalytics === 'function') window.apLoadNotificationAnalytics();
                    if (typeof window.apLoadSsoPolicy === 'function') window.apLoadSsoPolicy();
                    if (typeof window.apLoadSsoProviderSummary === 'function') window.apLoadSsoProviderSummary();
                    if (typeof window.apLoadTrustedDevices === 'function') window.apLoadTrustedDevices();
                    if (typeof window.apLoadTrustedDeviceStats === 'function') window.apLoadTrustedDeviceStats();
                    if (typeof window.apLoadSecurityEvents === 'function') window.apLoadSecurityEvents();
                    if (typeof window.apLoadMfaPolicySummary === 'function') window.apLoadMfaPolicySummary();
                    if (typeof window.apLoadLoginSecurityOverview === 'function') window.apLoadLoginSecurityOverview();
                    if (typeof window.apLoadLoginSecurityHealth === 'function') window.apLoadLoginSecurityHealth();
                    if (typeof window.apLoadSecurityWebhookStatus === 'function') window.apLoadSecurityWebhookStatus();
                    if (typeof window.apLoadSecurityAlertSummary === 'function') window.apLoadSecurityAlertSummary();
                    if (typeof window.apLoadLoginIpSummary === 'function') window.apLoadLoginIpSummary();
                    if (typeof window.apLoadLoginLockouts === 'function') window.apLoadLoginLockouts();
                    if (typeof window.apLoadSessionAnomalies === 'function') window.apLoadSessionAnomalies();
                    if (typeof window.apLoadLoginAuditSummary === 'function') window.apLoadLoginAuditSummary();
                    if (typeof window.apLoadKeyAlerts === 'function') window.apLoadKeyAlerts();
                    if (typeof window.apLoadKeyExpiryDashboard === 'function') window.apLoadKeyExpiryDashboard();
                }
            });
        }
        ['ap-staff-search', 'ap-staff-type-filter', 'ap-staff-status-filter'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function () { window.apRenderStaffTable(); });
            el.addEventListener('change', function () { window.apRenderStaffTable(); });
        });
        var pSearch = document.getElementById('ap-parent-search');
        if (pSearch) pSearch.addEventListener('input', function () { window.apRenderParentsTable(); });
        var cSearch = document.getElementById('ap-comm-search');
        if (cSearch) cSearch.addEventListener('input', function () { window.apRenderCommThreads(); });

        // عارضی اجازتوں کی وقتاً فوقتاً صفائی (ہر 5 منٹ)
        setInterval(function () {
            if (typeof window.apPurgeExpired === 'function') window.apPurgeExpired();
            if (typeof window.apPurgeExpiredParent === 'function') window.apPurgeExpiredParent();
        }, 300000);

        setInterval(function () {
            var mod = document.getElementById('module-admin-panel');
            if (!mod || mod.style.display === 'none') return;
            apRenderSyncStatus();
        }, 12000);

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('ems:sync-failure', function () {
                var mod = document.getElementById('module-admin-panel');
                if (mod && mod.style.display !== 'none') apRenderSyncStatus();
            });
        }

        var adminTab = document.getElementById('tab-admin-panel');
        if (adminTab && !adminTab._apOutboxBound) {
            adminTab._apOutboxBound = true;
            adminTab.addEventListener('click', function () {
                setTimeout(apRenderSyncStatus, 200);
            });
        }
    }

    if (typeof window.emsRunWhenDomReady === 'function') {
        window.emsRunWhenDomReady(apBindModuleListeners);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apBindModuleListeners, { once: true });
    } else {
        apBindModuleListeners();
    }
})();
