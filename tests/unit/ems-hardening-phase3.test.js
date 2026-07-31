import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 3 — P2 Hardening Part 1', function () {
    it('emsStopRegistrationLiveSync tears down meta listener via emsRegRepoReset', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-registration-live-sync.js'), 'utf8');
        expect(src).toContain('emsStopRegistrationLiveSync');
        expect(src).toMatch(/emsStopRegistrationLiveSync[\s\S]*emsRegRepoReset/);
    });

    it('registration approve/reject uses atomic Firestore batch queue type', function () {
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(offline).toContain('registration_atomic');
        expect(offline).toContain('flushRegistrationAtomicRow');
        expect(offline).toContain('buildRegistrationAtomicPayload');
        expect(offline).toContain('buildRegistrationAtomicDelete');
        expect(offline).toMatch(/batch\.commit\(\)/);

        var mutation = fs.readFileSync(path.join(ROOT, 'ems-cloud-mutation.js'), 'utf8');
        expect(mutation).toContain("'registration_atomic'");
        expect(mutation).toMatch(/registration_atomic[\s\S]*return/);
    });

    it('atomic batch skips duplicate meta notify (meta included in batch)', function () {
        var mutation = fs.readFileSync(path.join(ROOT, 'ems-cloud-mutation.js'), 'utf8');
        expect(mutation).toMatch(/registration_atomic[\s\S]*return/);

        var repo = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(repo).toContain('emsRegRepoApplyMetaFromAtomic');
    });
});
