/**
 * sa-core.js — Shared Super Admin utilities (security, metrics, RBAC gating)
 */
(function (global) {
    'use strict';

    var LEGACY_ROLE_PERMS = {
        owner: null,
        support: [
            'dashboard.view', 'modules.view', 'modules.manage',
            'backup.view', 'backup.manage', 'audit.view', 'audit.export',
            'subscriptions.view', 'security.view', 'notifications.view'
        ],
        billing: [
            'dashboard.view', 'subscriptions.view', 'subscriptions.manage',
            'payments.view', 'payments.manage', 'audit.view'
        ]
    };

    var TAB_PERMISSIONS = {
        'sa-win-dashboard': 'dashboard.view',
        'sa-win-tenants': 'modules.manage',
        'sa-win-billing': 'payments.view',
        'sa-win-audit': 'audit.view',
        'sa-win-admins': 'rbac.manage',
        'sa-win-security': 'security.view',
        'sa-win-system': 'config.manage',
        'sa-win-users': 'users.view'
    };

    function db() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function toast(msg, type) {
        if (typeof global.showToast === 'function') global.showToast(msg, type);
        else if (typeof global.showTopAlert === 'function') global.showTopAlert(msg, type === 'error');
    }

    function esc(val) {
        if (val == null) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function currentUser() {
        return global.firebase && global.firebase.auth ? global.firebase.auth().currentUser : null;
    }

    function isSaOwnerRole() {
        return global.SA_LEGACY_ROLE === 'owner';
    }

    /** SA tenant list — skip bootstrap profile tied to logged-in super admin uid */
    function shouldSkipTenantInSaList(docSnap) {
        var u = currentUser();
        if (!u || !docSnap) return false;
        if (global.isSuperAdmin && global.isSuperAdmin() && docSnap.id === u.uid) return true;
        return false;
    }

    function loadLegacyAdminRole() {
        if (global.SA_LEGACY_ROLE != null) return Promise.resolve(global.SA_LEGACY_ROLE);
        var user = currentUser();
        var firestore = db();
        if (!user || !firestore) return Promise.resolve('support');

        var emailKey = (global.EmsUtils && global.EmsUtils.saEmailDocKey)
            ? global.EmsUtils.saEmailDocKey(user.email)
            : (user.email || '').toLowerCase().replace(/[@.]/g, '_');

        function roleFromSnap(doc) {
            if (doc && doc.exists && doc.data().role) {
                global.SA_LEGACY_ROLE = doc.data().role;
                return global.SA_LEGACY_ROLE;
            }
            return null;
        }

        return firestore.collection('SuperAdmins').doc(user.uid).get()
            .then(function (doc) {
                var r = roleFromSnap(doc);
                if (r) return r;
                if (emailKey) {
                    return firestore.collection('SuperAdmins').doc(emailKey).get().then(function (emailDoc) {
                        var er = roleFromSnap(emailDoc);
                        if (er) return er;
                        return firestore.collection('SuperAdmins')
                            .where('email', '==', user.email).limit(1).get();
                    });
                }
                return firestore.collection('SuperAdmins')
                    .where('email', '==', user.email).limit(1).get();
            })
            .then(function (snap) {
                if (typeof snap === 'string') return snap;
                if (snap && !snap.empty) {
                    global.SA_LEGACY_ROLE = snap.docs[0].data().role || 'support';
                    return global.SA_LEGACY_ROLE;
                }
                global.SA_LEGACY_ROLE = 'support';
                return global.SA_LEGACY_ROLE;
            })
            .catch(function () {
                global.SA_LEGACY_ROLE = 'support';
                return global.SA_LEGACY_ROLE;
            });
    }

    function saCan(permissionId) {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return false;
        if (isSaOwnerRole()) return true;
        if (typeof global.can === 'function' && global.can(permissionId)) return true;
        if (typeof global.can === 'function' && global.can('*')) return true;

        var role = global.SA_LEGACY_ROLE || 'support';
        if (role === 'owner') return true;
        var list = LEGACY_ROLE_PERMS[role] || LEGACY_ROLE_PERMS.support;
        return list.indexOf(permissionId) !== -1;
    }

    function requirePermission(permissionId, actionLabel, fn) {
        if (!saCan(permissionId)) {
            toast('آپ کو "' + (actionLabel || permissionId) + '" کی اجازت نہیں۔', 'error');
            return false;
        }
        if (typeof fn === 'function') fn();
        return true;
    }

    function applyTabVisibility() {
        var menu = document.getElementById('sa-ribbon-menu');
        if (!menu) return;

        menu.querySelectorAll('[data-sa-panel]').forEach(function (btn) {
            var panelId = btn.getAttribute('data-sa-panel');
            var perm = TAB_PERMISSIONS[panelId];
            var allowed = !perm || saCan(perm);
            btn.style.display = allowed ? '' : 'none';
            btn.disabled = !allowed;
        });

        var current = global.SA_ACTIVE_PANEL || 'sa-win-dashboard';
        var currentPerm = TAB_PERMISSIONS[current];
        if (currentPerm && !saCan(currentPerm)) {
            var first = menu.querySelector('[data-sa-panel]:not([style*="display: none"]):not([disabled])');
            if (first && typeof global.saSwitchPanel === 'function') {
                global.saSwitchPanel(first.getAttribute('data-sa-panel'), first);
            }
        }
    }

    function computeTenantMetrics(cache) {
        cache = cache || global.SA_TENANTS_CACHE || [];
        var total = 0, active = 0, suspended = 0, trialExpiring = 0, overdue = 0, newMonth = 0;
        var now = new Date();
        var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        var weekLater = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
        var today = now.toISOString().split('T')[0];
        var plans = global.SA_BILLING_PLANS || [];
        var totalDueAmount = 0;

        cache.forEach(function (t) {
            var m = t.data || {};
            total++;
            var edit = global.SA_PENDING_EDITS[t.uid] || {};
            var st = edit.subStatus || m.subStatus || 'default';
            if (st === 'suspended') suspended++;
            else active++;

            if (m.setupDate && m.setupDate >= monthStart) newMonth++;
            var bSt = edit.billingStatus || m.billingStatus;
            if (bSt === 'overdue') {
                overdue++;
                var planId = edit.billingPlan || m.billingPlan || 'basic';
                totalDueAmount += getPlanPrice(planId, plans);
            }

            var allowed = edit.allowedModules || m.allowedModules || {};
            Object.keys(allowed).forEach(function (k) {
                var mod = allowed[k];
                if (mod && mod.status === 'trial' && mod.expiry && mod.expiry >= today && mod.expiry <= weekLater) {
                    trialExpiring++;
                }
            });
        });

        return {
            total: total,
            active: active,
            suspended: suspended,
            trialExpiring: trialExpiring,
            overdue: overdue,
            newMonth: newMonth,
            totalDueAmount: totalDueAmount,
            updatedAt: new Date().toISOString()
        };
    }

    function renderTenantMetrics(metrics) {
        if (!metrics) return;
        var set = function (id, val) {
            var el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        set('sa-stat-total', metrics.total);
        set('sa-stat-active', metrics.active);
        set('sa-stat-suspended', metrics.suspended);
        set('sa-stat-trial-expiring', metrics.trialExpiring);
        set('sa-stat-overdue', metrics.overdue);
        set('sa-stat-new-month', metrics.newMonth);
        if (global.SaCharts && typeof global.SaCharts.renderFromMetrics === 'function') {
            global.SaCharts.renderFromMetrics(metrics);
        }
    }

    function refreshDashboardFromCache() {
        var metrics = computeTenantMetrics(global.SA_TENANTS_CACHE);
        renderTenantMetrics(metrics);
        updateStatusBar();
        return metrics;
    }

    function getPlanPrice(planId, plans) {
        plans = plans || global.SA_BILLING_PLANS || [];
        for (var i = 0; i < plans.length; i++) {
            if (plans[i].id === planId) return Number(plans[i].price) || 0;
        }
        if (planId === 'pro') return 2500;
        if (planId === 'enterprise') return 5000;
        return 0;
    }

    function persistMetricsCache(metrics) {
        var firestore = db();
        if (!firestore || !global.isSuperAdmin || !global.isSuperAdmin()) return Promise.resolve();
        return firestore.collection('Platform_Config').doc('sa_tenant_metrics').set({
            metrics: metrics,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(function () { });
    }

    function syncPlatformSubscription(uid, edit, tenantData) {
        var firestore = db();
        if (!firestore) return Promise.resolve();
        var payload = {
            plan: edit.billingPlan || 'basic',
            status: edit.billingStatus === 'paid' ? 'active' : (edit.billingStatus || 'pending'),
            nextDueDate: edit.nextDueDate || '',
            note: edit.billingNote || '',
            madrasaName: tenantData && tenantData.madrasaName ? tenantData.madrasaName : '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: (currentUser() && currentUser().email) || ''
        };
        return firestore.collection('Platform_Subscriptions').doc(uid).set(payload, { merge: true });
    }

    function updateStatusBar() {
        var bar = document.getElementById('sa-status-bar');
        if (!bar) return;

        var pending = Object.keys(global.SA_PENDING_EDITS || {}).length;
        var cfState = global.saApi && typeof global.saApi.available === 'function'
            ? global.saApi.available()
            : null;
        var cfText = cfState === true ? 'Cloud Functions: فعال' : (cfState === false ? 'Cloud Functions: fallback' : 'Cloud Functions: —');
        var syncEl = document.getElementById('sa-status-sync');
        var syncText = syncEl && syncEl.getAttribute('data-ts')
            ? new Date(syncEl.getAttribute('data-ts')).toLocaleString('ur-PK')
            : '—';

        bar.innerHTML =
            '<span><i class="fas fa-circle" style="color:' + (global.SA_TENANTS_LIVE ? '#22c55e' : '#3b82f6') + '"></i> ' +
            (global.SA_TENANTS_LIVE ? 'لائیو metrics' : 'Firestore pagination') + '</span>' +
            '<span>زیر التوا تبدیلیاں: <strong>' + pending + '</strong></span>' +
            '<span>' + esc(cfText) + '</span>' +
            '<span>آخری اپڈیٹ: ' + esc(syncText) + '</span>';
    }

    function markSyncTime() {
        var syncEl = document.getElementById('sa-status-sync');
        if (syncEl) syncEl.setAttribute('data-ts', new Date().toISOString());
        updateStatusBar();
    }

    global.SaCore = {
        esc: esc,
        toast: toast,
        db: db,
        currentUser: currentUser,
        shouldSkipTenantInSaList: shouldSkipTenantInSaList,
        can: saCan,
        requirePermission: requirePermission,
        loadLegacyAdminRole: loadLegacyAdminRole,
        applyTabVisibility: applyTabVisibility,
        computeTenantMetrics: computeTenantMetrics,
        renderTenantMetrics: renderTenantMetrics,
        refreshDashboardFromCache: refreshDashboardFromCache,
        getPlanPrice: getPlanPrice,
        persistMetricsCache: persistMetricsCache,
        syncPlatformSubscription: syncPlatformSubscription,
        updateStatusBar: updateStatusBar,
        markSyncTime: markSyncTime
    };

    var _origLogSaAudit = global.logSaAudit;
    global.logSaAudit = function (action, targetUid, targetName, reason, details) {
        var firestore = db();
        var user = currentUser();
        if (!firestore || !user || !global.isSuperAdmin()) return Promise.resolve();

        var entry = {
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            adminEmail: user.email || '',
            adminUid: user.uid,
            action: action,
            targetUid: targetUid || '',
            targetName: targetName || '',
            reason: reason || '',
            details: details || {},
            clientVersion: 'sa-2.0'
        };

        return firestore.collection('System_AuditLog').add(entry).catch(function (err) {
            console.warn('Audit log failed:', err);
        });
    };

})(window);
