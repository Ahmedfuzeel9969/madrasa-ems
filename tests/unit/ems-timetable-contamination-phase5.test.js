/**
 * PHASE 5 — Timetable contamination audit (read-only) + safe quarantine recovery
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

function scopedKey(tid) {
    return 'ems_t_' + tid + '__' + PERIODS_KEY;
}

function quarantineKey(tid) {
    return scopedKey(tid) + '_quarantine_v1';
}

function loadEnv() {
    var physical = Object.create(null);
    function og(k) {
        return Object.prototype.hasOwnProperty.call(physical, k) ? physical[k] : null;
    }
    function os(k, v) {
        physical[k] = String(v);
    }

    var keyList = function () {
        return Object.keys(physical);
    };

    var sb = {
        physical: physical,
        console: console,
        Promise: Promise,
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_STORAGE_READY: true,
        EMS_TENANT_TRANSITION_IN_PROGRESS: false,
        EMS_TENANT_GENERATION: 1,
        EMS_TENANT_LEGACY_MIGRATION_ALLOWED: true,
        _emsOriginalGetItem: og,
        _emsOriginalSetItem: os,
        localStorage: {
            getItem: function (key) {
                var r = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
                return r ? og(r) : null;
            },
            setItem: function (key, value) {
                var r = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
                if (r) os(r, value);
            },
            removeItem: function (key) {
                var r = sb.emsResolveCacheKey ? sb.emsResolveCacheKey(key) : key;
                if (r) delete physical[r];
            },
            get length() { return keyList().length; },
            key: function (i) { return keyList()[i] || null; }
        },
        emsOfflineWriteLocalSync: function (key, data, opts) {
            opts = opts || {};
            var tid = opts.tenantId || sb.EMS_ACTIVE_TENANT_ID;
            if (!tid) return false;
            var pk = 'ems_t_' + tid + '__' + key;
            os(pk, JSON.stringify(data));
            return true;
        },
        attIsOfflineMode: function () { return true; },
        addEventListener: function () {}
    };
    sb.window = sb;
    sb.global = sb;
    sb.globalThis = sb;
    sb.document = { getElementById: function () { return null; } };

    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sb);

    var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var getTenant = att.slice(
        att.indexOf('function getAttendanceTenantId'),
        att.indexOf('\nfunction attNormalizeStorageScope')
    );
    var recoveryBlock = att.slice(
        att.indexOf('var ATT_SYMBOLS_KEY'),
        att.indexOf('\nfunction attReadHolidaysDb')
    );

    vm.runInNewContext(
        getTenant + '\n' + recoveryBlock
        + '\nthis.getAttendanceTenantId = getAttendanceTenantId;'
        + '\nthis.attAuditTimetableContamination = attAuditTimetableContamination;'
        + '\nthis.attRecoverContaminatedTimetable = attRecoverContaminatedTimetable;'
        + '\nthis.attParseTimetablePeriodList = attParseTimetablePeriodList;'
        + '\nthis.attRawLocalGetPhysical = attRawLocalGetPhysical;',
        sb
    );

    sb.setBoth = function (tid) {
        sb.CURRENT_MADRASA_TENANT_ID = tid;
        sb.EMS_ACTIVE_TENANT_ID = tid;
        sb.EMS_TENANT_STORAGE_READY = true;
        sb.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
    };

    sb.putPhysical = function (key, list) {
        os(key, JSON.stringify(list));
    };

    return sb;
}

describe('Phase 5 — TASK 5.1 read-only contamination auditor', function () {
    var env;

    beforeEach(function () {
        env = loadEnv();
        env.setBoth(TENANT_A);
    });

    it('reports clean scoped partition with no findings', function () {
        env.putPhysical(scopedKey(TENANT_A), [{ id: 'P-A1', name: 'A only', days: [1] }]);
        var report = env.attAuditTimetableContamination(TENANT_A);
        expect(report.readOnly).toBe(true);
        expect(report.contaminated).toBe(false);
        expect(report.findings.length).toBe(0);
        expect(report.sources.some(function (s) { return s.label === 'scoped_local' && s.exists; })).toBe(true);
    });

    it('flags CROSS_TENANT_PERIOD_ID_COLLISION when same id in A and B', function () {
        env.putPhysical(scopedKey(TENANT_A), [{ id: 'LEAK-1', name: 'Shared', days: [1] }]);
        env.putPhysical(scopedKey(TENANT_B), [{ id: 'LEAK-1', name: 'From B', days: [2] }]);
        var report = env.attAuditTimetableContamination(TENANT_A);
        expect(report.contaminated).toBe(true);
        var hit = report.findings.find(function (f) {
            return f.code === 'CROSS_TENANT_PERIOD_ID_COLLISION';
        });
        expect(hit).toBeTruthy();
        expect(hit.hits[0].otherTenantId).toBe(TENANT_B);
        expect(hit.hits[0].periodIds).toContain('LEAK-1');
    });

    it('flags LEGACY_ONLY_NO_SCOPED when only global key has data', function () {
        env.putPhysical(PERIODS_KEY, [{ id: 'LEG-1', name: 'Legacy', days: [1] }]);
        var report = env.attAuditTimetableContamination(TENANT_A);
        expect(report.findings.some(function (f) { return f.code === 'LEGACY_ONLY_NO_SCOPED'; })).toBe(true);
        expect(report.contaminated).toBe(false);
    });

    it('auditor never mutates physical storage', function () {
        env.putPhysical(scopedKey(TENANT_A), [{ id: 'P1', days: [1] }]);
        env.putPhysical(scopedKey(TENANT_B), [{ id: 'P1', days: [1] }]);
        var before = JSON.stringify(env.physical);
        env.attAuditTimetableContamination(TENANT_A);
        var afterKeys = Object.keys(env.physical).filter(function (k) {
            return k.indexOf('ems_timetable_contamination_audit') < 0;
        });
        var beforeObj = JSON.parse(before);
        afterKeys.forEach(function (k) {
            expect(env.physical[k]).toBe(beforeObj[k]);
        });
    });

    it('source lock: auditor and recovery exported on window', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('function attAuditTimetableContamination');
        expect(att).toContain('function attRecoverContaminatedTimetable');
        expect(att).toContain('window.attAuditTimetableContamination');
        expect(att).toContain('CROSS_TENANT_PERIOD_ID_COLLISION');
        expect(att).toContain('_quarantine_v1');
    });
});

describe('Phase 5 — TASK 5.2 safe recovery prefers cloud + quarantines', function () {
    var env;

    beforeEach(function () {
        env = loadEnv();
        env.setBoth(TENANT_A);
    });

    it('critical contamination + cloud: restore cloud and quarantine local', async function () {
        env.putPhysical(scopedKey(TENANT_A), [{ id: 'LEAK-1', name: 'Contaminated', days: [1] }]);
        env.putPhysical(scopedKey(TENANT_B), [{ id: 'LEAK-1', name: 'B original', days: [2] }]);
        var cloud = [{ id: 'CLOUD-A', name: 'Canonical A', days: [1] }];

        var res = await env.attRecoverContaminatedTimetable(TENANT_A, {
            cloudCanonicalList: cloud
        });

        expect(res.ok).toBe(true);
        expect(res.action).toBe('restore_cloud_quarantine_local');
        expect(res.restored).toBe(1);
        expect(res.quarantined).toBe(1);
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('CLOUD-A');
        expect(JSON.parse(env.physical[quarantineKey(TENANT_A)])[0].id).toBe('LEAK-1');
        // Never deletes other tenant or original B partition
        expect(JSON.parse(env.physical[scopedKey(TENANT_B)])[0].id).toBe('LEAK-1');
    });

    it('critical contamination without cloud: quarantine only, keep scoped', async function () {
        env.putPhysical(scopedKey(TENANT_A), [{ id: 'LEAK-1', name: 'Keep UI', days: [1] }]);
        env.putPhysical(scopedKey(TENANT_B), [{ id: 'LEAK-1', name: 'B', days: [2] }]);

        var res = await env.attRecoverContaminatedTimetable(TENANT_A, {});
        expect(res.action).toBe('quarantine_only_no_cloud');
        expect(res.quarantined).toBe(1);
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('LEAK-1');
        expect(env.physical[quarantineKey(TENANT_A)]).toBeTruthy();
    });

    it('unprovable legacy quarantined when migration not allowed', async function () {
        env.EMS_TENANT_LEGACY_MIGRATION_ALLOWED = false;
        env.putPhysical(PERIODS_KEY, [{ id: 'LEG-X', name: 'Orphan', days: [3] }]);

        var res = await env.attRecoverContaminatedTimetable(TENANT_A, {});
        expect(res.action).toBe('quarantine_unprovable_legacy');
        expect(res.quarantined).toBe(1);
        expect(env.physical[scopedKey(TENANT_A)]).toBeFalsy();
        expect(JSON.parse(env.physical[quarantineKey(TENANT_A)])[0].id).toBe('LEG-X');
        // Legacy global never deleted
        expect(JSON.parse(env.physical[PERIODS_KEY])[0].id).toBe('LEG-X');
    });

    it('empty scoped + cloud seeds from canonical without quarantine', async function () {
        var cloud = [{ id: 'C1', name: 'From cloud', days: [1] }];
        var res = await env.attRecoverContaminatedTimetable(TENANT_A, {
            cloudCanonicalList: cloud
        });
        expect(res.action).toBe('seed_from_cloud_canonical');
        expect(res.restored).toBe(1);
        expect(res.quarantined).toBe(0);
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('C1');
    });

    it('idempotent: second recovery does not duplicate quarantine rows', async function () {
        env.putPhysical(scopedKey(TENANT_A), [{ id: 'LEAK-1', days: [1] }]);
        env.putPhysical(scopedKey(TENANT_B), [{ id: 'LEAK-1', days: [2] }]);
        var cloud = [{ id: 'CLOUD-A', days: [1] }];
        await env.attRecoverContaminatedTimetable(TENANT_A, { cloudCanonicalList: cloud });
        await env.attRecoverContaminatedTimetable(TENANT_A, { cloudCanonicalList: cloud });
        var q = JSON.parse(env.physical[quarantineKey(TENANT_A)]);
        expect(q.filter(function (p) { return p.id === 'LEAK-1'; }).length).toBe(1);
    });
});
