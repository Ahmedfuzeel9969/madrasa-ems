import { describe, it, expect } from 'vitest';
import EmsUtils from '../../ems-utils.js';

const { sanitize, resolvePullConflict, simpleHash, escAttr, saEmailDocKey } = EmsUtils;

describe('sanitize', function () {
    it('escapes HTML special characters', function () {
        expect(sanitize('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(sanitize('a & b')).toBe('a &amp; b');
        expect(sanitize(null)).toBe('');
    });
});

describe('resolvePullConflict', function () {
    it('applies remote when local is empty', function () {
        var d = resolvePullConflict({}, null, '["a"]', 100);
        expect(d.apply).toBe(true);
        expect(d.reason).toBe('local_empty');
    });

    it('skips identical payloads', function () {
        var d = resolvePullConflict({}, '["a"]', '["a"]', 100);
        expect(d.apply).toBe(false);
        expect(d.markSync).toBe(true);
    });

    it('remote wins when local is clean', function () {
        var d = resolvePullConflict({ dirty: false }, '["a"]', '["b"]', 50);
        expect(d.apply).toBe(true);
        expect(d.reason).toBe('remote_wins_clean');
    });

    it('remote wins when newer and local dirty', function () {
        var d = resolvePullConflict({ dirty: true, localUpdatedAt: 100 }, '["a"]', '["b"]', 200);
        expect(d.apply).toBe(true);
        expect(d.conflict).toBe(true);
    });

    it('keeps local when pending and newer', function () {
        var d = resolvePullConflict({ dirty: true, localUpdatedAt: 300 }, '["a"]', '["b"]', 200);
        expect(d.apply).toBe(false);
        expect(d.reason).toBe('local_pending');
    });
});

describe('escAttr', function () {
    it('escapes attribute injection', function () {
        expect(escAttr("x' onclick='alert(1)")).toBe('x&#39; onclick=&#39;alert(1)');
    });
});

describe('simpleHash', function () {
    it('returns stable hex string', function () {
        expect(simpleHash('test')).toBe(simpleHash('test'));
        expect(simpleHash('test')).toMatch(/^[0-9a-f]+$/);
    });
});

describe('saEmailDocKey', function () {
    it('matches Firestore SuperAdmins seed doc id', function () {
        expect(saEmailDocKey('fuzail1158@gmail.com')).toBe('fuzail1158_gmail_com');
        expect(saEmailDocKey('  User@Domain.COM  ')).toBe('user_domain_com');
    });
});
