// Isolated index-build profiler — bench only, does not modify production modules.
(function (global) {
    'use strict';

    var DB_NAME = 'ems_durable_v1';
    var COL_STORE = 'collections';
    var SEARCH_STORE = 'search_tokens';
    var TENANT = 'bench_profile_tenant';
    var COL = 'registrations';
    var BATCH_ROWS = 100;

    function log(msg) {
        var el = document.getElementById('profile-log');
        if (el) el.textContent += msg + '\n';
        console.log('[index-profile]', msg);
    }

    function setStatus(msg) {
        var el = document.getElementById('profile-status');
        if (el) el.textContent = msg;
    }

    function nowMs() {
        return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    }

    function round(x) {
        return Math.round(x * 1000) / 1000;
    }

    function pct(part, total) {
        if (!total) return 0;
        return round((part / total) * 100);
    }

    function memSnapshot() {
        var m = global.performance && global.performance.memory;
        if (!m) return { available: false };
        return {
            available: true,
            usedJSHeapMb: round(m.usedJSHeapSize / (1024 * 1024)),
            totalJSHeapMb: round(m.totalJSHeapSize / (1024 * 1024)),
            heapLimitMb: round(m.jsHeapSizeLimit / (1024 * 1024))
        };
    }

    function makeRow(i) {
        return {
            id: 'STU-' + String(i).padStart(6, '0'),
            type: (i % 7 === 0) ? 'teacher' : 'student',
            status: (i % 5 === 0) ? 'pending' : 'approved',
            name: 'طالب ' + i,
            fname: 'ولی ' + i,
            class: 'جماعت ' + (i % 12 + 1),
            phone: '0300' + String(1000000 + i),
            cnic: String(3520000000000 + i),
            timestamp: Date.now() - i * 60000
        };
    }

    function makeRows(n) {
        var rows = new Array(n);
        for (var i = 0; i < n; i++) rows[i] = makeRow(i);
        return rows;
    }

    function openDb() {
        return global.emsIdbReady().then(function () {
            return new Promise(function (resolve, reject) {
                var req = global.indexedDB.open(DB_NAME);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function scopedCollection() {
        return TENANT + '__' + COL;
    }

    function searchTokenPk(collection, token, rowId) {
        return String(collection) + '::' + String(token) + '::' + String(rowId);
    }

    function searchRowDocPk(collection, rowId) {
        return String(collection) + '::@idx::' + String(rowId);
    }

    function searchStubFromRow(row) {
        return {
            rowId: String(row.id),
            type: row.type || '',
            status: row.status || '',
            class: row.class || '',
            _ts: Number(row._ts) || Number(row.timestamp) || 0,
            _tsNeg: Number(row._tsNeg) || -(Number(row.timestamp) || 0)
        };
    }

    /** Stage 1 — cursor read (production incremental path uses cursor, not colAll). */
    function cursorReadCollection(collection) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var rows = [];
                var tx = db.transaction([COL_STORE], 'readonly');
                var idx = tx.objectStore(COL_STORE).index('col');
                var cur = idx.openCursor(IDBKeyRange.only(String(collection)));
                cur.onsuccess = function (ev) {
                    var c = ev.target.result;
                    if (!c) { resolve(rows); return; }
                    rows.push(c.value);
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        });
    }

    /** Stage 2 — token generation only (in-memory). */
    function generateTokensForRows(rows) {
        var totalTokens = 0;
        var perRow = new Array(rows.length);
        for (var i = 0; i < rows.length; i++) {
            var tokens = global.emsSearchIndexTokensForRow(rows[i]) || [];
            perRow[i] = tokens;
            totalTokens += tokens.length;
        }
        return { perRowTokens: perRow, totalTokens: totalTokens };
    }

    /** Stage 4a — production-style batch: one IDB put per row (grouped token bucket). */
    function writeRowsBatchTx(collection, rows, perRowTokens) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction([SEARCH_STORE], 'readwrite');
                var os = tx.objectStore(SEARCH_STORE);
                var putCalls = 0;
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var stub = searchStubFromRow(row);
                    os.put({
                        _pk: searchRowDocPk(collection, stub.rowId),
                        _col: String(collection),
                        rowId: stub.rowId,
                        tokens: perRowTokens[i] || [],
                        idxVer: 3,
                        type: stub.type,
                        status: stub.status,
                        class: stub.class,
                        _ts: stub._ts,
                        _tsNeg: stub._tsNeg
                    });
                    putCalls++;
                }
                tx.oncomplete = function () {
                    resolve({ transactionCount: 1, idbPutCalls: putCalls });
                };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    /** Stage 4b — one IDB transaction per token (worst-case comparison). */
    function writeTokensPerTokenTx(collection, rows, perRowTokens, maxRows) {
        maxRows = maxRows == null ? rows.length : Math.min(maxRows, rows.length);
        var chain = Promise.resolve({ transactionCount: 0, idbPutCalls: 0 });
        for (var i = 0; i < maxRows; i++) {
            (function (rowIndex) {
                chain = chain.then(function (acc) {
                    return openDb().then(function (db) {
                        return new Promise(function (resolve, reject) {
                            var row = rows[rowIndex];
                            var stub = searchStubFromRow(row);
                            var tokens = perRowTokens[rowIndex] || [];
                            var tx = db.transaction([SEARCH_STORE], 'readwrite');
                            var os = tx.objectStore(SEARCH_STORE);
                            for (var j = 0; j < tokens.length; j++) {
                                os.put({
                                    _pk: searchTokenPk(collection, tokens[j], stub.rowId),
                                    _col: String(collection),
                                    token: tokens[j],
                                    rowId: stub.rowId,
                                    type: stub.type,
                                    status: stub.status,
                                    class: stub.class,
                                    _ts: stub._ts,
                                    _tsNeg: stub._tsNeg
                                });
                            }
                            tx.oncomplete = function () {
                                resolve({
                                    transactionCount: acc.transactionCount + tokens.length,
                                    idbPutCalls: acc.idbPutCalls + tokens.length
                                });
                            };
                            tx.onerror = function () { reject(tx.error); };
                        });
                    });
                });
            })(i);
        }
        return chain;
    }

    function chunkBulkPut(repo, rows, chunkSize) {
        chunkSize = chunkSize || 500;
        var chain = Promise.resolve(0);
        for (var i = 0; i < rows.length; i += chunkSize) {
            (function (slice) {
                chain = chain.then(function (n) {
                    return repo.bulkPut(COL, slice).then(function (c) { return n + c; });
                });
            })(rows.slice(i, i + chunkSize));
        }
        return chain;
    }

    function summarizeTokenCounts(perRowTokens) {
        var sum = 0;
        var min = Infinity;
        var max = 0;
        for (var i = 0; i < perRowTokens.length; i++) {
            var n = perRowTokens[i].length;
            sum += n;
            if (n < min) min = n;
            if (n > max) max = n;
        }
        return {
            avg: perRowTokens.length ? round(sum / perRowTokens.length) : 0,
            min: min === Infinity ? 0 : min,
            max: max
        };
    }

    global.runIndexBuildProfile = function (opts) {
        opts = opts || {};
        var scales = opts.scales || [1000, 10000];
        var repo = global.emsRepo;
        var collection = scopedCollection();

        global.EMS_IDB_INDEX_AUTO_SCHEDULE = false;

        return global.emsRepo.ready().then(function () {
            repo.useTenant(TENANT);
            var report = {
                generatedAt: new Date().toISOString(),
                profiler: 'bench/index-build-profile.js',
                batchRowsPerTransaction: BATCH_ROWS,
                scales: []
            };

            var chain = Promise.resolve();
            scales.forEach(function (n) {
                chain = chain.then(function () {
                    setStatus('Profiling ' + n.toLocaleString() + ' records…');
                    log('=== scale ' + n + ' ===');
                    return repo.clear(COL).then(function () {
                        return global.emsIdbSearchIndexClearCollection(collection);
                    }).then(function () {
                        var rows = makeRows(n);
                        var insertT0 = nowMs();
                        return chunkBulkPut(repo, rows).then(function (inserted) {
                            var insertMs = round(nowMs() - insertT0);
                            var memAfterInsert = memSnapshot();

                            var readT0 = nowMs();
                            return cursorReadCollection(collection).then(function (readRows) {
                                var recordReadMs = round(nowMs() - readT0);

                                var tokenT0 = nowMs();
                                var tokenPack = generateTokensForRows(readRows);
                                var tokenGenerationMs = round(nowMs() - tokenT0);
                                var tokenStats = summarizeTokenCounts(tokenPack.perRowTokens);

                                return global.emsIdbSearchIndexClearCollection(collection).then(function () {
                                    var writeT0 = nowMs();
                                    var batchTxCount = 0;
                                    var batchPutCalls = 0;
                                    var batchChain = Promise.resolve();
                                    for (var off = 0; off < readRows.length; off += BATCH_ROWS) {
                                        (function (sliceOff) {
                                            batchChain = batchChain.then(function () {
                                                var sliceRows = readRows.slice(sliceOff, sliceOff + BATCH_ROWS);
                                                var sliceTokenArrays = tokenPack.perRowTokens.slice(sliceOff, sliceOff + BATCH_ROWS);
                                                return writeRowsBatchTx(collection, sliceRows, sliceTokenArrays).then(function (w) {
                                                    batchTxCount += w.transactionCount;
                                                    batchPutCalls += w.idbPutCalls;
                                                });
                                            });
                                        })(off);
                                    }
                                    return batchChain.then(function () {
                                        var idbWriteBatchMs = round(nowMs() - writeT0);
                                        var indexBuildMs = round(recordReadMs + tokenGenerationMs + idbWriteBatchMs);
                                        var msPer1000Records = round((indexBuildMs / n) * 1000);
                                        var recordsPerMinute = round(n / (indexBuildMs / 60000));

                                        var perTokenSampleRows = n >= 10000 ? 50 : Math.min(100, n);
                                        var perTokenT0 = nowMs();
                                        return global.emsIdbSearchIndexClearCollection(collection).then(function () {
                                            return writeTokensPerTokenTx(collection, readRows, tokenPack.perRowTokens, perTokenSampleRows);
                                        }).then(function (perTok) {
                                            var perTokenSampleMs = round(nowMs() - perTokenT0);
                                            var extrapolatedPerTokenWriteMs = round(perTokenSampleMs * (n / perTokenSampleRows));

                                            var row = {
                                                records: n,
                                                inserted: inserted,
                                                insertMs: insertMs,
                                                memAfterInsert: memAfterInsert,
                                                stages: {
                                                    recordReadMs: recordReadMs,
                                                    tokenGenerationMs: tokenGenerationMs,
                                                    idbWriteBatchMs: idbWriteBatchMs,
                                                    indexBuildTotalMs: indexBuildMs
                                                },
                                                stagePercent: {
                                                    recordRead: pct(recordReadMs, indexBuildMs),
                                                    tokenGeneration: pct(tokenGenerationMs, indexBuildMs),
                                                    idbWriteBatch: pct(idbWriteBatchMs, indexBuildMs)
                                                },
                                                tokensPerRecord: tokenStats,
                                                totalTokens: tokenPack.totalTokens,
                                                totalIndexEntriesWritten: batchPutCalls,
                                                idbWritePattern: {
                                                    mode: 'row-doc-batch',
                                                    rowsPerTransaction: BATCH_ROWS,
                                                    idbPutCallsPerRow: 1,
                                                    transactionCount: batchTxCount,
                                                    idbPutCalls: batchPutCalls,
                                                    putsPerTransaction: batchTxCount ? round(batchPutCalls / batchTxCount) : 0,
                                                    putsAreSyncOpsInsideTransaction: true,
                                                    oneTransactionPerTokenSample: {
                                                        sampleRows: perTokenSampleRows,
                                                        sampleMs: perTokenSampleMs,
                                                        sampleTransactions: perTok.transactionCount,
                                                        extrapolatedFullMs: extrapolatedPerTokenWriteMs
                                                    }
                                                },
                                                throughput: {
                                                    recordsPerMinute: recordsPerMinute,
                                                    msPer1000Records: msPer1000Records,
                                                    msPerRecordTotal: round(indexBuildMs / n),
                                                    msPerRecordIdbWrite: round(idbWriteBatchMs / n),
                                                    msPerRecordTokenGen: round(tokenGenerationMs / n)
                                                }
                                            };

                                            log('read ' + recordReadMs + 'ms | tokens ' + tokenGenerationMs + 'ms | idb ' + idbWriteBatchMs + 'ms | total ' + indexBuildMs + 'ms');
                                            log('tokens/row avg=' + tokenStats.avg + ' total=' + tokenPack.totalTokens + ' txs=' + batchTxCount + ' puts=' + batchPutCalls);
                                            report.scales.push(row);
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });

            return chain.then(function () {
                setStatus('Profile complete — ' + report.scales.length + ' scale(s)');
                global.__INDEX_BUILD_PROFILE__ = report;
                return report;
            });
        });
    };

    if (global.location && global.location.search.indexOf('autorun=1') >= 0) {
        global.emsRepo.ready().then(function () {
            var scales = [1000, 10000];
            var m = global.location.search.match(/scales=([\d,]+)/);
            if (m) scales = m[1].split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (x) { return x > 0; });
            return global.runIndexBuildProfile({ scales: scales });
        }).then(function (report) {
            global.__INDEX_BUILD_PROFILE_DONE__ = true;
        }).catch(function (err) {
            setStatus('Failed: ' + (err && err.message ? err.message : err));
            global.__INDEX_BUILD_PROFILE_ERROR__ = String(err && err.message ? err.message : err);
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
