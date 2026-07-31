// ============================================================================
// EMS Parent Shared — views, permissions, messaging (P0 bundle for parent portal)
// Loaded at boot (cloud + post-auth) and before parent-portal.js / admin-panel.js
// ============================================================================
(function (global) {
    'use strict';

    var DB_PARENT_PERM = 'ems_parent_permissions';
    var DB_PARENT_MSG = 'ems_parent_messages';

    if (!global.PARENT_VIEWS) {
        global.PARENT_VIEWS = [
            { id: 'attendance', name: 'حاضری', icon: 'fa-calendar-check' },
            { id: 'results', name: 'امتحانی نتائج', icon: 'fa-poll' },
            { id: 'progress', name: 'تعلیمی پیشرفت', icon: 'fa-chart-line' },
            { id: 'fee', name: 'فیس و وصولی', icon: 'fa-money-bill-wave' },
            { id: 'complaints', name: 'شکایات', icon: 'fa-exclamation-triangle' },
            { id: 'training', name: 'تربیت و نظم', icon: 'fa-user-shield' },
            { id: 'leave', name: 'رخصت / پیغامات', icon: 'fa-plane-departure' },
            { id: 'announcements', name: 'اعلانات', icon: 'fa-bullhorn' },
            { id: 'teacher_notes', name: 'اساتذہ کے نوٹس', icon: 'fa-sticky-note' }
        ];
    }

    if (!global.PARENT_MSG_CATEGORIES) {
        global.PARENT_MSG_CATEGORIES = [
            { id: 'leave', name: 'رخصت کی درخواست' },
            { id: 'absence', name: 'غیر حاضری کی وضاحت' },
            { id: 'complaint', name: 'شکایت' },
            { id: 'suggestion', name: 'تجویز' },
            { id: 'inquiry', name: 'استفسار' }
        ];
    }

    function parentNow() {
        return new Date().toISOString();
    }

    function parentAuditActor() {
        if (typeof global.emsParentAuditActor === 'function') return global.emsParentAuditActor();
        try {
            var u = typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser;
            return u ? (u.email || u.uid) : 'parent';
        } catch (e) {
            return 'parent';
        }
    }

    function parentGetTenantId() {
        if (typeof global.emsGetTenantId === 'function') return global.emsGetTenantId();
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        return null;
    }

    function parentGetUsers() {
        if (typeof global.emsGetUsersMerged === 'function') return global.emsGetUsersMerged();
        if (typeof global.emsGetUsersSync === 'function') return global.emsGetUsersSync();
        try {
            var key = (global.DB && global.DB.users) ? global.DB.users : 'ems_full_users';
            return JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            return [];
        }
    }

    function parentGetStudentById(studentId) {
        var users = parentGetUsers();
        return users.find(function (u) { return u && u.id === studentId; }) || null;
    }

    function getAllParentPerms() {
        try { return JSON.parse(localStorage.getItem(DB_PARENT_PERM)) || {}; }
        catch (e) { return {}; }
    }

    function saveAllParentPerms(perms) {
        if (typeof global.emsSaveModuleData === 'function') {
            return global.emsSaveModuleData(DB_PARENT_PERM, perms, { mutation: true, autoDelta: true });
        }
        localStorage.setItem(DB_PARENT_PERM, JSON.stringify(perms));
        return Promise.resolve();
    }

    function emptyParentViews() {
        var v = {};
        global.PARENT_VIEWS.forEach(function (pv) { v[pv.id] = false; });
        return v;
    }

    function defaultParentPerm(studentId) {
        return {
            studentId: studentId,
            status: 'active',
            views: emptyParentViews(),
            temporary: {},
            history: [],
            updatedAt: parentNow(),
            updatedBy: parentAuditActor()
        };
    }

    function migrateParentPerm(existing, studentId) {
        var base = defaultParentPerm(studentId);
        var p = Object.assign(base, existing || {});
        p.views = p.views || emptyParentViews();
        global.PARENT_VIEWS.forEach(function (pv) {
            if (typeof p.views[pv.id] === 'undefined') p.views[pv.id] = false;
        });
        p.temporary = p.temporary || {};
        p.history = Array.isArray(p.history) ? p.history : [];
        p.status = p.status || 'active';
        return p;
    }

    function parentTempActive(p, viewId) {
        var t = p.temporary && p.temporary[viewId];
        if (!t) return false;
        if (t.expiryAt && typeof t.expiryAt === 'number') return t.expiryAt > Date.now();
        if (t.expiry) return new Date(t.expiry).getTime() > Date.now();
        return false;
    }

    global.emsParentGetAllPerms = getAllParentPerms;
    global.emsParentSaveAllPerms = saveAllParentPerms;
    global.emsParentMigratePerm = migrateParentPerm;
    global.emsParentEmptyViews = emptyParentViews;
    global.emsParentDefaultPerm = defaultParentPerm;
    global.emsParentTempActive = parentTempActive;

    global.apGetParentPerm = function (studentId) {
        var perms = getAllParentPerms();
        return migrateParentPerm(perms[studentId], studentId);
    };

    global.parentCanView = function (studentId, viewId) {
        var p = global.apGetParentPerm(studentId);
        if (p.status !== 'active') return false;
        if (parentTempActive(p, viewId)) return true;
        return !!p.views[viewId];
    };

    global.parentGetChild = function (studentId) {
        return parentGetStudentById(studentId);
    };

    function getAllMessages() {
        try { return JSON.parse(localStorage.getItem(DB_PARENT_MSG)) || []; }
        catch (e) { return []; }
    }

    function saveAllMessages(msgs) {
        if (typeof global.emsSaveModuleData === 'function') {
            return global.emsSaveModuleData(DB_PARENT_MSG, msgs, { mutation: true, autoDelta: true });
        }
        localStorage.setItem(DB_PARENT_MSG, JSON.stringify(msgs));
        return Promise.resolve();
    }

    global.parentSubmitMessage = function (studentId, payload) {
        var student = parentGetStudentById(studentId);
        if (!student) return Promise.resolve(false);

        var tenantId = parentGetTenantId();
        var isParentUser = global.CURRENT_USER_TENANT_ROLE === 'parent'
            || (typeof global.emsGetIntendedPortal === 'function' && global.emsGetIntendedPortal() === 'parent');

        if (isParentUser && tenantId && typeof global.emsCallFunction === 'function') {
            return global.emsCallFunction('submitParentMessage', {
                tenantId: tenantId,
                studentId: studentId,
                category: (payload && payload.category) || 'inquiry',
                format: (payload && payload.format) || 'text',
                text: (payload && payload.text) || '',
                voice: (payload && payload.voice) || ''
            }).then(function (res) {
                if (res && res.message) {
                    var msgs = getAllMessages();
                    msgs.push(res.message);
                    saveAllMessages(msgs);
                }
                return !!(res && res.ok);
            }).catch(function (err) {
                console.warn('submitParentMessage CF:', err);
                return false;
            });
        }

        var msg = {
            id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            studentId: studentId,
            studentName: student.name || studentId,
            direction: 'in',
            category: (payload && payload.category) || 'inquiry',
            format: (payload && payload.format) || 'text',
            text: (payload && payload.text) || '',
            voice: (payload && payload.voice) || '',
            by: 'والد (' + (student.fname || '-') + ')',
            at: parentNow(),
            read: false
        };
        var msgs = getAllMessages();
        msgs.push(msg);
        saveAllMessages(msgs);

        var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
        if (db && tenantId && typeof firebase !== 'undefined') {
            db.collection('All_Madrasas').doc(tenantId).collection('ParentMessages').doc(msg.id)
                .set(Object.assign({}, msg, {
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }), { merge: true })
                .catch(function (err) {
                    console.warn('ParentMessages Firestore write:', err);
                });
        }
        return Promise.resolve(true);
    };

    global.parentGetMessages = function (studentId) {
        return getAllMessages().filter(function (m) { return m.studentId === studentId; });
    };

})(typeof window !== 'undefined' ? window : globalThis);
