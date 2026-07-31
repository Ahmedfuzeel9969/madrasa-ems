import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 4 P2 — atomic sync cursor IDB', function () {
    it('ems-sync-cursor-idb.js defines per-key IDB store with version', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-sync-cursor-idb.js'), 'utf8');
        expect(src).toContain('ems_sync_cursors_v1');
        expect(src).toContain('keyPath: \'key\'');
        expect(src).toContain('version');
        expect(src).toContain('migrateFromLocalStorageOnce');
        expect(src).toContain('MIGRATE_FLAG');
    });

    it('cache-policy.js routes pull cursors through EmsSyncCursorIdb', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cache-policy.js'), 'utf8');
        expect(src).toContain('EmsSyncCursorIdb.getPullCursor');
        expect(src).toContain('EmsSyncCursorIdb.setPullCursor');
        expect(src).toContain('EmsSyncCursorIdb.markSyncedCursor');
        expect(src).toMatch(/EmsSyncCursorIdb\.markSyncedCursor[\s\S]*else if \(remoteUpdatedAtMs\)/);
    });

    it('index.html loads ems-sync-cursor-idb.js before cache-policy.js', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var idbIdx = html.indexOf('ems-sync-cursor-idb.js');
        var cpIdx = html.indexOf('cache-policy.js');
        expect(idbIdx).toBeGreaterThan(-1);
        expect(cpIdx).toBeGreaterThan(idbIdx);
    });

    it('sync-engine reset cursor uses force option', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud/sync-engine.js'), 'utf8');
        expect(src).toContain('setPullCursor(key, 0, { force: true })');
    });
});
