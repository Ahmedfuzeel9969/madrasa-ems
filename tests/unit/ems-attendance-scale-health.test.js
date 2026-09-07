import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const scale = require('../../scripts/attendance-scale-sim.js');

describe('Attendance scale and health diagnostics', function () {
    it('keeps synthetic tenant attendance isolated and respects canonical clears', function () {
        const result = scale.runSimulation({ tenants: 100, people: 25, days: 10 });
        expect(result.ok).toBe(true);
        expect(result.crossTenantLeaks).toBe(0);
        expect(result.canonicalClearFailures).toBe(0);
        expect(result.finalCells).toBe(100 * ((25 * 10) - 1));
    });

    it('exposes pending age, conflicts and dead-letter health', function () {
        const src = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
        const start = src.indexOf('global.emsAttendanceSyncHealth');
        const end = src.indexOf('\n  function scheduleQueueRefresh', start);
        const block = src.slice(start, end);
        expect(block).toContain('oldestAgeMs');
        expect(block).toContain("row.lastErrorCode === 'CELL_CONFLICT'");
        expect(block).toContain("status = 'critical'");
        expect(block).toContain('deadLetter');
    });
});
