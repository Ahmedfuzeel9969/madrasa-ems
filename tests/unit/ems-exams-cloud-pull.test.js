import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams cloud pull (central ems-cloud-pull)', function () {
    it('wires exams scope through emsCloudPullExecute', function () {
        var pull = fs.readFileSync(path.join(ROOT, 'ems-cloud-pull.js'), 'utf8');
        expect(pull).toContain("pullScope === 'exams'");
        expect(pull).toContain('pullExams(');
        expect(pull).toContain('emsPullExamsFromCloud');
        expect(pull).toContain("scope === 'exams'");
        expect(pull).toContain('ExamResults');
        expect(pull).toContain('isDeptPullScope');
    });

    it('exposes emsPullExamsFromCloud covering all exams subsection keys', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('window.emsPullExamsFromCloud');
        expect(src).toContain('EMS_EXAMS_CLOUD_KEYS');
        expect(src).toContain('ems_full_exams');
        expect(src).toContain('ems_exam_types');
        expect(src).toContain('ems_library_books');
        expect(src).toContain('ems_exam_templates');
        expect(src).toContain('ems_exam_locks');
        expect(src).toContain('ems_master_sheet_meta');
        expect(src).toContain('forceApply: false');
        expect(src).toContain('exmPullModuleDataFallback');
        expect(src).toContain("pullGroup('Exams'");
    });

    it('direct firestore honors forceApply on exams pullGroup', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud/direct-firestore.js'), 'utf8');
        expect(src).toContain('forceApply');
        expect(src).toContain("Exams: ['ems_full_exams', 'ems_exam_types', 'ems_library_books', 'ems_exam_templates', 'ems_exam_locks', 'ems_master_sheet_meta']");
        expect(src).toContain('applyRemoteDecision(localKey, remoteStr, remoteAt, opts)');
    });

    it('exams module has cloud pull button with central data attribute', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="btn-exam-cloud-pull"');
        expect(html).toContain('data-ems-cloud-pull="exams"');
        expect(html).toMatch(/module-exams[\s\S]*?data-ems-cloud-pull="exams"/);
    });
});
