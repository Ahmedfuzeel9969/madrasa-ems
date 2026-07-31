import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P0 Scale Foundation — IDB indexes, durable blobs, delta pull', function () {
    it('ems-idb-engine uses compound indexes and cursor pagination (no full RAM sort)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idb-engine.js'), 'utf8');
        expect(src).toContain('DB_VERSION = 4');
        expect(src).toContain("createIndex('col_ts_desc'");
        expect(src).toContain("createIndex('col_ts_asc'");
        expect(src).toContain("createIndex('col_type_ts_desc'");
        expect(src).toContain('function pageIndexed');
        expect(src).toContain('openCursor');
        expect(src).not.toMatch(/emsIdbColPage[\s\S]*\.sort\([\s\S]*return all\.slice/);
    });

    it('ems-repository delegates sorted pages to emsIdbColPage unless search is set', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-repository.js'), 'utf8');
        expect(src).toContain('return global.emsIdbColPage(c, opts)');
        expect(src).toMatch(/page:\s*function[\s\S]*emsIdbColPage/);
    });

    it('large blobs route through durable IDB storage with boot migration', function () {
        var durable = fs.readFileSync(path.join(ROOT, 'ems-durable-storage.js'), 'utf8');
        expect(durable).toContain('emsIsLargeBlobKey');
        expect(durable).toContain('att_rec_');
        expect(durable).toContain('ems_full_');
        expect(durable).toContain('emsDurableMigrateBoot');
        expect(durable).toContain('removeLs');

        var loader = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        expect(loader).toContain('ems-durable-storage.js');
        expect(loader).toContain('emsDurableMigrateBoot');

        var cache = fs.readFileSync(path.join(ROOT, 'ems-data-cache.js'), 'utf8');
        expect(cache).toMatch(/emsIsLargeBlobKey[\s\S]*emsDurableWriteRaw/);
    });

    it('direct-firestore pull paths use delta queries and merge (not full replace scans)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'direct-firestore.js'), 'utf8');
        expect(src).toContain('queryDeltaCollection');
        expect(src).toContain("where('updatedAt', '>'");
        expect(src).toContain('mergeArrayById');
        expect(src).toContain('mergeMapByKey');
        expect(src).toContain('getPullCursor');
        expect(src).toMatch(/pullAll:[\s\S]*delta:\s*true/);
        expect(src).toContain('pullAllFull');
        expect(src).toContain('emsConfirmFullTenantDownload');
    });

    it('manual cloud pull uses delta-only sequential sync', function () {
        var online = fs.readFileSync(path.join(ROOT, 'ems-online-mode.js'), 'utf8');
        expect(online).toContain('deltaOnly: true');
        expect(online).toMatch(/EmsDirect\.pullAll\(\{\s*delta:\s*true,\s*forceFull:\s*false\s*\}\)/);
        expect(online).toContain('emsConfirmFullTenantDownload');
    });

    it('native SQLite backend paginates with ORDER BY LIMIT', function () {
        var sqlite = fs.readFileSync(path.join(ROOT, 'desktop', 'native-db-sqlite.js'), 'utf8');
        expect(sqlite).toMatch(/ORDER BY[\s\S]*LIMIT/);
    });
});
