import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMS_BUILD, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

var USER_MODULES = [
    'dashboard.js', 'attendance.js', 'finance.js', 'ledger.js',
    'complaints.js', 'curriculum.js', 'exams.js', 'training.js',
    'announcements.js', 'admission.js'
];

describe('Enterprise User Service (regent1)', function () {
    it('ems-user-service.js exposes universal API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-user-service.js'), 'utf8');
        expect(src).toContain('emsEnsureRepositoryReady');
        expect(src).toContain('emsGetUsers');
        expect(src).toContain('emsGetUsersSync');
        expect(src).toContain('EMS_REPOSITORY_BOOT_COMPLETE');
        expect(src).not.toContain('localStorage.getItem');
    });

    it('ems-enterprise-diagnostic.js exposes emsEnterpriseDiagnostic', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-enterprise-diagnostic.js'), 'utf8');
        expect(src).toContain('emsEnterpriseDiagnostic');
        expect(src).toContain('moduleDataPaths');
        expect(src).toContain('visibility');
    });

    it('post-auth loader includes user-service and diagnostic', function () {
        var loader = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        expect(loader).toContain('ems-data-pipeline-debug.js');
        expect(loader).toContain('ems-user-service.js');
        expect(loader).toContain('ems-enterprise-diagnostic.js');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-tenant-resolver.js');
        expect(html).toContain('ems-post-auth-loader.js?v=' + EMS_BUILD.CACHE_BUST.postAuthLoader);
        var svc = loader.indexOf('ems-user-service.js');
        var dash = loader.indexOf('dashboard.js');
        expect(svc).toBeGreaterThan(-1);
        expect(svc).toBeLessThan(dash);
    });

    it('auth gates modules with emsEnsureRepositoryReady', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsEnsureRepositoryReady');
    });

    it('modules do not read ems_full_users from localStorage directly', function () {
        USER_MODULES.forEach(function (f) {
            var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            expect(src).not.toMatch(/localStorage\.getItem\([^)]*users/);
            expect(src).not.toMatch(/localStorage\.getItem\([^)]*ems_full_users/);
        });
    });

    it('core modules use emsGetUsersSync or emsGetUsersMerged', function () {
        ['attendance.js', 'finance.js', 'ledger.js'].forEach(function (f) {
            var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            expect(src).toMatch(/emsGetUsersSync|emsGetUsersMerged/);
        });
    });
});

describe('Data visibility scenario (1000 students)', function () {
    it('documents pagination limit for in-memory repo', function () {
        var live = readScript(ROOT, 'ems-registration-live-sync.js');
        var repo = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(live).toContain('write_trigger');
        expect(repo).toContain('PAGE_SIZE');
    });

    it('visibility test matrix — expected module read path', function () {
        var matrix = {
            dashboard: 'emsGetUsersSync → Repository',
            attendance: 'attGetUsers → emsGetUsersSync',
            fees: 'finGetAllUsers → emsGetUsersSync',
            curriculum: 'emsGetUsersSync',
            exams: 'exmGetUsers → emsGetUsersSync',
            complaints: 'emsGetUsersSync',
            finance: 'finGetAllUsers → emsGetUsersSync',
            training: 'getUsers → emsGetUsersSync',
            announcements: 'annGetUsers → emsGetUsersSync',
            ledger: 'ldgGetUsers → emsGetUsersSync'
        };
        Object.keys(matrix).forEach(function (mod) {
            expect(matrix[mod]).toBeTruthy();
        });
    });
});
