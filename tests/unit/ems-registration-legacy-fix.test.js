import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Sprint 1 — Registration legacy path removal', function () {
    it('admission.js has no ems_full_users / DB_USERS read paths', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).not.toContain('const DB_USERS');
        expect(src).not.toContain('const DB_REJECTED');
        expect(src).not.toMatch(/emsCacheGet\(DB_USERS/);
        expect(src).not.toMatch(/emsCacheGet\(DB_REJECTED/);
        expect(src).not.toMatch(/localStorage\.getItem\(DB_USERS/);
        expect(src).not.toMatch(/localStorage\.getItem\(DB_REJECTED/);
        expect(src).toContain('emsRegGetRecordById');
        expect(src).toContain('emsRegRepoGetRejectedList');
    });

    it('admission.js openLetterModal uses SSOT loader', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('renderLetterModalContent');
        expect(src).toContain('emsRegGetRecordById');
        expect(src).not.toMatch(/openLetterModal[\s\S]*emsCacheGet/);
    });

    it('admission.js does not define legacy openIDCardModal with localStorage', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).not.toMatch(/openIDCardModal[\s\S]*emsCacheGet/);
        expect(src).toContain('ems-idcard.js');
    });

    it('ems-idcard.js uses SSOT only for record lookup', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idcard.js'), 'utf8');
        expect(src).toContain('emsRegGetRecordById');
        expect(src).not.toContain('ems_full_users');
        expect(src).not.toMatch(/emsCacheGet\(\(global\.DB/);
        expect(src).not.toContain('emsGetUsersMerged');
    });

    it('ems-registration-repository.js exposes SSOT read helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegGetRecordById');
        expect(src).toContain('EMS_REG_LEGACY_READ_FALLBACK');
        expect(src).toContain('repoMirrorGetById');
        expect(src).toContain('legacyRegRecordFallback');
    });

    it('legacy fallback is opt-in only (default false)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toMatch(/EMS_REG_LEGACY_READ_FALLBACK\s*=\s*false/);
    });

    it('generateAutoID uses repo lists only', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        var fn = src.match(/window\.generateAutoID\s*=\s*function[\s\S]*?return prefix/);
        expect(fn).toBeTruthy();
        expect(fn[0]).toContain('emsRegRepoGetList');
        expect(fn[0]).not.toContain('localStorage');
        expect(fn[0]).not.toContain('emsCacheGet');
    });
});
