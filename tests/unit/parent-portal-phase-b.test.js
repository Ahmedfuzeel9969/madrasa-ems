import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Parent Portal Phase B — helpdesk transparency & training visibility', function () {
    it('parent-data redacts strictly confidential complaints server-side', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        expect(src).toContain('sanitizeComplaintForParent');
        expect(src).toMatch(/strictlyConfidential\s*===\s*true/);
        expect(src).toContain('latestResolution');
        expect(src).toMatch(/fetchStudentComplaints[\s\S]*?sanitizeComplaintForParent/);
    });

    it('parent-data fetches training records from correct Firestore collections', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        expect(src).toContain("training: 'training'");
        expect(src).toContain('fetchTrainingForStudent');
        expect(src).toContain("'TrainingPrayer'");
        expect(src).toContain("'TrainingEthics'");
        expect(src).toContain("'TrainingDiscipline'");
        expect(src).toMatch(/personId\s*!==\s*studentId/);
        expect(src).toMatch(/view\s*===\s*'training'/);
    });

    it('parent-shared exposes training view in PARENT_VIEWS', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-shared.js'), 'utf8');
        expect(src).toMatch(/\{\s*id:\s*'training',\s*name:\s*'تربیت و نظم',\s*icon:\s*'fa-user-shield'\s*\}/);
    });

    it('parent-portal renders complaint status badges and resolution remarks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(src).toContain('ppComplaintStatusBadge');
        expect(src).toContain('statusKey');
        expect(src).toContain('latestResolution');
        expect(src).toContain('تازہ ترین کارروائی');
        expect(src).toMatch(/viewId\s*===\s*'complaints'/);
        expect(src).toMatch(/renderComplaintsHtml\(list\)/);
    });

    it('parent-portal implements Behavioral & Prayer Radar training UI', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(src).toContain('fetchStudentTraining');
        expect(src).toContain('renderTrainingHtml');
        expect(src).toContain('نماز نگرانی');
        expect(src).toContain('اخلاقی مشاہدات');
        expect(src).toContain('نظم و ضبط');
        expect(src).toMatch(/viewId\s*===\s*'training'/);
        expect(src).toContain("callParentData('training'");
    });

    it('security-layer fallback viewIds include training permission', function () {
        var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
        expect(src).toMatch(/viewIds\s*=\s*\[[^\]]*'training'/);
    });

    it('parent-portal keeps fetchParentMessages intact after Phase B edits', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(src).toContain("function fetchParentMessages(studentId)");
        expect(src).toContain("emsCallFunction('getParentMessages'");
        var matches = src.match(/function renderAnnouncementsHtml/g) || [];
        expect(matches.length).toBe(1);
    });
});
