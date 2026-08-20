import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadPatchHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var start = src.indexOf('function attMergeCloudPatches');
    var end = src.indexOf('\nfunction attPauseDictObserver');
    expect(start).toBeGreaterThan(-1);
    var fnSrc = src.slice(start, end);
    var sandbox = {};
    vm.runInNewContext(
        fnSrc
        + '\nthis.attMergeCloudPatches = attMergeCloudPatches;'
        + '\nthis.attComputeSheetCloudPatch = attComputeSheetCloudPatch;'
        + '\nthis.attAppendForcedClearPatch = attAppendForcedClearPatch;'
        + '\nthis.attDiffPeriodRecordsPatch = attDiffPeriodRecordsPatch;',
        sandbox
    );
    return sandbox;
}

describe('Phase 5 — cloud patch concurrency (TASK 5.2)', function () {
    it('emits granular periodRecords paths instead of whole-map replace', function () {
        var h = loadPatchHelpers();
        var prev = { periodRecords: {}, timestamp: 1 };
        var next = {
            periodRecords: {
                T1: { '5': { 'PRD-1': 'P' } },
                T2: { '5': { 'PRD-2': 'A' } }
            },
            timestamp: 2
        };
        var patch = h.attComputeSheetCloudPatch(prev, next);
        expect(patch.periodRecords).toBeUndefined();
        expect(patch['periodRecords.T1.5.PRD-1']).toBe('P');
        expect(patch['periodRecords.T2.5.PRD-2']).toBe('A');
    });

    it('keeps unrelated teacher period marks when patches are merged', function () {
        var h = loadPatchHelpers();
        var patchA = h.attComputeSheetCloudPatch(
            { periodRecords: {}, timestamp: 1 },
            { periodRecords: { TA: { '5': { P1: 'P' } } }, timestamp: 2 }
        );
        var patchB = h.attComputeSheetCloudPatch(
            { periodRecords: { TA: { '5': { P1: 'P' } } }, timestamp: 2 },
            {
                periodRecords: {
                    TA: { '5': { P1: 'P' } },
                    TB: { '5': { P2: 'A' } }
                },
                timestamp: 3
            }
        );
        var merged = h.attMergeCloudPatches(patchA, patchB);
        expect(merged['periodRecords.TA.5.P1']).toBe('P');
        expect(merged['periodRecords.TB.5.P2']).toBe('A');
        expect(merged.periodRecords).toBeUndefined();
    });

    it('resolves same-cell updates deterministically (last patch wins)', function () {
        var h = loadPatchHelpers();
        var first = { 'periodRecords.T1.5.P1': 'P', timestamp: 1 };
        var second = { 'periodRecords.T1.5.P1': 'A', timestamp: 2 };
        var merged = h.attMergeCloudPatches(first, second);
        expect(merged['periodRecords.T1.5.P1']).toBe('A');
    });

    it('clear delete path wins over an older mark in merged queue', function () {
        var h = loadPatchHelpers();
        var mark = { 'periodRecords.T1.5.P1': 'P', timestamp: 1 };
        var clear = { 'periodRecords.T1.5.P1': null, timestamp: 2 };
        var merged = h.attMergeCloudPatches(mark, clear);
        expect(merged['periodRecords.T1.5.P1']).toBe(null);
    });

    it('forced clear uses granular day delete paths for periodRecords', function () {
        var h = loadPatchHelpers();
        var patch = h.attAppendForcedClearPatch({}, [{ uid: 'T1', day: 5 }], {
            records: {},
            periodRecords: { T1: { '5': { P1: 'P' } }, T2: { '5': { P2: 'A' } } },
            timestamp: 9
        });
        expect(patch.periodRecords).toBeUndefined();
        expect(patch['periodRecords.T1.5']).toBe(null);
        expect(patch['records.T1.5']).toBe(null);
    });
});

describe('Phase 5 — save status contract (TASK 5.1)', function () {
    it('does not describe unconfirmed cloud writes as cloud-saved', function () {
        var status = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
        expect(status).toMatch(/else agg\.labelKey = 'local_only'/);
        expect(status).toMatch(/if \(agg\.cloud === 'synced'\) agg\.labelKey = 'local_and_cloud'/);
        expect(status).toContain("local_only: 'مقامی طور پر محفوظ'");
        expect(status).toContain("local_and_cloud: 'کلاؤڈ پر محفوظ'");
    });

    it('maps cloud result states without blocking local save', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain("attSaveStatusMarkLocal(cloudDocId, 'saved')");
        expect(att).toContain("attSaveStatusMarkCloud(p.cloudDocId, 'syncing')");
        expect(att).toContain('attSaveStatusOnCloudResult');
        expect(att).not.toContain('await window.emsOfflinePersistAttendance');
    });

    it('interprets tenant pending and permission failures distinctly', function () {
        var status = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
        expect(status).toContain("res.code === 'TENANT_PENDING'");
        expect(status).toContain("res.code === 'PERMISSION_DENIED'");
        expect(status).toContain("res.code === 'VERSION_CONFLICT'");
    });

    it('outbox merge uses attMergeCloudPatches for attendance_patch rows', function () {
        var off = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(off).toContain('function mergeAttendancePatchPayload');
        expect(off).toContain('global.attMergeCloudPatches');
        expect(off).toMatch(/hasGranularPeriod[\s\S]{0,200}delete patch\.periodRecords/);
    });
});
