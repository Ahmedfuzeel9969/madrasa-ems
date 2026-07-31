import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var trusted = require('../../functions/lib/trusted-devices.js');

describe('trusted-devices', function () {
    it('detects expired approved devices', function () {
        var now = Date.UTC(2026, 5, 19);
        var approvedAt = now - 91 * 86400000;
        expect(trusted.isDeviceExpired(approvedAt, 90, now)).toBe(true);
        expect(trusted.isDeviceExpired(approvedAt, 0, now)).toBe(false);
        expect(trusted.isDeviceExpired(approvedAt, 365, now)).toBe(false);
    });

    it('builds device label from user agent', function () {
        expect(trusted.buildDeviceLabel('Mozilla/5.0 iPhone')).toBe('iOS');
    });
});
