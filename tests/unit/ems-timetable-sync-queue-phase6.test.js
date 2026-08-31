/**
 * PHASE 6 — Timetable sync queue tenant binding + offline tenant-switch safety
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var PERIODS_KEY = 'ems_att_periods';
var TENANT_A = 'tenant-A';
var TENANT_B = 'tenant-B';

function loadOutboxEnv() {
    var store = [];
    var id = 0;
    var sb = {
        store: store,
        console: console,
        Promise: Promise,
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_TRANSITION_IN_PROGRESS: false,
        EMS_TENANT_GENERATION: 0,
        _attTid: null,
        _tid: null,
        EmsSyncEngine: {
            writeModuleKey: function (tid, key, value) {
                sb._lastFlush = { tenantId: tid, key: key, value: value };
                return Promise.resolve(true);
            },
            getRegistryModule: function () { return 'Attendance'; }
        },
        attVerifyRemoteTimetableOwnership: function () { return { ok: true }; }
    };
    sb.global = sb;
    sb.globalThis = sb;
    sb.window = sb;

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sb);

    var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var slice = src.slice(
        src.indexOf('function isAttendanceQueueType'),
        src.indexOf('function readRaw(key)')
    ) + src.slice(
        src.indexOf('function flushSyncModuleRow'),
        src.indexOf('function flushDirectPersistRow')
    ) + src.slice(
        src.indexOf('function flushRow(row)'),
        src.indexOf('function flushMutationRowAndDequeueUnlocked')
    ) + src.slice(
        src.indexOf('global.emsOfflineEnqueueSyncModule = function'),
        src.indexOf('global.emsOfflineEnqueueDirectPersist = function')
    );

    // Minimal queue stub
    sb.upsertQueueByDocId = function (type, docId, row) {
        row = Object.assign({}, row);
        row.type = row.type || type;
        row.docId = docId;
        var key = sb.queueMapKey(row.type, row.docId, row.tenantId);
        var existing = store.find(function (r) {
            return sb.queueMapKey(r.type, r.docId, r.tenantId) === key;
        });
        if (existing) {
            Object.assign(existing, row);
            return Promise.resolve(existing);
        }
        row.id = ++id;
        store.push(row);
        return Promise.resolve(row);
    };

    vm.runInNewContext(
        'function getVerifiedAttendanceTenantId(){ return global._attTid || global.emsGetCanonicalTenantId(); }\n'
        + 'function getTenantId(){ return global._tid || global.emsGetCanonicalTenantId(); }\n'
        + 'function getDb(){ return {}; }\n'
        + slice
        + '\nthis.queueMapKey = queueMapKey;'
        + '\nthis.queueRowsSameIdentity = queueRowsSameIdentity;'
        + '\nthis.rowBelongsToActiveTenant = rowBelongsToActiveTenant;'
        + '\nthis.isTenantBoundSyncModuleKey = isTenantBoundSyncModuleKey;'
        + '\nthis.assertTenantBoundSyncModuleEnqueue = assertTenantBoundSyncModuleEnqueue;'
        + '\nthis.flushSyncModuleRow = flushSyncModuleRow;'
        + '\nthis.flushRow = flushRow;'
        + '\nthis.emsOfflineEnqueueSyncModule = global.emsOfflineEnqueueSyncModule;',
        sb
    );

    sb.setBoth = function (tid) {
        sb.CURRENT_MADRASA_TENANT_ID = tid;
        sb.EMS_ACTIVE_TENANT_ID = tid;
        sb._attTid = tid;
        sb._tid = tid;
        sb.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
    };

    return sb;
}

describe('Phase 6 — TASK 6.1 explicit tenant on timetable queue items', function () {
    var env;

    beforeEach(function () {
        env = loadOutboxEnv();
        env.setBoth(TENANT_A);
    });

    it('ems_att_periods enqueue requires explicit tenantId — no fallback without tenant', async function () {
        env.CURRENT_MADRASA_TENANT_ID = null;
        env.EMS_ACTIVE_TENANT_ID = null;
        env._attTid = null;
        env._tid = null;

        var res = await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[]', { module: 'Attendance' });
        expect(res.ok).toBe(false);
        expect(res.code).toBe('TENANT_REQUIRED');
        expect(env.store.length).toBe(0);
    });

    it('tenant A and B ems_att_periods queue rows are separate identities', async function () {
        await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[{"id":"A1"}]', {
            module: 'Attendance', tenantId: TENANT_A
        });
        env.setBoth(TENANT_B);
        await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[{"id":"B1"}]', {
            module: 'Attendance', tenantId: TENANT_B
        });
        expect(env.store.length).toBe(2);
        expect(env.store[0].tenantId).toBe(TENANT_A);
        expect(env.store[1].tenantId).toBe(TENANT_B);
        expect(env.queueMapKey('sync_module', PERIODS_KEY, TENANT_A))
            .not.toBe(env.queueMapKey('sync_module', PERIODS_KEY, TENANT_B));
    });

    it('rejects enqueue when explicit tenantId != active tenant', async function () {
        env.setBoth(TENANT_A);
        var res = await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[]', {
            module: 'Attendance', tenantId: TENANT_B
        });
        expect(res.code).toBe('TENANT_MISMATCH');
        expect(env.store.length).toBe(0);
    });

    it('attEnqueueSyncModuleBlob fail-closed without verified tenant', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('function attEnqueueSyncModuleBlob'),
            att.indexOf('\nfunction attPersistConfigBlob')
        );
        expect(block).toContain('TENANT_REQUIRED');
        expect(block).toMatch(/if\s*\(\s*!tenantId\s*\)/);
        expect(block).toContain('tenantId: tenantId');
    });

    it('source lock: assertTenantBoundSyncModuleEnqueue + isTenantBoundSyncModuleKey', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('function assertTenantBoundSyncModuleEnqueue');
        expect(src).toContain('function isTenantBoundSyncModuleKey');
        expect(src).toMatch(/tenantId:\s*bound\.tenantId/);
    });
});

describe('Phase 6 — TASK 6.2 offline tenant-switch safety', function () {
    var env;

    beforeEach(function () {
        env = loadOutboxEnv();
    });

    it('enqueue blocked during tenant transition', async function () {
        env.setBoth(TENANT_A);
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = true;
        var res = await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[]', {
            module: 'Attendance', tenantId: TENANT_A
        });
        expect(res.code).toBe('TENANT_TRANSITION');
        expect(env.store.length).toBe(0);
    });

    it('active tenant B hides A sync_module row from UI filter', async function () {
        env.setBoth(TENANT_A);
        await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[{"id":"A1"}]', {
            module: 'Attendance', tenantId: TENANT_A
        });
        env.setBoth(TENANT_B);
        await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[{"id":"B1"}]', {
            module: 'Attendance', tenantId: TENANT_B
        });
        var visible = env.store.filter(env.rowBelongsToActiveTenant);
        expect(visible.length).toBe(1);
        expect(visible[0].tenantId).toBe(TENANT_B);
    });

    it('flushSyncModuleRow skips when row tenant != active tenant', async function () {
        env.setBoth(TENANT_B);
        var row = {
            type: 'sync_module',
            docId: PERIODS_KEY,
            tenantId: TENANT_A,
            payload: { key: PERIODS_KEY, value: '[{"id":"A1"}]' }
        };
        var res = await env.flushSyncModuleRow(row);
        expect(res.skip).toBe(true);
        expect(res.code).toBe('TENANT_MISMATCH');
        expect(env._lastFlush).toBeFalsy();
    });

    it('flushSyncModuleRow writes when row tenant matches active tenant', async function () {
        env.setBoth(TENANT_A);
        var row = {
            type: 'sync_module',
            docId: PERIODS_KEY,
            tenantId: TENANT_A,
            payload: { key: PERIODS_KEY, value: '[{"id":"A1"}]' }
        };
        var res = await env.flushSyncModuleRow(row);
        expect(res.ok).toBe(true);
        expect(env._lastFlush.tenantId).toBe(TENANT_A);
        expect(env._lastFlush.key).toBe(PERIODS_KEY);
    });

    it('flushSyncModuleRow blocks a queued timetable that no longer matches the active teacher roster', async function () {
        env.setBoth(TENANT_A);
        env.attVerifyRemoteTimetableOwnership = function () {
            return { ok: false, reason: 'teacher_roster_mismatch' };
        };
        var row = {
            type: 'sync_module',
            docId: PERIODS_KEY,
            tenantId: TENANT_A,
            payload: { key: PERIODS_KEY, value: '[{"id":"FOREIGN-1","teacherId":"OTHER"}]' }
        };
        var res = await env.flushSyncModuleRow(row);
        expect(res.ok).toBe(false);
        expect(res.code).toBe('TIMETABLE_UNVERIFIED');
        expect(env._lastFlush).toBeFalsy();
    });

    it('switch A→B→A: A row survives and flushes only when A active', async function () {
        env.setBoth(TENANT_A);
        await env.emsOfflineEnqueueSyncModule(PERIODS_KEY, '[{"id":"A1"}]', {
            module: 'Attendance', tenantId: TENANT_A
        });
        env.setBoth(TENANT_B);
        expect(env.store.filter(env.rowBelongsToActiveTenant).length).toBe(0);

        env.setBoth(TENANT_A);
        var visible = env.store.filter(env.rowBelongsToActiveTenant);
        expect(visible.length).toBe(1);
        var res = await env.flushSyncModuleRow(visible[0]);
        expect(res.ok).toBe(true);
        expect(env._lastFlush.tenantId).toBe(TENANT_A);
    });

    it('canCloudWrite blocked during tenant transition (source lock)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var block = src.slice(
            src.indexOf('function canCloudWrite'),
            src.indexOf('global.emsOfflineCanMutationPush')
        );
        expect(block).toContain('emsIsTenantTransitionInProgress');
    });
});
