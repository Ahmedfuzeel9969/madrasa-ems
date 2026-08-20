import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadScopeHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var normStart = src.indexOf('function attNormalizeStorageScope');
    var normEnd = src.indexOf('\nfunction attSheetKeys');
    var keysStart = src.indexOf('function attSheetKeys');
    var keysEnd = src.indexOf('\nfunction attLastSessionStorageKey');
    var canonStart = src.indexOf('function attCanonicalStudentKeys');
    var canonEnd = src.indexOf('\nfunction attOverlayCanonicalPeriodMarks');
    var legacyPeriodStart = src.indexOf('function attLegacyPeriodSheetKeys');
    var legacyPeriodEnd = src.indexOf('\nfunction attLegacyTeacherStaffSheetKeys');
    var legacyStaffStart = src.indexOf('function attLegacyTeacherStaffSheetKeys');
    var legacyStaffEnd = src.indexOf('\nfunction attMergeLegacyFieldMaps');
    var mergeLogStart = src.indexOf('var ATT_LEGACY_PERIOD_MERGE_KEY');
    var mergeLogEnd = legacyPeriodStart;
    var fnSrc = src.slice(normStart, normEnd)
        + '\n' + src.slice(keysStart, keysEnd)
        + '\n' + src.slice(canonStart, canonEnd)
        + '\n' + src.slice(mergeLogStart, mergeLogEnd)
        + '\n' + src.slice(legacyPeriodStart, legacyPeriodEnd)
        + '\n' + src.slice(legacyStaffStart, legacyStaffEnd);
    var sandbox = {
        window: {},
        localStorage: {
            _data: { ems_att_canonical_unified: '1', att_legacy_period_merged_v1: '{}' },
            getItem: function (k) { return this._data[k] || null; },
            setItem: function (k, v) { this._data[k] = String(v); }
        },
        getAttendanceTenantId: function () { return 'tenant1'; },
        emsAttCloudDocId: function (month, type, classId, period) {
            return 'att_rec_' + month + '_' + type + '_' + classId + '_' + (period || 'all');
        },
        emsAttLocalStorageKey: function (tenantId, month, type, classId, period) {
            return 'att_rec_' + (tenantId || 'tenant1') + '_' + month + '_' + type + '_' + classId + '_' + (period || 'all');
        }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(
        fnSrc
        + '\nthis.attNormalizeStorageScope = attNormalizeStorageScope;'
        + '\nthis.attResolveSheetKeys = attResolveSheetKeys;'
        + '\nthis.attLegacyTeacherStaffSheetKeys = attLegacyTeacherStaffSheetKeys;'
        + '\nthis.attLegacyPeriodSheetKeys = attLegacyPeriodSheetKeys;'
        + '\nthis.attMarkLegacyPeriodSheetsMerged = attMarkLegacyPeriodSheetsMerged;'
        + '\nthis.attReadLegacyPeriodMergeLog = attReadLegacyPeriodMergeLog;',
        sandbox
    );
    return sandbox;
}

describe('Phase 1 — canonical teacher/staff storage scope', function () {
    it('normalizes teachers to classId="" and period="all"', function () {
        var sb = loadScopeHelpers();
        var scope = sb.attNormalizeStorageScope('2026-08', 'teachers', 'Class-A', 'period-1');
        expect(scope).toEqual({ month: '2026-08', type: 'teachers', classId: '', period: 'all' });
    });

    it('normalizes staff the same way', function () {
        var sb = loadScopeHelpers();
        var scope = sb.attNormalizeStorageScope('2026-08', 'staff', 'Class-B', 'period-9');
        expect(scope).toEqual({ month: '2026-08', type: 'staff', classId: '', period: 'all' });
    });

    it('stale class dropdown resolves to the same teacher sheet', function () {
        var sb = loadScopeHelpers();
        var a = sb.attResolveSheetKeys('2026-08', 'teachers', 'Class-A', 'period-1');
        var b = sb.attResolveSheetKeys('2026-08', 'teachers', 'Class-B', 'period-2');
        var c = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'all');
        expect(a.cloudDocId).toBe(b.cloudDocId);
        expect(b.localKey).toBe(c.localKey);
        expect(a.cloudDocId).toBe('att_rec_2026-08_teachers__all');
    });

    it('restored stale session classId does not change storage keys', function () {
        var sb = loadScopeHelpers();
        var restored = sb.attNormalizeStorageScope('2026-08', 'teachers', 'Hifz-A', 'all');
        var keys = sb.attResolveSheetKeys(restored.month, restored.type, restored.classId, restored.period);
        expect(keys.localKey).toBe('att_rec_tenant1_2026-08_teachers__all');
    });

    it('keeps student class-scoped keys unchanged', function () {
        var sb = loadScopeHelpers();
        var student = sb.attResolveSheetKeys('2026-08', 'students', 'Hifz-A', 'period-abc');
        expect(student.cloudDocId).toBe('att_rec_2026-08_students_Hifz-A_all');
    });
});

describe('Phase 1 — legacy teacher/staff sheet discovery', function () {
    it('finds class-scoped and per-period legacy teacher keys', function () {
        var sb = loadScopeHelpers();
        var keys = [
            'att_rec_tenant1_2026-08_teachers__all',
            'att_rec_tenant1_2026-08_teachers_Class-A_all',
            'att_rec_tenant1_2026-08_teachers_Class-A_period-1',
            'att_rec_tenant1_2026-08_teachers__period-2',
            'att_rec_tenant1_2026-08_students_Hifz-A_all'
        ];
        var legacy = sb.attLegacyTeacherStaffSheetKeys(
            keys, '2026-08', 'teachers', 'att_rec_tenant1_2026-08_teachers__all'
        );
        expect(legacy).toEqual([
            'att_rec_tenant1_2026-08_teachers_Class-A_all',
            'att_rec_tenant1_2026-08_teachers_Class-A_period-1',
            'att_rec_tenant1_2026-08_teachers__period-2'
        ]);
    });

    it('skips already-merged legacy keys on second migration pass', function () {
        var sb = loadScopeHelpers();
        var keys = [
            'att_rec_tenant1_2026-08_teachers__all',
            'att_rec_tenant1_2026-08_teachers_Class-A_all'
        ];
        sb.attMarkLegacyPeriodSheetsMerged(['att_rec_tenant1_2026-08_teachers_Class-A_all']);
        var secondPass = sb.attLegacyTeacherStaffSheetKeys(
            keys, '2026-08', 'teachers', 'att_rec_tenant1_2026-08_teachers__all'
        );
        expect(secondPass).toEqual([]);
    });

    it('wires class-scoped legacy adoption in attAdoptLegacyPeriodSheets', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attLegacyTeacherStaffSheetKeys');
        expect(js).toContain('attLegacyTeacherStaffSheetKeys(allKeys, month, type');
        expect(js).toMatch(/if \(periodId === 'all'\)[\s\S]{0,400}attMergeLegacyFieldMaps\(canon, legacy, 'records'/);
        expect(js).toContain('[EMS attendance] adopted legacy sheets into canonical register');
    });

    it('ems-offline-write normalizes teacher/staff keys before building doc ids', function () {
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(offline).toContain('function attOfflineNormalizeScope');
        expect(offline).toMatch(/emsAttCloudDocId[\s\S]{0,200}attOfflineNormalizeScope/);
        expect(offline).toMatch(/emsAttLocalStorageKey[\s\S]{0,200}attOfflineNormalizeScope/);
    });
});
