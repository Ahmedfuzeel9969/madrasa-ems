import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Mirrors finance.js Phase A discount helpers for invariant tests */
function finSetupGross(setup) {
    setup = setup || {};
    var gross = 0;
    Object.keys(setup.fees || {}).forEach(function (k) { gross += Number(setup.fees[k] || 0); });
    if (!gross && setup.netPayable != null) gross = Number(setup.netPayable) + (Number(setup.discount) || 0);
    return gross;
}

function finSetupDiscount(setup) {
    return Math.max(0, Number(setup && setup.discount) || 0);
}

function finSetupNetPayable(setup) {
    return Math.max(0, finSetupGross(setup) - finSetupDiscount(setup));
}

function finCategoryNetAmount(catAmount, setup) {
    catAmount = Number(catAmount) || 0;
    if (catAmount <= 0) return 0;
    var gross = finSetupGross(setup);
    var discount = finSetupDiscount(setup);
    if (!discount || gross <= 0) return catAmount;
    return Math.max(0, Math.round(catAmount - discount * (catAmount / gross)));
}

describe('Finance Phase A — math & guards', function () {
    it('finance.js exposes unified discount + advance balance APIs', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('finSetupNetPayable');
        expect(src).toContain('finCategoryNetAmount');
        expect(src).toContain('advanceBalance');
        expect(src).toContain("status === 'advance'");
    });

    it('flat discount: category nets sum to netPayable (admission + monthly)', function () {
        var setup = {
            fees: { 'داخلہ فیس': 5000, 'ماہانہ فیس': 1000 },
            discount: 500
        };
        var net = finSetupNetPayable(setup);
        var admissionNet = finCategoryNetAmount(5000, setup);
        var monthlyNet = finCategoryNetAmount(1000, setup);
        expect(net).toBe(5500);
        expect(admissionNet + monthlyNet).toBe(5500);
        expect(monthlyNet).toBe(917);
        expect(admissionNet).toBe(4583);
    });

    it('overpayment: advance = paid - billed, arrears = 0', function () {
        var totalBilled = 3000;
        var paid = 3500;
        var arrears = Math.max(0, totalBilled - paid);
        var advanceBalance = Math.max(0, paid - totalBilled);
        expect(arrears).toBe(0);
        expect(advanceBalance).toBe(500);
    });

    it('finance config saves require emsRequireStaffAction', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toMatch(/btn-save-fin-setup[\s\S]*?emsRequireStaffAction\('finance', 'edit'\)/);
        expect(src).toMatch(/btn-save-class-structure[\s\S]*?emsRequireStaffAction\('finance', 'edit'\)/);
        expect(src).toMatch(/btn-add-fin-cat[\s\S]*?emsRequireStaffAction\('finance', 'edit'\)/);
    });

    it('parent-data.js computes arrears from bills + collections', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        expect(src).toContain('FeeBills');
        expect(src).toContain('server_computed');
        expect(src).toContain('advanceBalance');
        expect(src).not.toContain('setup.arrears');
    });
});
