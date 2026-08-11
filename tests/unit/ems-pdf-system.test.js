import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('PDF system (deferred libs + download)', function () {
    it('emsLoadPdfLibs is defined with local + CDN fallbacks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-deferred-libs.js'), 'utf8');
        expect(src).toContain('global.emsLoadPdfLibs');
        expect(src).toContain('vendor/html2canvas/html2canvas.min.js');
        expect(src).toContain('vendor/jspdf/jspdf.umd.min.js');
        expect(src).toContain('html2canvas/1.4.1');
        expect(src).toContain('jspdf/2.5.1');
    });

    it('vendor PDF libraries are present for offline use', function () {
        expect(fs.existsSync(path.join(ROOT, 'vendor/html2canvas/html2canvas.min.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'vendor/jspdf/jspdf.umd.min.js'))).toBe(true);
        expect(fs.statSync(path.join(ROOT, 'vendor/html2canvas/html2canvas.min.js')).size).toBeGreaterThan(10000);
        expect(fs.statSync(path.join(ROOT, 'vendor/jspdf/jspdf.umd.min.js')).size).toBeGreaterThan(10000);
    });

    it('finDownloadPDF loads libs and prepares hidden/scroll areas', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('emsLoadPdfLibs');
        expect(src).toContain('finPreparePdfCapture');
        expect(src).toContain('ems-pdf-capture-host');
        expect(src).toContain('finRasterToPdf');
    });

    it('ID card PDF loads libs and falls back to print', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idcard.js'), 'utf8');
        expect(src).toContain('emsLoadPdfLibs');
        expect(src).toContain('emsPrintIDCard');
    });

    it('image preview has print + PDF handlers', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var adm = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(html).toContain('downloadSpecificImagePDF()');
        expect(adm).toContain('window.printSpecificImage');
        expect(adm).toContain('window.downloadSpecificImagePDF');
    });

    it('boot still does not load html2canvas in index.html', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).not.toContain('html2canvas.min.js');
        expect(html).not.toContain('jspdf.umd.min.js');
    });
});
