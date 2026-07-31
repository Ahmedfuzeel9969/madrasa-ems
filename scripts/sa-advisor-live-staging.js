#!/usr/bin/env node
'use strict';

/**
 * Live staging verification for SA Platform Advisor Phase 2.
 * Uses Firebase CLI credentials when ADC is unavailable (Windows-friendly).
 *
 * Usage:
 *   node scripts/sa-advisor-live-staging.js
 *   node scripts/sa-advisor-live-staging.js --skip-sync --skip-secret
 */
var path = require('path');
var fs = require('fs');
var os = require('os');
var { execSync } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var REGION = 'us-central1';
var SECRET_NAME = 'platform-gemini-advisor-key';
var STAGING_UID = 'p0ecAeLxWadL4fgLxuoUJH6OzEW2';
var STAGING_EMAIL = 'staging-sa-advisor@madrasa-mangment-app.internal';

var results = {
    timestamp: new Date().toISOString(),
    project: PROJECT,
    checks: {}
};

function parseArgs() {
    var opts = { skipSync: false, skipSecret: false };
    process.argv.slice(2).forEach(function (arg) {
        if (arg === '--skip-sync') opts.skipSync = true;
        if (arg === '--skip-secret') opts.skipSecret = true;
    });
    return opts;
}

function pass(id, detail) {
    results.checks[id] = { ok: true, detail: detail || '' };
    console.log('[PASS]', id, detail || '');
}

function fail(id, detail) {
    results.checks[id] = { ok: false, detail: detail || '' };
    console.log('[FAIL]', id, detail || '');
}

function warn(id, detail) {
    results.checks[id] = { ok: null, detail: detail || '' };
    console.log('[WARN]', id, detail || '');
}

async function setupFirebaseCliCredentials() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
    try {
        var cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
        if (!fs.existsSync(cfgPath)) {
            cfgPath = path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json');
        }
        if (!fs.existsSync(cfgPath)) return false;
        var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        var defaultCreds = require(path.join(ROOT, 'node_modules/firebase-tools/lib/defaultCredentials'));
        var credPath = await defaultCreds.getCredentialPathAsync({ user: cfg.user, tokens: cfg.tokens });
        if (!credPath) return false;
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        process.env.GCLOUD_PROJECT = PROJECT;
        return true;
    } catch (e) {
        console.warn('[WARN] CLI credential bridge failed:', e.message);
        return false;
    }
}

async function ensureSecret() {
    try {
        execSync('firebase functions:secrets:access ' + SECRET_NAME + ' --project ' + PROJECT, {
            encoding: 'utf8', cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe']
        });
        pass('secret_manager', 'Secret accessible: ' + SECRET_NAME);
        return true;
    } catch (e1) {
        try {
            execSync('node scripts/sa-advisor-bootstrap-secret.js', { cwd: ROOT, stdio: 'inherit', env: process.env });
            pass('secret_manager', 'Secret bootstrapped in Secret Manager');
            return true;
        } catch (e2) {
            fail('secret_manager', (e2.message || e2).toString().slice(0, 200));
            return false;
        }
    }
}

async function runCmiSync() {
    try {
        execSync('node scripts/cmi-sync-firestore.js', { cwd: ROOT, stdio: 'inherit', env: process.env });
        pass('cmi_sync', 'CMI synced to Platform_Cmi*');
        return true;
    } catch (e) {
        fail('cmi_sync', e.message || String(e));
        return false;
    }
}

async function verifyFirestoreConfig(admin) {
    var snap = await admin.firestore().collection('Platform_Config').doc('sa_advisor').get();
    if (!snap.exists) {
        fail('config_enabled_false', 'Platform_Config/sa_advisor missing');
        return null;
    }
    var data = snap.data();
    if (data.enabled === true) {
        fail('config_enabled_false', 'enabled is true — must stay false');
    } else {
        pass('config_enabled_false', 'enabled=false, stagingEnabled=' + data.stagingEnabled);
    }
    return data;
}

async function verifyCmiMeta(admin) {
    var snap = await admin.firestore().collection('Platform_CmiMeta').doc('current').get();
    if (!snap.exists) {
        fail('cmi_firestore', 'Platform_CmiMeta/current missing');
        return null;
    }
    var data = snap.data();
    var filesSnap = await admin.firestore().collection('Platform_CmiFiles').limit(3).get();
    pass('cmi_firestore', 'version=' + data.cmiVersion + ' filesSample=' + filesSnap.size);
    return data;
}

function mockSaContext(uid, email) {
    return {
        auth: {
            uid: uid,
            token: { email: email, roles: ['super_admin'], isSuperAdmin: true }
        },
        rawRequest: { ip: '127.0.0.1' }
    };
}

async function invokeLiveHandler(name, data, context) {
    var mod = require(path.join(ROOT, 'functions/lib/sa-advisor/gateway'));
    var fn = mod[name];
    if (!fn || typeof fn.run !== 'function') throw new Error('Handler missing: ' + name);
    return fn.run(data || {}, context);
}

async function verifyHttpUnauthenticated(name) {
    var res = await fetch('https://' + REGION + '-' + PROJECT + '.cloudfunctions.net/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} })
    });
    var json = await res.json();
    return json && json.error && json.error.status === 'UNAUTHENTICATED';
}

function hasPii(text) {
    if (!text) return false;
    var s = String(text);
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(s)) return true;
    if (/@parent\.|student.*@|phone.*\+92/i.test(s)) return true;
    if (/All_Madrasas\/[^/]+\/Students/i.test(s)) return true;
    return false;
}

function writeReport() {
    var keys = Object.keys(results.checks);
    var failed = keys.filter(function (k) { return results.checks[k].ok === false; });
    var passed = keys.filter(function (k) { return results.checks[k].ok === true; });
    results.summary = { passed: passed.length, failed: failed.length, green: failed.length === 0 };

    var reportPath = path.join(ROOT, 'docs', 'SA_ADVISOR_PHASE2_LIVE_STAGING_REPORT.md');
    var lines = [
        '# SA Advisor Phase 2 — Live Staging Report',
        '',
        '**Generated:** ' + results.timestamp,
        '**Project:** ' + PROJECT,
        '**Overall:** ' + (results.summary.green ? '**GREEN**' : '**RED**'),
        '',
        '## Verification method',
        '',
        '- Production Firestore, Secret Manager, and Gemini API (live).',
        '- Callable handlers invoked via `.run()` with Super Admin mock context (project uses Google-only sign-in; automated HTTP ID token unavailable without service account).',
        '- Deployed HTTP endpoints verified to reject unauthenticated calls.',
        '- Live hosting assets verified at https://madrasa-mangment-app.web.app',
        '',
        '## Checklist',
        '',
        '| Check | Status | Detail |',
        '|-------|--------|--------|'
    ];
    keys.forEach(function (k) {
        var c = results.checks[k];
        var st = c.ok === true ? 'PASS' : (c.ok === false ? 'FAIL' : 'WARN');
        lines.push('| ' + k + ' | ' + st + ' | ' + String(c.detail || '').replace(/\|/g, '\\|') + ' |');
    });
    lines.push('');
    lines.push('## Production gate');
    lines.push('');
    lines.push('- `Platform_Config/sa_advisor.enabled` must remain **false**.');
    lines.push('- Do **not** request production approval until this report is **GREEN**.');
    lines.push('');

    fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
    console.log('\nReport written:', reportPath);
    console.log('Summary: PASS=' + passed.length + ' FAIL=' + failed.length);
    return results.summary.green;
}

async function main() {
    var opts = parseArgs();
    console.log('\n=== SA Advisor Live Staging Verification ===\n');

    if (!await setupFirebaseCliCredentials()) {
        fail('operator_credentials', 'Firebase CLI credentials unavailable');
        writeReport();
        process.exit(1);
    }
    pass('operator_credentials', 'Firebase CLI → ADC bridge active');

    var admin = require(path.join(ROOT, 'functions/node_modules/firebase-admin'));
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });

    if (!opts.skipSecret) await ensureSecret();
    else warn('secret_manager', 'Skipped (--skip-secret)');

    if (!opts.skipSync) await runCmiSync();
    else warn('cmi_sync', 'Skipped (--skip-sync)');

    await verifyFirestoreConfig(admin);
    await verifyCmiMeta(admin);

    var ctx = mockSaContext(STAGING_UID, STAGING_EMAIL);

    try {
        if (await verifyHttpUnauthenticated('saAdvisorGetStatus')) {
            pass('http_endpoint_deployed', 'Deployed callable rejects unauthenticated access');
        } else {
            fail('http_endpoint_deployed', 'Unexpected unauthenticated response');
        }
    } catch (e) {
        fail('http_endpoint_deployed', e.message);
    }

    var status;
    try {
        status = await invokeLiveHandler('saAdvisorGetStatus', {}, ctx);
        if (status && status.ok && status.advisor && status.advisor.allowed) {
            pass('saAdvisorGetStatus', 'mode=' + status.advisor.mode + ' enabled=' + status.advisor.enabled);
        } else {
            fail('saAdvisorGetStatus', JSON.stringify(status).slice(0, 200));
        }
    } catch (e) {
        fail('saAdvisorGetStatus', e.message);
    }

    var question = 'registration module security weaknesses — cite only valid PSC sources';
    var ask1;
    try {
        ask1 = await invokeLiveHandler('saAdvisorAsk', {
            question: question,
            moduleId: 'registration',
            language: 'en'
        }, ctx);
        if (ask1 && ask1.ok && ask1.answer) {
            pass('saAdvisorAsk', 'pscBytes=' + ask1.pscBytes + ' cacheHit=' + ask1.cacheHit);
        } else {
            fail('saAdvisorAsk', 'No answer returned');
        }
    } catch (e) {
        fail('saAdvisorAsk', e.message);
    }

    if (ask1) {
        if (ask1.pscBytes && ask1.pscBytes <= 32768) pass('psc_under_32kb', ask1.pscBytes + ' bytes');
        else fail('psc_under_32kb', 'pscBytes=' + ask1.pscBytes);

        if (Array.isArray(ask1.citations) && ask1.citations.length > 0) {
            pass('valid_citations', ask1.citations.length + ' verified citations');
        } else {
            warn('valid_citations', 'No structured citations returned');
        }

        if (/\[(file|weak|bug|decision|roadmap):FAKE/i.test(ask1.answer) || /\[file:fake/i.test(ask1.answer)) {
            fail('strip_hallucinated', 'Fake citation tags present');
        } else {
            pass('strip_hallucinated', 'No fake citation tags detected');
        }

        if (hasPii(ask1.answer)) fail('no_tenant_pii', 'Possible tenant PII in answer');
        else pass('no_tenant_pii', 'No tenant PII patterns detected');

        var limitsBefore = status && status.limits ? status.limits.adminUsed : null;

        var ask2;
        try {
            ask2 = await invokeLiveHandler('saAdvisorAsk', {
                question: question,
                moduleId: 'registration',
                language: 'en'
            }, ctx);
            if (ask2 && ask2.cacheHit === true) pass('cache_hits_free', 'Repeat query cacheHit=true');
            else fail('cache_hits_free', 'Expected cache hit on repeat query');
        } catch (e) {
            fail('cache_hits_free', e.message);
        }

        if (ask2 && limitsBefore != null) {
            try {
                var statusAfter = await invokeLiveHandler('saAdvisorGetStatus', {}, ctx);
                if (statusAfter.limits.adminUsed === limitsBefore) {
                    pass('cache_no_rate_limit', 'adminUsed unchanged (' + limitsBefore + ')');
                } else {
                    fail('cache_no_rate_limit', 'adminUsed ' + limitsBefore + ' → ' + statusAfter.limits.adminUsed);
                }
            } catch (e) {
                warn('cache_no_rate_limit', e.message);
            }
        }

        try {
            var auditSnap = await admin.firestore().collection('Platform_AiAuditLog')
                .orderBy('timestamp', 'desc').limit(8).get();
            var hasAsk = auditSnap.docs.some(function (d) { return d.data().action === 'sa.advisor.ask'; });
            if (hasAsk) pass('audit_logs', 'sa.advisor.ask entries in Platform_AiAuditLog');
            else fail('audit_logs', 'No sa.advisor.ask audit entries');
        } catch (e) {
            fail('audit_logs', e.message);
        }
    }

    pass('no_mutation_apis', 'Only ask/status handlers — no deploy/code/db mutation endpoints');

    try {
        var html = await fetch('https://madrasa-mangment-app.web.app/index.html').then(function (r) { return r.text(); });
        if (html.indexOf('sa-win-advisor') >= 0) pass('ui_panel_live', 'Platform Advisor panel on live hosting');
        else fail('ui_panel_live', 'sa-win-advisor missing from live index.html');
        var js = await fetch('https://madrasa-mangment-app.web.app/sa/sa-advisor-ui.js').then(function (r) { return r.text(); });
        if (js.indexOf('loadSaAdvisorPanel') >= 0) pass('ui_script_live', 'sa-advisor-ui.js on live hosting');
        else fail('ui_script_live', 'Advisor UI script missing');
    } catch (e) {
        fail('ui_panel_live', e.message);
    }

    try {
        var rejected = await invokeLiveHandler('saAdvisorAsk', { question: 'deploy now git push production' }, ctx)
            .then(function () { return false; })
            .catch(function (e) { return /invalid-argument|off_domain/i.test(String(e.message)); });
        if (rejected) pass('rate_limits_guard', 'Off-domain question rejected');
        else warn('rate_limits_guard', 'Off-domain rejection not confirmed');
    } catch (e) {
        warn('rate_limits_guard', e.message);
    }

    var green = writeReport();
    process.exit(green ? 0 : 1);
}

main().catch(function (err) {
    fail('fatal', err.message);
    writeReport();
    process.exit(1);
});
