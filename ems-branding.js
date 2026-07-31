// ============================================================================
// EMS Branding — مدرسہ برانڈنگ و دستخط نظام (Branding & Signature Management)
// لوگو، مہر، دستخط اور مدرسہ کی معلومات ایک بار محفوظ → دستاویزات/کارڈ میں خودکار
// Storage: localStorage (ems_branding) + Firestore (EmsDirect blob sync)
// ============================================================================
(function (global) {
    'use strict';

    var KEY = 'ems_branding';

    var FIELDS = {
        logo: '', seal: '',
        sigMohtamim: '', sigNazimTaleem: '', sigNazimDaftar: '',
        madrasaName: '', madrasaSubtitle: '', madrasaAddress: '', madrasaPhone: ''
    };

    function load() {
        try {
            var d = JSON.parse(localStorage.getItem(KEY));
            if (d && typeof d === 'object') return Object.assign({}, FIELDS, d);
        } catch (e) { /* ignore */ }
        return Object.assign({}, FIELDS);
    }

    var data = load();
    var listeners = [];
    function emit() { listeners.forEach(function (cb) { try { cb(data); } catch (e) { } }); }

    function persist() {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
        if (global.EmsDirect && global.EmsDirect.isDirectKey(KEY)) {
            try { global.EmsDirect.persist(KEY, data); } catch (e) { /* ignore */ }
        }
        emit();
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // تصویر کو ری سائز کر کے dataURL — اسٹوریج چھوٹا رکھنے کے لیے
    function fileToResizedDataURL(file, maxW, maxH) {
        return new Promise(function (resolve, reject) {
            if (!file) return reject(new Error('no file'));
            var reader = new FileReader();
            reader.onload = function (e) {
                var img = new Image();
                img.onload = function () {
                    var w = img.width, h = img.height;
                    var ratio = Math.min(maxW / w, maxH / h, 1);
                    var cw = Math.round(w * ratio), ch = Math.round(h * ratio);
                    var canvas = document.createElement('canvas');
                    canvas.width = cw; canvas.height = ch;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, cw, ch);
                    var isPng = /png/i.test(file.type);
                    resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    global.EmsBranding = {
        KEY: KEY,
        get: function () { return Object.assign({}, data); },
        field: function (k) { return data[k] || ''; },
        set: function (k, v) { data[k] = v; persist(); },
        setMany: function (obj) { Object.assign(data, obj || {}); persist(); },
        clear: function (k) { data[k] = ''; persist(); },
        onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
        reload: function () { data = load(); emit(); },
        fileToResizedDataURL: fileToResizedDataURL,

        hasAny: function () {
            return !!(data.logo || data.seal || data.sigMohtamim || data.madrasaName);
        },

        // دستاویز کا سرنامہ: لوگو اوپر دائیں + مدرسہ کا نام/پتہ
        letterHeaderHTML: function () {
            var d = data;
            var name = d.madrasaName ? esc(d.madrasaName) : 'جامعہ / مدرسہ';
            var sub = d.madrasaSubtitle ? '<div style="font-size:14px;color:#475569;margin-top:2px;">' + esc(d.madrasaSubtitle) + '</div>' : '';
            var addr = d.madrasaAddress ? '<div style="font-size:12px;color:#64748b;margin-top:4px;">' + esc(d.madrasaAddress) + '</div>' : '';
            var phone = d.madrasaPhone ? '<div style="font-size:12px;color:#64748b;font-family:Arial;">رابطہ: ' + esc(d.madrasaPhone) + '</div>' : '';
            var logo = d.logo
                ? '<img src="' + d.logo + '" style="width:78px;height:78px;object-fit:contain;">'
                : '<div style="width:78px;"></div>';
            return '' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:3px double #1f3a5f;padding-bottom:12px;margin-bottom:18px;">' +
                '<div style="width:78px;"></div>' +
                '<div style="text-align:center;flex:1;">' +
                '<div style="font-size:24px;font-weight:800;color:#1f3a5f;">' + name + '</div>' +
                sub + addr + phone +
                '</div>' +
                logo +
                '</div>';
        },

        // دستخط کا بلاک: تصویر (اگر ہو) لائن کے اوپر
        signatureBlock: function (label, sigKey, width) {
            width = width || 200;
            var img = data[sigKey]
                ? '<img src="' + data[sigKey] + '" style="max-height:48px;max-width:' + (width - 20) + 'px;object-fit:contain;margin-bottom:2px;">'
                : '<div style="height:48px;"></div>';
            return '<div style="text-align:center;width:' + width + 'px;">' +
                img +
                '<div style="border-top:1px solid #000;padding-top:4px;font-weight:600;">' + esc(label) + '</div>' +
                '</div>';
        },

        // مہر — دستاویز کے نیچے درمیان
        sealHTML: function (size) {
            size = size || 90;
            if (!data.seal) return '';
            return '<div style="text-align:center;"><img src="' + data.seal + '" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;opacity:.92;"></div>';
        }
    };

    global.addEventListener('storage', function (e) {
        if (e && e.key === KEY) global.EmsBranding.reload();
    });

    // ===================== UI Wiring (Branding Panel) =====================
    function setPreview(key) {
        var img = document.getElementById('brand-prev-' + key);
        if (!img) return;
        var ph = img.parentNode ? img.parentNode.querySelector('.brand-ph') : null;
        var val = data[key];
        if (val) { img.src = val; img.style.display = 'block'; if (ph) ph.style.display = 'none'; }
        else { img.removeAttribute('src'); img.style.display = 'none'; if (ph) ph.style.display = ''; }
    }

    var IMG_KEYS = ['logo', 'seal', 'sigMohtamim', 'sigNazimTaleem', 'sigNazimDaftar'];

    global.emsBrandLoadUI = function () {
        var f = global.EmsBranding.get();
        var map = { 'brand-name': 'madrasaName', 'brand-subtitle': 'madrasaSubtitle', 'brand-phone': 'madrasaPhone', 'brand-address': 'madrasaAddress' };
        Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = f[map[id]] || ''; });
        IMG_KEYS.forEach(setPreview);
        // برانڈنگ پینل کے تمام سیکشن کھلے رکھیں (اپلوڈ خانے چھپیں نہیں)
        var panel = document.getElementById('reg-branding-panel');
        if (panel) panel.querySelectorAll('.reg-acc-item').forEach(function (it) { it.classList.add('open'); });
    };

    global.emsBrandUpload = function (key, input) {
        var file = input && input.files && input.files[0];
        if (!file) return;
        var max = (key === 'logo' || key === 'seal') ? [320, 320] : [460, 200];
        fileToResizedDataURL(file, max[0], max[1]).then(function (durl) {
            global.EmsBranding.set(key, durl);
            setPreview(key);
            if (global.showToast) global.showToast('محفوظ ہو گیا', 'success');
        }).catch(function () {
            if (global.showToast) global.showToast('تصویر لوڈ نہ ہو سکی', 'error');
        });
        input.value = '';
    };

    global.emsBrandClear = function (key) {
        global.EmsBranding.clear(key);
        setPreview(key);
    };

    global.emsBrandSaveInfo = function () {
        var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
        global.EmsBranding.setMany({
            madrasaName: get('brand-name'),
            madrasaSubtitle: get('brand-subtitle'),
            madrasaPhone: get('brand-phone'),
            madrasaAddress: get('brand-address')
        });
        if (global.showToast) global.showToast('مدرسہ کی معلومات محفوظ ہو گئیں', 'success');
    };

    global.emsBrandPreviewLetter = function () {
        var B = global.EmsBranding;
        var today = new Date().toLocaleDateString('ur-PK');
        var content = B.letterHeaderHTML() +
            '<h3 style="text-align:center;color:#1f3a5f;margin:6px 0 14px;">تقرر نامہ (نمونہ)</h3>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:16px;font-family:Arial;"><div><strong>تاریخ:</strong> ' + today + '</div><div><strong>نمبر:</strong> SAMPLE-01</div></div>' +
            '<p style="font-size:17px;text-align:justify;line-height:2;">یہ ایک نمونہ دستاویز ہے تاکہ آپ لوگو، مہر اور دستخط کی جگہ دیکھ سکیں۔ اصل دستاویزات میں یہی برانڈنگ خودکار شامل ہوگی۔</p>' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:50px;">' +
            B.signatureBlock('دستخط ناظمِ تعلیمات', 'sigNazimTaleem') +
            B.sealHTML(90) +
            B.signatureBlock('دستخط مہتمم', 'sigMohtamim') +
            '</div>';
        var area = document.getElementById('letter-print-area');
        if (area) { area.innerHTML = content; }
        var modal = document.getElementById('letter-modal');
        if (modal) modal.style.display = 'flex';
    };

})(window);
