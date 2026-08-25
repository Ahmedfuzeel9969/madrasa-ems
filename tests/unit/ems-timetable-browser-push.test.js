import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Timetable browser → Firebase push', function () {
    it('adds push button in timetable toolbar', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="btn-att-tt-push-browser"');
        expect(html).toContain('attPushBrowserTimetableToFirebase()');
        expect(html).toContain('براؤزر سے Firebase');
        expect(html.indexOf('att-timetable')).toBeLessThan(html.indexOf('btn-att-tt-push-browser'));
    });

    it('implements attPushBrowserTimetableToFirebase with tenant-safe persist + cloud push', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('function attPushBrowserTimetableToFirebase');
        expect(att).toContain('window.attPushBrowserTimetableToFirebase = attPushBrowserTimetableToFirebase');
        expect(att).toContain('function attUpdateTimetablePushBtnState');
        expect(att).toContain('attRecoverLegacyTimetablePeriods(tenantId)');
        expect(att).toContain('attPersistConfigBlob(ATT_PERIODS_KEY, list)');
        expect(att).toContain('attRememberTrustedTimetable(tenantId, list, \'browser_push\')');
        expect(att).toContain('emsCloudPushNow()');
        expect(att).toContain('ATT_PERIODS_CANONICAL_CLOUD_DOC');
    });

    it('updates push button state when timetable renders', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('attUpdateTimetablePushBtnState()');
        expect(att).toMatch(/window\.renderTimetable[\s\S]*attUpdateTimetablePushBtnState/);
    });
});
