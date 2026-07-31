import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var sessions = require('../../functions/lib/login-sessions.js');
var analytics = require('../../functions/lib/notification-analytics.js');

describe('login-sessions', function () {
    it('builds device label from user agent', function () {
        expect(sessions.buildDeviceLabel('Mozilla/5.0 Windows NT 10.0')).toBe('Windows');
        expect(sessions.buildDeviceLabel('Mozilla/5.0 Android')).toBe('Android');
    });
});

describe('notification-analytics', function () {
    it('formats date key', function () {
        expect(analytics.dateKeyFromMs(Date.UTC(2026, 5, 19, 12, 0, 0))).toBe('2026-06-19');
    });
});
