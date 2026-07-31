import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function extractLedgerFn(name) {
    var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
    var re = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}');
    var m = src.match(re);
    if (!m) throw new Error('Could not extract ' + name + ' from ledger.js');
    return m[0];
}

function loadLeaveQuotaFns() {
    var ctx = { window: {} };
    ctx.global = ctx;
    var body = extractLedgerFn('ldgLeaveQuotaPenaltyDays') + '\n' +
        extractLedgerFn('ldgFilterEmpAttendance') + '\n' +
        'global.ldgLeaveQuotaPenaltyDays = ldgLeaveQuotaPenaltyDays;\n' +
        'global.ldgFilterEmpAttendance = ldgFilterEmpAttendance;\n' +
        'function ldgEmpIdAliasSet(emp) {\n' +
        '  var set = {};\n' +
        '  if (emp && emp.id) set[emp.id] = true;\n' +
        '  return set;\n' +
        '}\n';
    vm.runInNewContext(body, ctx, { filename: 'ledger-leave-quota.js' });
    return ctx;
}

function loadSecurityLayer(ctx) {
    ctx.global = ctx.window;
    ctx.document = {
        getElementById: function () { return null; },
        querySelectorAll: function () { return []; },
        addEventListener: function () {},
        body: { innerHTML: '' }
    };
    ctx.global.document = ctx.document;
    ctx.global.ADMIN_STAFF_MODULES = [{ id: 'attendance' }];
    ctx.global.apGetStaffPerm = function () { return { status: 'active', modules: { attendance: true } }; };
    ctx.global.emsGetStaffRecordForCurrentUser = function () { return null; };
    var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
    vm.runInNewContext(src, ctx, { filename: 'security-layer.js' });
}

describe('Payroll Phase C — leave quota math & attendance fraud prevention', function () {
    it('ledger tracks yearLeavesBeforeMonth separately from month penalty loop', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toContain('ldgLeaveQuotaPenaltyDays');
        expect(src).toContain('yearLeavesBeforeMonth');
        expect(src).toMatch(/ldgComputePayrollRow[\s\S]*?leavePenaltyDays\s*=\s*ldgLeaveQuotaPenaltyDays/);
        expect(src).toMatch(/runningYearLeaves\s*>\s*allowedQuota/);
        expect(src).not.toMatch(/usedLeavesInYear\s*>\s*allowedQuota[\s\S]*?monthLeaves\.forEach/);
    });

    it('ldgLeaveQuotaPenaltyDays deducts only excess leaves over annual quota', function () {
        var ctx = loadLeaveQuotaFns();
        var fn = ctx.global.ldgLeaveQuotaPenaltyDays;
        var monthLeaves = [
            { date: '2026-07-05', status: 'رخصت' },
            { date: '2026-07-12', status: 'رخصت' },
            { date: '2026-07-20', status: 'رخصت' }
        ];
        expect(fn(monthLeaves, [], 14, 15)).toBe(2);
        expect(fn(monthLeaves, [], 14, 15)).not.toBe(3);
    });

    it('ldgLeaveQuotaPenaltyDays leaves under quota untouched', function () {
        var ctx = loadLeaveQuotaFns();
        var fn = ctx.global.ldgLeaveQuotaPenaltyDays;
        var monthLeaves = [
            { date: '2026-07-03', status: 'رخصت' },
            { date: '2026-07-18', status: 'رخصت' }
        ];
        expect(fn(monthLeaves, [], 10, 15)).toBe(0);
        expect(fn([{ date: '2026-07-01', status: 'رخصت' }], [], 15, 15)).toBe(1);
    });

    it('ldgLeaveQuotaPenaltyDays always penalizes blackout leaves', function () {
        var ctx = loadLeaveQuotaFns();
        var fn = ctx.global.ldgLeaveQuotaPenaltyDays;
        var monthLeaves = [{ date: '2026-07-10', status: 'رخصت' }];
        var blackouts = [{ start: '2026-07-01', end: '2026-07-31' }];
        expect(fn(monthLeaves, blackouts, 0, 15)).toBe(1);
        expect(fn(monthLeaves, [], 0, 15)).toBe(0);
    });

    it('ldgFilterEmpAttendance counts pre-month year leaves for quota baseline', function () {
        var ctx = loadLeaveQuotaFns();
        var fn = ctx.global.ldgFilterEmpAttendance;
        var db = [
            { studentId: 'T1', date: '2026-01-10', status: 'رخصت' },
            { studentId: 'T1', date: '2026-06-15', status: 'رخصت' },
            { studentId: 'T1', date: '2026-07-08', status: 'رخصت' },
            { studentId: 'T1', date: '2026-07-22', status: 'غیر حاضر' }
        ];
        var slice = fn(db, { id: 'T1' }, '2026-07');
        expect(slice.yearLeavesBeforeMonth).toBe(2);
        expect(slice.monthRows.length).toBe(2);
    });

    it('security-layer blocks staff self-attendance edit with Urdu toast message', function () {
        var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
        expect(src).toContain('emsAttendanceSelfEditBlocked');
        expect(src).toContain('آپ اپنی حاضری خود درج نہیں کر سکتے۔');
        expect(src).toMatch(/isSuperAdmin[\s\S]*?emsAttendanceSelfEditBlocked[\s\S]*?blocked:\s*false/);
        expect(src).toMatch(/isMadrasaAdmin[\s\S]*?emsAttendanceSelfEditBlocked[\s\S]*?blocked:\s*false/);
    });

    it('emsAttendanceSelfEditBlocked blocks matching staff id', function () {
        var ctx = { window: {} };
        ctx.global = ctx.window;
        ctx.global.CURRENT_STAFF_LINK = { staffId: 'TCH-42' };
        ctx.global.isSuperAdmin = function () { return false; };
        ctx.global.isMadrasaAdmin = function () { return false; };
        loadSecurityLayer(ctx);
        var res = ctx.global.emsAttendanceSelfEditBlocked('TCH-42');
        expect(res.blocked).toBe(true);
        expect(res.message).toBe('آپ اپنی حاضری خود درج نہیں کر سکتے۔');
        expect(ctx.global.emsAttendanceSelfEditBlocked('TCH-99').blocked).toBe(false);
    });

    it('emsAttendanceSelfEditBlocked allows owner and super-admin override', function () {
        var ctx = { window: {} };
        ctx.global = ctx.window;
        ctx.global.CURRENT_STAFF_LINK = { staffId: 'TCH-42' };
        loadSecurityLayer(ctx);
        ctx.global.isSuperAdmin = function () { return true; };
        expect(ctx.global.emsAttendanceSelfEditBlocked('TCH-42').blocked).toBe(false);
        ctx.global.isSuperAdmin = function () { return false; };
        ctx.global.isMadrasaAdmin = function () { return true; };
        expect(ctx.global.emsAttendanceSelfEditBlocked('TCH-42').blocked).toBe(false);
    });

    it('attendance.js guards all staff register edit entry points', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('attIsStaffAttendanceRegister');
        expect(src).toContain('attGuardSelfAttendanceEdit');
        expect(src).toContain('emsAttendanceSelfEditBlocked');
        expect(src).toMatch(/setCellStatus[\s\S]*?attGuardSelfAttendanceEdit\(uid\)/);
        expect(src).toMatch(/clearCellStatus[\s\S]*?attGuardSelfAttendanceEdit\(uid\)/);
        expect(src).toMatch(/openCustomStatusModal[\s\S]*?attGuardSelfAttendanceEdit\(uid\)/);
        expect(src).toMatch(/btn-apply-custom-status[\s\S]*?attGuardSelfAttendanceEdit\(tempCustomTarget\.uid\)/);
        expect(src).toMatch(/masterToggle[\s\S]*?attIsSelfAttendanceEditBlocked\(uid\)/);
        expect(src).toMatch(/masterClearColumn[\s\S]*?attIsSelfAttendanceEditBlocked\(uid\)/);
    });
});
