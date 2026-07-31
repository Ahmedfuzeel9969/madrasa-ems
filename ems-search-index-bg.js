// EMS Search Index — idle-time background chunk builder (non-blocking startup)
(function (global) {
    'use strict';

    var _jobs = Object.create(null); // collection -> { opts, active, cancelled, observing }
    var _pumpScheduled = false;
    var DEFAULT_CHUNK = 100;
    var STARTUP_DELAY_MS = 2500;
    var OBSERVE_MS = 1800;

    function dispatch(name, detail) {
        try {
            global.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
        } catch (e) { /* ignore */ }
    }

    function emitProgress(collection, meta) {
        meta = meta || {};
        var total = meta.total != null ? meta.total : null;
        var processed = meta.processed || 0;
        var detail = {
            collection: collection,
            processed: processed,
            total: total,
            complete: !!meta.complete,
            pending: !meta.complete,
            percent: total ? Math.min(100, Math.round((processed / total) * 100)) : null
        };
        global.__emsSearchIndexStatus = detail;
        dispatch('ems:search-index-progress', detail);
        if (meta.complete) dispatch('ems:search-index-complete', detail);
    }

    function refreshMeta(collection, job) {
        if (typeof global.emsIdbSearchIndexGetMeta !== 'function') return Promise.resolve();
        return global.emsIdbSearchIndexGetMeta(collection).then(function (meta) {
            if (meta) emitProgress(collection, meta);
            if (meta && meta.complete && job) {
                job.observing = false;
                delete _jobs[collection];
            }
            return meta;
        });
    }

    function schedulePump(delayMs) {
        if (_pumpScheduled) return;
        _pumpScheduled = true;
        var run = function () {
            _pumpScheduled = false;
            pumpOnce();
        };
        if (delayMs && delayMs > 0) {
            setTimeout(run, delayMs);
            return;
        }
        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(run, { timeout: 150 });
        } else {
            setTimeout(run, 8);
        }
    }

    function observeRemoteBuild(col, job) {
        job.active = false;
        job.observing = true;
        return refreshMeta(col, job).then(function (meta) {
            if (meta && meta.complete) return;
            schedulePump(OBSERVE_MS);
        });
    }

    function pumpOnce() {
        var col = null;
        var job = null;
        for (col in _jobs) {
            if (!Object.prototype.hasOwnProperty.call(_jobs, col)) continue;
            job = _jobs[col];
            if (job && !job.cancelled) break;
            job = null;
        }
        if (!job || job.cancelled) {
            if (col) delete _jobs[col];
            return;
        }
        if (typeof global.emsIdbSearchIndexProcessChunk !== 'function') {
            schedulePump();
            return;
        }
        job.active = true;
        global.emsIdbSearchIndexProcessChunk(col, {
            chunkSize: (job.opts && job.opts.chunkSize) || DEFAULT_CHUNK,
            force: !!(job.opts && job.opts.force)
        }).then(function (res) {
            job.active = false;
            if (job.cancelled) {
                delete _jobs[col];
                return;
            }
            if (res && res.skipped && res.observing) {
                return observeRemoteBuild(col, job);
            }
            if (res && res.skipped) {
                delete _jobs[col];
                return refreshMeta(col, null);
            }
            if (res && res.blocked) {
                schedulePump(OBSERVE_MS);
                return;
            }
            var readMeta = global.emsIdbSearchIndexGetMeta
                ? global.emsIdbSearchIndexGetMeta(col)
                : Promise.resolve(null);
            return readMeta.then(function (meta) {
                if (meta) emitProgress(col, meta);
                if (res && res.complete) {
                    delete _jobs[col];
                    return;
                }
                if (_jobs[col] && !_jobs[col].cancelled) schedulePump();
            });
        }).catch(function () {
            job.active = false;
            schedulePump();
        });
    }

    global.emsIdbSearchIndexSchedule = function (collection, opts) {
        opts = opts || {};
        collection = String(collection);
        if (typeof global.emsIdbSearchIndexCancelSchedule === 'function') {
            global.emsIdbSearchIndexCancelSchedule(collection);
        }
        _jobs[collection] = { opts: opts, active: false, cancelled: false, observing: false };
        schedulePump();
        return Promise.resolve({ ok: true, scheduled: true, collection: collection });
    };

    global.emsIdbSearchIndexCancelSchedule = function (collection) {
        collection = String(collection);
        if (_jobs[collection]) _jobs[collection].cancelled = true;
    };

    global.emsIdbSearchIndexMaybeSchedule = function (collection, opts) {
        opts = opts || {};
        collection = String(collection);
        if (typeof global.emsIdbSearchIndexGetMeta !== 'function') return Promise.resolve(false);
        return global.emsIdbSearchIndexGetMeta(collection).then(function (meta) {
            if (meta && meta.complete) {
                emitProgress(collection, meta);
                return false;
            }
            if (meta && !meta.complete) {
                emitProgress(collection, meta);
            }
            return global.emsIdbSearchIndexSchedule(collection, opts).then(function () { return true; });
        }).catch(function () { return false; });
    };

    function scopedRegistrationsCollection() {
        var tenant = null;
        if (typeof global.emsGetTenantId === 'function') tenant = global.emsGetTenantId();
        if (!tenant && global.CURRENT_MADRASA_TENANT_ID) tenant = global.CURRENT_MADRASA_TENANT_ID;
        if (!tenant) return null;
        return String(tenant) + '__registrations';
    }

    function resumeAfterStartup() {
        if (typeof global.emsRepo !== 'object' || typeof global.emsRepo.ready !== 'function') return;
        global.emsRepo.ready().then(function () {
            var col = scopedRegistrationsCollection();
            if (!col) return;
            global.emsIdbSearchIndexMaybeSchedule(col);
        }).catch(function () { /* ignore */ });
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:search-index-progress', function () { /* follower tabs */ });
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                var bc = new BroadcastChannel('ems-search-index-leader-v3');
                bc.addEventListener('message', function (ev) {
                    if (!ev || !ev.data || ev.data.type !== 'released') return;
                    var collection = ev.data.collection;
                    if (!collection) return;
                    refreshMeta(collection, _jobs[collection] || null).then(function () {
                        if (_jobs[collection] && !_jobs[collection].cancelled) schedulePump(200);
                    });
                });
            } catch (eBc) { /* ignore */ }
        }
    }

    setTimeout(resumeAfterStartup, STARTUP_DELAY_MS);

    global.addEventListener('ems:tenant-ready', function () {
        var col = scopedRegistrationsCollection();
        if (col) global.emsIdbSearchIndexMaybeSchedule(col);
    });

})(typeof window !== 'undefined' ? window : globalThis);
