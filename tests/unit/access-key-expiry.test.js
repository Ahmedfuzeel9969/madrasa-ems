import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var expiry = require('../../functions/lib/access-key-expiry.js');

describe('access-key-expiry', function () {
    it('flags expired keys', function () {
        var now = 1000000;
        var st = expiry.expiryStatus(now - 1, now);
        expect(st.status).toBe('expired');
        expect(st.daysLeft).toBe(0);
    });

    it('flags keys expiring within 30 days', function () {
        var now = Date.now();
        var st = expiry.expiryStatus(now + 5 * 86400000, now);
        expect(st.status).toBe('expiring');
        expect(st.daysLeft).toBeLessThanOrEqual(5);
    });

    it('ok for keys beyond warning window', function () {
        var now = Date.now();
        var st = expiry.expiryStatus(now + 60 * 86400000, now);
        expect(st.status).toBe('ok');
    });
});
