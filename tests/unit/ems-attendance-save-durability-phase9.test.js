import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 9 — attendance save durability', function () {
    it('propagates a failed tenant-scoped local write to the caller', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attPersistSheetLocal');
        var end = src.indexOf('\nvar _attCloudPersistTimer', start);
        var block = src.slice(start, end);
        expect(block).toContain('return window.emsOfflineWriteLocalSync(localKey, data) !== false');
    });

    it('queues the attendance mutation without a delayed debounce window', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attScheduleCloudPersist');
        var end = src.indexOf('\nfunction attRunPendingCloudPersist', start);
        var block = src.slice(start, end);
        expect(block).toContain('var delay = 0');
        expect(block).toContain("window.addEventListener('pagehide', attFlushPendingCloudPersist)");
    });

    it('binds the queued attendance mutation and cloud availability check to the verified tenant', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var off = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(att).toContain('tenantId: getAttendanceTenantId()');
        expect(off).toContain('opts.attendance\n            ? getVerifiedAttendanceTenantId()');
        expect(off).toContain('canCloudWrite({ attendance: isAttQueue })');
        expect(off).toContain('var tenantId = opts.tenantId || getVerifiedAttendanceTenantId()');
    });

    it('gives rapid consecutive attendance edits strictly increasing timestamps', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('function attMarkLocalWrite');
        var end = src.indexOf('\n/** Ignore stale Firestore snapshots', start);
        var block = src.slice(start, end);
        expect(block).toContain('Math.max(Date.now(), Number(_attLastLocalWriteTs || 0) + 1)');
    });
});
