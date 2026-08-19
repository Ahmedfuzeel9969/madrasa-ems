import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadAttColExports() {
    var src = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
    var sandbox = {
        window: {},
        document: { querySelectorAll: function () { return []; }, getElementById: function () { return null; } },
        localStorage: { getItem: function () { return '[]'; } },
        showToast: function () {}
    };
    sandbox.window = sandbox;
    vm.runInNewContext(src, sandbox);
    return sandbox;
}

describe('Collective student attendance register', function () {
    it('adds اجتماعی حاضری tab without removing existing registers', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('att-smart-register');
        expect(html).toContain('att-collective-register');
        expect(html).toContain('اجتماعی حاضری');
        expect(html).toContain('پورے منتخب رجسٹر کی حاضری');
        expect(html).toContain('att-col-register-strip');
        expect(html).toContain('att-col-register-controls');
        expect(html).toContain('btn-att-col-open');
        expect(html.indexOf('att-smart-register')).toBeLessThan(html.indexOf('att-collective-register'));
    });

    it('uses smart-register att-cell-btn controls and matching cell status colors', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        expect(html).toContain('att-cell-controls att-col-register-controls');
        expect(html).toContain('id="att-col-bulk-all"');
        expect(css).toContain('.att-cell-btn.status-p.active');
        expect(css).toContain('#att-col-table td.att-cell-p');
        expect(col).toContain('function statusKind');
        expect(col).toContain("cls: 'status-p'");
        expect(col).toContain('att-cell-btn');
        expect(col).toContain('renderRegisterStripButtons');
        expect(col).toContain('att-cell-p');
        expect(col).toContain('markBtn');
        expect(col).toContain('اس طالب علم کے تمام گھنٹے');
        expect(col).toContain('setSaving');
        expect(html).toContain('اس آلے پر محفوظ');
        expect(html).toContain('att-col-save-status-chip');
    });

    it('lazy-loads att-collective.js with attendance module', function () {
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy).toMatch(/attendance:\s*\[[^\]]*'att-collective\.js'/);
        expect(fs.existsSync(path.join(ROOT, 'att-collective.js'))).toBe(true);
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        expect(col).toContain('attCollectiveBoot');
        expect(col).toContain('attColSetAll');
        expect(col).toContain('attColSetStudent');
        expect(col).toContain('attColSetPeriod');
        expect(col).toContain('resultMessage');
        expect(col).toContain('آخری اجتماعی کارروائی واپس');
        expect(col).toContain('attWritePeriodOnSheetData');
    });

    it('maps custom symbols to canonical P/A/L for styling', function () {
        var sb = loadAttColExports();
        expect(sb.attColStatusKind('ح')).toBe('');
        sb.attGetAttSymbols = function () { return { P: 'ح', A: 'غ', L: 'ر' }; };
        var src = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        var start = src.indexOf('function statusKind');
        var end = src.indexOf('\n  function symForKind');
        vm.runInNewContext(
            'function symbols() { return { P: "ح", A: "غ", L: "ر" }; }\n'
            + src.slice(start, end)
            + '\nthis.statusKind = statusKind;',
            sb
        );
        expect(sb.statusKind('ح')).toBe('P');
        expect(sb.statusKind('غ')).toBe('A');
        expect(sb.statusKind('ر')).toBe('L');
    });

    it('builds scope-specific result toasts', function () {
        var sb = loadAttColExports();
        expect(sb.attColResultMessage('all', 'P', 184, 920)).toBe('184 طلبہ کے تمام گھنٹے حاضر کردیے گئے۔');
        expect(sb.attColResultMessage('student', 'A', 1, 8)).toBe('اس طالب علم کے 8 گھنٹے غیر حاضر کردیے گئے۔');
        expect(sb.attColResultMessage('period', 'L', 1, 1)).toBe('صرف یہ گھنٹہ رخصت کردیا گیا۔');
        expect(sb.attColResultMessage('period', '', 1, 1)).toBe('صرف یہ گھنٹہ صاف کردیا گیا۔');
    });

    it('wires student periods + canonical sheet helpers in attendance.js', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attStudentPeriodsForWeekday');
        expect(js).toContain('function attWritePeriodOnSheetData');
        expect(js).toContain('function attLoadCanonicalClassSheet');
        expect(js).toContain('attMirrorCurrentToCanonical');
        expect(js).toMatch(/attApplyRosterPeriodStatus/);
    });

    it('keeps collective filters resilient (bind, refresh, load-order replay)', function () {
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        var dash = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(col).toContain('function ensureBound');
        expect(col).toContain('function fillClassOneSelect');
        expect(col).toContain('function refreshFilters');
        expect(col).toContain('attCollectiveRefreshFilters');
        expect(col).toContain("getElementById('att-collective-register')");
        expect(col).toContain("addEventListener('change'");
        expect(col).toContain('ems:repository-ready');
        expect(col).toContain('ems:users-changed');
        expect(col).toContain('emsReplayAttTabBoot');
        expect(col).toContain('emsRunWhenDomReady');
        expect(col).toContain('var _opening = false');
        expect(dash).toContain("tabId === 'att-collective-register') attRunTabBoot(tabId)");
        expect(att).toMatch(/att-collective-register[\s\S]*loadAttDropdowns\(true\)/);
        expect(css).toMatch(/\.att-col-scope-bar[\s\S]*z-index:\s*32/);
        expect(css).toMatch(/\.att-col-filters[\s\S]*z-index:\s*32/);
    });

    it('writes period marks onto a class sheet and rolls up day status', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var rollStart = src.indexOf('function attRollupPeriodDayStatus');
        var rollEnd = src.indexOf('\nfunction attDisplayDayMark');
        var writeStart = src.indexOf('function attWritePeriodOnSheetData');
        var writeEnd = src.indexOf('\nwindow.attStudentPeriodsForWeekday');
        var fnSrc = src.slice(rollStart, rollEnd) + '\n' + src.slice(writeStart, writeEnd);
        var sandbox = {
            attGetAttSymbols: function () { return { P: 'P', A: 'A', L: 'L' }; }
        };
        vm.runInNewContext(
            fnSrc + '\nthis.attWritePeriodOnSheetData = attWritePeriodOnSheetData;'
            + '\nthis.attRollupPeriodDayStatus = attRollupPeriodDayStatus;',
            sandbox
        );
        var data = { records: {}, periodRecords: {} };
        var ids = ['p1', 'p2'];
        sandbox.attWritePeriodOnSheetData(data, 'S1', 13, 'p1', 'P', ids);
        expect(data.records.S1[13]).toBe('نامکمل');
        sandbox.attWritePeriodOnSheetData(data, 'S1', 13, 'p2', 'P', ids);
        expect(data.records.S1[13]).toBe('P');
        sandbox.attWritePeriodOnSheetData(data, 'S1', 13, 'p2', 'A', ids);
        expect(data.records.S1[13]).toBe('جزوی حاضری');
    });
});
