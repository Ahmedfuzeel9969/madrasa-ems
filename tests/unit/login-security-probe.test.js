import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var probe = require('../../functions/lib/login-security-probe.js');

describe('login-security-probe', function () {
    it('exports probe version and function list', function () {
        expect(probe.PROBE_VERSION).toContain('e26');
        expect(probe.PROBE_FUNCTIONS).toContain('probeLoginSecurityBackend');
        expect(probe.PROBE_FUNCTIONS).toContain('validateLoginCountry');
        expect(probe.PROBE_FUNCTIONS).toContain('checkTenantLoginAllowed');
        expect(probe.PROBE_FUNCTIONS).toContain('getSessionAnomalySummary');
    });
});
