import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams audit hardening — cross-tenant and data integrity', function () {
    it('cloud fallback uses scoped apply helper not raw global setItem', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmApplyPulledModuleData');
        expect(src).toContain('exmPurgeUnscopedLegacyKey(key)');
        expect(src).toContain('exmStampBlobOwner(key)');
        expect(src).not.toMatch(/exmPullModuleDataFallback[\s\S]{0,900}_emsOriginalSetItem\.call\(localStorage, key/);
    });

    it('tenant migration guards exam blobs by owner stamp', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        expect(src).toContain('EXAM_MIGRATION_GUARD_KEYS');
        expect(src).toContain("rawLocalGet('ems_blob_owner__' + baseKey)");
    });

    it('marks save uses persist queue and preserves off-template marks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('window.exmRunExamsPersist');
        expect(src).toContain('_exmMarksSaveBusy');
        expect(src).toMatch(/Object\.keys\(existingMarks\)/);
        expect(src).toContain('exmStaffHasExamsEdit');
    });

    it('legacy undated lock does not block specific result dates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var start = src.indexOf('window.exmIsExamLocked = function');
        var end = src.indexOf('function exmIsMarksContextLocked', start);
        var fn = src.slice(start, end);
        expect(fn).toMatch(/if \(d\) \{[\s\S]*return false;/);
    });

    it('master_sheet_meta is in direct registry and sync module keys', function () {
        var direct = fs.readFileSync(path.join(ROOT, 'cloud', 'direct-firestore.js'), 'utf8');
        expect(direct).toContain("'ems_master_sheet_meta'");
        expect(direct).toContain("docId: 'master_sheet_meta'");
        var sync = fs.readFileSync(path.join(ROOT, 'cloud', 'sync-engine.js'), 'utf8');
        expect(sync).toContain("'ems_master_sheet_meta'");
    });

    it('import persist ensures durable key and uses exams persist queue', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
        expect(src).toContain('emsDurableEnsureKey(EXAMS_KEY)');
        expect(src).toContain('exmRunExamsPersist');
        expect(src).toContain('reparseFromRawAoa');
    });
});
