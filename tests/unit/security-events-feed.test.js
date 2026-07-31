import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var feed = require('../../functions/lib/security-events-feed.js');

describe('security-events-feed', function () {
    it('filters device actions', function () {
        expect(feed.filterByCategory('trusted_device_approved', 'device')).toBe(true);
        expect(feed.filterByCategory('sso_domain_denied', 'device')).toBe(false);
        expect(feed.filterByCategory('sso_domain_denied', 'sso')).toBe(true);
        expect(feed.filterByCategory('mfa_session_required', 'mfa')).toBe(true);
    });
});
