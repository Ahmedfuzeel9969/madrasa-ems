// Browser/IndexedDB scale benchmark — real IDB + emsRepo (not Node simulation)
(function (global) {
    'use strict';

    global.EMS_DISABLE_LEGACY_ARREARS = true;
    global.EMS_IDB_BENCH_TRACE = { loadAllCalls: 0, colAllCalls: 0, colAllCollections: [], pagePaths: [] };
    var TENANT = 'bench_tenant_scale';
    var COL = 'registrations';

    function log(msg) {
        var el = document.getElementById('bench-log');
        if (el) el.textContent += msg + '\n';
        console.log('[idb-bench]', msg);
    }

    function setStatus(msg) {
        var el = document.getElementById('bench-status');
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
            totalJSHeapMb: round(m.totalJSHeapSize / (1024 * 1024)),
            heapLimitMb: round(m.jsHeapSizeLimit / (1024 * 1024))
        };
    }

    function resetTrace() {
        global.EMS_IDB_BENCH_TRACE = {
            loadAllCalls: 0,
            colAllCalls: 0,
            colAllCollections: [],
            pagePaths: []
        };
    }

    function readTrace() {
        return global.EMS_IDB_BENCH_TRACE || {
            loadAllCalls: 0,
            colAllCalls: 0,
            colAllCollections: [],
            pagePaths: []
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

    function chunkBulkPut(repo, collection, rows, chunkSize) {
        chunkSize = chunkSize || 500;
        var chain = Promise.resolve(0);
        for (var i = 0; i < rows.length; i += chunkSize) {
            (function (slice) {
                chain = chain.then(function (n) {
                    return repo.bulkPut(collection, slice).then(function (c) { return n + (c || 0); });
                });
            })(rows.slice(i, i + chunkSize));
        }
        return chain;
    }

    function measureLongTask(fn) {
        return new Promise(function (resolve, reject) {
            var t0 = nowMs();
            var observer = null;
            var longTaskMs = 0;
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
            Promise.resolve().then(fn).then(function (result) {
                var elapsed = nowMs() - t0;
                if (observer) {
                    try { observer.disconnect(); } catch (e2) { /* ignore */ }
                }
                resolve({ result: result, elapsedMs: round(elapsed), longTaskMs: round(longTaskMs) });
            }).catch(reject);
        });
    }

    function simulateAdmissionFirstPage(repo) {
        var tbody = document.createElement('tbody');
        document.body.appendChild(tbody);
        var t0 = nowMs();
        return repo.count(COL, { type: 'student' }).then(function (total) {
            return repo.page(COL, {
                offset: 0,
                limit: 50,
                filter: { type: 'student' },
                sort: { field: 'timestamp', dir: 'desc' }
            }).then(function (res) {
                var rows = res.rows || [];
                tbody.innerHTML = rows.map(function (r) {
                    return '<tr><td>' + r.id + '</td><td>' + (r.name || '') + '</td></tr>';
                }).join('');
                return {
                    renderMs: round(nowMs() - t0),
                    rowCount: rows.length,
                    total: res.total != null ? res.total : total
                };
            });
        }).finally(function () {
            if (tbody.parentNode) tbody.parentNode.removeChild(tbody);
        });
    }

    global.runIdbScaleBench = function (opts) {
        opts = opts || {};
        var scales = opts.scales || [10000, 50000, 100000];
        var repo = global.emsRepo;
        if (!repo) return Promise.reject(new Error('emsRepo missing'));

        repo.useTenant(TENANT);
        resetTrace();

        var report = {
            generatedAt: new Date().toISOString(),
            userAgent: global.navigator ? global.navigator.userAgent : '',
            dbVersion: 4,
            tenant: TENANT,
            collection: COL,
            scales: [],
            checks: {
                noLoadAllOnSortedPage: true,
                noColAllOnSortedPage: true,
                noLoadAllOnSearch: true,
                noColAllOnSearch: true,
                legacyArrearsDisabled: global.EMS_DISABLE_LEGACY_ARREARS !== false
            }
        };

        global.EMS_IDB_INDEX_AUTO_SCHEDULE = false;
        var chain = Promise.resolve();
        scales.forEach(function (n) {
            chain = chain.then(function () {
                setStatus('Benchmarking ' + n.toLocaleString() + ' records…');
                log('--- scale ' + n + ' ---');
                resetTrace();
                return repo.clear(COL).then(function () {
                    var rows = makeRows(n);
                    var insertT0 = nowMs();
                    return chunkBulkPut(repo, COL, rows).then(function (inserted) {
                        var insertMs = round(nowMs() - insertT0);
                        var memAfterInsert = memSnapshot();
                        var scopedCol = TENANT + '__' + COL;
                        var tokensPerRow = (global.emsSearchIndexTokensForRow)
                            ? global.emsSearchIndexTokensForRow(makeRow(1)).length
                            : 0;
                        var indexT0 = nowMs();
                        var firstChunkMs = 0;
                        var chunkProbe = (global.emsIdbSearchIndexProcessChunk)
                            ? global.emsIdbSearchIndexProcessChunk(scopedCol, { chunkSize: 100 }).then(function () {
                                firstChunkMs = round(nowMs() - indexT0);
                            })
                            : Promise.resolve();
                        return chunkProbe.then(function () {
                            var rebuildT0 = nowMs();
                            return (global.emsIdbSearchIndexEnsure
                                ? global.emsIdbSearchIndexEnsure(scopedCol)
                                : Promise.resolve({ skipped: true })
                            ).then(function () {
                                var indexBuildMs = round(nowMs() - rebuildT0);
                                var indexTotalMs = round(nowMs() - indexT0);
                                resetTrace();

                        var pageSortT0 = nowMs();
                                return repo.page(COL, {
                            offset: 0,
                            limit: 50,
                            sort: { field: 'timestamp', dir: 'desc' }
                        }).then(function (pageRes) {
                            var pageSortMs = round(nowMs() - pageSortT0);
                            var traceAfterSort = readTrace();

                            resetTrace();
                            var filterT0 = nowMs();
                            return repo.page(COL, {
                                offset: 0,
                                limit: 50,
                                filter: { type: 'student' },
                                sort: { field: 'timestamp', dir: 'desc' }
                            }).then(function (filterRes) {
                                var filterMs = round(nowMs() - filterT0);
                                var traceAfterFilter = readTrace();

                                resetTrace();
                                var searchT0 = nowMs();
                                return repo.page(COL, {
                                    offset: 0,
                                    limit: 50,
                                    filter: { type: 'student' },
                                    sort: { field: 'timestamp', dir: 'desc' },
                                    search: { text: '0300', fields: ['name', 'id', 'phone', 'cnic', 'class'] }
                                }).then(function (searchRes) {
                                    var searchMs = round(nowMs() - searchT0);
                                    var traceAfterSearch = readTrace();

                                    resetTrace();
                                    return measureLongTask(function () {
                                        return simulateAdmissionFirstPage(repo);
                                    }).then(function (admission) {
                                        var traceAfterAdmission = readTrace();
                                        return {
                                            records: n,
                                            inserted: inserted,
                                            insertMs: insertMs,
                                            indexBuildMs: indexBuildMs,
                                            indexTotalMs: indexTotalMs,
                                            firstChunkMs: firstChunkMs,
                                            indexBuildMode: 'incremental-chunks',
                                            tokensPerRow: tokensPerRow,
                                            estimatedSearchPuts: tokensPerRow * inserted,
                                            msPerRowIndex: inserted ? round(indexBuildMs / inserted) : 0,
                                            memAfterInsert: memAfterInsert,
                                            pageSortMs: pageSortMs,
                                            filterMs: filterMs,
                                            searchMs: searchMs,
                                            searchExpectedLoadAll: false,
                                            admissionFirstPageMs: admission.result.renderMs,
                                            admissionLongTaskMs: admission.longTaskMs,
                                            admissionElapsedMs: admission.elapsedMs,
                                            trace: {
                                                afterSortPage: traceAfterSort,
                                                afterFilterPage: traceAfterFilter,
                                                afterSearchPage: traceAfterSearch,
                                                afterAdmission: traceAfterAdmission
                                            },
                                            pageSortTotal: pageRes.total,
                                            filterTotal: filterRes.total,
                                            searchTotal: searchRes.total
                                        };
                                    });
                                });
                            });
                        });
                            });
                        });
                    });
                }).then(function (row) {
                    log('insert ' + row.insertMs + 'ms | sort page ' + row.pageSortMs + 'ms | filter ' + row.filterMs + 'ms | search ' + row.searchMs + 'ms | admission ' + row.admissionFirstPageMs + 'ms');
                    report.scales.push(row);

                    if (row.trace.afterSortPage.loadAllCalls > 0) report.checks.noLoadAllOnSortedPage = false;
                    if (row.trace.afterFilterPage.loadAllCalls > 0) report.checks.noLoadAllOnSortedPage = false;
                    if (row.trace.afterAdmission.loadAllCalls > 0) report.checks.noLoadAllOnSortedPage = false;
                    if (row.trace.afterSortPage.colAllCalls > 0) report.checks.noColAllOnSortedPage = false;
                    if (row.trace.afterFilterPage.colAllCalls > 0) report.checks.noColAllOnSortedPage = false;
                    if (row.trace.afterAdmission.colAllCalls > 0) report.checks.noColAllOnSortedPage = false;
                    if (row.trace.afterSearchPage.loadAllCalls > 0) report.checks.noLoadAllOnSearch = false;
                    if (row.trace.afterSearchPage.colAllCalls > 0) report.checks.noColAllOnSearch = false;

                    resetTrace();
                    return repo.count(COL).then(function (persistCount) {
                        row.persistCountBeforeReload = persistCount;
                    });
                });
            });
        });

        return chain.then(function () {
            setStatus('Persistence check — reloading…');
            return new Promise(function (resolve) {
                global.__IDB_BENCH_REPORT__ = report;
                global.sessionStorage.setItem('ems_idb_bench_report', JSON.stringify(report));
                resolve(report);
            });
        });
    };

    global.resumeIdbScaleBenchAfterReload = function () {
        var raw = global.sessionStorage.getItem('ems_idb_bench_persist');
        if (!raw) return Promise.reject(new Error('no persist token'));
        var cfg = JSON.parse(raw);
        var repo = global.emsRepo;
        repo.useTenant(cfg.tenant);
        return repo.count(cfg.collection).then(function (count) {
            return {
                expected: cfg.expected,
                actual: count,
                ok: count === cfg.expected
            };
        });
    };

    if (global.location && global.location.search.indexOf('autorun=1') >= 0) {
        global.emsRepo.ready().then(function () {
            var scales = [10000];
            var m = global.location.search.match(/scales=([\d,]+)/);
            if (m) scales = m[1].split(',').map(function (s) { return parseInt(s, 10); });
            return global.runIdbScaleBench({ scales: scales });
        }).then(function (report) {
            setStatus('Done — ' + report.scales.length + ' scale(s)');
            global.__IDB_BENCH_DONE__ = true;
        }).catch(function (err) {
            setStatus('Failed: ' + (err && err.message ? err.message : err));
            global.__IDB_BENCH_ERROR__ = String(err && err.message ? err.message : err);
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
