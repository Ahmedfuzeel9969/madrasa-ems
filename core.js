// ============================================================================
// ایڈوانسڈ تعلیمی مینجمنٹ سسٹم - بنیادی سیٹنگز اور ٹولز (core.js)
// ============================================================================
window.EMS_DISABLE_LEGACY_ARREARS = true;
// 1. Firebase — skipped when EMS_OFFLINE_ONLY (see ems-runtime-mode.js)
let db = null;

window.emsDisableFirestoreNetwork = function () {
    try {
        var fb = typeof window !== 'undefined' ? window.firebase : undefined;
        if (!fb || !fb.apps || !fb.apps.length || typeof fb.firestore !== 'function') {
            return Promise.resolve(false);
        }
        var fs = fb.firestore();
        if (!fs || typeof fs.disableNetwork !== 'function') return Promise.resolve(false);
        return fs.disableNetwork().then(function () { return true; }).catch(function () { return false; });
    } catch (e) {
        return Promise.resolve(false);
    }
};

try {
    if (typeof window !== 'undefined' && window.EMS_OFFLINE_ONLY === true) {
        console.info('[EMS] Offline-only mode — Firebase disabled.');
        if (typeof window.emsDisableFirestoreNetwork === 'function') {
            window.emsDisableFirestoreNetwork();
        }
    } else {
    const firebaseConfig = {
        apiKey: "AIzaSyBdcP1CEpupMTGuWxHUQqsYCd1Z-qTHr7Y",
        authDomain: "madrasa-mangment-app.firebaseapp.com",
        projectId: "madrasa-mangment-app",
        storageBucket: "madrasa-mangment-app.firebasestorage.app",
        messagingSenderId: "529775229216",
        appId: "1:529775229216:web:77a1e019dae4b974e3ff45"
    };

    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        window.EMS_FIRESTORE_DB = db;
        var persistFn = typeof db.enableMultiTabIndexedDbPersistence === 'function'
            ? db.enableMultiTabIndexedDbPersistence.bind(db)
            : db.enablePersistence.bind(db);
        persistFn().catch(function (err) {
            if (err.code === 'failed-precondition') {
                console.warn("آف لائن موڈ ایک سے زیادہ ٹیبز میں نہیں چل سکتا — دوسری ٹیب بند کریں یا صرف ایک ٹیب استعمال کریں۔");
            } else if (err.code === 'unimplemented') {
                console.warn("آپ کا براؤزر آف لائن موڈ کو سپورٹ نہیں کرتا۔");
            }
        });
    } else {
        console.warn("فائر بیس SDK لوڈ نہیں ہوا۔");
    }
    }
} catch (error) {
    console.error("Firebase Error:", error);
}
// 2. ڈیٹا سنک — local SSOT only; cloud push via emsCloudEmitMutation (mutation: true)
const originalSetItem = localStorage.setItem.bind(localStorage);
const originalGetItem = localStorage.getItem.bind(localStorage);
window._emsOriginalSetItem = originalSetItem;
window._emsOriginalGetItem = originalGetItem;
window.emsSafeLocalGet = function (key) {
    return originalGetItem(key);
};
window._emsSuppressSync = false;

/** Phase C: no ambient cloud push on localStorage writes — local persist only. */
localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (window._emsSuppressSync) return;
    if (!key || (key.indexOf('ems_') !== 0 && key.indexOf('att_rec_') !== 0)) return;
    if (window.EmsCachePolicy && typeof window.EmsCachePolicy.touchKey === 'function') {
        try { window.EmsCachePolicy.touchKey(key); } catch (eTouch) { /* ignore */ }
    }
};

if (window.EmsCachePolicy && typeof window.EmsCachePolicy.wrapGetItem === 'function') {
    localStorage.getItem = window.EmsCachePolicy.wrapGetItem(originalGetItem);
}

// restoreFromCloud → backup-service.js (EmsBackupService) میں تعریف

// 3. مرکزی ٹولز اور ڈیٹا بیس کیز
window.DB = {
    users: 'ems_full_users', attendance: 'ems_full_attendance', complaints: 'ems_full_complaints',
    exams: 'ems_full_exams', fees: 'ems_full_fees', ledger: 'ems_full_ledger',
    salary: 'ems_full_salary', announcements: 'ems_full_announcements'
};

window.getData = function (collectionName) {
    if (typeof window.emsCacheGet === 'function') {
        var cached = window.emsCacheGet(collectionName, []);
        if (typeof window.emsIsCorruptData === 'function' && window.emsIsCorruptData(cached)) {
            return cached;
        }
        return Array.isArray(cached) ? cached : [];
    }
    try {
        let data = localStorage.getItem(collectionName);
        if (!data) return [];
        try {
            return JSON.parse(data);
        } catch (parseErr) {
            if (typeof window.emsDataCorruptionReport === 'function') {
                var report = window.emsDataCorruptionReport(collectionName, parseErr, data, []);
                if (report.corrupt && report.sentinel) {
                    if (typeof window.emsDataCorruptionScheduleRecover === 'function') {
                        window.emsDataCorruptionScheduleRecover(collectionName);
                    }
                    return report.sentinel;
                }
            }
            return [];
        }
    } catch (e) { return []; }
};

window.getDbOrNull = function () {
    if (typeof db !== 'undefined' && db !== null) return db;
    if (window.EMS_FIRESTORE_DB) return window.EMS_FIRESTORE_DB;
    return null;
};

/**
 * ماڈیول keys that must never auto-push to cloud (audit logs, backups, UI theme).
 */
window.EMS_MODULE_LOCAL_ONLY_KEYS = {
    'ems_sys_settings_audit': true,
    'ems_sys_config_backup': true,
    'ems_sys_theme': true,
    'ems_cache_meta': true
};

window.emsGetDirectModuleConfig = function (key) {
    if (window.EmsDirect && typeof window.EmsDirect.getKeyConfig === 'function') {
        return window.EmsDirect.getKeyConfig(key);
    }
    return null;
};

window.emsDiffArrayModuleItems = function (oldArr, newArr, idField) {
    idField = idField || 'id';
    oldArr = Array.isArray(oldArr) ? oldArr : [];
    newArr = Array.isArray(newArr) ? newArr : [];
    var oldMap = Object.create(null);
    var newMap = Object.create(null);
    var deltas = [];
    oldArr.forEach(function (it) {
        if (it && it[idField] != null) oldMap[String(it[idField])] = it;
    });
    newArr.forEach(function (it) {
        if (it && it[idField] != null) newMap[String(it[idField])] = it;
    });
    Object.keys(newMap).forEach(function (id) {
        var prev = oldMap[id];
        var next = newMap[id];
        if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
            deltas.push({ op: prev ? 'update' : 'create', itemId: id, item: next });
        }
    });
    Object.keys(oldMap).forEach(function (id) {
        if (!newMap[id]) deltas.push({ op: 'delete', itemId: id, item: null });
    });
    return deltas;
};

window.emsDiffMapModuleItems = function (oldObj, newObj) {
    oldObj = oldObj && typeof oldObj === 'object' && !Array.isArray(oldObj) ? oldObj : {};
    newObj = newObj && typeof newObj === 'object' && !Array.isArray(newObj) ? newObj : {};
    var deltas = [];
    Object.keys(newObj).forEach(function (k) {
        if (JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k])) {
            deltas.push({ op: oldObj[k] != null ? 'update' : 'create', mapKey: k, item: newObj[k] });
        }
    });
    Object.keys(oldObj).forEach(function (k) {
        if (!(k in newObj)) deltas.push({ op: 'delete', mapKey: k, item: null });
    });
    return deltas;
};

window.emsPushModuleCloudDelta = function (key, oldStr, newStr, options) {
    options = options || {};
    if (window.EMS_MODULE_LOCAL_ONLY_KEYS[key]) {
        return Promise.resolve({ status: 'local_only', key: key });
    }
    var cfg = window.emsGetDirectModuleConfig(key);
    if (!cfg) {
        return Promise.resolve({ status: 'local_only', key: key, reason: 'no_direct_config' });
    }

    var chain = Promise.resolve({ status: 'local_only', key: key, pushed: 0 });

    if (cfg.type === 'blob' || cfg.type === 'module_data_blob') {
        if (typeof window.emsCloudEmitModuleBlob !== 'function') return chain;
        return window.emsCloudEmitModuleBlob(key, newStr).then(function (res) {
            return {
                status: res && res.synced ? 'synced' : (res && res.offline ? 'offline_queued' : 'local_only'),
                key: key,
                mutation: res,
                pushed: 1
            };
        });
    }

    if (cfg.type === 'array') {
        if (typeof window.emsCloudEmitModuleItem !== 'function') return chain;
        var oldArr = [];
        var newArr = [];
        try { oldArr = JSON.parse(oldStr || '[]'); } catch (e1) { oldArr = []; }
        try { newArr = JSON.parse(newStr || '[]'); } catch (e2) { newArr = []; }
        if (options.delta && options.delta.itemId != null) {
            var d = options.delta;
            return window.emsCloudEmitModuleItem(key, d.op || 'update', d.item, d.itemId).then(function (res) {
                return { status: res && res.synced ? 'synced' : 'offline_queued', key: key, mutation: res, pushed: 1 };
            });
        }
        var deltas = window.emsDiffArrayModuleItems(oldArr, newArr, cfg.idField || 'id');
        if (!deltas.length) return chain;
        deltas.forEach(function (delta) {
            chain = chain.then(function (acc) {
                return window.emsCloudEmitModuleItem(key, delta.op, delta.item, delta.itemId).then(function (res) {
                    acc.pushed = (acc.pushed || 0) + 1;
                    acc.mutations = acc.mutations || [];
                    acc.mutations.push(res);
                    acc.status = res && res.synced ? 'synced' : 'offline_queued';
                    return acc;
                });
            });
        });
        return chain;
    }

    if (cfg.type === 'map') {
        if (typeof window.emsCloudEmitModuleMapItem !== 'function') return chain;
        var oldMap = {};
        var newMap = {};
        try { oldMap = JSON.parse(oldStr || '{}'); } catch (e3) { oldMap = {}; }
        try { newMap = JSON.parse(newStr || '{}'); } catch (e4) { newMap = {}; }
        if (options.delta && options.delta.mapKey != null) {
            var dm = options.delta;
            return window.emsCloudEmitModuleMapItem(key, dm.mapKey, dm.item, dm.op || 'update').then(function (res) {
                return { status: res && res.synced ? 'synced' : 'offline_queued', key: key, mutation: res, pushed: 1 };
            });
        }
        var mapDeltas = window.emsDiffMapModuleItems(oldMap, newMap);
        if (!mapDeltas.length) return chain;
        mapDeltas.forEach(function (delta) {
            chain = chain.then(function (acc) {
                return window.emsCloudEmitModuleMapItem(key, delta.mapKey, delta.item, delta.op).then(function (res) {
                    acc.pushed = (acc.pushed || 0) + 1;
                    acc.mutations = acc.mutations || [];
                    acc.mutations.push(res);
                    acc.status = res && res.synced ? 'synced' : 'offline_queued';
                    return acc;
                });
            });
        });
        return chain;
    }

    return chain;
};

/**
 * ماڈیول ڈیٹا محفوظ — local cache first; cloud delta when mutation/autoDelta
 * @returns Promise<{status, key, pending?}>
 */
window.emsSaveModuleData = function (key, value, options) {
    options = options || {};
    var str = (typeof value === 'string') ? value : JSON.stringify(value);
    var oldStr = originalGetItem(key);

    window._emsSuppressSync = true;
    originalSetItem.call(localStorage, key, str);
    window._emsSuppressSync = false;
    if (window.EmsCachePolicy && typeof window.EmsCachePolicy.markDirty === 'function') {
        window.EmsCachePolicy.markDirty(key);
    }

    if (options.mutation === true || options.autoDelta === true) {
        return window.emsPushModuleCloudDelta(key, oldStr, str, options);
    }

    return Promise.resolve({ status: 'local_only', key: key });
};

/** Explicit item-level save: local array + single-item cloud push. */
window.emsSaveModuleDelta = function (key, fullValue, delta, options) {
    options = Object.assign({ mutation: true, autoDelta: false, delta: delta }, options || {});
    return window.emsSaveModuleData(key, fullValue, options);
};

window.saveData = function (collectionName, data) {
    return window.emsSaveModuleData(collectionName, data);
};

window.generateID = function(prefix) {
    return prefix + '-' + Math.floor(10000 + Math.random() * 90000); 
};

window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    var safeMsg = message;
    if (typeof window.emsSanitize === 'function') {
        safeMsg = window.emsSanitize(String(message == null ? '' : message));
    } else if (window.EmsUtils && window.EmsUtils.sanitize) {
        safeMsg = window.EmsUtils.sanitize(message);
    } else {
        safeMsg = String(message == null ? '' : message);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.backgroundColor = type === 'error' ? 'var(--danger)' : (type === 'warning' ? 'var(--warning)' : 'var(--success)');
    toast.style.color = 'white';
    toast.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-triangle' : 'fa-check-circle') + '"></i> ' + safeMsg;
    toast.style.display = 'block';
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
};

window.emsRegisterServiceWorker = function () {
    if (!('serviceWorker' in navigator)) return Promise.resolve(false);
    if (location.protocol === 'file:') return Promise.resolve(false);
    return navigator.serviceWorker.register('./service-worker.js').then(function (reg) {
        if (typeof window.emsSwUpdateBind === 'function') {
            window.emsSwUpdateBind(reg);
        }
        return !!reg;
    }).catch(function (err) {
        console.warn('SW register failed:', err && err.message);
        return false;
    });
};

window.openModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) modal.style.display = 'flex';
};

window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) modal.style.display = 'none';
};

// 4. ابتدائی ڈیش بورڈ اور ماڈل کنٹرول (نیویگیشن auth.js میں مرکزی ہے)
document.addEventListener('DOMContentLoaded', function () {
    try {
        if (typeof window.emsBootMark === 'function') {
            window.emsBootMark('core-dom-ready');
        }
        if (typeof window.emsEnsureLoginShellVisible === 'function') {
            window.emsEnsureLoginShellVisible();
        }
        if (typeof window.emsRegisterServiceWorker === 'function') {
            window.emsRegisterServiceWorker();
        }
        if (window.EmsCachePolicy && typeof window.EmsCachePolicy.init === 'function') {
            window.EmsCachePolicy.init();
        }
        if (typeof window.emsCanRunEnterpriseBoot === 'function' && window.emsCanRunEnterpriseBoot()
            && typeof window.updateMasterDashboard === 'function') {
            window.updateMasterDashboard();
        }

        document.querySelectorAll('.modal-overlay .btn-secondary').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var overlay = this.closest('.modal-overlay');
                if (overlay) overlay.style.display = 'none';
            });
        });
    } catch (err) {
        console.error("نیویگیشن سیٹ اپ ایرر:", err);
    }
});
// ============================================================================
// ایڈوانسڈ ماسٹر سسٹم سیٹنگز اور ڈائنامک ڈکشنری آبزرور (Scope Based)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    applySystemTheme();

    document.addEventListener('click', function (e) {
        var settingsTab = e.target && e.target.closest('#tab-sys-settings');
        if (settingsTab) {
            e.preventDefault();
            window.navigateToModule(settingsTab);
        }
    });

    // رنگ محفوظ — sys-settings.js handles #btn-save-theme and #sys-btn-apply-theme
    document.addEventListener('click', function(e) {
        if(e.target && e.target.closest('#btn-save-theme') && typeof window.sysSaveAndApplyTheme === 'function') {
            return;
        }
        if(e.target && e.target.closest('#btn-save-theme')) {
            const theme = {
                primary: document.getElementById('theme-color-primary').value,
                accent: document.getElementById('theme-color-accent').value,
                style: document.getElementById('theme-style-select').value
            };
            localStorage.setItem('ems_sys_theme', JSON.stringify(theme));
            applySystemTheme();
            if(typeof window.showToast === 'function') window.showToast('نئے رنگ اور اسٹائل لاگو ہو گئے!', 'success');
        }
    });

    // نیا لفظ — sys-terminology.js handles #btn-add-dict-word

    // ریفریش بٹن
    document.addEventListener('click', function(e) {
        if(e.target && e.target.closest('#btn-apply-dict')) {
            applyCustomDictionary();
            if(typeof window.showToast === 'function') window.showToast('تمام نام کامیابی سے تبدیل کر دیے گئے!', 'success');
        }
    });
});

function applySystemTheme() {
    if (typeof window.sysApplyTheme === 'function') {
        window.sysApplyTheme(typeof window.sysGetConfig === 'function' ? window.sysGetConfig() : null);
        return;
    }
    var cfgV2 = null;
    try { cfgV2 = JSON.parse(localStorage.getItem('ems_sys_config_v2') || 'null'); } catch (e) { /* ignore */ }
    if (cfgV2 && cfgV2.colors) {
        var c = cfgV2.colors;
        document.documentElement.style.setProperty('--primary', c.primary || '#2c3e50');
        document.documentElement.style.setProperty('--secondary', c.secondary || '#34495e');
        document.documentElement.style.setProperty('--accent', c.accent || '#2980b9');
        document.documentElement.style.setProperty('--sys-ribbon', c.ribbon || c.primary || '#2c3e50');
        if (typeof window.emsApplyRegTopbarContrast === 'function') {
            window.emsApplyRegTopbarContrast(document.documentElement, c);
        }
    }
    let theme = JSON.parse(localStorage.getItem('ems_sys_theme') || 'null');
    if(theme) {
        if(theme.primary) document.documentElement.style.setProperty('--primary', theme.primary);
        if(theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
        document.body.classList.forEach(function (cls) {
            if (cls.indexOf('theme-style-') === 0) {
                document.body.classList.remove(cls);
            }
        });
        document.body.classList.add('theme-style-' + (theme.style || 'rounded'));
    }
}

function renderDictionaryTable() {
    if (typeof window.renderDictionaryTable === 'function' && window.renderDictionaryTable !== renderDictionaryTable) {
        window.renderDictionaryTable();
        return;
    }
    const tbody = document.getElementById('sys-dict-tbody');
    if(!tbody) return;
    let dict = JSON.parse(localStorage.getItem('ems_sys_dict')) || [];
    if(dict.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">کوئی تبدیلی درج نہیں</td></tr>';
        return;
    }
    tbody.innerHTML = dict.map(item => `
        <tr>
            <td style="font-size:11px; color:#7f8c8d;">${item.path || item.scopeName || '—'}</td>
            <td style="color:var(--danger); font-weight:bold;">${item.oldWord}</td>
            <td style="color:var(--success); font-weight:bold;">${item.newWord}</td>
            <td><button class="icon-btn delete" onclick="deleteDictWord('${item.id}')"><i class="fas fa-trash"></i></button></td>
        </tr>
    `).join('');
}

window.deleteDictWord = function(id) {
    if (typeof window.sysTermDeleteWord === 'function') return window.sysTermDeleteWord(id);
    let dict = JSON.parse(localStorage.getItem('ems_sys_dict')) || [];
    dict = dict.filter(item => item.id !== id);
    localStorage.setItem('ems_sys_dict', JSON.stringify(dict));
    renderDictionaryTable();
    if(typeof window.showToast === 'function') window.showToast('لفظ ہٹا دیا گیا۔', 'warning');
};

function loadSystemSettingsUI() {
    if (typeof window.sysLoadThemeForm === 'function') {
        window.sysLoadThemeForm();
        if (typeof window.sysRenderProfiles === 'function') window.sysRenderProfiles();
    } else {
        let theme = JSON.parse(localStorage.getItem('ems_sys_theme'));
        if(theme) {
            if(document.getElementById('theme-color-primary')) document.getElementById('theme-color-primary').value = theme.primary || '#2c3e50';
            if(document.getElementById('theme-color-accent')) document.getElementById('theme-color-accent').value = theme.accent || '#3498db';
            if(document.getElementById('theme-style-select')) document.getElementById('theme-style-select').value = theme.style || 'rounded';
        }
    }
    renderDictionaryTable();
}

// --- 🚀 اسمارٹ اسکوپ میپنگ (یہ سسٹم کے مختلف حصوں کو پہچانتا ہے) ---
const scopeMappings = {
    'attendance': ['att-', 'period', 'holiday', 'module-attendance'],
    'admission': ['adm-', 'reg-', 'module-admission'],
    'finance': ['fin-', 'fee-', 'module-finance'],
    'ledger': ['ldg-', 'ledger-', 'module-ledger'],
    'exams': ['exam-', 'module-exams'],
    'dashboard': ['dash-', 'module-dashboard'],
    'complaints': ['comp-', 'cmp-', 'module-complaints'],
    'announcements': ['ann-', 'module-announcements'],
    'sys-settings': ['sys-', 'module-sys-settings'],
    'admin': ['admin-', 'module-admin'],
    'ribbon': ['ribbon', 'tab-']
};

window.applyCustomDictionary = function() {
    if (typeof window.sysTermApplyPrecise === 'function') window.sysTermApplyPrecise();
    if (typeof window.sysTermRetagFromDict === 'function') window.sysTermRetagFromDict();

    let dict = JSON.parse(localStorage.getItem('ems_sys_dict')) || [];
    if(dict.length === 0) return;

    function replaceTextInNode(targetNode) {
        if(!targetNode) return;
        const walk = document.createTreeWalker(targetNode, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while(node = walk.nextNode()) {
            if(node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE') continue;
            
            let originalText = node.nodeValue;
            let newText = originalText;
            
            // کنٹینر کی شناخت (ID یا Class کے ذریعے)
            let closestEl = node.parentElement.closest('[id], [class]');
            let idClassStr = closestEl ? (closestEl.id + " " + closestEl.className).toLowerCase() : "";

            dict.forEach(item => {
                let isValidScope = false;
                
                if (item.scope === 'global') {
                    isValidScope = true;
                } else if (scopeMappings[item.scope]) {
                    // اگر یہ اس مخصوص شعبے کا حصہ ہے تو تبدیلی کریں
                    isValidScope = scopeMappings[item.scope].some(keyword => idClassStr.includes(keyword));
                }

                if (isValidScope && newText.includes(item.oldWord)) {
                    if (item.nodeId && item.type !== 'manual') return;
                    let regex = new RegExp(item.oldWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                    newText = newText.replace(regex, item.newWord);
                }
            });

            if(originalText !== newText) {
                node.nodeValue = newText;
            }
        }
    }

    replaceTextInNode(document.body);
};

// --- 🛡️ لائیو آبزرور (Live Observer) برائے اندرونی بٹن ---
// جب بھی جاوا اسکرپٹ کوئی نیا ٹیبل یا بٹن بنائے گی، یہ آبزرور اسے فوراً پکڑ کر نام بدل دے گا۔
window.dictObserver = new MutationObserver((mutations) => {
    let needsUpdate = false;
    mutations.forEach(m => {
        // اگر کوئی نئی چیز شامل ہوئی ہے اور وہ سیٹنگز کی اپنی ٹیبل نہیں ہے
        if (m.addedNodes.length > 0 && m.target.id !== 'sys-dict-tbody') {
            needsUpdate = true;
        }
    });
    if (needsUpdate) {
        window.dictObserver.disconnect(); // لوپ سے بچنے کے لیے تھوڑی دیر کے لیے روکیں
        applyCustomDictionary();
        startDictObserver(); // دوبارہ چالو کر دیں
    }
});

function startDictObserver() {
    if (typeof window.emsIsUserAuthenticated === 'function' && !window.emsIsUserAuthenticated()) {
        return;
    }
    const container = document.getElementById('app-container');
    if(container && window.dictObserver) {
        window.dictObserver.observe(container, { childList: true, subtree: true });
    }
}
window.emsStartDictObserver = startDictObserver;

window.emsApplyCustomDictionaryDeferred = function () {
    if (typeof window.emsIsUserAuthenticated === 'function' && !window.emsIsUserAuthenticated()) {
        return;
    }
    var run = function () {
        applyCustomDictionary();
        startDictObserver();
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 3000 });
    } else {
        setTimeout(run, 1500);
    }
};

// ============================================================================
// 🚀 کسٹم بٹن بلڈر — sys-button-builder.js (Phase C)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.emsIsUserAuthenticated === 'function' && window.emsIsUserAuthenticated()) {
        setTimeout(function () {
            if (typeof window.sysBtnRenderAll === 'function') window.sysBtnRenderAll();
            else if (typeof window.renderCustomButtons === 'function') window.renderCustomButtons();
        }, 1000);
    } else {
        document.addEventListener('ems:post-auth-deferred-ready', function once() {
            document.removeEventListener('ems:post-auth-deferred-ready', once);
            setTimeout(function () {
                if (typeof window.sysBtnRenderAll === 'function') window.sysBtnRenderAll();
                else if (typeof window.renderCustomButtons === 'function') window.renderCustomButtons();
            }, 400);
        });
    }
});

window.renderCustomButtons = function () {
    if (typeof window.sysBtnRenderAll === 'function') return window.sysBtnRenderAll();
};

// ⚡ کمانڈ ایگزیکیوشن انجن (Action Processor) ⚡
window.executeCustomAction = function(action, url) {
    switch(action) {
        // [ عمومی فنکشنز ]
        case 'cmd_print_screen':
        case 'cmd_save_pdf':
            window.print();
            break;
        case 'cmd_refresh_system':
            location.reload();
            break;
        case 'cmd_go_back':
            window.history.back();
            break;
        case 'cmd_open_custom_url':
            if(url) window.open(url, '_blank');
            else if(typeof window.showToast === 'function') window.showToast('کوئی لنک موجود نہیں!', 'error');
            break;
        case 'cmd_toggle_darkmode':
            // ڈارک موڈ کا کوئیک ہیک (Quick Hack)
            document.body.classList.toggle('dark-theme-active');
            if(document.body.classList.contains('dark-theme-active')) {
                document.body.style.filter = 'invert(1) hue-rotate(180deg)';
                if(typeof window.showToast === 'function') window.showToast('ڈارک موڈ آن ہو گیا!', 'success');
            } else {
                document.body.style.filter = 'none';
                if(typeof window.showToast === 'function') window.showToast('لائٹ موڈ واپس آ گیا!', 'success');
            }
            break;
        case 'cmd_export_excel':
            if(typeof window.showToast === 'function') window.showToast('ٹیبل کا ڈیٹا ڈاؤنلوڈ کے لیے تیار کیا جا رہا ہے...', 'success');
            break;
        case 'cmd_whatsapp_support':
            window.open('https://wa.me/?text=Hello%20System%20Support', '_blank');
            break;
        case 'cmd_download_backup':
            if (window.EmsBackupService && typeof window.EmsBackupService.downloadLocalBackup === 'function') {
                window.EmsBackupService.downloadLocalBackup()
                    .then(function () {
                        if (typeof window.showToast === 'function') window.showToast('بیک اپ فائل ڈاؤنلوڈ ہو گئی!', 'success');
                    })
                    .catch(function (e) {
                        if (typeof window.showToast === 'function') window.showToast('بیک اپ ناکام: ' + e.message, 'error');
                    });
            } else if (typeof window.showToast === 'function') {
                window.showToast('بیک اپ سروس دستیاب نہیں!', 'error');
            }
            break;
        case 'cmd_clear_cache':
            if (window.EmsCachePolicy && typeof window.EmsCachePolicy.cleanupLocalStorage === 'function') {
                var r = window.EmsCachePolicy.cleanupLocalStorage(true);
                if (typeof window.showToast === 'function') {
                    window.showToast('کیشے صاف: ' + r.removed.length + ' پرانی keys ہٹائیں', 'success');
                }
            }
            break;

        // [ مخصوص شعبہ جات کی کمانڈز ]
        case 'cmd_add_new_period':
            if(typeof window.openModal === 'function') window.openModal('add-period-modal');
            break;
        case 'cmd_open_adm_form':
            document.getElementById('tab-admission')?.click();
            if(typeof window.showToast === 'function') window.showToast('رجسٹریشن کھولا', 'success');
            break;
        case 'cmd_view_students':
            document.getElementById('tab-admission')?.click();
            setTimeout(function() {
                if(typeof window.switchRegTab === 'function') window.switchRegTab('reg-list-panel', null);
            }, 300);
            break;
        case 'cmd_print_id_card':
            if(typeof window.showToast === 'function') window.showToast('شناختی کارڈ — رجسٹریشن سے پرنٹ کریں', 'warning');
            break;
        case 'cmd_open_calculator':
            window.open('https://www.google.com/search?q=calculator', '_blank');
            break;
        case 'cmd_fullscreen':
            if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
            break;
        case 'cmd_lock_attendance':
            if(typeof window.showToast === 'function') window.showToast('حاضری لاک — جلد فعال', 'warning');
            break;
        case 'cmd_att_monthly_report':
            document.getElementById('tab-attendance')?.click();
            setTimeout(function() {
                if(typeof window.switchAttTab === 'function') window.switchAttTab('att-reports-panel', null);
            }, 300);
            break;
        case 'cmd_open_fee_receipt':
            document.getElementById('tab-finance')?.click();
            setTimeout(function() {
                if(typeof window.switchFinTab === 'function') window.switchFinTab('fee-win-collect', null);
            }, 300);
            break;
        case 'cmd_view_defaulters':
            document.getElementById('tab-finance')?.click();
            setTimeout(function() {
                if(typeof window.switchFinTab === 'function') window.switchFinTab('fee-win-dues', null);
            }, 300);
            break;
        case 'cmd_daily_cashbook':
            document.getElementById('tab-ledger')?.click();
            break;
        case 'cmd_enter_marks':
            document.getElementById('tab-exams')?.click();
            setTimeout(function() {
                if(typeof window.switchExamTab === 'function') window.switchExamTab('exam-win-marks', null);
            }, 300);
            break;
        case 'cmd_print_result':
            document.getElementById('tab-exams')?.click();
            setTimeout(function() {
                if(typeof window.switchExamTab === 'function') window.switchExamTab('exam-win-result', null);
            }, 300);
            break;

        // اگر کمانڈ ابھی سسٹم میں شامل نہیں ہوئی
        default:
            if(typeof window.showToast === 'function') window.showToast('یہ کمانڈ جلد ہی ایکٹیویٹ ہو جائے گی!', 'warning');
    }
};


