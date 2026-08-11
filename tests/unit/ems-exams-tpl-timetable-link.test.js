import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Timetable books linked into exams master sheet by class', function () {
    it('exposes sync from ems_att_periods class+book into ems_exam_templates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('window.exmSyncTimetableBooksToMasterSheet');
        expect(src).toContain("localStorage.getItem('ems_att_periods'");
        expect(src).toContain('exmEnsureClassTemplate');
        expect(src).toContain('exmBuildTplBookEntry');
        expect(src).toContain("ems_exam_templates");
        expect(src).toContain('exam-win-template');
        expect(src).toContain('exmSyncTimetableBooksToMasterSheet({ silent: false })');
        expect(src).toContain('removedBooks');
        expect(src).toContain('exmTplRemovedSet');
    });

    it('attendance period save triggers master-sheet sync', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('exmSyncTimetableBooksToMasterSheet');
    });
});
