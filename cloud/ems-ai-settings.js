// ============================================================================
// EMS AI Settings — Admin UI ↔ Firestore SystemSettings_Config/ai_config
// Owner-only: API key stored server-side readable doc; staff use AI via gateway.
// ============================================================================
(function (global) {
    'use strict';

    var state = {
        loaded: false,
        hasStoredKey: false,
        storedKeyPreview: ''
    };

    function toast(msg, type) {
        if (typeof global.showToast === 'function') global.showToast(msg, type || 'success');
    }

    function getTenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var t = global.emsRequireTenantId();
            if (t) return t;
        }
        return global.CURRENT_MADRASA_TENANT_ID || null;
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function aiConfigRef() {
        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) return null;
        return db.collection('All_Madrasas').doc(tid).collection('SystemSettings_Config').doc('ai_config');
    }

    global.emsAiSettingsCanManage = function () {
        if (global.CURRENT_USER_TENANT_ROLE === 'owner') return true;
        if (global.EMS_IS_TENANT_OWNER === true) return true;
        return false;
    };

    global.emsAiSettingsLoad = function () {
        if (!global.emsAiSettingsCanManage()) {
            return Promise.resolve({ ok: false, reason: 'owner_only' });
        }
        var ref = aiConfigRef();
        if (!ref) return Promise.resolve({ ok: false, reason: 'cloud_offline' });

        return ref.get().then(function (snap) {
            var cfg = snap.exists ? (snap.data() || {}) : {};
            var gem = (cfg.providers && cfg.providers.gemini) || {};
            var key = gem.apiKey ? String(gem.apiKey) : '';

            state.hasStoredKey = !!key;
            state.storedKeyPreview = key ? ('***' + key.slice(-4)) : '';
            state.loaded = true;

            var enabledEl = document.getElementById('ems-ai-cfg-enabled');
            var modelEl = document.getElementById('ems-ai-cfg-model');
            var keyEl = document.getElementById('ems-ai-cfg-api-key');
            var hintEl = document.getElementById('ems-ai-cfg-key-hint');
            var statusEl = document.getElementById('ems-ai-cfg-status');

            if (enabledEl) enabledEl.checked = cfg.enabled !== false;
            if (modelEl) modelEl.value = gem.model || cfg.defaultModel || 'gemini-2.5-flash';
            if (keyEl) keyEl.value = '';
            if (hintEl) {
                hintEl.textContent = key
                    ? ('موجودہ کلید: ' + state.storedKeyPreview + ' — نئی کلید درج کریں یا خالی چھوڑیں')
                    : 'ابھی کوئی کلید محفوظ نہیں — Gemini API Key درج کریں';
            }
            if (statusEl) statusEl.textContent = '';

            return { ok: true, cfg: cfg };
        }).catch(function (err) {
            toast('AI سیٹنگز لوڈ نہیں ہو سکیں: ' + ((err && err.message) || ''), 'error');
            return { ok: false, error: err };
        });
    };

    global.emsAiSettingsSave = function () {
        if (!global.emsAiSettingsCanManage()) {
            toast('صرف منتظم (Owner) AI کلید محفوظ کر سکتا ہے', 'warning');
            return Promise.resolve({ ok: false });
        }
        var ref = aiConfigRef();
        if (!ref) {
            toast('Cloud / Firestore دستیاب نہیں — آن لائن موڈ چیک کریں', 'warning');
            return Promise.resolve({ ok: false });
        }

        var enabledEl = document.getElementById('ems-ai-cfg-enabled');
        var modelEl = document.getElementById('ems-ai-cfg-model');
        var keyEl = document.getElementById('ems-ai-cfg-api-key');
        var statusEl = document.getElementById('ems-ai-cfg-status');
        var saveBtn = document.getElementById('ems-ai-cfg-save');

        var model = modelEl ? modelEl.value : 'gemini-2.5-flash';
        var newKey = keyEl ? String(keyEl.value || '').trim() : '';
        var enabled = enabledEl ? enabledEl.checked : true;

        if (!state.hasStoredKey && !newKey) {
            toast('Gemini API Key درج کریں', 'warning');
            return Promise.resolve({ ok: false });
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> محفوظ ہو رہا ہے...';
        }

        return ref.get().then(function (snap) {
            var existing = snap.exists ? (snap.data() || {}) : {};
            var gem = Object.assign({}, (existing.providers && existing.providers.gemini) || {});
            gem.model = model;
            if (newKey) gem.apiKey = newKey;
            else if (gem.apiKey) { /* keep existing */ }
            else if (state.hasStoredKey && existing.providers && existing.providers.gemini) {
                gem.apiKey = existing.providers.gemini.apiKey;
            }

            var payload = {
                enabled: enabled,
                defaultProvider: 'gemini',
                defaultModel: model,
                providers: {
                    gemini: gem
                },
                updatedAt: (global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue)
                    ? global.firebase.firestore.FieldValue.serverTimestamp()
                    : new Date().toISOString(),
                updatedBy: (global.firebase && global.firebase.auth && global.firebase.auth().currentUser)
                    ? global.firebase.auth().currentUser.uid : ''
            };

            return ref.set(payload, { merge: true }).then(function () {
                if (newKey) {
                    state.hasStoredKey = true;
                    state.storedKeyPreview = '***' + newKey.slice(-4);
                    if (keyEl) keyEl.value = '';
                }
                if (statusEl) {
                    statusEl.textContent = 'محفوظ — اگلا AI سوال فوری نئی کلید استعمال کرے گا';
                }
                toast('AI سیٹنگز Firestore میں محفوظ — فوری لاگو', 'success');
                if (typeof global.sysAuditLog === 'function') {
                    global.sysAuditLog('update', 'ai_config', 'AI Gemini key/model updated (masked)');
                }
                return { ok: true };
            });
        }).catch(function (err) {
            toast('محفوظ نہیں ہو سکا: ' + ((err && err.message) || ''), 'error');
            return { ok: false, error: err };
        }).finally(function () {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> AI سیٹنگز محفوظ کریں';
            }
        });
    };

    global.emsAiSettingsInitUI = function () {
        var panel = document.getElementById('sys-win-ai');
        if (!panel || panel.dataset.bound) return;
        panel.dataset.bound = '1';

        var saveBtn = document.getElementById('ems-ai-cfg-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                global.emsAiSettingsSave();
            });
        }

        var probeBtn = document.getElementById('ems-ai-cfg-probe');
        if (probeBtn) {
            probeBtn.addEventListener('click', function () {
                if (typeof global.emsAiGetStatus !== 'function') {
                    toast('AI client لوڈ نہیں', 'warning');
                    return;
                }
                global.emsAiGetStatus().then(function (r) {
                    var el = document.getElementById('ems-ai-cfg-status');
                    if (el) el.textContent = r && r.ok
                        ? ('سرور: فعال | ماڈل: ' + (r.modelHint || '—'))
                        : ('سرور: ' + ((r && r.error) || 'نامعلوم'));
                });
            });
        }
    };

    global.emsAiSettingsGetLocal = function () {
        try {
            return JSON.parse(localStorage.getItem('ems_ai_ui_prefs') || '{}');
        } catch (e) {
            return {};
        }
    };

    global.emsAiSettingsSaveLocal = function (prefs) {
        try {
            localStorage.setItem('ems_ai_ui_prefs', JSON.stringify(prefs || {}));
        } catch (e) { /* ignore */ }
    };

    global.emsAiSettingsProbe = function () {
        if (typeof global.emsAiGetStatus !== 'function') {
            return Promise.resolve({ ok: false, reason: 'client_not_loaded' });
        }
        return global.emsAiGetStatus();
    };
})(typeof window !== 'undefined' ? window : globalThis);
