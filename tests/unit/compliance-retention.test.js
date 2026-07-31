import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var retention = require('../../functions/lib/compliance-retention.js');

describe('compliance-retention', function () {
    it('default retention is 365 days', function () {
        expect(retention.DEFAULT_RETENTION_DAYS).toBe(365);
    });
});
