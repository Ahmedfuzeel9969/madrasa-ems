import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var digest = require('../../functions/lib/security-alert-digest.js');

describe('security-alert-digest', function () {
    it('triggers alert when at or above threshold', function () {
        var summary = { totalCritical: 5, ssoDenied: 2, mfaBlocks: 2, rateLimited: 1 };
        expect(digest.shouldTriggerAlert(summary, 5)).toBe(true);
        expect(digest.shouldTriggerAlert(summary, 6)).toBe(false);
    });

    it('always triggers when threshold is zero', function () {
        expect(digest.shouldTriggerAlert({ totalCritical: 0 }, 0)).toBe(true);
    });

    it('builds digest body text', function () {
        var body = digest.buildDigestBody({ ssoDenied: 1, mfaBlocks: 2, rateLimited: 0, deviceRequests: 3, totalCritical: 3 }, 5);
        expect(body).toContain('SSO blocks: 1');
        expect(body).toContain('Critical total: 3');
    });

    it('lists critical alert actions', function () {
        expect(digest.CRITICAL_ALERT_ACTIONS).toContain('mfa_session_required');
        expect(digest.CRITICAL_ALERT_ACTIONS).toContain('trusted_device_rate_limited');
    });
});
