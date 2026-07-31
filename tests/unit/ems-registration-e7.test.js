import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E7-S1 — Registration Repository', function () {
    it('ems-registration-repository.js has paginated API without full listener', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegRepoEnsureInitial');
        expect(src).toContain('emsRegRepoLoadMore');
        expect(src).toContain('emsRegRepoSearch');
        expect(src).toContain('emsRegRepoGetById');
        expect(src).not.toContain('onSnapshot(function (snapshot)');
        expect(src).toContain('limit(pageSize)');
        expect(src).toContain('startAfter');
    });

    it('admission.js removes full Registrations onSnapshot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).not.toMatch(/collection\('Registrations'\)[\s\S]*onSnapshot/);
        expect(src).toContain('regRepoLoadMore');
        expect(src).toContain('generateAutoIDAsync');
        var boot = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(boot).toContain('emsBootRegistrationModule');
    });

    it('index.html loads repository via post-auth loader; live sync via cloud manifest', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.html).toContain('ems-post-auth-loader.js');
        expect(m.html).not.toContain('ems-registration-repository.js?v=');
        var repoIdx = m.loader.indexOf('ems-registration-repository.js');
        var userIdx = m.loader.indexOf('ems-user-access.js');
        expect(repoIdx).toBeGreaterThan(-1);
        expect(repoIdx).toBeLessThan(userIdx);
        expect(m.cloud).toContain('cloud/ems-registration-live-sync.js');
        expect(m.combined).toContain('ems-lazy-loader.js');
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy).toContain('admission.js');
    });

    it('directive and roadmap docs exist', function () {
        expect(fs.existsSync(path.join(ROOT, 'docs/ENTERPRISE-ARCHITECTURE-DIRECTIVE.md'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'docs/ENTERPRISE-ROADMAP.md'))).toBe(true);
    });

    it('firestore indexes include registration search fields', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8');
        expect(idx).toContain('"fieldPath": "type"');
    });
});
