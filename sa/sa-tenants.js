/**
 * sa-tenants.js — Real-time tenant management (Enterprise)
 */
(function (global) {
    'use strict';

    var _tenantsUnsub = null;
    var _renderTimer = null;
    var _pageCursors = {};
    var _fsPageSize = 50;
    var _fullCacheMode = false;
    var _totalEstimate = 0;

    function core() { return global.SaCore; }
    function esc(v) { return core() ? core().esc(v) : String(v || ''); }
    function toast(msg, type) { if (core()) core().toast(msg, type); }

    function defaultModules() {
        if (typeof global.saDefaultModules === 'function') return global.saDefaultModules();
        var mods = {};
        (global.SYSTEM_MODULES || []).forEach(function (mod) {
            mods[mod.id] = { status: 'free', expiry: '' };
        });
        return mods;
    }

    function resolveAllowedModulesFromFirestore(base) {
        if (base.subStatus === 'free') return defaultModules();
        if (base.allowedModules && Object.keys(base.allowedModules).length > 0) {
            return JSON.parse(JSON.stringify(base.allowedModules));
        }
        if (global.SYSTEM_GLOBAL_STATUS === 'free') return defaultModules();
        /* Firestore میں configure نہیں — SA UI سچ دکھائے (لاک) */
        var mods = {};
        (global.SYSTEM_MODULES || []).forEach(function (mod) {
            mods[mod.id] = { status: 'locked', expiry: '' };
        });
        return mods;
    }

    function mergeTenant(uid, data) {
        var base = data || {};
        if (!global.SA_PENDING_EDITS[uid]) {
            global.SA_PENDING_EDITS[uid] = {
                subStatus: base.subStatus || 'default',
                allowedModules: resolveAllowedModulesFromFirestore(base),
                billingPlan: base.billingPlan || 'basic',
                billingStatus: base.billingStatus || 'pending',
                nextDueDate: base.nextDueDate || '',
                billingNote: base.billingNote || ''
            };
        }
        return global.SA_PENDING_EDITS[uid];
    }

    function ingestDocs(docs, opts) {
        opts = opts || {};
        var list = [];
        docs.forEach(function (docSnap) {
            var m = docSnap.data();
            if (core() && core().shouldSkipTenantInSaList && core().shouldSkipTenantInSaList(docSnap)) return;
            list.push({ uid: docSnap.id, data: m });
            mergeTenant(docSnap.id, m);
        });
        if (opts.append) {
            global.SA_TENANTS_CACHE = (global.SA_TENANTS_CACHE || []).concat(list);
        } else {
            global.SA_TENANTS_CACHE = list;
        }
        global.SA_TENANTS_LIVE = !opts.manual;
        if (core()) {
            core().markSyncTime();
            if (_fullCacheMode || opts.refreshMetrics) {
                core().refreshDashboardFromCache();
                core().persistMetricsCache(core().computeTenantMetrics(global.SA_TENANTS_CACHE));
            }
        }
        if (global.SaCharts && typeof global.SaCharts.render === 'function') {
            global.SaCharts.render(global.SA_TENANTS_CACHE);
        }
        scheduleRender();
        return list;
    }

    function ingestSnapshot(snapshot) {
        ingestDocs(snapshot.docs, { refreshMetrics: _fullCacheMode });
    }

    global.saRefreshTenantMetrics = function () {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return Promise.resolve();
        var firestore = core() ? core().db() : null;
        if (!firestore) return Promise.resolve();
        toast('شماریات تازہ ہو رہی ہیں...', 'warning');
        return firestore.collection('All_Madrasas').get().then(function (snap) {
            var all = [];
            snap.forEach(function (docSnap) {
                var m = docSnap.data();
                if (core() && core().shouldSkipTenantInSaList && core().shouldSkipTenantInSaList(docSnap)) return;
                all.push({ uid: docSnap.id, data: m });
            });
            _totalEstimate = all.length;
            var metrics = core().computeTenantMetrics(all);
            return core().persistMetricsCache(metrics).then(function () {
                core().renderTenantMetrics(metrics);
                toast('مدرسوں کی شماریات تازہ ہو گئیں (' + all.length + ')', 'success');
            });
        }).catch(function (err) {
            toast('شماریات ناکام: ' + err.message, 'error');
        });
    };

    function isAdvancedFilterActive() {
        var search = ((document.getElementById('sa-tenant-search') || {}).value || '').trim();
        var filter = (document.getElementById('sa-tenant-filter') || {}).value || 'all';
        return search.length > 0 || filter !== 'all';
    }

    function loadFullCacheForFilter() {
        var firestore = core() ? core().db() : null;
        if (!firestore) return;
        _fullCacheMode = true;
        global.SA_TENANTS_LIVE = false;
        firestore.collection('All_Madrasas').limit(500).get().then(function (snap) {
            ingestDocs(snap.docs, { refreshMetrics: true, manual: true });
            _totalEstimate = snap.size;
            toast('فلٹر/تلاش: ' + snap.size + ' مدرسے لوڈ', 'success');
        }).catch(function (err) {
            toast('لوڈ ناکام: ' + err.message, 'error');
        });
    }

    function fetchTenantPage(pageNum) {
        var firestore = core() ? core().db() : null;
        if (!firestore) return;
        _fullCacheMode = false;
        pageNum = Math.max(1, pageNum || 1);
        global.SA_CURRENT_PAGE = pageNum;

        var query = firestore.collection('All_Madrasas').orderBy('setupDate', 'desc').limit(_fsPageSize);
        if (pageNum > 1 && _pageCursors[pageNum]) {
            query = query.startAfter(_pageCursors[pageNum]);
        }

        var tbody = document.getElementById('sa-madrasas-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> لوڈ...</td></tr>';

        query.get().then(function (snap) {
            if (snap.empty && pageNum > 1) {
                global.SA_CURRENT_PAGE = pageNum - 1;
                return fetchTenantPage(pageNum - 1);
            }
            if (snap.docs.length > 0) {
                _pageCursors[pageNum + 1] = snap.docs[snap.docs.length - 1];
            }
            ingestDocs(snap.docs, { manual: true });
            if (!_totalEstimate && snap.docs.length === _fsPageSize) {
                _totalEstimate = pageNum * _fsPageSize + 1;
            } else if (snap.docs.length < _fsPageSize) {
                _totalEstimate = ((pageNum - 1) * _fsPageSize) + snap.docs.length;
            }
            var info = document.getElementById('sa-tenant-page-info');
            if (info) info.textContent = 'صفحہ ' + pageNum + ' — ' + snap.docs.length + ' مدرسے (Firestore pagination)';
        }).catch(function (err) {
            toast('صفحہ لوڈ ناکام: ' + err.message, 'error');
            firestore.collection('All_Madrasas').limit(_fsPageSize).get().then(function (snap) {
                ingestDocs(snap.docs, { manual: true });
            });
        });
    }

    function scheduleRender() {
        if (_renderTimer) clearTimeout(_renderTimer);
        _renderTimer = setTimeout(function () {
            if (typeof global.saRenderTenantTable === 'function') global.saRenderTenantTable();
        }, 80);
    }

    function stopListener() {
        if (_tenantsUnsub) {
            _tenantsUnsub();
            _tenantsUnsub = null;
        }
        global.SA_TENANTS_LIVE = false;
        if (core()) core().updateStatusBar();
    }

    function startListener(forceRefresh) {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        var firestore = core() ? core().db() : null;
        if (!firestore) {
            toast('ڈیٹا بیس کنیکٹ نہیں — تھوڑی دیر بعد دوبارہ کوشش کریں۔', 'error');
            return;
        }

        if (forceRefresh) {
            global.SA_PENDING_EDITS = {};
        }

        firestore.collection('System_Settings').doc('Subscription').get().then(function (doc) {
            var st = document.getElementById('sa-global-status');
            if (st) st.value = doc.exists && doc.data().globalStatus ? doc.data().globalStatus : 'free';
        });

        if (_tenantsUnsub) {
            _tenantsUnsub();
            _tenantsUnsub = null;
        }

        if (isAdvancedFilterActive()) {
            loadFullCacheForFilter();
            return;
        }
        _pageCursors = {};
        fetchTenantPage(global.SA_CURRENT_PAGE || 1);

        if (_tenantsUnsub) return;
        _tenantsUnsub = firestore.collection('Platform_Config').doc('sa_tenant_metrics')
            .onSnapshot(function (doc) {
                if (doc.exists && doc.data().metrics && core()) {
                    core().renderTenantMetrics(doc.data().metrics);
                    _totalEstimate = doc.data().metrics.total || _totalEstimate;
                }
            }, function () { });
    }

    function getFilteredTenants() {
        var search = (document.getElementById('sa-tenant-search') || {}).value || '';
        search = search.trim().toLowerCase();
        var filter = (document.getElementById('sa-tenant-filter') || {}).value || 'all';
        var sort = (document.getElementById('sa-tenant-sort') || {}).value || 'name';

        var list = (global.SA_TENANTS_CACHE || []).filter(function (t) {
            var m = t.data;
            var edit = global.SA_PENDING_EDITS[t.uid] || {};
            var st = edit.subStatus || m.subStatus || 'default';
            if (search) {
                var hay = ((m.madrasaName || '') + ' ' + (m.email || '') + ' ' + (m.contactPhone || '') + ' ' + (m.principalName || '')).toLowerCase();
                if (hay.indexOf(search) === -1) return false;
            }
            if (filter === 'suspended') return st === 'suspended';
            if (filter === 'active') return st !== 'suspended';
            if (filter === 'trial') {
                var allowed = edit.allowedModules || m.allowedModules || {};
                return Object.keys(allowed).some(function (k) { return allowed[k] && allowed[k].status === 'trial'; });
            }
            if (filter === 'overdue') return (edit.billingStatus || m.billingStatus) === 'overdue';
            return true;
        });

        list.sort(function (a, b) {
            if (sort === 'date') return (b.data.setupDate || '').localeCompare(a.data.setupDate || '');
            if (sort === 'status') {
                var sa = (global.SA_PENDING_EDITS[a.uid] || {}).subStatus || a.data.subStatus || '';
                var sb = (global.SA_PENDING_EDITS[b.uid] || {}).subStatus || b.data.subStatus || '';
                return sa.localeCompare(sb);
            }
            return (a.data.madrasaName || '').localeCompare(b.data.madrasaName || '', 'ur');
        });
        return list;
    }

    function moduleSummary(uid, data) {
        var edit = global.SA_PENDING_EDITS[uid];
        var allowed = edit ? edit.allowedModules : (data.allowedModules || {});
        var free = 0, trial = 0, locked = 0;
        (global.SYSTEM_MODULES || []).forEach(function (mod) {
            var s = (allowed[mod.id] || {}).status || 'locked';
            if (s === 'free') free++;
            else if (s === 'trial') trial++;
            else locked++;
        });
        return '<span class="sa-mod-pill sa-mod-free">' + free + ' فری</span> ' +
            '<span class="sa-mod-pill sa-mod-trial">' + trial + ' ٹرائل</span> ' +
            '<span class="sa-mod-pill sa-mod-locked">' + locked + ' لاک</span>';
    }

    function statusBadge(st) {
        if (st === 'free') return '<span class="sa-badge sa-badge-success">مکمل فری</span>';
        if (st === 'suspended') return '<span class="sa-badge sa-badge-danger">معطل</span>';
        return '<span class="sa-badge sa-badge-default">ڈیفالٹ</span>';
    }

    global.saRenderTenantTable = function () {
        var tbody = document.getElementById('sa-madrasas-tbody');
        if (!tbody) return;

        var list = getFilteredTenants();
        var pageSize = _fullCacheMode ? (global.SA_PAGE_SIZE || 10) : list.length;
        var totalPages = _fullCacheMode
            ? Math.max(1, Math.ceil(list.length / (global.SA_PAGE_SIZE || 10)))
            : Math.max(global.SA_CURRENT_PAGE, list.length < _fsPageSize ? global.SA_CURRENT_PAGE : global.SA_CURRENT_PAGE + 1);
        if (_fullCacheMode && global.SA_CURRENT_PAGE > totalPages) global.SA_CURRENT_PAGE = totalPages;

        var start = _fullCacheMode ? (global.SA_CURRENT_PAGE - 1) * (global.SA_PAGE_SIZE || 10) : 0;
        var pageItems = _fullCacheMode ? list.slice(start, start + (global.SA_PAGE_SIZE || 10)) : list;

        if (pageItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">کوئی مدرسہ نہیں ملا۔</td></tr>';
        } else {
            tbody.innerHTML = pageItems.map(function (t) {
                var m = t.data;
                var edit = global.SA_PENDING_EDITS[t.uid] || {};
                var st = edit.subStatus || m.subStatus || 'default';
                var plan = edit.billingPlan || m.billingPlan || 'basic';
                var checked = global.SA_SELECTED_UIDS.has(t.uid) ? ' checked' : '';
                var uidAttr = esc(t.uid);
                return '<tr data-uid="' + uidAttr + '">' +
                    '<td><input type="checkbox" class="sa-row-check" data-uid="' + uidAttr + '"' + checked + '></td>' +
                    '<td><strong style="color:var(--primary);">' + esc(m.madrasaName || 'نامعلوم') + '</strong><br>' +
                    '<small>' + esc(m.email || '-') + '</small></td>' +
                    '<td>' + statusBadge(st) + '</td>' +
                    '<td>' + esc(plan) + '</td>' +
                    '<td>' + moduleSummary(t.uid, m) + '</td>' +
                    '<td class="sa-row-actions">' +
                    '<button type="button" class="btn btn-outline btn-sm" data-action="view" data-uid="' + uidAttr + '" title="تفصیل"><i class="fas fa-eye"></i></button> ' +
                    '<button type="button" class="btn btn-outline btn-sm" data-action="backup" data-uid="' + uidAttr + '" title="پلیٹ فارم بیک اپ"><i class="fas fa-database"></i></button> ' +
                    '<button type="button" class="btn btn-warning btn-sm" data-action="restore" data-uid="' + uidAttr + '" title="بحالی"><i class="fas fa-unlock"></i></button>' +
                    '</td></tr>';
            }).join('');
        }

        if (typeof global.saRenderPagination === 'function') {
            var totalItems = _fullCacheMode ? list.length : (_totalEstimate || list.length);
            global.saRenderPagination(totalItems, totalPages);
        }
        if (typeof global.saUpdateBulkBar === 'function') global.saUpdateBulkBar();
        bindTenantTableEvents();
        if (core()) core().updateStatusBar();
    };

    function bindTenantTableEvents() {
        document.querySelectorAll('.sa-row-check').forEach(function (cb) {
            cb.onchange = function () {
                var uid = cb.getAttribute('data-uid');
                if (cb.checked) global.SA_SELECTED_UIDS.add(uid);
                else global.SA_SELECTED_UIDS.delete(uid);
                global.saUpdateBulkBar();
            };
        });
        document.querySelectorAll('#sa-madrasas-tbody [data-action]').forEach(function (btn) {
            btn.onclick = function () {
                var uid = btn.getAttribute('data-uid');
                var action = btn.getAttribute('data-action');
                if (action === 'view') global.saOpenTenantModal(uid);
                else if (action === 'backup') global.saPlatformBackup(uid);
                else if (action === 'restore') global.restoreMadrasaAccess(uid, btn);
            };
        });
        var selectAll = document.getElementById('sa-select-all');
        if (selectAll) {
            selectAll.onchange = function () {
                var list = getFilteredTenants();
                var pageSize = global.SA_PAGE_SIZE || 10;
                var start = (global.SA_CURRENT_PAGE - 1) * pageSize;
                list.slice(start, start + pageSize).forEach(function (t) {
                    if (selectAll.checked) global.SA_SELECTED_UIDS.add(t.uid);
                    else global.SA_SELECTED_UIDS.delete(t.uid);
                });
                global.saRenderTenantTable();
            };
        }
    }

    global.loadSuperAdminData = function (forceRefresh) {
        if (forceRefresh) {
            global.SA_TENANTS_CACHE = [];
            _pageCursors = {};
            global.SA_CURRENT_PAGE = 1;
            global.SA_SELECTED_UIDS.clear();
        }
        global.SA_CURRENT_PAGE = global.SA_CURRENT_PAGE || 1;
        startListener(forceRefresh);
    };

    global.saFetchTenantPage = function (pageNum) {
        if (isAdvancedFilterActive()) {
            global.SA_CURRENT_PAGE = pageNum;
            global.saRenderTenantTable();
            return;
        }
        fetchTenantPage(pageNum);
    };

    global.saOpenTenantModal = function (uid) {
        if (core() && !core().can('modules.manage')) {
            toast('ماڈیول کنٹرول کی اجازت نہیں۔', 'error');
            return;
        }
        var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === uid; });
        if (!tenant) {
            var firestore = core() ? core().db() : null;
            if (!firestore) return;
            firestore.collection('All_Madrasas').doc(uid).get().then(function (doc) {
                if (!doc.exists) { toast('مدرسہ نہیں ملا۔', 'error'); return; }
                global.SA_TENANTS_CACHE.push({ uid: uid, data: doc.data() });
                global.saOpenTenantModal(uid);
            });
            return;
        }
        var m = tenant.data;
        var edit = mergeTenant(uid, m);

        var modulesHTML = '<div class="sa-mod-grid">';
        (global.SYSTEM_MODULES || []).forEach(function (mod) {
            var modData = (edit.allowedModules[mod.id] || { status: 'free', expiry: '' });
            var expiryDisplay = modData.status === 'trial' ? 'block' : 'none';
            modulesHTML +=
                '<div class="sa-mod-item">' +
                '<strong>' + esc(mod.name) + '</strong>' +
                '<div class="sa-mod-controls">' +
                '<select class="mod-status sa-mod-select" data-mod="' + esc(mod.id) + '" data-uid="' + esc(uid) + '">' +
                '<option value="free"' + (modData.status === 'free' ? ' selected' : '') + '>مفت</option>' +
                '<option value="trial"' + (modData.status === 'trial' ? ' selected' : '') + '>ٹرائل</option>' +
                '<option value="locked"' + (modData.status === 'locked' ? ' selected' : '') + '>بند</option>' +
                '</select>' +
                '<input type="date" class="mod-expiry sa-mod-date" data-mod="' + esc(mod.id) + '" data-uid="' + esc(uid) + '" value="' + esc(modData.expiry || '') + '" style="display:' + expiryDisplay + ';">' +
                '</div></div>';
        });
        modulesHTML += '</div>';

        var body = document.getElementById('sa-tenant-modal-body');
        if (!body) return;

        body.innerHTML =
            '<div class="sa-detail-grid">' +
            '<div><label>مدرسہ</label><p>' + esc(m.madrasaName || '-') + '</p></div>' +
            '<div><label>پرنسپل</label><p>' + esc(m.principalName || '-') + '</p></div>' +
            '<div><label>ای میل</label><p>' + esc(m.email || '-') + '</p></div>' +
            '<div><label>فون</label><p>' + esc(m.contactPhone || '-') + '</p></div>' +
            '<div><label>رجسٹریشن</label><p>' + esc(typeof global.saFormatDate === 'function' ? global.saFormatDate(m.setupDate) : (m.setupDate || '-')) + '</p></div>' +
            '<div><label>UID</label><p><code>' + esc(uid) + '</code></p></div>' +
            '</div>' +
            '<div class="input-group" style="margin:15px 0;">' +
            '<label>مرکزی اسٹیٹس</label>' +
            '<select id="sa-modal-status" class="input-control">' +
            '<option value="default"' + (edit.subStatus === 'default' ? ' selected' : '') + '>ڈیفالٹ</option>' +
            '<option value="free"' + (edit.subStatus === 'free' ? ' selected' : '') + '>مکمل فری</option>' +
            '<option value="suspended"' + (edit.subStatus === 'suspended' ? ' selected' : '') + '>معطل</option>' +
            '</select></div>' +
            '<h4>شعبہ جات</h4>' + modulesHTML;

        var modal = document.getElementById('sa-tenant-modal');
        modal.setAttribute('data-uid', uid);
        modal.style.display = 'flex';

        body.querySelectorAll('.sa-mod-select').forEach(function (sel) {
            sel.onchange = function () {
                if (typeof global.toggleDateInput === 'function') global.toggleDateInput(sel);
                global.saSyncModalEdit(uid);
            };
        });
        body.querySelectorAll('.sa-mod-date').forEach(function (inp) {
            inp.onchange = function () { global.saSyncModalEdit(uid); };
        });
        var statusEl = document.getElementById('sa-modal-status');
        if (statusEl) statusEl.onchange = function () { global.saSyncModalEdit(uid); };
    };

    global.saSyncModalEdit = function (uid) {
        var edit = global.SA_PENDING_EDITS[uid];
        if (!edit) return;
        var statusEl = document.getElementById('sa-modal-status');
        if (statusEl) edit.subStatus = statusEl.value;

        document.querySelectorAll('#sa-tenant-modal-body .sa-mod-select[data-uid="' + uid + '"]').forEach(function (sel) {
            var modId = sel.getAttribute('data-mod');
            var dateInput = document.querySelector('#sa-tenant-modal-body .sa-mod-date[data-mod="' + modId + '"][data-uid="' + uid + '"]');
            edit.allowedModules[modId] = {
                status: sel.value,
                expiry: dateInput ? dateInput.value : ''
            };
        });

        if (edit.subStatus === 'free') {
            edit.allowedModules = defaultModules();
        }
        global.saRenderTenantTable();
    };

    global.saSaveTenantModal = function () {
        var modal = document.getElementById('sa-tenant-modal');
        var uid = modal ? modal.getAttribute('data-uid') : '';
        if (!uid) return;
        if (core() && !core().requirePermission('modules.manage', 'ماڈیول محفوظ')) return;

        global.saShowReasonModal('اس مدرسے کی تبدیلی محفوظ — وجہ', function (reason) {
            var firestore = core().db();
            var edit = global.SA_PENDING_EDITS[uid];
            if (!firestore || !edit) return;

            var allowedModules = edit.allowedModules || defaultModules();
            if (edit.subStatus === 'free') allowedModules = defaultModules();

            var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === uid; });
            var name = tenant ? (tenant.data.madrasaName || uid) : uid;

            var payload = {
                subStatus: edit.subStatus || 'default',
                allowedModules: allowedModules,
                billingPlan: edit.billingPlan || 'basic',
                billingStatus: edit.billingStatus || 'pending',
                nextDueDate: edit.nextDueDate || '',
                billingNote: edit.billingNote || '',
                updatedBySuperAdmin: firebase.firestore.FieldValue.serverTimestamp()
            };

            firestore.collection('All_Madrasas').doc(uid).set(payload, { merge: true })
                .then(function () {
                    return core().syncPlatformSubscription(uid, edit, tenant ? tenant.data : null);
                })
                .then(function () {
                    return global.logSaAudit('save_tenant_modal', uid, name, reason, payload);
                })
                .then(function () {
                    delete global.SA_PENDING_EDITS[uid];
                    toast('مدرسہ محفوظ ہو گیا۔', 'success');
                    closeModal('sa-tenant-modal');
                })
                .catch(function (err) {
                    toast('محفوظ ناکام: ' + err.message, 'error');
                });
        });
    };

    global.restoreMadrasaAccess = function (uid, btnEl) {
        if (!global.isSuperAdmin()) return;
        if (core() && !core().requirePermission('modules.manage', 'بحالی')) return;

        global.saShowReasonModal('بحالی کی وجہ درج کریں', function (reason) {
            var firestore = core().db();
            if (!firestore) { toast('ڈیٹا بیس کنیکٹ نہیں۔', 'error'); return; }

            var allowedModules = defaultModules();
            var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === uid; });
            var name = tenant ? (tenant.data.madrasaName || uid) : uid;
            var edit = mergeTenant(uid, tenant ? tenant.data : {});

            if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

            firestore.collection('All_Madrasas').doc(uid).set({
                subStatus: 'free',
                allowedModules: allowedModules,
                restoredAt: firebase.firestore.FieldValue.serverTimestamp(),
                restoredBy: (core().currentUser() && core().currentUser().email) || ''
            }, { merge: true }).then(function () {
                global.SA_PENDING_EDITS[uid] = {
                    subStatus: 'free',
                    allowedModules: allowedModules,
                    billingPlan: edit.billingPlan || 'basic',
                    billingStatus: edit.billingStatus || 'pending',
                    nextDueDate: edit.nextDueDate || '',
                    billingNote: edit.billingNote || ''
                };
                return global.logSaAudit('restore_access', uid, name, reason, { subStatus: 'free' });
            }).then(function () {
                toast('مدرسے کی رسائی بحال ہو گئی!', 'success');
            }).catch(function (err) {
                if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-unlock"></i>'; }
                toast('بحالی ناکام: ' + err.message, 'error');
            });
        });
    };

    global.saBulkAction = function (action) {
        if (global.SA_SELECTED_UIDS.size === 0) return;
        if (core() && !core().requirePermission('modules.manage', 'بلک کارروائی')) return;

        var labels = { suspend: 'معطل', restore: 'بحالی', free: 'مکمل فری' };
        global.saShowReasonModal('بلک ' + (labels[action] || action) + ' — وجہ', function (reason) {
            var firestore = core().db();
            if (!firestore) return;
            var uids = Array.from(global.SA_SELECTED_UIDS);

            var cfBulk = function () {
                var batch = firestore.batch();
                uids.forEach(function (uid) {
                    var edit = global.SA_PENDING_EDITS[uid] || mergeTenant(uid, {});
                    var payload = { updatedBySuperAdmin: firebase.firestore.FieldValue.serverTimestamp() };
                    if (action === 'suspend') {
                        payload.subStatus = 'suspended';
                        edit.subStatus = 'suspended';
                    } else {
                        payload.subStatus = 'free';
                        payload.allowedModules = defaultModules();
                        payload.restoredAt = firebase.firestore.FieldValue.serverTimestamp();
                        payload.restoredBy = (core().currentUser() && core().currentUser().email) || '';
                        edit.subStatus = 'free';
                        edit.allowedModules = defaultModules();
                    }
                    global.SA_PENDING_EDITS[uid] = edit;
                    batch.set(firestore.collection('All_Madrasas').doc(uid), payload, { merge: true });
                });
                return batch.commit().then(function () {
                    var promises = uids.map(function (uid) {
                        var t = (global.SA_TENANTS_CACHE || []).find(function (x) { return x.uid === uid; });
                        return global.logSaAudit('bulk_' + action, uid, t ? t.data.madrasaName : uid, reason, {});
                    });
                    return Promise.all(promises);
                }).then(function () {
                    toast(uids.length + ' مدرسوں پر کارروائی مکمل۔', 'success');
                    global.SA_SELECTED_UIDS.clear();
                });
            };

            if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
                global.saApi.callOrFallback('bulkSetStatus', {
                    uids: uids,
                    action: action,
                    reason: reason
                }, cfBulk).then(function () {
                    toast('سرور-side بلک کارروائی مکمل۔', 'success');
                    global.SA_SELECTED_UIDS.clear();
                }).catch(function (err) {
                    toast('بلک کارروائی ناکام: ' + err.message, 'error');
                });
            } else {
                cfBulk().catch(function (err) {
                    toast('بلک کارروائی ناکام: ' + err.message, 'error');
                });
            }
        });
    };

    global.saveSuperAdminSettings = function (ev) {
        if (!global.isSuperAdmin()) return;
        if (core() && !core().requirePermission('modules.manage', 'تمام تبدیلیاں محفوظ')) return;

        global.saShowReasonModal('محفوظ کرنے کی وجہ (Audit)', function (reason) {
            var btnSave = ev && ev.currentTarget ? ev.currentTarget : document.querySelector('#sa-win-tenants .btn-success');
            if (!btnSave) return;

            var firestore = core().db();
            if (!firestore) { toast('ڈیٹا بیس کنیکٹ نہیں۔', 'error'); return; }

            var originalText = btnSave.innerHTML;
            btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> محفوظ...';
            btnSave.disabled = true;

            var globalStatusEl = document.getElementById('sa-global-status');
            var globalStatus = globalStatusEl ? globalStatusEl.value : 'free';

            var globalPromise = firestore.collection('System_Settings').doc('Subscription').set({
                globalStatus: globalStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            var uids = Object.keys(global.SA_PENDING_EDITS || {});
            var batchPromise = Promise.resolve();
            var subPromises = [];

            if (uids.length > 0) {
                var batch = firestore.batch();
                uids.forEach(function (uid) {
                    var edit = global.SA_PENDING_EDITS[uid];
                    var allowedModules = edit.allowedModules || defaultModules();
                    if (edit.subStatus === 'free') allowedModules = defaultModules();
                    batch.set(firestore.collection('All_Madrasas').doc(uid), {
                        subStatus: edit.subStatus || 'default',
                        allowedModules: allowedModules,
                        billingPlan: edit.billingPlan || 'basic',
                        billingStatus: edit.billingStatus || 'pending',
                        nextDueDate: edit.nextDueDate || '',
                        billingNote: edit.billingNote || '',
                        updatedBySuperAdmin: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === uid; });
                    subPromises.push(core().syncPlatformSubscription(uid, edit, tenant ? tenant.data : null));
                });
                batchPromise = batch.commit();
            }

            Promise.all([globalPromise, batchPromise].concat(subPromises)).then(function () {
                return global.logSaAudit('save_tenant_settings', '', 'all_tenants', reason, { globalStatus: globalStatus, count: uids.length });
            }).then(function () {
                global.SA_PENDING_EDITS = {};
                btnSave.innerHTML = originalText;
                btnSave.disabled = false;
                global.SYSTEM_GLOBAL_STATUS = globalStatus;
                toast('تمام سیٹنگز محفوظ ہو گئیں!', 'success');
                if (core()) core().updateStatusBar();
            }).catch(function (err) {
                btnSave.innerHTML = originalText;
                btnSave.disabled = false;
                toast('سیو ناکام: ' + err.message, 'error');
            });
        });
    };

    global.saExportTenantsCSV = function () {
        var rows = [['UID', 'Madrasa', 'Email', 'Phone', 'Status', 'Plan', 'Billing', 'SetupDate']];
        (global.SA_TENANTS_CACHE || []).forEach(function (t) {
            var m = t.data;
            var edit = global.SA_PENDING_EDITS[t.uid] || {};
            rows.push([
                t.uid,
                m.madrasaName || '',
                m.email || '',
                m.contactPhone || '',
                edit.subStatus || m.subStatus || 'default',
                edit.billingPlan || m.billingPlan || '',
                edit.billingStatus || m.billingStatus || '',
                m.setupDate || ''
            ]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'madrasas_export_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        toast('CSV ڈاؤنلوڈ شروع۔', 'success');
    };

    /** Firestore میں تمام مدرسوں کے شعبے مکمل فری محفوظ — SA UI vs حقیقت sync */
    global.saUnlockAllTenantModules = function () {
        if (core() && !core().requirePermission('modules.manage', 'سب شعبے کھولیں')) return;
        global.saShowReasonModal('تمام مدرسوں کے شعبے کھولیں — وجہ', function (reason) {
            var firestore = core().db();
            if (!firestore) return;
            toast('تمام مدرسوں کے شعبے کھولے جا رہے ہیں...', 'warning');
            var mods = defaultModules();
            firestore.collection('All_Madrasas').get().then(function (snap) {
                var batch = firestore.batch();
                var count = 0;
                snap.forEach(function (docSnap) {
                    var m = docSnap.data();
                    if (core() && core().shouldSkipTenantInSaList && core().shouldSkipTenantInSaList(docSnap)) return;
                    batch.set(docSnap.ref, {
                        subStatus: 'free',
                        allowedModules: mods,
                        modulesUnlockedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        modulesUnlockedBy: (core().currentUser() && core().currentUser().email) || ''
                    }, { merge: true });
                    count++;
                });
                return batch.commit().then(function () {
                    return global.logSaAudit('unlock_all_modules', '', 'all_tenants', reason, { count: count });
                }).then(function () {
                    toast(count + ' مدرسوں کے تمام شعبے کھule + Firestore میں محفوظ!', 'success');
                    global.SA_PENDING_EDITS = {};
                    global.loadSuperAdminData(true);
                });
            }).catch(function (err) {
                toast('ناکام: ' + err.message, 'error');
            });
        });
    };

    global.saSetTenantPageSize = function (size) {
        size = Math.max(10, Math.min(200, size || 50));
        _fsPageSize = size;
        global.SA_PAGE_SIZE = size;
        _pageCursors = {};
        global.SA_CURRENT_PAGE = 1;
    };

    global.SaTenants = {
        start: startListener,
        stop: stopListener
    };

})(window);
