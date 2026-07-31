import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var anomaly = require('../../functions/lib/login-session-anomaly.js');

describe('login-session-anomaly', function () {
    it('detects new device anomaly', function () {
        var now = Date.now();
        var history = [{
            sessionId: 'sess-old',
            uid: 'u1',
            deviceId: 'dev-a',
            createdAt: now - 600000,
            lastSeenAt: now - 600000,
            revoked: false
        }];
        var found = anomaly.detectSessionAnomalies(history, {
            sessionId: 'sess-new',
            uid: 'u1',
            deviceId: 'dev-b',
            deviceLabel: 'Windows',
            portal: 'teacher'
        }, { enableSessionAnomalyDetection: true }, now);
        expect(found.some(function (a) { return a.type === 'new_device'; })).toBe(true);
    });

    it('detects session surge', function () {
        var now = Date.now();
        var history = [
            { sessionId: 's1', uid: 'u1', deviceId: 'd1', createdAt: now - 1000, lastSeenAt: now - 1000 },
            { sessionId: 's2', uid: 'u1', deviceId: 'd2', createdAt: now - 2000, lastSeenAt: now - 2000 },
            { sessionId: 's3', uid: 'u1', deviceId: 'd3', createdAt: now - 3000, lastSeenAt: now - 3000 }
        ];
        var found = anomaly.detectSessionAnomalies(history, {
            sessionId: 's4',
            uid: 'u1',
            deviceId: 'd4',
            portal: 'teacher'
        }, { enableSessionAnomalyDetection: true, sessionAnomalyMaxPerHour: 3 }, now);
        expect(found.some(function (a) { return a.type === 'session_surge'; })).toBe(true);
    });

    it('skips when detection disabled', function () {
        var found = anomaly.detectSessionAnomalies([], {
            sessionId: 's1',
            deviceId: 'new-dev'
        }, { enableSessionAnomalyDetection: false }, Date.now());
        expect(found.length).toBe(0);
    });

    it('exports callable handlers', function () {
        expect(typeof anomaly.getSessionAnomalySummary).toBe('function');
        expect(typeof anomaly.listSessionAnomalies).toBe('function');
    });
});
