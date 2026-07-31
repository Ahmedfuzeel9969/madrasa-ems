// ============================================================================
// EMS ID Card — PVC شناختی کارڈ سسٹم (Front + Back + QR + Designer + Templates)
// طلبہ / اساتذہ / عملہ کے الگ ٹیمپلیٹس — Storage: ems_card_templates (Firestore sync)
// ============================================================================
(function (global) {
    'use strict';

    var KEY = 'ems_card_templates';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function defaultTemplate(type) {
        return {
            headerColor: '#1f3a5f',
            accentColor: '#f39c12',
            showLogo: true, showPhoto: true, showQR: true,
            showFatherName: true, showRole: true,
            showPhone: true, showDob: true, showBloodGroup: true, showAddress: false,
            showCnic: false, showIssue: true, showExpiry: true,
            validYears: (type === 'student' ? 2 : 3),
            backNote: 'یہ کارڈ ادارے کی ملکیت ہے۔ گم ہونے پر دفتر کو اطلاع دیں۔'
        };
    }

    function loadAll() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (d && typeof d === 'object') return d;
        } catch (e) { /* ignore */ }
        return {};
    }
    var store = loadAll();

    function persist() {
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
        if (global.EmsDirect && global.EmsDirect.isDirectKey(KEY)) {
            try { global.EmsDirect.persist(KEY, store); } catch (e) { /* ignore */ }
        }
    }

    var EmsCardTemplates = {
        get: function (type) { return Object.assign(defaultTemplate(type), store[type] || {}); },
        set: function (type, cfg) { store[type] = cfg; persist(); },
        reset: function (type) { delete store[type]; persist(); },
        reload: function () { store = loadAll(); }
    };
    global.EmsCardTemplates = EmsCardTemplates;
    global.addEventListener('storage', function (e) { if (e && e.key === KEY) EmsCardTemplates.reload(); });

    // ---------------- helpers ----------------
    function fmtDate(d) {
        if (!d) return '-';
        var dt = (d instanceof Date) ? d : new Date(d);
        if (isNaN(dt.getTime())) return esc(String(d));
        return dt.toLocaleDateString('en-GB'); // dd/mm/yyyy
    }
    function addYears(d, y) {
        var dt = (d instanceof Date) ? new Date(d) : new Date(d || Date.now());
        if (isNaN(dt.getTime())) dt = new Date();
        dt.setFullYear(dt.getFullYear() + (y || 1));
        return dt;
    }
    function roleInfo(user) {
        if (user.type === 'student') return { label: 'درجہ', value: user.class || '-' };
        if (user.type === 'teacher') return { label: 'عہدہ', value: user.designation || '-' };
        return { label: 'عہدہ', value: user.position || '-' };
    }
    function typeName(type) {
        return type === 'student' ? 'طالب علم' : type === 'teacher' ? 'استاذ' : 'عملہ';
    }
    function brand() { return global.EmsBranding ? global.EmsBranding.get() : {}; }

    // ---------------- card rendering ----------------
    function rowHTML(label, value) {
        return '<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;padding:3px 0;border-bottom:1px dotted #e2e8f0;">' +
            '<span style="color:#64748b;">' + esc(label) + '</span>' +
            '<span style="font-weight:700;color:#1e293b;font-family:Arial,sans-serif;">' + esc(value || '-') + '</span></div>';
    }

    function renderCard(user, cfg) {
        var b = brand();
        var role = roleInfo(user);
        var issue = user.date || new Date();
        var expiry = addYears(issue, cfg.validYears);
        var mName = b.madrasaName || 'جامعہ / مدرسہ';

        var logo = (cfg.showLogo && b.logo)
            ? '<img src="' + b.logo + '" style="width:34px;height:34px;object-fit:contain;background:#fff;border-radius:5px;padding:2px;">'
            : '<div style="width:34px;"></div>';

        var photoSrc = typeof window.emsGetUserPhotoSrc === 'function'
            ? window.emsGetUserPhotoSrc(user)
            : (user.photoBase64 || user.photoUrl || '');
        var photo = cfg.showPhoto
            ? '<div style="width:84px;height:104px;border:3px solid #fff;border-radius:8px;overflow:hidden;background:#eef2f6;box-shadow:0 3px 8px rgba(0,0,0,.2);">' +
            (photoSrc
                ? '<img src="' + esc(photoSrc) + '" style="width:100%;height:100%;object-fit:cover;">'
                : '<i class="fas fa-user" style="font-size:42px;color:#cbd5e1;display:flex;align-items:center;justify-content:center;height:100%;"></i>') +
            '</div>'
            : '';

        // ---------- FRONT ----------
        var front =
            '<div style="height:100%;display:flex;flex-direction:column;font-family:\'Noto Nastaliq Urdu\',sans-serif;">' +
            '<div style="background:' + cfg.headerColor + ';color:#fff;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:4px solid ' + cfg.accentColor + ';">' +
            '<div style="text-align:center;flex:1;"><div style="font-size:13px;font-weight:800;line-height:1.2;">' + esc(mName) + '</div>' +
            (b.madrasaSubtitle ? '<div style="font-size:9px;opacity:.85;">' + esc(b.madrasaSubtitle) + '</div>' : '') + '</div>' +
            logo + '</div>' +
            '<div style="background:' + cfg.accentColor + ';color:#fff;text-align:center;font-size:10px;font-weight:700;padding:2px;">' + typeName(user.type) + ' کارڈ</div>' +
            '<div style="display:flex;flex-direction:column;align-items:center;padding:12px 10px 6px;gap:8px;flex:1;">' +
            photo +
            '<div style="font-size:17px;font-weight:800;color:' + cfg.headerColor + ';text-align:center;">' + esc(user.name || '') + '</div>' +
            (cfg.showFatherName ? '<div style="font-size:11px;color:#475569;">ولدیت: <b>' + esc(user.fname || '-') + '</b></div>' : '') +
            (cfg.showRole ? '<div style="background:#f1f5f9;border-radius:20px;padding:3px 14px;font-size:12px;font-weight:700;color:' + cfg.headerColor + ';">' + esc(role.label) + ': ' + esc(role.value) + '</div>' : '') +
            '<div style="font-size:12px;font-weight:800;color:' + cfg.accentColor + ';font-family:Arial,sans-serif;letter-spacing:.5px;">ID: ' + esc(user.id || '') + '</div>' +
            '</div>' +
            (cfg.showQR ? '<div style="display:flex;justify-content:center;padding-bottom:8px;"><div id="idc-qr-box" style="width:62px;height:62px;background:#fff;padding:2px;border:1px solid #eee;border-radius:4px;"></div></div>' : '') +
            '</div>';

        // ---------- BACK ----------
        var rows = '';
        if (cfg.showDob) rows += rowHTML('تاریخ پیدائش', fmtDate(user.dob));
        if (cfg.showBloodGroup) rows += rowHTML('بلڈ گروپ', user.bloodGroup);
        if (cfg.showCnic) rows += rowHTML('شناختی نمبر', user.cnic);
        if (cfg.showPhone) rows += rowHTML('رابطہ', user.phone);
        if (cfg.showIssue) rows += rowHTML('اجراء', fmtDate(issue));
        if (cfg.showExpiry) rows += rowHTML('اختتام', fmtDate(expiry));
        if (cfg.showAddress && user.address) rows += rowHTML('پتہ', user.address);

        var sig = b.sigMohtamim
            ? '<img src="' + b.sigMohtamim + '" style="max-height:34px;max-width:90px;object-fit:contain;">'
            : '<div style="height:34px;"></div>';
        var seal = b.seal
            ? '<img src="' + b.seal + '" style="width:50px;height:50px;object-fit:contain;opacity:.9;">'
            : '';

        var back =
            '<div style="height:100%;display:flex;flex-direction:column;font-family:\'Noto Nastaliq Urdu\',sans-serif;">' +
            '<div style="background:' + cfg.headerColor + ';color:#fff;text-align:center;padding:7px;font-size:12px;font-weight:800;border-bottom:4px solid ' + cfg.accentColor + ';">تفصیلات و تصدیق</div>' +
            '<div style="padding:10px 12px;flex:1;">' + rows + '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 12px 6px;gap:6px;">' +
            seal +
            '<div style="text-align:center;">' + sig + '<div style="border-top:1px solid #000;font-size:9px;padding-top:2px;">دستخط مہتمم</div></div>' +
            '</div>' +
            '<div style="background:#f1f5f9;color:#475569;text-align:center;font-size:8.5px;padding:5px 8px;line-height:1.4;">' + esc(cfg.backNote) + '</div>' +
            '</div>';

        return { front: front, back: back, qrText: 'EMS|ID:' + (user.id || '') + '|N:' + (user.name || '') + '|T:' + user.type + '|' + role.label + ':' + role.value + '|Exp:' + fmtDate(expiry) };
    }

    var _currentUser = null;

    function paint() {
        if (!_currentUser) return;
        var cfg = EmsCardTemplates.get(_currentUser.type);
        var r = renderCard(_currentUser, cfg);
        var f = document.getElementById('idc-front');
        var bk = document.getElementById('idc-back');
        if (f) f.innerHTML = r.front;
        if (bk) bk.innerHTML = r.back;
        var badge = document.getElementById('idc-type-badge');
        if (badge) badge.textContent = typeName(_currentUser.type) + ' کارڈ';
        // QR
        if (cfg.showQR) {
            var box = document.getElementById('idc-qr-box');
            if (box && global.QRCode) {
                box.innerHTML = '';
                new QRCode(box, { text: r.qrText, width: 58, height: 58, correctLevel: QRCode.CorrectLevel.M });
            }
        }
    }

    // ---------------- public: open card (SSOT via emsGetUserById / emsRegGetRecordById) ----------------
    global.openIDCardModal = function (id) {
        if (typeof global.emsRegRequire === 'function' && !global.emsRegRequire('print', { id: id, kind: 'idcard' })) {
            return;
        }
        var openWith = function (user) {
            if (!user) { if (global.showToast) global.showToast('ریکارڈ نہیں ملا', 'error'); return; }
            _currentUser = user;
            var modal = document.getElementById('id-card-modal');
            if (modal) modal.style.display = 'flex';
            paint();
        };
        var loadFn = typeof global.emsRegGetRecordById === 'function'
            ? function (i, rej) { return global.emsRegGetRecordById(i, { fromRejected: rej }); }
            : (typeof global.emsGetUserById === 'function' ? global.emsGetUserById : null);
        if (!loadFn) {
            if (global.showToast) global.showToast('ریکارڈ لوڈ نہیں ہو سکا — ریپوزٹری تیار نہیں', 'error');
            return;
        }
        loadFn(id, false).then(function (user) {
            if (user) return openWith(user);
            return loadFn(id, true).then(openWith);
        });
    };

    // ---------------- print (front + back) ----------------
    global.emsPrintIDCard = function () {
        var f = document.getElementById('idc-front');
        var bk = document.getElementById('idc-back');
        if (!f) return;
        if (typeof global.emsRegLogAudit === 'function' && _currentUser && _currentUser.id) {
            global.emsRegLogAudit('print_idcard', _currentUser.id, {
                source: 'idcard',
                entityType: _currentUser.type || 'student'
            });
        }
        var w = global.open('', '', 'height=700,width=520');
        w.document.write('<html><head><title>ID Card</title>');
        w.document.write('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">');
        w.document.write('<style>@page{margin:8mm;} body{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;padding:10px;font-family:"Noto Nastaliq Urdu",Arial;} .pc{width:54mm;height:85.6mm;border:1px solid #ccc;border-radius:10px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.15);}</style>');
        w.document.write('</head><body>');
        w.document.write('<div class="pc">' + f.innerHTML + '</div>');
        w.document.write('<div class="pc">' + (bk ? bk.innerHTML : '') + '</div>');
        w.document.write('</body></html>');
        w.document.close();
        w.focus();
        setTimeout(function () { w.print(); w.close(); }, 600);
    };

    // ---------------- PDF (front + back) ----------------
    global.emsDownloadIDCardPDF = function () {
        if (!global.html2canvas || !global.jspdf) {
            if (global.showToast) global.showToast('PDF لائبریری لوڈ نہیں ہوئی', 'error');
            return;
        }
        var f = document.getElementById('idc-front');
        var bk = document.getElementById('idc-back');
        if (!f) return;
        var jsPDF = global.jspdf.jsPDF;
        var pdf = new jsPDF('p', 'mm', [60, 92]);
        html2canvas(f, { scale: 3, useCORS: true }).then(function (c1) {
            pdf.addImage(c1.toDataURL('image/png'), 'PNG', 3, 3, 54, 85.6);
            return html2canvas(bk, { scale: 3, useCORS: true });
        }).then(function (c2) {
            pdf.addPage([60, 92], 'p');
            pdf.addImage(c2.toDataURL('image/png'), 'PNG', 3, 3, 54, 85.6);
            pdf.save('IDCard-' + ((_currentUser && _currentUser.id) || 'card') + '.pdf');
        }).catch(function () {
            if (global.showToast) global.showToast('PDF بنانے میں مسئلہ', 'error');
        });
    };

    // ---------------- Card Designer ----------------
    var OPTIONS = [
        { k: 'showLogo', t: 'لوگو دکھائیں' },
        { k: 'showPhoto', t: 'تصویر دکھائیں' },
        { k: 'showQR', t: 'QR کوڈ دکھائیں' },
        { k: 'showFatherName', t: 'ولدیت' },
        { k: 'showRole', t: 'درجہ / عہدہ' },
        { k: 'showDob', t: 'تاریخ پیدائش (پشت)' },
        { k: 'showBloodGroup', t: 'بلڈ گروپ (پشت)' },
        { k: 'showCnic', t: 'شناختی نمبر (پشت)' },
        { k: 'showPhone', t: 'رابطہ (پشت)' },
        { k: 'showAddress', t: 'پتہ (پشت)' },
        { k: 'showIssue', t: 'اجراء تاریخ (پشت)' },
        { k: 'showExpiry', t: 'اختتامی تاریخ (پشت)' }
    ];

    global.openCardDesigner = function () {
        var sel = document.getElementById('cd-type');
        if (sel && _currentUser) sel.value = _currentUser.type;
        global.emsCardDesignerLoad();
        var m = document.getElementById('card-designer-modal');
        if (m) m.style.display = 'flex';
    };

    global.emsCardDesignerLoad = function () {
        var type = (document.getElementById('cd-type') || {}).value || 'student';
        var cfg = EmsCardTemplates.get(type);
        var box = document.getElementById('cd-options');
        if (!box) return;
        var toggles = OPTIONS.map(function (o) {
            return '<label class="cd-toggle"><input type="checkbox" data-k="' + o.k + '" ' + (cfg[o.k] ? 'checked' : '') + '> ' + esc(o.t) + '</label>';
        }).join('');
        box.innerHTML =
            '<div class="cd-grid">' + toggles + '</div>' +
            '<div class="form-grid" style="margin-top:14px;gap:12px;">' +
            '<div class="input-group"><label>ہیڈر رنگ</label><input type="color" id="cd-header" class="input-control" value="' + cfg.headerColor + '" style="height:42px;"></div>' +
            '<div class="input-group"><label>ایکسنٹ رنگ</label><input type="color" id="cd-accent" class="input-control" value="' + cfg.accentColor + '" style="height:42px;"></div>' +
            '<div class="input-group"><label>کارڈ مدت (سال)</label><input type="number" id="cd-years" class="input-control" min="1" max="10" value="' + cfg.validYears + '"></div>' +
            '<div class="input-group form-grid-full"><label>پشت پر نوٹ</label><input type="text" id="cd-note" class="input-control" value="' + esc(cfg.backNote) + '"></div>' +
            '</div>';
    };

    function readDesigner() {
        var type = (document.getElementById('cd-type') || {}).value || 'student';
        var cfg = EmsCardTemplates.get(type);
        document.querySelectorAll('#cd-options [data-k]').forEach(function (cb) {
            cfg[cb.getAttribute('data-k')] = cb.checked;
        });
        var hc = document.getElementById('cd-header'); if (hc) cfg.headerColor = hc.value;
        var ac = document.getElementById('cd-accent'); if (ac) cfg.accentColor = ac.value;
        var yr = document.getElementById('cd-years'); if (yr) cfg.validYears = parseInt(yr.value) || cfg.validYears;
        var nt = document.getElementById('cd-note'); if (nt) cfg.backNote = nt.value;
        return { type: type, cfg: cfg };
    }

    global.emsCardDesignerSave = function () {
        var r = readDesigner();
        EmsCardTemplates.set(r.type, r.cfg);
        if (global.showToast) global.showToast('ٹیمپلیٹ محفوظ ہو گیا', 'success');
        if (_currentUser && _currentUser.type === r.type) paint();
    };

    global.emsCardDesignerReset = function () {
        var type = (document.getElementById('cd-type') || {}).value || 'student';
        EmsCardTemplates.reset(type);
        global.emsCardDesignerLoad();
        if (_currentUser && _currentUser.type === type) paint();
        if (global.showToast) global.showToast('ڈیفالٹ بحال', 'success');
    };

})(window);
