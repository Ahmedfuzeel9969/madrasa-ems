import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var tg = require('../../functions/lib/temp-grants.js');

describe('temp-grants purge', function () {
    it('removes expired entries by expiryAt', function () {
        var now = 1000000;
        var result = tg.purgeExpiredTemporary({
            'attendance.view': { expiryAt: now - 1, grantedBy: 'admin' },
            'fee.view': { expiryAt: now + 86400000, grantedBy: 'admin' }
        }, now);
        expect(result.removed).toEqual(['attendance.view']);
        expect(result.temporary['fee.view']).toBeTruthy();
        expect(result.temporary['attendance.view']).toBeUndefined();
    });

    it('removes expired entries by ISO expiry string', function () {
        var now = Date.parse('2026-06-19T12:00:00Z');
        var result = tg.purgeExpiredTemporary({
            x: { expiry: '2026-06-18T12:00:00Z' },
            y: { expiry: '2026-06-20T12:00:00Z' }
        }, now);
        expect(result.removed).toContain('x');
        expect(result.temporary.y).toBeTruthy();
    });

    it('purgeDataTemporaryFields returns changed flag', function () {
        var now = 5000;
        var unchanged = tg.purgeDataTemporaryFields({ views: { a: true } }, now);
        expect(unchanged.changed).toBe(false);

        var changed = tg.purgeDataTemporaryFields({
            temporary: { k: { expiryAt: 1 } }
        }, now);
        expect(changed.changed).toBe(true);
        expect(changed.removed).toEqual(['k']);
    });
});
