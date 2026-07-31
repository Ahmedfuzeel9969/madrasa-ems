import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function createMockStorage() {
    var map = Object.create(null);
    return {
        get length() { return Object.keys(map).length; },
        key: function (i) { return Object.keys(map)[i] || null; },
        getItem: function (k) { return map[k] != null ? map[k] : null; },
        setItem: function (k, v) { map[k] = String(v); },
        removeItem: function (k) { delete map[k]; },
        clear: function () { map = Object.create(null); },
        _dump: function () { return map; }
    };
}

function loadQuotaModule(ctx) {
    var quotaPath = path.join(ROOT, 'ems-storage-quota.js');
    vm.runInNewContext(fs.readFileSync(quotaPath, 'utf8'), ctx, { filename: quotaPath });
}

describe('Priority 6 Fix 1 — storage quota warnings', function () {
    var ctx;

    beforeEach(function () {
        var storage = createMockStorage();
        ctx = {
            console: console,
            localStorage: storage,
            document: {
                body: { appendChild: vi.fn() },
                getElementById: vi.fn(function () { return null; }),
                createElement: vi.fn(function () {
                    var el = {
                        id: '',
                        style: {},
                        textContent: '',
                        innerHTML: '',
                        setAttribute: vi.fn(),
                        querySelector: vi.fn(function () { return null; }),
                        addEventListener: vi.fn(),
                        __emsBound: false
                    };
                    return el;
                })
            },
            showTopAlert: vi.fn(),
            showToast: vi.fn(),
            confirm: vi.fn(function () { return true; }),
            dispatchEvent: vi.fn(),
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            emsIdbStorageEstimate: vi.fn(function () {
                return Promise.resolve({ usage: 100, quota: 1000, persisted: false });
            }),
            emsIdbReady: vi.fn(function () { return Promise.resolve(true); }),
            addEventListener: vi.fn()
        };
        ctx.window = ctx;
        ctx.global = ctx;
        loadQuotaModule(ctx);
    });

    afterEach(function () {
        if (ctx.emsStorageQuotaClearTestEstimate) ctx.emsStorageQuotaClearTestEstimate();
    });

    it('ems-storage-quota.js is loaded after ems-idb-engine in index.html', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var idbIdx = html.indexOf('ems-idb-engine.js');
        var quotaIdx = html.indexOf('ems-storage-quota.js');
        expect(idbIdx).toBeGreaterThan(-1);
        expect(quotaIdx).toBeGreaterThan(idbIdx);
    });

    it('classifies warn at 80%, danger at 90%, block at 95%', function () {
        expect(ctx.emsStorageQuotaClassify(79, 100).level).toBe('safe');
        expect(ctx.emsStorageQuotaClassify(80, 100).level).toBe('warn');
        expect(ctx.emsStorageQuotaClassify(90, 100).level).toBe('danger');
        expect(ctx.emsStorageQuotaClassify(95, 100).level).toBe('block');
    });

    it('shows Urdu warning when storage is in warn band', async function () {
        ctx.emsStorageQuotaSetTestEstimate(850, 1000);
        var status = await ctx.emsStorageQuotaCheck({ context: 'boot', showWarning: true });
        expect(status.level).toBe('warn');
        expect(ctx.showTopAlert).toHaveBeenCalled();
        var msg = ctx.showTopAlert.mock.calls[0][0];
        expect(msg).toMatch(/Storage|quota|جگہ|ذخیرہ/i);
        expect(msg).toMatch(/Backup/i);
    });

    it('does not warn under safe storage', async function () {
        ctx.emsStorageQuotaSetTestEstimate(500, 1000);
        var status = await ctx.emsStorageQuotaCheck({ context: 'boot', showWarning: true });
        expect(status.level).toBe('safe');
        expect(ctx.showTopAlert).not.toHaveBeenCalled();
    });

    it('blocks bulk unless admin confirms at 95%+', async function () {
        ctx.emsStorageQuotaSetTestEstimate(960, 1000);
        ctx.confirm.mockReturnValue(false);
        var gate = await ctx.emsStorageQuotaConfirmBulk({ context: 'bulk_import' });
        expect(gate.allowed).toBe(false);
        expect(gate.status.level).toBe('block');
    });

    it('allows bulk when admin confirms at 95%+', async function () {
        ctx.emsStorageQuotaSetTestEstimate(960, 1000);
        ctx.confirm.mockReturnValue(true);
        var gate = await ctx.emsStorageQuotaConfirmBulk({ context: 'bulk_import' });
        expect(gate.allowed).toBe(true);
    });

    it('reports quota write failures clearly', function () {
        var res = ctx.emsStorageQuotaOnWriteFailure('idb_kv:test', { name: 'QuotaExceededError' });
        expect(res.quota).toBe(true);
        expect(ctx.showTopAlert).toHaveBeenCalled();
        expect(ctx.showTopAlert.mock.calls[0][0]).toMatch(/محفوظ نہیں|Backup/i);
    });

    it('ems-import-queue.js gates bulk import through emsStorageQuotaConfirmBulk', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-import-queue.js'), 'utf8');
        expect(src).toContain('emsStorageQuotaConfirmBulk');
    });

    it('ems-idb-engine.js wires kv write failures to quota module', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idb-engine.js'), 'utf8');
        expect(src).toContain('emsStorageQuotaOnWriteFailure');
        expect(src).toContain('emsStorageQuotaCheck');
    });

    it('formats bytes and exposes clean temporary files action', function () {
        expect(ctx.emsStorageQuotaFormatBytes(1024)).toBe('1 KB');
        expect(ctx.emsStorageQuotaFormatBytes(1048576)).toBe('1 MB');
    });

    it('clean temporary files removes probe keys safely', async function () {
        ctx.localStorage.setItem('ems_data_pipeline_debug', '[]');
        ctx.localStorage.setItem('ems_import_queue_staging_x', '{}');
        ctx.emsIdbColClear = vi.fn(function () { return Promise.resolve(2); });
        ctx.emsIdbKvKeys = vi.fn(function () { return Promise.resolve(['p6_probe_key']); });
        ctx.emsIdbKvDelete = vi.fn(function () { return Promise.resolve(true); });
        var res = await ctx.emsStorageQuotaCleanTemporaryFiles();
        expect(res.lsKeys).toBeGreaterThan(0);
        expect(res.removedTotal).toBeGreaterThan(0);
    });

    it('quota check includes formatted used/total/remaining fields', async function () {
        ctx.emsStorageQuotaSetTestEstimate(750000000, 1000000000);
        var status = await ctx.emsStorageQuotaCheck({ context: 'test', showWarning: false });
        expect(status.usageFormatted).toMatch(/MB|GB/);
        expect(status.quotaFormatted).toMatch(/MB|GB/);
        expect(status.remainingFormatted).toMatch(/MB|GB/);
        expect(status.remaining).toBe(250000000);
    });
});
