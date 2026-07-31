// ============================================================================
// Madrasa EMS — Native Durable DB (Option B: better-sqlite3 engine)
// ----------------------------------------------------------------------------
// Runs in the Electron MAIN process (Node). Stores ALL collections in ONE
// SQLite database file inside the OS application-data directory
// (Documents\MadrasaEMS_Data\madrasa-ems.sqlite), exactly like the WhatsApp
// desktop model — a real on-disk database file completely immune to the
// renderer's "Clear Site Data" / browser cache lifecycle.
//
// It implements the EXACT SAME contract the browser Repository expects
// (put/bulkPut/get/remove/clear/all/count/page), so window.emsRepo and the
// entire frontend (pagination, filters, search, state) keep working unchanged.
//
// Performance at the 1,000,000-record scale:
//   • Instant search  — FTS5 (trigram) virtual table gives indexed substring
//     search, replacing the O(N) LIKE scan. FTS returns a candidate superset
//     which is then filtered through the shared ems-query-utils engine, so the
//     result is byte-for-byte identical to the other backends.
//   • Deep pagination — Keyset (seek) pagination. Sequentially paging forward
//     seeks from a remembered cursor, so page 10,000 is as fast as page 1
//     (O(limit) instead of O(offset)). OFFSET is used only as a correct
//     fallback for cold random jumps.
// The public offset-based contract is UNCHANGED; keyset happens internally.
// ============================================================================
'use strict';

var fs = require('fs');
var path = require('path');
var Q = require('../ems-query-utils.js');

// Text fields indexed for full-text search. MUST cover the fields the frontend
// search box queries (see admission.js renderRegTableViaRepo) so the FTS blob
// is a superset of any requested-field match.
var INDEXED_FIELDS = ['name', 'fname', 'id', 'cnic', 'phone', 'class', 'designation', 'position'];

var SIMPLE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function jsonPathLiteral(key) {
    var k = String(key);
    if (SIMPLE_KEY.test(k)) return "'$." + k + "'";
    var esc = k.replace(/"/g, '""').replace(/'/g, "''");
    return "'$.\"" + esc + "\"'";
}

function jsonExtract(key, dataRef) {
    return 'json_extract(' + (dataRef || 'data') + ', ' + jsonPathLiteral(key) + ')';
}

/** SQL expression concatenating the indexed fields into one FTS document. */
function searchTextSql(dataRef) {
    return INDEXED_FIELDS.map(function (f) {
        return "coalesce(json_extract(" + dataRef + ", '$." + f + "'), '')";
    }).join(" || char(10) || ");
}

/** Escape LIKE wildcards so a term is matched literally (ESCAPE '\'). */
function escapeLike(text) {
    return String(text).replace(/[\\%_]/g, function (ch) { return '\\' + ch; });
}

function createSqliteDb(baseDir) {
    var Database = require('better-sqlite3');

    try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) { /* ignore */ }
    var dbFile = path.join(baseDir, 'madrasa-ems.sqlite');

    var db = new Database(dbFile);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('foreign_keys = OFF');

    // Core table: one row per record of any collection. seq = monotonic
    // insertion order (drives default/unsorted ordering + keyset tiebreaker).
    db.exec(
        'CREATE TABLE IF NOT EXISTS items (' +
        '  seq  INTEGER PRIMARY KEY AUTOINCREMENT,' +
        '  coll TEXT NOT NULL,' +
        '  id   TEXT NOT NULL,' +
        '  data TEXT NOT NULL' +
        ');' +
        'CREATE UNIQUE INDEX IF NOT EXISTS ux_items_coll_id ON items(coll, id);' +
        "CREATE INDEX IF NOT EXISTS ix_items_type   ON items(coll, json_extract(data, '$.type'), seq);" +
        "CREATE INDEX IF NOT EXISTS ix_items_status ON items(coll, json_extract(data, '$.status'), seq);" +
        // Directional composite indexes so the hot registration list
        // (ORDER BY timestamp DESC/ASC, seq ASC) + keyset range is served
        // straight from an index with NO sort step, even at deep offsets.
        "CREATE INDEX IF NOT EXISTS ix_items_ts_desc ON items(coll, json_extract(data, '$.timestamp') DESC, seq ASC);" +
        "CREATE INDEX IF NOT EXISTS ix_items_ts_asc  ON items(coll, json_extract(data, '$.timestamp') ASC,  seq ASC);" +
        'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);'
    );

    var stmtCache = new Map();
    function prep(sql) {
        var s = stmtCache.get(sql);
        if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
        return s;
    }

    var UPSERT_SQL =
        'INSERT INTO items (coll, id, data) VALUES (?, ?, ?) ' +
        'ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data';

    function getMeta(k) {
        var row = prep('SELECT v FROM meta WHERE k = ?').get(k);
        return row ? row.v : null;
    }
    function setMeta(k, v) {
        prep('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
    }

    // ---- FTS5 (trigram) full-text search — indexed substring matching ------
    var ftsAvailable = false;
    try {
        db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(content, tokenize = 'trigram');");

        // Backfill FTS from any pre-existing rows (e.g. DBs migrated before FTS
        // existed) BEFORE creating triggers, so there are no duplicate entries.
        if (!getMeta('fts_built_v1')) {
            db.exec('DELETE FROM search_index;');
            db.prepare('INSERT INTO search_index(rowid, content) SELECT seq, ' + searchTextSql('data') + ' FROM items').run();
            setMeta('fts_built_v1', '1');
        }

        // Keep FTS in sync automatically for every future write.
        var contentNew = searchTextSql('new.data');
        db.exec(
            'CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN ' +
            '  INSERT INTO search_index(rowid, content) VALUES (new.seq, ' + contentNew + '); END;' +
            'CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN ' +
            '  DELETE FROM search_index WHERE rowid = old.seq; END;' +
            'CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN ' +
            '  DELETE FROM search_index WHERE rowid = old.seq; ' +
            '  INSERT INTO search_index(rowid, content) VALUES (new.seq, ' + contentNew + '); END;'
        );
        ftsAvailable = true;
    } catch (ftsErr) {
        // Trigram/FTS5 unavailable on this SQLite build — search falls back to
        // the correct (if slower) LIKE scan. Everything else still works.
        ftsAvailable = false;
        try { console.warn('[native-db-sqlite] FTS5/trigram unavailable, using LIKE search:', ftsErr && ftsErr.message); } catch (e) { /* ignore */ }
    }

    // ---- query caches (invalidated by a global write version) --------------
    var writeVersion = 0;
    function bumpWrite() { writeVersion++; }

    var countCache = new Map();  // sig -> { wv, n }
    var pageCache = new Map();   // sig -> { wv, total, cursors: Map<offset,{v,s}> }

    function pageEntry(sig) {
        var e = pageCache.get(sig);
        if (!e || e.wv !== writeVersion) {
            e = { wv: writeVersion, total: null, cursors: new Map() };
            pageCache.set(sig, e);
        }
        return e;
    }

    // ---- WHERE builders ----------------------------------------------------
    function buildFilterClause(collection, filter, dataRef, collRef) {
        var where = [(collRef || 'coll') + ' = ?'];
        var params = [String(collection)];
        if (filter && typeof filter === 'object') {
            Object.keys(filter).forEach(function (k) {
                if (!Object.prototype.hasOwnProperty.call(filter, k)) return;
                where.push(jsonExtract(k, dataRef) + ' = ?');
                params.push(filter[k]);
            });
        }
        return { clause: where.join(' AND '), params: params };
    }

    function buildWhereLike(collection, filter, search, dataRef, collRef) {
        var fw = buildFilterClause(collection, filter, dataRef, collRef);
        var where = [fw.clause];
        var params = fw.params.slice();
        if (search && search.text != null && String(search.text).length > 0) {
            var like = '%' + escapeLike(search.text) + '%';
            var fields = (search.fields && search.fields.length) ? search.fields : null;
            if (fields) {
                var ors = fields.map(function (f) {
                    params.push(like);
                    return jsonExtract(f, dataRef) + " LIKE ? ESCAPE '\\'";
                });
                where.push('(' + ors.join(' OR ') + ')');
            } else {
                where.push((dataRef || 'data') + " LIKE ? ESCAPE '\\'");
                params.push(like);
            }
        }
        return { clause: where.join(' AND '), params: params };
    }

    function buildOrder(sort) {
        if (!sort || !sort.field) return 'ORDER BY seq ASC';
        var dir = (sort.dir === 'desc') ? 'DESC' : 'ASC';
        return 'ORDER BY ' + jsonExtract(sort.field) + ' ' + dir + ', seq ASC';
    }

    // Keyset (seek) predicate for "rows strictly after this cursor" under the
    // ordering produced by buildOrder(). Written in SARGable form
    // (a plain range bound + a tiny residual for ties) so SQLite can use the
    // directional timestamp index as a range and skip the sort entirely.
    // Only used when the sort column has NO NULLs (see pageNoSearchKeyset),
    // which keeps the range bound correct (NULLs would sit outside `<=`/`>=`).
    function keysetCond(sort, cur) {
        if (!sort || !sort.field) {
            return { cond: 'seq > ?', params: [cur.s] };
        }
        var expr = jsonExtract(sort.field);
        var bound = (sort.dir === 'desc') ? ' <= ? ' : ' >= ? ';
        return {
            cond: '(' + expr + bound + 'AND NOT (' + expr + ' = ? AND seq <= ?))',
            params: [cur.v, cur.v, cur.s]
        };
    }

    // True if any row in the collection has a NULL value for the sort field.
    // Cached per (collection, field) via the write version.
    var nullFieldCache = new Map();
    function sortHasNulls(collection, field) {
        var key = String(collection) + '|' + field;
        var c = nullFieldCache.get(key);
        if (c && c.wv === writeVersion) return c.v;
        var row = prep('SELECT 1 AS x FROM items WHERE coll = ? AND ' + jsonExtract(field) + ' IS NULL LIMIT 1')
            .get(String(collection));
        var has = !!row;
        nullFieldCache.set(key, { wv: writeVersion, v: has });
        return has;
    }

    function makeCursor(sort, rawRow, parsed) {
        if (!sort || !sort.field) return { v: null, s: rawRow.seq };
        var v = parsed ? parsed[sort.field] : undefined;
        if (v === undefined || v === null) return null; // never seek from a NULL key
        return { v: v, s: rawRow.seq };
    }

    function normalizeOffset(opts) { return Math.max(0, (opts && opts.offset) || 0); }
    function normalizeLimit(opts) {
        if (!opts || opts.limit == null) return 100;
        return opts.limit;
    }

    function fieldsIndexed(fields) {
        if (!fields || !fields.length) return false; // all-fields search → not FTS-safe
        for (var i = 0; i < fields.length; i++) {
            if (INDEXED_FIELDS.indexOf(fields[i]) < 0) return false;
        }
        return true;
    }

    // ---- page() sub-paths --------------------------------------------------
    function pageViaFts(collection, opts) {
        var fw = buildFilterClause(collection, opts.filter, 'i.data', 'i.coll');
        var ftsQuery = '"' + String(opts.search.text).replace(/"/g, '""') + '"'; // phrase = substring for trigram
        var sql = 'SELECT i.data AS data FROM search_index s JOIN items i ON i.seq = s.rowid WHERE ' +
            fw.clause + ' AND s.content MATCH ?';
        var params = fw.params.concat([ftsQuery]);
        var candidates = prep(sql).all(params).map(function (r) { return JSON.parse(r.data); });
        // FTS returns a superset; ems-query-utils applies the EXACT
        // filter+search+sort+pagination → identical to every other backend.
        return Q.pageFromAll(candidates, opts);
    }

    function pageViaLike(collection, opts) {
        var offset = normalizeOffset(opts);
        var limit = normalizeLimit(opts);
        var w = buildWhereLike(collection, opts.filter, opts.search);
        var cr = prep('SELECT COUNT(*) AS n FROM items WHERE ' + w.clause).get(w.params);
        var total = cr ? cr.n : 0;
        var order = buildOrder(opts.sort);
        var sql, params;
        if (limit < 0) {
            sql = 'SELECT data FROM items WHERE ' + w.clause + ' ' + order + ' LIMIT -1 OFFSET ?';
            params = w.params.concat([offset]);
        } else {
            sql = 'SELECT data FROM items WHERE ' + w.clause + ' ' + order + ' LIMIT ? OFFSET ?';
            params = w.params.concat([limit, offset]);
        }
        var rows = prep(sql).all(params).map(function (r) { return JSON.parse(r.data); });
        return { rows: rows, total: total, offset: offset, limit: limit };
    }

    function pageNoSearchKeyset(collection, opts) {
        var offset = normalizeOffset(opts);
        var limit = normalizeLimit(opts);
        var filter = opts.filter;
        var sort = opts.sort;

        var fw = buildFilterClause(collection, filter);
        var sig = String(collection) + '|' + JSON.stringify(filter || null) + '|' + JSON.stringify(sort || null);
        var entry = pageEntry(sig);

        if (entry.total == null) {
            var cr = prep('SELECT COUNT(*) AS n FROM items WHERE ' + fw.clause).get(fw.params);
            entry.total = cr ? cr.n : 0;
        }
        var total = entry.total;

        // Keyset is only correct + index-friendly when the sort column has no
        // NULLs (a NULL region can't be expressed as a single range bound).
        // With NULLs present we fall back to plain OFFSET (still correct).
        var keysetOk = !sort || !sort.field || !sortHasNulls(collection, sort.field);

        // Nearest remembered cursor at or before the requested offset.
        var best = null, bestOff = 0;
        if (keysetOk) {
            entry.cursors.forEach(function (cur, off) {
                if (off <= offset && off > bestOff) { bestOff = off; best = cur; }
            });
        }

        var where = fw.clause;
        var params = fw.params.slice();
        if (best) {
            var ks = keysetCond(sort, best);
            where += ' AND ' + ks.cond;
            params = params.concat(ks.params);
        }
        var residual = offset - bestOff; // 0 for sequential paging → pure keyset

        var order = buildOrder(sort);
        var sql, p2;
        if (limit < 0) {
            sql = 'SELECT seq, data FROM items WHERE ' + where + ' ' + order + ' LIMIT -1 OFFSET ?';
            p2 = params.concat([residual]);
        } else {
            sql = 'SELECT seq, data FROM items WHERE ' + where + ' ' + order + ' LIMIT ? OFFSET ?';
            p2 = params.concat([limit, residual]);
        }

        var raw = prep(sql).all(p2);
        var rows = raw.map(function (r) { return JSON.parse(r.data); });

        // Remember the boundary so the NEXT sequential page is a pure seek.
        if (raw.length && limit >= 0 && keysetOk) {
            var lastRaw = raw[raw.length - 1];
            var cursor = makeCursor(sort, lastRaw, rows[rows.length - 1]);
            if (cursor) entry.cursors.set(offset + raw.length, cursor);
        }

        return { rows: rows, total: total, offset: offset, limit: limit };
    }

    function computeCount(collection, filter, search) {
        var w = buildWhereLike(collection, filter, search);
        var row = prep('SELECT COUNT(*) AS n FROM items WHERE ' + w.clause).get(w.params);
        return row ? row.n : 0;
    }

    // ---- one-time migration of the legacy fs-JSON collections --------------
    function migrateFromFsJsonIfNeeded() {
        if (getMeta('migrated_fsjson')) return;
        var colDir = path.join(baseDir, 'collections');
        var files = [];
        try {
            if (fs.existsSync(colDir)) {
                files = fs.readdirSync(colDir).filter(function (f) { return /\.json$/i.test(f); });
            }
        } catch (e) { files = []; }

        if (files.length) {
            var insert = prep(UPSERT_SQL);
            var importAll = db.transaction(function () {
                files.forEach(function (f) {
                    try {
                        var coll = decodeURIComponent(f.replace(/\.json$/i, ''));
                        var raw = fs.readFileSync(path.join(colDir, f), 'utf8');
                        var obj = JSON.parse(raw);
                        if (obj && typeof obj === 'object') {
                            Object.keys(obj).forEach(function (k) {
                                var rec = obj[k];
                                if (rec && rec.id != null) {
                                    insert.run(coll, String(rec.id), JSON.stringify(rec));
                                }
                            });
                        }
                    } catch (fileErr) { /* skip corrupt file, continue */ }
                });
            });
            try { importAll(); } catch (txErr) { /* best-effort */ }
        }
        setMeta('migrated_fsjson', '1');
    }

    migrateFromFsJsonIfNeeded();

    // ---- public contract (identical to fs-JSON / IndexedDB backends) -------
    return {
        isNative: true,
        engine: 'better-sqlite3',
        baseDir: dbFile,
        ftsAvailable: function () { return ftsAvailable; },

        put: function (collection, record) {
            if (!record || record.id == null) return Promise.resolve(false);
            prep(UPSERT_SQL).run(String(collection), String(record.id), JSON.stringify(record));
            bumpWrite();
            return Promise.resolve(true);
        },

        bulkPut: function (collection, records) {
            var insert = prep(UPSERT_SQL);
            var coll = String(collection);
            var run = db.transaction(function (rows) {
                var n = 0;
                for (var i = 0; i < rows.length; i++) {
                    var r = rows[i];
                    if (r && r.id != null) {
                        insert.run(coll, String(r.id), JSON.stringify(r));
                        n++;
                    }
                }
                return n;
            });
            var count = run(records || []);
            bumpWrite();
            return Promise.resolve(count);
        },

        get: function (collection, id) {
            var row = prep('SELECT data FROM items WHERE coll = ? AND id = ?')
                .get(String(collection), String(id));
            return Promise.resolve(row ? JSON.parse(row.data) : null);
        },

        remove: function (collection, id) {
            prep('DELETE FROM items WHERE coll = ? AND id = ?').run(String(collection), String(id));
            bumpWrite();
            return Promise.resolve(true);
        },

        clear: function (collection) {
            prep('DELETE FROM items WHERE coll = ?').run(String(collection));
            bumpWrite();
            return Promise.resolve(true);
        },

        all: function (collection) {
            var rows = prep('SELECT data FROM items WHERE coll = ? ORDER BY seq ASC').all(String(collection));
            return Promise.resolve(rows.map(function (r) { return JSON.parse(r.data); }));
        },

        count: function (collection, filter, search) {
            var key = String(collection) + '|' + JSON.stringify(filter || null) + '|' + JSON.stringify(search || null);
            var c = countCache.get(key);
            if (c && c.wv === writeVersion) return Promise.resolve(c.n);
            var n = computeCount(collection, filter, search);
            countCache.set(key, { wv: writeVersion, n: n });
            return Promise.resolve(n);
        },

        page: function (collection, opts) {
            opts = opts || {};
            var search = opts.search;
            var hasText = search && search.text != null && String(search.text).length > 0;

            if (hasText && ftsAvailable && String(search.text).length >= 3 && fieldsIndexed(search.fields)) {
                return Promise.resolve(pageViaFts(collection, opts));  // FTS fast path
            }
            if (hasText) {
                return Promise.resolve(pageViaLike(collection, opts)); // correct LIKE fallback
            }
            return Promise.resolve(pageNoSearchKeyset(collection, opts)); // keyset/seek path
        },

        // Maintenance helpers (not part of the renderer contract).
        _raw: db,
        close: function () { try { db.close(); } catch (e) { /* ignore */ } }
    };
}

module.exports = { createSqliteDb: createSqliteDb };
