// ================= 8. شکایات (Complaints) کا ماڈیول (Advanced Hybrid Model - IndexedDB + Firebase) =================

window.currentEditingCmpId = null;
window._cmpAttachments = [];
window._cmpListState = {
    page: 1,
    perPage: Math.max(1, typeof window.emsGetDomPageSize === 'function' ? window.emsGetDomPageSize() : 50),
    q: ''
};
window._cmpFilteredCache = [];
window._cmpDropdownGen = -1;
window._cmpDropdownReady = false;

// =========================================================
// 0. نیویگیشن + ڈیفالٹ صفحہ (مرحلہ 1)
// =========================================================
window.switchCmpTab = function (tabId, btn) {
    if (typeof window.emsIsComplaintsModuleActive === 'function' && !window.emsIsComplaintsModuleActive()) return;
    if (typeof window.cmpResolveTabForRole === 'function') tabId = window.cmpResolveTabForRole(tabId);
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    document.querySelectorAll('.cmp-panel').forEach(function (el) { el.style.display = 'none'; });
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('#cmp-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');

    if (tabId === 'cmp-list' && typeof window.renderComplaintsTable === 'function') {
        if (typeof window.emsDeferModuleWork === 'function') {
            window.emsDeferModuleWork(window.renderComplaintsTable, { idle: true, timeout: 300 });
        } else {
            window.renderComplaintsTable();
        }
    }
    if (tabId === 'cmp-dashboard' && typeof window.renderComplaintsDashboard === 'function') {
        if (typeof window.emsDeferModuleWork === 'function') {
            window.emsDeferModuleWork(window.renderComplaintsDashboard, { idle: true, timeout: 300 });
        } else {
            window.renderComplaintsDashboard();
        }
    }
    if (tabId === 'cmp-new' && typeof window.cmpEnsureDropdowns === 'function') {
        window.cmpEnsureDropdowns(false);
    }
};

window.emsOpenComplaints = function () {
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    if (typeof window.cmpApplyRoleUi === 'function') window.cmpApplyRoleUi();
    var defaultTab = typeof window.cmpGetDefaultTabId === 'function' ? window.cmpGetDefaultTabId() : 'cmp-list';
    var listBtn = document.querySelector('#cmp-ribbon-menu [onclick*="' + defaultTab + '"]');
    window.switchCmpTab(defaultTab, listBtn);
    if (typeof window.emsDeferModuleWork === 'function') {
        window.emsDeferModuleWork(function () {
            if (typeof window.cmpEnsureDropdowns === 'function') window.cmpEnsureDropdowns(false);
        }, { idle: true });
    } else if (typeof window.cmpEnsureDropdowns === 'function') {
        window.cmpEnsureDropdowns(false);
    }
};

// حالت اور ترجیح کے رنگین بیجز
window.cmpStatusBadge = function (status) {
    var map = {
        'نئی': '#2563eb', 'زیرِ غور': '#7c3aed', 'ذمہ دار کے پاس': '#0891b2',
        'کارروائی جاری': '#d97706', 'حل شدہ': '#16a34a', 'بند شدہ': '#64748b',
        'مسترد': '#b91c1c', 'مزید معلومات درکار': '#7c3aed'
    };
    var c = map[status] || '#64748b';
    return '<span class="cmp-badge" style="background:' + c + '20; color:' + c + '; border:1px solid ' + c + '55;">' + (status || 'نئی') + '</span>';
};
window.cmpPriorityBadge = function (p) {
    var map = { 'فوری': '#dc2626', 'اہم': '#d97706', 'معمولی': '#16a34a' };
    var c = map[p] || '#64748b';
    var icon = p === 'فوری' ? '<i class="fas fa-bolt"></i> ' : '';
    return '<span class="cmp-badge" style="background:' + c + '20; color:' + c + '; border:1px solid ' + c + '55;">' + icon + (p || 'معمولی') + '</span>';
};

// =========================================================
// Resolution workflow — statusKey + resolutionHistory audit trail
// =========================================================
window.CMP_STATUS_KEYS = {
    pending: { ur: 'نئی', labelUr: 'زیرِ التوا', color: '#2563eb' },
    in_progress: { ur: 'کارروائی جاری', labelUr: 'کارروائی جاری ہے', color: '#d97706' },
    resolved: { ur: 'حل شدہ', labelUr: 'حل شدہ', color: '#16a34a' },
    rejected: { ur: 'مسترد', labelUr: 'مسترد', color: '#b91c1c' },
    needs_info: { ur: 'مزید معلومات درکار', labelUr: 'مزید معلومات درکار', color: '#7c3aed' }
};

window.cmpUrToStatusKey = function (ur) {
    var map = {
        'نئی': 'pending',
        'زیرِ غور': 'in_progress',
        'ذمہ دار کے پاس': 'in_progress',
        'کارروائی جاری': 'in_progress',
        'حل شدہ': 'resolved',
        'بند شدہ': 'resolved',
        'مسترد': 'rejected',
        'مزید معلومات درکار': 'needs_info'
    };
    return map[ur] || 'pending';
};

window.cmpStatusKeyToUr = function (key) {
    var meta = window.CMP_STATUS_KEYS[key];
    return meta ? meta.ur : 'نئی';
};

window.cmpNormalizeComplaint = function (record) {
    if (!record || typeof record !== 'object') return record;
    if (!record.statusKey) {
        record.statusKey = window.cmpUrToStatusKey(record.status || 'نئی');
    }
    if (!record.status) {
        record.status = window.cmpStatusKeyToUr(record.statusKey);
    }
    if (!Array.isArray(record.resolutionHistory)) {
        record.resolutionHistory = [];
    }
    if (record.strictlyConfidential !== true) {
        record.strictlyConfidential = false;
    }
    return record;
};

// =========================================================
// Phase A — Confidentiality visibility (P0)
// =========================================================
window.cmpIsAdminOrOwner = function () {
    if (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) return true;
    if (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin()) return true;
    if (typeof window.emsIsTenantOwner === 'function' && window.emsIsTenantOwner()) return true;
    return false;
};

window.cmpGetCurrentStaffId = function () {
    var staff = typeof window.emsGetStaffRecordForCurrentUser === 'function'
        ? window.emsGetStaffRecordForCurrentUser()
        : null;
    return staff && staff.id ? String(staff.id) : '';
};

window.cmpCanViewConfidentialComplaint = function (record) {
    if (!record || record.strictlyConfidential !== true) return true;
    if (window.cmpIsAdminOrOwner()) return true;
    var staffId = window.cmpGetCurrentStaffId();
    var assigneeId = record.assignedToId ? String(record.assignedToId) : '';
    if (!assigneeId) return false;
    if (staffId && assigneeId === staffId) return true;
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        var uid = firebase.auth().currentUser.uid || '';
        if (uid && assigneeId === uid) return true;
    }
    return false;
};

window.cmpFilterConfidentialRecords = function (records) {
    if (!Array.isArray(records)) return records;
    return records.filter(function (r) {
        return window.cmpCanViewConfidentialComplaint(r);
    });
};

window.cmpIsResolvedRecord = function (record) {
    window.cmpNormalizeComplaint(record);
    return record.statusKey === 'resolved';
};

// =========================================================
// Phase B — Role-Based UX (mirrors Training Phase B)
// =========================================================
var CMP_ADMIN_TABS = ['cmp-dashboard'];
var CMP_STAFF_DEFAULT_TAB = 'cmp-list';

window.cmpIsTeacherOnly = function () {
    if (window.cmpIsAdminOrOwner()) return false;
    return !!(typeof window.emsIsStaffUser === 'function' && window.emsIsStaffUser());
};

window.cmpResolveTabForRole = function (tabId) {
    if (window.cmpIsTeacherOnly() && CMP_ADMIN_TABS.indexOf(tabId) >= 0) return CMP_STAFF_DEFAULT_TAB;
    return tabId;
};

window.cmpApplyRoleUi = function () {
    var isTeacher = window.cmpIsTeacherOnly();
    document.querySelectorAll('#cmp-ribbon-menu .reg-tab').forEach(function (btn) {
        var onclick = btn.getAttribute('onclick') || '';
        var isAdminTab = CMP_ADMIN_TABS.some(function (tab) { return onclick.indexOf(tab) !== -1; });
        if (isTeacher && isAdminTab) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
    });
    if (isTeacher) {
        var dashPanel = document.getElementById('cmp-dashboard');
        if (dashPanel && dashPanel.style.display !== 'none') {
            var listBtn = document.querySelector('#cmp-ribbon-menu [onclick*="cmp-list"]');
            window.switchCmpTab('cmp-list', listBtn);
        }
    }
};

window.cmpGetDefaultTabId = function () {
    return window.cmpIsTeacherOnly() ? CMP_STAFF_DEFAULT_TAB : 'cmp-list';
};

window.cmpIsCurrentAssignee = function (record) {
    if (!record || !record.assignedToId) return false;
    var assigneeId = String(record.assignedToId);
    var staffId = window.cmpGetCurrentStaffId();
    if (staffId && assigneeId === staffId) return true;
    var actor = window.cmpGetCurrentActor();
    if (actor.uid && assigneeId === actor.uid) return true;
    return false;
};

window.cmpIsCurrentCreator = function (record) {
    if (!record) return false;
    var staffId = window.cmpGetCurrentStaffId();
    var actor = window.cmpGetCurrentActor();
    if (record.createdById) {
        var cid = String(record.createdById);
        if (staffId && cid === staffId) return true;
        if (actor.uid && cid === actor.uid) return true;
    }
    if (record.recordedBy && actor.name && String(record.recordedBy) === String(actor.name)) return true;
    if (!record.createdById && Array.isArray(record.history) && record.history.length) {
        var first = record.history.find(function (h) { return h && h.action === 'درج ہوئی'; }) || record.history[0];
        if (first && first.by) {
            var by = String(first.by);
            if (actor.name && by === actor.name) return true;
            if (actor.uid && by === actor.uid) return true;
            if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
                var email = firebase.auth().currentUser.email || '';
                if (email && by === email) return true;
            }
        }
    }
    return false;
};

window.cmpFilterRecordsForRole = function (records) {
    if (!Array.isArray(records)) return records;
    if (!window.cmpIsTeacherOnly()) return records;
    return records.filter(function (r) {
        return window.cmpIsCurrentCreator(r) || window.cmpIsCurrentAssignee(r);
    });
};

window.cmpCanShowDeleteBtn = function () {
    return window.cmpIsAdminOrOwner();
};

window.cmpCanShowResolutionBtn = function (record) {
    if (window.cmpIsAdminOrOwner()) return true;
    return window.cmpIsCurrentAssignee(record);
};

window.cmpCanShowEditBtn = function (record) {
    if (window.cmpIsAdminOrOwner()) return true;
    window.cmpNormalizeComplaint(record);
    return window.cmpIsCurrentCreator(record) && record.statusKey === 'pending' && record.status === 'نئی';
};

window.cmpGetCurrentActor = function () {
    var name = 'سسٹم';
    var uid = '';
    if (window.CURRENT_USER_DISPLAY_NAME) name = window.CURRENT_USER_DISPLAY_NAME;
    else if (window.CURRENT_MADRASA_DATA && window.CURRENT_MADRASA_DATA.madrasaName) {
        /* fallback only when nothing else */
    }
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        var u = firebase.auth().currentUser;
        uid = u.uid || '';
        name = u.displayName || u.email || name || uid;
    }
    if (window.CURRENT_USER_TENANT_ROLE === 'owner' && window.CURRENT_MADRASA_DATA && window.CURRENT_MADRASA_DATA.ownerName) {
        name = window.CURRENT_MADRASA_DATA.ownerName;
    }
    return { name: name, uid: uid };
};

window._cmpResolutionState = { complaintId: null, attachment: null };

// =========================================================
// 🚀 1. IndexedDB انجن (بڑی میموری اور آف لائن فرسٹ کے لیے)
// =========================================================
window.CmpIDB = {
    dbName: "MadrasaERP_DB",
    storeName: "complaints",
    init: function() {
        return new Promise((resolve, reject) => {
            let request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = function(e) {
                let db = e.target.result;
                if (!db.objectStoreNames.contains("complaints")) {
                    db.createObjectStore("complaints", { keyPath: "id" });
                }
            };
            request.onsuccess = function(e) { resolve(e.target.result); };
            request.onerror = function(e) { reject(e.target.error); };
        });
    },
    getAll: async function() {
        let db = await this.init();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(this.storeName, "readonly");
            let store = tx.objectStore(this.storeName);
            let request = store.getAll();
            request.onsuccess = () => {
                var rows = (request.result || []).map(function (r) {
                    return typeof window.cmpNormalizeComplaint === 'function'
                        ? window.cmpNormalizeComplaint(r)
                        : r;
                });
                resolve(rows);
            };
            request.onerror = () => reject(request.error);
        });
    },
    getById: async function(id) {
        let db = await this.init();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(this.storeName, "readonly");
            let store = tx.objectStore(this.storeName);
            let request = store.get(id);
            request.onsuccess = () => {
                var row = request.result;
                resolve(row && typeof window.cmpNormalizeComplaint === 'function'
                    ? window.cmpNormalizeComplaint(row)
                    : row);
            };
            request.onerror = () => reject(request.error);
        });
    },
    saveAll: async function(dataArray) {
        let db = await this.init();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(this.storeName, "readwrite");
            let store = tx.objectStore(this.storeName);
            store.clear(); // پرانا لوکل ڈیٹا صاف کریں
            dataArray.forEach(item => store.put(item)); // کلاؤڈ کا نیا ڈیٹا ڈالیں
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    save: async function(item) {
        if (typeof window.cmpNormalizeComplaint === 'function') {
            window.cmpNormalizeComplaint(item);
        }
        let db = await this.init();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(this.storeName, "readwrite");
            tx.objectStore(this.storeName).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    delete: async function(id) {
        let db = await this.init();
        return new Promise((resolve, reject) => {
            let tx = db.transaction(this.storeName, "readwrite");
            tx.objectStore(this.storeName).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};

// =========================================================
// 🚀 2. کلاؤڈ سنک انجن (فائر بیس کے ساتھ رابطہ)
// =========================================================
window.syncComplaintsToCloud = async function(record) {
    if (record && global.CmpCloud) {
        try {
            var res = await global.CmpCloud.save(record);
            if (typeof window.emsLogAudit === 'function') {
                window.emsLogAudit('complaints', record.id ? 'update' : 'create', record.id || '', {
                    status: record.status || ''
                });
            }
            if (res.status === 'queued' || res.status === 'offline_queued') {
                if (typeof window.showToast === 'function') {
                    window.showToast('محلی محفوظ — کلاؤڈ سنک منتظر', 'warning');
                }
            }
            return res;
        } catch (error) {
            console.error('Complaint cloud save failed:', error);
            if (typeof window.showTopAlert === 'function') {
                window.showTopAlert('⚠️ شکایت کلاؤڈ میں محفوظ نہیں ہو سکی: ' + error.message, true);
            }
            throw error;
        }
    }
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && global.CmpCloud) {
        try {
            let allData = await window.CmpIDB.getAll();
            var chain = Promise.resolve();
            allData.forEach(function (rec) {
                chain = chain.then(function () { return global.CmpCloud.save(rec); });
            });
            await chain;
        } catch (error) {
            console.error('Cloud push failed', error);
        }
    }
};

window.syncComplaintsFromCloud = async function(isManualSync = false) {
    if (typeof firebase === 'undefined' || window.EMS_OFFLINE_ONLY === true) return;
    if (!global.CmpCloud) return;
    try {
        if (typeof global.CmpCloud.flushQueue === 'function') await global.CmpCloud.flushQueue();
        var items = await global.CmpCloud.pullAll();
        if (items && items.length > 0) {
            await window.CmpIDB.saveAll(items);
            if (isManualSync && typeof window.showToast === 'function') {
                window.showToast('کلاؤڈ سے ' + items.length + ' شکایات لوڈ ہوئیں', 'success');
            }
            await window.renderComplaintsTable();
        } else if (isManualSync && typeof window.showToast === 'function') {
            window.showToast('کلاؤڈ میں کوئی شکایت نہیں ملی', 'warning');
        }
    } catch (error) {
        console.error('Cloud fetch failed.', error);
        if (isManualSync && typeof window.showToast === 'function') {
            window.showToast('کلاؤڈ سے ڈیٹا منگوانے میں ناکامی', 'error');
        }
    }
};

// =========================================================
// 3. گلوبل فنکشنز (UI Logic)
// =========================================================

window.cmpEnsureDropdowns = function (force) {
    if (typeof window.emsIsComplaintsModuleActive === 'function' && !window.emsIsComplaintsModuleActive()) return;
    var gen = typeof window.emsReadRepoCacheGen === 'function' ? window.emsReadRepoCacheGen() : 0;
    if (!force && window._cmpDropdownReady && window._cmpDropdownGen === gen) return;
    window._cmpDropdownGen = gen;
    window._cmpDropdownReady = true;

    if (typeof window.emsFillClassSelects === 'function') {
        window.emsFillClassSelects('.cmp-dynamic-class');
    }

    var deptSet = Object.create(null);
    if (typeof window.emsRegRepoForEach === 'function') {
        window.emsRegRepoForEach(function (u) {
            if (u && u.dept && u.dept !== '-') deptSet[u.dept] = 1;
        });
    }
    var depts = Object.keys(deptSet).sort();
    document.querySelectorAll('.cmp-dynamic-dept').forEach(function (select) {
        var currentVal = select.value;
        var first = select.id.indexOf('filter') >= 0 ? 'تمام شعبے' : 'منتخب کریں...';
        var html = '<option value="">' + first + '</option>';
        depts.forEach(function (d) { html += '<option value="' + d + '">' + d + '</option>'; });
        select.innerHTML = html;
        if (currentVal) select.value = currentVal;
    });

    document.querySelectorAll('.cmp-dynamic-individual').forEach(function (select) {
        select.innerHTML = '<option value="">پہلے درجہ منتخب کریں…</option>';
    });

    var clsSel = document.getElementById('cmp-class-select');
    var indSel = document.getElementById('cmp-individual-select');
    if (typeof window.emsBindLazyStudentSelect === 'function' && clsSel && indSel) {
        window.emsBindLazyStudentSelect(indSel, clsSel, { moduleActive: window.emsIsComplaintsModuleActive });
    }
    var assignSel = document.getElementById('cmp-assign-select');
    if (assignSel) {
        assignSel._emsStaffLazyLoaded = false;
        if (typeof window.emsBindLazyStaffSelect === 'function') {
            window.emsBindLazyStaffSelect(assignSel, 'staff', {
                moduleActive: window.emsIsComplaintsModuleActive,
                valueField: 'id',
                placeholder: 'تفویض نہیں...'
            });
        }
    }
};

window.loadComplaintsDataFromRegistration = function () {
    return window.cmpEnsureDropdowns(false);
};

window.resetComplaintForm = function() {
    window.currentEditingCmpId = null;
    window._cmpAttachments = [];
    const btnSaveComplaint = document.getElementById('btn-save-complaint');
    const btnCancelCmpEdit = document.getElementById('btn-cancel-cmp-edit');

    if(btnSaveComplaint) btnSaveComplaint.innerHTML = '<i class="fas fa-save"></i> شکایت محفوظ کریں';
    if(btnCancelCmpEdit) btnCancelCmpEdit.style.display = 'none';

    var setVal = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    setVal('cmp-type-select', 'طالب علم');
    setVal('cmp-category-select', 'عمومی');
    setVal('cmp-priority-select', 'اہم');
    setVal('cmp-status-select', 'نئی');
    setVal('cmp-dept-select', '');
    setVal('cmp-class-select', '');
    setVal('cmp-individual-select', '');
    setVal('cmp-assign-select', '');
    setVal('cmp-due-date', '');
    setVal('cmp-details-textarea', '');
    var confEl = document.getElementById('cmp-strictly-confidential');
    if (confEl) confEl.checked = false;
    var fileEl = document.getElementById('cmp-attachments'); if (fileEl) fileEl.value = '';
    var prev = document.getElementById('cmp-attach-preview'); if (prev) prev.innerHTML = '';

    const cmpDateInput = document.getElementById('cmp-date');
    if(cmpDateInput) cmpDateInput.valueAsDate = new Date();
};

// =========================================================
// دستاویزی منسلکات (Attachments) — مرحلہ 2
// =========================================================
window.cmpOnAttach = function (input) {
    var files = Array.from(input.files || []);
    var maxBytes = 1.5 * 1024 * 1024; // فی فائل تقریباً 1.5MB حد
    files.forEach(function (f) {
        if (f.size > maxBytes) {
            if (typeof window.showToast === 'function') window.showToast('فائل بہت بڑی ہے (' + f.name + ') — 1.5MB سے کم ہونی چاہیے', 'warning');
            return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
            window._cmpAttachments.push({ name: f.name, type: f.type, size: f.size, data: e.target.result });
            window.cmpRenderAttachPreview();
        };
        reader.readAsDataURL(f);
    });
};
window.cmpRenderAttachPreview = function () {
    var box = document.getElementById('cmp-attach-preview');
    if (!box) return;
    box.innerHTML = (window._cmpAttachments || []).map(function (a, i) {
        var thumb = (a.type && a.type.indexOf('image') === 0)
            ? '<img src="' + a.data + '">'
            : '<i class="fas fa-file-alt"></i>';
        return '<div class="cmp-attach-item">' + thumb +
            '<span>' + a.name + '</span>' +
            '<button type="button" onclick="window.cmpRemoveAttach(' + i + ')" title="ہٹائیں"><i class="fas fa-times"></i></button></div>';
    }).join('');
};
window.cmpRemoveAttach = function (i) {
    window._cmpAttachments.splice(i, 1);
    window.cmpRenderAttachPreview();
};

function cmpEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

window.cmpGetFilteredRecords = async function () {
    let records = await window.CmpIDB.getAll();
    records = window.cmpFilterConfidentialRecords(records);
    records = window.cmpFilterRecordsForRole(records);
    if (typeof window.emsFilterByDepartment === 'function') {
        records = window.emsFilterByDepartment(records);
    }
    const v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    const fFrom = v('cmp-filter-from'), fTo = v('cmp-filter-to');
    const fDept = v('cmp-filter-dept'), fClass = v('cmp-filter-class');
    const fStatus = v('cmp-filter-status'), fPrio = v('cmp-filter-priority'), fCat = v('cmp-filter-category');
    const q = (window._cmpListState.q || '').trim().toLowerCase();

    if (fFrom) records = records.filter(r => (r.date || '') >= fFrom);
    if (fTo) records = records.filter(r => (r.date || '') <= fTo);
    if (fDept) records = records.filter(r => r.dept === fDept);
    if (fClass) records = records.filter(r => r.classLevel === fClass);
    if (fStatus) records = records.filter(r => (r.status || 'نئی') === fStatus);
    if (fPrio) records = records.filter(r => (r.priority || 'معمولی') === fPrio);
    if (fCat) records = records.filter(r => (r.category || '') === fCat);
    if (q) {
        records = records.filter(function (r) {
            var hay = [r.details, r.type, r.category, r.target, r.individual, r.individualId, r.dept, r.classLevel, r.assignedTo, r.status, r.priority].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
        });
    }
    if (window._cmpListState.overdueOnly) {
        var rem = window.cmpGetOverdue(records);
        var ids = {};
        rem.overdue.concat(rem.stale).forEach(function (r) { ids[r.id] = 1; });
        records = records.filter(function (r) { return ids[r.id]; });
    }
    // تازہ ترین پہلے
    records.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return records;
};

function cmpBuildRowHtml(record) {
    var details = record.details || '';
    var shortDetails = details.length > 45 ? details.substring(0, 45) + '...' : details;
    var attCount = (record.attachments && record.attachments.length) ? '<i class="fas fa-paperclip" title="' + record.attachments.length + ' منسلکات" style="color:#64748b; margin-right:4px;"></i>' : '';
    var relParts = [];
    if (record.dept) relParts.push(record.dept);
    if (record.classLevel) relParts.push(record.classLevel);
    if (record.individual) relParts.push(record.individual);
    var rel = relParts.length ? relParts.join(' • ') : 'عمومی';
    var confIcon = record.strictlyConfidential
        ? '<i class="fas fa-user-secret" title="انتہائی خفیہ" style="color:#7c3aed;margin-left:4px;"></i> '
        : '';
    var actions =
        '<button class="icon-btn" onclick="window.openComplaintDetail(\'' + cmpEsc(record.id) + '\')" title="تفصیل"><i class="fas fa-eye" style="color: var(--accent);"></i></button>';
    if (window.cmpCanShowResolutionBtn(record)) {
        actions += '<button class="icon-btn" onclick="window.cmpOpenResolutionModal(\'' + cmpEsc(record.id) + '\')" title="کارروائی"><i class="fas fa-gavel" style="color:#7c3aed;"></i></button>';
    }
    if (window.cmpCanShowEditBtn(record)) {
        actions += '<button class="icon-btn edit" onclick="window.editComplaint(\'' + cmpEsc(record.id) + '\')" title="ترمیم کریں"><i class="fas fa-edit" style="color: var(--warning);"></i></button>';
    }
    if (window.cmpCanShowDeleteBtn()) {
        actions += '<button class="icon-btn delete" onclick="window.deleteComplaint(\'' + cmpEsc(record.id) + '\')" title="حذف کریں"><i class="fas fa-trash-alt"></i></button>';
    }
    return '<tr style="cursor:pointer;" onclick="window.openComplaintDetail(\'' + cmpEsc(record.id) + '\')">' +
        '<td>' + cmpEsc(record.date) + '</td>' +
        '<td><span class="cmp-cat-tag">' + cmpEsc(record.category || 'عمومی') + '</span></td>' +
        '<td>' + cmpEsc(record.type) + '</td>' +
        '<td><small>' + cmpEsc(rel) + '</small></td>' +
        '<td title="' + cmpEsc(details) + '">' + confIcon + attCount + cmpEsc(shortDetails) + '</td>' +
        '<td>' + window.cmpPriorityBadge(record.priority) + '</td>' +
        '<td>' + window.cmpStatusBadge(record.status) + '</td>' +
        '<td class="action-cell" onclick="event.stopPropagation();">' + actions + '</td></tr>';
}

window.renderComplaintsTable = async function() {
    if (typeof window.emsIsComplaintsModuleActive === 'function' && !window.emsIsComplaintsModuleActive()) return;
    const tbody = document.querySelector('#cmp-history-table tbody');
    if(!tbody) return;

    let all = await window.CmpIDB.getAll();
    all = window.cmpFilterConfidentialRecords(all);
    all = window.cmpFilterRecordsForRole(all);
    window.cmpRenderStatStrip(all);
    window.cmpRenderReminders(all);

    let records = await window.cmpGetFilteredRecords();
    window._cmpFilteredCache = records;
    const total = records.length;
    const pagerEl = document.getElementById('cmp-pager');

    if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('cmp-history');

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:24px;">کوئی شکایت موجود نہیں</td></tr>';
        if (pagerEl) pagerEl.innerHTML = '';
        return;
    }

    var st = window._cmpListState;
    var perPage = Math.max(1, st.perPage || (typeof window.emsGetDomPageSize === 'function' ? window.emsGetDomPageSize() : 50));
    var pages = Math.max(1, Math.ceil(total / perPage));
    if (st.page > pages) st.page = pages;
    var start = (st.page - 1) * perPage;
    var pageRows = records.slice(start, start + perPage);

    tbody.innerHTML = '';
    pageRows.forEach(function (record) {
        var tmp = document.createElement('tbody');
        tmp.innerHTML = cmpBuildRowHtml(record).trim();
        if (tmp.firstElementChild) tbody.appendChild(tmp.firstElementChild);
    });
    window.cmpRenderPager(total, start, pages);
};

window.cmpRenderStatStrip = function (all) {
    var box = document.getElementById('cmp-stat-strip');
    if (!box) return;
    var openKeys = ['pending', 'in_progress', 'needs_info'];
    var open = all.filter(function (r) {
        window.cmpNormalizeComplaint(r);
        if (r.statusKey) return openKeys.indexOf(r.statusKey) >= 0;
        return ['نئی', 'زیرِ غور', 'ذمہ دار کے پاس', 'کارروائی جاری', 'مزید معلومات درکار'].indexOf(r.status || 'نئی') >= 0;
    }).length;
    var resolved = all.filter(function (r) {
        window.cmpNormalizeComplaint(r);
        return r.status === 'حل شدہ';
    }).length;
    var rejected = all.filter(function (r) {
        window.cmpNormalizeComplaint(r);
        return r.statusKey === 'rejected';
    }).length;
    var closed = all.filter(function (r) {
        window.cmpNormalizeComplaint(r);
        return r.status === 'بند شدہ';
    }).length;
    var urgent = all.filter(function (r) {
        window.cmpNormalizeComplaint(r);
        return r.priority === 'فوری' && r.statusKey !== 'resolved' && r.statusKey !== 'rejected';
    }).length;
    var cards = [
        { l: 'کل شکایات', v: all.length, c: '#2563eb', i: 'fa-inbox' },
        { l: 'زیرِ کارروائی', v: open, c: '#d97706', i: 'fa-spinner' },
        { l: 'حل شدہ', v: resolved, c: '#16a34a', i: 'fa-check-circle' },
        { l: 'مسترد', v: rejected, c: '#b91c1c', i: 'fa-ban' },
        { l: 'بند شدہ', v: closed, c: '#64748b', i: 'fa-lock' },
        { l: 'فوری (زیرِ التوا)', v: urgent, c: '#dc2626', i: 'fa-bolt' }
    ];
    box.innerHTML = cards.map(function (k) {
        return '<div class="cmp-stat" style="border-top:3px solid ' + k.c + ';">' +
            '<div class="cmp-stat-ico" style="color:' + k.c + ';"><i class="fas ' + k.i + '"></i></div>' +
            '<div class="cmp-stat-v">' + k.v + '</div><div class="cmp-stat-l">' + k.l + '</div></div>';
    }).join('');
};

// =========================================================
// اطلاع اور یاد دہانی کا نظام (مرحلہ 6)
// =========================================================
window.cmpGetOverdue = function (all) {
    var today = new Date().toISOString().slice(0, 10);
    var openSt = ['نئی', 'زیرِ غور', 'ذمہ دار کے پاس', 'کارروائی جاری', 'مزید معلومات درکار'];
    var staleMs = 7 * 24 * 60 * 60 * 1000;
    var now = Date.now();
    var overdue = [], stale = [];
    (all || []).forEach(function (r) {
        if (openSt.indexOf(r.status || 'نئی') < 0) return;
        if (r.dueDate && r.dueDate < today) overdue.push(r);
        else if (!r.dueDate && r.createdAt && (now - r.createdAt) > staleMs) stale.push(r);
    });
    return { overdue: overdue, stale: stale };
};
window.cmpRenderReminders = function (all) {
    var box = document.getElementById('cmp-reminder-bar');
    if (!box) return;
    var rem = window.cmpGetOverdue(all);
    var n = rem.overdue.length, s = rem.stale.length;
    if (!n && !s) { box.innerHTML = ''; return; }
    var msg = [];
    if (n) msg.push('<b>' + n + '</b> شکایات مقررہ مدت سے زائد ہو چکی ہیں');
    if (s) msg.push('<b>' + s + '</b> شکایات 7 دن سے زائد زیرِ التوا ہیں');
    box.innerHTML = '<div class="cmp-reminder"><i class="fas fa-bell"></i><span>' + msg.join(' • ') +
        ' — فوری توجہ درکار</span><button class="btn btn-sm btn-outline" onclick="window.cmpShowOverdueOnly()">صرف زیرِ التوا دیکھیں</button></div>';
};
window.cmpShowOverdueOnly = function () {
    window.cmpClearFilters();
    var el = document.getElementById('cmp-filter-status');
    if (el) el.value = '';
    window._cmpListState.overdueOnly = true;
    window.renderComplaintsTable();
    if (typeof window.showToast === 'function') window.showToast('صرف زیرِ التوا/مقررہ مدت سے زائد شکایات دکھائی جا رہی ہیں', 'warning');
};

window.cmpRenderPager = function (total, start, pages) {
    var box = document.getElementById('cmp-pager');
    if (!box) return;
    if (total === 0) { box.innerHTML = ''; return; }
    var st = window._cmpListState;
    var end = Math.min(start + st.perPage, total);
    var html = '<span class="reg-pg-info">' + (start + 1) + '–' + end + ' / ' + total + ' شکایات</span>';
    html += '<button class="reg-pg-btn" ' + (st.page <= 1 ? 'disabled' : '') + ' onclick="window.cmpGoPage(' + (st.page - 1) + ')"><i class="fas fa-chevron-right"></i></button>';
    html += '<span class="reg-pg-dots">صفحہ ' + st.page + ' / ' + pages + '</span>';
    html += '<button class="reg-pg-btn" ' + (st.page >= pages ? 'disabled' : '') + ' onclick="window.cmpGoPage(' + (st.page + 1) + ')"><i class="fas fa-chevron-left"></i></button>';
    box.innerHTML = html;
};
window.cmpGoPage = function (p) { window._cmpListState.page = p; window.renderComplaintsTable(); };

var _cmpSearchTimer = null;
window.cmpSearch = function (val) {
    window._cmpListState.q = val;
    window._cmpListState.page = 1;
    clearTimeout(_cmpSearchTimer);
    _cmpSearchTimer = setTimeout(function () { window.renderComplaintsTable(); }, 200);
};
window.cmpClearFilters = function () {
    ['cmp-filter-from', 'cmp-filter-to', 'cmp-filter-dept', 'cmp-filter-class', 'cmp-filter-status', 'cmp-filter-priority', 'cmp-filter-category', 'cmp-search'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
    });
    window._cmpListState.q = '';
    window._cmpListState.page = 1;
    window._cmpListState.overdueOnly = false;
    window.renderComplaintsTable();
};
window.cmpPrintList = async function () {
    var records = await window.cmpGetFilteredRecords();
    var rows = records.map(function (r) {
        return '<tr><td>' + cmpEsc(r.date) + '</td><td>' + cmpEsc(r.category || '') + '</td><td>' + cmpEsc(r.type) + '</td><td>' + cmpEsc(r.target) + '</td><td>' + cmpEsc(r.priority || '') + '</td><td>' + cmpEsc(r.status || 'نئی') + '</td><td>' + cmpEsc(r.details) + '</td></tr>';
    }).join('');
    var content = '<table class="data-table" border="1" style="width:100%; border-collapse:collapse;"><thead><tr><th>تاریخ</th><th>نوعیت</th><th>کس کے خلاف</th><th>متعلقہ</th><th>ترجیح</th><th>حالت</th><th>تفصیل</th></tr></thead><tbody>' + rows + '</tbody></table>';
    if (typeof window.attPrintWithBrandingShared === 'function') { window.attPrintWithBrandingShared(content, 'شکایات کی رپورٹ'); return; }
    // fallback: نیا ریپر بنا کر پرنٹ
    var wrap = document.createElement('div');
    wrap.id = 'cmp-print-temp';
    wrap.innerHTML = (typeof window.attBrandHeaderHTML === 'function' ? window.attBrandHeaderHTML() : '') +
        '<h2 style="text-align:center;">شکایات کی رپورٹ</h2>' + content +
        (typeof window.attSignFooterHTML === 'function' ? window.attSignFooterHTML() : '');
    document.body.appendChild(wrap);
    if (typeof window.printDiv === 'function') window.printDiv('cmp-print-temp');
    setTimeout(function () { var t = document.getElementById('cmp-print-temp'); if (t) t.remove(); }, 100);
};

window.editComplaint = async function(id) {
    let r = await window.CmpIDB.getById(id);
    if(!r) return;
    if (!window.cmpCanViewConfidentialComplaint(r)) {
        if (typeof window.showToast === 'function') window.showToast('یہ خفیہ شکایت دیکھنے کی اجازت نہیں', 'error');
        return;
    }
    if (!window.cmpCanShowEditBtn(r)) {
        if (typeof window.showToast === 'function') window.showToast('اس شکایت میں ترمیم کی اجازت نہیں', 'error');
        return;
    }

    window.currentEditingCmpId = id;
    window._cmpAttachments = (r.attachments || []).slice();

    var setVal = function (eid, v) { var el = document.getElementById(eid); if (el) el.value = v; };
    setVal('cmp-date', r.date || '');
    setVal('cmp-category-select', r.category || 'عمومی');
    setVal('cmp-type-select', r.type || 'طالب علم');
    setVal('cmp-priority-select', r.priority || 'اہم');
    setVal('cmp-status-select', r.status || 'نئی');
    setVal('cmp-dept-select', r.dept || '');
    setVal('cmp-class-select', r.classLevel || '');
    setVal('cmp-individual-select', r.individualId || '');
    setVal('cmp-assign-select', r.assignedToId || '');
    setVal('cmp-due-date', r.dueDate || '');
    setVal('cmp-details-textarea', r.details || '');
    var confEl = document.getElementById('cmp-strictly-confidential');
    if (confEl) confEl.checked = !!r.strictlyConfidential;
    window.cmpRenderAttachPreview();

    const btnSaveComplaint = document.getElementById('btn-save-complaint');
    const btnCancelCmpEdit = document.getElementById('btn-cancel-cmp-edit');
    if(btnSaveComplaint) btnSaveComplaint.innerHTML = '<i class="fas fa-edit"></i> اپڈیٹ کریں (Update)';
    if(btnCancelCmpEdit) btnCancelCmpEdit.style.display = 'inline-block';

    var newBtn = document.querySelector('#cmp-ribbon-menu [onclick*="cmp-new"]');
    window.switchCmpTab('cmp-new', newBtn);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if(typeof window.showToast === 'function') window.showToast("شکایت ترمیم کے لیے لوڈ ہو گئی ہے۔", "success");
};

window.deleteComplaint = async function(id) {
    if(confirm("کیا آپ واقعی یہ شکایت مستقل ڈیلیٹ کرنا چاہتے ہیں؟")) {
        var existing = await window.CmpIDB.getById(id);
        if (existing && !window.cmpCanViewConfidentialComplaint(existing)) {
            if (typeof window.showToast === 'function') window.showToast('یہ خفیہ شکایت حذف کرنے کی اجازت نہیں', 'error');
            return;
        }
        if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('complaints', 'delete')) return;
        await window.CmpIDB.delete(id);
        if (window.CmpCloud) await window.CmpCloud.remove(id);
        if (typeof window.emsLogAudit === 'function') {
            window.emsLogAudit('complaints', 'delete', id, {});
        }
        
        if(typeof window.showToast === 'function') window.showToast("شکایت کا ریکارڈ ڈیلیٹ کر دیا گیا!", "error");
        await window.renderComplaintsTable();
        if(typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
        if(window.currentEditingCmpId === id) window.resetComplaintForm();
    }
};

// =========================================================
// کارروائیِ شکایت — Resolution Modal + resolutionHistory
// =========================================================
window.cmpRenderResolutionTimeline = function (record) {
    var entries = (record && record.resolutionHistory) ? record.resolutionHistory.slice() : [];
    if (!entries.length && record && record.history && record.history.length) {
        entries = record.history.map(function (h) {
            return {
                date: h.at ? new Date(h.at).toISOString().slice(0, 10) : '',
                updatedAt: h.at || Date.now(),
                updatedBy: h.by || '',
                status_change: '',
                remarks: (h.action || '') + (h.note ? (' — ' + h.note) : '')
            };
        });
    }
    entries.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    if (!entries.length) {
        return '<p style="color:#94a3b8;font-size:13px;">ابھی کوئی کارروائی درج نہیں ہوئی</p>';
    }
    return entries.map(function (e) {
        var when = e.date || (e.updatedAt ? new Date(e.updatedAt).toISOString().slice(0, 10) : '');
        var statusLbl = e.status_change
            ? ((window.CMP_STATUS_KEYS[e.status_change] && window.CMP_STATUS_KEYS[e.status_change].labelUr) || e.status_change)
            : '';
        var attach = (e.attachment && e.attachment.name)
            ? '<div class="cmp-res-notify"><i class="fas fa-paperclip"></i> ' + cmpEsc(e.attachment.name) + '</div>'
            : '';
        return '<div class="cmp-tl-item"><div class="cmp-tl-dot"></div><div class="cmp-tl-content">' +
            (statusLbl ? '<div class="cmp-res-status-chip">' + cmpEsc(statusLbl) + '</div>' : '') +
            '<div class="cmp-tl-action">' + cmpEsc(e.remarks || '—') + '</div>' +
            attach +
            '<div class="cmp-tl-meta">' + cmpEsc(when) + ' • ' + cmpEsc(e.updatedBy || '') + '</div></div></div>';
    }).join('');
};

window.cmpResetResolutionForm = function () {
    window._cmpResolutionState.attachment = null;
    var dateEl = document.getElementById('cmp-res-date');
    if (dateEl) dateEl.valueAsDate = new Date();
    var remarks = document.getElementById('cmp-res-remarks');
    if (remarks) remarks.value = '';
    var statusSel = document.getElementById('cmp-res-status');
    if (statusSel) statusSel.value = 'in_progress';
    var fileEl = document.getElementById('cmp-res-attachment');
    if (fileEl) fileEl.value = '';
    var prev = document.getElementById('cmp-res-attach-preview');
    if (prev) prev.innerHTML = '';
};

window.cmpOnResolutionAttach = function (input) {
    var file = (input.files && input.files[0]) ? input.files[0] : null;
    if (!file) return;
    var maxBytes = 512 * 1024;
    if (file.size > maxBytes) {
        if (typeof window.showToast === 'function') {
            window.showToast('ثبوت کی فائل 512KB سے چھوٹی ہونی چاہیے', 'warning');
        }
        input.value = '';
        return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
        window._cmpResolutionState.attachment = {
            name: file.name,
            type: file.type,
            size: file.size,
            data: e.target.result
        };
        var prev = document.getElementById('cmp-res-attach-preview');
        if (prev) {
            prev.innerHTML = '<div class="cmp-attach-item"><i class="fas fa-paperclip"></i><span>' +
                cmpEsc(file.name) + '</span><button type="button" onclick="window.cmpClearResolutionAttach()" title="ہٹائیں"><i class="fas fa-times"></i></button></div>';
        }
    };
    reader.readAsDataURL(file);
};

window.cmpClearResolutionAttach = function () {
    window._cmpResolutionState.attachment = null;
    var fileEl = document.getElementById('cmp-res-attachment');
    if (fileEl) fileEl.value = '';
    var prev = document.getElementById('cmp-res-attach-preview');
    if (prev) prev.innerHTML = '';
};

window.cmpOpenResolutionModal = async function (id) {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('complaints', 'edit')) return;
    var r = await window.CmpIDB.getById(id);
    if (!r) return;
    if (!window.cmpCanViewConfidentialComplaint(r)) {
        if (typeof window.showToast === 'function') window.showToast('یہ خفیہ شکایت دیکھنے کی اجازت نہیں', 'error');
        return;
    }
    if (!window.cmpCanShowResolutionBtn(r)) {
        if (typeof window.showToast === 'function') window.showToast('کارروائی کی اجازت نہیں — صرف منتظم یا ذمہ دار', 'error');
        return;
    }
    window.cmpNormalizeComplaint(r);
    window._cmpResolutionState.complaintId = id;
    window.cmpResetResolutionForm();

    var actor = window.cmpGetCurrentActor();
    var actorEl = document.getElementById('cmp-res-actor');
    if (actorEl) actorEl.value = actor.name;

    var complainant = r.individual || r.type || '—';
    var nature = (r.category || 'عمومی') + ' • ' + (r.type || '—');

    var summary = document.getElementById('cmp-resolution-summary');
    if (summary) {
        summary.innerHTML =
            '<div class="cmp-res-section"><h4><i class="fas fa-file-alt"></i> شکایت کا خلاصہ (صرف مطالعہ)</h4>' +
            '<div class="cmp-detail-grid">' +
                '<div><span>شکایت ID</span><b dir="ltr">' + cmpEsc(r.id) + '</b></div>' +
                '<div><span>شاکی / متعلقہ فرد</span><b>' + cmpEsc(complainant) + '</b></div>' +
                '<div><span>نوعیت</span><b>' + cmpEsc(nature) + '</b></div>' +
                '<div><span>موجودہ حالت</span><b>' + window.cmpStatusBadge(r.status) + '</b></div>' +
            '</div>' +
            '<div class="cmp-res-details-box"><label>تفصیلی مسئلہ</label><p>' + cmpEsc(r.details || '—') + '</p></div></div>';
    }

    var timeline = document.getElementById('cmp-resolution-timeline');
    if (timeline) {
        timeline.innerHTML = '<div class="cmp-res-section"><h4><i class="fas fa-history"></i> کارروائی کی تاریخ (Timeline)</h4>' +
            '<div class="cmp-timeline">' + window.cmpRenderResolutionTimeline(r) + '</div></div>';
    }

    if (typeof window.openModal === 'function') window.openModal('cmp-resolution-modal');
};

window.cmpSaveResolution = async function () {
    var id = window._cmpResolutionState.complaintId;
    if (!id) return;
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('complaints', 'edit')) return;

    var statusKey = (document.getElementById('cmp-res-status') || {}).value || 'in_progress';
    var remarks = ((document.getElementById('cmp-res-remarks') || {}).value || '').trim();
    var resDate = (document.getElementById('cmp-res-date') || {}).value || new Date().toISOString().slice(0, 10);

    if (!remarks) {
        if (typeof window.showToast === 'function') window.showToast('کارروائی / تبصرہ لکھنا لازمی ہے', 'warning');
        return;
    }

    var r = await window.CmpIDB.getById(id);
    if (!r) return;
    if (!window.cmpCanViewConfidentialComplaint(r)) {
        if (typeof window.showToast === 'function') window.showToast('یہ خفیہ شکایت میں ترمیم کی اجازت نہیں', 'error');
        return;
    }
    window.cmpNormalizeComplaint(r);

    var actor = window.cmpGetCurrentActor();
    var now = Date.now();
    var entry = {
        date: resDate,
        updatedAt: now,
        updatedBy: actor.name,
        updatedById: actor.uid,
        status_change: statusKey,
        remarks: remarks
    };
    if (window._cmpResolutionState.attachment) {
        entry.attachment = window._cmpResolutionState.attachment;
    }

    r.resolutionHistory.push(entry);
    r.statusKey = statusKey;
    r.status = window.cmpStatusKeyToUr(statusKey);
    r.lastResolutionAt = now;
    r.timestamp = now;

    r.history = r.history || [];
    r.history.push({
        at: now,
        action: 'کارروائی: ' + (window.CMP_STATUS_KEYS[statusKey] ? window.CMP_STATUS_KEYS[statusKey].labelUr : statusKey),
        by: actor.name,
        note: remarks
    });

    await window.CmpIDB.save(r);
    await window.syncComplaintsToCloud(r);

    if (typeof window.showToast === 'function') {
        window.showToast('کارروائی محفوظ — حالت: ' + r.status, 'success');
    }

    if (typeof window.closeModal === 'function') window.closeModal('cmp-resolution-modal');
    window._cmpResolutionState.complaintId = null;
    window.cmpResetResolutionForm();

    await window.renderComplaintsTable();
    if (typeof window.renderComplaintsDashboard === 'function') {
        var dashPanel = document.getElementById('cmp-dashboard');
        if (dashPanel && dashPanel.style.display !== 'none') {
            await window.renderComplaintsDashboard();
        }
    }
    if (typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
};

// =========================================================
// تفصیلی نظارہ + lifecycle workflow + مکمل تاریخ (مرحلہ 4)
// =========================================================
window.openComplaintDetail = async function (id) {
    var r = await window.CmpIDB.getById(id);
    if (!r) return;
    if (!window.cmpCanViewConfidentialComplaint(r)) {
        if (typeof window.showToast === 'function') window.showToast('یہ خفیہ شکایت دیکھنے کی اجازت نہیں', 'error');
        return;
    }
    var body = document.getElementById('cmp-detail-body');
    if (!body) return;

    var rel = [];
    if (r.dept) rel.push('شعبہ: ' + r.dept);
    if (r.classLevel) rel.push('درجہ: ' + r.classLevel);
    if (r.individual) rel.push('فرد: ' + r.individual);

    var atts = (r.attachments || []).map(function (a) {
        if (a.type && a.type.indexOf('image') === 0)
            return '<a href="' + a.data + '" target="_blank" class="cmp-att-link"><img src="' + a.data + '" alt="' + cmpEsc(a.name) + '"></a>';
        return '<a href="' + a.data + '" download="' + cmpEsc(a.name) + '" class="cmp-att-link cmp-att-file"><i class="fas fa-file-alt"></i> ' + cmpEsc(a.name) + '</a>';
    }).join('');

    var timeline = (r.history || []).slice().reverse().map(function (h) {
        var d = new Date(h.at);
        var when = d.toLocaleDateString('ur-PK') + ' ' + d.toLocaleTimeString('ur-PK', { hour: '2-digit', minute: '2-digit' });
        return '<div class="cmp-tl-item"><div class="cmp-tl-dot"></div><div class="cmp-tl-content">' +
            '<div class="cmp-tl-action">' + cmpEsc(h.action) + (h.note ? ' — <span style="color:#64748b;">' + cmpEsc(h.note) + '</span>' : '') + '</div>' +
            '<div class="cmp-tl-meta">' + cmpEsc(when) + ' • ' + cmpEsc(h.by || '') + '</div></div></div>';
    }).join('') || '<p style="color:#94a3b8;">کوئی تاریخ موجود نہیں</p>';

    var statuses = ['زیرِ غور', 'ذمہ دار کے پاس', 'کارروائی جاری', 'حل شدہ', 'بند شدہ'];
    var canResolve = window.cmpCanShowResolutionBtn(r);
    var statusBtns = canResolve ? statuses.map(function (s) {
        var activeNow = (r.status === s);
        return '<button class="btn btn-sm ' + (activeNow ? 'btn-primary' : 'btn-outline') + '" onclick="window.cmpSetStatus(\'' + r.id + '\',\'' + s + '\')">' + s + '</button>';
    }).join('') : '';
    var statusSection = canResolve
        ? '<div class="cmp-detail-section"><h4>حالت تبدیل کریں</h4><div class="cmp-status-actions">' + statusBtns + '</div>' +
            '<button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="window.closeModal(\'cmp-detail-modal\'); window.cmpOpenResolutionModal(\'' + r.id + '\')"><i class="fas fa-gavel"></i> مکمل کارروائی ماڈل</button></div>' +
          '<div class="cmp-detail-section"><h4>جواب / پیش رفت درج کریں</h4>' +
            '<textarea id="cmp-response-note" class="input-control" rows="2" placeholder="جواب، پیش رفت یا تبصرہ لکھیں..."></textarea>' +
            '<button class="btn btn-success btn-sm" style="margin-top:8px;" onclick="window.cmpAddResponse(\'' + r.id + '\')"><i class="fas fa-reply"></i> جواب محفوظ کریں</button></div>'
        : '';

    body.innerHTML =
        '<div class="cmp-detail-head">' +
            '<div>' + window.cmpPriorityBadge(r.priority) + ' ' + window.cmpStatusBadge(r.status) + ' <span class="cmp-cat-tag">' + cmpEsc(r.category || 'عمومی') + '</span>' +
            (r.strictlyConfidential ? ' <span class="cmp-badge" style="background:#f3e8ff;color:#7c3aed;border:1px solid #c4b5fd;"><i class="fas fa-user-secret"></i> انتہائی خفیہ</span>' : '') +
            '</div>' +
            '<div style="color:#64748b; font-size:12px;">ID: ' + cmpEsc(r.id) + '</div>' +
        '</div>' +
        '<div class="cmp-detail-grid">' +
            '<div><span>تاریخ</span><b>' + cmpEsc(r.date) + '</b></div>' +
            '<div><span>کس کے خلاف</span><b>' + cmpEsc(r.type) + '</b></div>' +
            '<div><span>متعلقہ</span><b>' + (rel.length ? cmpEsc(rel.join(' • ')) : 'عمومی') + '</b></div>' +
            '<div><span>ذمہ دار</span><b>' + (r.assignedTo ? cmpEsc(r.assignedTo) : '—') + '</b></div>' +
            '<div><span>مقررہ مدت</span><b>' + (r.dueDate ? cmpEsc(r.dueDate) : '—') + '</b></div>' +
        '</div>' +
        '<div class="cmp-detail-section"><h4>تفصیل</h4><p style="white-space:pre-wrap;">' + cmpEsc(r.details) + '</p></div>' +
        (atts ? '<div class="cmp-detail-section"><h4>منسلکات</h4><div class="cmp-att-grid">' + atts + '</div></div>' : '') +
        statusSection +
        '<div class="cmp-detail-section"><h4>مکمل تاریخ (Timeline)</h4><div class="cmp-timeline">' + timeline + '</div></div>';

    if (typeof window.openModal === 'function') window.openModal('cmp-detail-modal');
};

async function cmpPushHistoryAndSave(id, action, note) {
    var r = await window.CmpIDB.getById(id);
    if (!r) return null;
    var actor = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && (firebase.auth().currentUser.email || firebase.auth().currentUser.uid)) || 'سسٹم';
    r.history = r.history || [];
    r.history.push({ at: new Date().getTime(), action: action, by: actor, note: note || '' });
    r.timestamp = new Date().getTime();
    return r;
}

window.cmpSetStatus = async function (id, status) {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('complaints', 'edit')) return;
    var r = await cmpPushHistoryAndSave(id, 'حالت: ' + status, '');
    if (!r) return;
    r.status = status;
    r.statusKey = window.cmpUrToStatusKey(status);
    await window.CmpIDB.save(r);
    await window.syncComplaintsToCloud(r);
    if (typeof window.showToast === 'function') window.showToast('حالت تبدیل: ' + status, 'success');
    await window.openComplaintDetail(id);
    await window.renderComplaintsTable();
    if (typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
};

window.cmpAddResponse = async function (id) {
    var ta = document.getElementById('cmp-response-note');
    var note = ta ? ta.value.trim() : '';
    if (!note) { if (typeof window.showToast === 'function') window.showToast('براہ کرم جواب لکھیں', 'warning'); return; }
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('complaints', 'edit')) return;
    var r = await cmpPushHistoryAndSave(id, 'جواب درج', note);
    if (!r) return;
    await window.CmpIDB.save(r);
    await window.syncComplaintsToCloud(r);
    if (typeof window.showToast === 'function') window.showToast('جواب محفوظ ہو گیا', 'success');
    await window.openComplaintDetail(id);
};

// =========================================================
// شماریات + تصویری خاکے (مرحلہ 5)
// =========================================================
window.renderComplaintsDashboard = async function () {
    if (typeof window.emsIsComplaintsModuleActive === 'function' && !window.emsIsComplaintsModuleActive()) return;
    var box = document.getElementById('cmp-dash-content');
    if (!box) return;
    var all = await window.CmpIDB.getAll();
    all = window.cmpFilterConfidentialRecords(all);
    all = window.cmpFilterRecordsForRole(all);
    if (!all.length) { box.innerHTML = '<p style="color:#94a3b8;">ابھی کوئی شکایت درج نہیں ہوئی۔</p>'; return; }

    var statusColors = {
        'نئی': '#2563eb', 'زیرِ غور': '#7c3aed', 'ذمہ دار کے پاس': '#0891b2',
        'کارروائی جاری': '#d97706', 'حل شدہ': '#16a34a', 'بند شدہ': '#64748b',
        'مسترد': '#b91c1c', 'مزید معلومات درکار': '#7c3aed'
    };
    var statusSegs = Object.keys(statusColors).map(function (s) {
        return { label: s, value: all.filter(function (r) { return (r.status || 'نئی') === s; }).length, color: statusColors[s] };
    }).filter(function (s) { return s.value > 0; });

    var prioColors = { 'فوری': '#dc2626', 'اہم': '#d97706', 'معمولی': '#16a34a' };
    var prioSegs = Object.keys(prioColors).map(function (p) {
        return { label: p, value: all.filter(function (r) { return (r.priority || 'معمولی') === p; }).length, color: prioColors[p] };
    }).filter(function (s) { return s.value > 0; });

    var cats = {};
    all.forEach(function (r) { var c = r.category || 'عمومی'; cats[c] = (cats[c] || 0) + 1; });
    var catItems = Object.keys(cats).map(function (c) { return { label: c, value: cats[c] }; }).sort(function (a, b) { return b.value - a.value; });

    // پچھلے 6 ماہ کا رجحان
    var months = [];
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        var label = d.toLocaleDateString('ur-PK', { month: 'short' });
        months.push({ key: key, label: label, value: all.filter(function (r) { return (r.date || '').substring(0, 7) === key; }).length });
    }

    var resolved = all.filter(function (r) {
        return window.cmpIsResolvedRecord(r);
    }).length;
    var resolveRate = Math.round((resolved / all.length) * 100);

    var donut = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(statusSegs, all.length, 'کل شکایات') : '';
    var prioDonut = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(prioSegs, prioSegs.reduce(function(s,x){return s+x.value;},0), 'ترجیح') : '';
    var catBar = (typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(catItems) : '';
    var line = (typeof window.emsLineChartSVG === 'function') ? window.emsLineChartSVG(months, '#dc2626') : '';
    var progress = (typeof window.emsProgressSVG === 'function') ? window.emsProgressSVG(resolveRate, '#16a34a', 'حل شدہ شرح') : '';

    box.innerHTML =
        '<div class="cmp-dash-grid">' +
            '<div class="cmp-dash-card"><h4>حالت کے لحاظ سے</h4>' + donut + '</div>' +
            '<div class="cmp-dash-card"><h4>ترجیح کے لحاظ سے</h4>' + prioDonut + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>نوعیت کے لحاظ سے</h4>' + catBar + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>ماہانہ رجحان (6 ماہ)</h4>' + line + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>کارکردگی</h4>' + progress + '</div>' +
        '</div>';
};

// =========================================================
// 4. ایونٹ لسنرز (Initialization & Actions)
// =========================================================
function cmpBindModuleListeners() {
    if (window._cmpListenersBound) return;
    window._cmpListenersBound = true;

    if (typeof window.cmpApplyRoleUi === 'function') window.cmpApplyRoleUi();

    const cmpDateInput = document.getElementById('cmp-date');
    if(cmpDateInput) cmpDateInput.valueAsDate = new Date();

    const btnCancelCmpEdit = document.getElementById('btn-cancel-cmp-edit');
    if(btnCancelCmpEdit) {
        btnCancelCmpEdit.addEventListener('click', (e) => {
            e.preventDefault();
            window.resetComplaintForm();
            if(typeof window.showToast === 'function') window.showToast("شکایت کی ترمیم منسوخ کر دی گئی۔", "warning");
        });
    }

    const btnSaveComplaint = document.getElementById('btn-save-complaint');
    if (btnSaveComplaint) {
        btnSaveComplaint.addEventListener('click', async () => {
            const gv = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
            const date = gv('cmp-date');
            const category = gv('cmp-category-select');
            const type = gv('cmp-type-select');
            const priority = gv('cmp-priority-select') || 'معمولی';
            const status = gv('cmp-status-select') || 'نئی';
            const dept = gv('cmp-dept-select');
            const classLevel = gv('cmp-class-select');
            const dueDate = gv('cmp-due-date');
            const individualSelect = document.getElementById('cmp-individual-select');
            const individual = (individualSelect && individualSelect.value) ? individualSelect.options[individualSelect.selectedIndex].text : '';
            const individualId = individualSelect ? individualSelect.value : '';
            const assignSelect = document.getElementById('cmp-assign-select');
            const assignedTo = (assignSelect && assignSelect.value) ? assignSelect.options[assignSelect.selectedIndex].text : '';
            const assignedToId = assignSelect ? assignSelect.value : '';
            const details = (gv('cmp-details-textarea') || '').trim();
            const confEl = document.getElementById('cmp-strictly-confidential');
            const strictlyConfidential = !!(confEl && confEl.checked);

            if (!date || !details) {
                if(typeof window.showToast === 'function') window.showToast("تاریخ اور شکایت کی تفصیل لکھنا لازمی ہے!", "error");
                return;
            }
            if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('complaints', window.currentEditingCmpId ? 'edit' : 'create')) return;
            if (strictlyConfidential && !assignedToId) {
                if (typeof window.showToast === 'function') {
                    window.showToast('انتہائی خفیہ شکایت کے لیے ذمہ دار منتخب کرنا لازمی ہے', 'warning');
                }
                return;
            }

            let targetText = [];
            if(dept) targetText.push(`شعبہ: ${dept}`);
            if(classLevel) targetText.push(`درجہ: ${classLevel}`);
            if(individual) targetText.push(`فرد: ${individual}`);
            let finalTarget = targetText.length > 0 ? targetText.join(' | ') : 'عمومی (General)';

            var actor = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && (firebase.auth().currentUser.email || firebase.auth().currentUser.uid)) || 'سسٹم';
            var actorInfo = window.cmpGetCurrentActor();
            var creatorStaffId = window.cmpGetCurrentStaffId();
            var now = new Date().getTime();
            var isEdit = !!window.currentEditingCmpId;

            // موجودہ ریکارڈ (تاکہ تاریخ + تبدیلیاں محفوظ رہیں)
            var existing = isEdit ? await window.CmpIDB.getById(window.currentEditingCmpId) : null;
            var history = (existing && existing.history) ? existing.history.slice() : [];

            if (isEdit && existing) {
                var changes = [];
                [['status','حالت'],['priority','ترجیح'],['category','نوعیت'],['assignedTo','ذمہ دار'],['dueDate','مقررہ مدت'],['details','تفصیل']].forEach(function (p) {
                    var key = p[0];
                    var oldV = (key === 'assignedTo') ? (existing.assignedTo || '') : (existing[key] || '');
                    var newV = ({ status: status, priority: priority, category: category, assignedTo: assignedTo, dueDate: dueDate, details: details })[key] || '';
                    if (String(oldV) !== String(newV)) changes.push(p[1]);
                });
                if (!!existing.strictlyConfidential !== strictlyConfidential) changes.push('خفیہ');
                history.push({ at: now, action: 'ترمیم', by: actor, note: changes.length ? ('تبدیل: ' + changes.join('، ')) : 'معمولی ترمیم' });
            } else {
                history.push({ at: now, action: 'درج ہوئی', by: actor, note: strictlyConfidential ? 'شکایت کا اندراج (انتہائی خفیہ)' : 'شکایت کا اندراج' });
                if (status && status !== 'نئی') history.push({ at: now, action: 'حالت: ' + status, by: actor, note: '' });
                if (assignedTo) history.push({ at: now, action: 'تفویض', by: actor, note: 'ذمہ دار: ' + assignedTo });
            }

            let complaintRecord = {
                id: window.currentEditingCmpId || window.generateID('CMP'),
                date: date,
                category: category,
                type: type,
                priority: priority,
                status: status,
                statusKey: window.cmpUrToStatusKey(status),
                dept: dept,
                classLevel: classLevel,
                individualId: individualId,
                individual: individual,
                assignedToId: assignedToId,
                assignedTo: assignedTo,
                dueDate: dueDate,
                target: finalTarget,
                details: details,
                strictlyConfidential: strictlyConfidential,
                attachments: (window._cmpAttachments || []).slice(),
                history: history,
                resolutionHistory: (existing && existing.resolutionHistory) ? existing.resolutionHistory.slice() : [],
                createdById: (existing && existing.createdById) || creatorStaffId || actorInfo.uid || '',
                createdBy: (existing && existing.createdBy) || actorInfo.name || actor,
                recordedBy: (existing && existing.recordedBy) || actorInfo.name || actor,
                createdAt: (existing && existing.createdAt) || now,
                timestamp: now
            };

            window.cmpNormalizeComplaint(complaintRecord);

            if (typeof window.emsStampDepartment === 'function') {
                window.emsStampDepartment(complaintRecord);
            }

            await window.CmpIDB.save(complaintRecord);
            await window.syncComplaintsToCloud(complaintRecord);

            if(typeof window.showToast === 'function') {
                window.showToast(isEdit ? "شکایت کامیابی کے ساتھ اپڈیٹ کر دی گئی!" : "شکایت کامیابی کے ساتھ درج کر لی گئی!", "success");
            }

            window.resetComplaintForm();
            var listBtn = document.querySelector('#cmp-ribbon-menu [onclick*="cmp-list"]');
            window.switchCmpTab('cmp-list', listBtn);
            if(typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
        });
    }

    setTimeout(async function () {
        if (typeof window.emsIsComplaintsModuleActive === 'function' && !window.emsIsComplaintsModuleActive()) return;

        var localData = await window.CmpIDB.getAll();
        if (localData.length === 0 && typeof firebase !== 'undefined' && firebase.auth && window.EMS_OFFLINE_ONLY !== true) {
            firebase.auth().onAuthStateChanged(async function (user) {
                if (user && typeof window.emsIsComplaintsModuleActive === 'function' && window.emsIsComplaintsModuleActive()) {
                    await window.syncComplaintsFromCloud(false);
                }
            });
        }
    }, 300);
}

if (typeof window.emsRunWhenDomReady === 'function') {
    window.emsRunWhenDomReady(cmpBindModuleListeners);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cmpBindModuleListeners, { once: true });
} else {
    cmpBindModuleListeners();
}

if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('complaints', function () {
        if (typeof window.emsIsComplaintsModuleActive === 'function' && !window.emsIsComplaintsModuleActive()) return;
        if (typeof window.cmpApplyRoleUi === 'function') window.cmpApplyRoleUi();
        window._cmpDropdownGen = -1;
        if (typeof window.renderComplaintsTable === 'function') window.renderComplaintsTable();
    });
}