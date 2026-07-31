// ============================================================================
// EMS Import Queue — chunked batch import with job states (E10-S1)
// States: pending → processing → completed | failed | partial
// Chunk size: 500 records (enterprise scale)
// ============================================================================
(function (global) {
    'use strict';

    var QUEUE_KEY = 'ems_import_queue_v1';
    var CHUNK_SIZE = 500;

    function loadJobs() {
        try {
            var raw = localStorage.getItem(QUEUE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveJobs(list) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(list || []));
        } catch (e) { /* ignore */ }
    }

    function findJob(id) {
        var list = loadJobs();
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === id) return { job: list[i], index: i, list: list };
        }
        return null;
    }

    function patchJob(id, patch) {
        var hit = findJob(id);
        if (!hit) return null;
        hit.list[hit.index] = Object.assign({}, hit.job, patch, { updatedAt: new Date().toISOString() });
        saveJobs(hit.list);
        return hit.list[hit.index];
    }

    function splitChunks(records) {
        var chunks = [];
        for (var i = 0; i < records.length; i += CHUNK_SIZE) {
            chunks.push(records.slice(i, i + CHUNK_SIZE));
        }
        return chunks;
    }

    function mergeReports(a, b) {
        a = a || { added: 0, updated: 0, skipped: 0, errors: 0, total: 0 };
        b = b || {};
        return {
            added: (a.added || 0) + (b.added || 0),
            updated: (a.updated || 0) + (b.updated || 0),
            skipped: (a.skipped || 0) + (b.skipped || 0),
            errors: (a.errors || 0) + (b.errors || 0),
            total: b.total != null ? b.total : a.total
        };
    }

    function writeChunk(records, type, conflict) {
        if (records.length > 400 && typeof global.emsBulkImportViaCf === 'function') {
            return global.emsBulkImportViaCf(records, type, conflict).then(function (res) {
                return res.report || res;
            });
        }
        if (typeof global.emsImportCommitDirect === 'function') {
            return global.emsImportCommitDirect(records, conflict, type);
        }
        return Promise.reject(new Error('Import commit unavailable'));
    }

    global.emsImportQueueChunkSize = function () {
        return CHUNK_SIZE;
    };

    global.emsImportQueueList = function () {
        return loadJobs().slice().sort(function (a, b) {
            return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });
    };

    global.emsImportQueueGet = function (id) {
        var hit = findJob(id);
        return hit ? hit.job : null;
    };

    global.emsImportQueueClearCompleted = function () {
        var kept = loadJobs().filter(function (j) {
            return j && j.status !== 'completed';
        });
        saveJobs(kept);
        return kept.length;
    };

    global.emsImportQueueCreate = function (meta) {
        meta = meta || {};
        var records = meta.records || [];
        var chunks = splitChunks(records);
        var job = {
            id: meta.id || ('iq-' + Date.now()),
            status: 'pending',
            type: meta.type || 'student',
            conflict: meta.conflict || 'skip',
            fileName: meta.fileName || 'import',
            historyId: meta.historyId || null,
            totalRecords: records.length,
            chunkCount: chunks.length,
            chunkSize: CHUNK_SIZE,
            processedChunks: 0,
            report: { added: 0, updated: 0, skipped: 0, errors: 0, total: records.length },
            createdAt: new Date().toISOString(),
            updatedAt: null,
            completedAt: null,
            error: null
        };
        var list = loadJobs();
        list.unshift(job);
        if (list.length > 40) list = list.slice(0, 40);
        saveJobs(list);
        return job;
    };

    global.emsImportQueueProcess = function (jobId, records, opts) {
        opts = opts || {};
        var type = opts.type || 'student';
        var conflict = opts.conflict || 'skip';
        var onProgress = opts.onProgress;
        var chunks = splitChunks(records || []);
        if (!chunks.length) return Promise.resolve({ added: 0, updated: 0, skipped: 0, errors: 0, total: 0 });

        patchJob(jobId, { status: 'processing', processedChunks: 0, error: null });
        var report = { added: 0, updated: 0, skipped: 0, errors: 0, total: records.length };
        var idx = 0;

        function next() {
            if (idx >= chunks.length) {
                var finalStatus = report.errors > 0
                    ? (report.added + report.updated > 0 ? 'partial' : 'failed')
                    : 'completed';
                patchJob(jobId, {
                    status: finalStatus,
                    processedChunks: chunks.length,
                    report: report,
                    completedAt: new Date().toISOString()
                });
                return Promise.resolve(report);
            }
            var slice = chunks[idx];
            return writeChunk(slice, type, conflict).then(function (part) {
                report = mergeReports(report, part);
                idx++;
                patchJob(jobId, { processedChunks: idx, report: report });
                if (onProgress) onProgress(idx, chunks.length, report);
                return new Promise(function (resolve) {
                    setTimeout(function () { resolve(next()); }, 25);
                });
            }).catch(function (err) {
                report.errors += slice.length;
                idx++;
                patchJob(jobId, {
                    processedChunks: idx,
                    report: report,
                    error: String(err && err.message ? err.message : err)
                });
                if (onProgress) onProgress(idx, chunks.length, report);
                return new Promise(function (resolve) {
                    setTimeout(function () { resolve(next()); }, 25);
                });
            });
        }

        return next();
    };

    global.emsImportQueueCommit = function (records, opts) {
        opts = opts || {};
        records = records || [];
        if (!records.length) {
            return Promise.resolve({ added: 0, updated: 0, skipped: 0, errors: 0, total: 0 });
        }
        var start = (typeof global.emsStorageQuotaConfirmBulk === 'function')
            ? global.emsStorageQuotaConfirmBulk({ context: 'bulk_import' })
            : Promise.resolve({ allowed: true });
        return start.then(function (gate) {
            if (gate && gate.allowed === false) {
                return { added: 0, updated: 0, skipped: records.length, errors: 0, total: records.length, blocked: true, reason: 'storage_quota_block' };
            }
            if (records.length <= CHUNK_SIZE && typeof global.emsImportCommitDirect === 'function') {
                return global.emsImportCommitDirect(records, opts.conflict, opts.type, opts.onProgress);
            }
            if (records.length <= CHUNK_SIZE && typeof global.EmsImportExport !== 'undefined' &&
                global.EmsImportExport.commit && records.length <= 400) {
                return global.EmsImportExport.commit(records, opts.conflict, opts.type, opts.onProgress);
            }
            var job = global.emsImportQueueCreate({
                type: opts.type,
                conflict: opts.conflict,
                fileName: opts.fileName,
                historyId: opts.historyId,
                records: records
            });
            return global.emsImportQueueProcess(job.id, records, opts);
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
