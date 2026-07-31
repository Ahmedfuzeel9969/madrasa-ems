import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Guest Portal Sandbox Phase 1', function () {
    it('ems-demo-sandbox defines isolation helpers and 3-day TTL', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-demo-sandbox.js'), 'utf8');
        expect(src).toContain('Demo_Madrasas');
        expect(src).toContain('demo_guest_');
        expect(src).toContain('expiresAtMs');
        expect(src).toContain('emsIsDemoSandbox');
        expect(src).toContain('CURRENT_USER_TENANT_ROLE = \'owner\'');
        expect(src).toContain('isDemo: true');
    });

    it('identity-gate completeGuest bootstraps sandbox admin flow', function () {
        var src = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(src).toContain('emsApplyDemoSandboxContext');
        expect(src).toContain('emsEnsureDemoMadrasaProfile');
        expect(src).toContain('emsAuthContinueAsAdmin');
    });

    it('portal-access routes demo sandbox as admin not guest-demo tab', function () {
        var src = fs.readFileSync(path.join(ROOT, 'portal-access.js'), 'utf8');
        expect(src).toContain('emsIsDemoSandbox');
        expect(src).toContain("if (typeof global.emsIsDemoSandbox === 'function' && global.emsIsDemoSandbox()) return 'admin'");
        expect(src).toContain('emsShowDemoSandboxBanner');
    });

    it('ems-firestore-paths uses Demo_Madrasas root for sandbox tenants', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-firestore-paths.js'), 'utf8');
        expect(src).toContain('activeRoot');
        expect(src).toContain('demo_guest_');
        expect(src).toContain('emsIsDemoSandbox');
    });

    it('sync-engine and offline-write use tenant doc ref helper', function () {
        var sync = fs.readFileSync(path.join(ROOT, 'cloud', 'sync-engine.js'), 'utf8');
        var off = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(sync).toContain('tenantDocRef');
        expect(sync).toContain('emsFirestoreTenantDocRef');
        expect(off).toContain('tenantDocRef');
    });

    it('firestore rules isolate Demo_Madrasas to owning auth uid', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('match /Demo_Madrasas/{demoId}');
        expect(rules).toContain("demoId == ('demo_guest_' + request.auth.uid)");
    });

    it('emsBuildDemoTenantId and sandbox detection work at runtime', function () {
        var sandboxSrc = fs.readFileSync(path.join(ROOT, 'ems-demo-sandbox.js'), 'utf8');
        var ctx = { global: {}, window: {}, document: { getElementById: function () { return null; } }, console: console };
        ctx.global = ctx.window;
        vm.runInNewContext(sandboxSrc, ctx, { filename: 'ems-demo-sandbox.js' });
        expect(ctx.window.emsBuildDemoTenantId('abc123')).toBe('demo_guest_abc123');
        ctx.window.EMS_GUEST_MODE = true;
        ctx.window.CURRENT_MADRASA_TENANT_ID = 'demo_guest_abc123';
        ctx.window.CURRENT_MADRASA_DATA = { isDemo: true };
        expect(ctx.window.emsIsDemoSandbox()).toBe(true);
        expect(ctx.window.emsGetTenantRootCollection()).toBe('Demo_Madrasas');
        expect(ctx.window.emsDemoExpiresAt(1000) - 1000).toBe(3 * 24 * 60 * 60 * 1000);
    });
});
