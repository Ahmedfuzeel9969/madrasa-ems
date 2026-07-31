/**
 * sa-notifications.js — Global broadcast notifications
 */
(function (global) {
    'use strict';

    function core() { return global.SaCore; }
    function esc(v) { return core() ? core().esc(v) : String(v || ''); }
    function toast(msg, type) { if (core()) core().toast(msg, type); }
    function db() { return core() ? core().db() : null; }

    function formatDate(val) {
        if (!val) return '-';
        if (val.toDate) return val.toDate().toLocaleString('ur-PK');
        return String(val);
    }

    global.loadSaNotifications = function () {
        if (!global.isSuperAdmin()) return;
        var firestore = db();
        var tbody = document.getElementById('sa-notifications-tbody');
        if (!firestore || !tbody) return;

        firestore.collection('Platform_Notifications').orderBy('createdAt', 'desc').limit(20).get()
            .catch(function () {
                return firestore.collection('Platform_Notifications').limit(20).get();
            })
            .then(function (snap) {
                if (!snap || snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">کوئی اعلان نہیں</td></tr>';
                    return;
                }
                tbody.innerHTML = snap.docs.map(function (doc) {
                    var d = doc.data();
                    return '<tr><td>' + esc(formatDate(d.createdAt)) + '</td>' +
                        '<td>' + esc(d.title || '-') + '</td>' +
                        '<td>' + esc(d.priority || 'normal') + '</td>' +
                        '<td><small>' + esc(d.audience || 'all') + '</small></td></tr>';
                }).join('');
            });
    };

    global.saSendBroadcast = function () {
        if (core() && !core().requirePermission('notifications.send', 'اعلان بھیجیں')) return;
        var titleEl = document.getElementById('sa-broadcast-title');
        var bodyEl = document.getElementById('sa-broadcast-body');
        var priorityEl = document.getElementById('sa-broadcast-priority');
        var title = titleEl ? titleEl.value.trim() : '';
        var body = bodyEl ? bodyEl.value.trim() : '';
        var priority = priorityEl ? priorityEl.value : 'normal';
        if (!title || !body) { toast('عنوان اور متن درج کریں', 'error'); return; }

        global.saShowReasonModal('تمام مدارس کو اعلان — وجہ', function (reason) {
            var firestore = db();
            var user = core().currentUser();
            var payload = {
                title: title,
                body: body,
                priority: priority,
                audience: 'all_tenants',
                type: 'broadcast',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: user ? user.email : '',
                readBy: {}
            };

            var notifPromise = firestore.collection('Platform_Notifications').add(payload);
            var systemPromise = firestore.collection('System_Settings').doc('System').set({
                globalAnnouncement: { title: title, body: body },
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            Promise.all([notifPromise, systemPromise]).then(function () {
                return global.logSaAudit('broadcast_notification', '', 'all_tenants', reason, { title: title, priority: priority });
            }).then(function () {
                toast('اعلان تمام مدارس کو بھیج دیا گیا!', 'success');
                if (titleEl) titleEl.value = '';
                if (bodyEl) bodyEl.value = '';
                global.loadSaNotifications();
            }).catch(function (err) {
                toast('اعلان ناکام: ' + err.message, 'error');
            });
        });
    };

})(window);
