// ============================================================================
// شعبہ رجسٹریشن — مخصوص ڈیش بورڈ (100% isolated from main dashboard)
// Real data via emsRegistrationHeadcounts / emsRegRepo* / drafts only
// ============================================================================
(function (global) {
    'use strict';

    var _regDashInflight = null;
    var _regDashGen = 0;

    function regDashVisible() {
        var el = document.getElementById('reg-dashboard-panel');
        return !!(el && el.style.display !== 'none');
    }

    function setTxt(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val == null ? '—' : String(val);
    }

    function setHTML(id, html) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function fmt(n) {
        return (Number(n) || 0).toLocaleString('ur-PK');
    }

    function regDashRibbonBtn(panelId) {
        return document.querySelector('#reg-ribbon-menu [onclick*="' + panelId + '"]');
    }

    function regDashTypeLabel(type) {
        if (type === 'student') return 'طالب علم';
        if (type === 'teacher') return 'استاد';
        if (type === 'staff') return 'عملہ';
        return type || '—';
    }

    function regDashFormatDate(ts) {
        if (!ts) return '—';
        try {
            var d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
            if (isNaN(d.getTime())) return String(ts).slice(0, 10);
            return d.toLocaleDateString('ur-PK');
        } catch (e) {
            return '—';
        }
    }

    function regDashRecordTs(u) {
        if (!u) return 0;
        if (u.timestamp) return Number(u.timestamp) || 0;
        if (u.date) {
            var p = Date.parse(u.date);
            return isNaN(p) ? 0 : p;
        }
        return 0;
    }

    /** Navigate within registration module only */
    global.regDashNavigate = function (target, opts) {
        opts = opts || {};
        if (typeof global.switchRegTab !== 'function') return;
        var btn;
        if (target === 'student-form') {
            global.switchRegTab('reg-student-panel', regDashRibbonBtn('reg-student-panel'));
        } else if (target === 'teacher-form') {
            global.switchRegTab('reg-teacher-panel', regDashRibbonBtn('reg-teacher-panel'));
        } else if (target === 'staff-form') {
            global.switchRegTab('reg-staff-panel', regDashRibbonBtn('reg-staff-panel'));
        } else if (target === 'rejected') {
            global.switchRegTab('reg-rejected-panel', regDashRibbonBtn('reg-rejected-panel'));
        } else if (target === 'list') {
            btn = regDashRibbonBtn('reg-list-panel');
            global.switchRegTab('reg-list-panel', btn);
            var filter = document.getElementById('reg-list-filter');
            if (filter && opts.type) filter.value = opts.type;
            if (typeof global.renderRegTable === 'function') global.renderRegTable();
        } else if (target === 'drafts') {
            if (typeof global.emsRegDraftUiOpenList === 'function') {
                global.emsRegDraftUiOpenList();
            } else {
                global.switchRegTab('reg-student-panel', regDashRibbonBtn('reg-student-panel'));
            }
        } else if (target === 'edit' && opts.id && opts.type) {
            if (typeof global.editRegistration === 'function') {
                global.editRegistration(opts.id, opts.type, false);
            } else {
                global.regDashNavigate('list', opts);
            }
        }
    };

    function regDashMonthBuckets(months) {
        months = months || 6;
        var out = [];
        var now = new Date();
        for (var i = months - 1; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            var labels = ['جن', 'فر', 'مار', 'اپ', 'مئ', 'جون', 'جول', 'اگ', 'ست', 'اک', 'نوم', 'دسم'];
            out.push({ key: key, label: labels[d.getMonth()], count: 0 });
        }
        return out;
    }

    function regDashAggregateFromRepo() {
        var byClass = Object.create(null);
        var months = regDashMonthBuckets(6);
        var monthMap = Object.create(null);
        months.forEach(function (m) { monthMap[m.key] = m; });

        if (typeof global.emsRegRepoForEach === 'function') {
            global.emsRegRepoForEach(function (u) {
                if (!u) return;
                if (u.type === 'student') {
                    var cls = String(u.class || u.className || 'نامعلوم').trim() || 'نامعلوم';
                    byClass[cls] = (byClass[cls] || 0) + 1;
                }
                var ts = regDashRecordTs(u);
                if (ts > 0) {
                    var d = new Date(ts);
                    var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                    if (monthMap[mk]) monthMap[mk].count++;
                }
            });
        }

        var classRows = Object.keys(byClass).map(function (k) {
            return { label: k, value: byClass[k] };
        }).sort(function (a, b) { return b.value - a.value; });

        return { classRows: classRows, monthTrend: months };
    }

    function regDashFetchRecent(limit) {
        limit = limit || 8;
        if (typeof global.emsRegRepoGetListPage === 'function') {
            var page = global.emsRegRepoGetListPage({ offset: 0, limit: limit, type: 'all' });
            return Promise.resolve(page && page.rows ? page.rows : []);
        }
        return Promise.resolve([]);
    }

    function regDashFetchRejectedCount() {
        if (typeof global.emsRegRepoEnsureRejectedInitial === 'function') {
            return global.emsRegRepoEnsureRejectedInitial().then(function () {
                if (typeof global.emsRegRepoGetRejectedList === 'function') {
                    return global.emsRegRepoGetRejectedList().length;
                }
                return 0;
            }).catch(function () { return 0; });
        }
        if (typeof global.emsRegRepoGetRejectedList === 'function') {
            return Promise.resolve(global.emsRegRepoGetRejectedList().length);
        }
        return Promise.resolve(0);
    }

    function regDashFetchDraftCount() {
        if (global.EMS_REG_DRAFTS_ENABLED !== true) return Promise.resolve(0);
        if (typeof global.emsRegListDrafts !== 'function') return Promise.resolve(0);
        return global.emsRegListDrafts().then(function (list) {
            return Array.isArray(list) ? list.length : 0;
        }).catch(function () { return 0; });
    }

    function regDashRenderRecentTable(rows) {
        var tbody = document.getElementById('reg-dash-recent-tbody');
        if (!tbody) return;
        if (!rows || !rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;">کوئی حالیہ داخلہ نہیں</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (u) {
            var name = [u.name, u.fname].filter(Boolean).join(' ') || '—';
            var pos = u.type === 'student' ? (u.class || '—') : (u.designation || u.position || '—');
            var idEsc = String(u.id || '').replace(/'/g, "\\'");
            var typeEsc = String(u.type || 'student').replace(/'/g, "\\'");
            return '<tr class="reg-dash-row-click" onclick="window.regDashNavigate(\'edit\',{id:\'' + idEsc + '\',type:\'' + typeEsc + '\'})">' +
                '<td>' + regDashFormatDate(regDashRecordTs(u)) + '</td>' +
                '<td><strong>' + name + '</strong></td>' +
                '<td>' + regDashTypeLabel(u.type) + '</td>' +
                '<td>' + pos + '</td>' +
                '<td><code style="font-size:12px;">' + (u.id || '—') + '</code></td></tr>';
        }).join('');
    }

    function regDashRenderCharts(counts, agg) {
        var total = counts.total || 0;
        var segs = [
            { label: 'طلباء', value: counts.students || 0, color: '#3498db' },
            { label: 'اساتذہ', value: counts.teachers || 0, color: '#27ae60' },
            { label: 'عملہ', value: counts.staff || 0, color: '#9b59b6' }
        ];

        if (typeof global.emsDonutCompactSVG === 'function') {
            setHTML('reg-dash-chart-type', global.emsDonutCompactSVG(segs, fmt(total), 'کل', 168));
        } else if (typeof global.emsDonutSVG === 'function') {
            setHTML('reg-dash-chart-type', global.emsDonutSVG(segs, fmt(total), 'کل'));
        } else {
            setHTML('reg-dash-chart-type', '<p style="color:#94a3b8;font-size:13px;text-align:center;">چارٹ لوڈ نہیں</p>');
        }

        if (typeof global.emsLineChartSVG === 'function' && agg.monthTrend.length) {
            setHTML('reg-dash-chart-trend', global.emsLineChartSVG(
                agg.monthTrend.map(function (m) { return { label: m.label, value: m.count }; }),
                '#6366f1'
            ));
        } else {
            setHTML('reg-dash-chart-trend', '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:24px;">رجحان چارٹ دستیاب نہیں</p>');
        }

        if (typeof global.emsBarChartSVG === 'function' && agg.classRows.length) {
            setHTML('reg-dash-chart-class', global.emsBarChartSVG(
                agg.classRows.slice(0, 10).map(function (r) {
                    return {
                        label: r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label,
                        value: r.value,
                        display: String(r.value),
                        color: '#3498db'
                    };
                })
            ));
        } else {
            setHTML('reg-dash-chart-class', '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:24px;">درجہ وار ڈیٹا نہیں</p>');
        }
    }

    function regDashRenderBody(data) {
        var counts = data.counts;
        var agg = data.agg;
        setTxt('reg-dash-students', fmt(counts.students));
        setTxt('reg-dash-teachers', fmt(counts.teachers));
        setTxt('reg-dash-staff', fmt(counts.staff));
        setTxt('reg-dash-total', fmt(counts.total));
        setTxt('reg-dash-rejected', fmt(data.rejected));
        setTxt('reg-dash-drafts', fmt(data.drafts));
        setTxt('reg-dash-classes', fmt(agg.classRows.length));
        setTxt('reg-dash-updated', new Date().toLocaleTimeString('ur-PK'));

        var monthTotal = agg.monthTrend.reduce(function (s, m) { return s + m.count; }, 0);
        setTxt('reg-dash-month-adm', fmt(monthTotal));

        regDashRenderCharts(counts, agg);
        regDashRenderRecentTable(data.recent);

        var summary = document.getElementById('reg-dash-summary-text');
        if (summary) {
            summary.textContent = 'کل ' + fmt(counts.total) + ' منظور شدہ ریکارڈ — طلباء ' +
                fmt(counts.students) + '، اساتذہ ' + fmt(counts.teachers) + '، عملہ ' +
                fmt(counts.staff) + '۔ مسترد: ' + fmt(data.rejected) +
                (data.drafts > 0 ? (' · آپ کے ڈرافٹ: ' + fmt(data.drafts)) : '') + '۔';
        }
    }

    function regDashLoadData() {
        var headPromise = typeof global.emsRegistrationHeadcounts === 'function'
            ? global.emsRegistrationHeadcounts()
            : Promise.resolve({ students: 0, teachers: 0, staff: 0, total: 0 });

        return headPromise.then(function (counts) {
            var agg = regDashAggregateFromRepo();
            return Promise.all([
                regDashFetchRejectedCount(),
                regDashFetchDraftCount(),
                regDashFetchRecent(8)
            ]).then(function (parts) {
                return {
                    counts: counts,
                    agg: agg,
                    rejected: parts[0],
                    drafts: parts[1],
                    recent: parts[2]
                };
            });
        });
    }

    global.renderRegDashboard = function () {
        if (!regDashVisible()) return Promise.resolve();
        if (_regDashInflight) return _regDashInflight;

        var gen = ++_regDashGen;
        var ready = typeof global.emsEnsureRepositoryReady === 'function'
            ? global.emsEnsureRepositoryReady()
            : Promise.resolve();

        _regDashInflight = ready.then(function () {
            return regDashLoadData();
        }).then(function (data) {
            if (gen !== _regDashGen || !regDashVisible()) return;
            regDashRenderBody(data);
        }).catch(function (err) {
            console.error('[EMS] reg dashboard', err);
            setTxt('reg-dash-summary-text', 'ڈیٹا لوڈ نہیں ہو سکا — دوبارہ کوشش کریں۔');
        }).finally(function () {
            if (gen === _regDashGen) _regDashInflight = null;
        });

        return _regDashInflight;
    };

    function regDashBindControls() {
        var btn = document.getElementById('btn-reg-dash-refresh');
        if (btn && !btn._regDashBound) {
            btn._regDashBound = true;
            btn.addEventListener('click', function () {
                global.renderRegDashboard();
            });
        }
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:users-changed', function () {
            if (regDashVisible()) global.renderRegDashboard();
        });
        global.addEventListener('ems:repo-hydrated', function () {
            if (regDashVisible()) global.renderRegDashboard();
        });
        global.addEventListener('ems:registration-ready', function () {
            if (regDashVisible()) global.renderRegDashboard();
        });
        global.addEventListener('ems:post-auth-deferred-ready', function () {
            if (regDashVisible()) global.renderRegDashboard();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', regDashBindControls);
    } else {
        regDashBindControls();
    }
})(typeof window !== 'undefined' ? window : globalThis);
