import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadDupModule(records, rejected) {
    var g = {
        emsRegRepoForEach: function (fn) {
            (records || []).forEach(fn);
        },
        emsRegRepoGetRejectedList: function () {
            return rejected || [];
        }
    };
    var ctx = { global: g, window: g, globalThis: g };
    vm.createContext(ctx);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'ems-registration-duplicates.js'), 'utf8'),
        ctx
    );
    return g;
}

describe('Sprint 3 — Registration duplicate detection', function () {
    it('ems-registration-duplicates.js exposes check API and normalizers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-duplicates.js'), 'utf8');
        expect(src).toContain('emsRegCheckDuplicates');
        expect(src).toContain('emsRegCheckDuplicatesAsync');
        expect(src).toContain('emsRegCanOverrideHardDuplicate');
        expect(src).toContain('emsRegDupNormalizeCnic');
    });

    it('post-auth loader loads duplicates after repository', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var repoIdx = src.indexOf('ems-registration-repository.js');
        var dupIdx = src.indexOf('ems-registration-duplicates.js');
        expect(repoIdx).toBeGreaterThan(-1);
        expect(dupIdx).toBeGreaterThan(repoIdx);
    });

    it('admission processRegistration uses duplicate gate before save', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('regRunDuplicateGate');
        expect(src).toContain('regShowDuplicateModal');
        expect(src).toContain('regDupWireBlurChecks');
        var fn = src.match(/window\.processRegistration\s*=\s*function[\s\S]*?regRunDuplicateGate\(user, proceedRegistrationSave\);/);
        expect(fn).toBeTruthy();
    });

    it('D1 hard block — same CNIC as existing record', function () {
        var g = loadDupModule([
            { id: 'STD-001', name: 'علی', cnic: '35202-1234567-1', phone: '03001111111' }
        ]);
        var res = g.emsRegCheckDuplicates(
            { id: 'STD-NEW', name: 'نیا', cnic: '3520212345671' },
            { scope: 'all' }
        );
        expect(res.hasHard).toBe(true);
        expect(res.matches[0].existingId).toBe('STD-001');
        expect(res.matches[0].rule).toBe('D1');
    });

    it('D1 edit self — excludeId allows same CNIC', function () {
        var g = loadDupModule([
            { id: 'STD-001', name: 'علی', cnic: '3520212345671' }
        ]);
        var res = g.emsRegCheckDuplicates(
            { id: 'STD-001', cnic: '3520212345671' },
            { excludeId: 'STD-001', scope: 'all' }
        );
        expect(res.hasHard).toBe(false);
        expect(res.matches.length).toBe(0);
    });

    it('D4 soft warn — same name+fname, different CNIC', function () {
        var g = loadDupModule([
            { id: 'STD-002', name: 'محمد', fname: 'احمد', cnic: '3520212345672' }
        ]);
        var res = g.emsRegCheckDuplicates(
            { name: 'محمد', fname: 'احمد', cnic: '3520299999999' },
            { scope: 'all' }
        );
        expect(res.hasHard).toBe(false);
        expect(res.hasSoft).toBe(true);
        expect(res.soft[0].rule).toBe('D4');
    });

    it('D6 roll duplicate — soft warning', function () {
        var g = loadDupModule([
            { id: 'STD-003', name: 'حسن', madrasaRollNo: 'roll-05' }
        ]);
        var res = g.emsRegCheckDuplicates(
            { name: 'دوسرا', madrasaRollNo: 'ROLL-05' },
            { scope: 'all' }
        );
        expect(res.hasSoft).toBe(true);
        expect(res.soft.some(function (m) { return m.rule === 'D6'; })).toBe(true);
    });

    it('empty CNIC skips D1 hard match', function () {
        var g = loadDupModule([
            { id: 'STD-004', name: 'محمد', fname: 'علی', cnic: '3520212345671' }
        ]);
        var res = g.emsRegCheckDuplicates(
            { name: 'محمد', fname: 'علی' },
            { scope: 'all' }
        );
        expect(res.hasHard).toBe(false);
        expect(res.hasSoft).toBe(true);
    });

    it('owner override helper respects admin flags', function () {
        var g = loadDupModule([]);
        g.isMadrasaAdmin = function () { return true; };
        expect(g.emsRegCanOverrideHardDuplicate()).toBe(true);
        g.isMadrasaAdmin = function () { return false; };
        g.isSuperAdmin = function () { return false; };
        expect(g.emsRegCanOverrideHardDuplicate()).toBe(false);
    });
});
