// ============================================================================
// EMS Parent Portal — Phase 4 (Cloud Function data path only)
// ============================================================================
(function () {
    'use strict';

    function getUsers() {
        if (typeof window.emsGetUsersMerged === 'function') return window.emsGetUsersMerged();
        return [];
    }

    function getTenantId() {
        if (window.emsGetTenantId) return window.emsGetTenantId();
        if (window.CURRENT_MADRASA_TENANT_ID) return window.CURRENT_MADRASA_TENANT_ID;
        var u = firebase.auth().currentUser;
        return u ? u.uid : null;
    }

    function esc(str) {
        return typeof window.emsSanitize === 'function' ? window.emsSanitize(str) : String(str || '');
    }

    function monthKey(d) {
        d = d || new Date();
        return d.toISOString().substring(0, 7);
    }

    function cfUnavailableError() {
        return new Error('سرور ڈیٹا سروس دستیاب نہیں — براہ کرم دوبارہ کوشش کریں۔');
    }

    function callParentData(view, studentId) {
        if (typeof window.emsCallFunction !== 'function') {
            return Promise.reject(cfUnavailableError());
        }
        return window.emsCallFunction('getParentStudentData', {
            tenantId: getTenantId(),
            studentId: studentId,
            view: view
        });
    }

    /** All parent views — server only (Phase 4) */
    function fetchStudentAttendance(studentId) {
        var mk = monthKey();
        return callParentData('attendance', studentId).then(function (data) {
            return data || { days: [], summary: {}, source: 'server', month: mk };
        });
    }

    function fetchStudentExamResults(studentId) {
        return callParentData('results', studentId).then(function (rows) {
            return Array.isArray(rows) ? rows : [];
        });
    }

    function fetchStudentFeeSummary(studentId) {
        return callParentData('fee', studentId);
    }

    function fetchAnnouncementsForParent(studentId) {
        return callParentData('announcements', studentId || '').then(function (rows) {
            return Array.isArray(rows) ? rows : [];
        });
    }

    function fetchTeacherNotesForParent(studentId) {
        return callParentData('teacher_notes', studentId || '').then(function (rows) {
            return Array.isArray(rows) ? rows : [];
        });
    }

    function fetchStudentComplaints(studentId) {
        return callParentData('complaints', studentId).then(function (rows) {
            return Array.isArray(rows) ? rows : [];
        });
    }

    function fetchStudentTraining(studentId) {
        return callParentData('training', studentId).then(function (data) {
            return data || { source: 'server', periodDays: 30, prayerSummary: {}, prayer: [], ethics: [], discipline: [] };
        });
    }

    var PP_CMP_STATUS_COLORS = {
        pending: '#2563eb',
        in_progress: '#d97706',
        resolved: '#16a34a',
        rejected: '#b91c1c',
        needs_info: '#7c3aed',
        'نئی': '#2563eb',
        'زیرِ غور': '#7c3aed',
        'ذمہ دار کے پاس': '#0891b2',
        'کارروائی جاری': '#d97706',
        'حل شدہ': '#16a34a',
        'بند شدہ': '#64748b',
        'مسترد': '#b91c1c',
        'مزید معلومات درکار': '#7c3aed'
    };

    function ppComplaintStatusBadge(c) {
        var status = c.status || 'نئی';
        var key = c.statusKey || '';
        var color = PP_CMP_STATUS_COLORS[key] || PP_CMP_STATUS_COLORS[status] || '#64748b';
        return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;background:' + color + '18;color:' + color + ';border:1px solid ' + color + '44;">' + esc(status) + '</span>';
    }

    function ppPriorityBadge(priority) {
        var map = { 'فوری': '#dc2626', 'اہم': '#d97706', 'معمولی': '#16a34a' };
        var color = map[priority] || '#64748b';
        return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;background:' + color + '15;color:' + color + ';">' + esc(priority || 'معمولی') + '</span>';
    }

    function renderComplaintsHtml(list) {
        if (!list.length) return '<p>آپ کی کوئی شکایت ریکارڈ نہیں۔</p>';
        return '<div style="display:flex;flex-direction:column;gap:12px;">' + list.map(function (c) {
            var resBlock = '';
            if (c.latestResolution && c.latestResolution.remarks) {
                resBlock = '<div style="margin-top:10px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">' +
                    '<div style="font-size:11px;color:#15803d;font-weight:600;margin-bottom:4px;"><i class="fas fa-check-circle"></i> تازہ ترین کارروائی' +
                    (c.latestResolution.statusLabel ? ' — ' + esc(c.latestResolution.statusLabel) : '') +
                    (c.latestResolution.date ? ' <small>(' + esc(c.latestResolution.date) + ')</small>' : '') + '</div>' +
                    '<div style="font-size:13px;color:#166534;">' + esc(c.latestResolution.remarks) + '</div></div>';
            } else if (c.statusKey === 'resolved' || c.status === 'حل شدہ') {
                resBlock = '<div style="margin-top:8px;font-size:12px;color:#16a34a;"><i class="fas fa-check"></i> یہ معاملہ حل شدہ ہے۔</div>';
            }
            return '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#fff;">' +
                '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">' +
                ppComplaintStatusBadge(c) + ppPriorityBadge(c.priority) +
                '<small style="color:#64748b;margin-right:auto;">' + esc(c.date || '—') + '</small></div>' +
                '<div style="font-weight:600;color:#1e293b;margin-bottom:4px;">' + esc(c.type || c.category || 'شکایت') + '</div>' +
                '<div style="font-size:13px;color:#475569;line-height:1.6;">' + esc(c.details || '—') + '</div>' +
                resBlock + '</div>';
        }).join('') + '</div>';
    }

    var PP_PRAYER_LABELS = { fajr: 'فجر', zuhr: 'ظہر', asr: 'عصر', maghrib: 'مغرب', isha: 'عشاء' };
    var PP_PRAYER_STATUS_LABELS = {
        jamaat: 'باجماعت', individual: 'انفرادی', late: 'تاخیر', leave: 'رخصت', absent: 'غیر حاضر'
    };
    var PP_PRAYER_STATUS_COLORS = {
        jamaat: '#16a34a', individual: '#2563eb', late: '#d97706', leave: '#0891b2', absent: '#dc2626'
    };

    function renderTrainingHtml(data) {
        data = data || {};
        var summary = data.prayerSummary || {};
        var totals = summary.totals || {};
        var pct = summary.compliancePct;
        var pctColor = pct == null ? '#94a3b8' : (pct >= 75 ? '#16a34a' : (pct >= 50 ? '#d97706' : '#dc2626'));
        var html = '<div style="margin-bottom:16px;padding:14px 16px;border-radius:12px;background:linear-gradient(135deg,#eff6ff 0%,#f0fdf4 100%);border:1px solid #bfdbfe;">' +
            '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;">' +
            '<div><div style="font-size:13px;color:#1d4ed8;font-weight:600;"><i class="fas fa-radar"></i> Behavioral & Prayer Radar</div>' +
            '<div style="font-size:12px;color:#64748b;">آخری ' + (data.periodDays || 30) + ' دن (سرور)</div></div>' +
            '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:' + pctColor + ';">' + (pct != null ? pct + '%' : '—') + '</div>' +
            '<div style="font-size:11px;color:#64748b;">نماز تعمیل</div></div></div></div>';

        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:16px;">';
        [['باجماعت', totals.jamaat, '#16a34a'], ['انفرادی', totals.individual, '#2563eb'], ['تاخیر', totals.late, '#d97706'], ['رخصت', totals.leave, '#0891b2'], ['غائب', totals.absent, '#dc2626']].forEach(function (item) {
            html += '<div style="text-align:center;padding:10px 8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;">' +
                '<div style="font-size:18px;font-weight:700;color:' + item[2] + ';">' + (item[1] || 0) + '</div>' +
                '<div style="font-size:11px;color:#64748b;">' + item[0] + '</div></div>';
        });
        html += '</div>';

        var prayerRows = data.prayer || [];
        if (prayerRows.length) {
            html += '<h4 style="margin:0 0 8px;font-size:14px;color:#1e293b;"><i class="fas fa-mosque"></i> نماز نگرانی (حالیہ)</h4>';
            html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
            prayerRows.slice(0, 7).forEach(function (p) {
                var chips = Object.keys(PP_PRAYER_LABELS).map(function (prId) {
                    var st = (p.prayers && p.prayers[prId]) || 'absent';
                    var col = PP_PRAYER_STATUS_COLORS[st] || '#94a3b8';
                    var lbl = PP_PRAYER_STATUS_LABELS[st] || st;
                    return '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:' + col + '15;color:' + col + ';margin-left:4px;">' +
                        PP_PRAYER_LABELS[prId] + ': ' + lbl + '</span>';
                }).join('');
                html += '<div style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">' +
                    '<strong style="font-size:12px;">' + esc(p.date) + '</strong><div style="margin-top:6px;flex-wrap:wrap;display:flex;">' + chips + '</div></div>';
            });
            html += '</div>';
        } else {
            html += '<p style="font-size:13px;color:#94a3b8;margin-bottom:16px;">اس مدت میں نماز کا کوئی ریکارڈ نہیں۔</p>';
        }

        var ethics = data.ethics || [];
        html += '<h4 style="margin:0 0 8px;font-size:14px;color:#1e293b;"><i class="fas fa-heart"></i> اخلاقی مشاہدات</h4>';
        if (ethics.length) {
            html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
            ethics.slice(0, 8).forEach(function (e) {
                var isPos = e.kind === 'positive';
                var icon = isPos ? '<i class="fas fa-plus-circle" style="color:#16a34a;"></i>' : '<i class="fas fa-minus-circle" style="color:#dc2626;"></i>';
                html += '<div style="padding:10px 12px;border-radius:8px;border:1px solid ' + (isPos ? '#bbf7d0' : '#fecaca') + ';background:' + (isPos ? '#f0fdf4' : '#fef2f2') + ';">' +
                    '<div style="font-size:12px;color:#64748b;">' + esc(e.date) + ' • ' + esc(e.category || '') + ' ' + icon + '</div>' +
                    '<div style="font-size:13px;color:#334155;margin-top:4px;">' + esc(e.note || '—') + '</div></div>';
            });
            html += '</div>';
        } else {
            html += '<p style="font-size:13px;color:#94a3b8;margin-bottom:16px;">کوئی اخلاقی مشاہدہ نہیں۔</p>';
        }

        var disc = data.discipline || [];
        html += '<h4 style="margin:0 0 8px;font-size:14px;color:#1e293b;"><i class="fas fa-gavel"></i> نظم و ضبط</h4>';
        if (disc.length) {
            html += '<div style="display:flex;flex-direction:column;gap:8px;">';
            disc.slice(0, 8).forEach(function (d) {
                html += '<div style="padding:10px 12px;border-radius:8px;border:1px solid #fde68a;background:#fffbeb;">' +
                    '<div style="font-weight:600;font-size:13px;color:#92400e;">' + esc(d.type || 'تنبیہ') + ' <small style="color:#64748b;font-weight:normal;">(' + esc(d.date) + ')</small></div>' +
                    '<div style="font-size:13px;color:#78350f;margin-top:4px;">' + esc(d.detail || '—') + '</div>' +
                    (d.outcome ? '<div style="font-size:12px;color:#16a34a;margin-top:4px;"><i class="fas fa-flag-checkered"></i> ' + esc(d.outcome) + '</div>' : '') +
                    '</div>';
            });
            html += '</div>';
        } else {
            html += '<p style="font-size:13px;color:#94a3b8;">کوئی نظم و ضبطی کارروائی نہیں۔</p>';
        }

        return html;
    }

    function renderAttendanceHtml(data) {
        var s = data.summary || {};
        var html = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">';
        html += '<span class="badge" style="background:#dcfce7;color:#166534;padding:6px 10px;border-radius:6px;">حاضر: ' + (s.present || 0) + '</span>';
        html += '<span class="badge" style="background:#fee2e2;color:#991b1b;padding:6px 10px;border-radius:6px;">غائب: ' + (s.absent || 0) + '</span>';
        html += '<span class="badge" style="background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:6px;">رخصت: ' + (s.leave || 0) + '</span>';
        html += '</div>';
        html += '<p style="font-size:12px;color:#64748b;">مہینہ: ' + esc(data.month) + ' | ماخذ: سرور</p>';
        if (!data.days || !data.days.length) {
            html += '<p>اس ماہ کی کوئی حاضری ریکارڈ نہیں۔</p>';
            return html;
        }
        html += '<table class="data-table" style="width:100%;font-size:13px;"><thead><tr><th>تاریخ (دن)</th><th>حالت</th></tr></thead><tbody>';
        data.days.forEach(function (d) {
            html += '<tr><td>' + esc(d.day) + '</td><td>' + esc(d.status) + '</td></tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    window._ppExamCache = window._ppExamCache || {};
    window._ppFeeCache = window._ppFeeCache || {};

    function ppEnsureLazyModule(modId) {
        if (typeof window.emsLazyLoadModule === 'function') {
            return window.emsLazyLoadModule(modId);
        }
        return Promise.reject(new Error('ماڈیول لوڈر دستیاب نہیں'));
    }

    function renderResultsHtml(rows, studentId) {
        studentId = studentId || '';
        window._ppExamCache[studentId] = rows || [];
        if (!rows.length) return '<p>کوئی امتحانی نتیجہ نہیں ملا۔</p>';
        var html = '<table class="data-table" style="width:100%;font-size:13px;"><thead><tr><th>امتحان</th><th>کلاس</th><th>%</th><th>گریڈ</th><th>عمل</th></tr></thead><tbody>';
        rows.slice(0, 15).forEach(function (r, idx) {
            html += '<tr><td>' + esc(r.examName) + '</td><td>' + esc(r.class) + '</td><td>' + esc(r.percentage) + '</td><td>' + esc(r.grade) + '</td>' +
                '<td><button type="button" class="btn btn-sm btn-outline" onclick="window.ppPrintExamResult(' + JSON.stringify(studentId) + ',' + idx + ')" title="کشف النتیجہ پرنٹ">' +
                '<i class="fas fa-print"></i> نتیجہ پرنٹ کریں</button></td></tr>';
        });
        html += '</tbody></table>';
        html += '<p style="font-size:11px;color:#64748b;margin-top:8px;">پرنٹ پر وہی برانڈڈ کشف النتیجہ دکھائی دے گا جو عملہ پرنٹ کرتا ہے۔</p>';
        return html;
    }

    function renderFeeHtml(fee, studentId) {
        fee = fee || {};
        studentId = studentId || '';
        window._ppFeeCache[studentId] = fee;
        var html = '<p><strong>کل وصولی:</strong> ' + (fee.totalPaid || 0).toLocaleString('ur-PK') + ' روپے</p>';
        if (fee.totalBilled > 0) {
            html += '<p><strong>کل چالان (Billed):</strong> ' + esc(fee.totalBilled) + ' روپے</p>';
        }
        if (fee.monthlyCharge) {
            html += '<p><strong>ماہانہ فیس:</strong> ' + esc(fee.monthlyCharge) + ' روپے</p>';
        }
        if (fee.arrears > 0) {
            html += '<p style="color:#dc2626;"><strong>بقایا:</strong> ' + esc(fee.arrears) + ' روپے</p>';
        }
        if (fee.advanceBalance > 0) {
            html += '<p style="color:#16a34a;"><strong>پیشگی بیلنس:</strong> ' + esc(fee.advanceBalance) + ' روپے</p>';
        }
        if (!fee.collections || !fee.collections.length) {
            html += '<p>کوئی حالیہ وصولی ریکارڈ نہیں۔</p>';
            return html;
        }
        html += '<table class="data-table" style="width:100%;font-size:13px;"><thead><tr><th>تاریخ</th><th>رقم</th><th>رسید</th><th>عمل</th></tr></thead><tbody>';
        fee.collections.forEach(function (c, idx) {
            var voidTag = c.isVoid ? ' <span style="color:#92400e;font-size:11px;">(منسوخ)</span>' : '';
            var amtStyle = c.isVoid ? 'text-decoration:line-through;color:#94a3b8;' : '';
            var btnLabel = c.isVoid ? 'رسید دیکھیں' : 'رسید پرنٹ کریں';
            html += '<tr><td>' + esc(c.date) + '</td><td style="' + amtStyle + '">' + (c.amount || 0) + voidTag + '</td><td>' + esc(c.id) + '</td>' +
                '<td><button type="button" class="btn btn-sm btn-outline" onclick="window.ppPrintFeeReceipt(' + JSON.stringify(studentId) + ',' + idx + ')">' +
                '<i class="fas fa-receipt"></i> ' + btnLabel + '</button></td></tr>';
        });
        html += '</tbody></table>';
        html += '<p style="font-size:11px;color:#64748b;margin-top:8px;">پرنٹ پر برانڈڈ رسید (QR سمیت) دکھائی دے گی۔</p>';
        return html;
    }

    function renderAnnouncementsHtml(anns, studentId) {
        if (!anns.length) return '<p>کوئی اعلان نہیں۔</p>';
        return '<ul style="padding-right:18px;list-style:none;margin:0;">' + anns.slice(0, 10).map(function (a) {
            var voteBlock = '';
            if (a.kind === 'proposal' || a.kind === 'advice') {
                var agreeActive = a.myVote === 'agree' ? ' background:#dcfce7;border-color:#16a34a;' : '';
                var disagreeActive = a.myVote === 'disagree' ? ' background:#fee2e2;border-color:#dc2626;' : '';
                var tally = a.voteTally || { agree: 0, disagree: 0 };
                voteBlock = '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
                    '<button type="button" class="btn btn-sm btn-outline" style="font-size:12px;' + agreeActive + '" onclick="window.ppSubmitAnnouncementVote(' +
                    JSON.stringify(studentId) + ',' + JSON.stringify(a.id) + ',\'agree\')">متفق</button>' +
                    '<button type="button" class="btn btn-sm btn-outline" style="font-size:12px;' + disagreeActive + '" onclick="window.ppSubmitAnnouncementVote(' +
                    JSON.stringify(studentId) + ',' + JSON.stringify(a.id) + ',\'disagree\')">غیر متفق</button>' +
                    '<small style="color:#64748b;">(متفق: ' + (tally.agree || 0) + '، غیر متفق: ' + (tally.disagree || 0) + ')</small>' +
                    '</div>';
            }
            return '<li style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;">' +
                '<strong>' + esc(a.title) + '</strong> <small>(' + esc(a.date) + ')</small><br>' +
                '<span style="color:#475569;">' + esc(a.details) + '</span>' + voteBlock + '</li>';
        }).join('') + '</ul>';
    }

    window.ppSubmitAnnouncementVote = function (studentId, announcementId, voteType) {
        if (typeof window.emsCallFunction !== 'function') {
            return Promise.reject(cfUnavailableError());
        }
        return window.emsCallFunction('submitParentVote', {
            tenantId: getTenantId(),
            studentId: studentId,
            announcementId: announcementId,
            voteType: voteType
        }).then(function (res) {
            if (typeof window.showToast === 'function') {
                window.showToast(voteType === 'agree' ? 'آپ کی رائے (متفق) محفوظ ہو گئی' : 'آپ کی رائے (غیر متفق) محفوظ ہو گئی', 'success');
            }
            if (typeof window.ppReloadCurrentView === 'function') {
                window.ppReloadCurrentView(studentId);
            }
            return res;
        }).catch(function (err) {
            if (typeof window.showToast === 'function') {
                window.showToast((err && err.message) || 'رائے محفوظ نہیں ہو سکی', 'error');
            }
            throw err;
        });
    };

    function fetchParentMessages(studentId) {
        if (typeof window.emsCallFunction !== 'function') {
            return Promise.reject(cfUnavailableError());
        }
        return window.emsCallFunction('getParentMessages', {
            tenantId: getTenantId(),
            studentId: studentId,
            limit: 100
        }).then(function (data) {
            return (data && data.messages) ? data.messages : [];
        });
    }

    function syncParentMessagesFromServer() {
        if (typeof window.emsCallFunction !== 'function') {
            return Promise.reject(cfUnavailableError());
        }
        return window.emsCallFunction('getParentMessages', {
            tenantId: getTenantId(),
            limit: 200
        }).then(function (data) {
            if (!data || !data.messages) return;
            var userKey = (window.DB && window.DB.parentMsg) ? window.DB.parentMsg : 'ems_parent_messages';
            var key = 'ems_parent_messages';
            window._emsSuppressSync = true;
            if (window._emsOriginalSetItem) {
                window._emsOriginalSetItem.call(localStorage, key, JSON.stringify(data.messages));
            } else {
                localStorage.setItem(key, JSON.stringify(data.messages));
            }
            window._emsSuppressSync = false;
        });
    }
    function renderMessagesHtml(studentId, msgs) {
        msgs = msgs || (typeof window.parentGetMessages === 'function' ? window.parentGetMessages(studentId) : []);
        if (!msgs.length) return '<p>کوئی پیغام نہیں۔</p>';
        return msgs.slice(-15).reverse().map(function (m) {
            var dir = m.direction === 'in' ? 'آپ → ادارہ' : 'ادارہ → آپ';
            var readNote = (m.direction === 'out' && m.readByParent) ? ' • ✓ پڑھا' : '';
            if (m.direction === 'in' && m.read) readNote = ' • ✓ ادارے نے پڑھا';
            return '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;">' +
                '<small style="color:#64748b;">' + esc(dir) + ' | ' + esc(m.at) + readNote + '</small><br>' +
                esc(m.text || '(صوتی پیغام)') + '</div>';
        }).join('');
    }

    function renderCfErrorHtml(err) {
        var msg = (err && err.message) ? err.message : 'ڈیٹا لوڈ نہیں ہو سکا۔';
        return '<p style="color:#ef4444;"><i class="fas fa-exclamation-circle"></i> ' + esc(msg) + '</p>' +
            '<p style="font-size:12px;color:#64748b;">یہ معلومات صرف محفوظ سرور API سے دستیاب ہیں۔</p>';
    }

    /** Linked students — Cloud Function only (Phase 4) */
    function pullLinkedStudentsForParent(tenantId) {
        if (typeof window.emsCallFunction !== 'function') {
            return Promise.reject(cfUnavailableError());
        }
        return window.emsCallFunction('getParentLinkedStudents', { tenantId: tenantId })
            .then(function (data) {
                if (!data || !data.students) return;
                if (typeof window.emsRegRepoUpsert === 'function') {
                    data.students.forEach(function (s) {
                        if (s && s.id) window.emsRegRepoUpsert(s);
                    });
                }
            });
    }

    function renderParentPortalCards(container, studentIds) {
        var users = getUsers();
        container.innerHTML = studentIds.map(function (sid) {
            var student = users.find(function (u) { return u.id === sid; }) || { id: sid, name: sid };
            var views = (window.PARENT_VIEWS || []).filter(function (pv) {
                if (typeof window.parentCanView === 'function') return window.parentCanView(sid, pv.id);
                if (typeof window.checkParentViewAccess === 'function') return window.checkParentViewAccess(sid, pv.id);
                return false;
            });

            if (!views.length) {
                return '<div class="premium-card pp-student-card">' +
                    '<h3><i class="fas fa-user-graduate"></i> ' + esc(student.name || sid) + '</h3>' +
                    '<p style="color:#94a3b8;">اس وقت کوئی معلومات دیکھنے کی اجازت نہیں۔</p></div>';
            }

            var viewCards = views.map(function (pv) {
                return '<button type="button" class="btn btn-outline" onclick="window.ppOpenView(\'' +
                    esc(sid) + '\',\'' + pv.id + '\')"><i class="fas ' + pv.icon + '"></i> ' + esc(pv.name) + '</button>';
            }).join('');

            var msgSection = '<div class="pp-msg-block">' +
                '<h4 style="margin:0 0 8px;font-size:14px;"><i class="fas fa-envelope"></i> ادارے کو پیغام</h4>' +
                '<select id="pp-msg-cat-' + sid + '" class="input-control" style="margin-bottom:8px;">' +
                (window.PARENT_MSG_CATEGORIES || []).map(function (c) {
                    return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
                }).join('') + '</select>' +
                '<textarea id="pp-msg-text-' + sid + '" class="input-control" rows="3" placeholder="اپنا پیغام لکھیں..."></textarea>' +
                '<button type="button" class="btn btn-success" style="margin-top:8px;width:100%;" onclick="window.ppSendMessage(\'' + sid + '\')"><i class="fas fa-paper-plane"></i> بھیجیں</button>' +
                '</div>';

            return '<div class="premium-card pp-student-card">' +
                '<h3><i class="fas fa-user-graduate"></i> ' +
                esc(student.name || sid) + ' <small style="color:#64748b;">(' + esc(sid) + ')</small></h3>' +
                '<p style="font-size:13px; color:#64748b; margin-bottom:10px;">والد: ' + esc(student.fname || '-') + '</p>' +
                '<div class="pp-view-grid btn-action-group">' + viewCards + '</div>' +
                msgSection +
                '</div>';
        }).join('');
    }

    window.initParentPortal = function () {
        var container = document.getElementById('pp-content');
        if (!container) return;

        var studentIds = typeof window.emsGetLinkedStudentIds === 'function'
            ? window.emsGetLinkedStudentIds() : [];

        if (typeof window.emsRecordMatchesDepartment === 'function') {
            var allUsers = getUsers();
            studentIds = studentIds.filter(function (sid) {
                var u = allUsers.find(function (x) { return x.id === sid; });
                return !u || window.emsRecordMatchesDepartment(u);
            });
        }

        if (!studentIds.length) {
            container.innerHTML = '<p style="text-align:center; color:#64748b;">کوئی منسلک طالبِ علم نہیں۔ ادارے سے Parent Link کروائیں۔</p>';
            return;
        }

        container.innerHTML = '<p style="text-align:center; color:#64748b;">ڈیٹا لوڈ ہو رہا ہے...</p>';

        var tenantId = getTenantId();
        var pulls = [pullLinkedStudentsForParent(tenantId), syncParentMessagesFromServer()];

        Promise.all(pulls).then(function () {
            renderParentPortalCards(container, studentIds);
            if (typeof window.emsRenderParentMfaBanner === 'function') {
                window.emsRenderParentMfaBanner(container);
            }
        }).catch(function (err) {
            container.innerHTML = renderCfErrorHtml(err);
        });
    };

    window.ppSendMessage = function (studentId) {
        var linked = typeof window.emsGetLinkedStudentIds === 'function' ? window.emsGetLinkedStudentIds() : [];
        if (linked.indexOf(studentId) < 0) {
            if (typeof window.showToast === 'function') window.showToast('یہ طالبِ علم آپ سے منسلک نہیں', 'error');
            return;
        }
        var catEl = document.getElementById('pp-msg-cat-' + studentId);
        var textEl = document.getElementById('pp-msg-text-' + studentId);
        var text = textEl ? textEl.value.trim() : '';
        if (!text) {
            if (typeof window.showToast === 'function') window.showToast('پیغام لکھیں', 'error');
            return;
        }
        if (typeof window.parentSubmitMessage !== 'function') return;
        Promise.resolve(window.parentSubmitMessage(studentId, {
            category: catEl ? catEl.value : 'inquiry',
            format: 'text',
            text: text
        })).then(function (ok) {
            if (ok) {
                if (textEl) textEl.value = '';
                if (typeof window.showToast === 'function') window.showToast('پیغام ادارے کو بھیج دیا گیا', 'success');
            } else if (typeof window.showToast === 'function') {
                window.showToast('پیغام نہیں بھیجا جا سکا', 'error');
            }
        });
    };

    window.ppOpenView = function (studentId, viewId) {
        window._ppCurrentView = { studentId: studentId, viewId: viewId };
        if (typeof window.checkParentViewAccess === 'function' && !window.checkParentViewAccess(studentId, viewId)) {
            if (typeof window.showToast === 'function') window.showToast('اس معلومات کی اجازت نہیں!', 'error');
            return;
        }
        if (typeof window.parentCanView === 'function' && !window.parentCanView(studentId, viewId)) {
            if (typeof window.showToast === 'function') window.showToast('اس معلومات کی اجازت نہیں!', 'error');
            return;
        }

        var student = getUsers().find(function (u) { return u.id === studentId; }) || {};
        var viewName = viewId;
        (window.PARENT_VIEWS || []).forEach(function (pv) {
            if (pv.id === viewId) viewName = pv.name;
        });

        var body = document.getElementById('pp-view-body');
        if (body) body.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> لوڈ ہو رہا ہے...</p>';
        if (typeof window.openModal === 'function') window.openModal('pp-view-modal');

        var html = '<h3>' + esc(student.name || studentId) + ' — ' + esc(viewName) + '</h3>';
        html += '<p style="color:#64748b; font-size:13px;">یہ خلاصہ محفوظ سرور API سے ہے۔</p>';
        html += '<div id="pp-view-dynamic">لوڈ ہو رہا ہے...</div>';

        if (body) body.innerHTML = html;
        var dyn = document.getElementById('pp-view-dynamic');
        if (!dyn) return;

        var chain = Promise.resolve();

        if (viewId === 'attendance') {
            chain = fetchStudentAttendance(studentId).then(function (data) {
                dyn.innerHTML = renderAttendanceHtml(data);
            });
        } else if (viewId === 'results' || viewId === 'progress') {
            chain = fetchStudentExamResults(studentId).then(function (rows) {
                if (viewId === 'progress' && rows.length >= 2) {
                    var latest = rows[0];
                    var prev = rows[1];
                    var diff = (parseFloat(latest.percentage) || 0) - (parseFloat(prev.percentage) || 0);
                    dyn.innerHTML = '<p>تازہ ترین: ' + esc(latest.examName) + ' — ' + esc(latest.percentage) + '% (' + esc(latest.grade) + ')</p>' +
                        '<p>پچھلے امتحان سے فرق: <strong>' + diff.toFixed(1) + '%</strong></p>' + renderResultsHtml(rows.slice(0, 5), studentId);
                } else {
                    dyn.innerHTML = renderResultsHtml(rows, studentId);
                }
            });
        } else if (viewId === 'announcements') {
            chain = fetchAnnouncementsForParent(studentId).then(function (anns) {
                dyn.innerHTML = renderAnnouncementsHtml(anns, studentId);
            });
        } else if (viewId === 'teacher_notes') {
            chain = fetchTeacherNotesForParent(studentId).then(function (anns) {
                dyn.innerHTML = renderAnnouncementsHtml(anns, studentId);
            });
        } else if (viewId === 'complaints') {
            chain = fetchStudentComplaints(studentId).then(function (list) {
                dyn.innerHTML = renderComplaintsHtml(list);
            });
        } else if (viewId === 'leave') {
            chain = fetchParentMessages(studentId).then(function (msgs) {
                var tenantId = getTenantId();
                if (tenantId && typeof window.emsCallFunction === 'function') {
                    return window.emsCallFunction('markParentMessagesRead', {
                        tenantId: tenantId,
                        studentId: studentId,
                        role: 'parent'
                    }).then(function () { return msgs; }).catch(function () { return msgs; });
                }
                return msgs;
            }).then(function (msgs) {
                dyn.innerHTML = renderMessagesHtml(studentId, msgs);
                dyn.innerHTML += '<p style="margin-top:10px;font-size:12px;color:#64748b;">نئی رخصت کی درخواست اوپر «ادارے کو پیغام» سے بھیجیں (قسم: رخصت)۔</p>';
            });
        } else if (viewId === 'fee') {
            chain = fetchStudentFeeSummary(studentId).then(function (fee) {
                dyn.innerHTML = renderFeeHtml(fee, studentId);
            });
        } else if (viewId === 'training') {
            chain = fetchStudentTraining(studentId).then(function (data) {
                dyn.innerHTML = renderTrainingHtml(data);
            });
        } else {
            chain = Promise.resolve().then(function () {
                dyn.innerHTML = '<p>تفصیلی ڈیٹا دستیاب نہیں۔</p>';
            });
        }

        chain.catch(function (err) {
            dyn.innerHTML = renderCfErrorHtml(err);
            console.warn('ppOpenView error', err);
        });
    };

    window.ppReloadCurrentView = function (studentId) {
        var cur = window._ppCurrentView;
        if (!cur || cur.studentId !== studentId) return;
        window.ppOpenView(studentId, cur.viewId);
    };

    window.ppPrintExamResult = function (studentId, rowIndex) {
        var rows = (window._ppExamCache && window._ppExamCache[studentId]) || [];
        var res = rows[rowIndex];
        if (!res) {
            if (typeof window.showToast === 'function') window.showToast('نتيجہ نہیں ملا', 'error');
            return;
        }
        if (typeof window.showToast === 'function') window.showToast('کشف النتیجہ تیار ہو رہا ہے...', 'info');
        ppEnsureLazyModule('exams').then(function () {
            if (typeof window.exmPrintStudentCard !== 'function') {
                throw new Error('exmPrintStudentCard نہیں ملا');
            }
            var ok = window.exmPrintStudentCard(res, res.examName, 'pp-result-print-area');
            if (!ok && typeof window.showToast === 'function') window.showToast('پرنٹ ایریا نہیں ملا', 'error');
        }).catch(function (err) {
            console.warn('ppPrintExamResult:', err);
            if (typeof window.showToast === 'function') window.showToast('نتيجہ پرنٹ نہیں ہو سکا', 'error');
        });
    };

    window.ppPrintFeeReceipt = function (studentId, collectionIndex) {
        var fee = (window._ppFeeCache && window._ppFeeCache[studentId]) || {};
        var collections = fee.collections || [];
        var rec = collections[collectionIndex];
        if (!rec) {
            if (typeof window.showToast === 'function') window.showToast('رسید نہیں ملی', 'error');
            return;
        }
        if (typeof window.showToast === 'function') window.showToast('رسید تیار ہو رہی ہے...', 'info');
        ppEnsureLazyModule('finance').then(function () {
            if (typeof window.finShowReceipt !== 'function') {
                throw new Error('finShowReceipt نہیں ملا');
            }
            var voidBtn = document.getElementById('btn-void-receipt');
            if (voidBtn) voidBtn.style.display = 'none';
            window.finShowReceipt(rec, {
                payable: fee.totalBilled > 0 ? fee.totalBilled : (fee.monthlyCharge || '—'),
                remaining: fee.arrears > 0 ? fee.arrears : '—',
                advance: fee.advanceBalance > 0 ? fee.advanceBalance : 0,
                voided: !!rec.isVoid
            });
            if (typeof window.printDiv === 'function') {
                window.printDiv('fin-receipt-printable');
            } else if (typeof window.finExportPDF === 'function') {
                window.finExportPDF('fin-receipt-printable', 'رسید');
            } else {
                window.print();
            }
        }).catch(function (err) {
            console.warn('ppPrintFeeReceipt:', err);
            if (typeof window.showToast === 'function') window.showToast('رسید پرنٹ نہیں ہو سکی', 'error');
        });
    };

    if (typeof window.emsRegisterDepartmentRefresh === 'function') {
        window.emsRegisterDepartmentRefresh('parent-portal', function () {
            if (typeof window.initParentPortal === 'function') window.initParentPortal();
        });
    }

})();
