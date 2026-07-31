import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var retry = require('../../functions/lib/notification-retry.js');

describe('notification-retry', function () {
    it('exports max retry attempts', function () {
        expect(retry.MAX_RETRY_ATTEMPTS).toBe(5);
    });

    it('exports list and retry helpers', function () {
        expect(typeof retry.listFailedForTenant).toBe('function');
        expect(typeof retry.retryKeyExpiry).toBe('function');
    });
});
