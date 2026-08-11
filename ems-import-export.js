// ============================================================================
// EMS Import / Export / Migration — Enterprise Grade
// Excel/CSV/JSON/XML, intelligent field matching, preview, validation,
// conflict resolution, 7-step wizard, chunked Firestore writes, history.
// ============================================================================
(function (global) {
    'use strict';

    var HISTORY_KEY = 'ems_import_history';
    var STAGING_KEY = 'ems_import_staging_v1';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function usersKey() { return (global.DB && global.DB.users) ? global.DB.users : 'ems_full_users'; }
    function loadUsers() {
        if (typeof global.emsGetUsersMerged === 'function') return global.emsGetUsersMerged();
        if (typeof global.emsCacheGet === 'function') return global.emsCacheGet(usersKey(), []);
        try { return JSON.parse(localStorage.getItem(usersKey()) || '[]'); } catch (e) { return []; }
    }
    function toast(m, t) { if (global.showToast) global.showToast(m, t || 'success'); }

    function regAuditImport(report, type, conflict, extra) {
        if (typeof global.emsRegLogAudit !== 'function') return;
        extra = extra || {};
        global.emsRegLogAudit('import', extra.entityId || ('batch-' + Date.now()), {
            source: 'import',
            entityType: type,
            conflict: conflict || 'skip',
            added: report && report.added,
            updated: report && report.updated,
            skipped: report && report.skipped,
            errors: report && report.errors,
            total: report && report.total,
            fileName: extra.fileName || null
        });
    }

    function regAuditExport(format, count, filters) {
        if (typeof global.emsRegLogAudit !== 'function') return;
        global.emsRegLogAudit('export', 'batch-' + Date.now(), {
            source: 'export',
            format: format,
            count: count,
            filters: filters || null
        });
    }

    function getImportTenantId() {
        if (typeof global.emsResolveFirestoreTenantId === 'function') {
            var resolved = global.emsResolveFirestoreTenantId();
            if (resolved) return resolved;
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        var user = (global.firebase && firebase.auth().currentUser) || null;
        return user ? user.uid : null;
    }

    function cleanRecord(r, type) {
        var clean = {};
        Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') clean[k] = r[k]; });
        if (!clean.type) clean.type = type;
        if (!clean.status) clean.status = 'approved';
        if (!clean.timestamp) clean.timestamp = Date.now();
        if (!clean.date) clean.date = new Date().toISOString().slice(0, 10);
        if (typeof global.emsStampDepartment === 'function') global.emsStampDepartment(clean);
        return clean;
    }

    // ---------------- Field definitions + aliases ----------------
    function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-./]+/g, '').trim(); }

    var FIELD_DEFS = {
        student: [
            { k: 'id', label: 'آئی ڈی', aliases: ['id', 'studentid', 'rollno', 'roll', 'formno', 'فارمنمبر', 'آئیڈی', 'رول'] },
            { k: 'name', label: 'نام', aliases: ['name', 'studentname', 'fullname', 'طالبعلم', 'طالبعلمکانام', 'اسمالطالب', 'نام', 'ناموولدیت', 'ناممعولدیت', 'نامبمعولدیت', 'student', 'طالب'] },
            { k: 'fname', label: 'ولدیت', aliases: ['father', 'fathername', 'والد', 'ولدیت', 'اسمالأب', 'guardianname'] },
            { k: 'cnic', label: 'شناختی نمبر', aliases: ['cnic', 'nic', 'bform', 'شناختی', 'بیفارم', 'الهوية'] },
            { k: 'phone', label: 'موبائل', aliases: ['phone', 'mobile', 'contact', 'cell', 'موبائل', 'رابطہ', 'جوال', 'موبائلنمبر'] },
            { k: 'dob', label: 'تاریخ پیدائش', aliases: ['dob', 'dateofbirth', 'birth', 'تاریخپیدائش', 'الميلاد'] },
            { k: 'bloodGroup', label: 'بلڈ گروپ', aliases: ['blood', 'bloodgroup', 'بلڈ', 'بلڈگروپ', 'فصيلةالدم'] },
            { k: 'class', label: 'درجہ', aliases: ['class', 'grade', 'درجہ', 'کلاس', 'الصف', 'مطلوبہدرجہ'] },
            { k: 'branch', label: 'برانچ', aliases: ['branch', 'شاخ', 'برانچ', 'الفرع'] },
            { k: 'madrasaRollNo', label: 'مدرسہ رول نمبر', aliases: ['madrasaroll', 'madrasarollno', 'madrasroll', 'مدرسہرول', 'مدرسہرولنمبر'] },
            { k: 'wifaqRollNo', label: 'وفاق رول نمبر', aliases: ['wifaqroll', 'wifaqrollno', 'وفاقرول', 'وفاقرولنمبر', 'wifaq'] },
            { k: 'address', label: 'پتہ', aliases: ['address', 'پتہ', 'العنوان'] },
            { k: 'grdName', label: 'سرپرست', aliases: ['guardian', 'سرپرست', 'سرپرستکانام', 'ولي'] },
            { k: 'grdMobile', label: 'سرپرست موبائل', aliases: ['guardianphone', 'guardianmobile', 'سرپرستموبائل'] }
        ],
        teacher: [
            { k: 'id', label: 'آئی ڈی', aliases: ['id', 'empid', 'employeeid', 'آئیڈی', 'ملازمنمبر'] },
            { k: 'name', label: 'نام', aliases: ['name', 'teachername', 'استاد', 'استادکانام', 'نام', 'اسمالمعلم'] },
            { k: 'fname', label: 'ولدیت', aliases: ['father', 'fathername', 'والد', 'ولدیت'] },
            { k: 'cnic', label: 'شناختی نمبر', aliases: ['cnic', 'nic', 'شناختی'] },
            { k: 'phone', label: 'موبائل', aliases: ['phone', 'mobile', 'contact', 'موبائل', 'رابطہ'] },
            { k: 'dob', label: 'تاریخ پیدائش', aliases: ['dob', 'dateofbirth', 'تاریخپیدائش'] },
            { k: 'bloodGroup', label: 'بلڈ گروپ', aliases: ['blood', 'bloodgroup', 'بلڈ'] },
            { k: 'designation', label: 'عہدہ', aliases: ['designation', 'post', 'عہدہ', 'المنصب'] },
            { k: 'department', label: 'شعبہ', aliases: ['department', 'dept', 'شعبہ', 'القسم'] },
            { k: 'salary', label: 'تنخواہ', aliases: ['salary', 'pay', 'تنخواہ', 'الراتب'] },
            { k: 'address', label: 'پتہ', aliases: ['address', 'پتہ', 'العنوان'] }
        ],
        staff: [
            { k: 'id', label: 'آئی ڈی', aliases: ['id', 'empid', 'employeeid', 'آئیڈی'] },
            { k: 'name', label: 'نام', aliases: ['name', 'staffname', 'ملازم', 'ملازمکانام', 'نام'] },
            { k: 'fname', label: 'ولدیت', aliases: ['father', 'fathername', 'والد', 'ولدیت'] },
            { k: 'cnic', label: 'شناختی نمبر', aliases: ['cnic', 'nic', 'شناختی'] },
            { k: 'phone', label: 'موبائل', aliases: ['phone', 'mobile', 'موبائل', 'رابطہ'] },
            { k: 'dob', label: 'تاریخ پیدائش', aliases: ['dob', 'dateofbirth', 'تاریخپیدائش', 'عمر'] },
            { k: 'position', label: 'آسامی', aliases: ['position', 'post', 'آسامی', 'عہدہ', 'الوظيفة'] },
            { k: 'salary', label: 'تنخواہ', aliases: ['salary', 'pay', 'تنخواہ'] },
            { k: 'address', label: 'پتہ', aliases: ['address', 'پتہ', 'العنوان'] }
        ]
    };

    function fieldsFor(type) { return FIELD_DEFS[type] || FIELD_DEFS.student; }

    function autoMatch(headers, type) {
        var defs = fieldsFor(type);
        var map = {}; // headerIndex -> fieldKey
        headers.forEach(function (h, i) {
            var nh = norm(h);
            if (!nh) return;
            var best = '';
            defs.forEach(function (d) {
                if (best) return;
                if (norm(d.label) === nh || d.k.toLowerCase() === nh) best = d.k;
                else if (d.aliases.some(function (a) { return norm(a) === nh; })) best = d.k;
            });
            if (!best) {
                defs.forEach(function (d) {
                    if (best) return;
                    if (d.aliases.some(function (a) { var na = norm(a); return na && (nh.indexOf(na) >= 0 || na.indexOf(nh) >= 0); })) best = d.k;
                });
            }
            if (best) map[i] = best;
        });
        return map;
    }

    // ---------------- File parsing ----------------
    var _xlsxReady = null;

    function ensureXlsxReady() {
        if (global.XLSX) return Promise.resolve();
        if (_xlsxReady) return _xlsxReady;
        var loader = typeof global.emsLoadXlsxLib === 'function'
            ? global.emsLoadXlsxLib
            : (typeof global.emsLoadExportLibs === 'function' ? global.emsLoadExportLibs : null);
        if (loader) {
            _xlsxReady = loader().then(function () {
                if (!global.XLSX) throw new Error('Excel لائبریری لوڈ نہیں');
            }).catch(function (err) {
                _xlsxReady = null;
                throw err;
            });
            return _xlsxReady;
        }
        return Promise.reject(new Error('Excel لائبریری لوڈ نہیں'));
    }

    function parseFile(file) {
        var ext = (file.name.split('.').pop() || '').toLowerCase();

        if (ext === 'json') {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onerror = function () { reject(new Error('فائل پڑھی نہ جا سکی')); };
                reader.onload = function (e) {
                    try {
                        var data = JSON.parse(e.target.result);
                        var arr = Array.isArray(data) ? data : (data.records || data.data || []);
                        if (!arr.length) return reject(new Error('JSON میں ریکارڈ نہیں'));
                        var headers = Object.keys(arr[0]);
                        var rows = arr.map(function (o) { return headers.map(function (h) { return o[h]; }); });
                        resolve({ headers: headers, rows: rows });
                    } catch (err) { reject(new Error('غلط JSON')); }
                };
                reader.readAsText(file);
            });
        }

        if (ext === 'xml') {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onerror = function () { reject(new Error('فائل پڑھی نہ جا سکی')); };
                reader.onload = function (e) {
                    try {
                        var doc = new DOMParser().parseFromString(e.target.result, 'text/xml');
                        var recs = doc.documentElement.children;
                        if (!recs.length) return reject(new Error('XML میں ریکارڈ نہیں'));
                        var headersSet = {};
                        var objs = [];
                        Array.prototype.forEach.call(recs, function (rec) {
                            var o = {};
                            Array.prototype.forEach.call(rec.children, function (c) { o[c.tagName] = c.textContent; headersSet[c.tagName] = 1; });
                            objs.push(o);
                        });
                        var headers = Object.keys(headersSet);
                        var rows = objs.map(function (o) { return headers.map(function (h) { return o[h] || ''; }); });
                        resolve({ headers: headers, rows: rows });
                    } catch (err) { reject(new Error('غلط XML')); }
                };
                reader.readAsText(file);
            });
        }

        return ensureXlsxReady().then(function () {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onerror = function () { reject(new Error('فائل پڑھی نہ جا سکی')); };
                reader.onload = function (e) {
                    try {
                        var wb;
                        if (ext === 'csv') wb = global.XLSX.read(e.target.result, { type: 'string' });
                        else wb = global.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                        var ws = wb.Sheets[wb.SheetNames[0]];
                        var aoa = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
                        if (!aoa.length) return reject(new Error('شیٹ خالی ہے'));
                        var headers = (aoa[0] || []).map(function (h) { return String(h).trim(); });
                        var rows = aoa.slice(1);
                        resolve(normalizeParsedSheet({ headers: headers, rows: rows, rawAoa: aoa }));
                    } catch (err) { reject(new Error('Excel پڑھنے میں مسئلہ')); }
                };
                if (ext === 'csv') reader.readAsText(file);
                else reader.readAsArrayBuffer(file);
            });
        });
    }

    // ---------------- Validation ----------------
    function idPrefixFor(type) {
        return type === 'student' ? 'STD' : type === 'teacher' ? 'TCH' : 'STF';
    }

    function parseIdNum(id) {
        var parts = String(id || '').split('-');
        if (parts.length > 1) {
            var num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num)) return num;
        }
        return 0;
    }

    function formatSequentialId(type, num) {
        var prefix = idPrefixFor(type);
        var formattedNum = num < 10 ? '0' + num : String(num);
        return prefix + '-' + formattedNum;
    }

    function maxExistingIdNum(type) {
        var maxNum = 0;
        function scan(list) {
            (list || []).forEach(function (u) {
                if (!u || u.type !== type || !u.id) return;
                var n = parseIdNum(u.id);
                if (n > maxNum) maxNum = n;
            });
        }
        scan(loadUsers());
        try {
            var rejected = typeof window.emsRegRepoGetRejectedList === 'function'
                ? window.emsRegRepoGetRejectedList()
                : (typeof window.emsCacheGet === 'function'
                    ? window.emsCacheGet('ems_rejected_users', [])
                    : []);
            scan(rejected);
        } catch (e) { }
        return maxNum;
    }

    function detectHeaderRowIndex(aoa) {
        for (var r = 0; r < Math.min(20, aoa.length); r++) {
            var row = aoa[r] || [];
            var nonEmpty = 0;
            var text = '';
            for (var c = 0; c < row.length; c++) {
                var cell = String(row[c] == null ? '' : row[c]).trim();
                if (cell) nonEmpty++;
                text += ' ' + norm(cell);
            }
            if (nonEmpty >= 2 && (text.indexOf('نام') >= 0 || text.indexOf('name') >= 0 || text.indexOf('ولدیت') >= 0 ||
                text.indexOf('father') >= 0 || text.indexOf('cnic') >= 0 || text.indexOf('mobile') >= 0 ||
                text.indexOf('موبائل') >= 0 || text.indexOf('class') >= 0 || text.indexOf('درجہ') >= 0)) {
                return r;
            }
        }
        return 0;
    }

    function normalizeParsedSheet(parsed) {
        if (parsed.rawAoa && parsed.rawAoa.length > 1) {
            var hi = detectHeaderRowIndex(parsed.rawAoa);
            if (hi > 0) {
                parsed.headers = (parsed.rawAoa[hi] || []).map(function (h) { return String(h).trim(); });
                parsed.rows = parsed.rawAoa.slice(hi + 1);
            }
        }
        parsed.rows = (parsed.rows || []).filter(function (row) {
            return row && row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; });
        });
        return parsed;
    }

    function forwardFillColumns(rows, map) {
        var fillFields = { name: 1, fname: 1, class: 1, branch: 1, designation: 1, department: 1, position: 1 };
        Object.keys(map || {}).forEach(function (idx) {
            if (!fillFields[map[idx]]) return;
            var col = parseInt(idx, 10);
            if (isNaN(col)) return;
            var last = '';
            for (var r = 0; r < rows.length; r++) {
                var val = rows[r][col];
                if (val != null && String(val).trim() !== '') last = val;
                else if (last !== '') rows[r][col] = last;
            }
        });
    }

    function resolveRecordName(rec) {
        var fields = ['name', 'fname', 'grdName', 'designation', 'position', 'class'];
        for (var i = 0; i < fields.length; i++) {
            var v = String(rec[fields[i]] == null ? '' : rec[fields[i]]).trim();
            if (v) return v;
        }
        return '';
    }

    function cloneRecord(r) {
        var o = {};
        Object.keys(r || {}).forEach(function (k) { o[k] = r[k]; });
        return o;
    }

    function prepareRecordsForCommit(records, type, conflict) {
        var existingIds = {};
        loadUsers().forEach(function (u) { if (u && u.id) existingIds[String(u.id)] = true; });
        var seen = {};
        var nextIdNum = maxExistingIdNum(type);
        function nextId() { nextIdNum += 1; return formatSequentialId(type, nextIdNum); }

        records.forEach(function (rec) {
            rec.name = resolveRecordName(rec);
            if (!rec.name) {
                rec._skip = 'no_name';
                return;
            }
            delete rec._skip;

            var id = String(rec.id || '').trim();
            if (!id || seen[id]) {
                rec.id = nextId();
                rec._idGenerated = true;
            } else if (existingIds[id] && conflict === 'duplicate') {
                rec.id = nextId();
                rec._idGenerated = true;
            } else {
                rec.id = id;
            }
            seen[rec.id] = 1;
            rec._existing = !!existingIds[rec.id];
        });
        return records;
    }

    function buildRecords(parsed, map, type) {
        var existing = loadUsers();
        var existingIds = {};
        existing.forEach(function (u) { if (u && u.id) existingIds[String(u.id)] = u; });
        var seenIds = {};
        var records = [];
        var nextIdNum = maxExistingIdNum(type);
        var lastName = '';

        function nextSequentialId() {
            nextIdNum += 1;
            return formatSequentialId(type, nextIdNum);
        }

        forwardFillColumns(parsed.rows, map);

        parsed.rows.forEach(function (row, ri) {
            var rec = { type: type };
            Object.keys(map).forEach(function (idx) {
                var col = parseInt(idx, 10);
                var val = row[col != null && !isNaN(col) ? col : idx];
                rec[map[idx]] = (val == null ? '' : String(val).trim());
            });
            rec.name = resolveRecordName(rec);
            if (!rec.name && lastName) rec.name = lastName;
            if (rec.name) lastName = rec.name;
            if (!rec.name) { rec._skip = 'no_name'; }
            // ID assign — unique per row (generateAutoID in a loop returns the same id)
            if (!rec.id) {
                rec.id = nextSequentialId();
                rec._idGenerated = true;
            } else {
                rec.id = String(rec.id).trim();
            }
            // duplicate within file → new sequential id
            if (seenIds[rec.id]) {
                rec.id = nextSequentialId();
                rec._idGenerated = true;
                rec._dupInFile = true;
            }
            seenIds[rec.id] = 1;
            rec._existing = !!existingIds[rec.id];
            // validations
            rec._issues = [];
            if (!rec.name) rec._issues.push('نام خالی');
            if (rec.phone && !/^[0-9+\-\s]{7,15}$/.test(rec.phone)) rec._issues.push('فون مشکوک');
            if (rec.dob && isNaN(new Date(rec.dob).getTime()) && !/^\d/.test(rec.dob)) rec._issues.push('تاریخ مشکوک');
            if (rec._dupInFile) rec._issues.push('فائل میں مکرر ID — نئی ID دی گئی');
            rec._stamp = new Date().getTime();
            records.push(rec);
        });
        return records;
    }

    function summarize(records) {
        var s = { total: records.length, valid: 0, newCount: 0, existing: 0, problems: 0 };
        records.forEach(function (r) {
            if (r._skip || r._issues.length) s.problems++;
            else s.valid++;
            if (r._existing) s.existing++; else s.newCount++;
        });
        return s;
    }

    // ---------------- Commit (chunked Firestore / import queue E10) ----------------
    function commitDirect(records, conflict, type, onProgress) {
        return new Promise(function (resolve, reject) {
            records = prepareRecordsForCommit(records.map(cloneRecord), type, conflict || 'skip');
            var user = (global.firebase && firebase.auth().currentUser) || null;
            var db = (typeof global.getDbOrNull === 'function') ? global.getDbOrNull() : null;
            var tenantId = getImportTenantId();
            var report = { added: 0, updated: 0, skipped: 0, errors: 0, total: records.length };
            var toWrite = [];
            records.forEach(function (r) {
                if (r._skip) { report.skipped++; return; }
                if (r._existing && conflict === 'skip') { report.skipped++; return; }
                toWrite.push(r);
            });

            if (!toWrite.length) return resolve(report);

            if (!user || !db || !tenantId) {
                toWrite.forEach(function (r) { r._existing ? report.updated++ : report.added++; });
                applyLocal(toWrite.map(function (r) { return cleanRecord(r, type); }), conflict)
                    .then(function () {
                        regAuditImport(report, type, conflict);
                        resolve(report);
                    })
                    .catch(reject);
                return;
            }

            var ref = db.collection('All_Madrasas').doc(tenantId).collection('Registrations');
            var BATCH = 400;
            var i = 0;
            var written = [];

            function finish() {
                var localP = written.length ? applyLocal(written, conflict) : Promise.resolve();
                localP.then(function () {
                    if (report.errors && !written.length) {
                        reject(new Error('Firestore محفوظ ناکام — ' + report.errors + ' ریکارڈ'));
                    } else {
                        regAuditImport(report, type, conflict);
                        resolve(report);
                    }
                }).catch(reject);
            }

            function next() {
                if (i >= toWrite.length) return finish();
                var slice = toWrite.slice(i, i + BATCH);
                var batch = db.batch();
                var sliceWritten = [];
                slice.forEach(function (r) {
                    var clean = cleanRecord(r, type);
                    batch.set(ref.doc(String(r.id)), clean, { merge: conflict === 'update' });
                    sliceWritten.push(clean);
                    r._existing ? report.updated++ : report.added++;
                });
                batch.commit().then(function () {
                    written = written.concat(sliceWritten);
                    i += BATCH;
                    if (onProgress) onProgress(Math.min(i, toWrite.length), toWrite.length);
                    setTimeout(next, 30);
                }).catch(function (err) {
                    report.errors += slice.length;
                    report.added = Math.max(0, report.added - slice.filter(function (r) { return !r._existing; }).length);
                    report.updated = Math.max(0, report.updated - slice.filter(function (r) { return r._existing; }).length);
                    console.error('[EMS Import] Firestore batch failed:', err);
                    i += BATCH;
                    if (onProgress) onProgress(Math.min(i, toWrite.length), toWrite.length);
                    setTimeout(next, 30);
                });
            }
            next();
        });
    }

    function commit(records, conflict, type, onProgress) {
        if (typeof global.emsRegRequire === 'function' && !global.emsRegRequire('import')) {
            return Promise.reject(new Error('Import permission denied'));
        }
        records = records || [];
        if (records.length > 500 && typeof global.emsImportQueueCommit === 'function') {
            return global.emsImportQueueCommit(records, {
                conflict: conflict,
                type: type,
                onProgress: onProgress
            });
        }
        return commitDirect(records, conflict, type, onProgress);
    }

    global.emsImportCommitDirect = commitDirect;

    function syncImportedToRepo(records) {
        if (!records || !records.length) return Promise.resolve();
        if (typeof global.emsRegRepoUpsert === 'function') {
            var tid = getImportTenantId();
            if (tid && typeof global.emsRegRepoInit === 'function') {
                try { global.emsRegRepoInit(tid); } catch (eInit) { /* ignore */ }
            }
            var idx = 0;
            var BATCH = 40;
            function nextBatch() {
                if (idx >= records.length) return Promise.resolve();
                var slice = records.slice(idx, idx + BATCH);
                idx += BATCH;
                return Promise.all(slice.map(function (rec) {
                    return global.emsRegRepoUpsert(rec);
                })).then(nextBatch);
            }
            return nextBatch();
        }
        if (typeof global.emsRegRepoMirrorBulk === 'function') {
            return Promise.resolve(global.emsRegRepoMirrorBulk(records));
        }
        return Promise.resolve();
    }

    function applyLocal(toWrite, conflict) {
        conflict = conflict || 'skip';
        var key = usersKey();
        var users = loadUsers();
        var byId = {};
        var merged = [];
        users.forEach(function (u, idx) { if (u && u.id) byId[String(u.id)] = idx; });
        toWrite.forEach(function (r) {
            var clean = {};
            Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') clean[k] = r[k]; });
            if (!clean.id) return;
            if (byId[clean.id] != null) {
                users[byId[clean.id]] = conflict === 'update'
                    ? Object.assign({}, users[byId[clean.id]], clean)
                    : clean;
                merged.push(users[byId[clean.id]]);
            } else {
                users.push(clean);
                byId[clean.id] = users.length - 1;
                merged.push(clean);
            }
        });
        try { localStorage.setItem(key, JSON.stringify(users)); } catch (e) { /* ignore */ }
        return syncImportedToRepo(merged).then(function () {
            if (typeof global.emsBroadcastUsersChanged === 'function') {
                global.emsBroadcastUsersChanged();
            }
            if (global.renderRegTable) try { global.renderRegTable(); } catch (eRt) { /* ignore */ }
        });
    }

    // ---------------- History & Staging ----------------
    function saveHistoryList(list) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { }
        if (global.EmsDirect && global.EmsDirect.isDirectKey(HISTORY_KEY)) {
            try { global.EmsDirect.persist(HISTORY_KEY, list); } catch (e) { }
        }
    }

    function addHistory(entry) {
        var list = [];
        try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { }
        list.push(entry);
        saveHistoryList(list);
    }

    function getHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }

    function updateHistoryEntry(id, patch) {
        var list = getHistory();
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === id) { idx = i; break; }
        }
        if (idx < 0) return false;
        list[idx] = Object.assign({}, list[idx], patch);
        saveHistoryList(list);
        return true;
    }

    function deleteHistoryEntry(id) {
        var list = getHistory().filter(function (h) { return h && h.id !== id; });
        saveHistoryList(list);
        var map = loadStagingMap();
        var changed = false;
        if (map[id]) {
            delete map[id];
            changed = true;
        }
        Object.keys(map).forEach(function (key) {
            if (map[key] && map[key].historyId === id) {
                delete map[key];
                changed = true;
            }
        });
        if (changed) saveStagingMap(map);
        return true;
    }

    function loadStagingMap() {
        try {
            var raw = localStorage.getItem(STAGING_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function saveStagingMap(map) {
        try { localStorage.setItem(STAGING_KEY, JSON.stringify(map || {})); } catch (e) { }
    }

    function stageImportBatch(opts) {
        opts = opts || {};
        var records = opts.records || [];
        if (!records.length) return Promise.reject(new Error('کوئی ریکارڈ نہیں'));
        var id = opts.id || ('imp-' + Date.now());
        var s = summarize(records);
        var smart = smartValidate(records);
        var noNameCount = records.filter(function (r) { return r._skip === 'no_name'; }).length;
        var stagingEntry = {
            historyId: id,
            type: opts.type || 'student',
            conflict: opts.conflict || 'skip',
            mode: opts.mode || 'legacy',
            fileName: opts.fileName || 'import',
            records: records,
            createdAt: new Date().toISOString()
        };
        var map = loadStagingMap();
        map[id] = stagingEntry;
        saveStagingMap(map);
        addHistory({
            id: id,
            status: 'pending',
            fileName: stagingEntry.fileName,
            mode: stagingEntry.mode,
            type: stagingEntry.type,
            conflict: stagingEntry.conflict,
            recordCount: records.length,
            validCount: s.valid,
            newCount: s.newCount,
            existingCount: s.existing,
            problemCount: s.problems,
            noNameCount: noNameCount,
            at: new Date().toISOString(),
            processedAt: null,
            by: (global.firebase && firebase.auth().currentUser && firebase.auth().currentUser.email) || '—',
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            smartIssues: smart.count,
            stagingId: id
        });
        return Promise.resolve({
            staged: true,
            historyId: id,
            recordCount: records.length,
            validCount: s.valid,
            summary: s,
            smartIssues: smart.count
        });
    }

    function processPendingImport(historyId) {
        var list = getHistory();
        var entry = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === historyId) { entry = list[i]; break; }
        }
        if (!entry) return Promise.reject(new Error('امپورٹ نہیں ملا'));
        if (entry.status === 'completed') return Promise.reject(new Error('یہ امپورٹ پہلے ہی مکمل ہو چکی ہے'));
        var stagingMap = loadStagingMap();
        var staging = stagingMap[historyId] || stagingMap[entry.stagingId];
        if (!staging || !staging.records || !staging.records.length) {
            return Promise.reject(new Error('Staging ڈیٹا نہیں ملا — فائل دوبارہ اپ لوڈ کریں'));
        }
        updateHistoryEntry(historyId, { status: 'processing' });
        createSnapshot();
        var type = staging.type || entry.type || 'student';
        var conflict = staging.conflict || entry.conflict || 'skip';
        var records = prepareRecordsForCommit(staging.records.map(cloneRecord), type, conflict);
        var useQueue = records.length > 100 && typeof global.emsImportQueueProcess === 'function';
        var run;
        if (useQueue) {
            if (typeof global.emsImportQueueCreate === 'function') {
                global.emsImportQueueCreate({
                    id: historyId,
                    historyId: historyId,
                    type: type,
                    conflict: conflict,
                    fileName: entry.fileName,
                    records: records
                });
            }
            run = global.emsImportQueueProcess(historyId, records, {
                type: type,
                conflict: conflict,
                onProgress: function (done, total) {
                    updateHistoryEntry(historyId, {
                        status: 'processing',
                        queueProgress: Math.round((done / total) * 100)
                    });
                }
            });
        } else {
            var useBulk = records.length > 400 && typeof global.emsBulkImportViaCf === 'function';
            run = useBulk
                ? global.emsBulkImportViaCf(records, type, conflict).then(function (res) {
                    if (global.renderRegTable) try { global.renderRegTable(); } catch (e) { }
                    return res.report || res;
                })
                : commit(records, conflict, type);
        }
        return run.then(function (report) {
            updateHistoryEntry(historyId, {
                status: 'completed',
                processedAt: new Date().toISOString(),
                added: report.added || 0,
                updated: report.updated || 0,
                skipped: report.skipped || 0,
                errors: report.errors || 0
            });
            regAuditImport(report, type, conflict, { entityId: historyId, fileName: entry.fileName });
            delete stagingMap[historyId];
            if (entry.stagingId && entry.stagingId !== historyId) delete stagingMap[entry.stagingId];
            saveStagingMap(stagingMap);
            return report;
        }).catch(function (err) {
            updateHistoryEntry(historyId, { status: 'pending' });
            return Promise.reject(err);
        });
    }

    // ---------------- Export ----------------
    function exportData(format, filters) {
        if (typeof global.emsRegRequire === 'function' && !global.emsRegRequire('export')) {
            return;
        }
        var users = loadUsers();
        if (filters) {
            if (filters.type && filters.type !== 'all') users = users.filter(function (u) { return u.type === filters.type; });
            if (filters.class) users = users.filter(function (u) { return (u.class || '') === filters.class; });
            if (filters.year) users = users.filter(function (u) { return String(u.date || '').indexOf(filters.year) === 0; });
        }
        if (!users.length) { toast('ایکسپورٹ کے لیے کوئی ریکارڈ نہیں', 'warning'); return; }
        var clean = users.map(function (u) { var o = Object.assign({}, u); delete o.photoBase64; return o; });
        var stamp = new Date().toISOString().slice(0, 10);

        if (format === 'json') {
            downloadBlob(JSON.stringify(clean, null, 2), 'records-' + stamp + '.json', 'application/json');
            regAuditExport(format, clean.length, filters);
            toast(clean.length + ' ریکارڈ ایکسپورٹ ہوئے');
        } else if (format === 'csv' || format === 'xlsx') {
            ensureXlsxReady().then(function () {
                if (format === 'csv') {
                    var ws = global.XLSX.utils.json_to_sheet(clean);
                    downloadBlob('\ufeff' + global.XLSX.utils.sheet_to_csv(ws), 'records-' + stamp + '.csv', 'text/csv;charset=utf-8');
                } else {
                    var ws2 = global.XLSX.utils.json_to_sheet(clean);
                    var wb = global.XLSX.utils.book_new();
                    global.XLSX.utils.book_append_sheet(wb, ws2, 'Records');
                    global.XLSX.writeFile(wb, 'records-' + stamp + '.xlsx');
                }
                regAuditExport(format, clean.length, filters);
                toast(clean.length + ' ریکارڈ ایکسپورٹ ہوئے');
            }).catch(function () { toast('Excel لائبریری لوڈ نہیں', 'error'); });
        } else if (format === 'pdf') {
            exportPDF(clean, stamp);
            regAuditExport(format, clean.length, filters);
            toast(clean.length + ' ریکارڈ ایکسپورٹ ہوئے');
        }
    }

    function downloadBlob(content, filename, mime) {
        var blob = new Blob([content], { type: mime });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
    }

    function exportPDF(rows, stamp) {
        var cols = ['id', 'name', 'fname', 'type', 'class', 'designation', 'position', 'phone'];
        var html = '<h3 style="margin:0 0 10px;text-align:right;">ریکارڈ رپورٹ — ' + stamp + '</h3>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;direction:rtl;"><thead><tr>' +
            cols.map(function (c) { return '<th style="border:1px solid #000;padding:5px;background:#111;color:#fff;text-align:right;">' + c + '</th>'; }).join('') +
            '</tr></thead><tbody>';
        rows.forEach(function (r) {
            html += '<tr>' + cols.map(function (c) {
                return '<td style="border:1px solid #999;padding:5px;text-align:right;">' + esc(r[c] || '') + '</td>';
            }).join('') + '</tr>';
        });
        html += '</tbody></table>';

        var host = document.getElementById('ems-export-pdf-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'ems-export-pdf-host';
            host.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;background:#fff;padding:12px;font-family:Arial,sans-serif;';
            document.body.appendChild(host);
        }
        host.innerHTML = html;

        if (typeof global.finDownloadPDF === 'function') {
            global.finDownloadPDF('ems-export-pdf-host', 'records-' + stamp + '.pdf');
            return;
        }

        var w = global.open('', '', 'height=700,width=900');
        if (!w) return;
        w.document.write('<html><head><meta charset="utf-8"><style>body{font-family:Arial;direction:rtl}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px;text-align:right}th{background:#1f3a5f;color:#fff}</style></head><body>');
        w.document.write(html);
        w.document.write('</body></html>');
        w.document.close();
        w.focus();
        setTimeout(function () { w.print(); }, 500);
    }

    // ---------------- Legacy / Smart layers (backward-compatible) ----------------
    var SNAPSHOT_KEY = 'ems_import_snapshot_v1';
    var PROFILES_KEY = 'ems_import_profiles_v1';

    function createSnapshot() {
        try {
            var snap = { at: new Date().toISOString(), users: loadUsers() };
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
            return true;
        } catch (e) { return false; }
    }

    function restoreSnapshot() {
        try {
            var raw = localStorage.getItem(SNAPSHOT_KEY);
            if (!raw) return { ok: false, reason: 'no_snapshot' };
            var snap = JSON.parse(raw);
            if (!snap || !Array.isArray(snap.users)) return { ok: false, reason: 'invalid' };
            localStorage.setItem(usersKey(), JSON.stringify(snap.users));
            if (global.renderRegTable) try { global.renderRegTable(); } catch (e) { }
            return { ok: true, at: snap.at, count: snap.users.length };
        } catch (e) { return { ok: false, reason: 'error' }; }
    }

    function hasSnapshot() {
        try { return !!localStorage.getItem(SNAPSHOT_KEY); } catch (e) { return false; }
    }

    function saveMappingProfile(name, type, map) {
        var list = [];
        try { list = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch (e) { }
        var entry = { name: String(name || 'profile').slice(0, 80), type: type, map: map, savedAt: new Date().toISOString() };
        list = list.filter(function (p) { return !(p.name === entry.name && p.type === entry.type); });
        list.push(entry);
        try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); } catch (e) { }
        return entry;
    }

    function loadMappingProfiles(type) {
        try {
            var list = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
            if (type) return list.filter(function (p) { return p.type === type; });
            return list;
        } catch (e) { return []; }
    }

    function smartValidate(records) {
        var issues = [];
        var seenCnic = {};
        var seenPhone = {};
        records.forEach(function (r, i) {
            if (r._skip) return;
            if (r.cnic) {
                var c = String(r.cnic).replace(/\D/g, '');
                if (c && seenCnic[c]) issues.push({ row: i, id: r.id, issue: 'duplicate_cnic', detail: c });
                else if (c) seenCnic[c] = r.id;
            }
            if (r.phone) {
                var p = String(r.phone).replace(/\D/g, '');
                if (p.length >= 7 && seenPhone[p]) issues.push({ row: i, id: r.id, issue: 'duplicate_phone', detail: p });
                else if (p.length >= 7) seenPhone[p] = r.id;
            }
        });
        return { issues: issues, count: issues.length };
    }

    function legacyQuickImport(file, type, options) {
        options = options || {};
        var conflict = options.conflict || 'skip';
        return parseFile(file).then(function (parsed) {
            parsed = normalizeParsedSheet(parsed);
            var map = options.map || autoMatch(parsed.headers, type);
            var mappedFields = Object.keys(map).map(function (k) { return map[k]; });
            if (mappedFields.indexOf('name') < 0) {
                return Promise.reject(new Error('نام والا کالم نہیں ملا — Advanced wizard استعمال کریں یا فائل چیک کریں'));
            }
            var records = buildRecords(parsed, map, type);
            return stageImportBatch({
                fileName: file.name,
                type: type,
                conflict: conflict,
                mode: 'legacy',
                records: records
            }).then(function (result) {
                return Object.assign({}, result, { added: 0, updated: 0, skipped: 0, errors: 0, validation: smartValidate(records) });
            });
        });
    }

    global.EmsImportExport = {
        parseFile: parseFile, autoMatch: autoMatch, fieldsFor: fieldsFor,
        buildRecords: buildRecords, summarize: summarize, commit: commit,
        addHistory: addHistory, getHistory: getHistory, updateHistoryEntry: updateHistoryEntry, deleteHistoryEntry: deleteHistoryEntry,
        ensureXlsxReady: ensureXlsxReady,
        stageImportBatch: stageImportBatch, processPendingImport: processPendingImport,
        exportData: exportData,
        createSnapshot: createSnapshot, restoreSnapshot: restoreSnapshot, hasSnapshot: hasSnapshot,
        saveMappingProfile: saveMappingProfile, loadMappingProfiles: loadMappingProfiles,
        smartValidate: smartValidate, legacyQuickImport: legacyQuickImport
    };

})(window);
