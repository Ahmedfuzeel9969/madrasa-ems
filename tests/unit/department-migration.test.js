import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Mirror of emsInferDepartmentId for unit verification */
function inferDepartmentId(record, defaultId) {
    defaultId = defaultId || 'boys_dars';
    if (!record || typeof record !== 'object') return defaultId;
    if (record.departmentId && record.departmentId !== 'all') return record.departmentId;
    if (record.audience === 'all') return 'all';
    var blob = [record.branch, record.gender, record.resType, record.class, record.dept].join(' ').toLowerCase();
    var isGirls = /girl|طالبات|female|خواتین|banat|bnat|بنات/i.test(blob);
    var isHifz = /hifz|حفظ|huffaz|حافظ/i.test(blob);
    if (isGirls) return isHifz ? 'girls_hifz' : 'girls_dars';
    if (isHifz) return 'boys_hifz';
    return defaultId;
}

describe('department migration Phase D', function () {
    it('migration module exposes scan and apply API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-migration.js'), 'utf8');
        expect(src).toContain('emsDeptMigrationScan');
        expect(src).toContain('emsDeptMigrationApplyLocal');
        expect(src).toContain('emsDeptMigrationApplyFirestore');
        expect(src).toContain('emsDeptMigrationRenderUI');
    });

    it('context exposes infer and needs-migration helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-context.js'), 'utf8');
        expect(src).toContain('emsInferDepartmentId');
        expect(src).toContain('emsRecordNeedsDepartmentMigration');
    });

    it('sys-settings has migration tab and UI', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.html).toContain('sys-win-dept-migration');
        expect(m.combined).toContain('department-migration.js');
        var sys = fs.readFileSync(path.join(ROOT, 'sys-settings.js'), 'utf8');
        expect(sys).toContain('sys-win-dept-migration');
    });

    it('firestore indexes include departmentId composites', function () {
        var idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8'));
        var groups = idx.indexes.map(function (i) { return i.collectionGroup; });
        expect(groups).toContain('Registrations');
        expect(groups).toContain('LedgerEntries');
        expect(groups).toContain('Announcements');
    });

    it('infers department from legacy fields', function () {
        expect(inferDepartmentId({})).toBe('boys_dars');
        expect(inferDepartmentId({ class: 'حفظ' })).toBe('boys_hifz');
        expect(inferDepartmentId({ class: 'طالبات درس' })).toBe('girls_dars');
        expect(inferDepartmentId({ class: 'طالبات حفظ' })).toBe('girls_hifz');
        expect(inferDepartmentId({ audience: 'all' })).toBe('all');
        expect(inferDepartmentId({ departmentId: 'girls_hifz' })).toBe('girls_hifz');
    });
});
