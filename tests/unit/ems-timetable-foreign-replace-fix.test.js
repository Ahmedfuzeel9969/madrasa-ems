/**
 * Production bug: madrasa A's timetable shown in B; B's own timetable missing.
 *
 * Causes:
 * 1. applyLocalFromRemote wrote logical ems_att_periods via _emsOriginalSetItem (global).
 * 2. attRecoverLegacyTimetablePeriods copied that global blob into whoever logged in.
 * 3. ModuleData (contaminated by leak+sync) overwrote local; Attendance_Config ignored.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var PERIODS_KEY = 'ems_att_periods';
var TENANT_A = 'madrasa-A';
var TENANT_B = 'madrasa-B';

function scopedKey(tid) {
    return 'ems_t_' + tid + '__' + PERIODS_KEY;
}

function loadEnv() {
    var physical = Object.create(null);
    function og(k) {
        return Object.prototype.hasOwnProperty.call(physical, k) ? physical[k] : null;
    }
    function os(k, v) {
        physical[k] = String(v);
    }
    var keyList = function () { return Object.keys(physical); };

    var sb = {
        physical: physical,
        console: { warn: function () {}, info: function () {}, log: function () {} },
        Promise: Promise,
        CURRENT_MADRASA_TENANT_ID: TENANT_B,
        EMS_ACTIVE_TENANT_ID: TENANT_B,
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
            get length() { return keyList().length; },
            key: function (i) { return keyList()[i] || null; }
        },
        emsOfflineWriteLocalSync: function (key, data, opts) {
            opts = opts || {};
            var tid = opts.tenantId || sb.EMS_ACTIVE_TENANT_ID;
            if (!tid) return false;
            os('ems_t_' + tid + '__' + key, JSON.stringify(data));
            return true;
        },
        emsOfflineEnqueueSyncModule: function () { return Promise.resolve({ ok: true }); },
        attIsOfflineMode: function () { return true; },
        addEventListener: function () {},
        document: { getElementById: function () { return null; } }
    };
    sb.window = sb;
    sb.global = sb;
    sb.globalThis = sb;

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
        + '\nthis.attRecoverLegacyTimetablePeriods = attRecoverLegacyTimetablePeriods;'
        + '\nthis.attRecoverStrongLocalLegacyTimetable = attRecoverStrongLocalLegacyTimetable;'
        + '\nthis.attRecoverContaminatedTimetable = attRecoverContaminatedTimetable;'
        + '\nthis.attTimetableLooksLikeForeignCopy = attTimetableLooksLikeForeignCopy;'
        + '\nthis.attChooseTimetableFromCloudLists = attChooseTimetableFromCloudLists;'
        + '\nthis.attShouldAcceptRemoteTimetable = attShouldAcceptRemoteTimetable;'
        + '\nthis.attRememberTrustedTimetable = attRememberTrustedTimetable;'
        + '\nthis.attTimetableFailsRosterTeacherBinding = attTimetableFailsRosterTeacherBinding;'
        + '\nthis.attVerifyRemoteTimetableOwnership = attVerifyRemoteTimetableOwnership;'
        + '\nthis.attTimetableRosterScore = attTimetableRosterScore;'
        + '\nthis.attChooseBestTimetableCandidate = attChooseBestTimetableCandidate;'
        + '\nthis.attGetUsers = function(){ return [{ id: "CTCH-68140", name: "عبد اللہ", role: "teacher" }]; };'
        + '\nthis.attUserMatchesType = function(u,t){ return t==="teacher"; };'
        + '\nthis.attGetUserId = function(u){ return u.id; };'
        + '\nthis.attReadAllTimetablePeriodsRaw = function(){ var r=this.localStorage.getItem("ems_att_periods"); try{return r?JSON.parse(r):[];}catch(e){return [];} };',
        sb
    );
    sb.put = function (key, list) { os(key, JSON.stringify(list)); };
    return sb;
}

describe('Foreign timetable replacing own — production fix', function () {
    var env;

    beforeEach(function () {
        env = loadEnv();
        env.CURRENT_MADRASA_TENANT_ID = TENANT_B;
        env.EMS_ACTIVE_TENANT_ID = TENANT_B;
    });

    it('does not copy A global leftover into B when those period ids already belong to A', async function () {
        env.put(scopedKey(TENANT_A), [{ id: 'P-A', name: 'A-ONLY-TEST', days: [1] }]);
        env.put(PERIODS_KEY, [{ id: 'P-A', name: 'A-ONLY-TEST', days: [1] }]);
        env.EMS_TENANT_LEGACY_MIGRATION_ALLOWED = true;

        var report = await env.attRecoverLegacyTimetablePeriods(TENANT_B);
        expect(report.copied).toBe(0);
        expect(env.physical[scopedKey(TENANT_B)]).toBeFalsy();
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('P-A');
    });

    it('rescues a strongly roster-bound former global timetable locally without cloud write', async function () {
        env.put(scopedKey(TENANT_B), [{ id: 'FOREIGN-1', teacherId: 'UNKNOWN', days: [1] }]);
        env.attGetUsers = function () {
            return [
                { id: 'CTCH-68140', name: 'عبد اللہ', role: 'teacher' },
                { id: 'T-2', name: 'استاد دو', role: 'teacher' },
                { id: 'T-3', name: 'استاد تین', role: 'teacher' }
            ];
        };
        env.put(PERIODS_KEY, [
            { id: 'OWN-1', teacherId: 'CTCH-68140', teacherName: 'عبد اللہ', days: [1] },
            { id: 'OWN-2', teacherId: 'T-2', teacherName: 'استاد دو', days: [2] },
            { id: 'OWN-3', teacherId: 'T-3', teacherName: 'استاد تین', days: [3] }
        ]);

        var res = await env.attRecoverStrongLocalLegacyTimetable(TENANT_B);
        expect(res.ok).toBe(true);
        expect(res.restored).toBe(3);
        expect(res.cloudWritten).toBe(false);
        expect(JSON.parse(env.physical[scopedKey(TENANT_B)])).toHaveLength(3);
    });

    it('restores B Attendance_Config when ModuleData still holds A leaked periods', async function () {
        env.put(scopedKey(TENANT_A), [{ id: 'P-A', name: 'A-ONLY-TEST', days: [1] }]);
        env.put(scopedKey(TENANT_B), [{ id: 'P-A', name: 'A-ONLY-TEST leaked', days: [1] }]);

        var res = await env.attRecoverContaminatedTimetable(TENANT_B, {
            cloudCanonicalList: [{ id: 'P-A', name: 'A-ONLY-TEST leaked', days: [1] }],
            cloudLegacyList: [{ id: 'P-B', name: 'B-OWN', days: [3] }]
        });
        expect(res.preferredSource).toBe('cloud_legacy');
        expect(JSON.parse(env.physical[scopedKey(TENANT_B)])[0].id).toBe('P-B');
        expect(JSON.parse(env.physical[scopedKey(TENANT_B)])[0].name).toBe('B-OWN');
        expect(JSON.parse(env.physical[scopedKey(TENANT_A)])[0].id).toBe('P-A');
    });

    it('attTimetableLooksLikeForeignCopy is true when ids match another tenant partition', function () {
        env.put(scopedKey(TENANT_A), [{ id: 'P-A', days: [1] }]);
        expect(env.attTimetableLooksLikeForeignCopy([{ id: 'P-A' }], TENANT_B)).toBe(true);
        expect(env.attTimetableLooksLikeForeignCopy([{ id: 'P-B' }], TENANT_B)).toBe(false);
    });

    it('sync-engine applyLocalFromRemote uses physical tenant key, not global logical key', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud/sync-engine.js'), 'utf8');
        var fn = src.slice(
            src.indexOf('function applyLocalFromRemote'),
            src.indexOf('function pullCoreModules')
        );
        expect(fn).toContain('emsResolvePhysicalWriteKey');
        expect(fn).toContain('emsOfflineWriteLocalSync');
        expect(fn).toContain('tenantId');
        expect(fn).not.toMatch(/_emsOriginalSetItem\.call\(localStorage,\s*key,/);
    });

    it('live ModuleData snapshot rejects a disjoint foreign list after Attendance_Config is trusted', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('window.emsStartAttendanceSync = function'),
            att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync')
        );
        expect(block).toContain('attShouldAcceptRemoteTimetable');
        expect(block).toContain('attMigrateLegacyCloudTimetablePeriods');
        expect(block).toContain('localKeep');
    });

    it('legacy cloud migration prefers Attendance_Config when period ids are disjoint', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('attChooseTimetableFromCloudLists');
        expect(att).toContain('legacy_disjoint');
        expect(att).toContain('SCOPED_ALREADY_HAS_DATA');
    });

    it('device with only this madrasa still restores Attendance_Config over leaked ModuleData', async function () {
        env.put(scopedKey(TENANT_B), [{ id: 'P-A', name: 'leaked into B', days: [1] }]);

        var choice = env.attChooseTimetableFromCloudLists(
            [{ id: 'P-A', name: 'leaked into B', days: [1] }],
            [{ id: 'P-B', name: 'B-OWN', days: [3] }],
            TENANT_B
        );
        expect(choice.source).toBe('legacy_disjoint');
        expect(choice.persistCanonical).toBe(true);
        expect(choice.list[0].id).toBe('P-B');

        var res = await env.attRecoverContaminatedTimetable(TENANT_B, {
            cloudCanonicalList: [{ id: 'P-A', name: 'leaked into B', days: [1] }],
            cloudLegacyList: [{ id: 'P-B', name: 'B-OWN', days: [3] }]
        });
        expect(res.preferredSource).toBe('cloud_legacy');
        expect(JSON.parse(env.physical[scopedKey(TENANT_B)])[0].id).toBe('P-B');
    });

    it('later ModuleData snapshot is rejected when it does not match the trusted Attendance_Config list', function () {
        env.attRememberTrustedTimetable(TENANT_B, [{ id: 'P-B', name: 'own', days: [2] }], 'legacy_disjoint');
        expect(env.attShouldAcceptRemoteTimetable([{ id: 'P-A', name: 'leak', days: [1] }], TENANT_B)).toBe(false);
        expect(env.attShouldAcceptRemoteTimetable([{ id: 'P-B', name: 'own', days: [2] }], TENANT_B)).toBe(true);
    });

    it('rejects a disjoint cloud timetable even on a fresh page before a trusted copy is recorded', function () {
        env.put(scopedKey(TENANT_B), [
            { id: 'OWN-1', teacherId: 'CTCH-68140', teacherName: 'عبد اللہ', days: [1] },
            { id: 'OWN-2', teacherId: 'CTCH-68140', teacherName: 'عبد اللہ', days: [2] }
        ]);
        expect(env.attShouldAcceptRemoteTimetable([
            { id: 'FOREIGN-1', teacherId: 'UNKNOWN-1', teacherName: 'غیر متعلق', days: [1] }
        ], TENANT_B)).toBe(false);
    });

    it('rejects foreign canonical when classes match but teacher ids/names do not belong to this madrasa', function () {
        var foreign = [{
            id: 'PRD-35564',
            className: 'اولی',
            teacherId: 'TCH-01',
            teacherName: 'جمال',
            days: [1]
        }];
        expect(env.attTimetableFailsRosterTeacherBinding(foreign)).toBe(true);
        expect(env.attTimetableRosterScore(foreign)).toBe(0);
        expect(env.attShouldAcceptRemoteTimetable(foreign, TENANT_B)).toBe(false);

        var choice = env.attChooseBestTimetableCandidate([
            { list: foreign, source: 'cloud_canonical' }
        ], TENANT_B);
        expect(choice.source).toBe('empty');
        expect(choice.list).toEqual([]);
    });

    it('requires every remote lesson to bind to this madrasa teacher roster', function () {
        var own = [{ id: 'OWN-1', teacherId: 'CTCH-68140', teacherName: 'عبد اللہ', days: [1] }];
        var mixed = own.concat([{ id: 'FOREIGN-1', teacherId: 'OTHER-1', teacherName: 'دوسرا استاد', days: [2] }]);
        expect(env.attVerifyRemoteTimetableOwnership(own).ok).toBe(true);
        expect(env.attVerifyRemoteTimetableOwnership(mixed).ok).toBe(false);
        expect(env.attVerifyRemoteTimetableOwnership(mixed).reason).toBe('teacher_roster_mismatch');
    });

    it('generic module pull excludes timetable blobs; only the checked reader may apply them', function () {
        var sync = fs.readFileSync(path.join(ROOT, 'cloud', 'sync-engine.js'), 'utf8');
        expect(sync).toContain('function isGenericPullKey');
        expect(sync).toContain("key !== 'ems_att_periods'");
        expect(sync).toContain('filter(isGenericPullKey)');
    });
});
