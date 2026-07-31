import { describe, it, expect } from 'vitest';
import EmsQueryUtils from '../../ems-query-utils.js';

describe('EmsQueryUtils — active registration status', function () {
    it('treats approved and enrolled as active (case insensitive)', function () {
        expect(EmsQueryUtils.isActiveRegistrationStatus('approved')).toBe(true);
        expect(EmsQueryUtils.isActiveRegistrationStatus('Approved')).toBe(true);
        expect(EmsQueryUtils.isActiveRegistrationStatus('enrolled')).toBe(true);
        expect(EmsQueryUtils.isActiveRegistrationStatus('Enrolled')).toBe(true);
        expect(EmsQueryUtils.isActiveRegistrationStatus('active')).toBe(true);
        expect(EmsQueryUtils.isActiveRegistrationStatus('')).toBe(true);
        expect(EmsQueryUtils.isActiveRegistrationStatus(null)).toBe(true);
    });

    it('excludes pending, rejected, suspended, withdrawn', function () {
        expect(EmsQueryUtils.isActiveRegistrationStatus('pending')).toBe(false);
        expect(EmsQueryUtils.isActiveRegistrationStatus('rejected')).toBe(false);
        expect(EmsQueryUtils.isActiveRegistrationStatus('suspended')).toBe(false);
        expect(EmsQueryUtils.isActiveRegistrationStatus('withdrawn')).toBe(false);
    });

    it('filterActiveRegistrations keeps approved students', function () {
        var rows = [
            { id: '1', status: 'Approved', type: 'student' },
            { id: '2', status: 'enrolled', type: 'student' },
            { id: '3', status: 'pending', type: 'student' },
            { id: '4', type: 'student' }
        ];
        var out = EmsQueryUtils.filterActiveRegistrations(rows);
        expect(out.map(function (r) { return r.id; })).toEqual(['1', '2', '4']);
    });

    it('matchFilter supports statusActive and case-insensitive status', function () {
        var row = { id: '1', status: 'Approved', type: 'student' };
        expect(EmsQueryUtils.matchFilter(row, { statusActive: true })).toBe(true);
        expect(EmsQueryUtils.matchFilter(row, { status: 'approved' })).toBe(true);
        expect(EmsQueryUtils.matchFilter(row, { status: '__active__' })).toBe(true);
        expect(EmsQueryUtils.matchFilter({ id: '2', status: 'pending' }, { statusActive: true })).toBe(false);
    });
});
