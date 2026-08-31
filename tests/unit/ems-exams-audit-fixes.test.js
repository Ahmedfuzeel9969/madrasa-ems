import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadIdentityHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
    var start = src.indexOf('function exmResultDateOf');
    var end = src.indexOf('\n  function exmReadResultDateInput', start);
    var sandbox = { window: {}, Date: Date, String: String, Number: Number, Math: Math, Array: Array };
    vm.runInNewContext(src.slice(start, end), sandbox);
    return sandbox.window;
}

function loadDateHelper() {
    var src = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
    var start = src.indexOf('function dateYmd');
    var end = src.indexOf('\n  function currentContext', start);
    var sandbox = { global: {}, Date: Date, String: String, Number: Number, Math: Math, isFinite: isFinite };
    vm.runInNewContext(src.slice(start, end) + '\nthis.dateYmd = dateYmd;', sandbox);
    return sandbox.dateYmd;
}

describe('Exams department audit fixes', function () {
    it('uses a canonical identity and removes duplicate result rows on upsert', function () {
        var api = loadIdentityHelpers();
        var id1 = api.exmCanonicalResultId('سالانہ', 'اولیٰ', 12, '2026-08-27');
        var id2 = api.exmCanonicalResultId('سالانہ', 'اولیٰ', '12', '2026-08-27');
        expect(id1).toBe(id2);

        var rows = [
            { id: 'old-a', examName: 'سالانہ', class: 'اولیٰ', studentId: 12, resultDate: '2026-08-27', timestamp: 1 },
            { id: 'old-b', examName: 'سالانہ', class: 'اولیٰ', studentId: '12', resultDate: '2026-08-27', timestamp: 2 }
        ];
        var record = { examName: 'سالانہ', class: 'اولیٰ', studentId: '12', resultDate: '2026-08-27', timestamp: 3 };
        var result = api.exmUpsertResultByIdentity(rows, record);
        expect(rows).toHaveLength(1);
        expect(result.updated).toBe(true);
        expect(result.duplicatesRemoved).toBe(1);
        expect(rows[0].timestamp).toBe(3);
    });

    it('hardens import matching, partial subject updates and Excel dates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
        expect(src).toContain("var user = sid ? byId[sid]");
        expect(src).toContain('یہ نام ایک سے زیادہ طلبہ کا ہے');
        expect(src).toContain("[String(user.id || sid), exam, rowClass, resultDate].join('||')");
        expect(src).toContain('Object.assign({}, existing && existing.marks || {}, r.marks || {})');
        expect(src).toContain('XLSX.SSF.parse_date_code');
        expect(src).toContain('emsDurableReadRaw');
        var dateYmd = loadDateHelper();
        expect(dateYmd(45500)).toBe('2024-07-27');
        expect(dateYmd('27/08/2026')).toBe('2026-08-27');
    });

    it('promotion writes through registration SSOT and canonical tenant, never auth uid', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var start = src.indexOf('window.promoApply = async function');
        var end = src.indexOf('\nif (typeof window.emsRegisterDepartmentRefresh', start);
        var block = src.slice(start, end);
        expect(block).toContain('emsRegRepoPersistRegistration');
        expect(block).toContain('emsGetTenantId');
        expect(block).toContain("doc(tenantId).collection('Registrations')");
        expect(block).not.toContain('currentUser.uid');
        expect(block).not.toContain('var users = exmGetUsers()');
    });

    it('does not report a failed marks save as success and validates required exam', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('امتحان منتخب کرنا لازمی ہے');
        expect(src).toContain('نمبرات محفوظ نہیں ہو سکے — دوبارہ کوشش کریں');
        expect(src).toContain('currentTotalPossibleMarks += Number(b.marks) || 0');
        expect(src).toContain('list.filter(exmIsPassingResult)');
    });

    it('protects dirty local exam settings during legacy cloud fallback', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var start = src.indexOf('function exmPullModuleDataFallback');
        var end = src.indexOf('\nwindow.emsPullExamsFromCloud', start);
        var block = src.slice(start, end);
        expect(block).toContain('resolvePullConflict');
        expect(block).toContain('if (!decision.apply)');
        expect(block).toContain('markSynced');
        expect(block).not.toContain('applyRemote(key, remoteStr, true)');
    });
});
