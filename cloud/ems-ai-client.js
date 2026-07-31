// ============================================================================
// EMS AI — Cloud Functions client (gateway caller only — no API keys)
// ============================================================================
(function (global) {
    'use strict';

    function getTenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var t = global.emsRequireTenantId();
            if (t) return t;
        }
        return global.CURRENT_MADRASA_TENANT_ID || null;
    }

    function callFn(name, data) {
        if (typeof global.emsCallFunction === 'function') {
            return global.emsCallFunction(name, data);
        }
        if (typeof firebase === 'undefined' || !firebase.functions) {
            return Promise.reject(new Error('functions_unavailable'));
        }
        return firebase.functions().httpsCallable(name)(data || {}).then(function (res) {
            return res.data;
        });
    }

    global.emsAiAsk = function (payload) {
        payload = payload || {};
        var tid = payload.tenantId || getTenantId();
        if (!tid) return Promise.reject(new Error('tenant_missing'));
        return callFn('aiAsk', {
            tenantId: tid,
            intent: payload.intent,
            question: payload.question,
            contextPack: payload.contextPack,
            provider: payload.provider || 'gemini'
        });
    };

    global.emsAiGetStatus = function () {
        var tid = getTenantId();
        if (!tid) return Promise.resolve({ ok: false, reason: 'tenant_missing' });
        return callFn('getAiAssistantStatus', { tenantId: tid }).catch(function (e) {
            return { ok: false, error: (e && e.message) || 'status_failed' };
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
