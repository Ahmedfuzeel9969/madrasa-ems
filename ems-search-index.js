// EMS Search Index — compact field-aware tokens + row-level IDB documents (v3)
(function (global) {
    'use strict';

    var DEFAULT_FIELDS = ['name', 'id', 'cnic', 'phone', 'class', 'fname', 'designation'];
    var EXACT_FIELDS = ['id', 'phone', 'cnic'];
    var MIN_TOKEN_LEN = 2;
    var TRIGRAM_LEN = 3;
    var MAX_PREFIX_LEN = 8;
    var MAX_TRIGRAMS_PER_RUN = 6;

    function normalizeSearch(search) {
        if (!search) return '';
        if (typeof search === 'string') return search.trim().toLowerCase();
        if (search.text != null) return String(search.text).trim().toLowerCase();
        return '';
    }

    function searchFields(search) {
        if (search && search.fields && search.fields.length) return search.fields.slice();
        return DEFAULT_FIELDS.slice();
    }

    function alphanumericRuns(text) {
        var runs = String(text || '').toLowerCase().match(/[a-z0-9\u0600-\u06ff]+/g);
        return runs || [];
    }

    function addToken(bucket, token) {
        if (token && token.length >= MIN_TOKEN_LEN) bucket[token] = true;
    }

    /** Prefix ladder + full run for id/phone/cnic and numeric runs. */
    function addExactRunTokens(bucket, run) {
        if (!run || run.length < MIN_TOKEN_LEN) return;
        addToken(bucket, run);
        var max = Math.min(MAX_PREFIX_LEN, run.length);
        for (var len = MIN_TOKEN_LEN; len <= max; len++) {
            addToken(bucket, run.substring(0, len));
        }
    }

    /** Word + capped trigram sample for text fields. */
    function addTextRunTokens(bucket, run) {
        if (!run || run.length < MIN_TOKEN_LEN) return;
        if (run.length <= TRIGRAM_LEN + 1) {
            addToken(bucket, run);
            return;
        }
        addToken(bucket, run);
        var positions = [];
        var i;
        for (i = 0; i <= run.length - TRIGRAM_LEN; i++) positions.push(i);
        if (positions.length > MAX_TRIGRAMS_PER_RUN) {
            var head = positions.slice(0, Math.ceil(MAX_TRIGRAMS_PER_RUN / 2));
            var tail = positions.slice(-Math.floor(MAX_TRIGRAMS_PER_RUN / 2));
            positions = head.concat(tail);
        }
        for (i = 0; i < positions.length; i++) {
            addToken(bucket, run.substring(positions[i], positions[i] + TRIGRAM_LEN));
        }
    }

    function addRunTokens(bucket, run, exactField) {
        if (!run) return;
        if (exactField || /^[0-9]+$/.test(run)) addExactRunTokens(bucket, run);
        else addTextRunTokens(bucket, run);
    }

    function tokensFromText(text, exactField) {
        var bucket = Object.create(null);
        alphanumericRuns(text).forEach(function (run) {
            addRunTokens(bucket, run, exactField);
        });
        return Object.keys(bucket).sort();
    }

    function tokensFromRowFields(row, fields) {
        fields = fields || DEFAULT_FIELDS;
        var bucket = Object.create(null);
        if (!row || typeof row !== 'object') return [];
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var exact = EXACT_FIELDS.indexOf(field) >= 0;
            var val = row[field];
            if (val == null || val === '') continue;
            tokensFromText(String(val), exact).forEach(function (tok) {
                bucket[tok] = true;
            });
        }
        return Object.keys(bucket).sort();
    }

    /** Build searchable tokens for one row (compact — targets ~1 IDB doc / row). */
    global.emsSearchIndexTokensForRow = function (row, fields) {
        return tokensFromRowFields(row, fields);
    };

    /** Query tokens using the same rules as row indexing. */
    global.emsSearchIndexTokensForQuery = function (query) {
        query = normalizeSearch(query);
        if (!query) return [];
        return tokensFromText(query, false);
    };

    global.emsSearchIndexNormalizeSearch = normalizeSearch;
    global.emsSearchIndexDefaultFields = function () { return DEFAULT_FIELDS.slice(); };
    global.emsSearchIndexMinTokenLen = function () { return MIN_TOKEN_LEN; };
    global.emsSearchIndexRowDocVersion = function () { return 3; };

})(typeof window !== 'undefined' ? window : globalThis);
