// ============================================================================
// سپر ایڈمن ماڈیول — Enterprise Control Panel (facade)
// ============================================================================

const SYSTEM_MODULES = [
    { id: 'admission', name: 'داخلہ (Admission)' },
    { id: 'attendance', name: 'اسمارٹ حاضری' },
    { id: 'exams', name: 'امتحانی نظام' },
    { id: 'finance', name: 'فیس و مالیات' },
    { id: 'ledger', name: 'روزنامچہ / لیجر' },
    { id: 'complaints', name: 'شکایات' },
    { id: 'announcements', name: 'اعلانات' }
];

const SA_PAGE_SIZE = 50;

window.SA_TENANTS_CACHE = [];
window.SA_PENDING_EDITS = {};
window.SA_SELECTED_UIDS = new Set();
window.SA_CURRENT_PAGE = 1;
window.SA_REASON_CALLBACK = null;
window.SA_BILLING_PLANS = [];
window.SA_TENANTS_LIVE = false;
window.SA_LEGACY_ROLE = null;

function saGetDb() {
    return typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
}

function saToast(msg, type) {
    if (window.SaCore && typeof window.SaCore.toast === 'function') window.SaCore.toast(msg, type);
    else if (typeof window.showToast === 'function') window.showToast(msg, type);
}

function saCurrentUser() {
    return firebase.auth().currentUser;
}

function saFormatDate(val) {
    if (!val) return '-';
    if (val.toDate) return val.toDate().toLocaleString('ur-PK');
    if (typeof val === 'string') return val.split('T')[0];
    return String(val);
}

function saDefaultModules() {
    var mods = {};
    SYSTEM_MODULES.forEach(function (mod) {
        mods[mod.id] = { status: 'free', expiry: '' };
    });
    return mods;
}

function saMergeTenant(uid, data) {
    var base = data || {};
    if (!window.SA_PENDING_EDITS[uid]) {
        var allowedModules;
        if (base.subStatus === 'free') {
            allowedModules = saDefaultModules();
        } else if (base.allowedModules && Object.keys(base.allowedModules).length > 0) {
            allowedModules = JSON.parse(JSON.stringify(base.allowedModules));
        } else if (window.SYSTEM_GLOBAL_STATUS === 'free') {
            allowedModules = saDefaultModules();
        } else {
            allowedModules = {};
            SYSTEM_MODULES.forEach(function (mod) {
                allowedModules[mod.id] = { status: 'locked', expiry: '' };
            });
        }
        window.SA_PENDING_EDITS[uid] = {
            subStatus: base.subStatus || 'default',
            allowedModules: allowedModules,
            billingPlan: base.billingPlan || 'basic',
            billingStatus: base.billingStatus || 'pending',
            nextDueDate: base.nextDueDate || '',
            billingNote: base.billingNote || ''
        };
    }
    return window.SA_PENDING_EDITS[uid];
}

window.toggleDateInput = function (selectElem) {
    var dateInput = selectElem.nextElementSibling;
    if (!dateInput) return;
    dateInput.style.display = selectElem.value === 'trial' ? 'block' : 'none';
};

window.saShowReasonModal = function (title, onConfirm) {
    window.SA_REASON_CALLBACK = onConfirm;
    var modal = document.getElementById('sa-reason-modal');
    var textarea = document.getElementById('sa-action-reason');
    var btn = document.getElementById('sa-reason-confirm-btn');
    if (textarea) textarea.value = '';
    if (modal) {
        if (title && modal.querySelector('h3')) modal.querySelector('h3').textContent = title;
        modal.style.display = 'flex';
    }
    if (btn) {
        btn.onclick = function () {
            var reason = textarea ? textarea.value.trim() : '';
            if (!reason) {
                saToast('وجہ درج کرنا لازمی ہے (آڈٹ کے لیے)۔', 'error');
                return;
            }
            closeModal('sa-reason-modal');
            if (typeof window.SA_REASON_CALLBACK === 'function') window.SA_REASON_CALLBACK(reason);
            window.SA_REASON_CALLBACK = null;
        };
    }
};

window.saCancelReasonModal = function () {
    window.SA_REASON_CALLBACK = null;
    closeModal('sa-reason-modal');
};

window.SA_ACTIVE_PANEL = '';

window.switchSaTab = function (panelId, btn) {
    window.saSwitchPanel(panelId, btn);
};

window.saSwitchPanel = function (panelId, btn) {
    if (window.SA_ACTIVE_PANEL === 'sa-win-audit' && typeof window.saStopAuditRealtime === 'function') {
        window.saStopAuditRealtime();
    }
    document.querySelectorAll('#module-superadmin .sa-tab-content').forEach(function (el) {
        el.style.display = 'none';
    });
    var panel = document.getElementById(panelId);
    if (panel) panel.style.display = 'block';
    window.SA_ACTIVE_PANEL = panelId;
    if (!btn) {
        btn = document.querySelector('#sa-ribbon-menu [data-sa-panel="' + panelId + '"]');
    }
    document.querySelectorAll('#sa-ribbon-menu .reg-tab[data-sa-panel]').forEach(function (b) {
        b.classList.remove('active-sub-tab');
    });
    if (btn) btn.classList.add('active-sub-tab');
    if (typeof window.saSyncNavToPanel === 'function') window.saSyncNavToPanel(panelId);
    window.saOnPanelShow(panelId);
};

window.saShowBootBanner = function (level, message) {
    var el = document.getElementById('sa-boot-banner');
    if (!el) return;
    if (!message) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    el.className = 'sa-boot-banner sa-boot-' + (level || 'info');
    el.style.display = 'flex';
    el.innerHTML = '<i class="fas fa-' + (level === 'error' ? 'exclamation-triangle' : 'info-circle') + '"></i><span>' + message + '</span>';
};

window.saRunBootDiagnostics = function () {
    var issues = [];
    if (!window.isSuperAdmin || !window.isSuperAdmin()) {
        issues.push('سپر ایڈمن رسائی نہیں — Firestore میں SuperAdmins دستاویز چیک کریں۔');
    }
    if (!saGetDb()) {
        issues.push('Firestore کنیکشن نہیں — نیٹ ورک یا لاگ ان دوبارہ چیک کریں۔');
    }
    if (issues.length) {
        window.saShowBootBanner('error', issues.join(' '));
        return false;
    }

    var probe = (window.saApi && typeof window.saApi.probeBackend === 'function')
        ? window.saApi.probeBackend()
        : Promise.resolve(null);

    probe.then(function (res) {
        if (res && res.ok) {
            window.saShowBootBanner('info', 'Backend فعال — v' + (res.version || 'ok'));
            setTimeout(function () { window.saShowBootBanner(null, null); }, 3500);
        } else {
            window.saShowBootBanner('warn', 'Cloud Functions جواب نہیں دے رہیں — billing/stats محدود ہوں گے۔');
        }
    });
    return true;
};

window.saRefreshAllPanels = function () {
    if (!window.isSuperAdmin || !window.isSuperAdmin()) return;
    var p = window.SA_ACTIVE_PANEL || 'sa-win-dashboard';
    window.saOnPanelShow(p);
    saToast('ڈیٹا ریفریش ہو رہا ہے...', 'warning');
};

window.saOnPanelShow = function (panelId) {
    if (panelId === 'sa-win-dashboard') window.loadSaDashboard();
    if (panelId === 'sa-win-tenants') window.loadSuperAdminData();
    if (panelId === 'sa-win-billing') window.loadSaBilling();
    if (panelId === 'sa-win-audit') window.loadSaAuditLog();
    if (panelId === 'sa-win-admins') window.loadSaAdmins();
    if (panelId === 'sa-win-security') window.loadSaSecurityCenter();
    if (panelId === 'sa-win-system') {
        window.loadSaSystemSettings();
        if (typeof window.loadSaNotifications === 'function') window.loadSaNotifications();
    }
    if (panelId === 'sa-win-users') {
        if (typeof window.loadSaPlatformUsers === 'function') window.loadSaPlatformUsers();
        if (typeof window.loadSaRbacPanel === 'function') window.loadSaRbacPanel();
    }
    if (panelId === 'sa-win-advisor') {
        if (typeof window.initSaAdvisorUi === 'function') window.initSaAdvisorUi();
        if (typeof window.loadSaAdvisorPanel === 'function') window.loadSaAdvisorPanel();
    }
    if (window.SaCore) window.SaCore.updateStatusBar();
};

window.initSuperAdminPanel = function () {
    var boot = function () {
        if (typeof window.saInitNavigation === 'function') window.saInitNavigation();
        if (window.SaCore) window.SaCore.applyTabVisibility();
        window.saRunBootDiagnostics();
        window.saSwitchPanel('sa-win-dashboard');
        if (window.SaTenants && typeof window.SaTenants.start === 'function') {
            window.loadSuperAdminData();
        }
        if (window.SaDashboard && typeof window.SaDashboard.init === 'function') {
            window.SaDashboard.init();
        }
    };
    if (window.SaCore && typeof window.SaCore.loadLegacyAdminRole === 'function') {
        window.SaCore.loadLegacyAdminRole().then(boot).catch(function () { boot(); });
    } else {
        boot();
    }
};

window.loadSaDashboard = function () {
    if (!window.isSuperAdmin()) return;
    if (window.SaCore) {
        if ((window.SA_TENANTS_CACHE || []).length > 0) {
            window.SaCore.refreshDashboardFromCache();
        } else {
            var firestore = saGetDb();
            if (firestore) {
                firestore.collection('Platform_Config').doc('sa_tenant_metrics').get().then(function (doc) {
                    if (doc.exists && doc.data().metrics) {
                        window.SaCore.renderTenantMetrics(doc.data().metrics);
                    }
                }).catch(function () { });
            }
        }
    }
};

window.saRenderPagination = function (totalItems, totalPages) {
    var el = document.getElementById('sa-pagination');
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    var html = '<span class="sa-page-info">' + totalItems + ' مدرسے — صفحہ ' + window.SA_CURRENT_PAGE + ' / ' + totalPages + '</span>';
    html += '<div class="sa-page-btns">';
    if (window.SA_CURRENT_PAGE > 1) {
        html += '<button type="button" class="btn btn-outline btn-sm" onclick="window.saGoPage(' + (window.SA_CURRENT_PAGE - 1) + ')"><i class="fas fa-chevron-right"></i></button>';
    }
    for (var p = 1; p <= totalPages; p++) {
        if (p === window.SA_CURRENT_PAGE) html += '<button type="button" class="btn btn-primary btn-sm" disabled>' + p + '</button>';
        else if (p <= 3 || p > totalPages - 2 || Math.abs(p - window.SA_CURRENT_PAGE) <= 1) {
            html += '<button type="button" class="btn btn-outline btn-sm" onclick="window.saGoPage(' + p + ')">' + p + '</button>';
        } else if (p === 4 || p === totalPages - 3) html += '<span>...</span>';
    }
    if (window.SA_CURRENT_PAGE < totalPages) {
        html += '<button type="button" class="btn btn-outline btn-sm" onclick="window.saGoPage(' + (window.SA_CURRENT_PAGE + 1) + ')"><i class="fas fa-chevron-left"></i></button>';
    }
    html += '</div>';
    el.innerHTML = html;
};

window.saGoPage = function (p) {
    if (typeof window.saFetchTenantPage === 'function') {
        window.saFetchTenantPage(p);
    } else {
        window.SA_CURRENT_PAGE = p;
        window.saRenderTenantTable();
    }
};

window.saUpdateBulkBar = function () {
    var bar = document.getElementById('sa-bulk-bar');
    var countEl = document.getElementById('sa-bulk-count');
    var n = window.SA_SELECTED_UIDS.size;
    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = n + ' منتخب';
};

window.loadSaSystemSettings = function () {
    var firestore = saGetDb();
    if (!firestore) return;
    firestore.collection('System_Settings').doc('System').get().then(function (doc) {
        var d = doc.exists ? doc.data() : {};
        var mm = document.getElementById('sa-maintenance-mode');
        var msg = document.getElementById('sa-maintenance-msg');
        var title = document.getElementById('sa-global-announce-title');
        var body = document.getElementById('sa-global-announce-body');
        if (mm) mm.value = d.maintenanceMode === 'on' ? 'on' : 'off';
        if (msg) msg.value = d.maintenanceMessage || '';
        if (title) title.value = (d.globalAnnouncement && d.globalAnnouncement.title) || '';
        if (body) body.value = (d.globalAnnouncement && d.globalAnnouncement.body) || '';
    });
};

window.saSaveSystemSettings = function () {
    if (window.SaCore && !window.SaCore.requirePermission('config.manage', 'سسٹم سیٹنگز')) return;
    window.saShowReasonModal('سسٹم سیٹنگز — وجہ', function (reason) {
        var firestore = saGetDb();
        var mm = document.getElementById('sa-maintenance-mode');
        var msg = document.getElementById('sa-maintenance-msg');
        var title = document.getElementById('sa-global-announce-title');
        var body = document.getElementById('sa-global-announce-body');

        var payload = {
            maintenanceMode: mm ? mm.value : 'off',
            maintenanceMessage: msg ? msg.value : '',
            globalAnnouncement: {
                title: title ? title.value : '',
                body: body ? body.value : ''
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        firestore.collection('System_Settings').doc('System').set(payload, { merge: true }).then(function () {
            window.SYSTEM_MAINTENANCE_MODE = payload.maintenanceMode === 'on';
            window.SYSTEM_MAINTENANCE_MSG = payload.maintenanceMessage;
            return window.logSaAudit('save_system_settings', '', 'system', reason, payload);
        }).then(function () {
            saToast('سسٹم سیٹنگز محفوظ!', 'success');
        }).catch(function (err) {
            saToast('ناکام: ' + err.message, 'error');
        });
    });
};

window.saPlatformBackup = function (madrasaId) {
    if (!window.isSuperAdmin()) return saToast('صرف سپر ایڈمن!', 'error');
    if (window.SaCore && !window.SaCore.requirePermission('backup.manage', 'پلیٹ فارم بیک اپ')) return;
    if (!window.EmsBackupService || typeof window.EmsBackupService.platformBackup !== 'function') {
        return saToast('بیک اپ سروس دستیاب نہیں', 'error');
    }
    var tenant = window.SA_TENANTS_CACHE.find(function (t) { return t.uid === madrasaId; });
    var name = tenant && tenant.data ? tenant.data.madrasaName : madrasaId;
    if (!confirm('کیا آپ "' + name + '" کا پلیٹ فارم بیک اپ بنانا چاہتے ہیں؟')) return;
    saToast('پلیٹ فارم بیک اپ جاری ہے...', 'warning');
    window.EmsBackupService.platformBackup(madrasaId).then(function (res) {
        saToast('بیک اپ مکمل: ' + res.platformId, 'success');
        if (typeof window.logSaAudit === 'function') {
            window.logSaAudit('platform_backup', madrasaId, name, '', { platformId: res.platformId });
        }
    }).catch(function (e) {
        saToast('بیک اپ ناکام: ' + e.message, 'error');
    });
};

document.addEventListener('DOMContentLoaded', function () {
    ['sa-tenant-search', 'sa-tenant-filter', 'sa-tenant-sort', 'sa-tenant-page-size'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (id === 'sa-tenant-search') {
            var searchTimer;
            el.addEventListener('input', function () {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(function () {
                    if (typeof window.loadSuperAdminData === 'function') window.loadSuperAdminData(true);
                }, 450);
            });
        } else {
            el.addEventListener('change', function () {
                if (id === 'sa-tenant-page-size' && typeof window.saSetTenantPageSize === 'function') {
                    window.saSetTenantPageSize(parseInt(el.value, 10) || 50);
                }
                if (typeof window.loadSuperAdminData === 'function') window.loadSuperAdminData(true);
            });
        }
    });
    ['sa-audit-filter-action', 'sa-audit-filter-admin'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { if (window.saFilterAuditLog) window.saFilterAuditLog(); });
    });
    var srcFilter = document.getElementById('sa-audit-filter-source');
    if (srcFilter) srcFilter.addEventListener('change', function () { if (window.saFilterAuditLog) window.saFilterAuditLog(); });
});
