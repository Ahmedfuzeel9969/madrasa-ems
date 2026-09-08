import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Admin Panel people lists SSOT', function () {
    it('getUsers returns SSOT arrays even when empty (no length guard)', function () {
        const src = read('admin-panel.js');
        const slice = src.slice(src.indexOf('function getUsers'), src.indexOf('function apPersistUserEmail'));
        expect(slice).toContain('if (Array.isArray(merged)) return merged');
        expect(slice).toContain('if (Array.isArray(repo)) return repo');
        expect(slice).not.toContain('merged.length');
        expect(slice).not.toContain('repo.length');
    });

    it('initAdminPanel waits for repository and refreshes parents', function () {
        const src = read('admin-panel.js');
        expect(src).toContain('emsEnsureRepositoryReady');
        expect(src).toContain('apRefreshPeopleLists');
        expect(src).toContain("ems:users-changed");
        expect(src).toContain("ems:repository-ready");
        expect(src).toContain('emsRegRepoUpsert');
    });

    it('navigation and lazy-load treat admin-panel as registration-dependent', function () {
        const auth = read('auth.js');
        const lazy = read('ems-lazy-loader.js');
        expect(auth).toMatch(/REGISTRATION_MODULES[\s\S]{0,300}'admin-panel': 1/);
        expect(lazy).toMatch(/userMods[\s\S]{0,300}'admin-panel': 1/);
    });
});
