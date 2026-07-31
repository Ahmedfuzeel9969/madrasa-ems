import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var delivery = require('../../functions/lib/notification-delivery.js');

describe('notification-delivery', function () {
    it('getSmtpConfig returns null when not configured', function () {
        expect(delivery.getSmtpConfig()).toBeNull();
    });

    it('sendEmailSmtp skips when no recipient', async function () {
        var res = await delivery.sendEmailSmtp('', 'sub', 'body');
        expect(res.sent).toBe(false);
        expect(res.reason).toBe('no_recipient');
    });
});
