import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const finalState = require('../../functions/lib/attendance-final-state.js');

describe('server attendance final state', function () {
    it('counts a canonical + legacy person/day once and prefers canonical', function () {
        const rows = finalState.buildFinalAttendanceState([
            { id: 'att_rec_2026-08_students_A_p1', data: { timestamp: 200, records: { s1: { 1: 'P' } } } },
            { id: 'att_rec_2026-08_students_A_all', data: { timestamp: 100, records: { s1: { 1: 'A' } } } }
        ], '2026-08', { includeTypes: ['students'] });
        expect(Object.keys(rows)).toHaveLength(1);
        expect(rows['s1|1'].status).toBe('A');
        expect(rows['s1|1'].sourceDocId).toContain('_all');
    });

    it('excludes staff and event documents from student summaries', function () {
        const rows = finalState.buildFinalAttendanceState([
            { id: 'att_evt_e1', data: { records: { s1: { 1: 'P' } } } },
            { id: 'att_rec_2026-08_staff__all', data: { records: { s1: { 1: 'P' } } } },
            { id: 'att_rec_2026-08_students_Class_With_Underscore_all', data: { records: { s1: { 1: 'L' } } } }
        ], '2026-08', { includeTypes: ['students'] });
        expect(Object.keys(rows)).toEqual(['s1|1']);
        expect(rows['s1|1'].bucket).toBe('leave');
    });

    it('does not revive a deliberately cleared canonical day from a legacy period sheet', function () {
        const rows = finalState.buildFinalAttendanceState([
            { id: 'att_rec_2026-08_students_A_p1', data: { timestamp: 200, records: { s1: { 1: 'P' } } } },
            {
                id: 'att_rec_2026-08_students_A_all',
                data: { timestamp: 100, records: {}, clearedCells: { days: { s1: { 1: true } } } }
            }
        ], '2026-08', { includeTypes: ['students'] });
        expect(Object.keys(rows)).toEqual([]);
    });

    it('recovers a legacy cell missing from an incomplete canonical sheet', function () {
        const rows = finalState.buildFinalAttendanceState([
            { id: 'att_rec_2026-08_students_A_p1', data: { timestamp: 100, records: { s1: { 1: 'P', 2: 'A' } } } },
            { id: 'att_rec_2026-08_students_A_all', data: { timestamp: 200, records: { s1: { 1: 'L' } } } }
        ], '2026-08', { includeTypes: ['students'] });
        expect(rows['s1|1'].status).toBe('L');
        expect(rows['s1|2'].status).toBe('A');
    });

    it('trusts canonical-only state after the explicit migration completion marker', function () {
        const rows = finalState.buildFinalAttendanceState([
            { id: 'att_rec_2026-08_students_A_p1', data: { timestamp: 100, records: { s1: { 2: 'A' } } } },
            {
                id: 'att_rec_2026-08_students_A_all',
                data: { timestamp: 200, canonicalComplete: true, records: { s1: { 1: 'P' } } }
            }
        ], '2026-08', { includeTypes: ['students'] });
        expect(Object.keys(rows)).toEqual(['s1|1']);
    });

    it('recovers old literal dotted record fields for read-only reporting', function () {
        const rows = finalState.buildFinalAttendanceState([
            {
                id: 'att_rec_2026-08_students_A_all',
                data: { timestamp: 100, 'records.s1.1': 'A', 'records.s1.2': 'P' }
            }
        ], '2026-08', { includeTypes: ['students'] });
        expect(rows['s1|1'].status).toBe('A');
        expect(rows['s1|2'].status).toBe('P');
    });
});
