import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const migration = require('../../scripts/migrate-attendance-missing-canonical.js');

describe('attendance canonical migration safety', function () {
    it('maps teacher class/hour documents into one shared canonical register', function () {
        const info = migration.parseId('att_rec_2026-08_teachers_اولی_PRD-1');
        expect(migration.canonicalId(info)).toBe('att_rec_2026-08_teachers__all');
    });

    it('collects daily, hourly, notes and literal dotted legacy fields', function () {
        const candidates = migration.collectCandidates([
            {
                id: 'att_rec_2026-08_students_اولی_PRD-1',
                data: {
                    records: { S1: { 1: 'P' } },
                    remarks: { S1: { 1: 'نوٹ' } },
                    'periodRecords.S1.2.PRD-2': 'A'
                }
            }
        ]);
        const target = candidates['att_rec_2026-08_students_اولی_all'];
        expect(target.values['periodRecords.S1.1.PRD-1']).toEqual(['P']);
        expect(target.values['periodRecords.S1.2.PRD-2']).toEqual(['A']);
        expect(target.values['remarks.S1.1']).toEqual(['نوٹ']);
    });

    it('never resolves two different legacy values by guessing', function () {
        expect(migration.resolveValues(['P', 'A']).conflict).toBe(true);
        expect(migration.resolveValues(['P', 'P'])).toEqual({ value: 'P', conflict: false });
    });

    it('recognizes day and period tombstones before filling a missing cell', function () {
        const current = {
            clearedCells: {
                days: { S1: { 1: true } },
                periods: { S1: { 2: { P2: true } } }
            }
        };
        expect(migration.isTombstoned(current, 'records.S1.1')).toBe(true);
        expect(migration.isTombstoned(current, 'periodRecords.S1.1.P1')).toBe(true);
        expect(migration.isTombstoned(current, 'periodRecords.S1.2.P2')).toBe(true);
        expect(migration.isTombstoned(current, 'periodRecords.S1.2.P3')).toBe(false);
    });

    it('is idempotent: a second plan does not add an already migrated mark', function () {
        const candidate = migration.collectCandidates([
            {
                id: 'att_rec_2026-08_students_اولی_PRD-1',
                data: { records: { S1: { 1: 'P' } } }
            }
        ])['att_rec_2026-08_students_اولی_all'];

        const first = migration.planTarget({}, candidate);
        expect(first.added).toBe(1);
        expect(first.patch).toEqual({ 'periodRecords.S1.1.PRD-1': 'P' });

        const afterFirstMigration = {
            periodRecords: { S1: { 1: { 'PRD-1': 'P' } } }
        };
        const second = migration.planTarget(afterFirstMigration, candidate);
        expect(second.added).toBe(0);
        expect(second.existing).toBe(1);
        expect(second.patch).toEqual({});
    });
});
