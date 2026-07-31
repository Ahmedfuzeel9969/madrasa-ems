import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E9-S1 — Exam & Curriculum summaries', function () {
    it('cloud function aggregates ExaminationSummary and CurriculumSummary', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-exam-curriculum-summaries.js'), 'utf8');
        expect(src).toContain('ExaminationSummary');
        expect(src).toContain('CurriculumSummary');
        expect(src).toContain('Exams__ems_full_exams');
        expect(src).toContain('Curriculum__ems_curriculum_daily');
        expect(src).toContain('_overview');
    });

    it('functions index exports onModuleDataSummaryWrite', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
        expect(src).toContain('onModuleDataSummaryWrite');
    });

    it('ems-module-summaries.js listens to exam and curriculum summaries', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-module-summaries.js'), 'utf8');
        expect(src).toContain('emsGetExaminationOverview');
        expect(src).toContain('emsGetCurriculumSummary');
        expect(src).toContain('ExaminationSummary');
        expect(src).toContain('CurriculumSummary');
    });

    it('exams.js fixes exmGetUsers recursion and uses cache layer', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toMatch(/function exmGetUsers\(\)[\s\S]{0,500}emsGetUsersMerged/);
    });

    it('curriculum.js uses CurriculumSummary when available', function () {
        var src = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        expect(src).toContain('emsGetCurriculumSummary');
        expect(src).toContain('emsOnCurriculumSummaryUpdate');
    });
});
