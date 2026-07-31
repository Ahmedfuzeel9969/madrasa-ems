import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var sso = require('../../functions/lib/sso-policy.js');
var oidc = require('../../functions/lib/sso-oidc.js');

describe('sso-oidc', function () {
    it('normalizes issuer URLs', function () {
        expect(oidc.normalizeIssuer('https://login.example.com/')).toBe('https://login.example.com');
        expect(oidc.normalizeIssuer('https://login.example.com')).toBe('https://login.example.com');
    });

    it('resolves allowed providers with OIDC and SAML', function () {
        var raw = {
            enforceGoogleSignInOnly: false,
            oidcEnabled: true,
            oidcProviderId: 'oidc.school',
            samlEnabled: true,
            samlProviderId: 'saml.school'
        };
        var list = sso.resolveAllowedProviders(raw);
        expect(list).toContain('google.com');
        expect(list).toContain('oidc.school');
        expect(list).toContain('saml.school');
    });

    it('allows only google when google-only enforced', function () {
        var raw = {
            enforceGoogleSignInOnly: true,
            oidcEnabled: true,
            oidcProviderId: 'oidc.school'
        };
        expect(sso.resolveAllowedProviders(raw)).toEqual(['google.com']);
        expect(sso.providerAllowed(raw, 'oidc.school')).toBe(false);
        expect(sso.providerAllowed(raw, 'google.com')).toBe(true);
    });

    it('denies unknown provider when OIDC enabled', function () {
        var raw = { oidcEnabled: true, oidcProviderId: 'oidc.school' };
        expect(sso.providerAllowed(raw, 'password')).toBe(false);
        expect(sso.providerAllowed(raw, 'oidc.school')).toBe(true);
    });
});
