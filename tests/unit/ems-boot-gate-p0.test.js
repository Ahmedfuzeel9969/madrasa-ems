import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMS_BUILD } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P0 boot gate — login before enterprise boot (regent7)', function () {
    it('index.html loads boot-gate and post-auth loader (not repository at boot)', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var coreIdx = html.search(/core\.js\?v=/);
        var gateIdx = html.indexOf('ems-boot-gate.js?v=');
        var loaderIdx = html.indexOf('ems-post-auth-loader.js?v=' + EMS_BUILD.CACHE_BUST.postAuthLoader);
        expect(coreIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeGreaterThan(coreIdx);
        expect(loaderIdx).toBeGreaterThan(gateIdx);
        expect(html).not.toContain('ems-registration-repository.js?v=');
    });

    it('boot gate blocks enterprise boot pre-auth', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-boot-gate.js'), 'utf8');
        expect(src).toContain('emsCanRunEnterpriseBoot');
        expect(src).toContain('emsEnsureLoginShellVisible');
        expect(src).toContain('EMS_ENTERPRISE_BOOT_ENABLED');
    });

    it('dashboard does not boot repository before authentication', function () {
        var dash = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(dash).toContain('emsCanRunEnterpriseBoot');
        expect(dash).toContain('if (!bootRes || !bootRes.bootComplete) return');
    });

    it('core.js does not call updateMasterDashboard pre-auth', function () {
        var core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(core).toContain('emsCanRunEnterpriseBoot');
        expect(core).not.toMatch(/updateMasterDashboard\(\);\s*\n\s*document\.querySelectorAll/);
    });

    it('registration bootstrap skips boot pre-auth', function () {
        var boot = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(boot).toContain('emsCanRunEnterpriseBoot');
        expect(boot).toContain("source: 'pre_auth'");
    });
});
