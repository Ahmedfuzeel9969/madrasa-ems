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
        + '\nthis.attRecoverContaminatedTimetable = attRecoverContaminatedTimetable;'
        + '\nthis.attTimetableLooksLikeForeignCopy = attTimetableLooksLikeForeignCopy;'
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

    it('live ModuleData snapshot rejects foreign period ids (source lock)', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('window.emsStartAttendanceSync = function'),
            att.indexOf('window.emsStopAttendanceSync = stopAttendanceFirestoreSync')
        );
        expect(block).toContain('attTimetableLooksLikeForeignCopy');
        expect(block).toContain('attMigrateLegacyCloudTimetablePeriods');
        expect(block).toContain('localKeep');
    });

    it('legacy cloud migration promotes Attendance_Config when ModuleData is contaminated', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('canonContaminated');
        expect(att).toContain('SCOPED_ALREADY_HAS_DATA');
    });
});
