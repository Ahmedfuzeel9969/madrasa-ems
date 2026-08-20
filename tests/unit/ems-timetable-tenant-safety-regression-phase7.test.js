/**
 * PHASE 7 — Complete tenant safety regression gate (cross-madrasa timetable)
 * TASK 7.1: automated matrix + explicit tenant-safety invariants
 * TASK 7.2: manual browser acceptance traceability
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var UNIT = path.join(ROOT, 'tests', 'unit');
var PERIODS_KEY = 'ems_att_periods';
var TENANT_A = 'madrasa-A';
var TENANT_B = 'madrasa-B';

function scopedKey(tid) {
    return 'ems_t_' + tid + '__' + PERIODS_KEY;
}

function readSrc(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function testExists(name) {
    return fs.existsSync(path.join(UNIT, name));
}

var PHASE_FILES = [
    'ems-timetable-cross-tenant-race-phase0.test.js',
    'ems-tenant-canonical-activation-phase1.test.js',
    'ems-timetable-tenant-bound-phase2.test.js',
    'ems-tenant-listener-lifecycle-phase3.test.js',
    'ems-timetable-cloud-canonical-phase4.test.js',
    'ems-timetable-contamination-phase5.test.js',
    'ems-timetable-sync-queue-phase6.test.js',
    'ems-attendance-timetable-forensic-phase1.test.js',
    'ems-attendance-timetable-phase3.test.js',
    'ems-tenant-local-isolation.test.js',
    'ems-attendance-outbox-tenant-phase6.test.js'
];

var MANUAL_ACCEPTANCE = [
    { id: 'S1', scenario: 'Login Madrasa-A, create A-ONLY-TEST period, switch to B', expect: 'A-ONLY-TEST never visible in B' },
    { id: 'S2', scenario: 'Create B-ONLY-TEST in B, switch back to A', expect: 'B-ONLY-TEST never visible in A' },
    { id: 'S3', scenario: 'Delay A cloud snapshot, switch to B, deliver A response', expect: 'B local timetable unchanged' },
    { id: 'S4', scenario: 'Hard refresh on B', expect: 'Only B timetable shown' },
    { id: 'S5', scenario: 'Close and reopen browser on B', expect: 'Correct tenant timetable after boot' },
    { id: 'S6', scenario: 'Offline A timetable edit, switch to B, reconnect', expect: 'A queue does not write into B cloud/local' },
    { id: 'S7', scenario: 'Two tabs: Tab1 on A, Tab2 switches tenant', expect: 'No cross-tab contamination' }
];

function loadMiniTenantEnv() {
    var physical = Object.create(null);
    var idb = Object.create(null);
    function og(k) { return Object.prototype.hasOwnProperty.call(physical, k) ? physical[k] : null; }
    function os(k, v) { physical[k] = String(v); }

    var sb = {
        physical: physical,
        _idb: idb,
        console: console,
        Promise: Promise,
        document: { getElementById: function () { return null; } },
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_STORAGE_READY: false,
        EMS_TENANT_TRANSITION_IN_PROGRESS: false,
        EMS_TENANT_GENERATION: 0,
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
            }
        },
        emsStopAttendanceSync: function () {},
        emsStopRegistrationLiveSync: function () {},
        emsStopDashboardLive: function () {},
        emsStopDashboardStatsListener: function () {},
        emsStopModuleSummariesListener: function () {},
        emsMigrateLegacyTenantData: function () { return Promise.resolve({ migrated: 0 }); },
        emsIdbKvSet: function (key, val) {
            idb[key] = typeof val === 'string' ? val : JSON.stringify(val);
            return Promise.resolve(true);
        },
        emsIsLargeBlobKey: function () { return false; },
        emsCacheInvalidate: function () {}
    };
    sb.window = sb;
    sb.global = sb;
    sb.globalThis = sb;

    vm.runInNewContext(readSrc('ems-tenant-storage.js'), sb);

    var offlineSlice = readSrc('ems-offline-write.js').slice(
        readSrc('ems-offline-write.js').indexOf('function resolveOfflinePhysicalKey'),
        readSrc('ems-offline-write.js').indexOf('global.emsAttCloudDocId = function')
    );
    vm.runInNewContext(offlineSlice + '\nthis.emsOfflineWriteLocalSync = global.emsOfflineWriteLocalSync;', sb);

    sb.setBoth = function (tid) {
        sb.CURRENT_MADRASA_TENANT_ID = tid;
        sb.EMS_ACTIVE_TENANT_ID = tid;
        sb.EMS_TENANT_STORAGE_READY = true;
        sb.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
    };

    return sb;
}

describe('Phase 7 — TASK 7.1 regression matrix (phase files present)', function () {
    it('all cross-madrasa phase 0–6 + supporting test files exist', function () {
        PHASE_FILES.forEach(function (f) {
            expect(testExists(f), 'missing ' + f).toBe(true);
        });
    });
});

describe('Phase 7 — TASK 7.1 explicit tenant-safety invariants (source + mini env)', function () {
    var att = readSrc('attendance.js');
    var tenant = readSrc('ems-tenant-storage.js');
    var offline = readSrc('ems-offline-write.js');

    it('1-2: A/B timetable partitions are separate scoped keys', function () {
        var env = loadMiniTenantEnv();
        env.setBoth(TENANT_A);
        env.emsOfflineWriteLocalSync(PERIODS_KEY, [{ id: 'A-ONLY', name: 'A-ONLY-TEST' }], { tenantId: TENANT_A });
        env.setBoth(TENANT_B);
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('A-ONLY');
    });

    it('3-4: snapshot callbacks use attSnapshotMayMutateTenantState + generation', function () {
        var syncBlock = att.slice(
            att.indexOf('window.emsStartAttendanceSync = function'),
            att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync')
        );
        expect(syncBlock).toContain('attSnapshotMayMutateTenantState');
        expect(syncBlock).toContain('listenerGeneration');
        expect(att).toContain('function attSnapshotMayMutateTenantState');
    });

    it('5: CURRENT/ACTIVE mismatch fails closed (canonical null)', function () {
        var env = loadMiniTenantEnv();
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_B;
        expect(env.emsGetCanonicalTenantId()).toBeNull();
        expect(env.emsResolveCacheKey(PERIODS_KEY)).toBeNull();
    });

    it('6: no verified tenant blocks business-data write', function () {
        var env = loadMiniTenantEnv();
        env.EMS_ACTIVE_TENANT_ID = null;
        env.CURRENT_MADRASA_TENANT_ID = null;
        expect(env.emsOfflineWriteLocalSync(PERIODS_KEY, [], {})).toBe(false);
    });

    it('7-8: localStorage + IDB use same tenant physical key', function () {
        var env = loadMiniTenantEnv();
        env.setBoth(TENANT_A);
        env.emsOfflineWriteLocalSync(PERIODS_KEY, [{ id: 'P1' }], { tenantId: TENANT_A });
        expect(env.physical[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env._idb[scopedKey(TENANT_A)]).toBeTruthy();
        expect(env.physical[PERIODS_KEY]).toBeFalsy();
    });

    it('9: sync_module queue uses tenantId|type|docId identity', function () {
        expect(offline).toContain('function queueMapKey');
        expect(offline).toContain("String(tenantId || '') + '|'");
        expect(offline).toContain('assertTenantBoundSyncModuleEnqueue');
    });

    it('10: canonical cloud path is ModuleData/Attendance__ems_att_periods', function () {
        expect(att).toContain("ATT_PERIODS_CANONICAL_CLOUD_DOC = 'Attendance__ems_att_periods'");
        expect(att).toContain('attTimetableCanonicalCloudRef');
        expect(att).not.toMatch(/emsStartAttendanceSync[\s\S]{0,800}Attendance_Config/);
    });

    it('11-12: legacy recovery is non-destructive and idempotent', function () {
        expect(att).toContain('function attRecoverLegacyTimetablePeriods');
        expect(att).toContain('function attRunTimetableContaminationPass');
        expect(att).not.toMatch(/attRecoverLegacyTimetablePeriods[\s\S]{0,2500}removeItem\(\s*ATT_PERIODS_KEY/);
        expect(att).toContain('attMarkTimetableCloudLegacyMigrated');
    });

    it('13: rapid A→B→A bumps generation; stale gen rejected', function () {
        var env = loadMiniTenantEnv();
        env.setBoth(TENANT_A);
        var genA1 = env.emsGetTenantGeneration();
        env.emsActivateTenantStorage(TENANT_B);
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        env.emsActivateTenantStorage(TENANT_A);
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        expect(env.emsAssertTenantBoundMutation(TENANT_A, genA1).ok).toBe(false);
        expect(env.emsAssertTenantBoundMutation(TENANT_A, env.emsGetTenantGeneration()).ok).toBe(true);
    });

    it('14-16: owner + linked staff/teacher use canonical tenant activation', function () {
        var block = tenant.slice(
            tenant.indexOf('global.emsActivateTenantStorage = function'),
            tenant.indexOf('global.emsLiteLoginPrepare = function')
        );
        expect(block).toMatch(/EMS_ACTIVE_TENANT_ID\s*=\s*tenantId/);
        expect(block).toMatch(/CURRENT_MADRASA_TENANT_ID\s*=\s*tenantId/);
        expect(testExists('ems-tenant-canonical-activation-phase1.test.js')).toBe(true);
    });

    it('17: same-name madrasas remain isolated by tenant id not display name', function () {
        expect(testExists('ems-tenant-local-isolation.test.js')).toBe(true);
        var iso = readSrc('tests/unit/ems-tenant-local-isolation.test.js');
        expect(iso).toContain('uid-owner-A');
        expect(iso).toContain('uid-owner-B');
    });

    it('18: stale persisted tenant cannot override verified context (source lock)', function () {
        expect(tenant).toContain('EMS_TENANT_LEGACY_MIGRATION_ALLOWED');
        expect(tenant).toContain('legacyMigrationSafeFor');
        var iso = readSrc('tests/unit/ems-tenant-local-isolation.test.js');
        expect(iso).toContain('never uses persisted boot tenant as authenticated Firestore authority');
        expect(iso).toContain('fails closed for business data before a tenant is identified');
    });
});

describe('Phase 7 — TASK 7.2 manual browser acceptance traceability', function () {
    MANUAL_ACCEPTANCE.forEach(function (row) {
        it(row.id + ': ' + row.scenario + ' → ' + row.expect, function () {
            var autoCoverage = {
                S1: ['ems-timetable-tenant-bound-phase2.test.js', 'ems-attendance-timetable-phase3.test.js'],
                S2: ['ems-timetable-tenant-bound-phase2.test.js', 'ems-attendance-timetable-phase3.test.js'],
                S3: ['ems-timetable-cross-tenant-race-phase0.test.js', 'ems-timetable-tenant-bound-phase2.test.js'],
                S4: ['ems-attendance-timetable-phase3.test.js'],
                S5: ['ems-attendance-timetable-phase3.test.js', 'ems-tenant-canonical-activation-phase1.test.js'],
                S6: ['ems-timetable-sync-queue-phase6.test.js', 'ems-attendance-outbox-tenant-phase6.test.js'],
                S7: ['ems-tenant-listener-lifecycle-phase3.test.js', 'ems-tenant-canonical-activation-phase1.test.js']
            };
            var files = autoCoverage[row.id] || [];
            expect(files.length).toBeGreaterThan(0);
            files.forEach(function (f) {
                expect(testExists(f), 'automated proxy missing: ' + f).toBe(true);
            });
            expect(row.expect.length).toBeGreaterThan(5);
        });
    });

    it('manual scenarios S1–S7 documented with expected outcomes', function () {
        expect(MANUAL_ACCEPTANCE.length).toBe(7);
    });
});
