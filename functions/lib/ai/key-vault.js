'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');

function readFunctionsConfig(section) {
    try {
        return functions.config()[section] || {};
    } catch (e) {
        return {};
    }
}

/**
 * Resolve provider API key — priority (highest first):
 *   1) Tenant Firestore SystemSettings_Config/ai_config → providers.*.apiKey (Admin UI)
 *   2) Tenant ai_config → providers.*.keySecretId (Secret Manager / KMS)
 *   3) Platform functions.config / env (bootstrap fallback)
 * No long-lived cache — UI key changes take effect on the next aiAsk call.
 */
async function resolveProviderKey(tenantId, providerId) {
    var key = null;
    var model = null;

    if (tenantId) {
        try {
            var snap = await admin.firestore()
                .collection('All_Madrasas').doc(tenantId)
                .collection('SystemSettings_Config').doc('ai_config').get();
            if (snap.exists) {
                var cfg = snap.data() || {};
                if (cfg.enabled === false) {
                    var disabledErr = new Error('AI assistant disabled for tenant');
                    disabledErr.code = 'ai_disabled';
                    throw disabledErr;
                }
                var prov = (cfg.providers && cfg.providers[providerId]) || {};
                model = prov.model || cfg.defaultModel || null;

                if (prov.apiKey && String(prov.apiKey).trim()) {
                    key = String(prov.apiKey).trim();
                } else if (prov.keySecretId) {
                    key = await resolveSecretManagerRef(prov.keySecretId);
                }
            }
        } catch (e) {
            if (e.code === 'ai_disabled') throw e;
            functions.logger.warn('[AI] tenant ai_config read failed', { tenantId: tenantId, err: e.message });
        }
    }

    if (!key) {
        var aiCfg = readFunctionsConfig('ai');
        if (providerId === 'gemini') {
            key = process.env.GEMINI_API_KEY || aiCfg.gemini_api_key || aiCfg.gemini_key || '';
            model = model || process.env.GEMINI_MODEL || aiCfg.gemini_model || null;
        } else if (providerId === 'openai') {
            key = process.env.OPENAI_API_KEY || aiCfg.openai_api_key || '';
            model = model || process.env.OPENAI_MODEL || aiCfg.openai_model || null;
        } else if (providerId === 'anthropic') {
            key = process.env.ANTHROPIC_API_KEY || aiCfg.anthropic_api_key || '';
            model = model || process.env.ANTHROPIC_MODEL || aiCfg.anthropic_model || null;
        }
    }

    if (!key) {
        var err = new Error('AI provider key not configured on server');
        err.code = 'ai_key_missing';
        throw err;
    }

    return { key: key, model: model };
}

async function resolveSecretManagerRef(secretRef) {
    if (!secretRef) return null;
    try {
        var projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
        var name = secretRef.indexOf('projects/') === 0
            ? secretRef
            : ('projects/' + projectId + '/secrets/' + secretRef + '/versions/latest');
        var sm = require('@google-cloud/secret-manager');
        var client = new sm.SecretManagerServiceClient();
        var resp = await client.accessSecretVersion({ name: name });
        var payload = resp[0] && resp[0].payload && resp[0].payload.data;
        return payload ? payload.toString('utf8').trim() : null;
    } catch (e) {
        functions.logger.warn('[AI] Secret Manager unavailable', { ref: secretRef, err: e.message });
        return null;
    }
}

module.exports = {
    resolveProviderKey: resolveProviderKey,
    resolveSecretManagerRef: resolveSecretManagerRef
};
