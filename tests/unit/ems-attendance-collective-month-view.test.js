import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function loadPureExports() {
    const sandbox = {
        window: null,
        console,
        Date,
        Promise,
        setTimeout,
        clearTimeout,
        attBrandHeaderHTML: () => '<div>مدرسہ</div>',
        attSignFooterHTML: () => '<div>دستخط</div>',
        attStatusKind: (value) => value === 'ح' ? 'P' : value === 'غ' ? 'A' : value === 'ر' ? 'L' : ''
    };
    sandbox.window = sandbox;
    vm.runInNewContext(read('att-collective-view.js'), sandbox);
    return sandbox;
}

describe('Collective monthly read-only attendance view', () => {
    it('provides a distinct entry/view switch and month filters', () => {
        const html = read('index.html');
        expect(html).toContain('id="btn-att-col-mode-entry"');
        expect(html).toContain('id="btn-att-col-mode-view"');
        expect(html).toContain('id="att-col-entry-mode"');
        expect(html).toContain('id="att-col-view-mode"');
        expect(html).toContain('id="att-col-view-month"');
        expect(html).toContain('یہ ویو اسی مرکزی ریکارڈ کو دکھاتا ہے جس میں اجتماعی حاضری محفوظ ہوتی ہے');
    });

    it('supports students, teachers, staff, all people, or selected people', () => {
        const html = read('index.html');
        expect(html).toContain('name="att_col_view_role" value="students"');
        expect(html).toContain('name="att_col_view_role" value="teachers"');
        expect(html).toContain('name="att_col_view_role" value="staff"');
        expect(html).toContain('name="att_col_view_people" value="all"');
        expect(html).toContain('name="att_col_view_people" value="selected"');
        expect(html).toContain('id="att-col-view-people-list"');
        expect(html).toContain('id="att-col-view-search"');
        expect(html).toContain('id="btn-att-col-view-select-all"');
    });

    it('offers all classes, one class, and every timetable period of that class', () => {
        const html = read('index.html');
        const src = read('att-collective-view.js');
        expect(html).toContain('id="att-col-view-register-scope"');
        expect(html).toContain('id="att-col-view-class"');
        expect(html).toContain('id="att-col-view-period"');
        expect(html).toContain('تمام گھنٹے / روزانہ خلاصہ');
        expect(src).toContain('attListAttendanceClasses');
        expect(src).toContain('attReadAllTimetablePeriodsRaw');
        expect(src).toContain("String(period.className || '').trim() !== classId");
        expect(src).toContain('محفوظ پرانا گھنٹہ');
    });

    it('reads an exact hour from collective periodRecords instead of the daily rollup', () => {
        const sandbox = loadPureExports();
        const sheet = {
            records: { S1: { 4: 'ح' } },
            periodRecords: { S1: { 4: { p1: 'غ' } } }
        };
        const mark = sandbox.attCollectiveViewRawDayStatus(
            { uid: 'S1', role: 'students', className: 'درجہ اول' },
            sheet,
            '2026-09',
            4,
            { P: 'ح', A: 'غ', L: 'ر' },
            { classId: 'درجہ اول', periodId: 'p1' }
        );
        expect(mark).toBe('غ');
    });

    it('rolls a class-specific teacher register from only that class periods', () => {
        const sandbox = loadPureExports();
        sandbox.attTeacherPeriodsForRegisterDay = () => [
            { id: 'p1', className: 'درجہ اول' },
            { id: 'p2', className: 'درجہ دوم' }
        ];
        sandbox.attRollupPeriodDayStatus = (map, symbols, ids) => ids.map((id) => map[id]).join('|');
        const sheet = {
            records: { T1: { 4: 'ح' } },
            periodRecords: { T1: { 4: { p1: 'غ', p2: 'ح' } } }
        };
        const mark = sandbox.attCollectiveViewRawDayStatus(
            { uid: 'T1', role: 'teachers', name: 'استاد اول' },
            sheet,
            '2026-09',
            4,
            { P: 'ح', A: 'غ', L: 'ر' },
            { classId: 'درجہ اول', periodId: 'all' }
        );
        expect(mark).toBe('غ');
    });

    it('can show all teachers or only teachers linked to one class/period', () => {
        const sandbox = loadPureExports();
        sandbox.attGetUserId = (user) => user.id;
        sandbox.attReadAllTimetablePeriodsRaw = () => [
            { id: 'p1', className: 'درجہ اول', teacherId: 'T1' },
            { id: 'p2', className: 'درجہ دوم', teacherId: 'T2' }
        ];
        sandbox.attPeriodTeacherIdMatches = (period, uid) => period.teacherId === uid;
        const teachers = [{ id: 'T1' }, { id: 'T2' }];
        expect(sandbox.attCollectiveViewFilterUsersForScope(
            teachers,
            'teachers',
            { classId: '', periodId: 'all' }
        )).toHaveLength(2);
        expect(sandbox.attCollectiveViewFilterUsersForScope(
            teachers,
            'teachers',
            { classId: 'درجہ اول', periodId: 'all' }
        ).map((row) => row.id)).toEqual(['T1']);
        expect(sandbox.attCollectiveViewFilterUsersForScope(
            teachers,
            'teachers',
            { classId: 'درجہ دوم', periodId: 'p2' }
        ).map((row) => row.id)).toEqual(['T2']);
    });

    it('loads after the existing collective editor and is network-first in the service worker', () => {
        const lazy = read('ems-lazy-loader.js');
        const sw = read('service-worker.js');
        expect(lazy).toMatch(/'att-collective\.js',\s*'att-collective-view\.js'/);
        expect(sw).toContain("url.pathname.indexOf('att-collective-view.js')");
        expect(fs.existsSync(path.join(ROOT, 'att-collective-view.js'))).toBe(true);
    });

    it('is read-only: uses canonical readers and contains no attendance/storage writer', () => {
        const src = read('att-collective-view.js');
        expect(src).toContain('attResolveTargetUsers');
        expect(src).toContain('attLoadCanonicalClassSheet');
        expect(src).toContain('attLoadStaffTypeSheet');
        expect(src).toContain('attRollupPeriodDayStatus');
        expect(src).not.toContain('attPersistSheetPayload');
        expect(src).not.toContain('attWritePeriodOnSheetData');
        expect(src).not.toContain('attWriteDayMarkOnSheetData');
        expect(src).not.toContain('attClearDayOnSheetData');
        expect(src).not.toContain('localStorage.setItem');
        expect(src).not.toContain('emsOfflineWriteLocal');
        expect(src).not.toContain('.collection(');
        expect(src).not.toContain('.set(');
        expect(src).not.toContain('.update(');
        expect(src).not.toContain('.delete(');
    });

    it('uses daily canonical records first so dashboard, report, and month view stay aligned', () => {
        const sandbox = loadPureExports();
        const sheet = {
            records: { T1: { 4: 'ح' } },
            periodRecords: { T1: { 4: { p1: 'غ' } } }
        };
        expect(sandbox.attCollectiveViewRawDayStatus(
            { uid: 'T1', role: 'teachers', name: 'استاد اول' },
            sheet,
            '2026-09',
            4,
            { P: 'ح', A: 'غ', L: 'ر' },
            { classId: '', periodId: 'all' }
        )).toBe('ح');
    });

    it('calculates Gregorian month length including leap years', () => {
        const sandbox = loadPureExports();
        expect(sandbox.attCollectiveViewDaysInMonth('2026-01')).toBe(31);
        expect(sandbox.attCollectiveViewDaysInMonth('2026-02')).toBe(28);
        expect(sandbox.attCollectiveViewDaysInMonth('2028-02')).toBe(29);
        expect(sandbox.attCollectiveViewDaysInMonth('2026-04')).toBe(30);
        expect(sandbox.attCollectiveViewDaysInMonth('bad')).toBe(0);
    });

    it('uses the same present/absent/leave colors in screen and export output', () => {
        const css = read('style.css');
        const src = read('att-collective-view.js');
        expect(css).toContain('td.att-month-p');
        expect(css).toContain('var(--att-present-soft)');
        expect(css).toContain('td.att-month-a');
        expect(css).toContain('var(--att-absent-soft)');
        expect(css).toContain('td.att-month-l');
        expect(css).toContain('var(--att-leave-soft)');
        expect(src).toContain("return 'att-month-p'");
        expect(src).toContain("return 'att-month-a'");
        expect(src).toContain("return 'att-month-l'");
        expect(src).toContain('print-color-adjust:exact');
    });

    it('builds repeated monthly pages with page numbers for large rosters', () => {
        const sandbox = loadPureExports();
        const rows = Array.from({ length: 21 }, (_, index) => ({
            role: 'students',
            uid: 'S' + index,
            name: 'طالب علم ' + index,
            className: 'درجہ اول',
            department: '',
            marks: [{ kind: 'P', text: 'ح', holiday: '' }],
            totals: { P: 1, A: 0, L: 0 }
        }));
        const output = sandbox.attCollectiveViewBuildPages({
            month: '2026-09',
            dayCount: 1,
            roles: ['students'],
            rows
        });
        expect((output.match(/att-col-month-export-page/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(output).toContain('1 / 2');
        expect(output).toContain('2 / 2');
        expect(output).toContain('ستمبر 2026');
        expect(output).toContain('دستخط');
    });

    it('offers A3 landscape print and multi-page jsPDF download', () => {
        const html = read('index.html');
        const src = read('att-collective-view.js');
        expect(html).toContain('id="btn-att-col-view-print"');
        expect(html).toContain('id="btn-att-col-view-pdf"');
        expect(src).toContain('@page{size:A3 landscape');
        expect(src).toContain('global.printDiv(host.id)');
        expect(src).toContain('global.emsLoadPdfLibs()');
        expect(src).toContain("orientation: 'landscape'");
        expect(src).toContain("format: 'a3'");
        expect(src).toContain('global.html2canvas(page');
        expect(src).toContain("pdf.addPage('a3', 'landscape')");
        expect(src).toContain("pdf.save('collective-attendance-' + state.month + '.pdf')");
    });

    it('guards asynchronous roster/sheet results against tenant changes', () => {
        const src = read('att-collective-view.js');
        expect(src).toContain('function tenantContextMatches');
        expect(src).toContain('requestId !== _viewRequest');
        expect(src).toContain("global.addEventListener('ems:tenant-changed'");
        expect(src).toContain('مدرسہ تبدیل ہو چکا ہے؛ ماہانہ حاضری دوبارہ لوڈ کریں');
    });
});
