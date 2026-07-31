import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function createMockStorage() {
    var map = Object.create(null);
    return {
        getItem: function (k) { return map[k] != null ? map[k] : null; },
        setItem: function (k, v) { map[k] = String(v); },
        removeItem: function (k) { delete map[k]; },
        clear: function () { map = Object.create(null); }
    };
}

function loadLockModule(ctx) {
    var lockPath = path.join(ROOT, 'ems-search-index-lock.js');
    vm.runInNewContext(fs.readFileSync(lockPath, 'utf8'), ctx, { filename: lockPath });
}

describe('Priority 6 Fix 2 — search index leader lock', function () {
    var ctxA;
    var ctxB;

    beforeEach(function () {
        var sharedStorage = createMockStorage();
        function makeCtx() {
            return {
                console: console,
                localStorage: sharedStorage,
                navigator: { locks: null },
                BroadcastChannel: undefined
            };
        }
        ctxA = makeCtx();
        ctxB = makeCtx();
        ctxA.window = ctxA;
        ctxA.global = ctxA;
        ctxB.window = ctxB;
        ctxB.global = ctxB;
        loadLockModule(ctxA);
        loadLockModule(ctxB);
    });

    it('ems-search-index-lock.js exports leader gate API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-search-index-lock.js'), 'utf8');
        expect(src).toContain('emsSearchIndexLeaderGateChunk');
        expect(src).toContain('ems_search_index_leader_v');
        expect(src).toContain('ifAvailable');
    });

    it('only one tab acquires leader lock for a collection', async function () {
        var col = 'tenant_a__registrations';
        var a = await ctxA.emsSearchIndexLeaderTryAcquire(col);
        var b = await ctxB.emsSearchIndexLeaderTryAcquire(col);
        expect(a.acquired).toBe(true);
        expect(b.acquired).toBe(false);
        expect(b.reason).toBe('index_lock_busy');
    });

    it('follower gate returns observing skip without running chunk fn', async function () {
        var col = 'tenant_b__registrations';
        await ctxA.emsSearchIndexLeaderTryAcquire(col);
        var ran = false;
        var res = await ctxB.emsSearchIndexLeaderGateChunk(col, function () {
            ran = true;
            return Promise.resolve({ ok: true, chunkRows: 10, complete: false });
        });
        expect(ran).toBe(false);
        expect(res.skipped).toBe(true);
        expect(res.observing).toBe(true);
    });

    it('leader runs chunk and releases on complete', async function () {
        var col = 'tenant_c__registrations';
        var ran = false;
        var res = await ctxA.emsSearchIndexLeaderGateChunk(col, function () {
            ran = true;
            return Promise.resolve({ ok: true, chunkRows: 5, complete: true });
        });
        expect(ran).toBe(true);
        expect(res.complete).toBe(true);
        expect(ctxA.emsSearchIndexLeaderIsMine(col)).toBe(false);
    });

    it('ems-idb-engine.js wraps processChunk with leader gate', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idb-engine.js'), 'utf8');
        expect(src).toContain('emsSearchIndexLeaderGateChunk');
    });

    it('ems-search-index-bg.js observes remote build when chunk skipped', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-search-index-bg.js'), 'utf8');
        expect(src).toContain('observing');
        expect(src).toContain('ems-search-index-leader-v3');
    });

    it('index.html loads lock before search-index-bg', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var lockIdx = html.indexOf('ems-search-index-lock.js');
        var bgIdx = html.indexOf('ems-search-index-bg.js');
        expect(lockIdx).toBeGreaterThan(-1);
        expect(bgIdx).toBeGreaterThan(lockIdx);
    });

    it('follower acquires lock after simulated crash expiry', async function () {
        var col = 'tenant_crash__registrations';
        await ctxA.emsSearchIndexLeaderTryAcquire(col);
        var crash = ctxA.emsSearchIndexLeaderSimulateCrash(col);
        expect(crash.ok).toBe(true);
        expect(ctxA.emsSearchIndexLeaderIsLeaseExpired(col)).toBe(true);
        var b = await ctxB.emsSearchIndexLeaderTryAcquire(col);
        expect(b.acquired).toBe(true);
    });

    it('registers pagehide release and crash simulation for failover', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-search-index-lock.js'), 'utf8');
        expect(src).toContain('pagehide');
        expect(src).toContain('emsSearchIndexLeaderSimulateCrash');
        expect(src).toContain('emsSearchIndexLeaderIsLeaseExpired');
    });
});
