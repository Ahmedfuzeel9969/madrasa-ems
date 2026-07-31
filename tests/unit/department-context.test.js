import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('department context Phase A', function () {
    it('defines four departments and storage key', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-context.js'), 'utf8');
        expect(src).toContain('ems_current_department');
        expect(src).toContain('boys_dars');
        expect(src).toContain('boys_hifz');
        expect(src).toContain('girls_dars');
        expect(src).toContain('girls_hifz');
        expect(src).toContain('EMS_CURRENT_DEPARTMENT');
        expect(src).toContain("DEFAULT_DEPARTMENT = 'boys_dars'");
    });

    it('exposes context API without module filtering yet', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-context.js'), 'utf8');
        expect(src).toContain('emsGetDepartmentId');
        expect(src).toContain('emsSetDepartment');
        expect(src).toContain('emsIsDepartmentScopedModule');
        expect(src).toContain('emsRecordMatchesDepartment');
    });

    it('selector UI wired in index and selector script', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.html).toContain('ems-dept-select');
        expect(m.html).toContain('ems-dept-more-btn');
        expect(m.html).toContain('department-context.js');
        expect(m.combined).toContain('department-selector.js');
        var ui = fs.readFileSync(path.join(ROOT, 'department-selector.js'), 'utf8');
        expect(ui).toContain('emsRenderDepartmentSelector');
    });
});

describe('department context Phase B', function () {
    it('exposes filter, stamp, and refresh helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-context.js'), 'utf8');
        expect(src).toContain('emsFilterByDepartment');
        expect(src).toContain('emsStampDepartment');
        expect(src).toContain('emsRegisterDepartmentRefresh');
        expect(src).toContain('emsRefreshDepartmentModules');
        expect(src).toContain('ems:department-changed');
    });

    it('modules register department refresh handlers', function () {
        var files = [
            'admission.js', 'dashboard.js', 'attendance.js', 'exams.js',
            'complaints.js', 'training.js', 'curriculum.js', 'parent-portal.js'
        ];
        files.forEach(function (f) {
            var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            expect(src).toContain('emsRegisterDepartmentRefresh');
        });
    });

    it('import stamps departmentId on cleanRecord', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(src).toContain('emsStampDepartment(clean)');
    });
});

describe('department context Phase C', function () {
    it('exposes optional dept filter API for global modules', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-context.js'), 'utf8');
        expect(src).toContain('emsIsOptionalDeptFilterOn');
        expect(src).toContain('emsApplyOptionalDeptFilter');
        expect(src).toContain('emsMountOptionalDeptFilter');
        expect(src).toContain('emsFilterCollectionsByStudentDept');
        expect(src).toContain('emsIsInstitutionWideRecord');
    });

    it('global modules mount optional filter UI', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('fin-opt-dept-filter');
        expect(html).toContain('ldg-opt-dept-filter');
        expect(html).toContain('ann-opt-dept-filter');
        var fin = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(fin).toContain('finInitOptDeptFilter');
        var ldg = fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8');
        expect(ldg).toContain('ldgInitOptDeptFilter');
        var ann = fs.readFileSync(path.join(ROOT, 'announcements.js'), 'utf8');
        expect(ann).toContain('annInitOptDeptFilter');
    });
});

describe('department context Phase D', function () {
    it('context exposes infer helpers for migration', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-context.js'), 'utf8');
        expect(src).toContain('emsInferDepartmentId');
        expect(src).toContain('emsRecordNeedsDepartmentMigration');
    });
});
