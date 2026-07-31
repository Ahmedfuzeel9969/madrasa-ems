'use strict';

const admin = require('firebase-admin');

var bundleCache = {
    version: null,
    meta: null,
    files: [],
    modules: [],
    features: [],
    weaknesses: [],
    decisions: [],
    bugs: [],
    roadmap: [],
    tests: []
};

async function loadCollection(name, limit) {
    limit = limit || 600;
    var snap = await admin.firestore().collection(name).limit(limit).get();
    return snap.docs.map(function (d) { return d.data(); });
}

async function loadCmiBundle(force) {
    var db = admin.firestore();
    var metaSnap = await db.collection('Platform_CmiMeta').doc('current').get();
    if (!metaSnap.exists) {
        var err = new Error('CMI not synced to Firestore');
        err.code = 'cmi_missing';
        throw err;
    }
    var meta = metaSnap.data();
    if (!force && bundleCache.version === meta.cmiVersion && bundleCache.files.length > 0) {
        return bundleCache;
    }

    var results = await Promise.all([
        Promise.resolve(meta),
        loadCollection('Platform_CmiFiles'),
        loadCollection('Platform_CmiModules'),
        loadCollection('Platform_CmiFeatures'),
        loadCollection('Platform_CmiWeaknesses'),
        loadCollection('Platform_CmiDecisions'),
        loadCollection('Platform_CmiBugs'),
        loadCollection('Platform_CmiRoadmap'),
        loadCollection('Platform_CmiTests', 20)
    ]);

    bundleCache = {
        version: meta.cmiVersion,
        meta: results[0],
        files: results[1],
        modules: results[2],
        features: results[3],
        weaknesses: results[4],
        decisions: results[5],
        bugs: results[6],
        roadmap: results[7],
        tests: results[8]
    };
    return bundleCache;
}

function clearCmiCache() {
    bundleCache.version = null;
    bundleCache.files = [];
}

async function loadAdvisorConfig() {
    var snap = await admin.firestore().collection('Platform_Config').doc('sa_advisor').get();
    if (!snap.exists) return null;
    return snap.data();
}

module.exports = {
    loadCmiBundle: loadCmiBundle,
    clearCmiCache: clearCmiCache,
    loadAdvisorConfig: loadAdvisorConfig
};
