import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 6 Sprint 1 — Smart Slip System', function () {
    it('ems-smart-slip.js exports core slip APIs', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-smart-slip.js'), 'utf8');
        expect(src).toContain('emsSlipPrintChallan');
        expect(src).toContain('emsSlipPrintBatchChallans');
        expect(src).toContain('emsSlipEnhanceReceiptDOM');
        expect(src).toContain('emsSlipEncodePayload');
        expect(src).toContain("kind === 'CH'");
        expect(src).toContain("kind === 'RC'");
    });

    it('lazy loader loads smart slip before finance.js', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        var slipIdx = src.indexOf('ems-smart-slip.js');
        var finIdx = src.indexOf('finance.js');
        expect(slipIdx).toBeGreaterThan(-1);
        expect(finIdx).toBeGreaterThan(slipIdx);
    });

    it('finance.js wires slip print actions', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('emsSlipPrintChallan');
        expect(src).toContain('finPrintFilteredChallanSlips');
        expect(src).toContain('emsSlipEnhanceReceiptDOM');
        expect(src).toContain('emsSlipLoadSettingsToUI');
    });

    it('index.html has slip settings UI and receipt QR host', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-slip-size');
        expect(html).toContain('finPrintFilteredChallanSlips');
        expect(html).toContain('fin-receipt-qr-wrap');
    });
});
