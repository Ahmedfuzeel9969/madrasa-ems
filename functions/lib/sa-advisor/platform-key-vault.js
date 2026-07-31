'use strict';

const functions = require('firebase-functions');

var SECRET_NAME = 'platform-gemini-advisor-key';

async function resolvePlatformGeminiKey() {
    try {
        var sm = require('@google-cloud/secret-manager');
        var projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
        var name = 'projects/' + projectId + '/secrets/' + SECRET_NAME + '/versions/latest';
        var client = new sm.SecretManagerServiceClient();
        var resp = await client.accessSecretVersion({ name: name });
        var payload = resp[0] && resp[0].payload && resp[0].payload.data;
        var key = payload ? payload.toString('utf8').trim() : '';
        if (key) return { key: key, source: 'secret_manager' };
    } catch (e) {
        functions.logger.warn('[SA Advisor] Secret Manager unavailable', { err: e.message });
    }

    var envKey = process.env.PLATFORM_GEMINI_ADVISOR_KEY || '';
    if (envKey) return { key: envKey.trim(), source: 'env' };

    try {
        var cfg = functions.config().sa_advisor || {};
        if (cfg.gemini_key) return { key: String(cfg.gemini_key).trim(), source: 'functions_config' };
    } catch (e2) { /* ignore */ }

    var err = new Error('Platform Gemini key not configured');
    err.code = 'advisor_key_missing';
    throw err;
}

async function resolvePlatformModel() {
    try {
        var cfg = functions.config().sa_advisor || {};
        if (cfg.gemini_model) return cfg.gemini_model;
    } catch (e) { /* ignore */ }
    return process.env.PLATFORM_GEMINI_ADVISOR_MODEL || 'gemini-2.5-flash';
}

module.exports = {
    SECRET_NAME: SECRET_NAME,
    resolvePlatformGeminiKey: resolvePlatformGeminiKey,
    resolvePlatformModel: resolvePlatformModel
};
