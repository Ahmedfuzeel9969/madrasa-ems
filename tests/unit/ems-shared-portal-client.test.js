import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../../shared-portal-gateway.js'), 'utf8');

function loadGateway() {
    const window = {};
    vm.runInNewContext(source, { window, console, Promise, Set, Date, Object });
    return window.EmsSharedPortalGateway;
}

describe('shared portal owner configuration client', function () {
    it('shows the exact safe Urdu reason returned by the callable', function () {
        const gateway = loadGateway();
        const reason = 'یہ گوگل کھاتہ پہلے ہی کسی ادارے میں انفرادی شناخت سے منسلک ہے۔';
        expect(gateway.formatError({
            code: 'functions/failed-precondition',
            message: reason
        }, 'config-save')).toBe(reason);
    });

    it('does not expose an arbitrary English server message', function () {
        const gateway = loadGateway();
        expect(gateway.formatError({
            code: 'functions/failed-precondition',
            message: 'internal implementation detail'
        }, 'config-save')).toBe('محفوظ مشترک داخلے کی ضروری سروری ترتیب ابھی مکمل نہیں ہے۔');
    });

    it('canonicalizes Gmail aliases exactly like the server', function () {
        const gateway = loadGateway();
        expect(gateway.normalizeEmail('Sa.Mple+Portal@GoogleMail.com')).toBe('sample@gmail.com');
        expect(gateway.normalizeEmail('Admin@School.ORG')).toBe('admin@school.org');
    });
});
