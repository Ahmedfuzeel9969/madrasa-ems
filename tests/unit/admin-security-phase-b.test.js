import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

function extractMatchBlock(collection) {
    var re = new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{[\\s\\S]*?\\n      \\}');
    var m = RULES.match(re);
    if (!m) throw new Error('Block not found: ' + collection);
    return m[0];
}

describe('Admin Security Phase B — tenant isolation, strict RBAC & read scoping', function () {
    it('TI-01: collection-group Staff_Links and Parent_Links reads removed', function () {
        expect(RULES).not.toMatch(/match \/\{path=\*\*\}\/Staff_Links/);
        expect(RULES).not.toMatch(/match \/\{path=\*\*\}\/Parent_Links/);
        expect(RULES).toContain('resolveTenantLink');
    });

    it('TI-01: tenant-scoped Staff_Links read requires owner or self staff link', function () {
        var block = extractMatchBlock('Staff_Links');
        var readLine = (block.match(/allow read:[^\n]+/) || [''])[0];
        expect(block).toContain('isStaffOf(madrasaId) && request.auth.uid == linkId');
        expect(readLine).not.toContain('resource.data.email');
    });

    it('TI-01: tenant-scoped Parent_Links read requires owner or self parent link', function () {
        var block = extractMatchBlock('Parent_Links');
        var readLine = (block.match(/allow read:[^\n]+/) || [''])[0];
        expect(block).toContain('isParentOf(madrasaId) && request.auth.uid == linkId');
        expect(readLine).not.toContain('resource.data.email');
    });

    it('TI-01: tenant-context resolves links via server callable, not collectionGroup', function () {
        var src = fs.readFileSync(path.join(ROOT, 'tenant-context.js'), 'utf8');
        expect(src).toContain("emsCallFunction('resolveTenantLink'");
        expect(src).not.toContain('collectionGroup');
    });

    it('TI-01: resolveTenantLink exported from Cloud Functions', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        var lib = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'tenant-links.js'), 'utf8');
        expect(idx).toContain('resolveTenantLink');
        expect(lib).toContain('const resolveTenantLink = functions.https.onCall');
        expect(lib).toContain('collectionGroup(collectionName)');
    });

    it('TH-01 / PE-01: staffLegacyWrite removed; create/edit require explicit actions', function () {
        expect(RULES).not.toContain('staffLegacyWrite');
        expect(RULES).toMatch(/function canStaffCreate\([\s\S]*?staffHasAction\(madrasaId, moduleId, 'create'\)/);
        expect(RULES).not.toMatch(/function canStaffCreate\([\s\S]{0,200}staffHasAction\(madrasaId, moduleId, 'edit'\)/);
        expect(RULES).toMatch(/function canStaffUpdate\([\s\S]*?staffHasAction\(madrasaId, moduleId, 'edit'\)/);
    });

    it('PE-04: Registrations read scoped to admission view permission', function () {
        var block = extractMatchBlock('Registrations');
        expect(block).toContain("canStaffReadModule(madrasaId, 'admission')");
        expect(block).not.toContain('canReadTenantStaff(madrasaId)');
    });

    it('PE-04: FeeCollections read scoped to finance view permission', function () {
        var block = extractMatchBlock('FeeCollections');
        expect(block).toContain("canStaffReadModule(madrasaId, 'finance')");
        expect(block).not.toContain('canReadTenantStaff(madrasaId)');
    });

    it('canStaffReadModule uses staffHasAction view gate', function () {
        expect(RULES).toMatch(/function canStaffReadModule\([\s\S]*?staffHasAction\(madrasaId, moduleId, 'view'\)/);
    });
});
