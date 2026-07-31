// ============================================================================
// EMS Search Index Leader Lock — one tab builds index per tenant/collection (P6)
// Primary: navigator.locks (ifAvailable)  |  Fallback: localStorage lease + BC
// ============================================================================
(function (global) {
    'use strict';

    var INDEX_VERSION = typeof global.emsSearchIndexVersion === 'function'
        ? global.emsSearchIndexVersion()
        : 3;
    var LS_PREFIX = 'ems_search_index_leader_v';
    var BC_NAME = 'ems-search-index-leader-v3';
    var DEFAULT_LEASE_MS = 45000;
    var TAB_ID = 'idx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    var _held = Object.create(null); // collection -> true
    var _bc = null;

    function leaseMs() {
        var v = global.EMS_SEARCH_INDEX_LEASE_MS;
        if (typeof v === 'number' && v >= 500) return v;
        return DEFAULT_LEASE_MS;
    }

    function getBroadcastChannel() {
        if (typeof BroadcastChannel === 'undefined') return null;
        if (!_bc) {
            try { _bc = new BroadcastChannel(BC_NAME); } catch (e) { _bc = null; }
        }
        return _bc;
    }

    function lockName(collection) {
        return 'ems-search-index-v' + INDEX_VERSION + ':' + String(collection);
    }

    function lsKey(collection) {
        return LS_PREFIX + INDEX_VERSION + '_' + String(collection).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function readLsLock(collection) {
        try {
            var raw = global.localStorage.getItem(lsKey(collection));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function postBc(msg) {
        var bc = getBroadcastChannel();
        if (bc) {
            try { bc.postMessage(msg); } catch (e) { /* ignore */ }
        }
    }

    function tryAcquireLsLock(collection) {
        var now = Date.now();
        var ms = leaseMs();
        try {
            var cur = readLsLock(collection);
            if (cur && cur.tabId !== TAB_ID && cur.until > now) return false;
            global.localStorage.setItem(lsKey(collection), JSON.stringify({
                tabId: TAB_ID,
                until: now + ms,
                collection: String(collection)
            }));
            cur = readLsLock(collection);
            return !!(cur && cur.tabId === TAB_ID);
        } catch (e) {
            return false;
        }
    }

    function renewLsLock(collection) {
        try {
            global.localStorage.setItem(lsKey(collection), JSON.stringify({
                tabId: TAB_ID,
                until: Date.now() + leaseMs(),
                collection: String(collection)
            }));
        } catch (e) { /* ignore */ }
    }

    function releaseLsLock(collection) {
        try {
            var cur = readLsLock(collection);
            if (cur && cur.tabId === TAB_ID) global.localStorage.removeItem(lsKey(collection));
        } catch (e) { /* ignore */ }
        postBc({ type: 'released', tabId: TAB_ID, collection: String(collection) });
    }

    function releaseAllHeld() {
        for (var col in _held) {
            if (Object.prototype.hasOwnProperty.call(_held, col) && _held[col]) {
                delete _held[col];
                try { releaseLsLock(col); } catch (eRel) { /* ignore */ }
            }
        }
    }

    global.emsSearchIndexLeaderReadLock = function (collection) {
        return readLsLock(String(collection));
    };

    global.emsSearchIndexLeaderIsLeaseExpired = function (collection) {
        var cur = readLsLock(String(collection));
        if (!cur) return true;
        return cur.until <= Date.now();
    };

    global.emsSearchIndexLeaderIsMine = function (collection) {
        collection = String(collection);
        if (!_held[collection]) return false;
        var cur = readLsLock(collection);
        return !!(cur && cur.tabId === TAB_ID && cur.until > Date.now());
    };

    global.emsSearchIndexLeaderTryAcquire = function (collection) {
        collection = String(collection);
        if (global.emsSearchIndexLeaderIsMine(collection)) {
            renewLsLock(collection);
            return Promise.resolve({ acquired: true, tabId: TAB_ID, alreadyHeld: true });
        }
        var cur = readLsLock(collection);
        if (cur && cur.tabId !== TAB_ID && cur.until > Date.now()) {
            return Promise.resolve({ acquired: false, reason: 'index_lock_busy', holder: cur.tabId });
        }
        if (global.navigator && global.navigator.locks && typeof global.navigator.locks.request === 'function') {
            return global.navigator.locks.request(lockName(collection), { ifAvailable: true }, function (lock) {
                if (!lock) {
                    return { acquired: false, reason: 'index_lock_busy' };
                }
                if (!tryAcquireLsLock(collection)) {
                    return { acquired: false, reason: 'index_lock_busy' };
                }
                _held[collection] = true;
                postBc({ type: 'acquired', tabId: TAB_ID, collection: collection });
                return { acquired: true, tabId: TAB_ID, webLock: true };
            });
        }
        if (tryAcquireLsLock(collection)) {
            _held[collection] = true;
            postBc({ type: 'acquired', tabId: TAB_ID, collection: collection });
            return Promise.resolve({ acquired: true, tabId: TAB_ID });
        }
        return Promise.resolve({ acquired: false, reason: 'index_lock_busy' });
    };

    global.emsSearchIndexLeaderRenew = function (collection) {
        collection = String(collection);
        if (!_held[collection]) return;
        renewLsLock(collection);
    };

    global.emsSearchIndexLeaderRelease = function (collection) {
        collection = String(collection);
        if (!_held[collection]) return;
        delete _held[collection];
        releaseLsLock(collection);
    };

    /** Test/bench — simulate crash: stale lease holder without release. */
    global.emsSearchIndexLeaderSimulateCrash = function (collection) {
        collection = String(collection);
        var cur = readLsLock(collection);
        if (!cur) return { ok: false, reason: 'no_lock' };
        try {
            global.localStorage.setItem(lsKey(collection), JSON.stringify({
                tabId: cur.tabId,
                until: Date.now() - 1000,
                collection: collection,
                crashed: true
            }));
            return { ok: true, expiredTabId: cur.tabId };
        } catch (e) {
            return { ok: false, reason: 'ls_error' };
        }
    };

    /**
     * Gate one index chunk — non-blocking for follower tabs.
     */
    global.emsSearchIndexLeaderGateChunk = function (collection, fn) {
        collection = String(collection);
        if (typeof fn !== 'function') return Promise.resolve({ skipped: true, reason: 'no_fn' });

        if (global.emsSearchIndexLeaderIsMine(collection)) {
            global.emsSearchIndexLeaderRenew(collection);
            return Promise.resolve().then(fn).then(function (res) {
                if (res && (res.complete || res.skipped)) {
                    global.emsSearchIndexLeaderRelease(collection);
                }
                return res;
            });
        }

        if (!global.emsSearchIndexLeaderIsLeaseExpired(collection)) {
            return Promise.resolve({
                ok: true,
                skipped: true,
                reason: 'index_lock_busy',
                observing: true
            });
        }

        return global.emsSearchIndexLeaderTryAcquire(collection).then(function (gate) {
            if (!gate.acquired) {
                return {
                    ok: true,
                    skipped: true,
                    reason: gate.reason || 'index_lock_busy',
                    observing: true
                };
            }
            return Promise.resolve().then(fn).then(function (res) {
                if (res && (res.complete || res.skipped)) {
                    global.emsSearchIndexLeaderRelease(collection);
                }
                return res;
            }, function (err) {
                global.emsSearchIndexLeaderRelease(collection);
                throw err;
            });
        });
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('pagehide', releaseAllHeld);
        global.addEventListener('beforeunload', releaseAllHeld);
        var bc = getBroadcastChannel();
        if (bc) {
            bc.addEventListener('message', function (ev) {
                if (!ev || !ev.data) return;
                if (ev.data.type === 'released' || ev.data.type === 'acquired') {
                    try {
                        global.dispatchEvent(new CustomEvent('ems:search-index-lock-changed', {
                            detail: ev.data
                        }));
                    } catch (eEv) { /* ignore */ }
                }
            });
        }
    }

    global.emsSearchIndexLockTabId = function () { return TAB_ID; };
    global.emsSearchIndexLockUsesWebLocks = function () {
        return !!(global.navigator && global.navigator.locks && typeof global.navigator.locks.request === 'function');
    };
    global.emsSearchIndexLockUsesBroadcastChannel = function () {
        return typeof BroadcastChannel !== 'undefined';
    };
})(typeof window !== 'undefined' ? window : globalThis);
