import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Sync failure UI — compact indicator', function () {
    it('removes legacy full-width banner from index.html', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).not.toContain('id="ems-sync-status-bar"');
    });

    it('uses floating indicator widget instead of banner', function () {
        var ui = fs.readFileSync(path.join(ROOT, 'ems-sync-failure-ui.js'), 'utf8');
        expect(ui).toContain('ems-sync-indicator');
        expect(ui).toContain('function hideLegacyBanner');
        expect(ui).not.toMatch(/getElementById\('ems-sync-status-bar'\)[\s\S]{0,200}style\.display = 'block'/);
    });

    it('close action clears dead-letter queue', function () {
        var ui = fs.readFileSync(path.join(ROOT, 'ems-sync-failure-ui.js'), 'utf8');
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(ui).toContain('emsSyncFailureDismiss');
        expect(ui).toContain('emsOfflineClearDeadLetterQueue');
        expect(offline).toContain('global.emsOfflineClearDeadLetterQueue = clearDeadLetterQueue');
    });

    it('styles include compact floating indicator', function () {
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toContain('.ems-sync-indicator');
        expect(css).toContain('.ems-sync-indicator-panel');
    });
});
