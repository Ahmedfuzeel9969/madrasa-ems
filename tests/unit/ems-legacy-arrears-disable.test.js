import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Legacy arrears hard-disable', function () {
    it('core.js sets EMS_DISABLE_LEGACY_ARREARS', function () {
        var src = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(src).toContain('EMS_DISABLE_LEGACY_ARREARS = true');
    });

    it('finance.js exposes finComputeArrearsLegacyOnm guard', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('finComputeArrearsLegacyOnm');
        expect(src).toContain('Legacy O(n×m) arrears path is disabled');
        expect(src).toContain('finBuildFeeIndexes');
    });

    it('perf-load-sim defaults skipLegacy true', function () {
        var src = fs.readFileSync(path.join(ROOT, 'scripts', 'perf-load-sim.js'), 'utf8');
        expect(src).toMatch(/skipLegacy:\s*true/);
        expect(src).toContain('--include-legacy');
    });

    it('browser IDB bench harness exists', function () {
        expect(fs.existsSync(path.join(ROOT, 'bench', 'idb-scale-bench.html'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'bench', 'idb-scale-bench.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'tests', 'e2e', 'ems-idb-scale-bench.spec.js'))).toBe(true);
    });
});
