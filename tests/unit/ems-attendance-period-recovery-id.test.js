import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const attendance = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const saveStart = attendance.indexOf('function attSavePeriodFromModal');
const saveEnd = attendance.indexOf('\nfunction attRemovePeriodById', saveStart);
const savePeriod = attendance.slice(saveStart, saveEnd);

describe('نظام الاوقات — سابقہ حاضری سے گھنٹہ ربط', function () {
  it('offers a clear, optional recovery identifier field in the period form', function () {
    expect(html).toContain('id="new-period-recovery-id"');
    expect(html).toContain('id="new-period-recovery-id-help"');
    expect(html).toContain('صرف سابقہ حاضری کی بحالی کے لیے');
  });

  it('accepts only a safe historical identifier and never silently replaces an existing period', function () {
    expect(savePeriod).toMatch(/requestedRecoveryId/);
    expect(savePeriod).toMatch(/\^\[A-Za-z0-9_-\]\+\$/);
    expect(savePeriod).toMatch(/var duplicate = periods\.some/);
    expect(savePeriod).toMatch(/periodObj\.id = requestedRecoveryId/);
    expect(savePeriod).toMatch(/periodObj\.id = window\.generateID/);
  });

  it('locks the identifier while editing an existing period so historic marks remain linked', function () {
    expect(attendance).toMatch(/setVal\('new-period-recovery-id', p\.id\)/);
    expect(attendance).toMatch(/recoveryId\.readOnly = true/);
    expect(attendance).toMatch(/recoveryId\.readOnly = false/);
  });
});
