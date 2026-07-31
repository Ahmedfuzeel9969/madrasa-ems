import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

var root = join(process.cwd());

describe('Phase B0 — Attendance local-first', function () {
    it('attendance.js reads IDB before cloud', function () {
        var src = readFileSync(join(root, 'attendance.js'), 'utf8');
        expect(src).toContain('emsOfflineGetCachedAttendance');
        expect(src).toContain('attLoadRegisterLocalFirst');
        expect(src).toContain('attBackgroundReconcile');
        expect(src).not.toMatch(/btn-load-smart-register[\s\S]*\.get\(\)\.then\(\(doc\)/);
    });

    it('attendance caches on snapshot and bulk uses local sheet fetch', function () {
        var src = readFileSync(join(root, 'attendance.js'), 'utf8');
        expect(src).toContain('emsOfflineCacheAttendanceFromRemote');
        expect(src).toContain('attFetchAttendanceSheet');
        expect(src).toContain('emsFetchStudentsLocalFirst');
    });

    it('ems-offline-write exposes cache-from-remote without queue', function () {
        var src = readFileSync(join(root, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('emsOfflineCacheAttendanceFromRemote');
        expect(src).toContain('does NOT enqueue cloud write');
    });

    it('ems-user-access has local-first roster helpers', function () {
        var src = readFileSync(join(root, 'ems-user-access.js'), 'utf8');
        expect(src).toContain('emsFetchStudentsLocalFirst');
        expect(src).toContain('emsFetchStaffLocalFirst');
        expect(src).toContain('emsFilterUsersLocal');
        expect(src).toContain('filterActiveUsers');
    });

    it('attendance.js filters active registration statuses for roster', function () {
        var src = readFileSync(join(root, 'attendance.js'), 'utf8');
        expect(src).toContain('attFilterEligibleUsers');
        expect(src).toContain('isActiveRegistrationStatus');
        expect(src).toContain('emsEnsureRepositoryReady');
    });
});
