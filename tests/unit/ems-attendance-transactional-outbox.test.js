import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadTransactionHelper() {
    var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var start = src.indexOf('function attendanceFieldPathState');
    var end = src.indexOf('\n    /** One tenant/document', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    var sandbox = { Promise: Promise, Object: Object, Number: Number, Error: Error };
    vm.runInNewContext(
        src.slice(start, end) + '\nthis.runAttendancePatchTransaction = runAttendancePatchTransaction;',
        sandbox
    );
    return sandbox.runAttendancePatchTransaction;
}

function loadFullTransactionHelper() {
    var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var start = src.indexOf('function runAttendanceFullTransaction');
    var end = src.indexOf('\n    function flushAttendanceRow', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    var sandbox = { Promise: Promise, Object: Object, Number: Number, Error: Error };
    vm.runInNewContext(
        src.slice(start, end) + '\nthis.runAttendanceFullTransaction = runAttendanceFullTransaction;',
        sandbox
    );
    return sandbox.runAttendanceFullTransaction;
}

function fakeDb(snapshot) {
    var writes = [];
    var db = {
        runTransaction: function (callback) {
            var tx = {
                get: function () { return Promise.resolve(snapshot); },
                set: function (ref, payload, options) {
                    writes.push({ op: 'set', ref: ref, payload: payload, options: options });
                },
                update: function (ref, payload) {
                    writes.push({ op: 'update', ref: ref, payload: payload });
                }
            };
            return Promise.resolve(callback(tx));
        }
    };
    return { db: db, writes: writes };
}

describe('Attendance transactional outbox hardening', function () {
    it('creates a missing monthly sheet once with a nested payload', async function () {
        var run = loadTransactionHelper();
        var f = fakeDb({ exists: false, data: function () { return {}; } });
        var ref = { id: 'att_rec_2026-09_students_A_all' };
        var result = await run(f.db, ref, { 'records.S1.1': 'P' }, {
            records: { S1: { 1: 'P' } }, timestamp: 10
        });
        expect(result.created).toBe(true);
        expect(f.writes).toHaveLength(1);
        expect(f.writes[0].op).toBe('set');
        expect(f.writes[0].payload.records.S1[1]).toBe('P');
        expect(f.writes[0].payload._version).toBe(1);
        expect(f.writes[0].options).toEqual({ merge: false });
    });

    it('updates only supplied field paths and advances the server-observed version', async function () {
        var run = loadTransactionHelper();
        var f = fakeDb({ exists: true, data: function () {
            return { _version: 7, records: { S1: { 1: 'P' }, S2: { 1: 'A' } } };
        } });
        var result = await run(f.db, { id: 'sheet' }, {
            'records.S1.2': 'L', clientUpdatedAt: 20
        }, {});
        expect(result.created).toBe(false);
        expect(f.writes).toHaveLength(1);
        expect(f.writes[0].op).toBe('update');
        expect(f.writes[0].payload['records.S1.2']).toBe('L');
        expect(f.writes[0].payload.records).toBeUndefined();
        expect(f.writes[0].payload._version).toBe(8);
    });

    it('rejects a same-cell conflict but permits a change to another cell', async function () {
        var run = loadTransactionHelper();
        var snapshot = { exists: true, data: function () {
            return { _version: 2, records: { S1: { 1: 'A' }, S2: { 1: 'P' } } };
        } };
        var conflicting = fakeDb(snapshot);
        await expect(run(conflicting.db, { id: 'sheet' }, {
            'records.S1.1': 'L'
        }, {}, {
            baseValues: { 'records.S1.1': { exists: true, value: 'P' } },
            desiredValues: { 'records.S1.1': 'L' }
        })).rejects.toMatchObject({ code: 'CELL_CONFLICT' });
        expect(conflicting.writes).toHaveLength(0);

        var unrelated = fakeDb(snapshot);
        await expect(run(unrelated.db, { id: 'sheet' }, {
            'records.S2.2': 'A'
        }, {}, {
            baseValues: { 'records.S2.2': { exists: false } },
            desiredValues: { 'records.S2.2': 'A' }
        })).resolves.toMatchObject({ created: false, version: 3 });
        expect(unrelated.writes[0].payload['records.S2.2']).toBe('A');
    });

    it('treats an already-applied retry as idempotent', async function () {
        var run = loadTransactionHelper();
        var f = fakeDb({ exists: true, data: function () {
            return { _version: 4, records: { S1: { 1: 'L' } } };
        } });
        await expect(run(f.db, { id: 'sheet' }, {
            'records.S1.1': 'L'
        }, {}, {
            baseValues: { 'records.S1.1': { exists: true, value: 'P' } },
            desiredValues: { 'records.S1.1': 'L' }
        })).resolves.toMatchObject({ version: 5 });
    });

    it('fails closed when the transaction API is missing', async function () {
        var run = loadTransactionHelper();
        await expect(run({}, {}, {}, {})).rejects.toMatchObject({
            code: 'TRANSACTION_UNAVAILABLE'
        });
    });

    it('protects legacy full snapshots from overwriting a newer cloud copy', async function () {
        var run = loadFullTransactionHelper();
        var f = fakeDb({ exists: true, data: function () {
            return { _version: 9, clientUpdatedAt: 500, records: { S1: { 1: 'P' } } };
        } });
        await expect(run(f.db, { id: 'sheet' }, {
            clientUpdatedAt: 400, records: { S1: { 1: 'A' } }
        })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
        expect(f.writes).toHaveLength(0);
    });

    it('writes an allowed legacy full snapshot with a transaction version', async function () {
        var run = loadFullTransactionHelper();
        var f = fakeDb({ exists: true, data: function () {
            return { _version: 9, clientUpdatedAt: 500 };
        } });
        var result = await run(f.db, { id: 'sheet' }, {
            clientUpdatedAt: 600, records: { S1: { 1: 'A' } }
        });
        expect(result.version).toBe(10);
        expect(f.writes).toHaveLength(1);
        expect(f.writes[0].op).toBe('set');
        expect(f.writes[0].payload._version).toBe(10);
        expect(f.writes[0].options).toEqual({ merge: false });
    });

    it('generates granular remarks, late and daily-lock patches', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attMergeCloudPatches');
        var end = src.indexOf('\nfunction attPauseDictObserver', start);
        var sandbox = {};
        vm.runInNewContext(
            src.slice(start, end) + '\nthis.attComputeSheetCloudPatch = attComputeSheetCloudPatch;',
            sandbox
        );
        var patch = sandbox.attComputeSheetCloudPatch({
            remarks: { S1: { 1: 'old' }, S2: { 1: 'keep' } },
            late: { S1: { 1: '08:15' } },
            dailyLocks: { 1: true }, timestamp: 1
        }, {
            remarks: { S1: { 2: 'new' }, S2: { 1: 'keep' } },
            late: { S1: { 1: '08:20' } },
            dailyLocks: { 2: true }, timestamp: 2
        });
        expect(patch['remarks.S1.1']).toBe(null);
        expect(patch['remarks.S1.2']).toBe('new');
        expect(patch['remarks.S2.1']).toBeUndefined();
        expect(patch['late.S1.1']).toBe('08:20');
        expect(patch['dailyLocks.1']).toBe(null);
        expect(patch['dailyLocks.2']).toBe(true);
        expect(patch.remarks).toBeUndefined();
        expect(patch.late).toBeUndefined();
        expect(patch.dailyLocks).toBeUndefined();
    });

    it('captures previous cell values and keeps the earliest coalesced baseline', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attPatchPathState');
        var end = src.indexOf('\nfunction attSetRegisterLoadBusy', start);
        var sandbox = {};
        vm.runInNewContext(
            src.slice(start, end)
            + '\nthis.attBuildPatchBaseValues = attBuildPatchBaseValues;'
            + '\nthis.attMergePatchBaseValues = attMergePatchBaseValues;',
            sandbox
        );
        var base = sandbox.attBuildPatchBaseValues(
            { records: { S1: { 1: 'P' } } },
            { 'records.S1.1': 'A', 'records.S2.1': 'L', timestamp: 20 }
        );
        expect(base['records.S1.1']).toEqual({ exists: true, value: 'P' });
        expect(base['records.S2.1']).toEqual({ exists: false });
        expect(base.timestamp).toBeUndefined();

        var merged = sandbox.attMergePatchBaseValues(
            { 'records.S1.1': { exists: true, value: 'P' } },
            {
                'records.S1.1': { exists: true, value: 'A' },
                'records.S2.1': { exists: false }
            }
        );
        expect(merged['records.S1.1'].value).toBe('P');
        expect(merged['records.S2.1']).toEqual({ exists: false });
    });

    it('never reports an IndexedDB enqueue failure as queued success', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var start = src.indexOf('function enqueue(row)');
        var end = src.indexOf('\n    function listQueueForActiveTenant', start);
        var block = src.slice(start, end);
        expect(block).toContain("queueErr.code = 'OUTBOX_ENQUEUE_FAILED'");
        expect(block).toContain('throw queueErr');
        expect(block).not.toMatch(/catch\(function \(err\)[\s\S]*return row;/);

        var persistStart = src.indexOf('global.emsOfflinePersistAttendance');
        var persistEnd = src.indexOf('global.emsOfflinePersistRegistration', persistStart);
        var persist = src.slice(persistStart, persistEnd);
        expect(persist).toContain('localDurableSaved = true');
        expect(persist).toContain('localSaved: localDurableSaved');
        expect(persist).toContain('patchBase: opts.patchBase || {}');
    });
});
