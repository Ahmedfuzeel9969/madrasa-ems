import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var reminders = require('../../functions/lib/key-reminders.js');

describe('key-reminders', function () {
    it('builds stable alert doc ids', function () {
        var id = reminders.alertDocId({ type: 'teacher', id: 'STF01' }, '2026-06-19');
        expect(id).toBe('teacher-STF01-2026-06-19');
    });
});
