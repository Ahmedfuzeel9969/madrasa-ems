import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Auth Phase 3 P2 UI/UX + Student Portal foundation', function () {
    it('portal-access registers student in allowed portals', function () {
        var src = fs.readFileSync(path.join(ROOT, 'portal-access.js'), 'utf8');
        expect(src).toContain("global.EMS_ALLOWED_PORTALS = ['admin', 'teacher', 'parent', 'student', 'guest']");
        expect(src).toContain('emsShowStudentPortalComingSoon');
        expect(src).toContain('emsIsStudentPortalAvailable');
    });

    it('index.html has five portal cards in admin-first order with guest last', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var gridMatch = html.match(/id="ems-portal-grid"[\s\S]*?<\/div>\s*<\/main>/);
        expect(gridMatch).toBeTruthy();
        var grid = gridMatch[0];
        var portals = [];
        var re = /data-portal="([^"]+)"/g;
        var m;
        while ((m = re.exec(grid)) !== null) {
            portals.push(m[1]);
        }
        expect(portals).toEqual(['admin', 'teacher', 'parent', 'student', 'guest']);
        expect(html).toContain('id="ems-student-coming-soon"');
        expect(html).toContain('id="ems-login-portal-header"');
        expect(html).toContain('id="ems-access-key-format-hint"');
    });

    it('landing.js routes student card to coming soon and exposes auth loading helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'landing.js'), 'utf8');
        expect(src).toContain("if (portal === 'student')");
        expect(src).toContain('emsShowStudentPortalComingSoon');
        expect(src).toContain('emsSetLandingAuthLoading');
        expect(src).toContain('updateLoginPortalChrome');
        expect(src).toContain('applyProfileSetupLang');
        expect(src).toContain('profileSetupTitle');
        expect(src).toContain('studentTitle');
    });

    it('landing.css styles student portal, loading state, and login chrome', function () {
        var css = fs.readFileSync(path.join(ROOT, 'landing.css'), 'utf8');
        expect(css).toContain('.ems-portal-card.student');
        expect(css).toContain('.ems-portal-card--disabled');
        expect(css).toContain('.ems-login-portal-header');
        expect(css).toContain('.ems-coming-soon-overlay');
        expect(css).toContain('.ems-profile-setup-gateway');
        expect(css).toContain('.ems-login-box--loading');
    });

    it('auth.js clears landing auth loading on login failures', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsClearLandingAuthLoading');
        expect(src).toContain('emsApplyProfileSetupLang');
    });

    it('emsSetIntendedPortal accepts student key', function () {
        var paSrc = fs.readFileSync(path.join(ROOT, 'portal-access.js'), 'utf8');
        var ctx = { global: {}, window: {}, document: { getElementById: function () { return null; } }, console: console };
        ctx.global = ctx.window;
        vm.runInNewContext(paSrc, ctx, { filename: 'portal-access.js' });
        ctx.window.emsSetIntendedPortal('student');
        expect(ctx.window.emsGetIntendedPortal()).toBe('student');
        expect(ctx.window.emsIsStudentPortalAvailable()).toBe(false);
    });
});
