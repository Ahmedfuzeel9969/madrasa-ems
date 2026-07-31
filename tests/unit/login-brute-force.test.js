import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var bf = require('../../functions/lib/login-brute-force.js');

describe('login-brute-force', function () {
    it('normalizes email doc ids', function () {
        expect(bf.emailDocId('Teacher@Test.COM')).toBe('teacher@test.com');
        expect(bf.emailDocId('')).toBe('');
    });

    it('detects active lockout', function () {
        var now = Date.now();
        expect(bf.isLocked({ lockedUntil: now + 60000 }, now)).toBe(true);
        expect(bf.isLocked({ lockedUntil: now - 1000 }, now)).toBe(false);
        expect(bf.isLocked({ count: 3 }, now)).toBe(false);
    });

    it('exports callable handlers', function () {
        expect(typeof bf.checkTenantLoginAllowed).toBe('function');
        expect(typeof bf.recordTenantLoginFailure).toBe('function');
        expect(typeof bf.getTenantLoginLockouts).toBe('function');
    });
});
