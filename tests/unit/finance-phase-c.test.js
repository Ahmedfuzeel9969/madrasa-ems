import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Finance Phase C — Ledger bridge & double-count guard', function () {
    it('finance.js exposes manual fee ledger detection and block toast', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('finIsManualFeeLedgerEntry');
        expect(src).toContain('finManualFeeLedgerBlockToast');
        expect(src).toContain('فیس|fee|tuition|چالان');
        expect(src).toContain('فیس کی وصولی خودکار طور پر فنڈ میں شامل ہو جاتی ہے۔ براہ کرم اسے روزنامچہ میں دستی طور پر درج نہ کریں۔');
    });

    it('ledger.js blocks manual fee income on save, edit, and CSV import', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(src).toMatch(/btn-save-ledger-entry[\s\S]*?finIsManualFeeLedgerEntry/);
        expect(src).toMatch(/ldgSaveEditedEntry[\s\S]*?finIsManualFeeLedgerEntry/);
        expect(src).toMatch(/ldgImportEntriesCSV[\s\S]*?finIsManualFeeLedgerEntry/);
        expect(src).toContain('finManualFeeLedgerBlockToast');
    });

    it('ledger.js renders virtual fee bridge card and table row', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(src).toContain('ldgRenderFeeBridgeCard');
        expect(src).toContain('ldgGetActiveFeeCollectionsInPeriod');
        expect(src).toContain('ldg-fee-virtual-row');
        expect(html).toContain('id="ldg-fee-bridge-card"');
    });

    it('dashboard-pro.js avoids double-counting ledger income and fee collections', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('isLegacyManualFeeLedgerEntry');
        expect(src).toContain('sumMonthIncome');
        expect(src).toContain('sumMonthFeeCollections');
        expect(src).toMatch(/function financeMonths\(\)[\s\S]*?sumMonthFeeCollections[\s\S]*?sumMonthIncome/);
        expect(src).toMatch(/emsRenderMiniCharts[\s\S]*?sumMonthFeeCollections[\s\S]*?sumMonthIncome/);
        expect(src).toMatch(/nodeFinanceMonth[\s\S]*?isLegacyManualFeeLedgerEntry/);
    });
});
