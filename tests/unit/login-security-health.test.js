import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var health = require('../../functions/lib/login-security-health.js');

describe('login-security-health', function () {
    it('scores checks with pass warn fail', function () {
        var checks = [
            { status: 'pass' },
            { status: 'pass' },
            { status: 'warn' },
            { status: 'fail' }
        ];
        var s = health.scoreChecks(checks);
        expect(s.pass).toBe(2);
        expect(s.warn).toBe(1);
        expect(s.fail).toBe(1);
        expect(s.score).toBeGreaterThan(0);
        expect(s.score).toBeLessThanOrEqual(100);
    });

    it('returns 100 for all pass', function () {
        var s = health.scoreChecks([{ status: 'pass' }, { status: 'pass' }]);
        expect(s.score).toBe(100);
    });
});
