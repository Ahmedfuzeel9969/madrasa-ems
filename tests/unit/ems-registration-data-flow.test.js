import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Final Registration Integration', function () {
    it('index.html loads repository via post-auth bundle; live sync via cloud manifest', function () {
        var m = readAppScriptManifest(ROOT);
        var loader = m.loader;
        var repoIdx = loader.indexOf('ems-registration-repository.js');
        var userIdx = loader.indexOf('ems-user-access.js');
        expect(repoIdx).toBeGreaterThan(-1);
        expect(repoIdx).toBeLessThan(userIdx);
        expect(m.cloud).toContain('cloud/ems-registration-live-sync.js');
        expect(m.cloud).toContain('cloud/ems-registration-sync.js');
    });

    it('emsUserRepository and user-service emsGetUsers exist', function () {
        var access = fs.readFileSync(path.join(ROOT, 'ems-user-access.js'), 'utf8');
        var service = fs.readFileSync(path.join(ROOT, 'ems-user-service.js'), 'utf8');
        expect(access).toContain('emsUserRepository');
        expect(access).toContain('emsGetUsersByCacheKey');
        expect(service).toContain('global.emsGetUsers = function');
        expect(access).not.toContain("readCacheUsers('ems_users')");
        expect(access).not.toContain("readCacheUsers('ems_students')");
    });

    it('bootstrap defines lite login + module pagination pipeline', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(src).toContain('emsBootRegistrationData');
        expect(src).toContain('emsBootLiteLogin');
        expect(src).toContain('emsBootRegistrationModule');
        expect(src).toContain('emsStartRegistrationSync');
    });

    it('repository has ensureReady and Firestore fallback', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegRepoEnsureReady');
        expect(src).toContain('emsRegRepoIsReady');
        expect(src).toContain('firestore_fallback');
    });

    it('auth unlocks shell immediately with lite login', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('finishMadrasaLogin');
        expect(src).toContain('emsStartSyncEngine');
        expect(src).toContain('skipRegistrationBoot');
        expect(src).toContain('app-shell-unlocked');
    });

    it('lazy loader does not re-load repository at admission', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(src).not.toContain("'ems-registration-repository.js'");
        expect(src).not.toContain("'ems-user-access.js'");
    });

    it('modules use emsGetUsersMerged without legacy localStorage users', function () {
        var files = [
            'attendance.js', 'finance.js', 'ledger.js',
            'dashboard.js', 'curriculum.js', 'exams.js', 'training.js',
            'announcements.js', 'parent-portal.js', 'sys-report-builder.js'
        ];
        files.forEach(function (f) {
            var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            expect(src).toContain('emsGetUsersMerged');
            expect(src).not.toMatch(/JSON\.parse\(localStorage\.getItem\([^)]*users/);
        });
    });

    it('complaints module uses CmpIDB/CmpCloud instead of emsGetUsersMerged', function () {
        var src = fs.readFileSync(path.join(ROOT, 'complaints.js'), 'utf8');
        expect(src).toContain('CmpIDB');
        expect(src).toContain('CmpCloud');
        expect(src).not.toContain('emsGetUsersMerged');
    });

    it('department boot migration for registrations', function () {
        var src = fs.readFileSync(path.join(ROOT, 'department-migration.js'), 'utf8');
        expect(src).toContain('emsDeptMigrationEnsureRegistrations');
    });
});

describe('Registration data flow repair', function () {
    it('emsGetUsersMerged reads repository first via user-service', function () {
        var service = fs.readFileSync(path.join(ROOT, 'ems-user-service.js'), 'utf8');
        var access = fs.readFileSync(path.join(ROOT, 'ems-user-access.js'), 'utf8');
        expect(service).toContain('emsRegRepoGetList');
        expect(service).toContain('emsEnsureUsersReady');
        expect(access).toContain('emsBroadcastUsersChanged');
    });

    it('repository broadcasts user changes', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsBroadcastUsersChanged');
    });
});
