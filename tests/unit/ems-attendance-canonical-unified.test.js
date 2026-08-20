import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadAttendanceHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var normStart = src.indexOf('function attNormalizeStorageScope');
    var normEnd = src.indexOf('\nfunction attSheetKeys');
    var keysStart = src.indexOf('function attSheetKeys');
    var keysEnd = src.indexOf('\nfunction attLastSessionStorageKey');
    var canonStart = src.indexOf('function attCanonicalStudentKeys');
    var canonEnd = src.indexOf('\nfunction attOverlayCanonicalPeriodMarks');
    var mirrorStart = src.indexOf('function attMirrorCurrentToCanonical');
    var mirrorEnd = src.indexOf('\nfunction attPersistSheetPayload');
    var rollStart = src.indexOf('function attRollupPeriodDayStatus');
    var rollEnd = src.indexOf('\nfunction attDisplayDayMark');
    var fnSrc = src.slice(normStart, normEnd)
        + '\n' + src.slice(keysStart, keysEnd)
        + '\n' + src.slice(canonStart, canonEnd)
        + '\n' + src.slice(rollStart, rollEnd)
        + '\n' + src.slice(mirrorStart, mirrorEnd);
    var sandbox = {
        window: {},
        localStorage: {
            _data: { ems_att_canonical_unified: '1' },
            getItem: function (k) { return this._data[k] || null; },
            setItem: function (k, v) { this._data[k] = v; }
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
        + '\nthis.attSheetKeys = attSheetKeys;'
        + '\nthis.attIsCanonicalUnified = attIsCanonicalUnified;'
        + '\nthis.attResolveSheetKeys = attResolveSheetKeys;'
        + '\nthis.attCanonicalStudentKeys = attCanonicalStudentKeys;'
        + '\nthis.attMirrorCurrentToCanonical = attMirrorCurrentToCanonical;'
        + '\nthis.attRollupPeriodDayStatus = attRollupPeriodDayStatus;',
        sandbox
    );
    return sandbox;
}

describe('Attendance canonical unified smart register', function () {
    it('exports unified helpers and resolve keys in attendance.js', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attIsCanonicalUnified');
        expect(js).toContain('function attResolveSheetKeys');
        expect(js).toContain('function attNotifyCanonicalUpdated');
        expect(js).toContain('attResolveSheetKeys(month, type, classId, period)');
        expect(js).toContain("localStorage.getItem('ems_att_canonical_unified')");
        expect(js).toContain('attNotifyCanonicalUpdated(window.currentAttState.classId');
    });

    it('resolves student sheets to canonical period=all keys when unified', function () {
        var sb = loadAttendanceHelpers();
        var all = sb.attResolveSheetKeys('2026-08', 'students', 'Hifz-A', 'all');
        var p1 = sb.attResolveSheetKeys('2026-08', 'students', 'Hifz-A', 'period-abc');
        expect(all.cloudDocId).toContain('_all');
        expect(p1.cloudDocId).toBe(all.cloudDocId);
    });

    it('keeps separate period keys when unified flag is off', function () {
        var sb = loadAttendanceHelpers();
        sb.localStorage.setItem('ems_att_canonical_unified', '0');
        var all = sb.attResolveSheetKeys('2026-08', 'students', 'Hifz-A', 'all');
        var p1 = sb.attResolveSheetKeys('2026-08', 'students', 'Hifz-A', 'period-abc');
        expect(all.cloudDocId).not.toBe(p1.cloudDocId);
        expect(p1.cloudDocId).toContain('period-abc');
    });

    it('passes classId/month from collective persist to payload opts', function () {
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        expect(col).toContain('classId: sheet.classId');
        expect(col).toContain('month: _state && _state.month');
    });

    it('mirrors period-specific marks from periodRecords not rollup labels', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toMatch(/attMirrorCurrentToCanonical[\s\S]*dataToSave\.periodRecords/);
        expect(js).not.toMatch(/attMirrorCurrentToCanonical[\s\S]*dataToSave\.records[\s\S]*touchDay\(uid, day, dataToSave\.records/);
    });
});
