import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function makeRecords(n) {
    var rows = [];
    for (var i = 0; i < n; i++) {
        rows.push({ id: 'STD-' + i, type: 'student', name: 'Student ' + i, timestamp: n - i });
    }
    return rows;
}

function loadUserService(full) {
    var g = {
        EMS_REPOSITORY_BOOT_COMPLETE: true,
        EMS_REPOSITORY_READY: true,
        emsRegRepoGetList: function (opts) {
            opts = opts || {};
            if (opts.limit) return full.slice(0, opts.limit);
            if (full.length > 500) return full.slice(0, 500);
            return full.slice();
        },
        emsRegRepoGetListReadonly: function () {
            return full;
        }
    };
    var ctx = { global: g, window: g, globalThis: g };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-user-service.js'), 'utf8'), ctx);
    return g;
}

describe('P1 — emsGetUsersMerged removes 1000-record cap', function () {
    it('source no longer forces DEFAULT_USER_PAGE_LIMIT in emsGetUsersMerged', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-user-service.js'), 'utf8');
        expect(src).toContain('emsRegRepoGetListReadonly');
        expect(src).not.toContain('options.limit = DEFAULT_USER_PAGE_LIMIT');
        expect(src).not.toMatch(/list\.length > DEFAULT_USER_PAGE_LIMIT/);
    });

    it('returns all SSOT records when readonly has more than 1000', function () {
        var g = loadUserService(makeRecords(1500));
        expect(g.emsGetUsersMerged().length).toBe(1500);
    });

    it('still honors explicit limit option', function () {
        var g = loadUserService(makeRecords(1500));
        expect(g.emsGetUsersMerged({ limit: 250 }).length).toBe(250);
    });

    it('type filter works across full dataset', function () {
        var rows = [{ id: 'TCH-1', type: 'teacher', name: 'Teacher' }].concat(makeRecords(50));
        var g = loadUserService(rows);
        expect(g.emsGetUsersMerged({ type: 'teacher' }).length).toBe(1);
        expect(g.emsGetUsersMerged({ type: 'student' }).length).toBe(50);
    });
});
