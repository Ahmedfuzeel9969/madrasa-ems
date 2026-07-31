// ============================================================================
// EMS Registration Duplicate Detection — Sprint 3 (RAM scan, rules D1–D7)
// ============================================================================
(function (global) {
    'use strict';

    var CNIC_LEN = 13;
    var PHONE_MIN = 10;

    function digitsOnly(v) {
        return String(v || '').replace(/\D/g, '');
    }

    function normalizeCnic(v) {
        return digitsOnly(v);
    }

    function normalizePhone(v) {
        var d = digitsOnly(v);
        if (!d) return '';
        if (d.length > 11) d = d.slice(-11);
        if (d.length >= PHONE_MIN) return d.slice(-PHONE_MIN);
        return d;
    }

    function normalizeName(v) {
        return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function normalizeRoll(v) {
        return String(v || '').replace(/\s+/g, '').trim().toUpperCase();
    }

    function cnicFields(rec) {
        return [rec.cnic, rec.bform, rec.bForm, rec.grdCnic, rec.guaCnic];
    }

    function phoneFields(rec) {
        return [rec.phone, rec.grdMobile, rec.guaMobile, rec.whatsapp];
    }

    function rollFields(rec) {
        return [rec.madrasaRollNo, rec.rollNo, rec.wifaqRollNo];
    }

    function pushMatch(matches, seen, payload) {
        var key = payload.rule + '|' + payload.existingId + '|' + payload.field;
        if (seen[key]) return;
        seen[key] = true;
        matches.push(payload);
    }

    function buildMatch(rule, severity, field, value, rec, listKind) {
        return {
            rule: rule,
            severity: severity,
            field: field,
            value: value,
            existingId: rec.id,
            existingName: rec.name || '',
            existingClass: rec.class || rec.designation || rec.position || '',
            listKind: listKind || 'approved'
        };
    }

    function scanRecord(rec, candidate, opts, matches, seen) {
        if (!rec || !rec.id) return;
        var excludeId = opts.excludeId;
        if (excludeId && String(rec.id).toUpperCase() === String(excludeId).toUpperCase()) return;

        var listKind = opts._listKind || 'approved';
        var mode = opts.mode || 'all';

        var candCnic = normalizeCnic(candidate.cnic);
        var candBform = normalizeCnic(candidate.bform || candidate.bForm);
        var candPhone = normalizePhone(candidate.phone);
        var candName = normalizeName(candidate.name);
        var candFname = normalizeName(candidate.fname || candidate.fatherName);
        var candClass = normalizeName(candidate.class);
        var candRolls = rollFields(candidate).map(normalizeRoll).filter(Boolean);

        var i, norm, recNorm;

        if (mode === 'all' || mode === 'hard') {
            if (candCnic.length === CNIC_LEN) {
                for (i = 0; i < cnicFields(rec).length; i++) {
                    norm = normalizeCnic(cnicFields(rec)[i]);
                    if (norm && norm.length === CNIC_LEN && norm === candCnic) {
                        pushMatch(matches, seen, buildMatch('D1', 'hard', 'cnic', norm, rec, listKind));
                    }
                }
            }
            if (candBform.length === CNIC_LEN) {
                for (i = 0; i < cnicFields(rec).length; i++) {
                    norm = normalizeCnic(cnicFields(rec)[i]);
                    if (norm && norm.length === CNIC_LEN && norm === candBform) {
                        pushMatch(matches, seen, buildMatch('D2', 'hard', 'bform', norm, rec, listKind));
                    }
                }
            }
            if (candPhone.length >= PHONE_MIN) {
                for (i = 0; i < phoneFields(rec).length; i++) {
                    recNorm = normalizePhone(phoneFields(rec)[i]);
                    if (recNorm && recNorm.length >= PHONE_MIN && recNorm === candPhone) {
                        pushMatch(matches, seen, buildMatch('D3', 'hard', 'phone', recNorm, rec, listKind));
                    }
                }
            }
        }

        if (mode === 'all' || mode === 'soft') {
            if (candName && candFname) {
                var recName = normalizeName(rec.name);
                var recFname = normalizeName(rec.fname || rec.fatherName);
                if (recName === candName && recFname === candFname) {
                    pushMatch(matches, seen, buildMatch('D4', 'soft', 'name+fname', candName + ' / ' + candFname, rec, listKind));
                }
            }
            if (candName && candClass && candClass !== 'نامعلوم') {
                if (normalizeName(rec.name) === candName && normalizeName(rec.class) === candClass) {
                    pushMatch(matches, seen, buildMatch('D5', 'soft', 'name+class', candName + ' @ ' + candidate.class, rec, listKind));
                }
            }
            for (i = 0; i < candRolls.length; i++) {
                var cr = candRolls[i];
                for (var j = 0; j < rollFields(rec).length; j++) {
                    recNorm = normalizeRoll(rollFields(rec)[j]);
                    if (cr && recNorm && cr === recNorm) {
                        pushMatch(matches, seen, buildMatch('D6', 'soft', 'rollNo', cr, rec, listKind));
                    }
                }
            }
            if (candName && candPhone.length >= 7) {
                var tail = candPhone.slice(-7);
                for (i = 0; i < phoneFields(rec).length; i++) {
                    recNorm = normalizePhone(phoneFields(rec)[i]);
                    if (recNorm.length >= 7 && recNorm.slice(-7) === tail && normalizeName(rec.name) === candName) {
                        pushMatch(matches, seen, buildMatch('D7', 'soft', 'name+phone', candName + ' / …' + tail, rec, listKind));
                    }
                }
            }
        }
    }

    function iterateScope(scope, fn) {
        scope = scope || 'approved';
        if (scope === 'approved' || scope === 'all') {
            if (typeof global.emsRegRepoForEach === 'function') {
                global.emsRegRepoForEach(function (rec) {
                    fn(rec, 'approved');
                });
            }
        }
        if (scope === 'rejected' || scope === 'all') {
            if (typeof global.emsRegRepoGetRejectedList === 'function') {
                global.emsRegRepoGetRejectedList().forEach(function (rec) {
                    fn(rec, 'rejected');
                });
            }
        }
    }

    global.emsRegDupNormalizeCnic = normalizeCnic;
    global.emsRegDupNormalizePhone = normalizePhone;
    global.emsRegDupNormalizeName = normalizeName;

    global.emsRegCanOverrideHardDuplicate = function () {
        if (typeof global.emsRegCan === 'function' && global.emsRegCan('duplicate_override')) return true;
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;
        return false;
    };

    global.emsRegCheckDuplicates = function (candidate, opts) {
        candidate = candidate || {};
        opts = opts || {};
        var matches = [];
        var seen = Object.create(null);
        var scanOpts = {
            excludeId: opts.excludeId || candidate.id || null,
            mode: opts.mode || 'all'
        };

        iterateScope(opts.scope || 'all', function (rec, listKind) {
            scanOpts._listKind = listKind;
            scanRecord(rec, candidate, scanOpts, matches, seen);
        });

        var hard = matches.filter(function (m) { return m.severity === 'hard'; });
        var soft = matches.filter(function (m) { return m.severity === 'soft'; });

        return {
            hasHard: hard.length > 0,
            hasSoft: soft.length > 0,
            matches: matches,
            hard: hard,
            soft: soft
        };
    };

    global.emsRegCheckFieldDuplicate = function (field, value, opts) {
        opts = opts || {};
        var candidate = { id: opts.excludeId || null };
        if (field === 'cnic' || field === 'bform') candidate.cnic = value;
        else if (field === 'phone') candidate.phone = value;
        else if (field === 'name') candidate.name = value;
        else if (field === 'fname') candidate.fname = value;
        else candidate[field] = value;

        var mode = (field === 'cnic' || field === 'phone' || field === 'bform') ? 'hard' : 'all';
        return global.emsRegCheckDuplicates(candidate, {
            excludeId: opts.excludeId || null,
            scope: opts.scope || 'all',
            mode: mode
        });
    };

    global.emsRegCheckDuplicatesAsync = function (candidate, opts) {
        return Promise.resolve(global.emsRegCheckDuplicates(candidate, opts));
    };
})(typeof window !== 'undefined' ? window : globalThis);
