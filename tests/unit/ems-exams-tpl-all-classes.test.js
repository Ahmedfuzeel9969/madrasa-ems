import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams master sheet all-classes option', function () {
    it('wires تمام درجات into tpl-class-select and add-book flow', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain("EXM_TPL_ALL_CLASSES = '__ALL_CLASSES__'");
        expect(src).toContain('window.exmEnsureTplAllClassesOption');
        expect(src).toContain('exmListMasterSheetClasses');
        expect(src).toContain('cls === EXM_TPL_ALL_CLASSES');
        expect(src).toContain("opt.textContent = 'تمام درجات'");
        expect(src).toContain('exmRenderAllClassesMatrix');
        expect(src).toContain('الورقة الأولى');
        expect(src).toContain('الصفوف الدراسية');
        expect(src).toContain('الزمن:');
        expect(src).toContain('window.exmSetTplBookDate');
        expect(src).toContain('window.exmSetClassMatrixOrder');
        expect(src).toContain('window.exmMoveClassMatrix');
        expect(src).toContain('sortOrder');
        expect(src).toContain('window.exmReorderMatrixPaperColumns');
        expect(src).toContain('exmBindMatrixPaperColumnDrag');
        expect(src).toContain('matrixOrder');
        expect(src).toContain('tpl-matrix-paper-head');
        expect(src).toContain('window.exmSetMatrixPaperColumnDate');
        expect(src).toContain('window.exmToggleTplExtraSettings');
        expect(src).toContain('exmApplyTplExtraSettingsUi');
        expect(src).toContain('tpl-extra-open');
        expect(src).toContain('exmShowScheduleAllClassesMatrix');
        expect(src).toContain("'sch-class-select'");
        expect(src).toContain("prefix: 'sch'");
        expect(src).toContain('removedBooks');
        expect(src).toContain('exmTplMarkBookRemoved');
        expect(src).toContain('window.exmSaveTplSheet');
        expect(src).toContain('sheetName');
    });

    it('HTML includes matrix printable schedule for all classes', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="tpl-class-select"');
        expect(html).toContain('value="__ALL_CLASSES__"');
        expect(html).toContain('تمام درجات');
        expect(html).toContain('id="tpl-all-matrix-wrap"');
        expect(html).toContain('id="tpl-matrix-printable"');
        expect(html).toContain('id="tpl-matrix-table"');
        expect(html).toContain('tpl-exam-matrix');
        expect(html).toContain('id="btn-tpl-extra-settings"');
        expect(html).toContain('id="tpl-matrix-extra-settings"');
        expect(html).toContain('id="tpl-extra-form-fields"');
        expect(html).toContain('اضافی سیٹنگز');
        expect(html).toContain('id="sch-matrix-wrap"');
        expect(html).toContain('id="sch-matrix-table"');
        expect(html).toContain('id="sch-matrix-printable"');
        expect(html).toContain('id="tpl-sheet-name"');
        expect(html).toContain('id="btn-save-tpl-sheet"');
        expect(html).toContain('شیٹ محفوظ کریں');
    });
});
