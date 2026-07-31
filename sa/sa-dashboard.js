/**
 * sa-dashboard.js — Super Admin Phase 1: live Platform_Stats + tenant KPIs
 */
(function (global) {
    'use strict';

    var _statsUnsub = null;

    function db() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function toast(msg, type) {
        if (typeof global.showToast === 'function') global.showToast(msg, type);
        else if (typeof global.showTopAlert === 'function') global.showTopAlert(msg, type === 'error');
    }

    function renderPlatformStats(stats) {
        if (!stats) return;
        setText('sa-stat-p-users', stats.totalUsers != null ? stats.totalUsers : '-');
        setText('sa-stat-p-active', stats.activeUsers != null ? stats.activeUsers : '-');
        setText('sa-stat-p-suspended', stats.suspendedUsers != null ? stats.suspendedUsers : '-');
        setText('sa-stat-p-revenue', stats.revenueMonth != null ? ('Rs ' + Number(stats.revenueMonth).toLocaleString()) : '-');
        setText('sa-stat-p-subs', stats.activeSubscriptions != null ? stats.activeSubscriptions : '-');
        setText('sa-stat-p-new-today', stats.newToday != null ? stats.newToday : '-');

        var updated = document.getElementById('sa-stats-updated-at');
        if (updated) {
            var ts = stats.updatedAt && stats.updatedAt.toDate ? stats.updatedAt.toDate().toLocaleString('ur-PK') : '—';
            updated.textContent = 'Platform_Stats تازہ کاری: ' + ts;
        }
    }

    function clientComputeStats() {
        var firestore = db();
        if (!firestore) return Promise.resolve(null);

        var stats = {
            totalUsers: 0,
            activeUsers: 0,
            suspendedUsers: 0,
            bannedUsers: 0,
            inactiveUsers: 0,
            trialUsers: 0,
            paidUsers: 0,
            newToday: 0,
            revenueToday: 0,
            revenueMonth: 0,
            revenueYear: 0,
            activeSubscriptions: 0,
            expiredSubscriptions: 0,
            updatedAt: { toDate: function () { return new Date(); } }
        };

        var now = new Date();
        var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return firestore.collection('Platform_Users').limit(500).get().then(function (snap) {
            snap.forEach(function (doc) {
                var u = doc.data();
                stats.totalUsers++;
                switch (u.accountStatus) {
                    case 'suspended': stats.suspendedUsers++; break;
                    case 'banned': stats.bannedUsers++; break;
                    case 'inactive': stats.inactiveUsers++; break;
                    default: stats.activeUsers++;
                }
                var sub = u.subscription || {};
                if (sub.plan === 'trial') stats.trialUsers++;
                if (sub.status === 'active') stats.activeSubscriptions++;
                if (sub.status === 'expired') stats.expiredSubscriptions++;
                if (u.createdAt && u.createdAt.toDate && u.createdAt.toDate() >= startToday) stats.newToday++;
            });
            return stats;
        }).catch(function () { return stats; });
    }

    function subscribePlatformStats() {
        var firestore = db();
        if (!firestore || !global.isSuperAdmin || !global.isSuperAdmin()) return;

        if (_statsUnsub) {
            _statsUnsub();
            _statsUnsub = null;
        }

        _statsUnsub = firestore.collection('Platform_Stats').doc('current')
            .onSnapshot(function (doc) {
                if (doc.exists) renderPlatformStats(doc.data());
            }, function () { });
    }

    function loadPlatformStatsOnce() {
        var firestore = db();
        if (!firestore) return Promise.resolve();
        return firestore.collection('Platform_Stats').doc('current').get()
            .then(function (doc) {
                if (doc.exists) {
                    renderPlatformStats(doc.data());
                    return;
                }
                return clientComputeStats().then(renderPlatformStats);
            })
            .catch(function () {
                return clientComputeStats().then(renderPlatformStats);
            });
    }

    global.saRefreshPlatformStats = function () {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        toast('شماریات تازہ ہو رہی ہیں...', 'warning');

        var refreshFn = function () {
            return clientComputeStats().then(function (stats) {
                renderPlatformStats(stats);
                toast('شماریات تازہ ہو گئیں (client fallback)', 'success');
            });
        };

        if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
            return global.saApi.callOrFallback('refreshStats', {}, refreshFn).then(function () {
                toast('Platform_Stats تازہ ہو گیا', 'success');
                return loadPlatformStatsOnce();
            }).catch(function (err) {
                toast('تازہ کاری: ' + (err.message || err), 'error');
            });
        }
        return refreshFn();
    };

    global.SaDashboard = {
        init: function () {
            if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
            subscribePlatformStats();
            loadPlatformStatsOnce();
            renderHealth();
        },
        stop: function () {
            if (_statsUnsub) {
                _statsUnsub();
                _statsUnsub = null;
            }
        }
    };

    function setHealthItem(id, ok, okText, badText) {
        var el = document.getElementById(id);
        if (!el) return;
        var em = el.querySelector('em');
        if (em) {
            em.textContent = ok ? okText : badText;
            em.style.color = ok ? '#16a34a' : '#dc2626';
        }
        el.classList.toggle('sa-health-ok', !!ok);
        el.classList.toggle('sa-health-bad', !ok);
    }

    function renderHealth() {
        setHealthItem('sa-health-auth', !!(global.isSuperAdmin && global.isSuperAdmin()), 'فعال', 'ناموزوں');
        setHealthItem('sa-health-db', !!db(), 'منسلک', 'منقطع');
        var cfProbe = (global.saApi && typeof global.saApi.probeBackend === 'function')
            ? global.saApi.probeBackend()
            : Promise.resolve(null);
        cfProbe.then(function (res) {
            var cfOk = !!(res && res.ok);
            setHealthItem('sa-health-cf', cfOk, 'فعال v' + (res && res.version ? res.version : ''), 'غیر فعال');
        });
    }

    global.saRefreshPlatformHealth = renderHealth;

    global.saPublishDemoDataset = function () {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) {
            toast('صرف Super Admin', 'error');
            return;
        }
        if (typeof global.emsPublishDemoDataset !== 'function') {
            toast('Guest demo module لوڈ نہیں', 'error');
            return;
        }
        if (!confirm('Demo Dataset Firestore میں شائع کیا جائے؟')) return;
        toast('Demo Dataset شائع ہو رہا ہے...', 'warning');
        global.emsPublishDemoDataset().then(function (r) {
            toast('Demo Dataset شائع: ' + (r.count || 0) + ' ریکارڈ', 'success');
        }).catch(function (e) {
            toast('شائع ناکام: ' + (e.message || e), 'error');
        });
    };

    var _origLoadSaDashboard = global.loadSaDashboard;
    global.loadSaDashboard = function () {
        if (typeof _origLoadSaDashboard === 'function') _origLoadSaDashboard();
        if (global.SaDashboard && typeof global.SaDashboard.init === 'function') {
            global.SaDashboard.init();
        }
    };

})(window);
