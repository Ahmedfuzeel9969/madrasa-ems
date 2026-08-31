import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance P3 Phase 4 — final cleanup', function () {
    it('ATT-P3-B: report individual target uses live search (no full option dump)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(js).toContain('repFilterUsersForSearch');
        expect(js).toContain('repRenderIndividualSearchResults');
        expect(js).toContain('repResolveSelectedIndividualUid');
        expect(js).not.toMatch(/rep-att-target[\s\S]{0,1200}users\.map\(\s*\(\s*u\s*\)\s*=>\s*`<option value="\$\{u\.id\}"/);
        expect(html).toContain('id="rep-att-individual-search"');
        expect(html).toContain('id="rep-att-individual-results"');
        expect(html).toContain('id="rep-att-specific-class"');
        expect(html).not.toMatch(/id="rep-att-individual-search"[\s\S]{0,80}<option/);
    });

    it('ATT-P3-C: settings and periods sync via attPersistConfigBlob', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain("var ATT_SETTINGS_KEY = 'ems_att_settings'");
        expect(js).toContain("var ATT_PERIODS_KEY = 'ems_att_periods'");
        expect(js).toMatch(/btn-save-basic-settings[\s\S]{0,2000}attPersistConfigBlob\(ATT_SETTINGS_KEY/);
        expect(js).toMatch(/function attSaveTimetablePeriodsSync[\s\S]{0,600}attPersistConfigBlob\(ATT_PERIODS_KEY/);
        expect(js).toContain('attSaveTimetablePeriodsSync(periods)');
        expect(js).toMatch(/attRemovePeriodById[\s\S]{0,1200}attSaveTimetablePeriodsSync\(periods\)/);
    });

    it('ATT-P3-D: saved events list uses chunked rendering', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(js).toMatch(/renderSavedEvents[\s\S]{0,3400}attRenderChunkedRows\(/);
        expect(js).toMatch(/renderSavedEvents[\s\S]{0,3400}disposeKey:\s*'evt-saved'/);
        expect(html).toContain('id="evt-saved-chunk-foot"');
    });

    it('ATT-P3-E: event and report search inputs are debounced', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('var ATT_SEARCH_DEBOUNCE_MS = 150');
        expect(js).toContain('function attDebounce');
        expect(js).toMatch(/evtEnsureParticipantSearchBound[\s\S]{0,800}attDebounce/);
        expect(js).toMatch(/repEnsureIndividualSearchBound[\s\S]{0,800}attDebounce/);
    });

    it('masterToggle iterates full filtered roster (fresh register bulk mark)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attForEachFilteredRosterUser');
        expect(js).toMatch(/masterToggle[\s\S]{0,600}attForEachFilteredRosterUser/);
        expect(js).toMatch(/masterClearColumn[\s\S]{0,600}attForEachFilteredRosterUser/);
        expect(js).toMatch(/attForEachFilteredRosterUser[\s\S]{0,800}getFilteredUsers/);
        expect(js).not.toMatch(/masterToggle[\s\S]{0,400}for\s*\(\s*let uid in window\.currentAttState\.records/);
    });
});
