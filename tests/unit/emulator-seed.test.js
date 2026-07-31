import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var seed = require('../../scripts/seed-emulator-login.js');

describe('emulator-seed', function () {
    it('exports demo tenant constants', function () {
        expect(seed.TENANT_ID).toBe('emulator-tenant-1');
        expect(seed.OWNER_UID).toBe('emu-owner-001');
        expect(seed.TEACHER_UID).toBe('emu-teacher-001');
        expect(seed.PARENT_UID).toBe('emu-parent-001');
    });

    it('includes enterprise login security policy fields', function () {
        var p = seed.securityPolicy;
        expect(p.requireAccessKey).toBe(true);
        expect(p.notifyOwnerOnKeyExpiry).toBe(true);
        expect(p.enableSecurityWebhooks).toBe(false);
        expect(p.enableSecurityAlertDigest).toBe(false);
        expect(p.enableIpAllowlist).toBe(false);
        expect(Array.isArray(p.allowedIpRanges)).toBe(true);
        expect(p.enableLoginBruteForceProtection).toBe(false);
        expect(p.maxLoginFailuresPerEmail).toBe(5);
        expect(p.enableSessionAnomalyDetection).toBe(false);
        expect(p.sessionAnomalyMaxPerHour).toBe(3);
    });

    it('includes SSO policy seed', function () {
        expect(seed.ssoPolicy.allowedEmailDomains).toContain('emulator.test');
    });
});
