// ============================================================================
// EMS Outbox Flush Lock — cross-tab exclusive lock for queue flush (Phase 4 P1)
// Primary: navigator.locks  |  Fallback: localStorage lease + BroadcastChannel
// ============================================================================
(function (global) {
    'use strict';

    var LOCK_NAME = 'ems-outbox-flush-v1';
    var LS_LOCK_KEY = 'ems_outbox_flush_lock_v1';
    var BC_NAME = 'ems-outbox-flush-v1';
    var LEASE_MS = 30000;
    var POLL_MS = 100;
    var MAX_WAIT_MS = 120000;
    var TAB_ID = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    var _localChain = Promise.resolve();
    var _bc = null;

    function getBroadcastChannel() {
        if (typeof BroadcastChannel === 'undefined') return null;
        if (!_bc) {
            try { _bc = new BroadcastChannel(BC_NAME); } catch (e) { _bc = null; }
        }
        return _bc;
    }

    function readLsLock() {
        try {
            var raw = global.localStorage.getItem(LS_LOCK_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function tryAcquireLsLock() {
        var now = Date.now();
        try {
            var cur = readLsLock();
            if (cur && cur.tabId !== TAB_ID && cur.until > now) return false;
            global.localStorage.setItem(LS_LOCK_KEY, JSON.stringify({ tabId: TAB_ID, until: now + LEASE_MS }));
            cur = readLsLock();
            return !!(cur && cur.tabId === TAB_ID);
        } catch (e) {
            return false;
        }
    }

    function renewLsLock() {
        try {
            global.localStorage.setItem(LS_LOCK_KEY, JSON.stringify({ tabId: TAB_ID, until: Date.now() + LEASE_MS }));
        } catch (e) { /* ignore */ }
    }

    function releaseLsLock() {
        try {
            var cur = readLsLock();
            if (cur && cur.tabId === TAB_ID) global.localStorage.removeItem(LS_LOCK_KEY);
        } catch (e) { /* ignore */ }
        var bc = getBroadcastChannel();
        if (bc) {
            try { bc.postMessage({ type: 'released', tabId: TAB_ID }); } catch (e2) { /* ignore */ }
        }
    }

    function waitForLegacyLock(startMs) {
        return new Promise(function (resolve) {
            if (Date.now() - startMs >= MAX_WAIT_MS) {
                resolve({ acquired: false, reason: 'outbox_lock_timeout' });
                return;
            }
            if (tryAcquireLsLock()) {
                resolve({ acquired: true });
                return;
            }
            setTimeout(function () { resolve(waitForLegacyLock(startMs)); }, POLL_MS);
        });
    }

    function withLegacyLock(fn) {
        var startMs = Date.now();
        var bc = getBroadcastChannel();
        var onMessage = null;
        if (bc) {
            onMessage = function (ev) {
                if (ev && ev.data && ev.data.type === 'released') {
                    /* wake poll loop via shorter timeout — next poll handles acquire */
                }
            };
            try { bc.addEventListener('message', onMessage); } catch (e) { /* ignore */ }
        }
        return waitForLegacyLock(startMs).then(function (gate) {
            if (!gate.acquired) {
                if (bc && onMessage) {
                    try { bc.removeEventListener('message', onMessage); } catch (eRm) { /* ignore */ }
                }
                return { ok: true, flushed: 0, skipped: true, reason: gate.reason || 'outbox_lock_busy' };
            }
            var heartbeat = global.setInterval(renewLsLock, 5000);
            return Promise.resolve().then(fn).then(function (result) {
                global.clearInterval(heartbeat);
                releaseLsLock();
                if (bc && onMessage) {
                    try { bc.removeEventListener('message', onMessage); } catch (eRm2) { /* ignore */ }
                }
                return result;
            }, function (err) {
                global.clearInterval(heartbeat);
                releaseLsLock();
                if (bc && onMessage) {
                    try { bc.removeEventListener('message', onMessage); } catch (eRm3) { /* ignore */ }
                }
                throw err;
            });
        });
    }

    function withWebLock(fn) {
        return global.navigator.locks.request(LOCK_NAME, function () {
            return Promise.resolve().then(fn);
        });
    }

    /**
     * Run fn while holding the cross-tab outbox flush lock.
     * Serializes within-tab calls via an internal promise chain.
     */
    global.emsWithOutboxFlushLock = function (fn) {
        if (typeof fn !== 'function') return Promise.resolve();
        var run = function () {
            if (global.navigator && global.navigator.locks && typeof global.navigator.locks.request === 'function') {
                return withWebLock(fn);
            }
            return withLegacyLock(fn);
        };
        var p = _localChain.then(run);
        _localChain = p.catch(function () { return null; });
        return p;
    };

    global.emsOutboxLockTabId = function () { return TAB_ID; };
    global.emsOutboxLockUsesWebLocks = function () {
        return !!(global.navigator && global.navigator.locks && typeof global.navigator.locks.request === 'function');
    };
})(typeof window !== 'undefined' ? window : globalThis);
