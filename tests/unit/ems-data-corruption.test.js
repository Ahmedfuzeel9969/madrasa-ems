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
        clear: function () { map = Object.create(null); },
        _dump: function () { return map; }
    };
}

function loadEmsScripts(ctx) {
    var corruptionPath = path.join(ROOT, 'ems-data-corruption.js');
    var cachePath = path.join(ROOT, 'ems-data-cache.js');
    vm.runInNewContext(fs.readFileSync(corruptionPath, 'utf8'), ctx, { filename: corruptionPath });
    vm.runInNewContext(fs.readFileSync(cachePath, 'utf8'), ctx, { filename: cachePath });
}

describe('Priority 3 — Data Corruption Detection UX', function () {
    var ctx;

    beforeEach(function () {
        var storage = createMockStorage();
        ctx = {
            console: console,
            localStorage: storage,
            CustomEvent: function (type, init) {
                this.type = type;
                this.detail = init && init.detail;
            },
            dispatchEvent: vi.fn(),
            showTopAlert: vi.fn(),
            showToast: vi.fn(),
            emsIdbKvGet: vi.fn(function () { return Promise.resolve(null); }),
            emsCacheInvalidate: vi.fn(),
            emsCacheSet: vi.fn(function (key, value) {
                storage.setItem(key, JSON.stringify(value));
            })
        };
        ctx.window = ctx;
        ctx.global = ctx;
        ctx._emsOriginalGetItem = storage.getItem.bind(storage);
        ctx._emsOriginalSetItem = storage.setItem.bind(storage);
        ctx._emsOriginalRemoveItem = storage.removeItem.bind(storage);
        ctx.emsSafeLocalGet = function (key) {
            return ctx._emsOriginalGetItem(key);
        };
        loadEmsScripts(ctx);
    });

    it('ems-data-corruption.js is loaded before ems-data-cache.js in post-auth foundation', function () {
        var loader = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var corruptIdx = loader.indexOf("'ems-data-corruption.js'");
        var cacheIdx = loader.indexOf("'ems-data-cache.js'");
        expect(corruptIdx).toBeGreaterThan(-1);
        expect(cacheIdx).toBeGreaterThan(corruptIdx);
    });

    it('detects corrupt JSON instead of returning empty fallback array', function () {
        ctx.localStorage.setItem('ems_full_users', '{not valid json');
        var result = ctx.emsCacheGet('ems_full_users', []);
        expect(ctx.emsIsCorruptData(result)).toBe(true);
        expect(result.__emsCorruptKey).toBe('ems_full_users');
        expect(Array.isArray(result) && result.length === 0).toBe(true);
        expect(result === []).toBe(false);
        expect(ctx.emsDataCorruptionList()).toContain('ems_full_users');
    });

    it('shows user-facing warning on corruption', function () {
        ctx.localStorage.setItem('ems_fee_collections', '[[broken');
        ctx.emsCacheGet('ems_fee_collections', []);
        expect(ctx.showTopAlert).toHaveBeenCalled();
        var msg = ctx.showTopAlert.mock.calls[0][0];
        expect(msg).toMatch(/خراب|corrupt/i);
        expect(msg).toMatch(/ems_fee_collections/);
    });

    it('does not treat missing key as corruption', function () {
        var result = ctx.emsCacheGet('ems_missing_key', []);
        expect(result).toEqual([]);
        expect(ctx.emsIsCorruptData(result)).toBe(false);
        expect(ctx.emsDataCorruptionList()).toEqual([]);
        expect(ctx.showTopAlert).not.toHaveBeenCalled();
    });

    it('attempts safe automatic recovery from IndexedDB mirror when valid', async function () {
        ctx.localStorage.setItem('ems_full_ledger', '{bad json');
        ctx.emsIdbKvGet.mockResolvedValue(JSON.stringify([{ id: 'L1', amount: 100 }]));

        var first = ctx.emsCacheGet('ems_full_ledger', []);
        expect(ctx.emsIsCorruptData(first)).toBe(true);

        var recovered = await ctx.emsDataCorruptionTryRecover('ems_full_ledger');
        expect(recovered.ok).toBe(true);
        expect(recovered.value).toEqual([{ id: 'L1', amount: 100 }]);
        expect(JSON.parse(ctx.localStorage.getItem('ems_full_ledger'))).toEqual([{ id: 'L1', amount: 100 }]);
        expect(ctx.emsDataCorruptionList()).not.toContain('ems_full_ledger');
    });

    it('schedules auto-recovery once per corrupt key read', function () {
        var scheduleSpy = vi.spyOn(ctx, 'emsDataCorruptionScheduleRecover');
        ctx.localStorage.setItem('ems_full_complaints', '}{');
        ctx.emsCacheGet('ems_full_complaints', []);
        expect(scheduleSpy).toHaveBeenCalledWith('ems_full_complaints');
        ctx.emsCacheGet('ems_full_complaints', []);
        expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });

    it('core.js getData reports corruption instead of silent empty list', function () {
        var coreSrc = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(coreSrc).toContain('emsDataCorruptionReport');
        expect(coreSrc).toContain('emsIsCorruptData');
    });

    it('recovery procedure documentation exists', function () {
        var docPath = path.join(ROOT, 'docs', 'DATA-CORRUPTION-RECOVERY.md');
        expect(fs.existsSync(docPath)).toBe(true);
        var doc = fs.readFileSync(docPath, 'utf8');
        expect(doc).toContain('emsDataCorruptionTryRecover');
        expect(doc).toContain('Cloud Sync');
    });
});
