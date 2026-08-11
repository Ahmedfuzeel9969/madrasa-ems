import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance period book linked to central library', function () {
    it('reads ems_library_books via durable helpers and fills period select', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain("ATT_LIB_BOOKS_KEY = 'ems_library_books'");
        expect(js).toContain('function attReadLibraryBooks');
        expect(js).toContain('function attEnsureLibraryBook');
        expect(js).toContain('function attFillPeriodBookSelect');
        expect(js).toContain('function attResolvePeriodBookName');
        expect(js).toContain('emsDurableReadRaw');
        expect(js).toContain('emsSaveModuleData');
        expect(js).toContain('attFillPeriodBookSelect(attFormatBookName(p.bookName))');
        expect(js).toContain('attEnsureLibraryBook(bookName)');
        expect(js).toContain('attResolvePeriodBookName()');
    });

    it('migrates unique timetable books into مرکزی کتب خانہ', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attCollectUniquePeriodBooks');
        expect(js).toContain('function attMigratePeriodBooksToLibrary');
        expect(js).toContain('function attLibraryBookDedupeKey');
        expect(js).toContain('attMigratePeriodBooksToLibrary()');
        expect(js).toContain("localStorage.getItem('ems_att_periods'");
    });

    it('also links نظام الاوقات with شعبہ نصاب plans (same as exams library)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain("ATT_CUR_PLANS_KEY = 'ems_curriculum_plans'");
        expect(js).toContain('function attReadCurriculumPlanBooks');
        expect(js).toContain('function attSyncLibraryToCurriculum');
        expect(js).toContain('curSyncFromLibrary');
        expect(js).toContain('fromCurriculum');
        expect(js).toContain('attSyncLibraryToCurriculum');
        expect(js).toContain('skipCurSync');
    });

    it('period modal uses select wired to مرکزی کتب خانہ', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="new-period-book"');
        expect(html).toMatch(/<select[^>]*id="new-period-book"/);
        expect(html).toContain('att-dynamic-lib');
        expect(html).toContain('مرکزی کتب خانہ — امتحانات و نصاب');
        expect(html).toContain('id="new-period-book-custom"');
        expect(html).toContain('attOnPeriodBookSelectChange');
    });

    it('exams refresh keeps attendance book select in sync', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('attRefreshPeriodBookSelect');
        expect(src).toContain('attMigratePeriodBooksToLibrary');
    });
});
