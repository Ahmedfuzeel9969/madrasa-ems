import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var parentPush = require('../../functions/lib/parent-push.js');

describe('parent-push', function () {
    it('previewMessage truncates long text', function () {
        var long = 'a'.repeat(150);
        expect(parentPush.previewMessage({ format: 'text', text: long }).length).toBe(120);
    });

    it('previewMessage labels voice messages', function () {
        expect(parentPush.previewMessage({ format: 'voice' })).toBe('صوتی پیغام');
    });

    it('uniqueUids via findParentUids is exported helpers', function () {
        expect(typeof parentPush.findParentUidsForStudent).toBe('function');
        expect(typeof parentPush.previewMessage).toBe('function');
    });
});
