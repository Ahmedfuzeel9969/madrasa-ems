import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('White-screen / infinite-spinner boot guard', function () {
    it('boot-gate does not treat splash alone as real UI', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-boot-gate.js'), 'utf8');
        expect(src).toContain('hasRealUiSurface');
        expect(src).toContain('stuck-boot-watchdog');
        expect(src).toContain('forceShowLoginShell');
        expect(src).toContain('never treat splash alone as success');
        expect(src).toContain('emsForceShowLoginShell');
        expect(src).toContain('STUCK_BOOT_MS');
    });

    it('hideLanding unlocks shell before dismissing login UI', function () {
        var src = fs.readFileSync(path.join(ROOT, 'portal-access.js'), 'utf8');
        var hideIdx = src.indexOf('global.emsHideLanding = function');
        var unlockIdx = src.indexOf('setAppShellVisible(true)', hideIdx);
        var dismissIdx = src.indexOf('emsDismissLoginUi', hideIdx);
        expect(hideIdx).toBeGreaterThan(-1);
        expect(unlockIdx).toBeGreaterThan(hideIdx);
        expect(dismissIdx).toBeGreaterThan(unlockIdx);
    });

    it('unlockAppScreen unlocks shell before dismissing splash', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        var unlockIdx = src.indexOf('function unlockAppScreen');
        var hideLandingIdx = src.indexOf('emsHideLanding', unlockIdx);
        var dismissSplashIdx = src.indexOf('emsDismissBootSplash', unlockIdx);
        expect(unlockIdx).toBeGreaterThan(-1);
        expect(hideLandingIdx).toBeGreaterThan(unlockIdx);
        expect(dismissSplashIdx).toBeGreaterThan(hideLandingIdx);
    });

    it('index timeout forces login instead of infinite splash', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('emsForceShowLoginShell');
        expect(html).not.toMatch(/emsEnsureBootSplashVisible\('لوڈنگ میں تاخیر/);
    });
});
