/**
 * sa-users.js — Super Admin: Platform_Users management UI
 */
(function (global) {
    'use strict';

    var PAGE_SIZE = 15;
    var _cache = [];
    var _page = 1;

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

    function formatDate(val) {
        if (!val) return '-';
        if (val.toDate) return val.toDate().toLocaleString('ur-PK');
        return String(val);
    }

    function statusBadge(st) {
        var map = {
            active: '<span class="sa-badge sa-badge-success">فعال</span>',
            suspended: '<span class="sa-badge sa-badge-danger">معطل</span>',
            banned: '<span class="sa-badge sa-badge-danger">بین</span>',
            inactive: '<span class="sa-badge sa-badge-default">غیر فعال</span>'
        };
        return map[st] || '<span class="sa-badge sa-badge-default">' + esc(st || '-') + '</span>';
    }

    function getFiltered() {
        var search = ((document.getElementById('sa-user-search') || {}).value || '').trim().toLowerCase();
        var filter = (document.getElementById('sa-user-filter') || {}).value || 'all';

        return _cache.filter(function (u) {
            if (search) {
                var hay = ((u.email || '') + ' ' + (u.fullName || '') + ' ' + (u.uid || '')).toLowerCase();
                if (hay.indexOf(search) === -1) return false;
            }
            if (filter === 'all') return true;
            return (u.accountStatus || 'active') === filter;
        });
    }

    function bindUserActions() {
        var tbody = document.getElementById('sa-users-tbody');
        if (!tbody || !ui()) return;
        ui().bindActions(tbody, {
            roles: function (el) { global.saOpenUserRolesModal(el.getAttribute('data-uid')); },
            suspend: function (el) { global.saSetPlatformUserStatus(el.getAttribute('data-uid'), 'suspended'); },
            activate: function (el) { global.saSetPlatformUserStatus(el.getAttribute('data-uid'), 'active'); }
        });
    }

    function renderTable() {
        var tbody = document.getElementById('sa-users-tbody');
        if (!tbody) return;

        var list = getFiltered();
        var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        if (_page > totalPages) _page = totalPages;
        var start = (_page - 1) * PAGE_SIZE;
        var pageItems = list.slice(start, start + PAGE_SIZE);

        if (!pageItems.length) {
            tbody.innerHTML = ui() ? ui().tableEmpty(6, 'کوئی صارف نہیں ملا') : '<tr><td colspan="6">—</td></tr>';
            return;
        }

        tbody.innerHTML = pageItems.map(function (u) {
            var roles = (u.globalRoles || []).join(', ') || '-';
            var tenantCount = u.tenants ? Object.keys(u.tenants).length : 0;
            var uid = escAttr(u.uid);
            return '<tr data-uid="' + uid + '">' +
                '<td><strong>' + esc(u.fullName || '—') + '</strong><br><small>' + esc(u.email || '-') + '</small></td>' +
                '<td style="font-size:11px;direction:ltr;text-align:right;">' + esc(u.uid) + '</td>' +
                '<td>' + statusBadge(u.accountStatus) + '</td>' +
                '<td style="font-size:12px;">' + esc(roles) + '</td>' +
                '<td>' + tenantCount + '</td>' +
                '<td class="sa-row-actions">' +
                '<button type="button" class="btn btn-outline btn-sm" data-action="roles" data-uid="' + uid + '" title="کردار"><i class="fas fa-user-tag"></i></button> ' +
                '<button type="button" class="btn btn-warning btn-sm" data-action="suspend" data-uid="' + uid + '" title="معطل"><i class="fas fa-ban"></i></button> ' +
                '<button type="button" class="btn btn-success btn-sm" data-action="activate" data-uid="' + uid + '" title="فعال"><i class="fas fa-check"></i></button>' +
                '</td></tr>';
        }).join('');

        bindUserActions();

        var pag = document.getElementById('sa-users-pagination');
        if (pag) {
            var html = '<span class="sa-page-info">' + list.length + ' صارف — صفحہ ' + _page + ' / ' + totalPages + '</span>';
            html += '<div class="sa-page-btns">';
            if (_page > 1) html += '<button type="button" class="btn btn-outline btn-sm" data-user-page="' + (_page - 1) + '"><i class="fas fa-chevron-right"></i></button>';
            if (_page < totalPages) html += '<button type="button" class="btn btn-outline btn-sm" data-user-page="' + (_page + 1) + '"><i class="fas fa-chevron-left"></i></button>';
            html += '</div>';
            pag.innerHTML = html;
            pag.querySelectorAll('[data-user-page]').forEach(function (btn) {
                btn.onclick = function () {
                    _page = parseInt(btn.getAttribute('data-user-page'), 10) || 1;
                    renderTable();
                };
            });
        }
    }

    global.loadSaPlatformUsers = function () {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        var firestore = db();
        var tbody = document.getElementById('sa-users-tbody');
        if (!firestore || !tbody) return;

        tbody.innerHTML = ui() ? ui().tableLoading(6) : '<tr><td colspan="6">لوڈ...</td></tr>';

        firestore.collection('Platform_Users').limit(300).get()
            .then(function (snap) {
                _cache = [];
                snap.forEach(function (doc) {
                    var d = doc.data() || {};
                    d.uid = doc.id;
                    _cache.push(d);
                });
                _cache.sort(function (a, b) {
                    return (a.email || '').localeCompare(b.email || '', 'ur');
                });
                _page = 1;
                renderTable();
            })
            .catch(function (err) {
                tbody.innerHTML = ui() ? ui().tableError(6, err.message) : '<tr><td colspan="6">' + esc(err.message) + '</td></tr>';
            });
    };

    function fallbackSetStatus(uid, status, reason) {
        var firestore = db();
        if (!firestore) return Promise.reject(new Error('Firestore unavailable'));
        return firestore.collection('Platform_Users').doc(uid).set({
            accountStatus: status,
            statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            statusReason: reason || ''
        }, { merge: true }).then(function () {
            toast('Client-only: Auth disable کے لیے Cloud Functions استعمال کریں', 'warning');
        });
    }

    global.saSetPlatformUserStatus = function (uid, status) {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        if (uid === (firebase.auth().currentUser && firebase.auth().currentUser.uid)) {
            toast('اپنا خود اکاؤنٹ یہاں نہیں بدلیں', 'error');
            return;
        }

        global.saShowReasonModal('صارف اسٹیٹس: ' + status, function (reason) {
            var payload = { targetUid: uid, status: status, reason: reason };
            var run = global.saApi && global.saApi.callOrFallback
                ? global.saApi.callOrFallback('setUserStatus', payload, function () {
                    return fallbackSetStatus(uid, status === 'restore' ? 'active' : status, reason);
                })
                : fallbackSetStatus(uid, status, reason);

            run.then(function () {
                toast('صارف اسٹیٹس اپڈیٹ: ' + status, 'success');
                if (typeof global.logSaAudit === 'function') {
                    global.logSaAudit('platform_user_status', uid, uid, reason, { status: status });
                }
                global.loadSaPlatformUsers();
            }).catch(function (err) {
                toast('ناکام: ' + err.message, 'error');
            });
        });
    };

    document.addEventListener('DOMContentLoaded', function () {
        ['sa-user-search', 'sa-user-filter'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function () { _page = 1; renderTable(); });
            if (el.tagName === 'SELECT') el.addEventListener('change', function () { _page = 1; renderTable(); });
        });
    });

})(window);
