import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 3 — benchmark tooling', function () {
    it('perf-load-sim.js supports json-out and skip-legacy flags', function () {
        var src = fs.readFileSync(path.join(ROOT, 'scripts', 'perf-load-sim.js'), 'utf8');
        expect(src).toContain('--json-out=');
        expect(src).toContain('--skip-legacy');
        expect(src).toContain('cache fingerprint hit');
    });

    it('perf-load-sim runs at 400 scale', function () {
        var out = execSync('node scripts/perf-load-sim.js --max=400 --skip-legacy', {
            cwd: ROOT,
            encoding: 'utf8'
        });
        var data = JSON.parse(out);
        expect(data.rows.length).toBeGreaterThan(0);
        expect(data.rows[0].students).toBe(400);
        expect(data.rows[0].timings.some(function (t) {
            return t.label.indexOf('Map [production]') >= 0;
        })).toBe(true);
        expect(data.rows[0].timings.some(function (t) {
            return t.label.indexOf('legacy') >= 0;
        })).toBe(false);
    });

    it('BENCHMARK-RESULTS.md exists with Phase 3 sign-off', function () {
        var doc = fs.readFileSync(path.join(ROOT, 'docs', 'BENCHMARK-RESULTS.md'), 'utf8');
        expect(doc).toContain('Phase 3');
        expect(doc).toContain('Map');
        expect(doc).toContain('400');
        expect(doc).toContain('100,000');
    });

    it('package.json exposes benchmark script', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts.benchmark).toBeDefined();
    });
});
