import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Auth P0 security fixes', function () {
    it('auth.js removes legacy identity-gate bypass unlock paths', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsFailSecurityLayerMissing');
        expect(src).toContain('emsEnsureSecurityStackReady');
        expect(src).toContain('emsInvokeIdentityGateOrAbort');
        expect(src).toContain('Security layer failed to load. Please refresh.');
        expect(src).not.toMatch(/if \(typeof window\.emsRunIdentityGate === 'function'\)[\s\S]{0,400}applyMadrasaProfile/);
        expect(src).not.toContain("window.CURRENT_USER_TENANT_ROLE = 'owner';\n                            unlockAppScreen()");
        expect(src).not.toContain("window.CURRENT_USER_TENANT_ROLE = ctx.role || 'owner'");
        expect(src).not.toContain('offline_idb_boot');
    });

    it('auth.js gates online boot on security stack before listenMadrasaProfile', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsEnsureSecurityStackReady().then(function (secResult)');
        expect(src).toContain("emsFailSecurityLayerMissing('post-auth-scripts')");
        expect(src).not.toContain("listenMadrasaProfile(user);\n            });");
    });

    it('identity-gate.js uses admin portal for admin domain gates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(src).toContain("runPortalSecurityGates(tenantId, 'admin', user, function () {");
        expect(src).not.toMatch(/proceedAdminWithDomainGate[\s\S]{0,300}runPortalSecurityGates\(tenantId, 'teacher'/);
    });

    it('offline session requires gateVerified role snapshot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-session-cache.js'), 'utf8');
        expect(src).toContain('gateVerified: true');
        expect(src).toContain('snap.gateVerified !== true');
        expect(src).not.toContain("snap.role || 'owner'");
        expect(src).toContain('isVerifiedOfflineRole');
    });
});
