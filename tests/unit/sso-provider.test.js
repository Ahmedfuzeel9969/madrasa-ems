import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var sso = require('../../functions/lib/sso-policy.js');

describe('sso-provider', function () {
    it('allows google when enforceGoogleSignInOnly', function () {
        expect(sso.providerAllowed({ enforceGoogleSignInOnly: true }, 'google.com')).toBe(true);
        expect(sso.providerAllowed({ enforceGoogleSignInOnly: true }, 'password')).toBe(false);
    });

    it('allows any provider when policy off', function () {
        expect(sso.providerAllowed({ enforceGoogleSignInOnly: false }, 'password')).toBe(true);
    });

    it('hasProviderRestriction detects OIDC config', function () {
        expect(sso.hasProviderRestriction({ oidcEnabled: true })).toBe(true);
        expect(sso.hasProviderRestriction({})).toBe(false);
    });
});
