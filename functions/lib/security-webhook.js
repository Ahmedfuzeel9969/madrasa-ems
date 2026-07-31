/**
 * Security webhook dispatch + delivery log (Phase 18)
 */
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const WEBHOOK_ACTIONS = [
    'trusted_device_requested',
    'trusted_device_approved',
    'trusted_device_rejected',
    'trusted_device_revoked',
    'trusted_device_rate_limited',
    'sso_domain_denied',
    'sso_provider_denied',
    'mfa_session_required',
    'login_ip_denied',
    'login_country_denied',
    'login_lockout_triggered',
    'login_lockout_cleared',
    'session_anomaly_detected'
];

function isValidWebhookUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (e) {
        return false;
    }
}

function signPayload(secret, body) {
    if (!secret) return '';
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function postJson(url, payload, headers) {
    return new Promise(function (resolve, reject) {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const data = JSON.stringify(payload);
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'User-Agent': 'EMS-SecurityWebhook/1.0'
            }, headers || {})
        };
        const req = lib.request(opts, function (res) {
            let chunks = '';
            res.on('data', function (c) { chunks += c; });
            res.on('end', function () {
                resolve({ statusCode: res.statusCode, body: chunks.slice(0, 500) });
            });
        });
        req.on('error', reject);
        req.setTimeout(8000, function () { req.destroy(new Error('timeout')); });
        req.write(data);
        req.end();
    });
}

function webhookLogCol(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('SecurityWebhookLog');
}

async function logWebhookAttempt(db, tenantId, entry) {
    await webhookLogCol(db, tenantId).add(Object.assign({ ts: Date.now() }, entry));
}

async function loadWebhookPolicy(db, tenantId) {
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    return policySnap.exists ? policySnap.data() : {};
}

async function dispatchWebhook(db, tenantId, event, policyOverride) {
    const policy = policyOverride || await loadWebhookPolicy(db, tenantId);
    if (!policy.enableSecurityWebhooks) return { skipped: true, reason: 'disabled' };
    const url = String(policy.securityWebhookUrl || '').trim();
    if (!isValidWebhookUrl(url)) return { skipped: true, reason: 'invalid_url' };
    if (WEBHOOK_ACTIONS.indexOf(event.action) < 0) return { skipped: true, reason: 'action_not_webhookable' };

    const payload = {
        type: 'ems.security_event',
        tenantId: tenantId,
        action: event.action,
        uid: event.uid || '',
        email: event.email || '',
        details: event.details && typeof event.details === 'object' ? event.details : {},
        logId: event.logId || '',
        timestamp: Date.now()
    };
    const body = JSON.stringify(payload);
    const secret = String(policy.securityWebhookSecret || '');
    const headers = {};
    if (secret) headers['X-EMS-Signature'] = signPayload(secret, body);

    try {
        const res = await postJson(url, payload, headers);
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        await logWebhookAttempt(db, tenantId, {
            action: event.action,
            ok: ok,
            statusCode: res.statusCode,
            url: url.slice(0, 256),
            test: !!event.test
        });
        return { ok: ok, statusCode: res.statusCode };
    } catch (err) {
        await logWebhookAttempt(db, tenantId, {
            action: event.action,
            ok: false,
            error: String(err.message || err).slice(0, 200),
            url: url.slice(0, 256),
            test: !!event.test
        });
        return { ok: false, error: String(err.message || err) };
    }
}

async function maybeDispatch(db, tenantId, event) {
    try {
        return await dispatchWebhook(db, tenantId, event);
    } catch (e) {
        return null;
    }
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

const testSecurityWebhook = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const policy = await loadWebhookPolicy(db, tenantId);
    if (!policy.enableSecurityWebhooks) {
        throw new functions.https.HttpsError('failed-precondition', 'Security webhook فعال نہیں۔');
    }
    const result = await dispatchWebhook(db, tenantId, {
        action: 'webhook_test',
        uid: context.auth.uid,
        email: context.auth.token.email || '',
        details: { message: 'EMS security webhook test' },
        test: true
    }, policy);
    if (result.skipped && result.reason === 'action_not_webhookable') {
        const url = String(policy.securityWebhookUrl || '').trim();
        if (!isValidWebhookUrl(url)) {
            throw new functions.https.HttpsError('failed-precondition', 'Webhook URL درست نہیں۔');
        }
        const payload = {
            type: 'ems.security_event',
            tenantId: tenantId,
            action: 'webhook_test',
            uid: context.auth.uid,
            email: context.auth.token.email || '',
            details: { message: 'EMS security webhook test' },
            timestamp: Date.now()
        };
        const body = JSON.stringify(payload);
        const secret = String(policy.securityWebhookSecret || '');
        const headers = {};
        if (secret) headers['X-EMS-Signature'] = signPayload(secret, body);
        try {
            const res = await postJson(url, payload, headers);
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            await logWebhookAttempt(db, tenantId, {
                action: 'webhook_test',
                ok: ok,
                statusCode: res.statusCode,
                url: url.slice(0, 256),
                test: true
            });
            return { ok: ok, statusCode: res.statusCode };
        } catch (err) {
            await logWebhookAttempt(db, tenantId, {
                action: 'webhook_test',
                ok: false,
                error: String(err.message || err).slice(0, 200),
                url: url.slice(0, 256),
                test: true
            });
            throw new functions.https.HttpsError('internal', 'Webhook test ناکام: ' + (err.message || err));
        }
    }
    return result;
});

const getSecurityWebhookStatus = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const policy = await loadWebhookPolicy(db, tenantId);
    const snap = await webhookLogCol(db, tenantId).orderBy('ts', 'desc').limit(8).get();
    const recent = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        recent.push({
            action: d.action || '',
            ok: !!d.ok,
            statusCode: d.statusCode || 0,
            error: d.error || '',
            ts: d.ts || 0,
            test: !!d.test
        });
    });
    let success7d = 0;
    let failed7d = 0;
    const since = Date.now() - 7 * 86400000;
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (!d.ts || d.ts < since) return;
        if (d.ok) success7d++;
        else failed7d++;
    });
    return {
        enabled: !!policy.enableSecurityWebhooks,
        hasUrl: isValidWebhookUrl(String(policy.securityWebhookUrl || '')),
        recent: recent,
        delivery7d: { success: success7d, failed: failed7d }
    };
});

module.exports = {
    WEBHOOK_ACTIONS,
    isValidWebhookUrl,
    signPayload,
    maybeDispatch,
    dispatchWebhook,
    testSecurityWebhook,
    getSecurityWebhookStatus
};
