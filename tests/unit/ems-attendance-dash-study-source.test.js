import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadEvtDashHelper(sessions) {
  const src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
  const start = src.indexOf('function evtDashDayStatusByUser');
  const end = src.indexOf('\nwindow.evtReadStore = evtReadStore;');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const fnSrc = src.slice(start, end);
  const sandbox = {
    localStorage: {
      getItem: function (k) {
        if (k === 'ems_att_symbols') return JSON.stringify({ P: 'P', A: 'A', L: 'L' });
        return null;
      }
    },
    attStatusKind: function (status) {
      var st = String(status || '').trim();
      if (st === 'P' || st === 'حاضر') return 'P';
      if (st === 'A' || st === 'غائب') return 'A';
      if (st === 'L' || st === 'رخصت') return 'L';
      return 'other';
    },
    attGetUserId: function (u) { return String((u && u.id) || ''); },
    evtReadStore: function () {
      return { version: 2, sheets: [], sessions: sessions || [] };
    }
  };
  vm.runInNewContext(fnSrc + '\nthis.evtDashDayStatusByUser = evtDashDayStatusByUser;', sandbox);
  return sandbox;
}

describe('Dashboard study source helper', function () {
  it('rolls up same-day study sessions per roster user', function () {
    const sb = loadEvtDashHelper([
      {
        id: 's1', sheetId: 'sh1', date: '2026-09-10',
        participants: [
          { id: 'u1', name: 'Ali', status: 'P' },
          { id: 'u2', name: 'Bilal', status: 'A' }
        ]
      },
      {
        id: 's2', sheetId: 'sh2', date: '2026-09-10',
        participants: [
          { id: 'u1', name: 'Ali', status: 'A' },
          { id: 'u3', name: 'Other', status: 'P' }
        ]
      }
    ]);
    const map = sb.evtDashDayStatusByUser('2026-09-10', [{ id: 'u1' }, { id: 'u2' }]);
    expect(map.u1).toBe('PARTIAL');
    expect(map.u2).toBe('A');
    expect(map.u3).toBeUndefined();
  });

  it('ignores sessions on other dates', function () {
    const sb = loadEvtDashHelper([
      { id: 's1', sheetId: 'sh1', date: '2026-09-09', participants: [{ id: 'u1', status: 'P' }] }
    ]);
    const map = sb.evtDashDayStatusByUser('2026-09-10', [{ id: 'u1' }]);
    expect(Object.keys(map)).toHaveLength(0);
  });
});
