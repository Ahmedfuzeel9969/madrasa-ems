import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 4 P1 — outbox flush cross-tab lock', function () {
    it('ems-outbox-lock.js exports emsWithOutboxFlushLock', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-outbox-lock.js'), 'utf8');
        expect(src).toContain('emsWithOutboxFlushLock');
        expect(src).toContain('navigator.locks.request');
        expect(src).toContain('ems_outbox_flush_lock_v1');
    });

    it('ems-offline-write.js wraps flush paths with outbox lock', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('flushAllUnlocked');
        expect(src).toContain('flushMutationRowAndDequeueUnlocked');
        expect(src).toMatch(/emsWithOutboxFlushLock[\s\S]*flushAllUnlocked/);
        expect(src).toMatch(/emsWithOutboxFlushLock[\s\S]*flushMutationRowAndDequeueUnlocked/);
        expect(src).toMatch(/emsWithOutboxFlushLock[\s\S]*emsOfflineFlushRow/);
    });

    it('post-auth loader loads ems-outbox-lock.js before ems-offline-write.js', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var lockIdx = src.indexOf("'ems-outbox-lock.js'");
        var writeIdx = src.indexOf("'ems-offline-write.js'");
        expect(lockIdx).toBeGreaterThan(-1);
        expect(writeIdx).toBeGreaterThan(lockIdx);
    });
});
