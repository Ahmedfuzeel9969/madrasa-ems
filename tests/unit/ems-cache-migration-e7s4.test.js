import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E7-S4 — Remaining module cache migration', function () {
    it('dashboard-pro.js uses repo users for reports when DashboardStats exist', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('emsGetUsersMerged');
        expect(src).toContain('emsRegRepoGetList');
        expect(src).toContain('readUsersAsync');
        expect(src).not.toMatch(/stats\.counts\) return \[\]/);
        expect(src).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_full_users'\)/);
    });

    it('sys-report-builder.js uses cache layer for all report sources', function () {
        var src = fs.readFileSync(path.join(ROOT, 'sys-report-builder.js'), 'utf8');
        expect(src).toContain('loadRegistrationRows');
        expect(src).toContain('emsGetUsersMerged');
        expect(src).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_full_users'\)/);
        expect(src).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_fee_collections'\)/);
        expect(src).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_full_ledger'\)/);
    });

    it('ems-import-export.js loadUsers uses merged cache', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(src).toContain('emsGetUsersMerged');
        expect(src).toContain('emsRegRepoGetRejectedList');
    });

    it('post-auth bundle includes migrated scripts', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.combined).toContain('dashboard-pro.js');
        expect(m.combined).toContain('sys-report-builder.js');
    });
});
