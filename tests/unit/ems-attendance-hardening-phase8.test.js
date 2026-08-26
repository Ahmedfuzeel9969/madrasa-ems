import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('attendance hardening phase 8', function () {
    it('uses edit time rather than flush time for attendance conflict checks', function () {
        const src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('row.meta && row.meta.mutationAt');
        expect(src).toMatch(/flushAttendancePatchRow[\s\S]{0,2200}mutationAt[\s\S]{0,800}checkRemoteVersion/);
        expect(src).toMatch(/stampCloudVersion[\s\S]{0,500}out\.timestamp/);
    });

    it('coalesces full and patch queue identities per attendance document', function () {
        const src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain("isAttendanceQueueType(type) ? 'attendance_doc'");
        expect(src).toContain('function coalesceAttendanceRows');
        expect(src).toContain('function applyAttendancePatchToDocument');
    });

    it('uses one canonical event store and no longer dual-writes att_evt documents', function () {
        const src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        const save = src.slice(src.indexOf('window.attSaveEventAttendance'), src.indexOf('/** Remove event'));
        const remove = src.slice(src.indexOf('window.attDeleteEventAttendance'), src.indexOf('\nfunction evtGetUsers'));
        expect(save).toContain('attEnqueueEventsDbSync(events)');
        expect(save).not.toContain('emsOfflinePersistAttendance');
        expect(remove).not.toContain('emsOfflinePersistAttendance');
    });

    it('enforces attendance document shape and blocks ordinary staff self-edit at rules layer', function () {
        const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('function hasValidAttendanceShape');
        expect(rules).toContain('function attendanceUpdateDoesNotEditSelf');
        expect(rules).toMatch(/match \/Attendance\/\{docId\}[\s\S]{0,1000}isValidAttendanceDocId/);
    });

    it('treats remarks-only and late-only attendance as meaningful', function () {
        const src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        const block = src.slice(src.indexOf('function attHasMeaningfulAttendanceData'), src.indexOf('\nfunction attReconcileAttendanceRecord'));
        expect(block).toContain('sheet.remarks');
        expect(block).toContain('sheet.late');
    });
});
