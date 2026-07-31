import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Payroll Phase A — attendance bridge, math integrity, dues engine', function () {
    it('attendance-helper bridges live att_rec_* for payroll', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(src).toContain('emsFetchAttendanceForPayroll');
        expect(src).toContain('attPayrollIsStaffRegisterKey');
        expect(src).toMatch(/_\(teachers\|staff\)_/);
        expect(src).toContain('attPayrollUrduStatus');
        expect(src).toContain('غیر حاضر');
        expect(src).toContain('رخصت');
        expect(src).toMatch(/attHelperStatusAbsent/);
        expect(src).toMatch(/attHelperStatusLeave/);
    });

    it('ledger payroll no longer reads deprecated ems_full_attendance', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).not.toContain('ems_full_attendance');
        expect(src).not.toMatch(/localStorage\.getItem\(DB\.attendance\)/);
        expect(src).toContain('emsFetchAttendanceForPayroll');
    });

    it('ledger uses dynamic days-in-month and allowance-inclusive daily rate', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toContain('ldgDaysInMonth');
        expect(src).toMatch(/new Date\(y, m, 0\)\.getDate\(\)/);
        expect(src).toContain('dailyRateBase');
        expect(src).toMatch(/dailyRateBase\s*=\s*baseSalary\s*\+\s*allowSum/);
        expect(src).not.toMatch(/baseSalary\s*\/\s*30/);
    });

    it('ledger allows negative net salary and shortfall visibility', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).not.toMatch(/netBeforeDues\s*=\s*Math\.max\(0/);
        expect(src).not.toMatch(/netSalary\s*=\s*Math\.max\(0,\s*netBeforeDues/);
        expect(src).toContain('shortfall');
    });

    it('ldgComputeDueDeduction still runs when available net is zero or negative', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/ldgComputeDueDeduction[\s\S]*?salaryCapped/);
        expect(src).not.toMatch(/if\s*\(\s*maxDeduct\s*<=\s*0\s*\)\s*return\s*\{\s*total:\s*0/);
    });

    it('profile advance deduction unified into employee dues only', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/advance:\s*0/);
        expect(src).toContain('ldg-sal-ded-advance');
        expect(src).toMatch(/advEl\.disabled\s*=\s*true/);
        expect(src).not.toMatch(/dedDetail\.advance/);
        expect(src).toMatch(/deductions:\s*\{\s*advance:\s*0/);
    });

    it('payroll generate is async with live attendance fetch', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/fetchAtt\.then/);
        expect(src).toContain('حاضری ڈیٹا لوڈ ہو رہا ہے');
    });
});
