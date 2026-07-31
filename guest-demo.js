// ============================================================================
// EMS Guest Demo Environment — isolated demo data + session overlay (Phase 1)
// Canonical data in Demo_* Firestore collections (SA publish).
// Guest CRUD → sessionStorage only; refresh/logout clears overlay.
// ============================================================================
(function (global) {
    'use strict';

    var OVERLAY_KEY = 'ems_guest_demo_overlay';
    var COLLECTIONS = ['Students', 'Attendance', 'Fees', 'Exams', 'Reports'];

    var DEFAULT_DEMO = {
        Students: [
            { id: 'STD-D01', name: 'احمد علی', cls: 'حفظ', father: 'محمد علی', status: 'فعال' },
            { id: 'STD-D02', name: 'فاطمہ زہرا', cls: 'ناظرہ', father: 'عبداللہ', status: 'فعال' },
            { id: 'STD-D03', name: 'عمر فاروق', cls: 'درس نظامی', father: 'فاروق احمد', status: 'فعال' }
        ],
        Attendance: [
            { id: 'ATT-D01', studentId: 'STD-D01', date: '2026-06-18', status: 'حاضر' },
            { id: 'ATT-D02', studentId: 'STD-D02', date: '2026-06-18', status: 'غائب' }
        ],
        Fees: [
            { id: 'FEE-D01', studentId: 'STD-D01', month: 'جون 2026', amount: 3000, status: 'ادا شدہ' },
            { id: 'FEE-D02', studentId: 'STD-D03', month: 'جون 2026', amount: 2500, status: 'باقی' }
        ],
        Exams: [
            { id: 'EXM-D01', title: 'ماہانہ امتحان', studentId: 'STD-D01', marks: 85, grade: 'A' },
            { id: 'EXM-D02', title: 'ماہانہ امتحان', studentId: 'STD-D02', marks: 72, grade: 'B' }
        ],
        Reports: [
            { id: 'RPT-D01', title: 'حاضری رپورٹ', period: 'جون 2026', summary: 'کل حاضری 92%' },
            { id: 'RPT-D02', title: 'فیس رپورٹ', period: 'جون 2026', summary: 'وصولی 78%' }
        ]
    };

    function firestoreCollectionName(name) {
        return 'Demo_' + name;
    }

    function loadOverlay() {
        try {
            var raw = sessionStorage.getItem(OVERLAY_KEY);
            return raw ? JSON.parse(raw) : { creates: {}, updates: {}, deletes: {} };
        } catch (e) {
            return { creates: {}, updates: {}, deletes: {} };
        }
    }

    function saveOverlay(overlay) {
        try {
            sessionStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
        } catch (e) { /* ignore */ }
    }

    global.emsGuestClearOverlay = function () {
        try { sessionStorage.removeItem(OVERLAY_KEY); } catch (e) { /* ignore */ }
    };

    function mergeList(collection, canonical) {
        var overlay = loadOverlay();
        var deletes = overlay.deletes[collection] || [];
        var updates = overlay.updates[collection] || {};
        var creates = overlay.creates[collection] || {};
        var map = {};

        (canonical || []).forEach(function (item) {
            if (deletes.indexOf(item.id) >= 0) return;
            map[item.id] = updates[item.id] ? Object.assign({}, item, updates[item.id]) : item;
        });

        Object.keys(creates).forEach(function (id) {
            if (deletes.indexOf(id) >= 0) return;
            map[id] = creates[id];
        });

        return Object.keys(map).map(function (k) { return map[k]; });
    }

    global.emsGuestFetchCollection = function (collection) {
        var db = global.getDbOrNull && global.getDbOrNull();
        var fsName = firestoreCollectionName(collection);

        function fromDefault() {
            return Promise.resolve(DEFAULT_DEMO[collection] || []);
        }

        if (!db) {
            return fromDefault().then(function (list) {
                return mergeList(collection, list);
            });
        }

        return db.collection(fsName).get().then(function (snap) {
            if (snap.empty) return fromDefault();
            return snap.docs.map(function (d) {
                var data = d.data();
                data.id = data.id || d.id;
                return data;
            });
        }).catch(function () {
            return fromDefault();
        }).then(function (list) {
            return mergeList(collection, list);
        });
    };

    global.emsGuestSaveItem = function (collection, item) {
        if (!item || !item.id) {
            item = item || {};
            item.id = 'G-' + Date.now().toString(36).toUpperCase();
        }
        var overlay = loadOverlay();
        if (!overlay.creates[collection]) overlay.creates[collection] = {};
        if (!overlay.updates[collection]) overlay.updates[collection] = {};
        var canonicalIds = (DEFAULT_DEMO[collection] || []).map(function (x) { return x.id; });
        if (canonicalIds.indexOf(item.id) >= 0 || overlay.creates[collection][item.id]) {
            overlay.updates[collection][item.id] = item;
        } else {
            overlay.creates[collection][item.id] = item;
        }
        saveOverlay(overlay);
        return item.id;
    };

    global.emsGuestDeleteItem = function (collection, id) {
        var overlay = loadOverlay();
        if (!overlay.deletes[collection]) overlay.deletes[collection] = [];
        if (overlay.deletes[collection].indexOf(id) < 0) {
            overlay.deletes[collection].push(id);
        }
        if (overlay.creates[collection]) delete overlay.creates[collection][id];
        if (overlay.updates[collection]) delete overlay.updates[collection][id];
        saveOverlay(overlay);
    };

    /** Super Admin: publish canonical demo dataset to Firestore */
    global.emsPublishDemoDataset = function () {
        var db = global.getDbOrNull && global.getDbOrNull();
        if (!db) return Promise.reject(new Error('Firestore دستیاب نہیں'));
        if (!global.isSuperAdmin || !global.isSuperAdmin()) {
            return Promise.reject(new Error('صرف Super Admin'));
        }

        var batch = db.batch();
        var count = 0;

        COLLECTIONS.forEach(function (col) {
            var items = DEFAULT_DEMO[col] || [];
            items.forEach(function (item) {
                var ref = db.collection(firestoreCollectionName(col)).doc(item.id);
                batch.set(ref, item, { merge: true });
                count++;
            });
        });

        var metaRef = db.collection('Demo_Meta').doc('published');
        batch.set(metaRef, {
            version: '1.0',
            publishedAt: Date.now(),
            publishedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'superadmin',
            collections: COLLECTIONS
        }, { merge: true });

        return batch.commit().then(function () {
            return { ok: true, count: count };
        });
    };

    function esc(s) {
        if (global.EmsUtils && global.EmsUtils.sanitize) return global.EmsUtils.sanitize(String(s == null ? '' : s));
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderTable(collection, items, columns) {
        if (!items.length) {
            return '<tr><td colspan="' + columns.length + '" style="text-align:center;color:#94a3b8;">کوئی ڈیٹا نہیں</td></tr>';
        }
        return items.map(function (row) {
            var cells = columns.map(function (c) {
                return '<td>' + esc(row[c.key] || '—') + '</td>';
            }).join('');
            return '<tr>' + cells +
                '<td><button type="button" class="btn btn-danger btn-sm" onclick="window.emsGuestDeleteRow(\'' + collection + '\',\'' + esc(row.id) + '\')"><i class="fas fa-trash"></i></button></td>' +
                '</tr>';
        }).join('');
    }

    global.emsGuestDeleteRow = function (collection, id) {
        global.emsGuestDeleteItem(collection, id);
        global.emsGuestRenderDemo();
    };

    global.emsGuestAddRow = function (collection) {
        var fields = {
            Students: { name: 'نیا طالب علم', cls: '—', father: '—', status: 'فعال' },
            Attendance: { studentId: 'STD-D01', date: new Date().toISOString().slice(0, 10), status: 'حاضر' },
            Fees: { studentId: 'STD-D01', month: 'جون 2026', amount: 2000, status: 'باقی' },
            Exams: { title: 'نیا امتحان', studentId: 'STD-D01', marks: 0, grade: '—' },
            Reports: { title: 'نئی رپورٹ', period: '2026', summary: '—' }
        };
        var base = fields[collection] || { title: 'نیا' };
        base.id = 'G-' + Date.now().toString(36).toUpperCase();
        global.emsGuestSaveItem(collection, base);
        global.emsGuestRenderDemo();
    };

    global.emsGuestRenderDemo = function () {
        var root = document.getElementById('ems-guest-demo-content');
        if (!root) return;

        var activeTab = root.getAttribute('data-active-tab') || 'Students';
        var configs = {
            Students: { cols: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'نام' }, { key: 'cls', label: 'جماعت' }, { key: 'status', label: 'حالت' }] },
            Attendance: { cols: [{ key: 'studentId', label: 'طالب علم' }, { key: 'date', label: 'تاریخ' }, { key: 'status', label: 'حاضری' }] },
            Fees: { cols: [{ key: 'studentId', label: 'طالب علم' }, { key: 'month', label: 'ماہ' }, { key: 'amount', label: 'رقم' }, { key: 'status', label: 'حالت' }] },
            Exams: { cols: [{ key: 'title', label: 'امتحان' }, { key: 'studentId', label: 'طالب علم' }, { key: 'marks', label: 'نمبر' }, { key: 'grade', label: 'گریڈ' }] },
            Reports: { cols: [{ key: 'title', label: 'رپورٹ' }, { key: 'period', label: 'مدت' }, { key: 'summary', label: 'خلاصہ' }] }
        };

        var tabsHtml = COLLECTIONS.map(function (c) {
            var active = c === activeTab ? ' active' : '';
            return '<button type="button" class="ems-guest-tab' + active + '" onclick="window.emsGuestSwitchTab(\'' + c + '\')">' + c + '</button>';
        }).join('');

        root.innerHTML =
            '<div class="ems-guest-banner">' +
            '<i class="fas fa-flask"></i> <strong>مہمان ڈیمو ماحول</strong> — تبدیلیاں عارضی ہیں؛ refresh/logout پر ختم ہو جائیں گی۔' +
            '</div>' +
            '<div class="ems-guest-tabs">' + tabsHtml + '</div>' +
            '<div id="ems-guest-table-wrap"><p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p></div>';

        global.emsGuestFetchCollection(activeTab).then(function (items) {
            var cfg = configs[activeTab];
            var wrap = document.getElementById('ems-guest-table-wrap');
            if (!wrap || !cfg) return;
            var head = cfg.cols.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '<th>عمل</th>';
            wrap.innerHTML =
                '<div style="margin-bottom:12px;">' +
                '<button type="button" class="btn btn-success btn-sm" onclick="window.emsGuestAddRow(\'' + activeTab + '\')"><i class="fas fa-plus"></i> نیا شامل کریں</button>' +
                '</div>' +
                '<div class="table-responsive"><table class="data-table">' +
                '<thead><tr>' + head + '</tr></thead>' +
                '<tbody>' + renderTable(activeTab, items, cfg.cols) + '</tbody></table></div>';
        });
    };

    global.emsGuestSwitchTab = function (tab) {
        var root = document.getElementById('ems-guest-demo-content');
        if (root) root.setAttribute('data-active-tab', tab);
        global.emsGuestRenderDemo();
    };

    global.initGuestDemo = function () {
        global.emsGuestRenderDemo();
    };

})(window);
