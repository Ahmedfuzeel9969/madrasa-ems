import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance summary scale and consistency', function () {
    it('scans the current month once per trigger instead of twice', function () {
        const src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-dashboard-stats.js'), 'utf8');
        const start = src.indexOf('async function refreshTodayAttendance');
        const end = src.indexOf('\nasync function recomputeTenantStats', start);
        const block = src.slice(start, end);
        expect(block).toContain('recomputeAttendanceSummaryForMonth(db, tenantId, month)');
        expect(block).not.toContain('.where(');
        expect(block).not.toContain('.get()');
        expect(block).not.toMatch(/recomputeAttendanceSummaryForMonth[\s\S]*recomputeAttendanceSummaryForMonth/);
    });

    it('reuses the already-read attendance documents during a full stats rebuild', function () {
        const src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-dashboard-stats.js'), 'utf8');
        expect(src).toContain('recomputeAttendanceSummaryForMonth(db, tenantId, month, attSourceDocs)');
        expect(src).toContain('suppliedSourceDocs || null');
        expect(src).toContain('buildFinalAttendanceState');
    });

    it('uses Pakistan calendar boundaries for attendance triggers', function () {
        const src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-dashboard-stats.js'), 'utf8');
        const handler = src.slice(src.indexOf('function makeAttendanceHandler'), src.indexOf('function makeAnnouncementHandler'));
        expect(handler).toContain('pakistanDateStr().substring(0, 7)');
        expect(handler).not.toContain('toISOString');
    });

    it('parent attendance reads only the requested month prefix', function () {
        const src = fs.readFileSync(path.join(ROOT, 'functions/lib/parent-data.js'), 'utf8');
        const start = src.indexOf('async function fetchAttendance');
        const end = src.indexOf('\nasync function fetchExamResults', start);
        const block = src.slice(start, end);
        expect(block).toContain("const prefix = 'att_rec_' + mk + '_'");
        expect(block).toContain('admin.firestore.FieldPath.documentId()');
        expect(block).toContain("prefix + '\\uf8ff'");
        expect(block).not.toContain("collection('Attendance').get()");
    });
});
