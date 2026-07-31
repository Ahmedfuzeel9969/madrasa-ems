// P6 — targeted edge-case soak harness (bench only, no production changes)
(function (global) {
    'use strict';

    var COL = 'registrations';
    var DEFAULT_TENANT = 'p6_soak_tenant';

    function log(msg) {
        var el = document.getElementById('p6-log');
        if (el) el.textContent += msg + '\n';
        console.log('[p6-soak]', msg);
    }

    function setStatus(msg) {
        var el = document.getElementById('p6-status');
        if (el) el.textContent = msg;
    }

    function nowMs() {
        return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    }

    function round(x) {
        return Math.round(x * 1000) / 1000;
    }

    function memSnapshot() {
        var m = global.performance && global.performance.memory;
        if (!m) return { available: false };
        return {
            available: true,
            usedJSHeapMb: round(m.usedJSHeapSize / (1024 * 1024)),
            totalJSHeapMb: round(m.totalJSHeapSize / (1024 * 1024))
        };
    }

    function scopedCol(tenant) {
        return String(tenant || DEFAULT_TENANT) + '__' + COL;
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

    function chunkBulkPut(repo, rows, chunkSize) {
        chunkSize = chunkSize || 500;
        var chain = Promise.resolve(0);
        for (var i = 0; i < rows.length; i += chunkSize) {
            (function (slice) {
                chain = chain.then(function (n) {
                    return repo.bulkPut(COL, slice).then(function (c) { return n + (c || 0); });
                });
            })(rows.slice(i, i + chunkSize));
        }
        return chain;
    }

    function openDb() {
        return global.emsIdbReady().then(function () {
            return new Promise(function (resolve, reject) {
                var req = global.indexedDB.open('ems_durable_v1');
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    global.p6CountSearchIndexRows = function (tenant) {
        tenant = tenant || DEFAULT_TENANT;
        var collection = scopedCol(tenant);
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var n = 0;
                var tx = db.transaction(['search_tokens'], 'readonly');
                var idx = tx.objectStore('search_tokens').index('col_row');
                var cur = idx.openCursor(IDBKeyRange.bound([collection, ''], [collection, '\uffff']));
                cur.onsuccess = function (ev) {
                    var c = ev.target.result;
                    if (!c) { resolve(n); return; }
                    if (c.value && c.value._col === collection) n++;
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return -1; });
    };

    global.p6PrepareDataset = function (opts) {
        opts = opts || {};
        var n = opts.records || 5000;
        var tenant = opts.tenant || DEFAULT_TENANT;
        var repo = global.emsRepo;
        repo.useTenant(tenant);
        global.EMS_IDB_INDEX_AUTO_SCHEDULE = false;
        var rows = new Array(n);
        for (var i = 0; i < n; i++) rows[i] = makeRow(i);
        return repo.clear(COL).then(function () {
            return global.emsIdbSearchIndexClearCollection(scopedCol(tenant));
        }).then(function () {
            return chunkBulkPut(repo, rows).then(function (inserted) {
                return { tenant: tenant, records: n, inserted: inserted, collection: scopedCol(tenant) };
            });
        });
    };

    global.p6RunIndexPump = function (opts) {
        opts = opts || {};
        var tenant = opts.tenant || DEFAULT_TENANT;
        var collection = scopedCol(tenant);
        var tabId = opts.tabId || 'tab-0';
        var maxChunks = opts.maxChunks || 10000;
        var chunkSize = opts.chunkSize || 100;
        global.__P6_CHUNK_LOG = global.__P6_CHUNK_LOG || [];
        var chunks = 0;
        var rowsIndexed = 0;

        function loop() {
            if (chunks >= maxChunks) {
                return Promise.resolve({ tabId: tabId, chunks: chunks, rowsIndexed: rowsIndexed, stopped: 'maxChunks' });
            }
            return global.emsIdbSearchIndexProcessChunk(collection, { chunkSize: chunkSize }).then(function (res) {
                if (res && res.skipped && res.observing) {
                    return global.emsIdbSearchIndexGetMeta(collection).then(function (meta) {
                        if (meta && meta.complete) {
                            return { tabId: tabId, chunks: chunks, rowsIndexed: rowsIndexed, complete: true, observed: true, last: res };
                        }
                        var delay = 600;
                        if (typeof global.emsSearchIndexLeaderIsLeaseExpired === 'function'
                            && global.emsSearchIndexLeaderIsLeaseExpired(collection)) {
                            delay = 150;
                        }
                        return new Promise(function (resolve) {
                            setTimeout(resolve, delay);
                        }).then(loop);
                    });
                }
                chunks++;
                rowsIndexed += (res && res.chunkRows) || 0;
                global.__P6_CHUNK_LOG.push({
                    tabId: tabId,
                    chunk: chunks,
                    chunkRows: res && res.chunkRows,
                    processed: res && res.processed,
                    complete: !!(res && res.complete),
                    t: Date.now()
                });
                if (!res || res.complete || res.skipped) {
                    return { tabId: tabId, chunks: chunks, rowsIndexed: rowsIndexed, complete: !!(res && (res.complete || res.skipped)), last: res };
                }
                return loop();
            });
        }
        return loop();
    };

    global.p6MeasureBroadSearch = function (opts) {
        opts = opts || {};
        var tenant = opts.tenant || DEFAULT_TENANT;
        var repo = global.emsRepo;
        repo.useTenant(tenant);
        var queries = opts.queries || [
            { label: 'phone-prefix-0300', text: '0300' },
            { label: 'name-prefix', text: 'طالب' },
            { label: 'short-id', text: 'stu' }
        ];
        var memBefore = memSnapshot();
        var results = [];
        var chain = Promise.resolve();
        queries.forEach(function (q) {
            chain = chain.then(function () {
                var t0 = nowMs();
                var longTaskMs = 0;
                var observer = null;
                if (global.PerformanceObserver) {
                    try {
                        observer = new PerformanceObserver(function (list) {
                            list.getEntries().forEach(function (e) {
                                if (e.duration > longTaskMs) longTaskMs = e.duration;
                            });
                        });
                        observer.observe({ entryTypes: ['longtask'] });
                    } catch (e) { /* ignore */ }
                }
                return repo.page(COL, {
                    offset: 0,
                    limit: 50,
                    filter: { type: 'student' },
                    search: { text: q.text, fields: ['name', 'id', 'phone', 'cnic', 'class'] }
                }).then(function (res) {
                    if (observer) {
                        try { observer.disconnect(); } catch (e2) { /* ignore */ }
                    }
                    results.push({
                        label: q.label,
                        query: q.text,
                        elapsedMs: round(nowMs() - t0),
                        longTaskMs: round(longTaskMs),
                        total: res.total,
                        rowCount: (res.rows || []).length,
                        memAfter: memSnapshot()
                    });
                });
            });
        });
        return chain.then(function () {
            return { memBefore: memBefore, memAfter: memSnapshot(), queries: results };
        });
    };

    global.p6ProbeStorageQuota = function () {
        var out = {
            estimateApiPresent: !!(global.navigator && global.navigator.storage && global.navigator.storage.estimate),
            estimateFnPresent: typeof global.emsIdbStorageEstimate === 'function',
            quotaModulePresent: typeof global.emsStorageQuotaCheck === 'function',
            userWarningSelectors: [],
            simulatedPutRejected: null
        };
        var chain = (global.emsIdbStorageEstimate ? global.emsIdbStorageEstimate() : Promise.resolve(null))
            .then(function (est) {
                out.estimate = est;
                if (est && est.quota && est.usage != null) {
                    out.usagePercent = est.quota ? round((est.usage / est.quota) * 100) : null;
                }
                if (typeof global.emsStorageQuotaSetTestEstimate === 'function') {
                    global.emsStorageQuotaSetTestEstimate(Math.floor((est && est.quota) ? est.quota * 0.86 : 860000000), (est && est.quota) || 1000000000);
                }
                return global.emsStorageQuotaCheck
                    ? global.emsStorageQuotaCheck({ context: 'p6_probe', showWarning: true })
                    : Promise.resolve(null);
            })
            .then(function (quotaStatus) {
                out.quotaStatus = quotaStatus;
                if (typeof global.emsStorageQuotaClearTestEstimate === 'function') {
                    global.emsStorageQuotaClearTestEstimate();
                }
                var warnTexts = ['storage', 'quota', 'Storage', 'جگہ', 'quotaexceeded', 'ذخیرہ'];
                warnTexts.forEach(function (needle) {
                    if (document.body && String(document.body.innerHTML || document.body.textContent || '').toLowerCase().indexOf(needle.toLowerCase()) >= 0) {
                        out.userWarningSelectors.push('body-contains:' + needle);
                    }
                });
                var banner = document.getElementById('ems-storage-quota-banner');
                if (banner && banner.style.display !== 'none' && banner.textContent) {
                    out.userWarningSelectors.push('ems-storage-quota-banner');
                }
                return openDb().then(function (db) {
                    return new Promise(function (resolve) {
                        try {
                            var tx = db.transaction(['collections'], 'readwrite');
                            var os = tx.objectStore('collections');
                            var big = new Array(50000).join('x');
                            os.put({ _pk: 'p6_quota_probe::x', _col: 'p6_quota_probe', id: 'x', blob: big });
                            tx.oncomplete = function () {
                                out.simulatedPutRejected = false;
                                resolve(out);
                            };
                            tx.onerror = function () {
                                out.simulatedPutRejected = true;
                                out.simulatedPutError = tx.error && tx.error.name ? tx.error.name : String(tx.error);
                                resolve(out);
                            };
                        } catch (e) {
                            out.simulatedPutRejected = true;
                            out.simulatedPutError = e.name || String(e);
                            resolve(out);
                        }
                    });
                }).catch(function (err) {
                    out.openDbError = err && err.message ? err.message : String(err);
                    return out;
                });
            });
        return chain;
    };

    global.p6AdmissionRush = function (opts) {
        opts = opts || {};
        var tenant = opts.tenant || DEFAULT_TENANT;
        var n = opts.records || 3000;
        var repo = global.emsRepo;
        repo.useTenant(tenant);
        global.EMS_IDB_INDEX_AUTO_SCHEDULE = false;
        var collection = scopedCol(tenant);
        var rows = new Array(n);
        for (var i = 0; i < n; i++) rows[i] = makeRow(i);
        var t0 = nowMs();
        var indexStarted = false;
        return repo.clear(COL).then(function () {
            return global.emsIdbSearchIndexClearCollection(collection);
        }).then(function () {
            return chunkBulkPut(repo, rows.slice(0, Math.floor(n / 2)));
        }).then(function () {
            indexStarted = true;
            var indexPromise = global.p6RunIndexPump({ tenant: tenant, tabId: 'rush-index', chunkSize: 50 });
            var searchPromise = global.p6MeasureBroadSearch({
                tenant: tenant,
                queries: [{ label: 'rush-0300', text: '0300' }, { label: 'rush-name', text: 'طالب' }]
            });
            var importPromise = chunkBulkPut(repo, rows.slice(Math.floor(n / 2)));
            var filterPromise = repo.page(COL, {
                offset: 0, limit: 50, filter: { type: 'student' },
                sort: { field: 'timestamp', dir: 'desc' }
            });
            return Promise.all([indexPromise, searchPromise, importPromise, filterPromise]).then(function (parts) {
                return {
                    elapsedMs: round(nowMs() - t0),
                    indexStarted: indexStarted,
                    index: parts[0],
                    search: parts[1],
                    secondImportDone: true,
                    filterTotal: parts[3] && parts[3].total,
                    memAfter: memSnapshot()
                };
            });
        });
    };

    global.p6ReadIndexMeta = function (tenant) {
        tenant = tenant || DEFAULT_TENANT;
        return global.emsIdbSearchIndexGetMeta(scopedCol(tenant));
    };

    global.p6Ready = function () {
        return global.emsRepo && global.emsRepo.ready && global.emsIdbSearchIndexProcessChunk;
    };

    global.p6SetIndexLeaseMs = function (ms) {
        global.EMS_SEARCH_INDEX_LEASE_MS = ms;
        return ms;
    };

    global.p6ProbeLockApis = function () {
        return {
            tabId: typeof global.emsSearchIndexLockTabId === 'function' ? global.emsSearchIndexLockTabId() : null,
            webLocks: typeof global.emsSearchIndexLockUsesWebLocks === 'function'
                ? global.emsSearchIndexLockUsesWebLocks() : false,
            broadcastChannel: typeof global.emsSearchIndexLockUsesBroadcastChannel === 'function'
                ? global.emsSearchIndexLockUsesBroadcastChannel() : false,
            userAgent: (global.navigator && global.navigator.userAgent) || '',
            storageQuota: typeof global.emsStorageQuotaCheck === 'function',
            storageClean: typeof global.emsStorageQuotaCleanTemporaryFiles === 'function'
        };
    };

    global.p6RunPartialIndexPump = function (opts) {
        opts = opts || {};
        var maxChunks = opts.maxChunks || 5;
        return global.p6RunIndexPump({
            tenant: opts.tenant,
            tabId: opts.tabId || 'partial',
            chunkSize: opts.chunkSize || 100,
            maxChunks: maxChunks
        });
    };

    global.p6WaitIndexComplete = function (tenant, timeoutMs) {
        tenant = tenant || DEFAULT_TENANT;
        timeoutMs = timeoutMs || 600000;
        var collection = scopedCol(tenant);
        var started = Date.now();
        function poll() {
            return global.emsIdbSearchIndexGetMeta(collection).then(function (meta) {
                if (meta && meta.complete) {
                    return { complete: true, meta: meta, elapsedMs: round(Date.now() - started) };
                }
                if (Date.now() - started > timeoutMs) {
                    return { complete: false, timeout: true, meta: meta };
                }
                return new Promise(function (r) { setTimeout(r, 500); }).then(poll);
            });
        }
        return poll();
    };

    global.p6RunFailoverAfterLeaderKill = function (opts) {
        opts = opts || {};
        var tenant = opts.tenant || 'p6_failover_kill';
        var scale = opts.records || 8000;
        var collection = scopedCol(tenant);
        return global.p6PrepareDataset({ records: scale, tenant: tenant }).then(function () {
            return global.p6RunPartialIndexPump({ tenant: tenant, tabId: 'leader', maxChunks: 8 });
        }).then(function (partial) {
            return {
                tenant: tenant,
                collection: collection,
                partial: partial,
                leaderTabId: typeof global.emsSearchIndexLockTabId === 'function'
                    ? global.emsSearchIndexLockTabId() : null,
                lockBeforeKill: typeof global.emsSearchIndexLeaderReadLock === 'function'
                    ? global.emsSearchIndexLeaderReadLock(collection) : null
            };
        });
    };

    global.p6RunFailoverAfterCrashSim = function (opts) {
        opts = opts || {};
        var tenant = opts.tenant || 'p6_failover_crash';
        var scale = opts.records || 8000;
        var collection = scopedCol(tenant);
        return global.p6PrepareDataset({ records: scale, tenant: tenant }).then(function () {
            return global.p6RunPartialIndexPump({ tenant: tenant, tabId: 'crash-leader', maxChunks: 6 });
        }).then(function (partial) {
            var crash = typeof global.emsSearchIndexLeaderSimulateCrash === 'function'
                ? global.emsSearchIndexLeaderSimulateCrash(collection)
                : { ok: false };
            return {
                tenant: tenant,
                collection: collection,
                partial: partial,
                crash: crash,
                leaseExpired: typeof global.emsSearchIndexLeaderIsLeaseExpired === 'function'
                    ? global.emsSearchIndexLeaderIsLeaseExpired(collection) : null
            };
        });
    };

    global.p6FollowerCompleteIndex = function (opts) {
        opts = opts || {};
        return global.p6RunIndexPump({
            tenant: opts.tenant,
            tabId: opts.tabId || 'follower',
            chunkSize: opts.chunkSize || 100
        });
    };

})(typeof window !== 'undefined' ? window : globalThis);
