import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 4 P3 — service worker update handling', function () {
    it('ems-sw-update.js defines build tag and controllerchange bind', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-sw-update.js'), 'utf8');
        expect(src).toContain('EMS_BUILD_TAG');
        expect(src).toContain('emsSwUpdateBind');
        expect(src).toContain('fetchWorkerBuildTag');
        expect(src).toContain('controllerchange');
        expect(src).toContain('emsSwUpdateHandleControllerChange');
    });

    it('service-worker.js exposes build tag and message handler', function () {
        var src = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
        expect(src).toContain('EMS_SW_BUILD_TAG');
        expect(src).toContain('ems-get-build-tag');
        expect(src).not.toMatch(/controllerchange/);
    });

    it('core.js wires emsSwUpdateBind after registration', function () {
        var src = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(src).toMatch(/emsRegisterServiceWorker[\s\S]*emsSwUpdateBind/);
    });

    it('page and service worker build tags match', function () {
        var app = fs.readFileSync(path.join(ROOT, 'ems-sw-update.js'), 'utf8');
        var sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
        var appTag = app.match(/EMS_BUILD_TAG\s*=\s*'([^']+)'/);
        var swTag = sw.match(/EMS_SW_BUILD_TAG\s*=\s*'([^']+)'/);
        expect(appTag && appTag[1]).toBeTruthy();
        expect(swTag && swTag[1]).toBe(appTag[1]);
    });

    it('index.html loads ems-sw-update.js before core.js', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var app = fs.readFileSync(path.join(ROOT, 'ems-sw-update.js'), 'utf8');
        var appTag = app.match(/EMS_BUILD_TAG\s*=\s*'([^']+)'/);
        var updIdx = html.indexOf('ems-sw-update.js');
        var coreIdx = html.indexOf('core.js?v=' + (appTag && appTag[1]));
        expect(updIdx).toBeGreaterThan(-1);
        expect(coreIdx).toBeGreaterThan(updIdx);
    });
});
