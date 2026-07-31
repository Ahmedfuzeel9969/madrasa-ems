/**
 * EMS Android Asset Preflight — detect Web/Android IndexedDB and asset drift
 * Run before Android release builds. Exits 1 on mismatch.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ANDROID_PUBLIC = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');
const SYNC_MANIFEST = path.join(ANDROID_PUBLIC, '.ems-android-sync.json');

/** Files that must byte-match between dist/ and Android assets after cap sync */
const IMPORTANT_FILES = [
    'ems-search-index.js',
    'ems-idb-engine.js',
    'ems-sync-cursor-idb.js',
    'ems-sw-update.js',
    'ems-outbox-lock.js',
    'ems-offline-write.js',
    'cache-policy.js',
    'service-worker.js',
    'core.js',
    'index.html',
    'ems-post-auth-loader.js'
];

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readDbVersion(filePath) {
    if (!fs.existsSync(filePath)) return null;
    var text = fs.readFileSync(filePath, 'utf8');
    var match = text.match(/DB_VERSION\s*=\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function readJsonSafe(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
    console.error('[FAIL] ' + message);
    process.exit(1);
}

function ok(message) {
    console.log('[OK] ' + message);
}

function warn(message) {
    console.warn('[WARN] ' + message);
}

function getDistBuiltAt() {
    var manifestPath = path.join(DIST, '.hosting-manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    return readJsonSafe(manifestPath).builtAt || null;
}

function buildFileHashes(baseDir, relPaths) {
    var out = {};
    relPaths.forEach(function (rel) {
        var fp = path.join(baseDir, rel);
        if (fs.existsSync(fp)) {
            out[rel] = sha256File(fp);
        }
    });
    return out;
}

function runPreflight(opts) {
    opts = opts || {};
    console.log('=== EMS Android Asset Preflight ===\n');

    if (opts.simulateMismatch) {
        fail('Simulated Android/Web asset mismatch (test mode)');
    }

    if (!fs.existsSync(DIST)) {
        fail('dist/ missing — run: npm run build:hosting');
    }
    if (!fs.existsSync(ANDROID_PUBLIC)) {
        fail('Android assets missing — run: npm run android:sync');
    }

    var sourceIdb = path.join(ROOT, 'ems-idb-engine.js');
    var distIdb = path.join(DIST, 'ems-idb-engine.js');
    var androidIdb = path.join(ANDROID_PUBLIC, 'ems-idb-engine.js');

    var webDb = readDbVersion(sourceIdb);
    var distDb = readDbVersion(distIdb);
    var androidDb = readDbVersion(androidIdb);

    if (webDb == null) fail('Could not read DB_VERSION from source ems-idb-engine.js');
    if (distDb == null) fail('Could not read DB_VERSION from dist/ems-idb-engine.js');
    if (androidDb == null) fail('Could not read DB_VERSION from Android ems-idb-engine.js');

    console.log('[INFO] DB_VERSION — source: ' + webDb + ', dist: ' + distDb + ', android: ' + androidDb);

    if (webDb !== distDb) {
        fail('dist/ is stale — source DB_VERSION=' + webDb + ' but dist=' + distDb + '. Run: npm run build:hosting');
    }
    if (webDb !== androidDb) {
        fail('Android asset drift — Web DB_VERSION=' + webDb + ' but Android=' + androidDb + '. Run: npm run android:sync');
    }
    ok('DB_VERSION aligned at ' + webDb);

    var mismatches = [];
    var missingAndroid = [];
    IMPORTANT_FILES.forEach(function (rel) {
        var distPath = path.join(DIST, rel);
        var androidPath = path.join(ANDROID_PUBLIC, rel);
        if (!fs.existsSync(distPath)) {
            warn('dist file missing (skipped): ' + rel);
            return;
        }
        if (!fs.existsSync(androidPath)) {
            missingAndroid.push(rel);
            return;
        }
        if (sha256File(distPath) !== sha256File(androidPath)) {
            mismatches.push(rel);
        }
    });

    if (missingAndroid.length) {
        fail('Android assets missing files present in dist: ' + missingAndroid.join(', ') + '. Run: npm run android:sync');
    }
    if (mismatches.length) {
        fail('Android assets stale vs dist for: ' + mismatches.join(', ') + '. Run: npm run android:sync');
    }
    ok('Important files match dist/ (' + IMPORTANT_FILES.length + ' checked)');

    var distBuiltAt = getDistBuiltAt();
    if (!distBuiltAt) {
        fail('dist/.hosting-manifest.json missing builtAt — rebuild dist');
    }
    ok('dist builtAt: ' + distBuiltAt);

    if (fs.existsSync(SYNC_MANIFEST)) {
        var syncMeta = readJsonSafe(SYNC_MANIFEST);
        if (syncMeta.distBuiltAt !== distBuiltAt) {
            fail('Android sync manifest is stale — synced for dist builtAt=' + syncMeta.distBuiltAt + ', current dist=' + distBuiltAt + '. Run: npm run android:sync');
        }
        var currentHashes = buildFileHashes(DIST, IMPORTANT_FILES);
        IMPORTANT_FILES.forEach(function (rel) {
            if (!currentHashes[rel] || !syncMeta.files || !syncMeta.files[rel]) return;
            if (currentHashes[rel] !== syncMeta.files[rel]) {
                fail('Sync manifest hash mismatch for ' + rel + ' — run: npm run android:sync');
            }
        });
        ok('Android sync manifest matches current dist (syncedAt: ' + (syncMeta.syncedAt || 'unknown') + ')');
    } else {
        warn('No .ems-android-sync.json — run npm run android:sync to record sync metadata');
    }

    console.log('\n=== Android Asset Preflight PASSED ===\n');
    return {
        webDb: webDb,
        distDb: distDb,
        androidDb: androidDb,
        distBuiltAt: distBuiltAt
    };
}

function writeSyncManifest() {
    if (!fs.existsSync(DIST)) {
        fail('dist/ missing — cannot write sync manifest');
    }
    if (!fs.existsSync(ANDROID_PUBLIC)) {
        fail('Android assets missing — run cap sync first');
    }

    var distBuiltAt = getDistBuiltAt();
    if (!distBuiltAt) {
        fail('dist/.hosting-manifest.json missing builtAt');
    }

    var manifest = {
        distBuiltAt: distBuiltAt,
        syncedAt: new Date().toISOString(),
        files: buildFileHashes(DIST, IMPORTANT_FILES)
    };

    fs.writeFileSync(SYNC_MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
    ok('Wrote ' + path.relative(ROOT, SYNC_MANIFEST));
}

var args = process.argv.slice(2);
if (args.indexOf('--write-sync-manifest') >= 0) {
    writeSyncManifest();
    process.exit(0);
}

runPreflight({
    simulateMismatch: args.indexOf('--simulate-mismatch') >= 0
});

module.exports = {
    ROOT: ROOT,
    DIST: DIST,
    ANDROID_PUBLIC: ANDROID_PUBLIC,
    IMPORTANT_FILES: IMPORTANT_FILES,
    readDbVersion: readDbVersion,
    sha256File: sha256File,
    runPreflight: runPreflight,
    writeSyncManifest: writeSyncManifest
};
