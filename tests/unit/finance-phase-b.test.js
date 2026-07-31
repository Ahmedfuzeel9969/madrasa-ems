import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Finance Phase B — RBAC, void, daily closure', function () {
    it('firestore canWriteFinance allows staff finance/ledger module writes', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toMatch(/function canWriteFinance\(madrasaId\)/);
        expect(rules).toContain("canStaffUpdate(madrasaId, 'finance')");
        expect(rules).toContain("canStaffCreate(madrasaId, 'finance')");
        expect(rules).not.toMatch(/function canWriteFinance\(madrasaId\) \{\s*return canOwnerAct\(madrasaId\) \|\| isSuperAdmin\(\);\s*\}/);
    });

    it('finance.js implements void workflow without hard-delete', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('finVoidCollection');
        expect(src).toContain('isVoid');
        expect(src).toContain('voidReason');
        expect(src).toContain('voidedBy');
        expect(src).toContain('voidedAt');
        expect(src).toContain('finIsCollectionActive');
        expect(src).toContain('finCollectionEffectiveAmount');
    });

    it('finance.js blocks collections on ledger blackout dates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('finIsDateClosed');
        expect(src).toContain('finRequireDateOpen');
        expect(src).toContain('ems_ledger_blackouts');
        expect(src).toContain('اس تاریخ کا روزنامچہ بند ہو چکا ہے');
        expect(src).toMatch(/btn-save-collection[\s\S]*?finRequireDateOpen/);
        expect(src).toMatch(/finVoidCollection[\s\S]*?finRequireDateOpen/);
    });

    it('index.html exposes void receipt UI', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('btn-void-receipt');
        expect(html).toContain('fin-receipt-void-banner');
        expect(html).toContain('منسوخ');
    });

    it('parent-data and cloud stats ignore voided collections', function () {
        var parent = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        var stats = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'tenant-dashboard-stats.js'), 'utf8');
        expect(parent).toContain('c.isVoid');
        expect(stats).toContain('feeCollectionEffectiveAmount');
        expect(stats).toContain('isVoid');
    });
});
