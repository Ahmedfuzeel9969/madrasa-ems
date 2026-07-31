import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var ipPolicy = require('../../functions/lib/login-ip-policy.js');

describe('login-ip-policy', function () {
    it('matches exact IP in allowlist', function () {
        expect(ipPolicy.ipMatchesAllowlist('192.168.1.100', ['192.168.1.100'])).toBe(true);
        expect(ipPolicy.ipMatchesAllowlist('192.168.1.101', ['192.168.1.100'])).toBe(false);
    });

    it('matches CIDR range', function () {
        expect(ipPolicy.ipMatchesAllowlist('10.0.0.5', ['10.0.0.0/8'])).toBe(true);
        expect(ipPolicy.ipMatchesAllowlist('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
    });

    it('parses ip ranges from string', function () {
        var ranges = ipPolicy.parseIpRanges('203.0.113.0/24, 192.168.1.1');
        expect(ranges.length).toBe(2);
        expect(ranges[0]).toBe('203.0.113.0/24');
    });

    it('extracts IP from x-forwarded-for header', function () {
        var ip = ipPolicy.extractClientIp({
            headers: { 'x-forwarded-for': '203.0.113.50, 10.0.0.1' }
        });
        expect(ip).toBe('203.0.113.50');
    });

    it('matches country allowlist from header', function () {
        expect(ipPolicy.countryMatchesAllowlist('PK', ['PK', 'SA'])).toBe(true);
        expect(ipPolicy.countryMatchesAllowlist('US', ['PK', 'SA'])).toBe(false);
        expect(ipPolicy.extractCountryCode({ headers: { 'cf-ipcountry': 'pk' } })).toBe('PK');
    });
});
