// ============================================================================
// EMS Query Utils — pure filter/search/sort/paginate helpers
// ----------------------------------------------------------------------------
// Shared by the browser Repository (ems-repository.js) AND the native Node
// engine (desktop/native-db.js) so pagination semantics are IDENTICAL across
// every backend (IndexedDB, fs-JSON, later SQLite). No storage/DOM access here.
// Priority 4: streaming top-K for first-page admission loads at 50k–100k scale.
// ============================================================================
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;               // Node (native engine)
    } else {
        root.EmsQueryUtils = api;           // Browser (repository)
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var STREAM_TOPK_MAX = 500;
    var DEFAULT_SEARCH_FIELDS = [
        'name', 'id', 'cnic', 'phone', 'class', 'fname', 'designation',
        'position', 'madrasaRollNo', 'wifaqRollNo'
    ];

    var INACTIVE_REGISTRATION_STATUSES = {
        pending: true,
        rejected: true,
        suspended: true,
        withdrawn: true,
        inactive: true,
        deleted: true,
        'withdrawn/transferred': true
    };

    var ACTIVE_REGISTRATION_ALIASES = {
        approved: true,
        enrolled: true,
        active: true,
        admit: true,
        admitted: true,
        confirmed: true
    };

    /** Normalize registration status for comparisons (case/whitespace insensitive). */
    function normalizeRegistrationStatus(status) {
        if (status == null) return '';
        return String(status).trim().toLowerCase();
    }

    /**
     * True when a registration row should appear in attendance / roster views.
     * Includes approved, enrolled, active, and legacy empty status values.
     */
    function isActiveRegistrationStatus(status) {
        var s = normalizeRegistrationStatus(status);
        if (!s) return true;
        if (INACTIVE_REGISTRATION_STATUSES[s]) return false;
        if (ACTIVE_REGISTRATION_ALIASES[s]) return true;
        return true;
    }

    /** Keep only rows with an active registration status. */
    function filterActiveRegistrations(rows) {
        var out = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r) continue;
            if (isActiveRegistrationStatus(r.status)) out.push(r);
        }
        return out;
    }

    /** Equality filter: { status:'approved', type:'student' } — all must match. */
    function matchFilter(row, filter) {
        if (!filter) return true;
        for (var k in filter) {
            if (!Object.prototype.hasOwnProperty.call(filter, k)) continue;
            if (k === 'statusActive') {
                var wantActive = filter[k] === true || filter[k] === 'true' || filter[k] === '1';
                if (wantActive !== isActiveRegistrationStatus(row.status)) return false;
                continue;
            }
            if (k === 'status' && (filter[k] === '__active__' || filter[k] === 'active')) {
                if (!isActiveRegistrationStatus(row.status)) return false;
                continue;
            }
            if (k === 'status') {
                var want = normalizeRegistrationStatus(filter[k]);
                var have = normalizeRegistrationStatus(row[k]);
                if (want && have !== want && !(
                    want === 'active' && isActiveRegistrationStatus(row[k])
                )) {
                    return false;
                }
                continue;
            }
            if (String(row[k] == null ? '' : row[k]) !== String(filter[k] == null ? '' : filter[k])) {
                return false;
            }
        }
        return true;
    }

    /** Substring search — field-wise (no haystack join) for large-tenant performance. */
    function matchSearch(row, search) {
        if (!search || !search.text) return true;
        var t = String(search.text).toLowerCase();
        if (t.length === 0) return true;
        var fields = (search.fields && search.fields.length) ? search.fields : DEFAULT_SEARCH_FIELDS;
        for (var i = 0; i < fields.length; i++) {
            var v = row[fields[i]];
            if (v != null && String(v).toLowerCase().indexOf(t) >= 0) return true;
        }
        return false;
    }

    function compareBySort(a, b, sort) {
        var dir = sort && sort.dir === 'desc' ? -1 : 1;
        var f = sort && sort.field ? sort.field : 'timestamp';
        var av = a[f], bv = b[f];
        if (av == null && bv == null) return 0;
        if (av == null) return -1 * dir;
        if (bv == null) return 1 * dir;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
    }

    function applySort(rows, sort) {
        if (!sort || !sort.field) return rows;
        return rows.slice().sort(function (a, b) {
            return compareBySort(a, b, sort);
        });
    }

    function sortNumericKey(row, field) {
        if (!row) return null;
        var v = row[field];
        if (v == null) return null;
        return Number(v) || 0;
    }

    var STREAM_TOPK_MIN_ROWS = 20000;

    function canStreamTopK(opts, allRows) {
        if (!opts || opts.limit == null || opts.limit < 0) return false;
        if ((opts.offset || 0) !== 0) return false;
        if (opts.limit > STREAM_TOPK_MAX) return false;
        if (opts.search && opts.search.text) return false;
        if (!allRows || allRows.length < STREAM_TOPK_MIN_ROWS) return false;
        var sort = opts.sort || { field: 'timestamp', dir: 'desc' };
        var f = sort.field ? String(sort.field) : 'timestamp';
        return f === 'timestamp' || f === '_ts';
    }

    /**
     * First-page fast path: O(n * limit) instead of O(n + m log m) for large match sets.
     * Preserves exact semantics of filter → search → timestamp sort → slice(0, limit).
     */
    function pageFromAllStreamTopK(allRows, opts) {
        var limit = opts.limit;
        var sort = opts.sort || { field: 'timestamp', dir: 'desc' };
        var field = sort.field ? String(sort.field) : 'timestamp';
        var desc = sort.dir !== 'asc';
        var buf = [];
        var total = 0;

        function consider(row) {
            total++;
            var key = sortNumericKey(row, field);
            if (buf.length < limit) {
                buf.push(row);
                return;
            }
            var evictIdx = 0;
            var evictKey = sortNumericKey(buf[0], field);
            for (var j = 1; j < buf.length; j++) {
                var k = sortNumericKey(buf[j], field);
                var worse = desc
                    ? (evictKey == null || (k != null && k < evictKey))
                    : (evictKey == null || (k != null && k > evictKey));
                if (worse) {
                    evictIdx = j;
                    evictKey = k;
                }
            }
            var replace = desc
                ? (key != null && (evictKey == null || key > evictKey))
                : (key != null && (evictKey == null || key < evictKey));
            if (replace) buf[evictIdx] = row;
        }

        for (var i = 0; i < allRows.length; i++) {
            var r = allRows[i];
            if (!r) continue;
            if (!matchFilter(r, opts.filter)) continue;
            if (!matchSearch(r, opts.search)) continue;
            consider(r);
        }

        buf.sort(function (a, b) { return compareBySort(a, b, sort); });
        return { rows: buf, total: total, offset: 0, limit: limit };
    }

    /**
     * Filter → search → sort → paginate over an in-memory array.
     * opts: { offset, limit, filter, sort:{field,dir}, search:{text,fields} }
     * Returns { rows, total, offset, limit }.
     */
    function pageFromAll(allRows, opts) {
        opts = opts || {};
        if (canStreamTopK(opts, allRows)) {
            return pageFromAllStreamTopK(allRows, opts);
        }
        var offset = Math.max(0, opts.offset || 0);
        var limit = opts.limit == null ? 100 : opts.limit;
        var filtered = [];
        for (var i = 0; i < allRows.length; i++) {
            var r = allRows[i];
            if (!r) continue;
            if (!matchFilter(r, opts.filter)) continue;
            if (!matchSearch(r, opts.search)) continue;
            filtered.push(r);
        }
        var sorted = applySort(filtered, opts.sort);
        var total = sorted.length;
        var rows = (limit < 0) ? sorted.slice(offset) : sorted.slice(offset, offset + limit);
        return { rows: rows, total: total, offset: offset, limit: limit };
    }

    function countFromAll(allRows, filter, search) {
        var n = 0;
        for (var i = 0; i < allRows.length; i++) {
            var r = allRows[i];
            if (!r) continue;
            if (!matchFilter(r, filter)) continue;
            if (!matchSearch(r, search)) continue;
            n++;
        }
        return n;
    }

    return {
        normalizeRegistrationStatus: normalizeRegistrationStatus,
        isActiveRegistrationStatus: isActiveRegistrationStatus,
        filterActiveRegistrations: filterActiveRegistrations,
        matchFilter: matchFilter,
        matchSearch: matchSearch,
        applySort: applySort,
        pageFromAll: pageFromAll,
        countFromAll: countFromAll,
        canStreamTopK: canStreamTopK
    };
});
