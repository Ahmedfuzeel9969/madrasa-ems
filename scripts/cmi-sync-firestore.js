#!/usr/bin/env node
'use strict';

/**
 * Sync local .cmi/ index → Firestore (Platform_Cmi* collections).
 * Requires: firebase-admin + Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS
 * Usage: npm run cmi:sync-firestore
 */
var path = require('path');
var fs = require('fs');
var admin = require('../functions/node_modules/firebase-admin');
var storage = require('./cmi/storage');

var BATCH_SIZE = 400;
var ROOT = path.resolve(__dirname, '..');

if (!admin.apps.length) {
    var projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'madrasa-mangment-app';
    admin.initializeApp({ projectId: projectId });
}

var db = admin.firestore();

function listJsonRecords(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(function (f) { return f.endsWith('.json'); })
        .map(function (f) {
            return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        });
}

async function commitBatch(writes) {
    for (var i = 0; i < writes.length; i += BATCH_SIZE) {
        var batch = db.batch();
        writes.slice(i, i + BATCH_SIZE).forEach(function (w) {
            batch.set(w.ref, w.data, { merge: true });
        });
        await batch.commit();
    }
}

async function syncCollection(colName, records, idField) {
    idField = idField || 'id';
    var writes = records.map(function (rec) {
        var id = rec[idField] || rec.fileId || rec.moduleId || rec.featureId
            || rec.weakId || rec.decisionId || rec.bugId || rec.snapshotId || rec.runId;
        if (!id) return null;
        return { ref: db.collection(colName).doc(String(id)), data: rec };
    }).filter(Boolean);
    await commitBatch(writes);
    return writes.length;
}

async function seedAdvisorConfig(meta) {
    var ref = db.collection('Platform_Config').doc('sa_advisor');
    var snap = await ref.get();
    var existing = snap.exists ? snap.data() : {};
    await ref.set({
        enabled: false,
        stagingEnabled: true,
        productionEnabled: false,
        queriesPerAdminPerDay: 30,
        queriesPlatformPerDay: 100,
        monthlyCostCapUsd: 50,
        monthlyTokenBudget: 500000,
        hardStopAtCap: true,
        maxPscBytes: 32768,
        maxOutputTokens: 2048,
        cacheHitsFree: true,
        cmiVersion: meta.cmiVersion,
        cmiSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        note: existing.note || 'Staging only — enabled must stay false until production approval'
    }, { merge: true });
}

async function main() {
    var meta = storage.loadMeta();
    if (!meta) {
        console.error('[CMI Sync] No local index — run: npm run cmi:build');
        process.exit(1);
    }

    console.log('[CMI Sync] Uploading CMI v' + meta.cmiVersion + ' @ ' + meta.gitSha);

    var p = storage.paths();
    var counts = {};

    await db.collection('Platform_CmiMeta').doc('current').set(Object.assign({}, meta, {
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncSource: 'cmi-sync-firestore.js'
    }), { merge: true });
    counts.meta = 1;

    var graph = storage.loadDependencyGraph();
    await db.collection('Platform_CmiMeta').doc('dependencyGraph').set(graph);
    counts.graph = 1;

    counts.files = await syncCollection('Platform_CmiFiles', listJsonRecords(p.filesDir));
    counts.modules = await syncCollection('Platform_CmiModules', listJsonRecords(p.modulesDir));
    counts.features = await syncCollection('Platform_CmiFeatures', listJsonRecords(p.featuresDir));
    counts.weaknesses = await syncCollection('Platform_CmiWeaknesses', listJsonRecords(p.weaknessesDir));
    counts.decisions = await syncCollection('Platform_CmiDecisions', listJsonRecords(p.decisionsDir));
    counts.bugs = await syncCollection('Platform_CmiBugs', listJsonRecords(p.bugsDir));
    counts.roadmap = await syncCollection('Platform_CmiRoadmap', listJsonRecords(p.roadmapDir));
    counts.tests = await syncCollection('Platform_CmiTests', listJsonRecords(p.testsDir), 'runId');

    await seedAdvisorConfig(meta);

    console.log('[CMI Sync] OK', JSON.stringify(counts));
    process.exit(0);
}

main().catch(function (err) {
    console.error('[CMI Sync] FAILED', err.message || err);
    process.exit(1);
});
