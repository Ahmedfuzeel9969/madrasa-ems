import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
function source(name) { return fs.readFileSync(path.join(ROOT, name), 'utf8'); }

describe('Attendance button integrity', function () {
  it('keeps every primary attendance button wired and removes the unsafe browser-to-cloud timetable button', function () {
    var html = source('index.html');
    var attSection = html.slice(html.indexOf('id="module-attendance"'), html.indexOf('id="module-complaints"'));
    [
      'btn-att-cloud-pull', 'btn-att-dash-refresh', 'btn-load-smart-register',
      'btn-att-save-lock', 'btn-att-edit-mode', 'btn-att-col-open',
      'btn-att-col-undo', 'btn-create-event', 'btn-add-participant',
      'btn-save-event-att', 'btn-add-holiday', 'btn-generate-att-report',
      'btn-save-basic-settings', 'btn-save-att-symbols', 'btn-save-add-more',
      'btn-save-period', 'btn-apply-custom-status'
    ].forEach(function (id) {
      expect(attSection).toContain('id="' + id + '"');
    });
    expect(attSection).not.toContain('btn-att-tt-push-browser');
    expect(source('attendance.js')).not.toContain('attPushBrowserTimetableToFirebase');
  });

  it('scopes retry to attendance rows and prevents concurrent double-click flushes', function () {
    var status = source('att-save-status.js');
    var start = status.indexOf('function retryAttendanceRows');
    var end = status.indexOf('\n  function bindUi', start);
    var block = status.slice(start, end);
    expect(block).toContain('emsOfflineListQueue');
    expect(block).toContain('isAttQueueType(row.type)');
    expect(block).toContain('emsOfflineFlushMutationRow(row)');
    expect(block).toContain('if (_retryInflight) return _retryInflight');
    expect(block).not.toContain('emsOfflineRetryFailedSync');
    expect(block).not.toContain('emsCloudFlushPendingMutations');
    expect(block).toContain('global.confirm');
  });

  it('makes Smart Register load single-flight and rejects stale tenant responses', function () {
    var att = source('attendance.js');
    expect(att).toContain('var _attRegisterLoadSeq = 0');
    expect(att).toContain('function attRegisterLoadIsCurrent');
    expect(att).toContain('ctx.requestId !== _attRegisterLoadSeq');
    expect(att).toContain('window.emsGetTenantGeneration() !== ctx.generation');
    expect(att).toMatch(/emsEnsureRepositoryReady\(\)\)\.catch[\s\S]{0,250}ready\.then\(loadRegister\)/);
    expect(att).not.toContain('emsEnsureRepositoryReady().then(loadRegister).catch(loadRegister)');
  });

  it('queues a real dashboard refresh after any in-flight automatic render', function () {
    var dash = source('att-dashboard.js');
    var start = dash.indexOf("var btn = document.getElementById('btn-att-dash-refresh')");
    var block = dash.slice(start, start + 2200);
    expect(block).toContain('if (_attDashManualRefreshInflight)');
    expect(block).toContain('var waitForCurrent = _attDashInflight || Promise.resolve()');
    expect(block).toMatch(/waitForCurrent[\s\S]*?attDashInvalidateSheetCache\(\)[\s\S]*?renderAttDashboard\(\)/);
    expect(block).toContain("btn.setAttribute('aria-busy', 'true')");
  });

  it('does not report settings, holiday, event, or timetable success after a failed local write', function () {
    var att = source('attendance.js');
    expect(att).toContain('function attRequirePersistSuccess');
    expect(att).toMatch(/btn-save-basic-settings[\s\S]{0,1400}then\(attRequirePersistSuccess\)/);
    expect(att).toMatch(/btn-add-holiday[\s\S]{0,1800}then\(attRequirePersistSuccess\)/);
    expect(att).toMatch(/function evtWriteEventsDbLocal[\s\S]{0,500}emsOfflineWriteLocalSync[\s\S]{0,180}=== true/);
    expect(att).toMatch(/function attSavePeriodFromModal[\s\S]*?var periodSave = attSaveTimetablePeriodsSync\(periods\)[\s\S]*?res\.ok === false/);
  });

  it('archives deleted hours and restores by id instead of creating a duplicate period', function () {
    var att = source('attendance.js');
    expect(att).toMatch(/attRemovePeriodById[\s\S]{0,1800}archived:\s*true/);
    expect(att).toContain('پرانی حاضری برقرار ہے');
    expect(att).toMatch(/restoreRecycle[\s\S]{0,1800}findIndex[\s\S]{0,500}per\[perIdx\] = restoredPeriod/);
    expect(att).toMatch(/deleteCustomTeacher[\s\S]{0,900}attReadAllTimetablePeriodsRaw\(\)\.some/);
  });

  it('keeps the cloud recovery button on the verified attendance tenant path', function () {
    var pull = source('ems-cloud-pull.js');
    expect(pull).toContain("return tenantId ? ('All_Madrasas/' + tenantId + '/Attendance') : '—'");
    expect(pull).toContain("source: 'verified_active_tenant'");
    expect(pull).toMatch(/if \(pullScope === 'attendance'\) \{\s*return pullAttendance\(pullTenant/);
    expect(pull).toMatch(/String\(pullTenant\) !== String\(verified\)/);
  });
});
