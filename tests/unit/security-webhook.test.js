import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var webhook = require('../../functions/lib/security-webhook.js');

describe('security-webhook', function () {
    it('validates webhook URLs', function () {
        expect(webhook.isValidWebhookUrl('https://hooks.example.com/ems')).toBe(true);
        expect(webhook.isValidWebhookUrl('http://localhost:8080/hook')).toBe(true);
        expect(webhook.isValidWebhookUrl('ftp://bad.com')).toBe(false);
        expect(webhook.isValidWebhookUrl('not-a-url')).toBe(false);
    });

    it('signs payload with HMAC', function () {
        var body = '{"action":"test"}';
        var sig1 = webhook.signPayload('secret', body);
        var sig2 = webhook.signPayload('secret', body);
        expect(sig1).toBe(sig2);
        expect(sig1.length).toBe(64);
        expect(webhook.signPayload('', body)).toBe('');
    });

    it('lists webhookable actions', function () {
        expect(webhook.WEBHOOK_ACTIONS).toContain('trusted_device_rate_limited');
        expect(webhook.WEBHOOK_ACTIONS).toContain('mfa_session_required');
        expect(webhook.WEBHOOK_ACTIONS).toContain('login_lockout_triggered');
        expect(webhook.WEBHOOK_ACTIONS).toContain('session_anomaly_detected');
    });
});
