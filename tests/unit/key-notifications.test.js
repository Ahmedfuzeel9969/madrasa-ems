import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var notifications = require('../../functions/lib/key-notifications.js');

describe('key-notifications', function () {
    it('builds Urdu notification body for expiring teacher key', function () {
        var body = notifications.buildNotificationBody({
            type: 'teacher',
            id: 'STF01',
            name: 'Ali Khan',
            status: 'expiring',
            daysLeft: 5
        });
        expect(body).toContain('استاد');
        expect(body).toContain('Ali Khan');
        expect(body).toContain('5');
    });

    it('builds body for expired parent key', function () {
        var body = notifications.buildNotificationBody({
            type: 'parent',
            id: 'STD99',
            name: 'Student 99',
            status: 'expired'
        });
        expect(body).toContain('والد');
        expect(body).toContain('ختم ہو چکی ہے');
    });
});
