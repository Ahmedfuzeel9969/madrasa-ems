import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Timetable browser → Firebase push removal', function () {
    it('removes the browser-to-cloud button from the timetable toolbar', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).not.toContain('id="btn-att-tt-push-browser"');
        expect(html).not.toContain('attPushBrowserTimetableToFirebase()');
        expect(html).not.toContain('براؤزر سے Firebase');
    });

    it('removes the browser-push runtime and exported globals', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).not.toContain('function attPushBrowserTimetableToFirebase');
        expect(att).not.toContain('window.attPushBrowserTimetableToFirebase');
        expect(att).not.toContain('function attUpdateTimetablePushBtnState');
        expect(att).not.toContain('btn-att-tt-push-browser');
        expect(att).not.toContain("'browser_push'");
    });

    it('keeps ordinary timetable edit/save and verified cloud restore paths', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('attSavePeriodFromModal');
        expect(att).toContain('attPersistConfigBlob(ATT_PERIODS_KEY');
        expect(att).toContain('window.emsPullAttendanceTimetableFromCloud');
    });
});
