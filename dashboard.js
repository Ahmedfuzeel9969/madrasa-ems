// ============================================================================
// ایڈوانسڈ تعلیمی مینجمنٹ سسٹم - ڈیش بورڈ ماڈیول (dashboard.js)
// ============================================================================

window.toggleDashFilterView = function(mode) {
    let bulkOpt = document.getElementById('dash-bulk-filter-options');
    let singleOpt = document.getElementById('dash-single-search-options');
    if(bulkOpt) bulkOpt.style.display = mode === 'all' ? 'grid' : 'none';
    if(singleOpt) singleOpt.style.display = mode === 'some' ? 'grid' : 'none';
    if (mode === 'some') {
        window.emsToggle360Btn();
        if (typeof window.emsLoad360UserSelect === 'function') {
            window.emsLoad360UserSelect();
        }
    }
};

/** Populate 360 person selector — full local SSOT (no web cap). */
window.emsLoad360UserSelect = function (opts) {
    opts = opts || {};
    var select = document.getElementById('dash-360-search-user');
    if (!select) return Promise.resolve([]);

    var chain;
    if (typeof window.emsEnsureDashboardReportData === 'function') {
        chain = window.emsEnsureDashboardReportData().then(function () {
            return typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : [];
        });
    } else if (typeof window.emsEnsureRepositoryReady === 'function') {
        chain = window.emsEnsureRepositoryReady().then(function () {
            return typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : [];
        });
    } else {
        chain = Promise.resolve(typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
    }

    return chain.then(function (dbUsers) {
        if ((!dbUsers || !dbUsers.length) && typeof window.emsFetchUsersByFilter === 'function') {
            return window.emsFetchUsersByFilter({ limit: 0 });
        }
        return dbUsers || [];
    }).then(function (dbUsers) {
        var preserve = opts.preserveValue || select.value;
        select.innerHTML = '<option value="">فرد کا نام یا ID منتخب کریں...</option>';
        (dbUsers || []).forEach(function (u) {
            if (!u || !u.id) return;
            var roleStr = u.type === 'student' ? 'طالب علم' : (u.type === 'teacher' ? 'استاد' : 'عملہ');
            var opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = '[' + roleStr + '] ' + (u.name || u.id) + ' (' + u.id + ')';
            select.appendChild(opt);
        });
        if (preserve) window.emsEnsure360SelectOption(preserve);
        if (typeof window.emsToggle360Btn === 'function') window.emsToggle360Btn();
        return dbUsers || [];
    }).catch(function (err) {
        console.warn('[EMS] 360 user select load:', err);
        if (typeof window.showToast === 'function') window.showToast('فہرست لوڈ نہیں ہو سکی', 'warning');
        return [];
    });
};

/** Inject option when opening 360 from quick-view before dropdown populated. */
window.emsEnsure360SelectOption = function (userId, label) {
    var select = document.getElementById('dash-360-search-user');
    if (!select || !userId) return;
    var found = false;
    for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === userId) { found = true; break; }
    }
    if (!found) {
        var opt = document.createElement('option');
        opt.value = userId;
        opt.textContent = label || (userId + ' (منتخب)');
        select.appendChild(opt);
    }
    select.value = userId;
};

function emsDash360LookupMapEntry(map, user) {
    if (!map || !user) return null;
    var canon = typeof window.emsResolveCanonicalUserId === 'function'
        ? window.emsResolveCanonicalUserId(user) : (user.id || '');
    if (canon && map[canon]) return map[canon];
    var aliases = typeof window.emsCollectUserIdAliases === 'function'
        ? window.emsCollectUserIdAliases(user) : [user.id];
    for (var i = 0; i < aliases.length; i++) {
        if (map[aliases[i]]) return map[aliases[i]];
    }
    return null;
}

function emsDash360RecordMatches(record, user, fields) {
    if (typeof window.emsRecordMatchesUserId === 'function') {
        return window.emsRecordMatchesUserId(record, user, fields);
    }
    var id = user && user.id;
    return fields.some(function (f) { return record[f] === id; });
}

/** Scan att_rec_* sheets for a user's attendance summary (last 3 months) — IDB indexed. */
function emsDash360CollectAttendanceAsync(user) {
    var aliases = typeof window.emsCollectUserIdAliases === 'function'
        ? window.emsCollectUserIdAliases(user) : [user.id];
    var aliasSet = Object.create(null);
    aliases.forEach(function (a) {
        aliasSet[String(a)] = true;
        aliasSet[String(a).toUpperCase()] = true;
    });

    var stats = { present: 0, absent: 0, leave: 0, other: 0, total: 0, rate: 0, monthsScanned: 0 };
    var months = [];
    var now = new Date();
    for (var m = 0; m < 3; m++) {
        months.push(new Date(now.getFullYear(), now.getMonth() - m, 1).toISOString().substring(0, 7));
    }

    function classifyStatus(st) {
        if (st === 'P' || st === 'حاضر') return 'present';
        if (st === 'A' || st === 'غائب') return 'absent';
        if (st === 'L' || st === 'رخصت') return 'leave';
        return 'other';
    }

    function scanSheet(sheet) {
        if (!sheet || !sheet.records) return;
        Object.keys(sheet.records).forEach(function (uid) {
            if (!aliasSet[uid] && !aliasSet[String(uid).toUpperCase()]) return;
            var dayRec = sheet.records[uid];
            if (!dayRec || typeof dayRec !== 'object') return;
            Object.keys(dayRec).forEach(function (day) {
                var bucket = classifyStatus(dayRec[day]);
                stats[bucket]++;
                stats.total++;
            });
        });
    }

    if (typeof window.emsOfflineLoadAttendanceSheetsForMonth !== 'function') {
        return Promise.resolve(stats);
    }

    return Promise.all(months.map(function (month) {
        return window.emsOfflineLoadAttendanceSheetsForMonth(month).then(function (sheets) {
            (sheets || []).forEach(scanSheet);
            stats.monthsScanned++;
        });
    })).then(function () {
        if (stats.total > 0) stats.rate = Math.round((stats.present / stats.total) * 100);
        return stats;
    });
}

/** IDB-aware cache read for 360 adapters (non-blocking). */
function emsDash360CacheRead(key, fallback) {
    if (typeof window.emsCacheGet === 'function') {
        return window.emsCacheGet(key, fallback);
    }
    try {
        var raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

/** Exams read with IDB cache + localStorage fallback when cache is cold. */
function emsDash360ReadExams() {
    var dbExams = [];
    if (typeof window.emsCacheGet === 'function') {
        dbExams = window.emsCacheGet('ems_full_exams', null) || window.emsCacheGet('ems_exams_db', []);
    }
    if (!Array.isArray(dbExams) || !dbExams.length) {
        dbExams = emsDash360CacheRead('ems_full_exams', null) || emsDash360CacheRead('ems_exams_db', []);
    }
    if (!Array.isArray(dbExams)) dbExams = [];
    return dbExams;
}

/** Lazy-load module scripts when 360 needs module compute helpers. */
function emsDash360EnsureModule(modId) {
    if (modId === 'curriculum' && typeof window.curComputeStatus === 'function') {
        return Promise.resolve();
    }
    if (modId === 'training' && typeof window.tarComputePersonScore === 'function') {
        return Promise.resolve();
    }
    if (modId === 'ledger' && typeof window.ldgGetSalaryProfile === 'function') {
        return Promise.resolve();
    }
    if (typeof window.emsLazyLoadModule === 'function') {
        return window.emsLazyLoadModule(modId).catch(function () { /* offline */ });
    }
    return Promise.resolve();
}

function emsDash360CurriculumStatusLabel(status) {
    if (status === 'green') return 'ہدف پر';
    if (status === 'yellow') return 'معمولی تاخیر';
    if (status === 'red') return 'نمایاں تاخیر';
    return '—';
}

function emsDash360CurriculumStatusColor(status) {
    if (status === 'green') return '#22c55e';
    if (status === 'yellow') return '#eab308';
    if (status === 'red') return '#ef4444';
    return '#94a3b8';
}

/** Student curriculum summary — plans matched by class/grade. */
function emsDash360CollectCurriculumAsync(user) {
    if (!user || user.type !== 'student') {
        return Promise.resolve({ books: 0, avgPct: 0, green: 0, yellow: 0, red: 0, items: [] });
    }
    return emsDash360EnsureModule('curriculum').then(function () {
        var plans = emsDash360CacheRead('ems_curriculum_plans', []);
        var daily = emsDash360CacheRead('ems_curriculum_daily', []);
        if (!Array.isArray(plans)) plans = [];
        if (!Array.isArray(daily)) daily = [];
        var grade = String(user.class || user.dept || '').trim();
        if (!grade) {
            return { books: 0, avgPct: 0, green: 0, yellow: 0, red: 0, items: [], missingGrade: true };
        }
        var matched = plans.filter(function (p) {
            if (!p) return false;
            var pg = String(p.grade || '').trim();
            return pg === grade || grade.indexOf(pg) >= 0 || pg.indexOf(grade) >= 0;
        });
        if (typeof window.curComputeStatus !== 'function') {
            return { books: matched.length, avgPct: 0, green: 0, yellow: 0, red: 0, items: [] };
        }
        var green = 0, yellow = 0, red = 0, sum = 0, items = [];
        matched.forEach(function (p) {
            var st = window.curComputeStatus(p, daily);
            if (st.status === 'green') green++;
            else if (st.status === 'yellow') yellow++;
            else red++;
            sum += Number(st.pct) || 0;
            items.push({
                bookName: p.bookName || '—',
                pct: st.pct || 0,
                expectedPct: st.expectedPct || 0,
                status: st.status,
                remaining: st.remaining || 0
            });
        });
        items.sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });
        return {
            books: matched.length,
            avgPct: matched.length ? Math.round(sum / matched.length) : 0,
            green: green,
            yellow: yellow,
            red: red,
            items: items.slice(0, 8)
        };
    });
}

/** Student training/tarbiyat summary — tarComputePersonScore when available. */
function emsDash360CollectTrainingAsync(user) {
    if (!user || user.type !== 'student') {
        return Promise.resolve({
            overall: 0, prayer: 0, ethics: 0, discipline: 0, discCount: 0, alert: false, alerts: []
        });
    }
    return emsDash360EnsureModule('training').then(function () {
        if (typeof window.tarComputePersonScore !== 'function') {
            return { overall: 0, prayer: 0, ethics: 0, discipline: 0, discCount: 0, alert: false, alerts: [] };
        }
        var sc = window.tarComputePersonScore(user.id);
        var alerts = [];
        if (typeof window.tarGetAlerts === 'function') {
            alerts = window.tarGetAlerts().filter(function (a) {
                return a && (a.personId === user.id || a.id === user.id);
            }).slice(0, 5);
        }
        var settings = typeof window.tarGetSettings === 'function' ? window.tarGetSettings() : {};
        var minScore = Number(settings.alertMinScore) || 50;
        return {
            overall: sc.overall,
            prayer: sc.prayer,
            ethics: sc.ethics,
            discipline: sc.discipline,
            hasScoreData: !!sc.hasScoreData,
            discCount: sc.discCount || 0,
            positiveCount: sc.positiveCount || 0,
            negativeCount: sc.negativeCount || 0,
            alert: sc.hasScoreData && sc.overall != null && sc.overall < minScore,
            alerts: alerts
        };
    });
}

/** Teacher/staff payroll + ledger summary from IDB cache. */
function emsDash360CollectLedgerPayrollAsync(user) {
    if (!user || user.type === 'student') return Promise.resolve(null);
    return emsDash360EnsureModule('ledger').then(function () {
        var staffId = user.id;
        var thisMonth = new Date().toISOString().substring(0, 7);
        var payrollHist = emsDash360CacheRead('ems_payroll_history', []);
        var salaryMap = emsDash360CacheRead('ems_full_salary', {});
        var ledger = emsDash360CacheRead('ems_full_ledger', null) || emsDash360CacheRead('ems_ledger_db', []);
        if (!Array.isArray(payrollHist)) payrollHist = [];
        if (!Array.isArray(ledger)) ledger = [];
        if (!salaryMap || typeof salaryMap !== 'object' || Array.isArray(salaryMap)) salaryMap = {};

        var profile = salaryMap[staffId];
        if ((!profile || !profile.base) && typeof window.ldgGetSalaryProfile === 'function') {
            profile = window.ldgGetSalaryProfile(staffId);
        }
        profile = profile || { base: 0, bonus: 0, allowances: {}, deductions: {} };

        var monthRec = null;
        payrollHist.forEach(function (p) {
            if (!p || String(p.staffId) !== String(staffId)) return;
            if ((p.month || '') === thisMonth) monthRec = p;
        });

        var dueBalance = 0;
        if (typeof window.ldgGetStaffDueBalance === 'function') {
            dueBalance = window.ldgGetStaffDueBalance(staffId) || 0;
        }

        var monthLedgerIncome = 0, monthLedgerExpense = 0;
        ledger.forEach(function (l) {
            if (!l || !emsDash360RecordMatches(l, user, ['staffId', 'employeeId', 'individualId', 'teacherId', 'id'])) return;
            if ((l.date || '').substring(0, 7) !== thisMonth) return;
            if (l.type === 'Income') monthLedgerIncome += Number(l.amount) || 0;
            else if (l.type === 'Expense') monthLedgerExpense += Number(l.amount) || 0;
        });

        var baseSal = Number(profile.base) || Number(user.salary) || 0;
        var bonus = Number(profile.bonus) || 0;
        var netExpected = baseSal + bonus;
        var monthPaid = monthRec ? (Number(monthRec.netSalary) || 0) : 0;

        return {
            month: thisMonth,
            baseSalary: baseSal,
            netExpected: netExpected,
            monthPaid: monthPaid,
            paidDate: monthRec ? (monthRec.paidDate || '') : '',
            isPaid: !!monthRec,
            dueBalance: dueBalance,
            monthLedgerIncome: monthLedgerIncome,
            monthLedgerExpense: monthLedgerExpense,
            statusLabel: monthRec ? 'ادا شدہ' : (netExpected > 0 ? 'زیر التواء' : 'ریکارڈ نہیں')
        };
    });
}

function emsDash360WireWhatsApp(user, stdCmp, attStats, curStats, tarStats, ldgStats) {
    var waMsg = '*جامعہ مینجمنٹ سسٹم - 360° آڈٹ رپورٹ*\n\n' +
        '*نام:* ' + (user.name || '-') + '\n' +
        '*آئی ڈی:* ' + (user.id || '-') + '\n' +
        '*درجہ:* ' + (user.class || user.dept || '-') + '\n\n' +
        '*حاضری (3 ماہ):* ' + (attStats ? attStats.rate + '% (' + attStats.present + '/' + attStats.total + ')' : '—') + '\n' +
        '*ڈسپلن شکایات:* ' + (stdCmp ? stdCmp.length : 0) + ' عدد\n';
    if (user.type === 'student' && curStats && curStats.books) {
        waMsg += '*نصاب:* ' + curStats.avgPct + '% اوسط (' + curStats.books + ' کتابیں)\n';
    }
    if (user.type === 'student' && tarStats && tarStats.hasScoreData && tarStats.overall != null) {
        waMsg += '*تربیت:* ' + tarStats.overall + '% مجموعی\n';
    }
    if (user.type !== 'student' && ldgStats) {
        waMsg += '*تنخواہ (' + (ldgStats.month || '') + '):* ' + ldgStats.statusLabel + '\n';
    }
    waMsg += '\nتفصیلی رپورٹ کے لیے دفتر سے رابطہ کریں۔';
    var phone = user.phone ? user.phone.replace(/^0+/, '') : '';
    var url = 'https://wa.me/92' + phone + '?text=' + encodeURIComponent(waMsg);
    var handler = function () { window.open(url, '_blank'); };
    var btnInner = document.getElementById('btn-360-wa');
    var btnHeader = document.getElementById('btn-share-360-wa');
    if (btnInner) btnInner.onclick = handler;
    if (btnHeader) btnHeader.onclick = handler;
}

function emsDash360WireAi(user) {
    var btn = document.getElementById('btn-360-ai');
    if (!btn || !user) return;
    btn.onclick = function () {
        if (typeof window.emsAiCanUse === 'function' && !window.emsAiCanUse()) {
            if (typeof window.showToast === 'function') {
                window.showToast('AI Assistant صرف Admin/Staff کے لیے ہے', 'warning');
            }
            return;
        }
        var payload = {
            intent: 'student_performance',
            studentId: user.id,
            prefillQuestion: 'اس طالب علم کی 360° رپورٹ کا مختصر تجزیہ اور بہتری کے مشورے دیں۔'
        };
        var openPanel = function () {
            if (typeof window.emsAiOpenPanel === 'function') {
                window.emsAiOpenPanel(payload);
            } else if (typeof window.showToast === 'function') {
                window.showToast('AI ماڈیول دستیاب نہیں', 'error');
            }
        };
        if (typeof window.emsEnsureAiClient === 'function') {
            window.emsEnsureAiClient().then(openPanel).catch(function () {
                if (typeof window.showToast === 'function') {
                    window.showToast('AI ماڈیول لوڈ نہیں ہو سکا — refresh کریں', 'error');
                }
            });
        } else {
            openPanel();
        }
    };
}

// 360° رپورٹ بٹن کی فعال/غیر فعال بصری حالت
window.emsToggle360Btn = function() {
    var sel = document.getElementById('dash-360-search-user');
    var btn = document.getElementById('btn-360-generate');
    if (!sel || !btn) return;
    var ready = !!sel.value;
    btn.classList.toggle('active', ready);
    btn.disabled = !ready;
    btn.title = ready ? 'رپورٹ تیار کرنے کے لیے کلک کریں' : 'پہلے کسی فرد کا انتخاب کریں';
};

// مرکزی ڈیش بورڈ اپڈیٹ — DashboardStats + repo truth (regent34)
function emsDashIsDesktopLocal() {
    try {
        if (window.EMS_DESKTOP_UNLIMITED === true) return true;
        if (window.emsDesktop && window.emsDesktop.isDesktop) return true;
    } catch (e) { /* ignore */ }
    return false;
}

/** Apply institution headcount KPIs to dashboard DOM (true DB counts). */
function emsDashApplyHeadcountDom(counts) {
    counts = counts || {};
    var students = counts.students || 0;
    var teachers = counts.teachers || 0;
    var staff = counts.staff || 0;
    if (document.getElementById('dash-total-students')) {
        document.getElementById('dash-total-students').innerText = students.toLocaleString();
    }
    if (document.getElementById('dash-inst-total-students')) {
        document.getElementById('dash-inst-total-students').innerText = students.toLocaleString();
    }
    if (document.getElementById('dash-total-teachers')) {
        document.getElementById('dash-total-teachers').innerText = teachers.toLocaleString();
    }
    if (document.getElementById('dash-total-staff')) {
        document.getElementById('dash-total-staff').innerText = staff.toLocaleString();
    }
    return students;
}

function emsDashApplyAttendanceFromStudentCount(students) {
    if (!students || students <= 0) return;
    var attEl = document.getElementById('dash-att-rate');
    if (!attEl) return;
    var serverStats = typeof window.emsGetDashboardStats === 'function'
        ? window.emsGetDashboardStats() : null;
    var present = serverStats && serverStats.attendance
        ? (serverStats.attendance.todayPresent || 0) : 0;
    var pct = Math.round((present / students) * 100);
    attEl.innerText = pct + '%';
    attEl.title = 'Repo count (' + students + ') — local DB SSOT';
}

/** Repo/SQLite COUNT(*) — never capped array.length. */
function emsDashApplyRepoCounts() {
    if (typeof window.emsRegistrationHeadcounts !== 'function') {
        return Promise.resolve(false);
    }
    return window.emsRegistrationHeadcounts().then(function (counts) {
        if (!counts || !counts.total) return false;
        var students = emsDashApplyHeadcountDom(counts);
        emsDashApplyAttendanceFromStudentCount(students);
        return true;
    }).catch(function () { return false; });
}

function emsDashApplyLocalStudentCounts() {
    return emsDashApplyRepoCounts();
}

window.emsDashApplyLocalStudentCounts = emsDashApplyLocalStudentCounts;
window.emsDashApplyRepoCounts = emsDashApplyRepoCounts;

/** Fast check — how many users are in local SSOT for dashboard report/insights. */
function emsDashReportUserCount() {
    if (typeof window.emsRegRepoGetCount === 'function') {
        var repoCount = window.emsRegRepoGetCount();
        if (repoCount > 0) return repoCount;
    }
    var list = typeof window.emsGetUsersSync === 'function'
        ? window.emsGetUsersSync()
        : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
    return Array.isArray(list) ? list.length : 0;
}

/**
 * Ensure registration users are hydrated for dashboard insights / quick-view / 360.
 * Server KPI path skips full local scan — this loads IDB SSOT on demand without blocking UI.
 * @returns {Promise<{ok:boolean,count:number,source:string}>}
 */
window.emsEnsureDashboardReportData = function (opts) {
    opts = opts || {};
    var existing = emsDashReportUserCount();
    if (existing > 0 && !opts.force) {
        return Promise.resolve({ ok: true, count: existing, source: 'repo_ready' });
    }

    var ready = typeof window.emsEnsureRepositoryReady === 'function'
        ? window.emsEnsureRepositoryReady()
        : Promise.resolve({ ready: false });

    return ready.then(function () {
        if (emsDashReportUserCount() > 0) {
            return { ok: true, count: emsDashReportUserCount(), source: 'idb_hydrate' };
        }
        if (typeof window.emsFirebaseEnsureModuleData === 'function' && opts.skipCloud !== true) {
            return window.emsFirebaseEnsureModuleData({
                force: !!opts.force,
                startLiveSync: false
            });
        }
        if (typeof window.emsBootRegistrationModule === 'function') {
            var tid = (typeof window.emsGetTenantId === 'function' && window.emsGetTenantId())
                || window.CURRENT_MADRASA_TENANT_ID;
            if (tid) {
                return window.emsBootRegistrationModule(tid, {
                    startLiveSync: false,
                    force: !!opts.force
                });
            }
        }
        return { ok: false, count: 0, source: 'no_hydrate_fn' };
    }).then(function (res) {
        var count = emsDashReportUserCount();
        var ok = count > 0
            || !!(res && (res.ok || res.bootComplete || res.ready || res.hydrationComplete));
        return {
            ok: ok,
            count: count || (res && res.count) || 0,
            source: count > 0 ? 'hydrated' : ((res && res.source) || 'empty')
        };
    }).catch(function (err) {
        console.warn('[EMS] emsEnsureDashboardReportData:', err);
        var count = emsDashReportUserCount();
        return { ok: count > 0, count: count, source: 'error' };
    });
};

window.updateMasterDashboard = function(filterRole = 'all', filterClass = '') {
    if (typeof window.emsCanRunEnterpriseBoot === 'function' && !window.emsCanRunEnterpriseBoot()) {
        return;
    }
    try {
        var offlineFirst = window.EMS_OFFLINE_FIRST_SSOT === true || emsDashIsDesktopLocal();

        if (offlineFirst && typeof window.emsDashApplyRepoCounts === 'function') {
            window.emsDashApplyRepoCounts();
        }

        if (typeof window.emsStartDashboardStatsListener === 'function') {
            window.emsStartDashboardStatsListener();
        }

        var serverStats = typeof window.emsGetDashboardStats === 'function'
            ? window.emsGetDashboardStats() : null;
        var useServerKpis = serverStats && serverStats.version >= 2 && !offlineFirst;

        if (offlineFirst) {
            useServerKpis = false;
        }

        if (useServerKpis && typeof window.emsApplyDashboardStats === 'function') {
            window.emsApplyDashboardStats(serverStats, { skipDeptFilter: false, skipHeadcounts: true });
            try {
                if (typeof window.emsDashApplyRepoCounts === 'function') {
                    window.emsDashApplyRepoCounts();
                } else {
                    emsDashApplyLocalStudentCounts();
                }
            } catch (dashErr) {
                console.warn('[EMS] dashboard repo count reconcile:', dashErr);
            }
        } else if (offlineFirst && typeof window.emsDashApplyRepoCounts === 'function') {
            window.emsDashApplyRepoCounts();
        }

        if (useServerKpis && typeof window.emsEnsureDashboardReportData === 'function') {
            window.emsEnsureDashboardReportData().then(function () {
                if (typeof window.emsRenderDashboardInsights === 'function') {
                    window.emsRenderDashboardInsights();
                }
            }).catch(function () {
                if (typeof window.emsRenderDashboardInsights === 'function') {
                    window.emsRenderDashboardInsights();
                }
            });
        } else if (useServerKpis && typeof window.emsRenderDashboardInsights === 'function') {
            window.emsRenderDashboardInsights();
        }

        if (useServerKpis && filterRole === 'all' && filterClass === '') {
            window.emsGetComplaintsAll().then(function (cmpArr) {
                if (typeof window.emsFilterByDepartment === 'function') {
                    cmpArr = window.emsFilterByDepartment(cmpArr);
                }
                if (document.getElementById('dash-total-complaints')) {
                    document.getElementById('dash-total-complaints').innerText = cmpArr.length;
                }
            });
            if (typeof window.curUpdateDashboardCard === 'function') {
                window.curUpdateDashboardCard();
            }
            if (typeof window.tarUpdateDashboardCard === 'function') {
                window.tarUpdateDashboardCard();
            }
            if (typeof window.sysDashRenderCustomWidgets === 'function') {
                window.sysDashRenderCustomWidgets();
            }
            var dmFast = document.getElementById('module-dashboard');
            var tenantReadyFast = (window.emsGetTenantId && window.emsGetTenantId()) || window.CURRENT_MADRASA_TENANT_ID;
            if (dmFast && dmFast.classList.contains('active') && tenantReadyFast &&
                window._emsDashLive && !window._emsDashLive.active &&
                typeof window.emsStartDashboardLive === 'function') {
                window.emsStartDashboardLive();
            }
            return;
        }

        if (useServerKpis && (filterRole !== 'all' || filterClass !== '')) {
            return window.emsLoadDashboardFilterDetails(filterRole, filterClass, serverStats);
        }

        if (!useServerKpis && !window.EMS_REPOSITORY_BOOT_COMPLETE && typeof window.emsEnsureRepositoryReady === 'function') {
            return window.emsEnsureRepositoryReady().then(function (bootRes) {
                if (!bootRes || !bootRes.bootComplete) return;
                window.updateMasterDashboard(filterRole, filterClass);
            });
        }

        let dbUsers = typeof window.emsGetUsersSync === 'function'
            ? window.emsGetUsersSync()
            : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
        if (!Array.isArray(dbUsers)) dbUsers = [];

        let dbLedger = typeof window.emsCacheGet === 'function'
            ? window.emsCacheGet('ems_full_ledger', null) || window.emsCacheGet('ems_ledger_db', [])
            : JSON.parse(localStorage.getItem('ems_full_ledger')) || JSON.parse(localStorage.getItem('ems_ledger_db')) || [];
        if (!Array.isArray(dbLedger)) dbLedger = [];
        let dbAnnouncements = typeof window.emsCacheGet === 'function'
            ? window.emsCacheGet('ems_full_announcements', null) || window.emsCacheGet('ems_announcements', [])
            : JSON.parse(localStorage.getItem('ems_full_announcements')) || JSON.parse(localStorage.getItem('ems_announcements')) || [];
        if (!Array.isArray(dbAnnouncements)) dbAnnouncements = [];
        let feeCollections = typeof window.emsCacheGet === 'function'
            ? window.emsCacheGet('ems_fee_collections', [])
            : JSON.parse(localStorage.getItem('ems_fee_collections')) || [];
        if (!Array.isArray(feeCollections)) feeCollections = [];
        let feeSetups = typeof window.emsCacheGet === 'function'
            ? window.emsCacheGet('ems_student_fee_setup', {})
            : JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};
        if (!feeSetups || typeof feeSetups !== 'object' || Array.isArray(feeSetups)) feeSetups = {};

        let users = dbUsers;
        var dashDeptFilter = document.querySelector('input[name="dash_main_filter"]:checked');
        var useDeptFilter = dashDeptFilter && dashDeptFilter.value === 'all';
        if (useDeptFilter && typeof window.emsFilterByDepartment === 'function') {
            users = window.emsFilterByDepartment(dbUsers);
        }
        if(filterRole !== 'all') users = users.filter(u => u.type === filterRole);
        if(filterClass !== '') users = users.filter(u => u.class === filterClass || u.dept === filterClass);

        let totalStudents = users.filter(u => u.type === 'student').length;
        var instStudentsEl = document.getElementById('dash-inst-total-students');
        var useRepoHeadcounts = !useServerKpis && filterRole === 'all' && filterClass === ''
            && typeof window.emsRegistrationHeadcounts === 'function';

        if (useRepoHeadcounts) {
            window.emsRegistrationHeadcounts().then(function (counts) {
                totalStudents = emsDashApplyHeadcountDom(counts);
                if (!useServerKpis && typeof window.emsApplyDashboardAttendance === 'function') {
                    window.emsApplyDashboardAttendance(totalStudents);
                } else if (!useServerKpis) {
                    emsDashApplyAttendanceFromStudentCount(totalStudents);
                }
            });
        } else if (!useServerKpis) {
            if (document.getElementById('dash-total-students')) {
                document.getElementById('dash-total-students').innerText = totalStudents;
            }
            if (instStudentsEl) {
                instStudentsEl.innerText = totalStudents;
            }
            if (document.getElementById('dash-total-teachers')) {
                document.getElementById('dash-total-teachers').innerText = users.filter(function (u) { return u.type === 'teacher'; }).length;
            }
            if (document.getElementById('dash-total-staff')) {
                document.getElementById('dash-total-staff').innerText = users.filter(function (u) { return u.type === 'staff'; }).length;
            }
        } else if (instStudentsEl && useServerKpis && serverStats && serverStats.counts) {
            instStudentsEl.innerText = serverStats.counts.students;
        }

        var deptLabelEl = document.getElementById('dash-dept-label');
        if (deptLabelEl && typeof window.emsGetDepartmentLabel === 'function') {
            deptLabelEl.innerText = window.emsGetDepartmentLabel();
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const todayMonth = todayStr.substring(0, 7);
        const todayDateNum = parseInt(todayStr.substring(8, 10));

        if (!useServerKpis && !useRepoHeadcounts && typeof window.emsApplyDashboardAttendance === 'function') {
            window.emsApplyDashboardAttendance(totalStudents);
        } else if (!useServerKpis && !useRepoHeadcounts && typeof window.emsFetchTodayAttendanceFromCache === 'function') {
            window.emsFetchTodayAttendanceFromCache({
                todayStr: todayStr,
                todayMonth: todayMonth,
                todayDateNum: todayDateNum
            }).then(function (stats) {
                var attPercent = totalStudents > 0
                    ? Math.round(((stats.present || 0) / totalStudents) * 100) : 0;
                if (document.getElementById('dash-att-rate')) {
                    document.getElementById('dash-att-rate').innerText = attPercent + '%';
                }
            });
        }

        if (!useServerKpis) {
        let ledgerIncome = dbLedger.filter(l => l.type === 'Income').reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
        let collectionIncome = feeCollections.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
        if(document.getElementById('dash-total-income')) document.getElementById('dash-total-income').innerText = "Rs " + (ledgerIncome + collectionIncome).toLocaleString();

        let totalArrears = 0;
        var paidByStudent = {};
        feeCollections.forEach(function (c) {
            if (!c || !c.studentId) return;
            paidByStudent[c.studentId] = (paidByStudent[c.studentId] || 0) + (Number(c.amount) || 0);
        });
        users.filter(u => u.type === 'student').forEach(std => {
            let setup = feeSetups[std.id];
            if(setup) {
                let paid = paidByStudent[std.id] || 0;
                totalArrears += Math.max(0, (Number(setup.netPayable) || 0) - paid);
            }
        });
        if(document.getElementById('dash-remaining-fee')) document.getElementById('dash-remaining-fee').innerText = "Rs " + totalArrears.toLocaleString();

        let todayExpense = dbLedger.filter(l => l.type === 'Expense' && l.date === todayStr).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
        if(document.getElementById('dash-total-expense')) document.getElementById('dash-total-expense').innerText = "Rs " + todayExpense.toLocaleString();
        }

        if (!useServerKpis && document.getElementById('dash-total-announcements')) {
            document.getElementById('dash-total-announcements').innerText = dbAnnouncements.length;
        }

        // شکایات IndexedDB میں محفوظ ہیں — اصل تعداد وہاں سے لائیں (جعلی صفر نہیں)
        window.emsGetComplaintsAll().then(function (cmpArr) {
            if (typeof window.emsFilterByDepartment === 'function') {
                cmpArr = window.emsFilterByDepartment(cmpArr);
            }
            if (document.getElementById('dash-total-complaints')) {
                document.getElementById('dash-total-complaints').innerText = cmpArr.length;
            }
        });

        // عالمی معیار کے اضافی شعبے (مالیات، حاضری، ٹرینڈ، سرگرمی)
        if (typeof window.emsRenderDashboardInsights === 'function') {
            window.emsRenderDashboardInsights();
        }
        if (typeof window.curUpdateDashboardCard === 'function') {
            window.curUpdateDashboardCard();
        }
        if (typeof window.tarUpdateDashboardCard === 'function') {
            window.tarUpdateDashboardCard();
        }
        if (typeof window.sysDashRenderCustomWidgets === 'function') {
            window.sysDashRenderCustomWidgets();
        }

        // ابتدائی لوڈ پر live خودکار شروع کریں (جب tenant تیار ہو اور ڈیش بورڈ کھلا ہو)
        var dm = document.getElementById('module-dashboard');
        var tenantReady = (window.emsGetTenantId && window.emsGetTenantId()) || window.CURRENT_MADRASA_TENANT_ID;
        if (dm && dm.classList.contains('active') && tenantReady &&
            window._emsDashLive && !window._emsDashLive.active &&
            typeof window.emsStartDashboardLive === 'function') {
            window.emsStartDashboardLive();
        }

    } catch (err) {
        console.error("ڈیش بورڈ اپڈیٹ ایرر:", err);
    }
};

/** Filter users from full local SSOT for dashboard role/class drill-down. */
function emsDashFilterUsersLocal(filterRole, filterClass) {
    var list = typeof window.emsGetUsersMerged === 'function'
        ? window.emsGetUsersMerged()
        : (typeof window.emsGetUsersSync === 'function' ? window.emsGetUsersSync() : []);
    if (!Array.isArray(list)) list = [];
    if (filterRole && filterRole !== 'all') {
        list = list.filter(function (u) { return u && u.type === filterRole; });
    }
    if (filterClass) {
        list = list.filter(function (u) {
            return u && (u.class === filterClass || u.dept === filterClass);
        });
    }
    if (typeof window.emsFilterByDepartment === 'function') {
        list = window.emsFilterByDepartment(list);
    }
    return list;
}

/** Dashboard lists use full local SSOT — 0 means no artificial cap. */
window.emsDashboardListLimit = function () {
    return 0;
};

window.emsLoadDashboardFilterDetails = function (filterRole, filterClass, serverStats) {
    var ensure = typeof window.emsEnsureDashboardReportData === 'function'
        ? window.emsEnsureDashboardReportData()
        : (typeof window.emsEnsureRepositoryReady === 'function'
            ? window.emsEnsureRepositoryReady()
            : Promise.resolve());

    return ensure.then(function () {
        var users = emsDashFilterUsersLocal(filterRole, filterClass);
        if (users.length) return users;
        if (typeof window.emsFetchUsersByFilter === 'function') {
            var fetchOpts = { limit: 0 };
            if (filterRole && filterRole !== 'all') fetchOpts.type = filterRole;
            if (filterClass) fetchOpts.className = filterClass;
            return window.emsFetchUsersByFilter(fetchOpts);
        }
        return users;
    }).then(function (users) {
        if (typeof window.emsApplyDashboardStats === 'function' && serverStats) {
            window.emsApplyDashboardStats(serverStats, { users: users, skipDeptFilter: true });
        }
    }).catch(function (err) {
        console.warn('Dashboard filter fetch:', err);
    });
};

// --- شکایات کا واحد ذریعہ (IndexedDB only — Phase A) ---
window.emsGetComplaintsAll = function () {
    if (window.CmpIDB && typeof window.CmpIDB.getAll === 'function') {
        return window.CmpIDB.getAll().then(function (items) {
            var rows = Array.isArray(items) ? items : [];
            if (typeof window.cmpFilterConfidentialRecords === 'function') {
                rows = window.cmpFilterConfidentialRecords(rows);
            }
            return rows;
        }).catch(function () {
            return [];
        });
    }
    return Promise.resolve([]);
};

// --- ماہانہ مالیاتی aggregation ---
function emsDashReadFinance() {
    var ledger = JSON.parse(localStorage.getItem('ems_full_ledger')) || JSON.parse(localStorage.getItem('ems_ledger_db')) || [];
    var collections = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];
    if (!Array.isArray(ledger)) ledger = [];
    if (!Array.isArray(collections)) collections = [];
    return { ledger: ledger, collections: collections };
}

function emsDashMonthKey(d) {
    return (d || '').substring(0, 7);
}

// کسی ماہ کی آمدن/اخراجات نکالیں
function emsDashMonthTotals(ledger, collections, monthKey) {
    var income = 0, expense = 0;
    collections.forEach(function (c) {
        if (emsDashMonthKey(c.date) === monthKey) income += Number(c.amount) || 0;
    });
    ledger.forEach(function (l) {
        if (emsDashMonthKey(l.date) !== monthKey) return;
        if (l.type === 'Income') income += Number(l.amount) || 0;
        else if (l.type === 'Expense') expense += Number(l.amount) || 0;
    });
    return { income: income, expense: expense };
}

// تقابلی اشارہ (↑/↓ فیصد) بنائیں — اضافہ اچھا یا برا context کے مطابق
function emsDashTrendBadge(current, previous, higherIsGood) {
    if (previous === 0 && current === 0) {
        return '<span style="color:#94a3b8;">— پچھلے ماہ کوئی ڈیٹا نہیں</span>';
    }
    var diff = current - previous;
    var pct = previous === 0 ? 100 : Math.round((diff / Math.abs(previous)) * 100);
    var up = diff >= 0;
    var good = higherIsGood ? up : !up;
    var color = diff === 0 ? '#94a3b8' : (good ? 'var(--success)' : 'var(--danger)');
    var arrow = diff === 0 ? 'fa-minus' : (up ? 'fa-arrow-up' : 'fa-arrow-down');
    return '<span style="color:' + color + ';"><i class="fas ' + arrow + '"></i> ' +
        Math.abs(pct) + '% <span style="color:#94a3b8;">پچھلے ماہ سے</span></span>';
}

// مالیاتی کارڈز کے نیچے ماہ بہ ماہ اشارے
function emsRenderKpiTrends(ledger, collections) {
    var now = new Date();
    var thisKey = now.toISOString().substring(0, 7);
    var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var prevKey = prev.toISOString().substring(0, 7);

    var cur = emsDashMonthTotals(ledger, collections, thisKey);
    var pre = emsDashMonthTotals(ledger, collections, prevKey);

    var set = function (id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('dash-fin-income-trend', emsDashTrendBadge(cur.income, pre.income, true));
    set('dash-fin-expense-trend', emsDashTrendBadge(cur.expense, pre.expense, false));
    set('dash-fin-net-trend', emsDashTrendBadge(cur.income - cur.expense, pre.income - pre.expense, true));

    var curColl = collections.filter(function (c) { return emsDashMonthKey(c.date) === thisKey; })
        .reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);
    var preColl = collections.filter(function (c) { return emsDashMonthKey(c.date) === prevKey; })
        .reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);
    set('dash-fin-month-trend', emsDashTrendBadge(curColl, preColl, true));
}

// --- عالمی معیار insights رینڈر ---
window.emsRenderDashboardInsights = function () {
    try {
        var fin = emsDashReadFinance();
        var ledger = fin.ledger;
        var collections = fin.collections;

        var ledgerIncome = ledger.filter(function (l) { return l.type === 'Income'; })
            .reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
        var collectionIncome = collections.reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);
        var totalIncome = ledgerIncome + collectionIncome;

        var totalExpense = ledger.filter(function (l) { return l.type === 'Expense'; })
            .reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);

        var net = totalIncome - totalExpense;
        var thisMonth = new Date().toISOString().substring(0, 7);
        var monthCollection = collections
            .filter(function (c) { return emsDashMonthKey(c.date) === thisMonth; })
            .reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);

        var setTxt = function (id, val) { var el = document.getElementById(id); if (el) el.innerText = val; };
        setTxt('dash-fin-income', 'Rs ' + totalIncome.toLocaleString());
        setTxt('dash-fin-expense', 'Rs ' + totalExpense.toLocaleString());
        var netEl = document.getElementById('dash-fin-net');
        if (netEl) {
            netEl.innerText = 'Rs ' + net.toLocaleString();
            netEl.style.color = net >= 0 ? 'var(--success)' : 'var(--danger)';
        }
        setTxt('dash-fin-month', 'Rs ' + monthCollection.toLocaleString());

        emsRenderKpiTrends(ledger, collections);
        emsRenderAttendanceSnapshot();
        emsRenderActivityFeed(collections);
        if (typeof window.emsRenderDashboardPanels === 'function') window.emsRenderDashboardPanels();
    } catch (err) {
        console.error('Insights رینڈر ایرر:', err);
    }
};

// --- حاضری snapshot (Firestore live) ---
function emsRenderAttendanceSnapshot() {
    var totalStudents = typeof window.emsGetStudentCount === 'function'
        ? window.emsGetStudentCount()
        : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : [])
            .filter(function (u) { return u.type === 'student'; }).length;
    if (typeof window.emsFilterByDepartment === 'function' && typeof window.emsGetUsersMerged === 'function') {
        totalStudents = window.emsFilterByDepartment(
            window.emsGetUsersMerged().filter(function (u) { return u.type === 'student'; })
        ).length;
    }
    var setTxt = function (id, val) { var el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('dash-att-total', totalStudents);

    if (typeof window.emsFetchTodayAttendanceStats !== 'function') return;
    window.emsFetchTodayAttendanceStats().then(function (stats) {
        var present = stats.present || 0;
        var absent = stats.absent != null ? (stats.absent || 0) : 0;
        var leave = stats.leave || 0;
        var markedTotal = stats.markedTotal != null
            ? stats.markedTotal
            : (present + absent + leave);
        var rate = markedTotal > 0 ? Math.min(100, Math.round((present / markedTotal) * 100)) : null;
        setTxt('dash-att-present', markedTotal > 0 ? present : '—');
        setTxt('dash-att-absent', markedTotal > 0 ? absent : '—');
        setTxt('dash-att-rate', rate == null ? 'حاضری نہیں لی گئی' : (rate + '%'));
        setTxt('dash-att-source', stats.source === 'summary' ? 'Summary' : (stats.source === 'firestore' ? 'Firestore' : (stats.source === 'cache' ? 'کیشے' : '—')));
        var ring = document.getElementById('dash-att-ring');
        if (ring) {
            var deg = rate == null ? 0 : Math.round((rate / 100) * 360);
            var col = rate == null ? '#e2e8f0' : (rate >= 75 ? 'var(--success)' : (rate >= 50 ? 'var(--warning)' : 'var(--danger)'));
            ring.style.background = 'conic-gradient(' + col + ' ' + deg + 'deg, #e2e8f0 ' + deg + 'deg)';
        }
    });
}

// --- حالیہ سرگرمی فیڈ (متعدد ذرائع) ---
function emsRenderActivityFeed(collections) {
    var feed = document.getElementById('dash-activity-feed');
    if (!feed) return;
    if (!Array.isArray(collections)) collections = [];

    var users = typeof window.emsGetUsersMerged === 'function'
        ? window.emsGetUsersMerged()
        : (typeof window.emsGetUsersSync === 'function' ? window.emsGetUsersSync() : []);
    if (!Array.isArray(users)) users = [];
    if (typeof window.emsFilterByDepartment === 'function') {
        users = window.emsFilterByDepartment(users);
        if (!Array.isArray(users)) users = [];
    }
    var announcements = typeof window.emsCacheGet === 'function'
        ? (window.emsCacheGet('ems_full_announcements', null) || window.emsCacheGet('ems_announcements', []))
        : [];
    if (!Array.isArray(announcements)) announcements = [];

    var items = [];
    collections.slice(-20).forEach(function (c) {
        items.push({ date: c.date, icon: 'fa-money-bill-wave', color: 'var(--success)', text: 'فیس وصولی: ' + (c.studentName || '-') + ' — Rs ' + (c.amount || 0) });
    });
    users.slice(-20).forEach(function (u) {
        if (!u.regDate && !u.date) return;
        var role = u.type === 'student' ? 'داخلہ' : (u.type === 'teacher' ? 'استاذ تقرری' : 'عملہ تقرری');
        items.push({ date: u.regDate || u.date, icon: 'fa-user-plus', color: 'var(--accent)', text: role + ': ' + (u.name || '-') });
    });
    announcements.slice(-10).forEach(function (a) {
        items.push({ date: a.date, icon: 'fa-bullhorn', color: 'var(--primary)', text: 'اعلان: ' + (a.title || '-') });
    });

    window.emsGetComplaintsAll().then(function (cmp) {
        if (!Array.isArray(cmp)) cmp = [];
        if (typeof window.emsFilterByDepartment === 'function') {
            cmp = window.emsFilterByDepartment(cmp);
            if (!Array.isArray(cmp)) cmp = [];
        }
        cmp.slice(-10).forEach(function (c) {
            items.push({ date: c.date, icon: 'fa-exclamation-triangle', color: 'var(--warning)', text: 'شکایت: ' + ((c.details || c.type || '').substring(0, 40)) });
        });

        items.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        var top = items.slice(0, 12);

        if (!top.length) {
            feed.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">ابھی کوئی سرگرمی نہیں</p>';
            return;
        }
        feed.innerHTML = top.map(function (it) {
            return '<div style="display:flex; align-items:center; gap:12px; padding:10px; border-bottom:1px solid #f1f5f9;">' +
                '<span style="width:34px; height:34px; border-radius:50%; background:#f8fafc; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><i class="fas ' + it.icon + '" style="color:' + it.color + ';"></i></span>' +
                '<span style="flex:1; font-size:14px;">' + it.text + '</span>' +
                '<span style="font-size:12px; color:#94a3b8; white-space:nowrap;">' + (it.date || '-') + '</span>' +
                '</div>';
        }).join('');
    });
}

window.open360ReportForUser = function(userId) {
    window.closeModal('dash-quick-view-modal');
    var radioSome = document.querySelector('input[name="dash_main_filter"][value="some"]');
    if (radioSome) { radioSome.checked = true; window.toggleDashFilterView('some'); }
    var chain = typeof window.emsLoad360UserSelect === 'function'
        ? window.emsLoad360UserSelect({ preserveValue: userId })
        : Promise.resolve();
    chain.then(function () {
        window.emsEnsure360SelectOption(userId);
        if (typeof window.emsToggle360Btn === 'function') window.emsToggle360Btn();
        window.generateMaster360Report();
    }).catch(function (err) {
        console.warn('[EMS] open360ReportForUser:', err);
        window.emsEnsure360SelectOption(userId);
        window.generateMaster360Report();
    });
};

window.generateMaster360Report = function() {
    var sel = document.getElementById('dash-360-search-user');
    var btn = document.getElementById('btn-360-generate');
    var id = sel ? sel.value : '';
    if (!id) {
        if (typeof window.showToast === 'function') window.showToast('پہلے فرد کا انتخاب کریں!', 'error');
        return Promise.resolve();
    }

    if (btn) {
        btn.disabled = true;
        btn.dataset.prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> رپورٹ تیار ہو رہی ہے...';
    }

    function resetBtn() {
        if (!btn) return;
        if (btn.dataset.prevHtml) {
            btn.innerHTML = btn.dataset.prevHtml;
            delete btn.dataset.prevHtml;
        }
        if (typeof window.emsToggle360Btn === 'function') window.emsToggle360Btn();
    }

    return window.emsGetComplaintsAll().then(function (dbComplaints) {
        var hydrate = typeof window.emsEnsureDashboardReportData === 'function'
            ? window.emsEnsureDashboardReportData()
            : Promise.resolve();
        return hydrate.then(function () {
            return window.emsBuild360Report(id, dbComplaints);
        });
    }).catch(function (err) {
        console.warn('[EMS] 360 report compile:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('360 رپورٹ بنانے میں خرابی — دوبارہ کوشش کریں', 'error');
        }
    }).finally(resetBtn);
};

window.emsBuild360Report = function(id, dbComplaints) {
    var loadUser = typeof window.emsGetUserById === 'function'
        ? window.emsGetUserById(id)
        : Promise.resolve((typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : [])
            .find(function (u) { return u.id === id; }));

    return loadUser.then(function (user) {
        if (!user) {
            if (typeof window.showToast === 'function') {
                window.showToast('فرد نہیں ملا — ID یا رجسٹریشن چیک کریں', 'error');
            }
            return Promise.reject(new Error('360_user_not_found'));
        }

        dbComplaints = dbComplaints || [];
        var dbExams = emsDash360ReadExams();
        var feeCollections = typeof window.emsCacheGet === 'function'
            ? window.emsCacheGet('ems_fee_collections', [])
            : [];
        if (!Array.isArray(feeCollections)) feeCollections = [];
        var feeSetups = typeof window.emsCacheGet === 'function'
            ? window.emsCacheGet('ems_student_fee_setup', {})
            : {};

        return Promise.all([
            emsDash360CollectAttendanceAsync(user),
            user.type === 'student' ? emsDash360CollectCurriculumAsync(user) : Promise.resolve(null),
            user.type === 'student' ? emsDash360CollectTrainingAsync(user) : Promise.resolve(null),
            user.type !== 'student' ? emsDash360CollectLedgerPayrollAsync(user) : Promise.resolve(null)
        ]).then(function (parts) {
        var attStats = parts[0];
        var curStats = parts[1];
        var tarStats = parts[2];
        var ldgStats = parts[3];
        var stdRes = dbExams.filter(function (e) {
            return emsDash360RecordMatches(e, user, ['studentId', 'id', 'regId', 'uid', 'docId']);
        });
        var stdCmp = dbComplaints.filter(function (c) {
            return emsDash360RecordMatches(c, user, ['individualId', 'studentId', 'id', 'regId', 'uid', 'docId']);
        });
        var matchedCollections = feeCollections.filter(function (c) {
            return emsDash360RecordMatches(c, user, ['studentId', 'id', 'regId', 'uid', 'docId']);
        });
        var setup = emsDash360LookupMapEntry(feeSetups, user);

        var html = '';

        html += '<div style="position: sticky; top: -40px; background: #fff; padding: 10px; border-radius: 6px; border: 1px solid var(--accent); z-index: 100; display: flex; gap: 10px; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px;">' +
            '<button class="btn btn-success" id="btn-360-wa"><i class="fab fa-whatsapp"></i> واٹس ایپ میسج</button>' +
            '<button class="btn btn-warning" id="btn-360-ai" type="button"><i class="fas fa-robot"></i> AI تجزیہ</button>' +
            '<button class="btn btn-primary" onclick="window.printDiv(\'dash-360-printable-area\')"><i class="fas fa-certificate"></i> سند / رپورٹ پرنٹ</button>' +
            '</div>';

        var dashPhotoSrc = typeof window.emsGetUserPhotoSrc === 'function'
            ? window.emsGetUserPhotoSrc(user)
            : (user.photoBase64 || user.photoUrl || '');
        var imgHtml = dashPhotoSrc
            ? '<img src="' + dashPhotoSrc + '" style="width:110px; height:110px; border-radius:8px; border:2px solid #2c3e50; object-fit:cover;">'
            : '<i class="fas fa-user-circle fa-6x" style="color:#bdc3c7;"></i>';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:20px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:20px;">' +
            '<div style="font-size:16px; line-height:1.8;">' +
            '<div><strong>نام مع ولدیت:</strong> <span style="font-size:18px; color:var(--primary);">' + (user.name || '-') + '</span></div>' +
            '<div><strong>آئی ڈی / شناختی نمبر:</strong> <span style="font-family:Arial; font-weight:bold;">' + (user.id || '-') + '</span></div>' +
            '<div><strong>شعبہ / تعلیمی درجہ:</strong> <span>' + (user.class || user.dept || user.appointed || '-') + '</span></div>' +
            '<div><strong>شناختی کارڈ / ب فارم:</strong> <span style="font-family:Arial;">' + (user.cnic || '-') + '</span></div>' +
            '<div><strong>رابطہ نمبر:</strong> <span style="font-family:Arial;">' + (user.phone || '-') + '</span></div>' +
            '</div><div>' + imgHtml + '</div></div>';

        html += '<h3 style="color:var(--primary); border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:25px;"><i class="fas fa-user-check"></i> حاضری خلاصہ (آخری 3 ماہ)</h3>';
        if (attStats.total === 0) {
            html += '<p style="color:#7f8c8d;">اس مدت میں کوئی حاضری ریکارڈ نہیں ملا۔</p>';
        } else {
            var attColor = attStats.rate >= 80 ? 'var(--success)' : (attStats.rate >= 50 ? 'var(--warning)' : 'var(--danger)');
            html += '<div style="background:#f0fdf4; padding:15px; border:1px solid #bbf7d0; border-radius:6px;">' +
                '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; font-weight:bold; margin-bottom:8px;">' +
                '<span>کل دن: ' + attStats.total + '</span>' +
                '<span style="color:var(--success);">حاضر: ' + attStats.present + '</span>' +
                '<span style="color:var(--danger);">غائب: ' + attStats.absent + '</span>' +
                '<span style="color:var(--warning);">رخصت: ' + attStats.leave + '</span>' +
                '<span style="color:' + attColor + ';">شرح: ' + attStats.rate + '%</span>' +
                '</div>' +
                '<div style="background:#e2e8f0; border-radius:10px; height:12px; overflow:hidden;">' +
                '<div style="background:' + attColor + '; width:' + attStats.rate + '%; height:100%;"></div></div></div>';
        }

        html += '<h3 style="color:var(--primary); border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:25px;"><i class="fas fa-wallet"></i> فنانشل ہیلتھ انڈیکس (مالیاتی کارکردگی)</h3>';
        if (user.type === 'student') {
            if (!setup) {
                html += '<p style="color:#7f8c8d;">ریکارڈ نہیں — فیس سیٹ اپ درج نہیں۔</p>';
            } else {
            var totalPaid = matchedCollections.reduce(function (sum, c) { return sum + (Number(c.amount) || 0); }, 0);
            var netP = Number(setup.netPayable) || 0;
            var totalDue = Math.max(0, netP - totalPaid);
            var percentPaid = netP > 0 ? Math.round((totalPaid / netP) * 100) : 0;
            var barColor = percentPaid >= 100 ? 'green' : (percentPaid > 50 ? 'orange' : 'red');
            html += '<div style="background:#fffbf0; padding:15px; border:1px solid #ffeeba; border-radius:6px;">' +
                '<div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:5px;">' +
                '<span>ٹارگٹ (کل فیس): Rs ' + netP + '</span>' +
                '<span style="color:' + barColor + ';">وصول شدہ: Rs ' + totalPaid + ' (' + percentPaid + '%)</span></div>' +
                '<div style="background:#e2e8f0; border-radius:10px; height:15px; width:100%; overflow:hidden;">' +
                '<div style="background:' + barColor + '; width:' + percentPaid + '%; height:100%;"></div></div>' +
                '<div style="margin-top:10px; font-weight:bold; color:red; text-align:left;">موجودہ بقایا جات: Rs ' + totalDue + '</div></div>';
            }
        } else if (ldgStats) {
            var ldgColor = ldgStats.isPaid ? 'var(--success)' : (ldgStats.netExpected > 0 ? 'var(--warning)' : '#94a3b8');
            html += '<div style="background:#f0f9ff; padding:15px; border:1px solid #bae6fd; border-radius:6px;">' +
                '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; font-weight:bold; margin-bottom:8px;">' +
                '<span>ماہ: ' + (ldgStats.month || '—') + '</span>' +
                '<span style="color:' + ldgColor + ';">حالت: ' + ldgStats.statusLabel + '</span></div>' +
                '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; font-size:14px; line-height:1.8;">' +
                '<div><strong>بنیادی تنخواہ:</strong> Rs ' + (ldgStats.baseSalary || 0).toLocaleString() + '</div>' +
                '<div><strong>متوقع (اس ماہ):</strong> Rs ' + (ldgStats.netExpected || 0).toLocaleString() + '</div>' +
                '<div><strong>ادا شدہ:</strong> Rs ' + (ldgStats.monthPaid || 0).toLocaleString() + '</div>' +
                '<div><strong>بقایا واجبات:</strong> Rs ' + (ldgStats.dueBalance || 0).toLocaleString() + '</div>' +
                '<div><strong>لیجر آمدن:</strong> Rs ' + (ldgStats.monthLedgerIncome || 0).toLocaleString() + '</div>' +
                '<div><strong>لیجر اخراجات:</strong> Rs ' + (ldgStats.monthLedgerExpense || 0).toLocaleString() + '</div>' +
                '</div>' +
                (ldgStats.paidDate ? '<div style="margin-top:8px;font-size:13px;color:#64748b;">ادائیگی کی تاریخ: ' + ldgStats.paidDate + '</div>' : '') +
                '</div>';
        } else {
            html += '<p style="color:#7f8c8d;">مالی / تنخواہ کا خلاصہ دستیاب نہیں — لیجر ماڈیول sync کریں۔</p>';
        }

        if (user.type === 'student') {
            html += '<h3 style="color:var(--primary); border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:25px;"><i class="fas fa-chart-line"></i> اکیڈمک ٹرینڈ لائن (پچھلے امتحانات کا گراف)</h3>';
            if (stdRes.length === 0) {
                html += '<p style="color:#7f8c8d;">کوئی امتحانی رزلٹ موجود نہیں ہے۔</p>';
            } else {
                var recentExams = stdRes.slice(-4);
                var graphHtml = '<div style="display:flex; align-items:flex-end; justify-content:space-around; height:120px; margin-top:15px; padding-bottom:5px; border-bottom:2px solid #cbd5e1; background:#f8fafc; border-radius:8px 8px 0 0; padding-top:20px;">';
                recentExams.forEach(function (r) {
                    var height = r.percentage || 0;
                    var exColor = height >= 80 ? 'var(--success)' : (height >= 50 ? 'var(--warning)' : 'var(--danger)');
                    var exName = (r.examName || '—').substring(0, 10);
                    graphHtml += '<div style="display:flex; flex-direction:column; align-items:center; width:50px;">' +
                        '<span style="font-size:12px; font-weight:bold; margin-bottom:5px; color:' + exColor + ';">' + height + '%</span>' +
                        '<div style="height:' + height + 'px; width:30px; background:' + exColor + '; border-radius:4px 4px 0 0;"></div>' +
                        '<span style="font-size:10px; margin-top:5px; text-align:center;">' + exName + '</span></div>';
                });
                graphHtml += '</div>';
                html += graphHtml;
            }

            html += '<h3 style="color:var(--primary); border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:25px;"><i class="fas fa-book-open"></i> نصاب نگرانی (Curriculum)</h3>';
            if (curStats && curStats.missingGrade) {
                html += '<p style="color:#7f8c8d;">درجہ نہیں — نصاب منصوبہ نہیں دکھایا جا سکتا۔</p>';
            } else if (!curStats || !curStats.books) {
                html += '<p style="color:#7f8c8d;">اس درجہ کے لیے کوئی نصاب منصوبہ نہیں ملا۔</p>';
            } else {
                html += '<div style="background:#faf5ff; padding:15px; border:1px solid #e9d5ff; border-radius:6px; margin-bottom:10px;">' +
                    '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; font-weight:bold;">' +
                    '<span>کل کتابیں: ' + curStats.books + '</span>' +
                    '<span>اوسط تکمیل: ' + curStats.avgPct + '%</span>' +
                    '<span style="color:#22c55e;">ہدف پر: ' + curStats.green + '</span>' +
                    '<span style="color:#eab308;">معمولی: ' + curStats.yellow + '</span>' +
                    '<span style="color:#ef4444;">تاخیر: ' + curStats.red + '</span></div></div>';
                if (curStats.items && curStats.items.length) {
                    html += '<table style="width:100%; border-collapse:collapse; margin-top:8px;" border="1">' +
                        '<tr style="background:#f8fafc;"><th>کتاب</th><th>حقیقی%</th><th>متوقع%</th><th>باقی</th><th>حالت</th></tr>';
                    curStats.items.forEach(function (it) {
                        var col = emsDash360CurriculumStatusColor(it.status);
                        html += '<tr><td>' + (it.bookName || '—') + '</td>' +
                            '<td style="text-align:center;">' + (it.pct || 0) + '%</td>' +
                            '<td style="text-align:center;">' + (it.expectedPct || 0) + '%</td>' +
                            '<td style="text-align:center;">' + (it.remaining || 0) + '</td>' +
                            '<td style="text-align:center;"><span style="background:' + col + '; color:#fff; padding:2px 8px; border-radius:10px; font-size:11px;">' +
                            emsDash360CurriculumStatusLabel(it.status) + '</span></td></tr>';
                    });
                    html += '</table>';
                }
            }

            html += '<h3 style="color:var(--primary); border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:25px;"><i class="fas fa-mosque"></i> تربیت و نظم (Training)</h3>';
            if (!tarStats || !tarStats.hasScoreData) {
                html += '<p style="color:#7f8c8d;">تربیتی ڈیٹا دستیاب نہیں۔</p>';
            } else {
                var fmtTar = typeof window.tarFormatScore === 'function'
                    ? window.tarFormatScore
                    : function (v) { return v == null ? '—' : (v + '%'); };
                var tarColor = tarStats.overall >= 80 ? 'var(--success)' : (tarStats.overall >= 50 ? 'var(--warning)' : 'var(--danger)');
                html += '<div style="background:#f0fdfa; padding:15px; border:1px solid #99f6e4; border-radius:6px;">' +
                    '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; font-weight:bold; margin-bottom:8px;">' +
                    '<span style="color:' + tarColor + ';">مجموعی اسکور: ' + fmtTar(tarStats.overall) + '</span>' +
                    '<span>نماز پابندی: ' + fmtTar(tarStats.prayer) + '</span>' +
                    '<span>اخلاق: ' + fmtTar(tarStats.ethics) + '</span>' +
                    '<span>نظم: ' + fmtTar(tarStats.discipline) + '</span></div>' +
                    '<div style="font-size:13px; color:#64748b;">' +
                    'مثبت ریکارڈ: ' + (tarStats.positiveCount || 0) + ' · منفی: ' + (tarStats.negativeCount || 0) +
                    ' · Discipline واقعات: ' + (tarStats.discCount || 0) + '</div>' +
                    (tarStats.alert ? '<div style="margin-top:8px;color:var(--danger);font-weight:bold;"><i class="fas fa-bell"></i> تربیتی الرٹ — کم اسکور</div>' : '') +
                    '</div>';
                if (tarStats.alerts && tarStats.alerts.length) {
                    html += '<ul style="margin:10px 0 0 18px; color:#475569; font-size:13px;">';
                    tarStats.alerts.forEach(function (a) {
                        html += '<li>' + (a.msg || a.message || '—') + '</li>';
                    });
                    html += '</ul>';
                }
            }
        }

        html += '<h3 style="color:var(--primary); border-bottom:1px solid #ccc; padding-bottom:5px; margin-top:25px;"><i class="fas fa-exclamation-triangle"></i> بیہیویئرل ریڈار (ڈسپلن اور شکایات)</h3>';
        if (stdCmp.length === 0) {
            html += '<div style="background:#e8f5e9; color:green; padding:15px; border-radius:6px; font-weight:bold; border-right:4px solid green;"><i class="fas fa-check-circle"></i> بہترین رویہ: کوئی شکایت یا ڈسپلن کا مسئلہ ریکارڈ پر موجود نہیں ہے۔</div>';
        } else {
            html += '<table style="width:100%; border-collapse:collapse; margin-top:10px;" border="1">' +
                '<tr style="background:#f8fafc;"><th>تاریخ</th><th>شدت</th><th>شکایت کا متن</th></tr>';
            stdCmp.forEach(function (c) {
                var severityColor = 'var(--accent)';
                var severityText = 'معمولی';
                var details = c.details || '';
                var type = c.type || '';
                if (details.indexOf('لڑائی') >= 0 || details.indexOf('سنگین') >= 0 || details.indexOf('مار') >= 0 || type.indexOf('سنگین') >= 0) {
                    severityColor = 'var(--danger)'; severityText = 'سنگین (High)';
                } else if (details.indexOf('تاخیر') >= 0 || details.indexOf('دیر') >= 0 || details.indexOf('شور') >= 0) {
                    severityColor = 'var(--warning)'; severityText = 'درمیانی (Medium)';
                }
                html += '<tr><td style="width:90px;">' + (c.date || '-') + '</td>' +
                    '<td style="width:100px; text-align:center;"><span style="background:' + severityColor + '; color:white; padding:3px 8px; border-radius:12px; font-size:11px;">' + severityText + '</span></td>' +
                    '<td>' + details + '</td></tr>';
            });
            html += '</table>';
        }

        var rw = document.getElementById('dash-360-report-wrapper');
        var rc = document.getElementById('dash-360-rendered-content');
        if (!rc || !rw) {
            if (typeof window.showToast === 'function') window.showToast('رپورٹ ایریا نہیں ملا', 'error');
            return Promise.reject(new Error('360_dom_missing'));
        }
        rc.innerHTML = html;
        rw.style.display = 'block';
        rw.scrollIntoView({ behavior: 'smooth' });

        setTimeout(function () {
            emsDash360WireWhatsApp(user, stdCmp, attStats, curStats, tarStats, ldgStats);
            emsDash360WireAi(user);
        }, 50);
        if (typeof window.showToast === 'function') window.showToast('360° ماسٹر رپورٹ تیار ہے', 'success');
        });
    }).catch(function (err) {
        if (err && err.message === '360_user_not_found') throw err;
        console.warn('[EMS] emsBuild360Report:', err);
        if (typeof window.showToast === 'function') window.showToast('رپورٹ ڈیٹا compile نہیں ہو سکا', 'error');
        throw err;
    });
};

// ============================================================================
// لائیو حالت (Live) — Firestore listeners + storage events + ہلکا interval
// ============================================================================
window._emsDashLive = window._emsDashLive || {
    unsubs: [], timer: null, storage: null, active: false
};

function emsHasServerDashboardStats() {
    if (typeof window.emsGetDashboardStats !== 'function') return false;
    var stats = window.emsGetDashboardStats();
    return !!(stats && stats.version >= 2);
}

/** Phase 2 P1 — legacy collection listeners removed; DashboardStats v2 only. */

function emsSetLiveIndicator(on) {
    var dot = document.getElementById('dash-live-dot');
    var txt = document.getElementById('dash-live-text');
    if (dot) dot.style.background = on ? 'var(--success)' : '#cbd5e1';
    if (dot) dot.style.boxShadow = on ? '0 0 0 3px rgba(46,204,113,0.25)' : 'none';
    if (txt) { txt.innerText = on ? 'لائیو' : 'آف لائن'; txt.style.color = on ? 'var(--success)' : '#94a3b8'; }
}

function emsDashWriteLocalNoSync(key, value) {
    var str = JSON.stringify(value);
    if (window._emsOriginalSetItem) {
        window._emsSuppressSync = true;
        window._emsOriginalSetItem.call(localStorage, key, str);
        window._emsSuppressSync = false;
    } else {
        localStorage.setItem(key, str);
    }
}

window.emsStartDashboardLive = function () {
    var L = window._emsDashLive;
    if (L.active) return;
    L.active = true;
    emsSetLiveIndicator(true);

    if (typeof window.emsStartDashboardStatsListener === 'function') {
        window.emsStartDashboardStatsListener();
    }
    if (typeof window.emsStartModuleSummariesListener === 'function') {
        window.emsStartModuleSummariesListener();
    }
    if (!emsHasServerDashboardStats() && typeof window.emsRefreshDashboardStats === 'function') {
        window.emsRefreshDashboardStats().catch(function () { /* Cloud Function may be unavailable */ });
    }
    if (!window._attSummaryHook) {
        window._attSummaryHook = true;
        window.emsOnAttendanceSummaryUpdate = function () {
            var mod = document.getElementById('module-dashboard');
            if (mod && mod.classList.contains('active')) {
                emsRenderAttendanceSnapshot();
            }
        };
    }

    // 2) دیگر ٹیبز/ونڈوز سے تبدیلیاں
    L.storage = function (e) {
        if (!e || !e.key) return;
        if (/ems_(fee_collections|full_ledger|announcements|full_users|full_complaints)/.test(e.key)) {
            window.updateMasterDashboard();
        }
    };
    window.addEventListener('storage', L.storage);

    // 3) Fallback — ہر 2 منٹ (صرف جب stats دستیاب نہ ہوں)
    L.timer = setInterval(function () {
        var dm = document.getElementById('module-dashboard');
        if (!dm || !dm.classList.contains('active')) return;
        if (typeof window.emsGetDashboardStats === 'function' && window.emsGetDashboardStats()) return;
        window.updateMasterDashboard();
    }, 120000);
};

window.emsStopDashboardLive = function () {
    var L = window._emsDashLive;
    if (!L || !L.active) return;
    if (typeof window.emsStopDashboardStatsListener === 'function') {
        window.emsStopDashboardStatsListener();
    }
    if (typeof window.emsStopModuleSummariesListener === 'function') {
        window.emsStopModuleSummariesListener();
    }
    L.unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    L.unsubs = [];
    if (L.timer) { clearInterval(L.timer); L.timer = null; }
    if (L.storage) { window.removeEventListener('storage', L.storage); L.storage = null; }
    L.active = false;
    emsSetLiveIndicator(false);
};

// ============================================================================
// ڈیش بورڈ ایکسپورٹ (پرنٹ / PDF) — صاف خلاصہ
// ============================================================================
window.emsExportDashboard = function () {
    var g = function (id) { var el = document.getElementById(id); return el ? el.innerText : '-'; };
    var madrasa = (window.CURRENT_MADRASA_DATA && (window.CURRENT_MADRASA_DATA.madrasaName || window.CURRENT_MADRASA_DATA.name)) || 'ادارہ';
    var now = new Date().toLocaleString('ur-PK');

    var kpi = [
        ['کل طلبہ', g('dash-total-students')], ['کل اساتذہ', g('dash-total-teachers')],
        ['کل عملہ', g('dash-total-staff')], ['آج کی حاضری', g('dash-att-rate')],
        ['کل آمدن', g('dash-fin-income')], ['کل اخراجات', g('dash-fin-expense')],
        ['خالص بیلنس', g('dash-fin-net')], ['اس ماہ وصولی', g('dash-fin-month')],
        ['بقایا فیس', g('dash-remaining-fee')], ['درج شدہ شکایات', g('dash-total-complaints')]
    ];
    var rows = kpi.map(function (k) {
        return '<tr><td style="padding:8px 12px; border:1px solid #ccc;">' + k[0] +
            '</td><td style="padding:8px 12px; border:1px solid #ccc; font-weight:bold; text-align:left;">' + k[1] + '</td></tr>';
    }).join('');

    var html = '<div style="font-family:\'Noto Nastaliq Urdu\',Arial; direction:rtl; text-align:right; padding:20px;">' +
        '<div style="text-align:center; border-bottom:3px double #2c3e50; padding-bottom:12px; margin-bottom:20px;">' +
        '<h1 style="margin:0; color:#2c3e50;">' + madrasa + '</h1>' +
        '<h3 style="margin:5px 0; color:#7f8c8d;">ڈیش بورڈ خلاصہ رپورٹ</h3>' +
        '<p style="margin:0; color:#7f8c8d; font-size:13px;">تاریخ: ' + now + '</p></div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:15px;">' + rows + '</table>' +
        '<div style="margin-top:30px;">' + (document.getElementById('dash-activity-feed') ? '<h3 style="color:#2c3e50;">حالیہ سرگرمی</h3>' + document.getElementById('dash-activity-feed').innerHTML : '') + '</div>' +
        '<p style="margin-top:30px; text-align:center; color:#94a3b8; font-size:12px;">یہ رپورٹ خودکار طور پر تیار کی گئی — Education Management System</p></div>';

    var w = window.open('', '_blank');
    if (!w) { window.showToast && window.showToast('پاپ اپ بلاک ہے، اجازت دیں', 'error'); return; }
    w.document.write('<html><head><title>ڈیش بورڈ رپورٹ</title></head><body>' + html + '</body></html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 400);
};

// ڈیش بورڈ کے فلٹرز چلانے کے لیے DOM ایونٹ
function dashBindFilterControls() {
    if (window._dashFiltersBound) return;
    window._dashFiltersBound = true;

    function loadDashFilters() {
        const specSelect = document.getElementById('dash-specific-select');
        const searchUserSelect = document.getElementById('dash-360-search-user');

        if (specSelect) {
            let classes = typeof window.emsCacheGet === 'function'
                ? window.emsCacheGet('ems_classes', [])
                : [];
            let depts = typeof window.emsCacheGet === 'function'
                ? window.emsCacheGet('ems_departments', [])
                : [];
            specSelect.innerHTML = '<option value="">تمام درجات/شعبے</option>';
            classes.forEach(c => specSelect.innerHTML += `<option value="${c}">${c}</option>`);
            depts.forEach(d => specSelect.innerHTML += `<option value="${d}">${d}</option>`);
        }

        if (searchUserSelect && !searchUserSelect.dataset.lazyBound) {
            searchUserSelect.dataset.lazyBound = '1';
            searchUserSelect.addEventListener('focus', function lazy360Users() {
                if (searchUserSelect.options.length > 1) return;
                if (typeof window.emsLoad360UserSelect === 'function') {
                    window.emsLoad360UserSelect();
                }
            }, { once: false });
        }
    }
    
    setTimeout(loadDashFilters, 500); 
    document.getElementById('tab-dashboard')?.addEventListener('click', () => { 
        loadDashFilters(); 
    });

    document.getElementById('btn-dash-apply-filter')?.addEventListener('click', () => {
        const role = document.getElementById('dash-overall-select').value;
        const cls = document.getElementById('dash-specific-select').value;
        window.updateMasterDashboard(role, cls);
        window.showToast("شماریات اپڈیٹ کر دی گئی ہیں!", "success");
    });
}

if (typeof window.emsRunWhenDomReady === 'function') {
    window.emsRunWhenDomReady(dashBindFilterControls);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dashBindFilterControls, { once: true });
} else {
    dashBindFilterControls();
}

if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('dashboard', function () {
        if (typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
    });
}

if (typeof window.addEventListener === 'function') {
    window.addEventListener('ems:users-changed', function () {
        if (typeof window.emsDashApplyLocalStudentCounts === 'function') {
            window.emsDashApplyLocalStudentCounts();
        }
    });
}

// ============================================================================
// Coalesce master-dashboard refreshes (performance)
// ----------------------------------------------------------------------------
// A single data change fans out to several ems:users-changed listeners
// (bootstrap, admission, registration-ui, department refresh) that each call
// updateMasterDashboard() — a full scan of users + attendance keys. Collapse
// all calls within one animation frame into a SINGLE run (latest filter args
// win). updateMasterDashboardNow stays available for any rare sync need.
// ============================================================================
(function () {
    var _worker = window.updateMasterDashboard;
    if (typeof _worker !== 'function' || _worker.__emsCoalesced) return;
    window.updateMasterDashboardNow = _worker;
    var _scheduled = false;
    var _args = null;
    function _raf(cb) {
        return (typeof window.requestAnimationFrame === 'function')
            ? window.requestAnimationFrame(cb)
            : setTimeout(cb, 16);
    }
    var coalesced = function (filterRole, filterClass) {
        _args = [filterRole, filterClass];
        if (_scheduled) return;
        _scheduled = true;
        _raf(function () {
            _scheduled = false;
            var a = _args || [];
            _args = null;
            try { window.updateMasterDashboardNow(a[0], a[1]); } catch (e) { /* ignore */ }
        });
    };
    coalesced.__emsCoalesced = true;
    window.updateMasterDashboard = coalesced;
})();