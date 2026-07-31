import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise Recovery (regent2)', function () {
    it('repository not destroyed on module pause', function () {
        var sync = readScript(ROOT, 'ems-registration-sync.js');
        var boot = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(sync).not.toContain('emsRegRepoStop');
        expect(sync).toContain('emsPauseRegistrationLiveSync');
        expect(boot).toContain('emsDestroyRegistrationSession');
    });

    it('admission uses RegistrationModule.init not DOMContentLoaded', function () {
        var adm = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(adm).toContain('RegistrationModule');
        expect(adm).toContain('init: function');
        expect(adm).not.toMatch(/document\.addEventListener\(['"]DOMContentLoaded['"]/);
    });

    it('tenant resolver blocks blind auth uid fallback', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-resolver.js'), 'utf8');
        expect(src).toContain('emsRequireTenantId');
        expect(src).toContain('TENANT_RESOLUTION_PENDING');
    });

    it('repository bulk server hydrate exists (regent3)', function () {
        var repo = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(repo).toContain('emsRegRepoBulkHydrate');
    });

    it('write-trigger sync uses RegistrationMeta listener (Phase A4)', function () {
        var live = readScript(ROOT, 'ems-registration-live-sync.js');
        expect(live).toContain('emsStartRegistrationWriteSync');
        expect(live).toContain('write_trigger');
        expect(live).not.toContain('snap.docs.forEach');
    });

    it('auth does not pause-destroy repo on navigation', function () {
        var auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(auth).not.toMatch(/emsPauseRegistrationSync/);
        expect(auth).toContain('RegistrationModule.init');
    });
});
