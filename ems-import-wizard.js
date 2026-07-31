// ============================================================================
// EMS Import Wizard — 7-step Enterprise Migration Wizard (UI controller)
// ============================================================================
(function (global) {
    'use strict';

    var IE = function () { return global.EmsImportExport; };
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function $(id) { return document.getElementById(id); }
    function toast(m, t) { if (global.showToast) global.showToast(m, t || 'success'); }

    function formatImportHistoryTime(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
            return d.toLocaleString('en-PK', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch (eFmt) {
            return String(iso).slice(0, 16).replace('T', ' ');
        }
    }

    var STEPS = ['فائل', 'ماڈیول', 'فیلڈ میچنگ', 'پیش منظر و توثیق', 'اصلاح', 'تصدیق', 'رپورٹ'];

    var W = null;
    function reset() {
        W = { step: 1, file: null, parsed: null, type: 'student', master: false, masterCat: 'classes',
            map: {}, records: [], summary: null, conflict: 'skip', report: null };
    }

    global.openImportWizard = function () {
        reset();
        var m = $('import-wizard-modal');
        if (m) m.style.display = 'flex';
        render();
    };
    global.closeImportWizard = function () { var m = $('import-wizard-modal'); if (m) m.style.display = 'none'; };

    function stepsBar() {
        return '<div class="iw-steps">' + STEPS.map(function (s, i) {
            var n = i + 1;
            var cls = n === W.step ? 'active' : (n < W.step ? 'done' : '');
            return '<div class="iw-step ' + cls + '"><span>' + n + '</span>' + esc(s) + '</div>';
        }).join('') + '</div>';
    }

    function render() {
        var body = $('iw-body');
        if (!body) return;
        $('iw-steps-wrap').innerHTML = stepsBar();
        var html = '';
        if (W.step === 1) html = step1();
        else if (W.step === 2) html = step2();
        else if (W.step === 3) html = step3();
        else if (W.step === 4) html = step4();
        else if (W.step === 5) html = step5();
        else if (W.step === 6) html = step6();
        else if (W.step === 7) html = step7();
        body.innerHTML = html;

        if (W.step === 3 && !W.master && typeof global.emsSmartWizardProfileBar === 'function') {
            global.emsSmartWizardProfileBar('iw-profile-bar', W.type, W.map);
        }
        if (W.step === 3 && !W.master && typeof global.emsImportTemplatesBar === 'function') {
            global.emsImportTemplatesBar('iw-template-bar', W.type, W.parsed ? W.parsed.headers : [], function (map) {
                W.map = Object.assign({}, W.map, map);
                render();
            });
        }

        // nav buttons
        $('iw-back').style.display = (W.step > 1 && W.step < 7) ? 'inline-flex' : 'none';
        var next = $('iw-next');
        if (W.step === 6) { next.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> امپورٹ کریں'; next.style.display = 'inline-flex'; }
        else if (W.step === 7) { next.innerHTML = '<i class="fas fa-check"></i> مکمل'; next.style.display = 'inline-flex'; }
        else { next.innerHTML = 'اگلا <i class="fas fa-arrow-left"></i>'; next.style.display = 'inline-flex'; }
    }

    // ---- Step 1: File ----
    function step1() {
        return '<div class="iw-pane">' +
            '<h4><i class="fas fa-file-import"></i> فائل منتخب کریں</h4>' +
            '<p class="iw-hint">سپورٹڈ: Excel (.xlsx, .xls)، CSV، JSON، XML</p>' +
            '<div class="iw-drop" onclick="document.getElementById(\'iw-file\').click()">' +
            '<i class="fas fa-cloud-arrow-up"></i><div id="iw-fname">' + (W.file ? esc(W.file.name) : 'فائل یہاں کلک کر کے منتخب کریں') + '</div></div>' +
            '<input type="file" id="iw-file" accept=".xlsx,.xls,.csv,.json,.xml" style="display:none" onchange="window.iwOnFile(this)">' +
            (W.parsed ? '<div class="iw-ok"><i class="fas fa-check-circle"></i> ' + W.parsed.rows.length + ' قطاریں، ' + W.parsed.headers.length + ' کالم پڑھے گئے</div>' : '') +
            '</div>';
    }
    global.iwOnFile = function (input) {
        var f = input.files && input.files[0];
        if (!f) return;
        W.file = f; W.parsed = null;
        $('iw-fname').textContent = f.name;
        IE().parseFile(f).then(function (parsed) {
            W.parsed = parsed; render();
            toast('فائل کامیابی سے پڑھی گئی');
        }).catch(function (err) { toast(err.message || 'فائل پڑھنے میں مسئلہ', 'error'); });
    };

    // ---- Step 2: Module ----
    function step2() {
        var opts = [
            { v: 'student', t: 'طلبہ', i: 'fa-user-graduate' },
            { v: 'teacher', t: 'اساتذہ', i: 'fa-chalkboard-teacher' },
            { v: 'staff', t: 'عملہ', i: 'fa-user-shield' },
            { v: 'master', t: 'ماسٹر ڈیٹا (درجات/مضامین/شعبے)', i: 'fa-list' }
        ];
        var cards = opts.map(function (o) {
            var sel = (W.master && o.v === 'master') || (!W.master && W.type === o.v && o.v !== 'master');
            return '<div class="iw-modcard ' + (sel ? 'sel' : '') + '" onclick="window.iwPickModule(\'' + o.v + '\')"><i class="fas ' + o.i + '"></i><div>' + esc(o.t) + '</div></div>';
        }).join('');
        var masterCat = W.master ? '<div class="input-group" style="margin-top:14px;"><label>زمرہ منتخب کریں</label>' +
            '<select id="iw-mastercat" class="input-control" onchange="window.W_setMasterCat(this.value)">' +
            ['classes:درجات', 'subjects:مضامین', 'departments:شعبہ جات', 'designations:عہدے', 'branches:شاخیں'].map(function (p) {
                var kv = p.split(':'); return '<option value="' + kv[0] + '" ' + (W.masterCat === kv[0] ? 'selected' : '') + '>' + kv[1] + '</option>';
            }).join('') + '</select></div>' : '';
        return '<div class="iw-pane"><h4><i class="fas fa-layer-group"></i> ماڈیول منتخب کریں</h4><div class="iw-modgrid">' + cards + '</div>' + masterCat + '</div>';
    }
    global.iwPickModule = function (v) {
        if (v === 'master') { W.master = true; }
        else { W.master = false; W.type = v; }
        render();
    };
    global.W_setMasterCat = function (v) { W.masterCat = v; };

    // ---- Step 3: Field matching ----
    function step3() {
        if (!W.parsed) return '<div class="iw-pane"><p class="iw-warn">پہلے فائل منتخب کریں</p></div>';
        if (W.master) {
            return '<div class="iw-pane"><h4><i class="fas fa-arrows-left-right"></i> کالم منتخب کریں</h4>' +
                '<p class="iw-hint">"' + esc(W.masterCat) + '" کے لیے وہ کالم منتخب کریں جس میں اقدار ہیں۔</p>' +
                '<select id="iw-mastercol" class="input-control">' +
                W.parsed.headers.map(function (h, i) { return '<option value="' + i + '">' + esc(h || ('کالم ' + (i + 1))) + '</option>'; }).join('') +
                '</select></div>';
        }
        W.map = IE().autoMatch(W.parsed.headers, W.type);
        var defs = IE().fieldsFor(W.type);
        var optsHtml = '<option value="">— نظر انداز —</option>' + defs.map(function (d) { return '<option value="' + d.k + '">' + esc(d.label) + '</option>'; }).join('');
        var rows = W.parsed.headers.map(function (h, i) {
            var sel = W.map[i] || '';
            var os = optsHtml.replace('value="' + sel + '"', 'value="' + sel + '" selected');
            var sample = '';
            for (var r = 0; r < W.parsed.rows.length && r < 3; r++) { if (W.parsed.rows[r][i]) { sample = String(W.parsed.rows[r][i]); break; } }
            return '<tr><td><b>' + esc(h || ('کالم ' + (i + 1))) + '</b><br><small style="color:#94a3b8">' + esc(sample.slice(0, 24)) + '</small></td>' +
                '<td><select class="input-control iw-mapsel" data-idx="' + i + '">' + os + '</select></td></tr>';
        }).join('');
        var matched = Object.keys(W.map).length;
        return '<div class="iw-pane"><h4><i class="fas fa-wand-magic-sparkles"></i> خودکار فیلڈ میچنگ</h4>' +
            '<div id="iw-profile-bar"></div>' +
            '<div id="iw-template-bar"></div>' +
            '<p class="iw-hint">' + matched + ' کالم خودکار میچ ہوئے۔ ضرورت ہو تو دستی تبدیل کریں۔</p>' +
            '<table class="iw-table"><tr><th>Excel کالم</th><th>سسٹم فیلڈ</th></tr>' + rows + '</table></div>';
    }

    function collectMap() {
        if (W.master) return;
        var m = {};
        document.querySelectorAll('.iw-mapsel').forEach(function (s) {
            if (s.value) m[s.getAttribute('data-idx')] = s.value;
        });
        W.map = m;
    }

    // ---- Step 4: Preview & validation ----
    function step4() {
        if (W.master) {
            var idx = W._masterColIdx;
            var vals = {};
            W.parsed.rows.forEach(function (r) { var v = String(r[idx] == null ? '' : r[idx]).trim(); if (v) vals[v] = 1; });
            W._masterVals = Object.keys(vals);
            return '<div class="iw-pane"><h4><i class="fas fa-eye"></i> پیش منظر</h4>' +
                '<div class="iw-summary"><div class="iw-sc"><b>' + W._masterVals.length + '</b><span>منفرد اقدار</span></div></div>' +
                '<div class="iw-preview">' + W._masterVals.slice(0, 60).map(function (v) { return '<span class="iw-chip">' + esc(v) + '</span>'; }).join('') + '</div></div>';
        }
        W.records = IE().buildRecords(W.parsed, W.map, W.type);
        W.summary = IE().summarize(W.records);
        var s = W.summary;
        var cols = ['id', 'name', 'fname', 'phone'];
        var head = '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '<th>حالت</th></tr>';
        var body = W.records.slice(0, 40).map(function (r) {
            var st = r._skip ? '<span style="color:#dc2626">نظر انداز</span>' : (r._existing ? '<span style="color:#d97706">موجود</span>' : '<span style="color:#16a34a">نیا</span>');
            if (r._issues.length) st += ' <small style="color:#dc2626">' + esc(r._issues.join('، ')) + '</small>';
            return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c] || '') + '</td>'; }).join('') + '<td>' + st + '</td></tr>';
        }).join('');
        return '<div class="iw-pane"><h4><i class="fas fa-eye"></i> پیش منظر و توثیق</h4>' +
            '<div class="iw-summary">' +
            '<div class="iw-sc"><b>' + s.total + '</b><span>کل</span></div>' +
            '<div class="iw-sc ok"><b>' + s.newCount + '</b><span>نئے</span></div>' +
            '<div class="iw-sc warn"><b>' + s.existing + '</b><span>موجود</span></div>' +
            '<div class="iw-sc err"><b>' + s.problems + '</b><span>مسئلہ</span></div>' +
            '</div><table class="iw-table">' + head + body + '</table>' +
            (W.records.length > 40 ? '<p class="iw-hint">صرف پہلی 40 قطاریں دکھائی گئیں</p>' : '') + '</div>';
    }

    // ---- Step 5: Error correction ----
    function step5() {
        if (W.master) return '<div class="iw-pane"><h4><i class="fas fa-circle-check"></i> اصلاح</h4><p class="iw-ok"><i class="fas fa-check-circle"></i> ماسٹر ڈیٹا کے لیے کسی اصلاح کی ضرورت نہیں۔</p></div>';
        if (typeof global.emsImportMergeStep5Html === 'function') {
            return global.emsImportMergeStep5Html(W.records);
        }
        var problems = W.records.filter(function (r) { return r._skip || r._issues.length; });
        if (!problems.length) return '<div class="iw-pane"><h4><i class="fas fa-circle-check"></i> اصلاح</h4><p class="iw-ok"><i class="fas fa-check-circle"></i> کوئی مسئلہ نہیں ملا۔ آگے بڑھیں۔</p></div>';
        var rows = problems.slice(0, 50).map(function (r) {
            return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name || '—') + '</td><td style="color:#dc2626">' + esc((r._skip ? 'نام خالی' : '') + (r._issues.length ? ' ' + r._issues.join('، ') : '')) + '</td></tr>';
        }).join('');
        return '<div class="iw-pane"><h4><i class="fas fa-triangle-exclamation"></i> ممکنہ مسائل (' + problems.length + ')</h4>' +
            '<p class="iw-hint">"نام خالی" والے ریکارڈ خودکار نظر انداز ہوں گے۔ باقی بطور انتباہ ہیں۔</p>' +
            '<table class="iw-table"><tr><th>ID</th><th>نام</th><th>مسئلہ</th></tr>' + rows + '</table></div>';
    }

    // ---- Step 6: Confirm & conflict ----
    function step6() {
        if (W.master) {
            return '<div class="iw-pane"><h4><i class="fas fa-cloud-arrow-up"></i> تصدیق</h4>' +
                '<p>"' + esc(W.masterCat) + '" میں <b>' + (W._masterVals ? W._masterVals.length : 0) + '</b> اقدار شامل کی جائیں گی۔</p>' +
                '<div id="iw-progress" class="iw-progress" style="display:none"><div></div></div></div>';
        }
        var s = W.summary || { newCount: 0, existing: 0 };
        var radios = [
            { v: 'skip', t: 'موجود کو چھوڑ دیں (Skip)' },
            { v: 'update', t: 'موجود کو اپ ڈیٹ کریں (Update)' },
            { v: 'duplicate', t: 'نیا ڈپلیکیٹ بنائیں (Duplicate)' }
        ].map(function (o) {
            return '<label class="iw-radio"><input type="radio" name="iw-conflict" value="' + o.v + '" ' + (W.conflict === o.v ? 'checked' : '') + ' onchange="window.W_setConflict(this.value)"> ' + esc(o.t) + '</label>';
        }).join('');
        return '<div class="iw-pane"><h4><i class="fas fa-cloud-arrow-up"></i> تصدیق و Staging</h4>' +
            '<p>نئے: <b style="color:#16a34a">' + s.newCount + '</b> — موجود: <b style="color:#d97706">' + s.existing + '</b></p>' +
            '<p class="iw-hint">اگلے مرحلے میں فائل <b>Staging</b> میں محفوظ ہوگی۔ ڈیٹا بیس میں منتقل کرنے کے لیے Import History سے <b>Confirm Import</b> دبائیں۔</p>' +
            '<div class="iw-radios">' + radios + '</div>' +
            '<div id="iw-progress" class="iw-progress" style="display:none"><div></div></div>' +
            '<div id="iw-progress-text" class="iw-hint"></div></div>';
    }
    global.W_setConflict = function (v) { W.conflict = v; };

    // ---- Step 7: Report ----
    function step7() {
        var r = W.report || {};
        if (W.master) {
            return '<div class="iw-pane"><h4><i class="fas fa-flag-checkered"></i> امپورٹ رپورٹ</h4>' +
                '<div class="iw-summary"><div class="iw-sc ok"><b>' + (r.added || 0) + '</b><span>شامل ہوئے</span></div>' +
                '<div class="iw-sc warn"><b>' + (r.skipped || 0) + '</b><span>پہلے سے موجود</span></div></div>' +
                '<p class="iw-ok"><i class="fas fa-check-circle"></i> ماسٹر ڈیٹا اپ ڈیٹ ہو گیا۔</p></div>';
        }
        return '<div class="iw-pane"><h4><i class="fas fa-flag-checkered"></i> Staging رپورٹ</h4>' +
            '<div class="iw-summary">' +
            '<div class="iw-sc ok"><b>' + (r.recordCount || r.added || 0) + '</b><span>ریکارڈ</span></div>' +
            '<div class="iw-sc warn"><b>' + (r.validCount || 0) + '</b><span>درست</span></div>' +
            '</div>' +
            '<p class="iw-ok"><i class="fas fa-clock"></i> فائل Staging میں محفوظ — Import History سے <b>Confirm Import</b> کریں۔</p></div>';
    }

    // ---- Navigation ----
    global.iwBack = function () { if (W.step > 1) { W.step--; render(); } };
    global.iwNext = function () {
        if (W.step === 1) { if (!W.parsed) return toast('پہلے درست فائل منتخب کریں', 'warning'); }
        if (W.step === 3) {
            if (W.master) {
                W._masterColIdx = parseInt(($('iw-mastercol') || {}).value || '0');
            } else {
                collectMap();
                var mapped = Object.keys(W.map).map(function (k) { return W.map[k]; });
                if (mapped.indexOf('name') < 0) return toast('کم از کم "نام" فیلڈ میپ کریں', 'warning');
            }
        }
        if (W.step === 6) { return doImport(); }
        if (W.step === 7) { global.closeImportWizard(); if (global.emsRenderImportHistory) global.emsRenderImportHistory(); return; }
        W.step++; render();
    };

    function doImport() {
        var next = $('iw-next'); next.disabled = true;
        if (W.master) {
            var added = global.EmsMasterData ? global.EmsMasterData.importValues(W.masterCat, W._masterVals || []) : 0;
            W.report = { added: added, skipped: (W._masterVals ? W._masterVals.length : 0) - added };
            IE().addHistory({ id: 't' + Date.now(), status: 'completed', at: new Date().toISOString(), processedAt: new Date().toISOString(), by: (firebase.auth().currentUser || {}).email || '—', type: 'master:' + W.masterCat, added: added, updated: 0, skipped: W.report.skipped, errors: 0 });
            next.disabled = false; W.step = 7; render(); return;
        }
        var prog = $('iw-progress'); if (prog) prog.style.display = 'block';
        IE().stageImportBatch({
            fileName: (W.file && W.file.name) ? W.file.name : 'wizard-import',
            type: W.type,
            conflict: W.conflict,
            mode: 'wizard',
            records: W.records
        }).then(function (result) {
            W.report = result;
            if (prog) prog.style.display = 'none';
            next.disabled = false; W.step = 7; render();
            toast('Staging میں محفوظ — Import History سے Confirm Import کریں', 'success');
            if (global.emsRenderImportHistory) global.emsRenderImportHistory();
        }).catch(function (err) {
            next.disabled = false;
            if (prog) prog.style.display = 'none';
            toast((err && err.message) || 'Staging ناکام', 'error');
        });
    }

    // ---- Export panel + history ----
    global.emsDoExport = function (fmt) {
        if (typeof global.emsRegRequire === 'function' && !global.emsRegRequire('export')) {
            return;
        }
        var filters = {
            type: ($('exp-type') || {}).value || 'all',
            class: ($('exp-class') || {}).value || '',
            year: ($('exp-year') || {}).value || ''
        };
        IE().exportData(fmt, filters);
    };

    function historyStatus(h) {
        if (h.status === 'processing') return { label: 'Processing', cls: 'ih-st-processing' };
        if (h.status === 'completed') return { label: 'Completed', cls: 'ih-st-completed' };
        if (h.status === 'pending') return { label: 'Pending', cls: 'ih-st-pending' };
        return { label: 'Completed', cls: 'ih-st-completed' };
    }

    global.emsProcessPendingImport = function (historyId) {
        if (typeof global.emsRegRequire === 'function' && !global.emsRegRequire('import')) {
            return;
        }
        if (!IE() || typeof IE().processPendingImport !== 'function') {
            toast('Import engine لوڈ نہیں', 'error'); return;
        }
        if (!confirm('کیا آپ واقعی اس فائل کو Firestore میں منتقل (Confirm Import) کرنا چاہتے ہیں؟')) return;
        var btn = document.querySelector('[data-ih-process="' + historyId + '"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…'; }
        IE().processPendingImport(historyId).then(function (report) {
            toast('Import مکمل: ' + (report.added || 0) + ' نئے، ' + (report.updated || 0) + ' اپ ڈیٹ، ' + (report.skipped || 0) + ' چھوڑے', report.added ? 'success' : 'warning');
            global.emsRenderImportHistory();
            if (typeof global.emsSmartRefreshSnapshotUi === 'function') global.emsSmartRefreshSnapshotUi();
        }).catch(function (err) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirm Import'; }
            toast((err && err.message) || 'Process ناکام', 'error');
            global.emsRenderImportHistory();
        });
    };

    global.emsDeleteImportHistory = function (historyId) {
        if (!historyId) return;
        if (!confirm('کیا یہ امپورٹ لاگ مستقل طور پر حذف کریں؟')) return;
        if (!IE() || typeof IE().deleteHistoryEntry !== 'function') {
            toast('Import engine لوڈ نہیں', 'error');
            return;
        }
        IE().deleteHistoryEntry(historyId);
        toast('ہسٹری حذف ہو گئی', 'success');
        global.emsRenderImportHistory();
    };

    global.emsToggleImportHistory = function () {
        var body = $('import-history-body');
        var desc = $('import-history-desc');
        var chev = $('import-history-chevron');
        if (!body) return;
        var collapsed = body.classList.toggle('ih-collapsed');
        if (desc) desc.classList.toggle('ih-collapsed', collapsed);
        if (chev) {
            chev.classList.toggle('fa-chevron-up', !collapsed);
            chev.classList.toggle('fa-chevron-down', collapsed);
        }
        try { localStorage.setItem('ems_import_history_collapsed', collapsed ? '1' : '0'); } catch (eColl) { /* ignore */ }
    };

    global.emsRenderImportHistory = function () {
        var box = $('import-history-list');
        if (!box) return;
        var list = IE().getHistory().slice().reverse();
        if (!list.length) {
            box.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:10px;">ابھی کوئی امپورٹ نہیں ہوا</p>';
            return;
        }
        box.innerHTML = list.map(function (h) {
            var st = historyStatus(h);
            var isPending = st.label === 'Pending';
            var title = esc(h.fileName || h.type || 'import');
            var meta = esc(formatImportHistoryTime(h.processedAt || h.at)) + ' — ' + esc(h.by || '');
            var hid = String(h.id || '').replace(/'/g, "\\'");
            var stats = isPending
                ? ('<span class="ih-meta">' + (h.recordCount || 0) + ' قطار · ' + (h.validCount || 0) + ' درست' +
                    (h.noNameCount ? ' · <span style="color:#dc2626">' + h.noNameCount + ' بغیر نام</span>' : '') + '</span>')
                : ('<div class="ih-stats"><span style="color:#16a34a">+' + (h.added || 0) + '</span> <span style="color:#d97706">~' + (h.updated || 0) + '</span> <span style="color:#94a3b8">/' + (h.skipped || 0) + '</span></div>');
            var action = isPending
                ? ('<button type="button" class="btn btn-primary btn-sm ih-process-btn" data-ih-process="' + esc(h.id) + '" onclick="window.emsProcessPendingImport(\'' + hid + '\')"><i class="fas fa-check"></i> Confirm Import</button>')
                : (st.label === 'Processing' ? '<span class="ih-meta"><i class="fas fa-spinner fa-spin"></i> Processing…</span>' : '');
            var deleteBtn = '<button type="button" class="btn btn-outline btn-sm ih-delete-btn" title="حذف" onclick="window.emsDeleteImportHistory(\'' + hid + '\')"><i class="fas fa-trash-alt"></i></button>';
            return '<div class="ih-row ' + st.cls + '">' +
                '<div class="ih-main"><div class="ih-title-row"><b>' + title + '</b> <span class="ih-badge ' + st.cls + '">' + st.label + '</span></div>' +
                '<small class="ih-sub">' + meta + ' · ' + esc(h.type || '') + '</small></div>' +
                stats +
                '<div class="ih-row-actions">' + action + deleteBtn + '</div></div>';
        }).join('');
    };

    global.emsOnDataPanel = function () {
        if (typeof global.emsLoadXlsxLib === 'function') {
            global.emsLoadXlsxLib().catch(function () { /* offline preload best-effort */ });
        }
        // populate class filter from master data
        var sel = $('exp-class');
        if (sel && global.EmsMasterData) {
            var cur = sel.value;
            sel.innerHTML = '<option value="">تمام درجات</option>' + global.EmsMasterData.getList('classes').map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
            sel.value = cur;
        }
        if (typeof global.emsLegacyRenderPanel === 'function') global.emsLegacyRenderPanel();
        if (typeof global.emsSmartRenderPanel === 'function') global.emsSmartRenderPanel();
        global.emsRenderImportHistory();
        try {
            var collapsed = localStorage.getItem('ems_import_history_collapsed') === '1';
            if (collapsed) {
                var body = $('import-history-body');
                var desc = $('import-history-desc');
                var chev = $('import-history-chevron');
                if (body) body.classList.add('ih-collapsed');
                if (desc) desc.classList.add('ih-collapsed');
                if (chev) {
                    chev.classList.remove('fa-chevron-up');
                    chev.classList.add('fa-chevron-down');
                }
            }
        } catch (eRestore) { /* ignore */ }
    };

})(window);
