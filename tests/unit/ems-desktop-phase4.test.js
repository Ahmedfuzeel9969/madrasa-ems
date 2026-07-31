import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Desktop Phase 4 — Electron wrapper', function () {
    it('desktop folder has main, preload, config', function () {
        expect(fs.existsSync(path.join(ROOT, 'desktop', 'main.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'desktop', 'preload.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'desktop', 'config.json'))).toBe(true);
    });

    it('preload exposes emsDesktop bridge', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8');
        expect(src).toContain('emsDesktop');
        expect(src).toContain('isDesktop: true');
    });

    it('offline mode detects desktop app', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-mode.js'), 'utf8');
        expect(src).toContain('emsDesktop');
        expect(src).toContain('emsIsDesktopApp');
    });

    it('auth.js forces popup (not redirect) on desktop', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('isDesktopAuthContext');
        expect(src).toContain('if (isDesktopAuthContext()) return false');
    });

    it('auth.js enables LOCAL persistence for desktop restarts', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsConfigureAuthPersistence');
        expect(src).toContain('Persistence.LOCAL');
        expect(src).toContain('EMS_AUTH_STATE_READY');
    });

    it('boot gate defers login shell until DOM ready and schedules desktop offline boot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-boot-gate.js'), 'utf8');
        expect(src).toContain('deferLoginShell');
        expect(src).toContain('DOMContentLoaded');
        expect(src).toContain('emsScheduleDesktopOfflineAutoBoot');
    });

    it('desktop main.js uses persistent session and local bundle server', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
        expect(src).toContain('isOAuthUrl');
        expect(src).toContain('action: \'allow\'');
        expect(src).toContain('persist:madrasa-ems');
        expect(src).toContain('isMainWebContents');
        expect(src).toContain('requestSingleInstanceLock');
        expect(src).toContain('configurePersistentSession');
        expect(src).toContain('backgroundThrottling');
        expect(src).toContain('startLocalStaticServer');
    });

    it('dashboard donuts show counts without capacity labels', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('resolveDashboardPeopleCounts');
        expect(src).toContain('formatCount');
        expect(src).not.toContain("cmp.length, 'شکایات'");
    });

    it('package.json has desktop build scripts', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['desktop:dev']).toBeDefined();
        expect(pkg.scripts['desktop:build']).toBeDefined();
        expect(pkg.build && pkg.build.productName).toBe('Madrasa EMS');
    });
});
