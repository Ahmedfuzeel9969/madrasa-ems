import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var SRC = fs.readFileSync(path.join(ROOT, 'ems-online-mode.js'), 'utf8');

var calls;

function makeLocalStorage() {
    var store = {};
    return {
        _store: store,
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; }
    };
}

function setupGlobals(opts) {
    opts = opts || {};
    calls = { flushQueue: 0, directFlush: 0, pullAll: [], directPullAll: [], syncInit: 0 };

    globalThis.localStorage = makeLocalStorage();
    globalThis.EMS_OFFLINE_ONLY = true;
    globalThis.EMS_OFFLINE_FIRST_SSOT = false;
    globalThis.CURRENT_MADRASA_TENANT_ID = opts.tenant || null;
    globalThis.dispatchEvent = function () { };
    globalThis.CustomEvent = function () { };
    globalThis.emsIsNetworkAvailable = function () { return opts.network !== false; };

    globalThis.emsLoadCloudStack = function () { return Promise.resolve({ ready: true }); };
    globalThis.emsInitFirebase = function () { globalThis.__fbReady = true; return {}; };
    globalThis.emsIsFirebaseReady = function () { return !!globalThis.__fbReady; };

    globalThis.firebase = {
        auth: function () { return { currentUser: opts.user || null }; }
    };

    globalThis.EmsSyncEngine = {
        init: function () { calls.syncInit++; return Promise.resolve({}); },
        shutdown: function () { },
        getStatus: function () { return { pending: 0, failed: 0 }; },
        flushQueue: function () { calls.flushQueue++; return Promise.resolve({ synced: 1 }); },
        pullAllModules: function (uid, o) { calls.pullAll.push(o); return Promise.resolve({ pulled: 2 }); }
    };
    globalThis.EmsDirect = {
        init: function () { return Promise.resolve(); },
        flushQueue: function () { calls.directFlush++; return Promise.resolve(); },
        pullAll: function (o) { calls.directPullAll.push(o); return Promise.resolve({ pulled: 0, delta: true }); }
    };
    globalThis.emsForceFullTenantDownload = function () { return Promise.resolve({ ok: true }); };

    vm.runInThisContext(SRC, { filename: 'ems-online-mode.js' });
}

describe('Online Mode controller — opt-in cloud, manual push/pull', function () {
    beforeEach(function () { setupGlobals(); });

    it('defaults to offline (disabled) with no persisted flag', function () {
        expect(globalThis.emsIsOnlineModeEnabled()).toBe(false);
        expect(globalThis.emsGetOnlineStatus().enabled).toBe(false);
    });

    it('enable turns on cloud, persists flag, forces SSOT (no auto-pull)', async function () {
        var st = await globalThis.emsEnableOnlineMode();
        expect(globalThis.EMS_OFFLINE_ONLY).toBe(false);
        expect(globalThis.EMS_OFFLINE_FIRST_SSOT).toBe(true);
        expect(globalThis.localStorage.getItem('ems_online_mode')).toBe('1');
        expect(st.firebaseReady).toBe(true);
        expect(calls.syncInit).toBe(0); // no tenant → sync engine not started, and never auto-pulls
    });

    it('disable persists an explicit offline choice and returns to offline-only', async function () {
        await globalThis.emsEnableOnlineMode();
        var r = globalThis.emsDisableOnlineMode();
        expect(r.enabled).toBe(false);
        expect(globalThis.EMS_OFFLINE_ONLY).toBe(true);
        // Offline is now persisted explicitly as '0' so the boot resolver honours it.
        expect(globalThis.localStorage.getItem('ems_online_mode')).toBe('0');
    });

    it('push is blocked until online + signed in + tenant', async function () {
        // offline
        var r1 = await globalThis.emsCloudPushNow();
        expect(r1).toEqual({ ok: false, reason: 'offline_mode' });

        // online but not signed in
        setupGlobals({ tenant: 't1' });
        await globalThis.emsEnableOnlineMode();
        var r2 = await globalThis.emsCloudPushNow();
        expect(r2.reason).toBe('not_signed_in');
    });

    it('push flushes both queues when fully ready', async function () {
        setupGlobals({ tenant: 't1', user: { uid: 'u1' } });
        await globalThis.emsEnableOnlineMode();
        var r = await globalThis.emsCloudPushNow();
        expect(r.ok).toBe(true);
        expect(calls.flushQueue).toBe(1);
        expect(calls.directFlush).toBe(1);
    });

    it('pull uses delta-only manual sync (no full collection scans)', async function () {
        setupGlobals({ tenant: 't1', user: { uid: 'u1' } });
        await globalThis.emsEnableOnlineMode();
        var r = await globalThis.emsCloudPullNow();
        expect(r.ok).toBe(true);
        expect(calls.pullAll.length).toBe(1);
        expect(calls.pullAll[0]).toEqual({ force: true, deltaOnly: true });
        expect(calls.directPullAll.length).toBe(1);
        expect(calls.directPullAll[0]).toEqual({ delta: true, forceFull: false });
    });

    it('no_network gate when offline network', async function () {
        setupGlobals({ tenant: 't1', user: { uid: 'u1' }, network: false });
        await globalThis.emsEnableOnlineMode();
        var r = await globalThis.emsCloudPushNow();
        expect(r.reason).toBe('no_network');
    });

    it('exposes real manual-sync hooks (push then pull)', async function () {
        setupGlobals({ tenant: 't1', user: { uid: 'u1' } });
        await globalThis.emsEnableOnlineMode();
        var r = await globalThis.emsHybridSyncManual();
        expect(r.ok).toBe(true);
        expect(calls.flushQueue).toBe(1);
        expect(calls.pullAll.length).toBe(1);
    });
});
