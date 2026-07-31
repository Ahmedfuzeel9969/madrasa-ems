import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 5 — Capacitor Android', function () {
    it('capacitor.config.json points webDir at dist with https localhost', function () {
        var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
        expect(cfg.appId).toBe('com.madrasa.ems');
        expect(cfg.webDir).toBe('dist');
        expect(cfg.server.androidScheme).toBe('https');
        expect(cfg.server.hostname).toBe('localhost');
    });

    it('offline mode detects Capacitor native platform', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-mode.js'), 'utf8');
        expect(src).toContain('isCapacitorNative');
        expect(src).toContain('emsIsAndroidApp');
        expect(src).toContain('android=1');
    });

    it('auth uses redirect on mobile native context', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('isMobileNativeContext');
        expect(src).toContain('emsIsAndroidApp');
    });

    it('package.json has android npm scripts and Capacitor deps', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['android:sync']).toContain('cap sync android');
        expect(pkg.devDependencies['@capacitor/core']).toBeTruthy();
        expect(pkg.devDependencies['@capacitor/android']).toBeTruthy();
        expect(pkg.devDependencies['@capacitor/cli']).toBeTruthy();
    });

    it('android platform folder exists after cap add', function () {
        expect(fs.existsSync(path.join(ROOT, 'android', 'app', 'build.gradle'))).toBe(true);
    });
});
