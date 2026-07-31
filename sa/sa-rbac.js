/**
 * sa-rbac.js — RBAC catalogue, permission matrix, role assignment UI
 */
(function (global) {
    'use strict';

    var _catalogue = null;
    var _targetUid = null;

    function ui() { return global.SaUi; }
    function esc(str) { return ui() ? ui().esc(str) : String(str || ''); }
    function escAttr(str) { return ui() ? ui().escAttr(str) : esc(str); }

    function db() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function toast(msg, type) {
        if (typeof global.showToast === 'function') global.showToast(msg, type);
        else if (typeof global.showTopAlert === 'function') global.showTopAlert(msg, type === 'error');
    }

    function getCatalogue() {
        if (_catalogue) return Promise.resolve(_catalogue);
        if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
            return global.saApi.callOrFallback('getRbacCatalogue', {}, function () {
                return Promise.resolve({
                    roles: global.RBAC ? global.RBAC.ROLES : {},
                    permissions: global.RBAC ? global.RBAC.PERMISSIONS : {}
                });
            }).then(function (data) {
                _catalogue = data;
                return data;
            });
        }
        _catalogue = {
            roles: global.RBAC ? global.RBAC.ROLES : {},
            permissions: global.RBAC ? global.RBAC.PERMISSIONS : {}
        };
        return Promise.resolve(_catalogue);
    }

    function roleHasPerm(role, permId) {
        if (!role) return false;
        var perms = role.permissions || [];
        if (perms.indexOf('*') >= 0) return true;
        return perms.indexOf(permId) >= 0;
    }

    function renderPermissionMatrix(cat) {
        var box = document.getElementById('sa-rbac-permissions-matrix');
        if (!box) return;

        var roles = cat.roles || {};
        var permissions = cat.permissions || {};
        var roleIds = Object.keys(roles).filter(function (id) {
            return id !== 'student' && id !== 'teacher';
        });
        var permIds = Object.keys(permissions);

        if (!roleIds.length || !permIds.length) {
            box.innerHTML = '<p class="sa-table-empty">RBAC catalogue دستیاب نہیں</p>';
            return;
        }

        var html = '<div class="sa-perm-matrix-wrap"><table class="data-table sa-perm-matrix"><thead><tr><th>اجازت</th>';
        roleIds.forEach(function (rid) {
            var r = roles[rid];
            html += '<th title="' + escAttr(rid) + '">' + esc(r.nameUr || r.name || rid) + '</th>';
        });
        html += '</tr></thead><tbody>';

        permIds.forEach(function (pid) {
            html += '<tr><td><code style="font-size:11px;">' + esc(pid) + '</code><br><small>' + esc(permissions[pid] || '') + '</small></td>';
            roleIds.forEach(function (rid) {
                var ok = roleHasPerm(roles[rid], pid);
                html += '<td class="sa-perm-cell' + (ok ? ' sa-perm-yes' : '') + '">' + (ok ? '<i class="fas fa-check"></i>' : '') + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        box.innerHTML = html;
    }

    global.loadSaRbacPanel = function () {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        var box = document.getElementById('sa-rbac-roles-list');
        if (!box) return;

        box.innerHTML = ui() ? ui().tableLoading(1, 'کردار لوڈ...') : 'لوڈ...';

        getCatalogue().then(function (cat) {
            var roles = cat.roles || {};
            box.innerHTML = Object.keys(roles).map(function (roleId) {
                var r = roles[roleId];
                var perms = r.permissions || [];
                var permText = perms.indexOf('*') >= 0 ? 'تمام اجازتیں (*)' : (perms.length + ' اجازتیں');
                return '<div class="sa-role-card">' +
                    '<strong>' + esc(r.nameUr || r.name || roleId) + '</strong> ' +
                    '<code>(' + esc(roleId) + ')</code><br>' +
                    '<small>' + esc(permText) + ' | level ' + (r.level != null ? r.level : '-') + '</small></div>';
            }).join('');
            renderPermissionMatrix(cat);
        });
    };

    global.saOpenUserRolesModal = function (uid) {
        _targetUid = uid;
        var firestore = db();
        if (!firestore || !uid) return;

        Promise.all([
            getCatalogue(),
            firestore.collection('Platform_Users').doc(uid).get()
        ]).then(function (results) {
            var cat = results[0];
            var userDoc = results[1];
            var user = userDoc.exists ? userDoc.data() : {};
            var currentRoles = user.globalRoles || [];

            var body = document.getElementById('sa-rbac-modal-body');
            if (!body) return;

            var roles = cat.roles || {};
            body.innerHTML = '<p style="margin-top:0;"><strong>' + esc(user.fullName || user.email || uid) + '</strong></p>' +
                Object.keys(roles).map(function (roleId) {
                    var r = roles[roleId];
                    var checked = currentRoles.indexOf(roleId) >= 0 ? ' checked' : '';
                    return '<label class="sa-rbac-role-label">' +
                        '<input type="checkbox" class="sa-rbac-role-cb" value="' + escAttr(roleId) + '"' + checked + ' />' +
                        '<span><strong>' + esc(r.nameUr || r.name) + '</strong> <code>' + esc(roleId) + '</code></span></label>';
                }).join('');

            if (typeof global.openModal === 'function') global.openModal('sa-rbac-modal');
            else document.getElementById('sa-rbac-modal').style.display = 'flex';
        });
    };

    function fallbackAssignRoles(uid, roles, reason) {
        var firestore = db();
        if (!firestore) return Promise.reject(new Error('Firestore unavailable'));
        return firestore.collection('Platform_Users').doc(uid).set({
            globalRoles: roles,
            rolesUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rolesUpdateReason: reason || ''
        }, { merge: true }).then(function () {
            toast('Client-only: Custom claims sync کے لیے Cloud Functions deploy کریں', 'warning');
        });
    }

    global.saSaveUserRoles = function () {
        if (!_targetUid) return;
        var boxes = document.querySelectorAll('.sa-rbac-role-cb:checked');
        var roles = [];
        boxes.forEach(function (cb) { roles.push(cb.value); });

        global.saShowReasonModal('کردار تفویض — وجہ', function (reason) {
            var payload = { targetUid: _targetUid, roles: roles, reason: reason };
            var run = global.saApi && global.saApi.callOrFallback
                ? global.saApi.callOrFallback('assignRoles', payload, function () {
                    return fallbackAssignRoles(_targetUid, roles, reason);
                })
                : fallbackAssignRoles(_targetUid, roles, reason);

            run.then(function () {
                toast('کردار محفوظ ہو گئے', 'success');
                if (typeof global.logSaAudit === 'function') {
                    global.logSaAudit('rbac_assign', _targetUid, _targetUid, reason, { roles: roles });
                }
                if (typeof global.closeModal === 'function') global.closeModal('sa-rbac-modal');
                if (typeof global.loadSaPlatformUsers === 'function') global.loadSaPlatformUsers();
            }).catch(function (err) {
                toast('ناکام: ' + err.message, 'error');
            });
        });
    };

})(window);
