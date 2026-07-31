// ============================================================================
// EMS Master Data — مرکزی ڈکشنری سسٹم (Central Dictionary)
// درجات، شعبے، مضامین، عہدے وغیرہ — ایک بار اندراج، پورے سسٹم میں دستیاب
// Storage: localStorage (ems_master_dictionary) + Firestore (EmsDirect blob sync)
// ============================================================================
(function (global) {
    'use strict';

    var KEY = 'ems_master_dictionary';
    var LEGACY_CLASSES = 'ems_classes';
    var listeners = [];

    // طے شدہ زمرے (categories) — قابلِ توسیع
    var SEED = {
        classes: [],        // درجات
        sections: [],       // سیکشن
        departments: [],    // شعبہ جات
        subjects: [],       // مضامین
        designations: [],   // عہدے (اساتذہ/عملہ)
        branches: [],       // شاخیں
        qualifications: [], // اسناد / تعلیمی قابلیت
        bloodGroups: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'],
        relations: ['والد', 'والدہ', 'بھائی', 'چچا', 'دادا', 'ماموں', 'سرپرست'],
        nationalities: ['پاکستانی'],
        cities: []
    };

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

    function normalizeData(d) {
        var base = clone(SEED);
        if (d && typeof d === 'object') {
            Object.keys(d).forEach(function (k) {
                if (Array.isArray(d[k])) {
                    // غیر ضروری خالی/مکرر صاف کریں
                    var seen = {}, out = [];
                    d[k].forEach(function (v) {
                        var t = String(v == null ? '' : v).trim();
                        if (t && !seen[norm(t)]) { seen[norm(t)] = 1; out.push(t); }
                    });
                    base[k] = out;
                }
            });
        }
        return base;
    }

    function migrateLegacy(base) {
        try {
            var cls = JSON.parse(localStorage.getItem(LEGACY_CLASSES));
            if (Array.isArray(cls) && cls.length && (!base.classes || !base.classes.length)) {
                base.classes = cls.filter(Boolean);
            }
        } catch (e) { /* ignore */ }
        return base;
    }

    function load() {
        try {
            var raw = JSON.parse(localStorage.getItem(KEY));
            if (raw && typeof raw === 'object') return migrateLegacy(normalizeData(raw));
        } catch (e) { /* ignore */ }
        return migrateLegacy(clone(SEED));
    }

    var data = load();

    function emit() {
        listeners.forEach(function (cb) { try { cb(data); } catch (e) { /* ignore */ } });
    }

    var _saveTimer = null;
    function persist(syncRemote) {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
        // backward compatibility: کلاسز کی پرانی key ساتھ رکھیں
        try { localStorage.setItem(LEGACY_CLASSES, JSON.stringify(data.classes || [])); } catch (e) { /* ignore */ }
        emit();
        if (syncRemote !== false && global.EmsDirect && global.EmsDirect.isDirectKey(KEY)) {
            // debounce تاکہ تیز رفتار ترامیم پر بار بار Firestore نہ لکھے
            if (_saveTimer) clearTimeout(_saveTimer);
            _saveTimer = setTimeout(function () {
                try { global.EmsDirect.persist(KEY, data); } catch (e) { /* ignore */ }
            }, 600);
        }
    }

    global.EmsMasterData = {
        KEY: KEY,

        categories: function () { return Object.keys(data); },

        getList: function (cat) { return (data[cat] || []).slice(); },

        has: function (cat, val) {
            return (data[cat] || []).some(function (x) { return norm(x) === norm(val); });
        },

        add: function (cat, val) {
            val = String(val == null ? '' : val).trim();
            if (!val) return false;
            if (!data[cat]) data[cat] = [];
            if (this.has(cat, val)) return false;
            data[cat].push(val);
            persist();
            return true;
        },

        update: function (cat, oldV, newV) {
            newV = String(newV == null ? '' : newV).trim();
            if (!newV) return false;
            var arr = data[cat] || [];
            var i = -1;
            for (var k = 0; k < arr.length; k++) { if (norm(arr[k]) === norm(oldV)) { i = k; break; } }
            if (i < 0) return false;
            // اگر نئی قدر پہلے سے موجود ہے (مختلف نام) تو پرانی ہٹا دیں
            if (norm(newV) !== norm(oldV) && this.has(cat, newV)) { arr.splice(i, 1); }
            else { arr[i] = newV; }
            persist();
            return true;
        },

        remove: function (cat, val) {
            var arr = data[cat] || [];
            for (var k = 0; k < arr.length; k++) {
                if (norm(arr[k]) === norm(val)) { arr.splice(k, 1); persist(); return true; }
            }
            return false;
        },

        search: function (cat, q) {
            q = norm(q);
            var arr = data[cat] || [];
            if (!q) return arr.slice();
            var starts = [], contains = [];
            arr.forEach(function (x) {
                var n = norm(x);
                if (n.indexOf(q) === 0) starts.push(x);
                else if (n.indexOf(q) >= 0) contains.push(x);
            });
            return starts.concat(contains);
        },

        // اجتماعی اندراج (Import سے) — کتنے نئے شامل ہوئے واپس کرے
        importValues: function (cat, vals) {
            if (!data[cat]) data[cat] = [];
            var added = 0, self = this;
            (vals || []).forEach(function (v) {
                v = String(v == null ? '' : v).trim();
                if (v && !self.has(cat, v)) { data[cat].push(v); added++; }
            });
            if (added) persist();
            return added;
        },

        onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },

        reload: function () { data = load(); emit(); }
    };

    // جب Firestore سے ڈکشنری مقامی اسٹوریج میں آئے تو دوبارہ لوڈ کریں
    global.addEventListener('storage', function (e) {
        if (e && e.key === KEY) { global.EmsMasterData.reload(); }
    });

})(window);
