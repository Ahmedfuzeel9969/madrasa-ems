import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 2 Sprint 1 — performance modules', function () {
    it('ems-data-cache.js exposes cache API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-data-cache.js'), 'utf8');
        expect(src).toContain('emsCacheGet');
        expect(src).toContain('emsCacheInvalidate');
        expect(src).toContain('emsCacheSet');
    });

    it('ems-photo-storage.js exposes Storage upload helpers', function () {
        var src = readScript(ROOT, 'ems-photo-storage.js');
        expect(src).toContain('emsGetUserPhotoSrc');
        expect(src).toContain('emsUploadRegistrationPhoto');
        expect(src).toContain('emsLeanUserForLocalStorage');
        expect(src).toContain('emsEnsurePhotoStorageReady');
        expect(src).toContain('emsPurgeLocalPhotoBase64');
        expect(src).toContain('registrations/');
    });

    it('photo-migration.js exposes paginated migration API', function () {
        var src = readScript(ROOT, 'photo-migration.js');
        expect(src).toContain('emsPhotoMigrationScan');
        expect(src).toContain('emsPhotoMigrationRun');
        expect(src).toContain('emsPhotoMigrationPurgeLocalFromUI');
        expect(src).toContain('orderBy(firebase.firestore.FieldPath.documentId())');
    });

    it('admission.js uses photo upload and lean localStorage sync', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsUploadRegistrationPhoto');
        expect(src).toContain('emsLeanUserForLocalStorage');
        expect(src).toContain('emsPrepareFirestoreUserDoc');
        expect(src).toContain('emsCacheGet');
    });

    it('dashboard.js uses cache and Map-based arrears', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsCacheGet');
        expect(src).toContain('paidByStudent');
    });

    it('app manifest loads new performance scripts post-auth', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.combined).toContain('ems-data-cache.js');
        expect(m.combined).toContain('ems-photo-storage.js');
        expect(m.combined).toContain('photo-migration.js');
        expect(m.html).toContain('sys-win-photo-migration');
    });

    it('storage.rules defines registrations path', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
        expect(rules).toContain('registrations/{tenantId}');
    });

    it('firebase.json includes storage rules', function () {
        var json = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
        expect(json.storage).toBeDefined();
        expect(json.storage.rules).toBe('storage.rules');
    });
});
