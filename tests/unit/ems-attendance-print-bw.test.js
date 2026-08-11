import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Smart register print black/white dense layout', function () {
    it('CSS print rules use black header strips and white body cells', function () {
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toContain('#smart-register-table thead th');
        expect(css).toContain('background: #000 !important');
        expect(css).toContain('color: #fff !important');
        expect(css).toContain('font-size: 14px !important');
        expect(css).toContain('.print-status-text');
        expect(css).toContain('font-size: 12px !important');
        expect(css).toContain('@page { size: A3 landscape; margin: 8mm; }');
        expect(css).toContain('line-height: 1.55 !important');
        expect(css).toContain('overflow: visible !important');
        expect(css).toContain('max-width: none !important');
    });

    it('attPrintRegister injects dense B/W print CSS without clipping', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('window.attPrintRegister');
        expect(src).toContain('att-print-meta');
        expect(src).toContain('background:#000');
        expect(src).toContain('font-size:14px');
        expect(src).toContain('font-size:12px');
        expect(src).toContain('margin: 8mm');
        expect(src).toContain('line-height:1.55');
        expect(src).toContain('overflow: visible');
        expect(src).toContain('max-width:none');
        expect(src).toContain('cloneNode(true)');
    });
});
