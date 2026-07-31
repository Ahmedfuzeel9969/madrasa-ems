import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Auth Phase 2 P1 fixes', function () {
    it('tenant-context prefers staff link when teacher portal intended', function () {
        var src = fs.readFileSync(path.join(ROOT, 'tenant-context.js'), 'utf8');
        expect(src).toContain("if (intendedPortal === 'teacher')");
        expect(src).toContain("return queryLinkCollection('Staff_Links', user)");
        expect(src).toContain("if (intendedPortal === 'parent')");
    });

    it('auth.js passes intendedPortal into tenant resolve', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsResolveTenantContext(user, firestore, { intendedPortal: intendedPortal })');
    });

    it('portal-access uses polite toast for portal mismatch', function () {
        var src = fs.readFileSync(path.join(ROOT, 'portal-access.js'), 'utf8');
        expect(src).toContain('based on your access level');
        expect(src).toContain("global.showToast(msg, 'info')");
        expect(src).not.toContain('پورٹل کے لیے رجسٹرڈ ہیں');
    });

    it('cloud manifest does not reload portal-access.js', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-cloud-manifest.js'), 'utf8');
        expect(src).not.toContain("'portal-access.js'");
    });

    it('tenant-sso exposes login email/password policy helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'tenant-sso.js'), 'utf8');
        expect(src).toContain('emsRefreshLoginSsoPolicy');
        expect(src).toContain('emsEmailPasswordLoginAllowed');
        expect(src).toContain('enforceGoogleSignInOnly');
    });

    it('landing.js wires email login toggle to SSO policy', function () {
        var src = fs.readFileSync(path.join(ROOT, 'landing.js'), 'utf8');
        expect(src).toContain('btn-auth-show-email');
        expect(src).toContain('emsRefreshLoginSsoPolicy');
        expect(src).toContain('emsEmailPasswordLoginAllowed');
        expect(src).toContain('showEmailLoginView');
    });

    it('emsEmailPasswordLoginAllowed respects google-only policy', function () {
        var ssoSrc = fs.readFileSync(path.join(ROOT, 'tenant-sso.js'), 'utf8');
        var ctx = { global: {}, window: {}, console: console };
        ctx.global = ctx.window;
        vm.runInNewContext(ssoSrc, ctx, { filename: 'tenant-sso.js' });
        ctx.window.EMS_TENANT_SSO_POLICY = { enforceGoogleSignInOnly: true };
        expect(ctx.window.emsEmailPasswordLoginAllowed()).toBe(false);
        ctx.window.EMS_TENANT_SSO_POLICY = { enforceGoogleSignInOnly: false };
        expect(ctx.window.emsEmailPasswordLoginAllowed()).toBe(true);
    });
});
