#!/usr/bin/env node
'use strict';

/**
 * Create Generative Language API key and store in Secret Manager (staging bootstrap).
 * Requires Firebase CLI login (ADC bridge).
 */
var path = require('path');
var os = require('os');
var fs = require('fs');
var { execSync } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var PROJECT_NUM = '529775229216';
var SECRET_NAME = 'platform-gemini-advisor-key';

async function setupCliCredentials() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
    var cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    var dc = require(path.join(ROOT, 'node_modules/firebase-tools/lib/defaultCredentials'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = await dc.getCredentialPathAsync({
        user: cfg.user,
        tokens: cfg.tokens
    });
}

async function main() {
    await setupCliCredentials();
    var { GoogleAuth } = require(path.join(ROOT, 'functions/node_modules/google-auth-library'));
    var auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    var client = await auth.getClient();

    try {
        execSync('firebase functions:secrets:access ' + SECRET_NAME + ' --project ' + PROJECT, {
            cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe']
        });
        console.log('[OK] Secret already exists:', SECRET_NAME);
        return;
    } catch (e) { /* create */ }

    console.log('[INFO] Creating Generative Language API key...');
    var create = await client.request({
        url: 'https://apikeys.googleapis.com/v2/projects/' + PROJECT_NUM + '/locations/global/keys',
        method: 'POST',
        data: {
            displayName: 'sa-advisor-staging-gemini',
            restrictions: { apiTargets: [{ service: 'generativelanguage.googleapis.com' }] }
        }
    });

    var opName = create.data.name;
    var done = null;
    for (var i = 0; i < 15; i++) {
        await new Promise(function (r) { setTimeout(r, 2000); });
        var st = await client.request({ url: 'https://apikeys.googleapis.com/v2/' + opName });
        if (st.data.done) {
            done = st.data.response;
            break;
        }
    }
    if (!done || !done.name) throw new Error('API key creation timed out');

    var keyRes = await client.request({
        url: 'https://apikeys.googleapis.com/v2/' + done.name + '/keyString'
    });
    var key = keyRes.data.keyString;
    if (!key || key.length < 20) throw new Error('Invalid key returned');

    var tmp = path.join(os.tmpdir(), 'sa-gemini-key-' + Date.now() + '.txt');
    fs.writeFileSync(tmp, key, { mode: 0o600 });
    try {
        var payload = Buffer.from(key, 'utf8').toString('base64');
        try {
            await client.request({
                url: 'https://secretmanager.googleapis.com/v1/projects/' + PROJECT + '/secrets?secretId=' + SECRET_NAME,
                method: 'POST',
                data: { replication: { automatic: {} } }
            });
        } catch (eCreate) {
            if (!String(eCreate.message || '').includes('Already exists') && eCreate.response?.status !== 409) {
                throw eCreate;
            }
        }
        await client.request({
            url: 'https://secretmanager.googleapis.com/v1/projects/' + PROJECT + '/secrets/' + SECRET_NAME + ':addVersion',
            method: 'POST',
            data: { payload: { data: payload } }
        });
        var sa = PROJECT + '@appspot.gserviceaccount.com';
        var resource = 'projects/' + PROJECT + '/secrets/' + SECRET_NAME;
        try {
            await client.request({
                url: 'https://secretmanager.googleapis.com/v1/' + resource + ':getIamPolicy',
                method: 'GET'
            }).then(async function (pol) {
                var binding = (pol.data.bindings || []).find(function (b) {
                    return b.role === 'roles/secretmanager.secretAccessor';
                });
                if (!binding) binding = { role: 'roles/secretmanager.secretAccessor', members: [] };
                var member = 'serviceAccount:' + sa;
                if (binding.members.indexOf(member) < 0) binding.members.push(member);
                var others = (pol.data.bindings || []).filter(function (b) {
                    return b.role !== 'roles/secretmanager.secretAccessor';
                });
                await client.request({
                    url: 'https://secretmanager.googleapis.com/v1/' + resource + ':setIamPolicy',
                    method: 'POST',
                    data: { policy: { bindings: others.concat([binding]) } }
                });
            });
        } catch (eIam) {
            console.warn('[WARN] IAM grant may need manual step:', eIam.message);
        }
    } finally {
        try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
    }
    console.log('[OK] Secret created:', SECRET_NAME);
}

main().catch(function (err) {
    console.error('[FAIL]', err.message);
    process.exit(1);
});
