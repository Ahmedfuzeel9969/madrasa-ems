import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var mfa = require('../../functions/lib/mfa.js');

describe('mfa-policy', function () {
    it('resolves required flag by portal', function () {
        var policy = { requireMfaForAdmin: true, requireMfaForStaff: false, requireMfaForParent: true };
        expect(mfa.resolveRequired(policy, mfa.resolvePortalFlags('admin'))).toBe(true);
        expect(mfa.resolveRequired(policy, mfa.resolvePortalFlags('staff'))).toBe(false);
        expect(mfa.resolveRequired(policy, mfa.resolvePortalFlags('parent'))).toBe(true);
    });
});
