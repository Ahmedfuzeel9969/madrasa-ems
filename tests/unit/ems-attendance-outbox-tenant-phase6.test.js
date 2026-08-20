import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var DOC = 'att_rec_2026-08_teachers__all';

function loadIdentity() {
    var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var start = src.indexOf('function isAttendanceQueueType');
    var end = src.indexOf('function rowEligibleForFlush');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    var sandbox = {
        getVerifiedAttendanceTenantId: function () { return sandbox._attTid || null; },
        getTenantId: function () { return sandbox._tid || null; }
    };
    sandbox.global = sandbox;
    vm.runInNewContext(
        'function getVerifiedAttendanceTenantId(){ return global._attTid || null; }\n'
        + 'function getTenantId(){ return global._tid || null; }\n'
        + src.slice(start, end)
        + '\nthis.queueMapKey = queueMapKey;'
        + '\nthis.queueRowsSameIdentity = queueRowsSameIdentity;'
        + '\nthis.rowBelongsToActiveTenant = rowBelongsToActiveTenant;'
        + '\nthis.isAttendanceQueueType = isAttendanceQueueType;',
        sandbox
    );
    return sandbox;
}

function makeMemoryOutbox() {
    var id = 0;
    var api = loadIdentity();
    var store = [];
    var dead = [];
    function upsert(row) {
        var key = api.queueMapKey(row.type, row.docId, row.tenantId);
        var existing = store.find(function (r) {
            return api.queueMapKey(r.type, r.docId, r.tenantId) === key;
        });
        if (existing) {
            if (row.type === 'attendance_patch' && existing.payload && row.payload
                && api.queueRowsSameIdentity(existing, row)) {
                row.payload = Object.assign({}, existing.payload, row.payload);
            }
            Object.assign(existing, row);
            return existing;
        }
        var created = Object.assign({ id: ++id, retryCount: 0 }, row);
        store.push(created);
        return created;
    }
    function flushTenant(tid) {
        api._attTid = tid;
        api._tid = tid;
        var flushed = [];
        store = store.filter(function (r) {
            if (!api.rowBelongsToActiveTenant(r)) return true;
            flushed.push(r);
            return false;
        });
        return flushed;
    }
    function uiRows(tid) {
        api._attTid = tid;
        api._tid = tid;
        return store.filter(api.rowBelongsToActiveTenant);
    }
    function retryActive(tid) {
        api._attTid = tid;
        api._tid = tid;
        return store.filter(function (r) {
            return r.failed && api.rowBelongsToActiveTenant(r);
        }).map(function (r) {
            r.failed = false;
            r.retryCount = 0;
            delete r.nextRetryAt;
            return r;
        });
    }
    return { api: api, store: function () { return store; }, dead: dead, upsert: upsert, flushTenant: flushTenant, uiRows: uiRows, retryActive: retryActive };
}

describe('Phase 6 — tenant-safe attendance outbox (TASK 6.1)', function () {
    it('queue identity is tenantId + type + docId', function () {
        var api = loadIdentity();
        var a = api.queueMapKey('attendance', DOC, 'tenant-A');
        var b = api.queueMapKey('attendance', DOC, 'tenant-B');
        expect(a).toContain('tenant-A');
        expect(a).toContain('attendance');
        expect(a).toContain(DOC);
        expect(a).not.toBe(b);
        expect(api.queueRowsSameIdentity(
            { type: 'attendance', docId: DOC, tenantId: 'tenant-A' },
            { type: 'attendance', docId: DOC, tenantId: 'tenant-B' }
        )).toBe(false);
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('tenantTypeDoc');
        expect(src).toMatch(/var IDB_VER = 3/);
        expect(src).toContain('listQueueForActiveTenant');
        expect(src).toContain('queueRowsSameIdentity');
    });

    it('does not merge Tenant A and Tenant B patches for the same docId', function () {
        var box = makeMemoryOutbox();
        box.upsert({
            type: 'attendance_patch', docId: DOC, tenantId: 'tenant-A',
            payload: { 'periodRecords.T1.5.P1': 'P' }
        });
        box.upsert({
            type: 'attendance_patch', docId: DOC, tenantId: 'tenant-B',
            payload: { 'periodRecords.T1.5.P1': 'A' }
        });
        expect(box.store().length).toBe(2);
        expect(box.store()[0].payload['periodRecords.T1.5.P1']).toBe('P');
        expect(box.store()[1].payload['periodRecords.T1.5.P1']).toBe('A');
    });
});

describe('Phase 6 — tenant A/B same cloud docId (TASK 6.2)', function () {
    it('keeps two pending rows, flushes only B, then A still exists', function () {
        var box = makeMemoryOutbox();
        box.upsert({
            type: 'attendance', docId: DOC, tenantId: 'tenant-A',
            payload: { records: { T1: { 5: 'P' } } }, retryCount: 2, failed: true, nextRetryAt: 9
        });
        box.upsert({
            type: 'attendance', docId: DOC, tenantId: 'tenant-B',
            payload: { records: { T1: { 5: 'A' } } }
        });
        expect(box.store().length).toBe(2);

        expect(box.uiRows('tenant-B').length).toBe(1);
        expect(box.uiRows('tenant-B')[0].tenantId).toBe('tenant-B');
        expect(box.uiRows('tenant-A').length).toBe(1);

        var flushedB = box.flushTenant('tenant-B');
        expect(flushedB.length).toBe(1);
        expect(flushedB[0].tenantId).toBe('tenant-B');
        expect(box.store().length).toBe(1);
        expect(box.store()[0].tenantId).toBe('tenant-A');
        expect(box.store()[0].retryCount).toBe(2);
        expect(box.store()[0].failed).toBe(true);

        var retriedB = box.retryActive('tenant-B');
        expect(retriedB.length).toBe(0);
        expect(box.store()[0].retryCount).toBe(2);
        expect(box.store()[0].failed).toBe(true);

        var flushedA = box.flushTenant('tenant-A');
        expect(flushedA.length).toBe(1);
        expect(flushedA[0].tenantId).toBe('tenant-A');
        expect(box.store().length).toBe(0);
    });

    it('queue UI and pending counts under B hide A attendance rows', function () {
        var box = makeMemoryOutbox();
        box.upsert({ type: 'attendance', docId: DOC, tenantId: 'tenant-A' });
        box.upsert({ type: 'attendance', docId: 'other', tenantId: 'tenant-B' });
        expect(box.uiRows('tenant-B').map(function (r) { return r.docId; })).toEqual(['other']);
        expect(box.uiRows('tenant-B').some(function (r) { return r.tenantId === 'tenant-A'; })).toBe(false);
    });
});
