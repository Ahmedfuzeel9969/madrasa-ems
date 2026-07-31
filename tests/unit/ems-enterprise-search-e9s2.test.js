import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { EMS_BUILD, readAppScriptManifest, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E9-S2 — Registration search layer', function () {
    it('tenant-registration-search.js exports callable and index sync', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-registration-search.js'), 'utf8');
        expect(src).toContain('searchTenantRegistrations');
        expect(src).toContain('RegistrationSearchIndex');
        expect(src).toContain('typesenseSearch');
        expect(src).toContain('orderBy(\'cnic\')');
    });

    it('ems-enterprise-search.js wraps callable with repo fallback and router', function () {
        var src = readScript(ROOT, 'ems-enterprise-search.js');
        expect(src).toContain('searchTenantRegistrations');
        expect(src).toContain('emsRegRepoSetSearchResults');
        expect(src).toContain('emsRegRepoSearch');
        expect(src).toContain('emsRegSearchRouter');
        expect(src).toContain('emsEnterpriseSearchGetSource');
    });

    it('admission regListSearch uses emsRegSearchRouter', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsRegSearchRouter');
        expect(src).toContain('renderRegTableFromSearchOverlay');
    });

    it('lazy loader loads enterprise search before admission', function () {
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        var cloud = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-cloud-manifest.js'), 'utf8');
        expect(cloud).toContain('cloud/ems-enterprise-search.js');
        expect(lazy).toContain('emsCloudLazyScripts');
        expect(lazy).toContain('cloudExtras');
        expect(lazy).toContain('admission.js');
        expect(lazy).toContain(EMS_BUILD.CACHE_BUST.syncHardening);
        var m = readAppScriptManifest(ROOT);
        expect(m.loader).toContain('ems-registration-repository.js');
    });

    it('repository exposes emsRegRepoSetSearchResults', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegRepoSetSearchResults');
    });
});
