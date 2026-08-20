import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadSheetKeyHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var normStart = src.indexOf('function attNormalizeStorageScope');
    var normEnd = src.indexOf('\nfunction attSheetKeys');
    var keysStart = src.indexOf('function attSheetKeys');
    var keysEnd = src.indexOf('\nfunction attLastSessionStorageKey');
    var canonStart = src.indexOf('function attCanonicalStudentKeys');
    var canonEnd = src.indexOf('\nfunction attOverlayCanonicalPeriodMarks');
    var legacyStart = src.indexOf('var ATT_LEGACY_PERIOD_MERGE_KEY');
    var legacyEnd = src.indexOf('\nfunction attAdoptLegacyPeriodSheets');
    var fnSrc = src.slice(normStart, normEnd)
        + '\n' + src.slice(keysStart, keysEnd)
        + '\n' + src.slice(canonStart, canonEnd)
        + '\n' + src.slice(legacyStart, legacyEnd);
    var sandbox = {
        window: {},
        localStorage: {
            _data: { ems_att_canonical_unified: '1' },
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
        + '\nthis.attResolveSheetKeys = attResolveSheetKeys;'
        + '\nthis.attLegacyPeriodSheetKeys = attLegacyPeriodSheetKeys;'
        + '\nthis.attMarkLegacyPeriodSheetsMerged = attMarkLegacyPeriodSheetsMerged;',
        sandbox
    );
    return sandbox;
}

describe('Teacher/staff registers share one canonical sheet', function () {
    it('resolves teacher sheets of every hour to the same doc id', function () {
        var sb = loadSheetKeyHelpers();
        var all = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'all');
        var hour = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'period-xyz');
        expect(hour.cloudDocId).toBe(all.cloudDocId);
        expect(hour.localKey).toBe(all.localKey);
    });

    it('resolves staff sheets to the canonical doc id too', function () {
        var sb = loadSheetKeyHelpers();
        var all = sb.attResolveSheetKeys('2026-08', 'staff', '', 'all');
        var hour = sb.attResolveSheetKeys('2026-08', 'staff', '', 'period-xyz');
        expect(hour.cloudDocId).toBe(all.cloudDocId);
    });

    it('keeps per-hour keys when the unified flag is off', function () {
        var sb = loadSheetKeyHelpers();
        sb.localStorage.setItem('ems_att_canonical_unified', '0');
        var all = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'all');
        var hour = sb.attResolveSheetKeys('2026-08', 'teachers', '', 'period-xyz');
        expect(hour.cloudDocId).not.toBe(all.cloudDocId);
    });

    it('lists only unmerged per-hour sheets of that register', function () {
        var sb = loadSheetKeyHelpers();
        var keys = [
            'att_rec_tenant1_2026-08_teachers__all',
            'att_rec_tenant1_2026-08_teachers__period-1',
            'att_rec_tenant1_2026-08_teachers__period-2',
            'att_rec_tenant1_2026-08_students_Hifz-A_period-1',
            'att_rec_tenant1_2026-07_teachers__period-9'
        ];
        var legacy = sb.attLegacyPeriodSheetKeys(keys, '2026-08', 'teachers', '');
        expect(legacy).toEqual([
            'att_rec_tenant1_2026-08_teachers__period-1',
            'att_rec_tenant1_2026-08_teachers__period-2'
        ]);

        sb.attMarkLegacyPeriodSheetsMerged(['att_rec_tenant1_2026-08_teachers__period-1']);
        var after = sb.attLegacyPeriodSheetKeys(keys, '2026-08', 'teachers', '');
        expect(after).toEqual(['att_rec_tenant1_2026-08_teachers__period-2']);
    });

    it('adopts legacy hours before opening the register', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attAdoptLegacyPeriodSheets');
        expect(js).toContain('attAdoptLegacyPeriodSheets(keys, month, type, classId)');
        expect(js).toContain('emsAttReadSheetByKeyAsync');
    });

    it('marks a selected hour only for that hour in teacher registers', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = js.indexOf('function attApplyRosterPeriodStatus');
        var body = js.slice(start, js.indexOf('window.setTeacherAllPeriods', start));
        expect(body).toMatch(/attIsTeacherRegister\(\)[\s\S]*curPeriod !== 'all'[\s\S]*tmap\[curPeriod\] = status/);
    });

    it('shows no save status until a save actually happens', function () {
        var status = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
        expect(status).toMatch(/pickAggregate[\s\S]*_docs\[id\]\.local !== 'idle'/);
    });
});
