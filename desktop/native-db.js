// ============================================================================
// Madrasa EMS — Native Durable DB (backend selector)
// ----------------------------------------------------------------------------
// Runs in the Electron MAIN process (Node). Provides the ONE durable backend
// the browser Repository (window.emsRepo) talks to over IPC. It exposes the
// SAME contract everywhere (put/bulkPut/get/remove/clear/all/count/page) so the
// frontend NEVER knows which engine is underneath.
//
// Engine selection (best first):
//   1. Option B — better-sqlite3 (native SQLite file). Scales to 1,000,000+
//      records with indexed SQL queries. This is the default.
//   2. Option A — fs-JSON (plain JSON files). Durable fallback used only when
//      the better-sqlite3 native module is unavailable (e.g. not yet rebuilt
//      for the current Electron ABI), so the app is never left without storage.
//
// Both engines write into the OS application-data directory
// (Documents\MadrasaEMS_Data), completely immune to renderer "Clear Site Data".
// ============================================================================
'use strict';

var fs = require('fs');
var path = require('path');
var Q = require('../ems-query-utils.js');

// ---------------------------------------------------------------------------
// Option A — fs-JSON engine (durable fallback)
// ---------------------------------------------------------------------------
function createFsJsonDb(baseDir) {
    var dir = path.join(baseDir, 'collections');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }

    var cache = Object.create(null); // collection -> { id:record }

    function fileFor(collection) {
        return path.join(dir, encodeURIComponent(String(collection)) + '.json');
    }

    function load(collection) {
        if (cache[collection]) return cache[collection];
        var map = Object.create(null);
        try {
            var raw = fs.readFileSync(fileFor(collection), 'utf8');
            var obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') {
                Object.keys(obj).forEach(function (k) { map[k] = obj[k]; });
            }
        } catch (e) { /* new collection */ }
        cache[collection] = map;
        return map;
    }

    function persist(collection) {
        var map = load(collection);
        var tmp = fileFor(collection) + '.tmp';
        var final = fileFor(collection);
        try {
            fs.writeFileSync(tmp, JSON.stringify(map));
            fs.renameSync(tmp, final); // atomic replace — no half-written file
            return true;
        } catch (e) {
            return false;
        }
    }

    function values(collection) {
        var map = load(collection);
        return Object.keys(map).map(function (k) { return map[k]; });
    }

    return {
        isNative: true,
        engine: 'fs-json',
        baseDir: dir,

        put: function (collection, record) {
            if (!record || record.id == null) return Promise.resolve(false);
            load(collection)[String(record.id)] = record;
            return Promise.resolve(persist(collection));
        },
        bulkPut: function (collection, records) {
            var map = load(collection);
            var n = 0;
            (records || []).forEach(function (r) {
                if (r && r.id != null) { map[String(r.id)] = r; n++; }
            });
            persist(collection);
            return Promise.resolve(n);
        },
        get: function (collection, id) {
            return Promise.resolve(load(collection)[String(id)] || null);
        },
        remove: function (collection, id) {
            delete load(collection)[String(id)];
            return Promise.resolve(persist(collection));
        },
        clear: function (collection) {
            cache[collection] = Object.create(null);
            return Promise.resolve(persist(collection));
        },
        all: function (collection) {
            return Promise.resolve(values(collection));
        },
        count: function (collection, filter, search) {
            return Promise.resolve(Q.countFromAll(values(collection), filter, search));
        },
        page: function (collection, opts) {
            return Promise.resolve(Q.pageFromAll(values(collection), opts));
        }
    };
}

// ---------------------------------------------------------------------------
// Selector — prefer Option B (better-sqlite3), fall back to Option A (fs-JSON).
// ---------------------------------------------------------------------------
function createNativeDb(baseDir) {
    if (process.env.EMS_FORCE_FSJSON === '1') {
        return createFsJsonDb(baseDir);
    }
    try {
        var sqlite = require('./native-db-sqlite.js');
        return sqlite.createSqliteDb(baseDir);
    } catch (e) {
        try {
            console.warn('[native-db] better-sqlite3 unavailable — using fs-JSON fallback:', e && e.message);
        } catch (logErr) { /* ignore */ }
        return createFsJsonDb(baseDir);
    }
}

module.exports = {
    createNativeDb: createNativeDb,
    createFsJsonDb: createFsJsonDb
};
