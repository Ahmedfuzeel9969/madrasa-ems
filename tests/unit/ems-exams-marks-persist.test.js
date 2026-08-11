import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams marks grid persistence hardening', function () {
    it('emsSaveKey does not pre-write durable before module save (cloud delta needs oldStr)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var start = src.indexOf('function emsSaveKey(key, val, opts)');
        expect(start).toBeGreaterThan(-1);
        var end = src.indexOf('\n  function exmGetUsers', start);
        var fn = src.slice(start, end);
        expect(fn).toContain('emsSaveModuleData');
        expect(fn).not.toContain('emsDurableWriteRaw');
    });

    it('save flushes visible inputs and awaits durable ensure before write', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmFlushVisibleMarkInputsToGrid');
        expect(src).toContain('exmFlushVisibleMarkInputsToGrid()');
        expect(src).toContain('emsDurableEnsureKey(DB.exams)');
        expect(src).toContain('btn-save-all-marks');
        expect(src).toMatch(/Promise\.resolve\(emsSaveKey\(DB\.exams/);
    });

    it('grid bind maps marks by student id, not only row index', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain("tr.getAttribute('data-std-id')");
        expect(src).toMatch(/findIndex\(function \(r\) \{\s*return r\.student && r\.student\.id === stdId/);
    });

    it('exams cloud pull does not forceApply overwrite of dirty local marks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('forceApply: false');
        expect(src).not.toMatch(/pullOpts\s*=\s*\{\s*forceFull:\s*true,\s*delta:\s*false,\s*forceApply:\s*true\s*\}/);
        var pull = fs.readFileSync(path.join(ROOT, 'ems-cloud-pull.js'), 'utf8');
        expect(pull).toContain('forceApply: false');
    });

    it('durable ensureKey hydrates from IDB before sync reads', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-durable-storage.js'), 'utf8');
        expect(src).toContain('global.emsDurableEnsureKey');
        expect(src).toContain('emsIdbKvGet');
    });

    it('full array pull prefers newer local exam records when dirty', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud/direct-firestore.js'), 'utf8');
        expect(src).toContain('function mergeArrayPreferNewer');
        expect(src).toContain('mergeArrayPreferNewer(existing, incoming');
        expect(src).toContain('markDirty(localKey)');
        expect(src).toContain('emsDurableReadRaw(localKey)');
    });

    it('mergeArrayPreferNewer keeps higher timestamp', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud/direct-firestore.js'), 'utf8');
        var start = src.indexOf('function mergeArrayPreferNewer');
        var end = src.indexOf('\n    function pullArray', start);
        expect(start).toBeGreaterThan(-1);
        var sandbox = {};
        vm.runInNewContext(src.slice(start, end) + '\nthis.mergeArrayPreferNewer = mergeArrayPreferNewer;', sandbox);
        var merged = sandbox.mergeArrayPreferNewer(
            [{ id: 'a', timestamp: 200, marks: { x: 90 } }, { id: 'b', timestamp: 50, marks: { x: 10 } }],
            [{ id: 'a', timestamp: 100, marks: { x: 1 } }, { id: 'c', timestamp: 5, marks: { x: 5 } }],
            'id',
            'timestamp'
        );
        var byId = {};
        merged.forEach(function (r) { byId[r.id] = r; });
        expect(byId.a.marks.x).toBe(90);
        expect(byId.b.marks.x).toBe(10);
        expect(byId.c.marks.x).toBe(5);
    });
});
