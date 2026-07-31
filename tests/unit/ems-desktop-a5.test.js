import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase A5 — desktop local dist bundle', function () {
    it('desktop main.js serves local dist via 127.0.0.1 static server', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
        expect(src).toContain('startLocalStaticServer');
        expect(src).toContain('preferLocalBundle');
        expect(src).toContain('prepareBundle');
        expect(src).toContain('.desktop-bundle.json');
        expect(src).not.toContain('loadFile(distIndexPath');
    });

    it('desktop config enables local bundle by default', function () {
        var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'config.json'), 'utf8'));
        expect(cfg.preferLocalBundle).toBe(true);
        expect(cfg.localServerHost).toBe('127.0.0.1');
    });

    it('preload exposes switchBundle API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8');
        expect(src).toContain('switchBundle');
        expect(src).toContain('ems-desktop:switch-bundle');
    });

    it('prepare-hosting writes desktop bundle metadata', function () {
        var src = fs.readFileSync(path.join(ROOT, 'scripts', 'prepare-hosting.js'), 'utf8');
        expect(src).toContain('.desktop-bundle.json');
        expect(src).toContain('extractCacheBust');
    });

    it('electron-builder packages dist folder', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.build.files).toContain('dist/**/*');
    });

    it('perf settings shows desktop bundle status', function () {
        var perf = fs.readFileSync(path.join(ROOT, 'ems-perf-settings.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(perf).toContain('perf-desktop-bundle');
        expect(perf).toContain('bundleMode');
        expect(html).toContain('id="perf-desktop-bundle"');
    });
});
