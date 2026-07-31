/**
 * sa-admins.js — Super admin team + Platform_Users RBAC sync
 */
(function (global) {
    'use strict';

    var ROLE_TO_RBAC = {
        owner: ['super_admin'],
        support: ['admin'],
        billing: ['manager']
    };

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

    function syncPlatformUserByEmail(email, legacyRole) {
        var firestore = db();
        if (!firestore || !email) return Promise.resolve();
        var roles = ROLE_TO_RBAC[legacyRole] || ROLE_TO_RBAC.support;

        return firestore.collection('Platform_Users').where('email', '==', email).limit(1).get()
            .then(function (snap) {
                if (snap.empty) return null;
                var doc = snap.docs[0];
                var uid = doc.id;
                if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
                    return global.saApi.callOrFallback('assignRoles', {
                        targetUid: uid,
                        roles: roles,
                        reason: 'SuperAdmins legacy sync'
                    }, function () {
                        return firestore.collection('Platform_Users').doc(uid).set({
                            globalRoles: roles,
                            updatedBySaPanel: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    });
                }
                return firestore.collection('Platform_Users').doc(uid).set({
                    globalRoles: roles,
                    updatedBySaPanel: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });
    }

    global.loadSaAdmins = function () {
        if (!global.isSuperAdmin()) return;
        if (core() && !core().can('rbac.manage') && !core().can('users.view')) {
            if (global.SA_LEGACY_ROLE !== 'owner') {
                toast('ایڈمنز دیکھنے کی اجازت نہیں۔', 'error');
                return;
            }
        }
        var firestore = db();
        var tbody = document.getElementById('sa-admins-tbody');
        if (!firestore || !tbody) return;

        if (global.SaUi) tbody.innerHTML = global.SaUi.tableLoading(4);

        firestore.collection('SuperAdmins').get().then(function (snap) {
            var rows = '';
            snap.forEach(function (doc) {
                var d = doc.data();
                var docId = esc(doc.id);
                var email = esc(d.email || doc.id);
                var role = esc(d.role || 'support');
                var removeBtn = role === 'owner'
                    ? '-'
                    : '<button type="button" class="btn btn-danger btn-sm" data-remove-id="' + docId + '" data-remove-email="' + email + '"><i class="fas fa-trash"></i></button>';
                rows += '<tr><td>' + email + '</td><td>' + role + '</td>' +
                    '<td>' + esc(formatDate(d.addedAt)) + '</td>' +
                    '<td>' + removeBtn + '</td></tr>';
            });
            if (!rows) rows = '<tr><td colspan="4" style="text-align:center;color:#64748b;">کوئی ایڈمن نہیں</td></tr>';
            tbody.innerHTML = rows;
            tbody.querySelectorAll('[data-remove-id]').forEach(function (btn) {
                btn.onclick = function () {
                    global.saRemoveAdmin(btn.getAttribute('data-remove-id'), btn.getAttribute('data-remove-email'));
                };
            });
        });
    };

    global.saInviteAdmin = function () {
        if (core() && !core().requirePermission('rbac.manage', 'ایڈمن شامل')) return;
        var emailEl = document.getElementById('sa-new-admin-email');
        var roleEl = document.getElementById('sa-new-admin-role');
        var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
        var role = roleEl ? roleEl.value : 'support';
        if (!email || email.indexOf('@') === -1) { toast('درست ای میل درج کریں۔', 'error'); return; }

        var firestore = db();
        if (!firestore) return;

        firestore.collection('SuperAdmins').where('email', '==', email).limit(1).get().then(function (existing) {
            if (!existing.empty) {
                toast('یہ ای میل پہلے سے SuperAdmins میں موجود ہے۔', 'error');
                return;
            }
            global.saShowReasonModal('نیا ایڈمن شامل — وجہ', function (reason) {
            var docId = email.replace(/[@.]/g, '_');
            firestore.collection('SuperAdmins').doc(docId).set({
                email: email,
                role: role,
                addedAt: firebase.firestore.FieldValue.serverTimestamp(),
                addedBy: (core().currentUser() && core().currentUser().email) || ''
            }, { merge: true }).then(function () {
                return syncPlatformUserByEmail(email, role);
            }).then(function () {
                return global.logSaAudit('add_admin', docId, email, reason, { role: role });
            }).then(function () {
                toast('ایڈمن شامل — Platform_Users RBAC sync۔', 'success');
                if (emailEl) emailEl.value = '';
                global.loadSaAdmins();
            }).catch(function (err) {
                toast('شامل نہیں ہو سکا: ' + err.message, 'error');
            });
            });
        });
    };

    global.saRemoveAdmin = function (docId, email) {
        if (core() && !core().requirePermission('rbac.manage', 'ایڈمن ہٹانا')) return;
        if (!confirm('کیا ' + email + ' کو ہٹانا ہے؟')) return;
        global.saShowReasonModal('ایڈمن ہٹانے کی وجہ', function (reason) {
            db().collection('SuperAdmins').doc(docId).delete().then(function () {
                return global.logSaAudit('remove_admin', docId, email, reason, {});
            }).then(function () {
                toast('ایڈمن ہٹا دیا گیا۔', 'success');
                global.loadSaAdmins();
            });
        });
    };

})(window);
