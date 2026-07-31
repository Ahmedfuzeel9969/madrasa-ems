import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Payroll Phase B — anti-fraud, approval, double-pay guards', function () {
    it('security-layer exposes maker-checker and self-payment guards', function () {
        var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
        expect(src).toContain('emsPayrollRequiresMakerChecker');
        expect(src).toContain('emsPayrollSelfPaymentBlocked');
        expect(src).toContain('آپ اپنی تنخواہ خود ادا نہیں کر سکتے');
        expect(src).toMatch(/isMadrasaAdmin[\s\S]*?return false/);
    });

    it('paySalaryInstant posts pending ledger for maker-checker roles', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/paySalaryInstant[\s\S]*?emsPayrollRequiresMakerChecker/);
        expect(src).toMatch(/approvalStatus:\s*needsApproval\s*\?\s*'pending'\s*:\s*'approved'/);
        expect(src).not.toMatch(/paySalaryInstant[\s\S]*?approvalStatus:\s*'approved'\s*\n\s*\};/);
        expect(src).toContain('payrollHistId');
        expect(src).toContain('ldgFinalizePayrollLedgerApproval');
    });

    it('due deductions apply on ledger approval not at pending pay', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/if\s*\(\s*!needsApproval\s*\)\s*\{[\s\S]*?ldgApplyPayrollDueDeductions/);
        expect(src).toMatch(/ldgApproveEntry[\s\S]*?ldgFinalizePayrollLedgerApproval/);
        expect(src).toMatch(/ldgRejectEntry[\s\S]*?ldgCancelPayrollOnLedgerReject/);
    });

    it('double-payment guard re-queries payroll history before save', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toContain('ldgPayrollMonthAlreadyPaid');
        expect(src).toMatch(/paySalaryInstant[\s\S]*?ldgPayrollMonthAlreadyPaid\(staffId,\s*empData\.month\)/);
        expect(src).toContain('اس ماہ کی تنخواہ پہلے ہی ادا کی جا چکی ہے!');
        expect(src).not.toMatch(/if\s*\(\s*!empData\s*\|\|\s*empData\.isPaid\s*\)/);
    });

    it('ldgDeleteSpecialPayment removes linked ledger entry', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/ldgDeleteSpecialPayment[\s\S]*?rec\.ledgerEntryId/);
        expect(src).toMatch(/ledgerDB\.filter\(function \(x\) \{ return x\.id !== rec\.ledgerEntryId/);
        expect(src).not.toContain('روزنامچہ اندراج برقرار رہے گا');
    });

    it('cancelled/rejected payroll frees month for re-payment', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toContain('ldgPayrollRecordActive');
        expect(src).toMatch(/approvalStatus\s*=\s*'cancelled'/);
        expect(src).toContain("'rejected'");
    });
});
