import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams quarterly type + template date persistence', function () {
    it('default exam types include سہ ماہی امتحان and migrate existing lists', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain("EXM_DEFAULT_EXAM_TYPES = ['ماہانہ امتحان', 'سہ ماہی امتحان', 'ششماہی امتحان', 'سالانہ امتحان']");
        expect(src).toContain('function exmEnsureQuarterlyExamType');
        expect(src).toContain('quarterlyMerge.changed');
    });

    it('examResolveCurTerm maps سہ ماہی to quarterly', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var start = src.indexOf('window.examResolveCurTerm = function');
        var end = src.indexOf('window.examGetCurScopeForBook', start);
        var fn = src.slice(start, end);
        expect(fn).toContain("return 'quarterly'");
        expect(fn).toMatch(/سہ\\s\*ماہی/);
    });

    it('ensures durable blobs before refresh and warms cache after save', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmEnsureBlobsReady');
        expect(src).toContain("'ems_exam_templates'");
        expect(src).toContain("'ems_master_sheet_meta'");
        expect(src).toContain('exmEnsureBlobsReady().then(exmRefreshExamDataInner)');
        expect(src).toContain('function exmWarmCacheAfterSave');
        expect(src).not.toMatch(/emsSaveKey[\s\S]{0,220}emsCacheInvalidate\(key\)[\s\S]{0,80}emsSaveModuleData/);
    });

    it('matrix title/time persist via meta helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmPersistMatrixMetaFromUi');
        expect(src).toContain('function exmApplyMasterSheetMetaToUi');
        expect(src).toContain('exmPersistMatrixMetaFromUi()');
    });

    it('curriculum exam link includes سہ ماہی field', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="cur-exam-quarterly"');
        expect(html).toContain('سہ ماہی — شامل حصہ');
        var cur = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        expect(cur).toContain("term === 'quarterly'");
        expect(cur).toContain('quarterly: g(\'cur-exam-quarterly\')');
    });
});
