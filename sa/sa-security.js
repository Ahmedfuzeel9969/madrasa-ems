/**
 * sa-security.js — Security Center (failed logins, lock, force logout)
 */
(function (global) {
    'use strict';

    function core() { return global.SaCore; }
    function esc(v) { return core() ? core().esc(v) : String(v || ''); }
    function toast(msg, type) { if (core()) core().toast(msg, type); }
    function db() { return core() ? core().db() : null; }

    function formatDate(val) {
        if (typeof global.saFormatDate === 'function') return global.saFormatDate(val);
        if (!val) return '-';
        if (val.toDate) return val.toDate().toLocaleString('ur-PK');
        return String(val);
    }

    function loadSecurityEvents() {
        var firestore = db();
        var tbody = document.getElementById('sa-security-events-tbody');
        if (!firestore || !tbody) return;

        firestore.collection('Platform_SecurityEvents').orderBy('timestamp', 'desc').limit(40).get()
            .then(function (snap) {
                if (snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">ابھی کوئی سیکیورٹی واقعہ نہیں</td></tr>';
                    return;
                }
                tbody.innerHTML = snap.docs.map(function (doc) {
                    var d = doc.data();
                    var sev = d.severity || 'info';
                    var sevClass = sev === 'critical' ? 'sa-badge-danger' : (sev === 'warning' ? 'sa-badge-default' : 'sa-badge-success');
                    return '<tr><td>' + esc(formatDate(d.timestamp)) + '</td>' +
                        '<td><span class="sa-badge ' + sevClass + '">' + esc(sev) + '</span></td>' +
                        '<td>' + esc(d.type || '-') + '</td>' +
                        '<td>' + esc(d.email || d.uid || '-') + '</td>' +
                        '<td><small>' + esc(d.ip || '-') + '</small></td></tr>';
                }).join('');
            }).catch(function () {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Platform_SecurityEvents لوڈ نہیں (CF deploy)</td></tr>';
            });
    }

    function loadLoginAttempts() {
        var firestore = db();
        var tbody = document.getElementById('sa-login-attempts-tbody');
        if (!firestore || !tbody) return;

        firestore.collection('LoginAttempts').limit(30).get()
            .then(function (snap) {
                if (snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">کوئی ناکام لاگ ان نہیں</td></tr>';
                    return;
                }
                tbody.innerHTML = snap.docs.map(function (doc) {
                    var d = doc.data();
                    var locked = d.lockedUntil && d.lockedUntil.toDate && d.lockedUntil.toDate() > new Date();
                    return '<tr><td>' + esc(d.email || doc.id) + '</td>' +
                        '<td>' + esc(d.count || 0) + '</td>' +
                        '<td>' + esc(formatDate(d.lastAt)) + '</td>' +
                        '<td>' + (locked ? '<span class="sa-badge sa-badge-danger">لاک</span>' : '<span class="sa-badge sa-badge-success">OK</span>') + '</td>' +
                        '<td><button type="button" class="btn btn-outline btn-sm" data-clear-email="' + esc(d.email || '') + '"><i class="fas fa-eraser"></i></button></td></tr>';
                }).join('');
                tbody.querySelectorAll('[data-clear-email]').forEach(function (btn) {
                    btn.onclick = function () { global.saClearLoginAttempts(btn.getAttribute('data-clear-email')); };
                });
            }).catch(function () {
                return firestore.collection('Platform_Config').doc('sa_login_mirror').get().then(function (doc) {
                    var rows = doc.exists && doc.data().attempts ? doc.data().attempts : [];
                    if (!rows.length) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">LoginAttempts — CF deploy ضروری</td></tr>';
                        return;
                    }
                    tbody.innerHTML = rows.slice(0, 30).map(function (d) {
                        return '<tr><td>' + esc(d.email) + '</td><td>' + esc(d.count) + '</td><td>-</td><td>-</td><td>-</td></tr>';
                    }).join('');
                });
            });
    }

    function loadSuspendedUsers() {
        var firestore = db();
        var tbody = document.getElementById('sa-suspended-users-tbody');
        if (!firestore || !tbody) return;

        firestore.collection('Platform_Users').where('accountStatus', 'in', ['suspended', 'banned']).limit(30).get()
            .then(function (snap) {
                if (snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">کوئی معطل صارف نہیں</td></tr>';
                    return;
                }
                tbody.innerHTML = snap.docs.map(function (doc) {
                    var d = doc.data();
                    var uid = doc.id;
                    return '<tr><td>' + esc(d.email || '-') + '</td>' +
                        '<td><code>' + esc(uid) + '</code></td>' +
                        '<td>' + esc(d.accountStatus || '-') + '</td>' +
                        '<td>' + esc(formatDate(d.statusUpdatedAt)) + '</td>' +
                        '<td class="sa-row-actions">' +
                        '<button type="button" class="btn btn-warning btn-sm" data-logout-uid="' + esc(uid) + '" title="Force logout"><i class="fas fa-sign-out-alt"></i></button> ' +
                        '<button type="button" class="btn btn-success btn-sm" data-unlock-uid="' + esc(uid) + '" title="Unlock"><i class="fas fa-unlock"></i></button>' +
                        '</td></tr>';
                }).join('');
                tbody.querySelectorAll('[data-logout-uid]').forEach(function (btn) {
                    btn.onclick = function () { global.saForceLogoutUser(btn.getAttribute('data-logout-uid')); };
                });
                tbody.querySelectorAll('[data-unlock-uid]').forEach(function (btn) {
                    btn.onclick = function () { global.saSetAccountLock(btn.getAttribute('data-unlock-uid'), false); };
                });
            });
    }

    global.loadSaSecurityCenter = function () {
        if (!global.isSuperAdmin()) return;
        if (core() && !core().can('security.view')) {
            toast('سیکیورٹی سینٹر دیکھنے کی اجازت نہیں۔', 'error');
            return;
        }
        loadSecurityEvents();
        loadLoginAttempts();
        loadSuspendedUsers();
    };

    global.saForceLogoutUser = function (targetUid) {
        if (core() && !core().requirePermission('security.manage', 'Force logout')) return;
        global.saShowReasonModal('Force logout — وجہ', function (reason) {
            var fallback = function () {
                toast('Cloud Functions deploy کریں (forceLogout)', 'error');
                return Promise.reject(new Error('CF_REQUIRED'));
            };
            if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
                global.saApi.callOrFallback('forceLogout', { targetUid: targetUid, reason: reason }, fallback)
                    .then(function () {
                        toast('تمام سیشن بند ہو گئے۔', 'success');
                        return global.logSaAudit('force_logout', targetUid, targetUid, reason, {});
                    }).catch(function (e) {
                        if (e.message !== 'CF_REQUIRED') toast('ناکام: ' + e.message, 'error');
                    });
            }
        });
    };

    global.saSetAccountLock = function (targetUid, locked) {
        if (core() && !core().requirePermission('security.manage', locked ? 'Lock' : 'Unlock')) return;
        global.saShowReasonModal((locked ? 'اکاؤنٹ لاک' : 'اکاؤنٹ انلاک') + ' — وجہ', function (reason) {
            if (!global.saApi || typeof global.saApi.callOrFallback !== 'function') {
                toast('Cloud Functions deploy کریں (setAccountLock)', 'error');
                return;
            }
            global.saApi.callOrFallback('setAccountLock', { targetUid: targetUid, locked: locked, reason: reason }, function () {
                toast('Cloud Functions deploy کریں (setAccountLock)', 'error');
                return Promise.reject(new Error('CF_REQUIRED'));
            }).then(function () {
                toast(locked ? 'اکاؤنٹ لاک' : 'اکاؤنٹ بحال', 'success');
                global.loadSaSecurityCenter();
            }).catch(function (e) {
                if (e.message !== 'CF_REQUIRED') toast('ناکام: ' + e.message, 'error');
            });
        });
    };

    global.saClearLoginAttempts = function (email) {
        if (!email) return;
        if (core() && !core().requirePermission('security.manage', 'Clear attempts')) return;
        if (!global.saApi || typeof global.saApi.callOrFallback !== 'function') {
            toast('Cloud Functions deploy کریں (clearLoginAttempts)', 'error');
            return;
        }
        global.saApi.callOrFallback('clearLoginAttempts', { email: email }, function () {
            toast('Cloud Functions deploy کریں (clearLoginAttempts)', 'error');
            return Promise.reject(new Error('CF_REQUIRED'));
        }).then(function () {
            toast('لاگ ان attempts صاف', 'success');
            loadLoginAttempts();
        }).catch(function (e) {
            if (e.message !== 'CF_REQUIRED') toast('ناکام: ' + e.message, 'error');
        });
    };

    global.saForcePasswordReset = function () {
        if (core() && !core().requirePermission('security.manage', 'Password reset')) return;
        var emailEl = document.getElementById('sa-security-reset-email');
        var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
        if (!email || email.indexOf('@') === -1) { toast('درست ای میل', 'error'); return; }
        global.saShowReasonModal('Password reset link — وجہ', function (reason) {
            var fallback = function () {
                toast('Cloud Functions deploy کریں (forcePasswordReset)', 'error');
                return Promise.reject(new Error('CF_REQUIRED'));
            };
            if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
                global.saApi.callOrFallback('forcePasswordReset', { email: email, reason: reason }, fallback)
                    .then(function (res) {
                        toast('Reset link تیار — notification system سے بھیجیں', 'success');
                        if (res && res.link) console.info('Password reset link:', res.link);
                        if (emailEl) emailEl.value = '';
                    }).catch(function (e) {
                        if (e.message !== 'CF_REQUIRED') toast('ناکام: ' + e.message, 'error');
                    });
            }
        });
    };

    global.saLookupUserSecurity = function () {
        var emailEl = document.getElementById('sa-security-lookup-email');
        var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
        var out = document.getElementById('sa-security-lookup-result');
        if (!email || !out) return;
        out.innerHTML = '<span class="sa-table-state"><i class="fas fa-spinner fa-spin"></i> تلاش...</span>';
        var firestore = db();
        firestore.collection('Platform_Users').where('email', '==', email).limit(1).get()
            .then(function (snap) {
                if (snap.empty) { out.textContent = 'صارف نہیں ملا'; return; }
                var d = snap.docs[0].data();
                var uid = snap.docs[0].id;
                out.innerHTML = '<strong>' + esc(d.email) + '</strong> — ' + esc(d.accountStatus || 'active') +
                    ' — UID: <code>' + esc(uid) + '</code> ' +
                    '<button type="button" class="btn btn-warning btn-sm" data-action="logout" data-uid="' + esc(uid) + '">Logout</button> ' +
                    '<button type="button" class="btn btn-danger btn-sm" data-action="lock" data-uid="' + esc(uid) + '">Lock</button>';
                if (global.SaUi) {
                    global.SaUi.bindActions(out, {
                        logout: function (el) { global.saForceLogoutUser(el.getAttribute('data-uid')); },
                        lock: function (el) { global.saSetAccountLock(el.getAttribute('data-uid'), true); }
                    });
                }
            });
    };

})(window);
