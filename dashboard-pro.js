// ============================================================================
// ڈیش بورڈ پرو — SVG گرافکس + کثیر سطحی ڈرل ڈاؤن (Dashboard Pro)
// ہر میٹرک کے لیے خوبصورت گراف اور کلک پر مزید تفصیل (multi-level)
// ============================================================================
(function (global) {
    'use strict';

    var PALETTE = ['#3498db', '#2ecc71', '#e67e22', '#9b59b6', '#e74c3c', '#1abc9c', '#f1c40f', '#34495e', '#fd79a8', '#00cec9'];
    function palette(i) { return PALETTE[i % PALETTE.length]; }
    function rs(n) { return 'Rs ' + (Number(n) || 0).toLocaleString(); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function monthKey(d) { return (d || '').substring(0, 7); }

    function asArray(v) {
        return Array.isArray(v) ? v : [];
    }

    function asObject(v) {
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }

    // ---------------- ڈیٹا ریڈرز ----------------
    function cacheGet(key, fallback) {
        if (typeof global.emsCacheGet === 'function') return global.emsCacheGet(key, fallback);
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (e) { return fallback; }
    }
    function readUsers() {
        if (typeof global.emsRegRepoGetList === 'function') {
            var repo = global.emsRegRepoGetList();
            if (repo.length) return repo;
        }
        if (typeof global.emsGetUsersMerged === 'function') {
            var merged = global.emsGetUsersMerged();
            if (merged.length) return merged;
        }
        if (typeof global.emsGetUsersSync === 'function') {
            var sync = global.emsGetUsersSync();
            if (sync.length) return sync;
        }
        return [];
    }

    function readUsersAsync() {
        var sync = readUsers();
        if (sync.length) return Promise.resolve(sync);
        if (typeof global.emsFirebaseEnsureModuleData === 'function') {
            return global.emsFirebaseEnsureModuleData({ force: false }).then(function () {
                return readUsers();
            });
        }
        if (typeof global.emsEnsureRepositoryReady === 'function') {
            return global.emsEnsureRepositoryReady().then(function () {
                return readUsers();
            });
        }
        return Promise.resolve([]);
    }

    var DRILL_PAGE_SIZE = 50;
    var DRILL_SCAN_SIZE = 200;
    /** Max <tr> nodes kept in drill tbody — evict oldest on deep scroll. */
    var DRILL_DOM_MAX_ROWS = 200;

    function ensureDrillHydrated() {
        if (typeof global.emsEnsureDashboardReportData === 'function') {
            return global.emsEnsureDashboardReportData();
        }
        return readUsersAsync().then(function () { return { ok: true }; });
    }

    function userGroupKey(u) {
        if (!u) return 'نامعلوم';
        return u.class || u.dept || u.appointed || 'نامعلوم';
    }

    function drillRepoReady() {
        return !!(global.emsRepo && typeof global.emsRepo.page === 'function'
            && typeof global.emsRepo.count === 'function');
    }

    function drillCountByType(type) {
        if (drillRepoReady()) {
            return global.emsRepo.count('registrations', type ? { type: type } : null).then(function (n) {
                return Number(n) || 0;
            });
        }
        if (typeof global.emsRegistrationHeadcounts === 'function') {
            return global.emsRegistrationHeadcounts().then(function (c) {
                c = c || {};
                if (!type) return c.total || 0;
                if (type === 'student') return c.students || 0;
                if (type === 'teacher') return c.teachers || 0;
                if (type === 'staff') return c.staff || 0;
                return 0;
            });
        }
        return Promise.resolve(readUsers().filter(function (u) { return !type || u.type === type; }).length);
    }

    function drillPagePeople(type, group, offset, limit) {
        offset = offset || 0;
        limit = limit || DRILL_PAGE_SIZE;
        if (drillRepoReady()) {
            var filter = type ? { type: type } : null;
            if (group && type === 'student') {
                filter = { type: type, className: group };
            }
            return global.emsRepo.page('registrations', {
                offset: offset,
                limit: limit,
                filter: filter
            }).then(function (res) {
                var rows = asArray(res.rows);
                if (group && type !== 'student') {
                    rows = rows.filter(function (u) { return userGroupKey(u) === group; });
                }
                return {
                    rows: rows,
                    total: res.total != null ? res.total : rows.length,
                    hasMore: !!res.hasMore,
                    rawHasMore: !!res.hasMore
                };
            });
        }
        if (typeof global.emsRegRepoGetListPage === 'function') {
            var page = global.emsRegRepoGetListPage({
                offset: offset,
                limit: limit,
                type: type || 'all'
            });
            var rows = asArray(page.rows);
            if (group) rows = rows.filter(function (u) { return userGroupKey(u) === group; });
            var total = page.total != null ? page.total : rows.length;
            return Promise.resolve({
                rows: rows,
                total: total,
                hasMore: offset + rows.length < total,
                rawHasMore: offset + rows.length < total
            });
        }
        var all = readUsers().filter(function (u) {
            if (type && u.type !== type) return false;
            if (group && userGroupKey(u) !== group) return false;
            return true;
        });
        return Promise.resolve({
            rows: all.slice(offset, offset + limit),
            total: all.length,
            hasMore: offset + limit < all.length,
            rawHasMore: offset + limit < all.length
        });
    }

    function drillAggregateGroups(type) {
        return drillCountByType(type).then(function (total) {
            if (!total) return { total: 0, groups: [] };
            var byGroup = Object.create(null);
            if (!drillRepoReady()) {
                readUsers().filter(function (u) { return u.type === type; }).forEach(function (u) {
                    var k = userGroupKey(u);
                    byGroup[k] = (byGroup[k] || 0) + 1;
                });
                return {
                    total: total,
                    groups: Object.keys(byGroup).map(function (k) {
                        return { label: k, value: byGroup[k] };
                    }).sort(function (a, b) { return b.value - a.value; })
                };
            }
            var offset = 0;
            function scanBatch() {
                return drillPagePeople(type, null, offset, DRILL_SCAN_SIZE).then(function (res) {
                    asArray(res.rows).forEach(function (u) {
                        var k = userGroupKey(u);
                        byGroup[k] = (byGroup[k] || 0) + 1;
                    });
                    offset += DRILL_SCAN_SIZE;
                    var done = !res.rawHasMore || !res.rows || res.rows.length < DRILL_SCAN_SIZE;
                    if (!done && offset <= total + DRILL_SCAN_SIZE) return scanBatch();
                    var groups = Object.keys(byGroup).map(function (k) {
                        return { label: k, value: byGroup[k] };
                    }).sort(function (a, b) { return b.value - a.value; });
                    var sum = groups.reduce(function (s, g) { return s + g.value; }, 0);
                    return { total: Math.max(total, sum), groups: groups };
                });
            }
            return scanBatch();
        });
    }

    function drillCountInGroup(type, group) {
        if (drillRepoReady() && type === 'student') {
            return global.emsRepo.count('registrations', { type: 'student', className: group }).then(function (n) {
                return Number(n) || 0;
            });
        }
        return drillAggregateGroups(type).then(function (agg) {
            for (var i = 0; i < agg.groups.length; i++) {
                if (agg.groups[i].label === group) return agg.groups[i].value;
            }
            return 0;
        });
    }

    function drillFetchGroupMembers(type, group, listOffset, pageSize) {
        pageSize = pageSize || DRILL_PAGE_SIZE;
        if (!group || type === 'student') {
            return drillPagePeople(type, group, listOffset, pageSize).then(function (res) {
                return {
                    rows: asArray(res.rows),
                    hasMore: !!res.hasMore
                };
            });
        }
        var matchSkip = listOffset;
        var collected = [];
        var repoOffset = 0;
        function walk() {
            return drillPagePeople(type, null, repoOffset, DRILL_SCAN_SIZE).then(function (res) {
                var rows = asArray(res.rows);
                for (var i = 0; i < rows.length; i++) {
                    if (userGroupKey(rows[i]) !== group) continue;
                    if (matchSkip > 0) { matchSkip--; continue; }
                    collected.push(rows[i]);
                    if (collected.length >= pageSize) {
                        return { rows: collected, hasMore: true };
                    }
                }
                repoOffset += DRILL_SCAN_SIZE;
                if (!res.rawHasMore || rows.length < DRILL_SCAN_SIZE) {
                    return { rows: collected, hasMore: false };
                }
                return walk();
            });
        }
        return walk();
    }

    function peopleRowDef(u) {
        return {
            cells: [esc(u.id), '<strong>' + esc(u.name) + '</strong>', esc(u.phone || '-')],
            onClick: function () { global.emsDrillPush(nodePerson(u.id)); }
        };
    }

    function readLedger() {
        return asArray(cacheGet('ems_full_ledger', null) || cacheGet('ems_ledger_db', []));
    }
    function readCollections() { return asArray(cacheGet('ems_fee_collections', [])); }
    function feeCollectionEffectiveAmount(c) {
        if (!c || c.isVoid) return 0;
        return Number(c.amount) || 0;
    }
    function isLegacyManualFeeLedgerEntry(l) {
        if (!l || l.type !== 'Income') return false;
        var text = ((l.category || '') + ' ' + (l.details || '')).trim();
        return /فیس|fee|tuition|چالان/i.test(text);
    }
    function sumMonthIncome(ledger, month) {
        var total = 0;
        asArray(ledger).forEach(function (l) {
            if (monthKey(l.date) !== month) return;
            if (l.type === 'Income' && !isLegacyManualFeeLedgerEntry(l)) total += Number(l.amount) || 0;
        });
        return total;
    }
    function sumMonthFeeCollections(collections, month) {
        var total = 0;
        asArray(collections).forEach(function (c) {
            if (monthKey(c.date) === month) total += feeCollectionEffectiveAmount(c);
        });
        return total;
    }
    function buildPaidByStudentIndex(collections) {
        var map = Object.create(null);
        asArray(collections).forEach(function (c) {
            if (!c || !c.studentId || c.isVoid) return;
            map[c.studentId] = (map[c.studentId] || 0) + (Number(c.amount) || 0);
        });
        return map;
    }
    function readFeeSetups() { return asObject(cacheGet('ems_student_fee_setup', {})); }
    function readAnnouncements() {
        return asArray(cacheGet('ems_full_announcements', null) || cacheGet('ems_announcements', []));
    }
    function readExams() {
        return asArray(cacheGet('ems_full_exams', null) || cacheGet('ems_exams_db', []));
    }
    function getComplaints() {
        var chain = (typeof global.emsGetComplaintsAll === 'function')
            ? global.emsGetComplaintsAll()
            : Promise.resolve([]);
        return chain.then(function (cmp) {
            cmp = asArray(cmp);
            if (typeof global.emsFilterByDepartment === 'function') {
                cmp = global.emsFilterByDepartment(cmp);
                if (!Array.isArray(cmp)) cmp = [];
            }
            return cmp;
        });
    }

    function last6Months() {
        var arr = [], now = new Date();
        for (var i = 5; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            arr.push({ key: d.toISOString().substring(0, 7), label: d.toLocaleDateString('ur-PK', { month: 'short' }) });
        }
        return arr;
    }

    // ---------------- SVG چارٹ helpers ----------------
    // عمودی بار چارٹ — لیبلز محور کے نیچے، اقدار بار کے اوپر (اوورلیپ نہیں)
    global.emsBarChartSVG = function (items, opts) {
        opts = opts || {};
        items = asArray(items);
        if (!items.length) {
            return '<p style="color:#94a3b8;font-size:13px;">کوئی ڈیٹا نہیں</p>';
        }
        if (opts.horizontal || opts.layout === 'horizontal') {
            return emsHorizontalBarChartSVG(items, opts);
        }

        var maxLabelLen = 0;
        items.forEach(function (it) {
            maxLabelLen = Math.max(maxLabelLen, String(it.label || '').length);
        });
        var n = items.length || 1;
        var clear = opts.clearLabels !== false;
        var rotate = opts.rotateLabels === false
            ? false
            : (!!opts.rotateLabels || maxLabelLen > 8 || n >= 5);
        var labelMax = opts.labelMaxChars != null
            ? opts.labelMaxChars
            : (rotate ? 12 : 16);

        var w = Math.max(560, Math.min(920, 80 + n * 72));
        var padX = 28;
        var padTop = clear ? 40 : 24;
        var padBottom = rotate
            ? Math.min(140, 64 + Math.min(maxLabelLen, labelMax) * 5.2)
            : (clear ? 52 : 40);
        var plotH = opts.plotHeight || 168;
        var h = padTop + plotH + padBottom;
        var max = Math.max(1, Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })));
        var plotW = w - padX * 2;
        var step = plotW / n;
        var bw = Math.min(clear ? 42 : 46, Math.max(14, step * (clear ? 0.48 : 0.55)));
        var axisY = padTop + plotH;

        var bars = items.map(function (it, i) {
            var bh = Math.round((Math.abs(it.value) / max) * plotH);
            if (it.value !== 0 && bh < 3) bh = 3;
            var x = padX + step * i + (step - bw) / 2;
            var y = axisY - bh;
            var col = it.color || palette(i);
            var fullLabel = String(it.label || '');
            var shortLabel = fullLabel.length > labelMax ? fullLabel.slice(0, labelMax - 1) + '…' : fullLabel;
            var lx = x + bw / 2;
            var valueText = String(it.display != null ? it.display : it.value);
            /* قدر ہمیشہ بار کے اوپر خالی جگہ میں — بار کے اندر نہیں */
            var valueY = Math.max(16, y - 8);
            var ly = axisY + (rotate ? 14 : 20);
            var labelText = rotate
                ? ('<text x="' + lx + '" y="' + ly + '" text-anchor="end" font-size="11" font-weight="600" fill="#334155" ' +
                   'transform="rotate(-48 ' + lx + ' ' + ly + ')">' + esc(shortLabel) + '</text>')
                : ('<text x="' + lx + '" y="' + ly + '" text-anchor="middle" font-size="12" font-weight="600" fill="#334155">' +
                   esc(shortLabel) + '</text>');
            return '<g>' +
                '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="5" fill="' + col + '">' +
                '<title>' + esc(fullLabel) + ': ' + esc(valueText) + '</title></rect>' +
                '<text x="' + lx + '" y="' + valueY + '" text-anchor="middle" font-size="12" font-weight="700" fill="#1e293b">' +
                esc(valueText) + '</text>' +
                labelText +
                '</g>';
        }).join('');

        return '<div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;">' +
            '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="min-width:' + Math.min(w, 640) + 'px;max-height:' + (h + 12) + 'px;display:block;">' +
            '<line x1="' + padX + '" y1="' + axisY + '" x2="' + (w - padX) + '" y2="' + axisY + '" stroke="#94a3b8" stroke-width="1.5"/>' +
            bars + '</svg></div>';
    };

    function emsHorizontalBarChartSVG(items, opts) {
        opts = opts || {};
        var n = items.length || 1;
        var rowH = 34;
        var padTop = 12, padBottom = 12, padLeft = 150, padRight = 56;
        var w = 560;
        var h = padTop + padBottom + n * rowH;
        var max = Math.max(1, Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })));
        var plotW = w - padLeft - padRight;
        var labelMax = opts.labelMaxChars != null ? opts.labelMaxChars : 22;
        var bars = items.map(function (it, i) {
            var bw = Math.max(4, Math.round((Math.abs(it.value) / max) * plotW));
            var y = padTop + i * rowH;
            var barY = y + 6;
            var col = it.color || palette(i);
            var fullLabel = String(it.label || '');
            var shortLabel = fullLabel.length > labelMax ? fullLabel.slice(0, labelMax - 1) + '…' : fullLabel;
            return '<g>' +
                '<text x="' + (padLeft - 10) + '" y="' + (barY + 14) + '" text-anchor="end" font-size="12" fill="#334155">' + esc(shortLabel) + '</text>' +
                '<title>' + esc(fullLabel) + ': ' + (it.display || it.value) + '</title>' +
                '<rect x="' + padLeft + '" y="' + barY + '" width="' + bw + '" height="18" rx="5" fill="' + col + '"/>' +
                '<text x="' + (padLeft + bw + 8) + '" y="' + (barY + 14) + '" text-anchor="start" font-size="11" fill="#475569">' +
                esc(it.display != null ? it.display : it.value) + '</text>' +
                '</g>';
        }).join('');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-height:' + Math.min(420, h + 8) + 'px;">' +
            '<line x1="' + padLeft + '" y1="' + padTop + '" x2="' + padLeft + '" y2="' + (h - padBottom) + '" stroke="#e2e8f0"/>' +
            bars + '</svg>';
    }

    // دو رنگوں والا گروپڈ بار (آمدن بمقابلہ اخراجات)
    global.emsGroupedBarsSVG = function (groups) {
        var w = 560, h = 230, padX = 36, padTop = 24, padBottom = 40;
        var n = groups.length || 1;
        var max = 1;
        groups.forEach(function (g) { max = Math.max(max, g.a, g.b); });
        var plotW = w - padX * 2, plotH = h - padTop - padBottom;
        var step = plotW / n, bw = Math.min(20, step * 0.3);
        var bars = groups.map(function (g, i) {
            var x = padX + step * i + (step - bw * 2 - 4) / 2;
            var ah = Math.round((g.a / max) * plotH), bh = Math.round((g.b / max) * plotH);
            return '<g>' +
                '<rect x="' + x + '" y="' + (padTop + plotH - ah) + '" width="' + bw + '" height="' + ah + '" rx="4" fill="#2ecc71"><title>آمدن: ' + rs(g.a) + '</title></rect>' +
                '<rect x="' + (x + bw + 4) + '" y="' + (padTop + plotH - bh) + '" width="' + bw + '" height="' + bh + '" rx="4" fill="#e74c3c"><title>اخراجات: ' + rs(g.b) + '</title></rect>' +
                '<text x="' + (x + bw) + '" y="' + (h - padBottom + 16) + '" text-anchor="middle" font-size="11" fill="#64748b">' + esc(g.label) + '</text>' +
                '</g>';
        }).join('');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-height:250px;">' +
            '<line x1="' + padX + '" y1="' + (padTop + plotH) + '" x2="' + (w - padX) + '" y2="' + (padTop + plotH) + '" stroke="#cbd5e1"/>' + bars +
            '</svg>' +
            '<div style="display:flex; justify-content:center; gap:20px; font-size:12px; margin-top:6px;"><span><i class="fas fa-square" style="color:#2ecc71"></i> آمدن</span><span><i class="fas fa-square" style="color:#e74c3c"></i> اخراجات</span></div>';
    };

    // ڈونٹ چارٹ — center shows actual count only (no capacity / label text).
    global.emsDonutSVG = function (segs, centerVal, centerLabel) {
        var total = segs.reduce(function (s, x) { return s + x.value; }, 0) || 1;
        var r = 54, c = 2 * Math.PI * r, off = 0;
        var ring = segs.map(function (s) {
            var dash = (s.value / total) * c;
            var el = '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="20" stroke-dasharray="' + dash + ' ' + (c - dash) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"><title>' + esc(s.label) + ': ' + s.value + '</title></circle>';
            off += dash;
            return el;
        }).join('');
        var legend = segs.map(function (s) {
            return '<div style="display:flex; align-items:center; gap:6px; font-size:12px;"><span style="width:11px;height:11px;border-radius:3px;background:' + s.color + ';display:inline-block;"></span>' + esc(s.label) + ' <strong>(' + s.value + ')</strong></div>';
        }).join('');
        var centerText = '<text x="70" y="70" text-anchor="middle" font-size="26" font-weight="bold" fill="#2c3e50">' + esc(centerVal) + '</text>';
        return '<div style="display:flex; align-items:center; gap:24px; flex-wrap:wrap; justify-content:center;">' +
            '<svg viewBox="0 0 140 140" width="150" height="150">' + ring + centerText + '</svg>' +
            '<div style="display:flex; flex-direction:column; gap:8px;">' + legend + '</div></div>';
    };

    // مختصر ڈونٹ (صرف svg — پینل میں استعمال) — actual count in center, no subtitle.
    global.emsDonutCompactSVG = function (segs, centerVal, centerLabel, size) {
        size = size || 130;
        var total = segs.reduce(function (s, x) { return s + x.value; }, 0) || 1;
        var r = 54, c = 2 * Math.PI * r, off = 0;
        var ring = segs.map(function (s) {
            var dash = (s.value / total) * c;
            var el = '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="18" stroke-dasharray="' + dash + ' ' + (c - dash) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"><title>' + esc(s.label) + ': ' + s.value + '</title></circle>';
            off += dash; return el;
        }).join('');
        return '<svg viewBox="0 0 140 140" width="' + size + '" height="' + size + '">' + ring +
            '<text x="70" y="74" text-anchor="middle" font-size="26" font-weight="bold" fill="#1e293b">' + esc(centerVal) + '</text></svg>';
    };

    // لائن چارٹ (رجحان/Trend)
    global.emsLineChartSVG = function (points, color) {
        color = color || '#1abc9c';
        points = asArray(points).filter(function (p) { return !!p; });
        if (!points.length) {
            return '<p style="color:#94a3b8;font-size:13px;">کوئی ڈیٹا نہیں</p>';
        }
        var w = 520, h = 130, padX = 26, padTop = 14, padBottom = 24;
        var max = Math.max(1, Math.max.apply(null, points.map(function (p) { return Number(p.value) || 0; })));
        var plotW = w - padX * 2, plotH = h - padTop - padBottom, n = points.length;
        var step = n > 1 ? plotW / (n - 1) : 0;
        var coords = points.map(function (p, i) {
            return [padX + step * i, padTop + (plotH - ((Number(p.value) || 0) / max) * plotH)];
        });
        var line = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' ');
        var area = line + ' L' + (padX + step * (n - 1)).toFixed(1) + ' ' + (padTop + plotH) + ' L' + padX + ' ' + (padTop + plotH) + ' Z';
        var gid = 'lg' + Math.random().toString(36).slice(2, 7);
        var dots = coords.map(function (c, i) {
            return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="3.5" fill="' + color + '"><title>' + esc(points[i].label || '') + ': ' + (Number(points[i].value) || 0) + '</title></circle>';
        }).join('');
        var labels = points.map(function (p, i) {
            return '<text x="' + coords[i][0].toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="9" fill="#94a3b8">' + esc(p.label || '') + '</text>';
        }).join('');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-height:130px;">' +
            '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.28"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
            '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
            dots + labels + '</svg>';
    };

    // کلک ایبل 6-ماہی ٹرینڈ (آمدن بمقابلہ اخراجات)
    global.emsTrendChartSVG = function (fm) {
        fm = asArray(fm);
        if (!fm.length) {
            return '<p style="color:#94a3b8;font-size:13px;">مالی ڈیٹا دستیاب نہیں</p>';
        }
        var w = 640, h = 250, padX = 40, padTop = 24, padBottom = 44;
        var max = 1;
        fm.forEach(function (g) {
            if (!g) return;
            max = Math.max(max, Number(g.income) || 0, Number(g.expense) || 0);
        });
        var plotW = w - padX * 2, plotH = h - padTop - padBottom, step = plotW / fm.length, bw = Math.min(20, step * 0.26);
        var bars = fm.map(function (g, i) {
            if (!g) g = { key: '', label: '', income: 0, expense: 0 };
            var cx = padX + step * i + step / 2;
            var x1 = cx - bw - 3, x2 = cx + 3;
            var ih = Math.round(((Number(g.income) || 0) / max) * plotH);
            var eh = Math.round(((Number(g.expense) || 0) / max) * plotH);
            var baseY = padTop + plotH;
            return '<g style="cursor:pointer;" onclick="window.emsOpenFinanceMonth(\'' + (g.key || '') + '\')">' +
                '<rect x="' + (padX + step * i) + '" y="' + padTop + '" width="' + step + '" height="' + plotH + '" fill="transparent"/>' +
                '<rect x="' + x1 + '" y="' + (baseY - ih) + '" width="' + bw + '" height="' + ih + '" rx="4" fill="#27ae60"><title>آمدن: ' + rs(g.income) + '</title></rect>' +
                '<rect x="' + x2 + '" y="' + (baseY - eh) + '" width="' + bw + '" height="' + eh + '" rx="4" fill="#e74c3c"><title>اخراجات: ' + rs(g.expense) + '</title></rect>' +
                '<text x="' + cx + '" y="' + (h - padBottom + 18) + '" text-anchor="middle" font-size="11" fill="#64748b">' + esc(g.label || '') + '</text>' +
                '</g>';
        }).join('');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-height:260px;">' +
            '<line x1="' + padX + '" y1="' + (padTop + plotH) + '" x2="' + (w - padX) + '" y2="' + (padTop + plotH) + '" stroke="#e2e8f0"/>' + bars + '</svg>' +
            '<div style="display:flex; justify-content:center; gap:24px; font-size:12px; margin-top:8px;"><span><i class="fas fa-square" style="color:#27ae60"></i> آمدن</span><span><i class="fas fa-square" style="color:#e74c3c"></i> اخراجات</span><span style="color:#94a3b8;">(مہینے پر کلک کریں)</span></div>';
    };

    global.emsOpenFinanceMonth = function (key) { global.emsDrillOpen(nodeFinanceMonth(key)); };

    // افقی پیش رفت بار (paid vs due وغیرہ)
    global.emsProgressSVG = function (percent, color, label) {
        percent = Math.max(0, Math.min(100, percent));
        return '<div style="margin:6px 0;"><div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;"><span>' + esc(label || '') + '</span><strong>' + percent + '%</strong></div>' +
            '<div style="background:#e2e8f0; border-radius:10px; height:14px; overflow:hidden;"><div style="width:' + percent + '%; height:100%; background:' + (color || 'var(--primary)') + '; transition:width .8s;"></div></div></div>';
    };

    // ---------------- کارڈ mini-graphs ----------------
    function sparkBars(values, color) {
        var max = Math.max(1, Math.max.apply(null, values));
        var bw = 8, gap = 4, h = 34;
        var bars = values.map(function (v, i) {
            var bh = Math.max(2, Math.round((v / max) * h));
            return '<rect x="' + (i * (bw + gap)) + '" y="' + (h - bh) + '" width="' + bw + '" height="' + bh + '" rx="2" fill="' + color + '"/>';
        }).join('');
        var w = values.length * (bw + gap);
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" height="34">' + bars + '</svg>';
    }
    function miniStack(segs) {
        var total = segs.reduce(function (s, x) { return s + x.value; }, 0) || 1;
        var x = 0, w = 120, h = 12;
        var parts = segs.map(function (s) {
            var sw = (s.value / total) * w;
            var el = '<rect x="' + x + '" y="0" width="' + sw + '" height="' + h + '" fill="' + s.color + '"><title>' + esc(s.label) + ': ' + s.value + '</title></rect>';
            x += sw; return el;
        }).join('');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="120" height="12" style="border-radius:6px; overflow:hidden;">' + parts + '</svg>';
    }
    function miniRing(pct, color) {
        var r = 15, c = 2 * Math.PI * r, dash = (pct / 100) * c;
        return '<svg viewBox="0 0 40 40" width="38" height="38">' +
            '<circle cx="20" cy="20" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="5"/>' +
            '<circle cx="20" cy="20" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="5" stroke-dasharray="' + dash + ' ' + (c - dash) + '" transform="rotate(-90 20 20)" stroke-linecap="round"/>' +
            '<text x="20" y="24" text-anchor="middle" font-size="10" font-weight="bold" fill="#2c3e50">' + pct + '%</text></svg>';
    }
    function setSpark(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

    global.emsRenderMiniCharts = function () {
        try {
            var users = asArray(readUsers());
            var studs = users.filter(function (u) { return u && u.type === 'student'; }).length;
            var teach = users.filter(function (u) { return u && u.type === 'teacher'; }).length;
            var staff = users.filter(function (u) { return u && u.type === 'staff'; }).length;
            var compStack = miniStack([
                { label: 'طلبہ', value: studs, color: '#3498db' },
                { label: 'اساتذہ', value: teach, color: '#2ecc71' },
                { label: 'عملہ', value: staff, color: '#e67e22' }
            ]);
            setSpark('spark-students', compStack);
            setSpark('spark-teachers', compStack);
            setSpark('spark-staff', compStack);

            var ledger = readLedger(), collections = readCollections();
            var months = last6Months();
            var incVals = [], expVals = [], netVals = [], collVals = [];
            months.forEach(function (m) {
                var inc = sumMonthFeeCollections(collections, m.key) + sumMonthIncome(ledger, m.key);
                var exp = 0, coll = sumMonthFeeCollections(collections, m.key);
                ledger.forEach(function (l) {
                    if (monthKey(l.date) !== m.key) return;
                    if (l.type === 'Expense') exp += Number(l.amount) || 0;
                });
                incVals.push(inc); expVals.push(exp); netVals.push(Math.max(0, inc - exp)); collVals.push(coll);
            });
            setSpark('spark-income', sparkBars(incVals, '#2ecc71'));
            setSpark('spark-expense', sparkBars(expVals, '#e74c3c'));
            setSpark('spark-net', sparkBars(netVals, '#3498db'));
            setSpark('spark-month', sparkBars(collVals, '#9b59b6'));

            // آج کے اخراجات (مد کے حساب سے mini)
            var todayStr = new Date().toISOString().split('T')[0];
            var todayExp = ledger.filter(function (l) { return l.type === 'Expense' && l.date === todayStr; });
            setSpark('spark-expense-today', todayExp.length ? sparkBars(todayExp.slice(-8).map(function (e) { return Number(e.amount) || 0; }), '#e74c3c') : '<span style="font-size:11px;color:#94a3b8;">آج کوئی خرچ نہیں</span>');

            // حاضری mini ring
            if (typeof global.emsFetchTodayAttendanceStats === 'function') {
                global.emsFetchTodayAttendanceStats().then(function (st) {
                    var pct = studs > 0 ? Math.round(((st.present || 0) / studs) * 100) : 0;
                    var col = pct >= 75 ? '#2ecc71' : (pct >= 50 ? '#f1c40f' : '#e74c3c');
                    setSpark('spark-attendance', miniRing(pct, col));
                });
            }

            // بقایا فیس — وصول شدہ بمقابلہ بقایا
            var setups = readFeeSetups(), totalDue = 0, totalTarget = 0;
            var paidByStudent = buildPaidByStudentIndex(collections);
            users.filter(function (u) { return u.type === 'student'; }).forEach(function (s) {
                var setup = setups[s.id]; if (!setup) return;
                var paid = paidByStudent[s.id] || 0;
                totalTarget += Number(setup.netPayable) || 0;
                totalDue += Math.max(0, (Number(setup.netPayable) || 0) - paid);
            });
            var paidPct = totalTarget > 0 ? Math.round(((totalTarget - totalDue) / totalTarget) * 100) : 100;
            setSpark('spark-arrears', miniStack([
                { label: 'وصول شدہ', value: Math.max(0, totalTarget - totalDue), color: '#2ecc71' },
                { label: 'بقایا', value: totalDue, color: '#e74c3c' }
            ]) + '<span style="font-size:10px;color:#94a3b8;margin-right:6px;">' + paidPct + '% وصول</span>');

            // اعلانات — ماہانہ mini
            var anns = readAnnouncements();
            var annVals = months.map(function (m) {
                return anns.filter(function (a) { return a && monthKey(a.date) === m.key; }).length;
            });
            setSpark('spark-announcements', sparkBars(annVals, '#9b59b6'));

            // شکایات — شدت کے حساب سے mini (async)
            getComplaints().then(function (cmp) {
                var sev = complaintsBySeverity(cmp);
                setSpark('spark-complaints', miniStack([
                    { label: 'سنگین', value: sev.high, color: '#e74c3c' },
                    { label: 'درمیانی', value: sev.med, color: '#f1c40f' },
                    { label: 'معمولی', value: sev.low, color: '#3498db' }
                ]));
            });
        } catch (e) { console.error('mini-charts:', e); }
    };

    function setHTML(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
    function setText(id, v) { var el = document.getElementById(id); if (el) el.innerText = v; }

    function resolveDashboardPeopleCounts(users) {
        users = asArray(users);
        var studs = users.filter(function (u) { return u && u.type === 'student'; }).length;
        var teach = users.filter(function (u) { return u && u.type === 'teacher'; }).length;
        var staff = users.filter(function (u) { return u && u.type === 'staff'; }).length;
        return { studs: studs, teach: teach, staff: staff, total: studs + teach + staff };
    }

    function resolveDashboardPeopleCountsFromHeadcounts(counts) {
        counts = counts || {};
        var studs = counts.students || 0;
        var teach = counts.teachers || 0;
        var staff = counts.staff || 0;
        return { studs: studs, teach: teach, staff: staff, total: counts.total || (studs + teach + staff) };
    }

    function fetchDashboardPeopleCounts() {
        if (typeof global.emsRegistrationHeadcounts === 'function') {
            return global.emsRegistrationHeadcounts().then(function (counts) {
                if (counts && counts.total > 0) {
                    return resolveDashboardPeopleCountsFromHeadcounts(counts);
                }
                return readUsersAsync().then(function (users) {
                    return resolveDashboardPeopleCounts(users);
                });
            }).catch(function () {
                return readUsersAsync().then(function (users) {
                    return resolveDashboardPeopleCounts(users);
                });
            });
        }
        return readUsersAsync().then(function (users) {
            return resolveDashboardPeopleCounts(users);
        });
    }

    function formatCount(n) {
        return (Number(n) || 0).toLocaleString();
    }

    // مرکزی پینل چارٹس (حقیقی ڈیٹا، ہر اپڈیٹ پر متحرک)
    function renderDashboardPanelsWithCounts(counts) {
        try {
            var resolved = resolveDashboardPeopleCountsFromHeadcounts(counts);
            renderDashboardPanelsCore(resolved);
        } catch (e) { console.error('panels:', e); }
    }

    function renderDashboardPanelsWithUsers(users) {
        try {
            users = asArray(users);
            var resolved = resolveDashboardPeopleCounts(users);
            renderDashboardPanelsCore(resolved);
        } catch (e) { console.error('panels:', e); }
    }

    function renderDashboardPanelsCore(counts) {
        try {
            var studs = counts.studs;
            var teach = counts.teach;
            var staff = counts.staff;

            // رجسٹریشن ڈونٹ — center = actual total records
            setHTML('chart-registration', global.emsDonutCompactSVG([
                { label: 'طلباء', value: studs, color: '#3498db' },
                { label: 'اساتذہ', value: teach, color: '#27ae60' },
                { label: 'عملہ', value: staff, color: '#e67e22' }
            ], formatCount(counts.total)));

            // مالیات — 6 ماہی + مکمل ٹرینڈ
            var fm = asArray(financeMonths());
            setHTML('chart-finance-mini', global.emsLineChartSVG(fm.map(function (m) {
                return { label: (m && m.label) || '', value: (m && m.income) || 0 };
            }), '#27ae60'));
            setHTML('dash-trend-chart', global.emsTrendChartSVG(fm));

            // امتحانات
            var examOverview = typeof global.emsGetExaminationOverview === 'function'
                ? global.emsGetExaminationOverview() : null;
            var exams = readExams();
            var avg = examOverview && examOverview.version >= 1
                ? (Number(examOverview.overallAvgPct) || 0)
                : (exams.length ? Math.round(exams.reduce(function (s, e) {
                    return s + (Number(e && e.percentage) || 0);
                }, 0) / exams.length) : 0);
            var examCount = examOverview && examOverview.version >= 1
                ? (Number(examOverview.totalResults) || 0)
                : exams.length;
            setText('dash-exam-count', examCount);
            setText('dash-exam-avg', avg + '%');
            var recent = exams.slice(-6);
            setHTML('chart-exams', recent.length
                ? global.emsBarChartSVG(recent.map(function (e) {
                    if (!e) return { label: '', value: 0, display: '0%', color: '#e74c3c' };
                    var v = Number(e.percentage) || 0;
                    return {
                        label: String(e.examName || '').substring(0, 6),
                        value: v,
                        display: v + '%',
                        color: v >= 80 ? '#27ae60' : (v >= 50 ? '#f39c12' : '#e74c3c')
                    };
                }))
                : '<p style="color:#94a3b8; font-size:13px;">کوئی نتیجہ موجود نہیں</p>');

            // اعلانات — ماہانہ بارز
            var anns = readAnnouncements();
            var months = last6Months();
            setHTML('chart-announcements', global.emsBarChartSVG(months.map(function (m) {
                return {
                    label: m.label,
                    value: anns.filter(function (a) { return a && monthKey(a.date) === m.key; }).length,
                    color: '#6366f1'
                };
            })));

            // حاضری — ڈونٹ + لائن رجحان (center = حاضر طلباء کی تعداد)
            if (typeof global.emsFetchTodayAttendanceStats === 'function') {
                global.emsFetchTodayAttendanceStats().then(function (st) {
                    st = st || {};
                    var present = st.present || 0;
                    var absent = Math.max(0, studs - present);
                    setHTML('chart-attendance', global.emsDonutCompactSVG([
                        { label: 'حاضر', value: present, color: '#27ae60' },
                        { label: 'غائب', value: absent, color: '#e74c3c' }
                    ], formatCount(present), '', 140));
                }).catch(function () { /* offline — skip attendance donut */ });
            }
            if (typeof global.emsFetchAttendanceTrend === 'function') {
                global.emsFetchAttendanceTrend(7).then(function (tr) {
                    tr = asArray(tr);
                    setHTML('chart-attendance-trend', global.emsLineChartSVG(tr.map(function (d) {
                        return { label: (d && d.date) || '', value: (d && d.present) || 0 };
                    }), '#1abc9c'));
                }).catch(function () { /* offline — skip trend */ });
            }

            // شکایات ڈونٹ
            getComplaints().then(function (cmp) {
                cmp = asArray(cmp);
                setText('dash-total-complaints', cmp.length);
                var sev = complaintsBySeverity(cmp);
                setHTML('chart-complaints', global.emsDonutCompactSVG([
                    { label: 'سنگین', value: sev.high, color: '#e74c3c' },
                    { label: 'درمیانی', value: sev.med, color: '#f39c12' },
                    { label: 'معمولی', value: sev.low, color: '#3498db' }
                ], formatCount(cmp.length)));
            }).catch(function () {
                setText('dash-total-complaints', '0');
                setHTML('chart-complaints', '<p style="color:#94a3b8;font-size:13px;">کوئی شکایت نہیں</p>');
            });

            if (typeof global.curUpdateDashboardCard === 'function') {
                try { global.curUpdateDashboardCard(); } catch (eCur) { console.warn('[EMS] curUpdateDashboardCard:', eCur); }
            }
            if (typeof global.tarUpdateDashboardCard === 'function') {
                try { global.tarUpdateDashboardCard(); } catch (eTar) { console.warn('[EMS] tarUpdateDashboardCard:', eTar); }
            }
        } catch (e) { console.error('panels:', e); }
    }

    global.emsRenderDashboardPanels = function () {
        fetchDashboardPeopleCounts().then(function (counts) {
            renderDashboardPanelsCore(counts);
        }).catch(function (err) {
            console.warn('[EMS] dashboard panels — counts load failed, rendering empty:', err);
            renderDashboardPanelsCore({ studs: 0, teach: 0, staff: 0, total: 0 });
        });
    };

    function complaintsBySeverity(cmp) {
        cmp = asArray(cmp);
        var high = 0, med = 0, low = 0;
        cmp.forEach(function (c) {
            if (!c) return;
            var d = (c.details || '') + ' ' + (c.type || '');
            if (/لڑائی|سنگین|مار/.test(d)) high++;
            else if (/تاخیر|دیر|شور/.test(d)) med++;
            else low++;
        });
        return { high: high, med: med, low: low };
    }
    function severityOf(c) {
        var d = (c.details || '') + ' ' + (c.type || '');
        if (/لڑائی|سنگین|مار/.test(d)) return { t: 'سنگین', c: '#e74c3c' };
        if (/تاخیر|دیر|شور/.test(d)) return { t: 'درمیانی', c: '#f1c40f' };
        return { t: 'معمولی', c: '#3498db' };
    }

    // ---------------- ڈرل ڈاؤن انجن ----------------
    global._emsDrill = { stack: [] };

    function drillRender() {
        var s = global._emsDrill.stack;
        if (!s.length) return;
        var node = s[s.length - 1];
        document.getElementById('dash-drill-title').innerHTML = node.title || 'تفصیل';
        var back = document.getElementById('dash-drill-back');
        back.style.display = s.length > 1 ? 'inline-flex' : 'none';
        var bc = document.getElementById('dash-drill-breadcrumb');
        bc.innerHTML = s.map(function (n, i) {
            var name = n.crumb || (n.title || '').replace(/<[^>]+>/g, '').trim();
            return (i ? ' <i class="fas fa-angle-left" style="margin:0 4px;"></i> ' : '') +
                '<span style="' + (i === s.length - 1 ? 'color:var(--primary);font-weight:bold;' : 'cursor:pointer;') + '" ' +
                (i < s.length - 1 ? 'onclick="window.emsDrillTo(' + i + ')"' : '') + '>' + esc(name) + '</span>';
        }).join('');
        var g = document.getElementById('dash-drill-graph');
        var b = document.getElementById('dash-drill-body');
        g.innerHTML = ''; b.innerHTML = '';
        try { node.render(g, b); } catch (e) { b.innerHTML = '<p style="color:red;text-align:center;">' + e.message + '</p>'; }
    }

    function drillLoadingNode() {
        return {
            title: '<i class="fas fa-spinner fa-spin"></i> لوڈ ہو رہا ہے...',
            crumb: '…',
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;padding:24px;"><i class="fas fa-spinner fa-spin"></i> ڈیٹا تیار ہو رہا ہے...</p>';
                b.innerHTML = '';
            }
        };
    }

    global.emsDrillOpen = function (node) {
        global._emsDrill.stack = [drillLoadingNode()];
        drillRender();
        global.openModal('dash-drill-modal');
        ensureDrillHydrated().then(function () {
            global._emsDrill.stack = [node];
            drillRender();
        }).catch(function (err) {
            console.warn('[EMS] emsDrillOpen hydrate:', err);
            global._emsDrill.stack = [node];
            drillRender();
        });
    };
    global.emsDrillPush = function (node) { global._emsDrill.stack.push(node); drillRender(); };
    global.emsDrillBack = function () { var s = global._emsDrill.stack; if (s.length > 1) { s.pop(); drillRender(); } };
    global.emsDrillTo = function (i) { var s = global._emsDrill.stack; if (i < s.length - 1) { s.length = i + 1; drillRender(); } };

    // کلک ایبل ٹیبل — چھوٹی فہرستیں (≤100)
    function buildTable(container, headers, rows) {
        var thead = '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '<th></th></tr></thead>';
        var table = document.createElement('table');
        table.className = 'data-table';
        table.style.width = '100%';
        table.innerHTML = thead + '<tbody></tbody>';
        var tb = table.querySelector('tbody');
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="' + (headers.length + 1) + '" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
        }
        rows.forEach(function (r) {
            var tr = document.createElement('tr');
            tr.innerHTML = r.cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') +
                '<td style="text-align:left;color:var(--accent);">' + (r.onClick ? '<i class="fas fa-chevron-left"></i>' : '') + '</td>';
            if (r.onClick) { tr.className = 'drill-row'; tr.addEventListener('click', r.onClick); }
            tb.appendChild(tr);
        });
        container.innerHTML = '';
        container.appendChild(table);
    }

    /** Chunked table — stats total exact; rows load 50 at a time on scroll; DOM capped. */
    function buildChunkedTable(container, headers, cfg) {
        cfg = cfg || {};
        var pageSize = cfg.pageSize || DRILL_PAGE_SIZE;
        var domMax = cfg.domMaxRows || DRILL_DOM_MAX_ROWS;
        var total = cfg.total != null ? cfg.total : 0;
        var thead = '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '<th></th></tr></thead>';
        var wrap = document.createElement('div');
        wrap.className = 'dash-drill-table-wrap';
        wrap.style.maxHeight = cfg.maxHeight || '360px';
        wrap.style.overflowY = 'auto';
        var table = document.createElement('table');
        table.className = 'data-table';
        table.style.width = '100%';
        table.innerHTML = thead + '<tbody></tbody>';
        var tb = table.querySelector('tbody');
        var foot = document.createElement('div');
        foot.style.cssText = 'font-size:12px;color:#94a3b8;text-align:center;padding:8px 4px;';
        foot.textContent = total ? ('دکھائے گئے: 0 / ' + total.toLocaleString()) : 'لوڈ ہو رہا ہے...';
        wrap.appendChild(table);
        container.innerHTML = '';
        container.appendChild(wrap);
        container.appendChild(foot);

        var state = { offset: 0, loading: false, done: false, loaded: 0 };

        function updateFooter() {
            var denom = total || state.loaded;
            foot.textContent = 'دکھائے گئے: ' + state.loaded.toLocaleString() + ' / ' + denom.toLocaleString();
        }

        function evictOverflowRows() {
            while (tb.children.length > domMax) {
                var first = tb.firstElementChild;
                if (!first) break;
                var rowH = first.offsetHeight || 0;
                tb.removeChild(first);
                if (rowH > 0 && wrap.scrollTop > 0) {
                    wrap.scrollTop = Math.max(0, wrap.scrollTop - rowH);
                }
            }
        }

        function appendRows(rowDefs) {
            rowDefs = rowDefs || [];
            if (!rowDefs.length && state.loaded === 0) {
                tb.innerHTML = '<tr><td colspan="' + (headers.length + 1) + '" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
                foot.textContent = '0 / ' + (total || 0).toLocaleString();
                state.done = true;
                return;
            }
            if (state.loaded === 0) tb.innerHTML = '';
            rowDefs.forEach(function (r) {
                var tr = document.createElement('tr');
                tr.innerHTML = r.cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') +
                    '<td style="text-align:left;color:var(--accent);">' + (r.onClick ? '<i class="fas fa-chevron-left"></i>' : '') + '</td>';
                if (r.onClick) { tr.className = 'drill-row'; tr.addEventListener('click', r.onClick); }
                tb.appendChild(tr);
            });
            state.loaded += rowDefs.length;
            evictOverflowRows();
            updateFooter();
        }

        function loadMore() {
            if (state.loading || state.done || typeof cfg.fetchRows !== 'function') return;
            state.loading = true;
            cfg.fetchRows(state.offset, pageSize).then(function (batch) {
                batch = batch || [];
                appendRows(batch);
                state.offset += batch.length || pageSize;
                state.loading = false;
                if (!batch.length || batch.length < pageSize) {
                    state.done = true;
                    updateFooter();
                } else if (total && state.loaded >= total) {
                    state.done = true;
                    updateFooter();
                }
            }).catch(function () {
                state.loading = false;
                state.done = true;
            });
        }

        wrap.addEventListener('scroll', function () {
            if (state.done || state.loading) return;
            if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 48) loadMore();
        }, { passive: true });

        loadMore();
    }

    function buildChunkedTableFromRows(container, headers, allRows, cfg) {
        cfg = cfg || {};
        var total = allRows.length;
        var pageSize = cfg.pageSize || DRILL_PAGE_SIZE;
        var offset = 0;
        buildChunkedTable(container, headers, {
            total: total,
            pageSize: pageSize,
            maxHeight: cfg.maxHeight,
            fetchRows: function (off, lim) {
                var slice = allRows.slice(off, off + lim);
                return Promise.resolve(slice);
            }
        });
    }

    function findUser(id) { return readUsers().find(function (u) { return u.id === id; }); }

    // ---------------- میٹرک ڈرل تعریفیں ----------------
    function nodePeople(type, label, icon) {
        return {
            title: '<i class="fas ' + icon + '"></i> ' + label, crumb: label,
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                b.innerHTML = '';
                Promise.all([drillCountByType(type), drillAggregateGroups(type)]).then(function (res) {
                    var total = res[0];
                    var entries = res[1].groups || [];
                    var titleEl = document.getElementById('dash-drill-title');
                    if (titleEl) {
                        titleEl.innerHTML = '<i class="fas ' + icon + '"></i> ' + label + ' (' + total.toLocaleString() + ')';
                    }
                    g.innerHTML = global.emsDonutSVG(entries.slice(0, 8).map(function (e, i) {
                        return { label: e.label, value: e.value, color: palette(i) };
                    }), formatCount(total), 'کل ' + label);
                    buildTable(b, ['درجہ / شعبہ', 'تعداد'], entries.map(function (e) {
                        return {
                            cells: [esc(e.label), e.value.toLocaleString()],
                            onClick: function () { global.emsDrillPush(nodePeopleGroup(type, label, e.label)); }
                        };
                    }));
                });
            }
        };
    }
    function nodePeopleGroup(type, label, group) {
        return {
            title: '<i class="fas fa-folder-open"></i> ' + esc(group), crumb: group,
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                b.innerHTML = '';
                drillCountInGroup(type, group).then(function (count) {
                    var titleEl = document.getElementById('dash-drill-title');
                    if (titleEl) {
                        titleEl.innerHTML = '<i class="fas fa-folder-open"></i> ' + esc(group) + ' (' + count.toLocaleString() + ')';
                    }
                    g.innerHTML = '<p style="text-align:center;color:#64748b;">' + esc(group) + ' میں کل ' + count.toLocaleString() + ' افراد</p>';
                    buildChunkedTable(b, ['آئی ڈی', 'نام', 'رابطہ'], {
                        total: count,
                        fetchRows: function (off, lim) {
                            return drillFetchGroupMembers(type, group, off, lim).then(function (res) {
                                return asArray(res.rows).map(peopleRowDef);
                            });
                        }
                    });
                });
            }
        };
    }
    function nodePerson(id) {
        return {
            title: '<i class="fas fa-id-badge"></i> ' + esc(id), crumb: id,
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                b.innerHTML = '';
                var loadUser = typeof global.emsGetUserById === 'function'
                    ? global.emsGetUserById(id)
                    : Promise.resolve(findUser(id));
                loadUser.then(function (u) {
                    u = u || {};
                    var collections = readCollections(), setups = readFeeSetups();
                    var paidByStudent = buildPaidByStudentIndex(collections);
                    var paid = paidByStudent[id] || 0;
                    var setup = setups[id] || {}; var net = Number(setup.netPayable) || 0;
                    var pct = net > 0 ? Math.round((paid / net) * 100) : 100;
                    var exams = readExams().filter(function (e) { return e.studentId === id; });
                    var avg = exams.length ? Math.round(exams.reduce(function (a, e) { return a + (Number(e.percentage) || 0); }, 0) / exams.length) : null;

                    var titleEl = document.getElementById('dash-drill-title');
                    if (titleEl) {
                        titleEl.innerHTML = '<i class="fas fa-id-badge"></i> ' + esc(u.name || id);
                    }

                    var info = '<div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:12px; line-height:1.9;">' +
                        '<div><strong>آئی ڈی:</strong> ' + esc(u.id || '-') + '</div>' +
                        '<div><strong>درجہ/شعبہ:</strong> ' + esc(u.class || u.dept || u.appointed || '-') + '</div>' +
                        '<div><strong>رابطہ:</strong> ' + esc(u.phone || '-') + '</div></div>';
                    g.innerHTML = info +
                        (u.type === 'student' ? global.emsProgressSVG(pct, pct >= 100 ? '#2ecc71' : (pct > 50 ? '#f1c40f' : '#e74c3c'), 'فیس وصولی (' + rs(paid) + ' / ' + rs(net) + ')') : '') +
                        (avg != null ? global.emsProgressSVG(avg, avg >= 80 ? '#2ecc71' : (avg >= 50 ? '#f1c40f' : '#e74c3c'), 'تعلیمی اوسط') : '');

                    b.innerHTML = '<div style="text-align:center;margin-top:6px;"><button class="btn btn-warning" style="color:#fff;" onclick="window.closeModal(\'dash-drill-modal\'); window.open360ReportForUser(\'' + esc(id) + '\')"><i class="fas fa-file-invoice"></i> مکمل 360° رپورٹ کھولیں</button></div>';
                    getComplaints().then(function (cmp) {
                        var mine = cmp.filter(function (c) { return c.individualId === id; });
                        var rows = mine.map(function (c) {
                            var s = severityOf(c);
                            return { cells: [esc(c.date || '-'), '<span class="drill-chip" style="background:' + s.c + '">' + s.t + '</span>', esc((c.details || '').substring(0, 50))] };
                        });
                        var wrap = document.createElement('div');
                        wrap.innerHTML = '<h4 style="margin:14px 0 6px;">ڈسپلن / شکایات (' + mine.length + ')</h4>';
                        b.appendChild(wrap);
                        var tc = document.createElement('div'); b.appendChild(tc);
                        if (rows.length > DRILL_PAGE_SIZE) {
                            buildChunkedTableFromRows(tc, ['تاریخ', 'شدت', 'تفصیل'], rows);
                        } else {
                            buildTable(tc, ['تاریخ', 'شدت', 'تفصیل'], rows);
                        }
                    });
                });
            }
        };
    }

    function nodeAttendance() {
        return {
            title: '<i class="fas fa-calendar-check"></i> آج کی حاضری', crumb: 'حاضری',
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                b.innerHTML = '';
                Promise.all([
                    drillCountByType('student'),
                    typeof global.emsFetchTodayAttendanceStats === 'function'
                        ? global.emsFetchTodayAttendanceStats() : Promise.resolve({ present: 0, presentIds: [] })
                ]).then(function (res) {
                    var studTotal = res[0];
                    var st = res[1] || {};
                    var present = st.present || 0;
                    var absent = Math.max(0, studTotal - present);
                    var pct = studTotal > 0 ? Math.round((present / studTotal) * 100) : 0;
                    g.innerHTML = global.emsDonutSVG([
                        { label: 'حاضر', value: present, color: '#2ecc71' },
                        { label: 'غائب', value: absent, color: '#e74c3c' }
                    ], pct + '%', 'شرح حاضری');
                    var presentSet = Object.create(null);
                    asArray(st.presentIds).forEach(function (i) { presentSet[i] = true; });
                    buildChunkedTable(b, ['آئی ڈی', 'نام', 'حالت'], {
                        total: studTotal,
                        fetchRows: function (off, lim) {
                            return drillPagePeople('student', null, off, lim).then(function (page) {
                                return asArray(page.rows).map(function (u) {
                                    var p = presentSet[u.id];
                                    return {
                                        cells: [esc(u.id), '<strong>' + esc(u.name) + '</strong>',
                                            '<span class="drill-chip" style="background:' + (p ? '#2ecc71' : '#e74c3c') + '">' + (p ? 'حاضر' : 'غائب') + '</span>'],
                                        onClick: function () { global.emsDrillPush(nodePerson(u.id)); }
                                    };
                                });
                            });
                        }
                    });
                });
            }
        };
    }

    function financeMonths() {
        var ledger = readLedger(), collections = readCollections();
        return last6Months().map(function (m) {
            var inc = sumMonthFeeCollections(collections, m.key) + sumMonthIncome(ledger, m.key);
            var exp = 0;
            ledger.forEach(function (l) {
                if (monthKey(l.date) !== m.key) return;
                if (l.type === 'Expense') exp += Number(l.amount) || 0;
            });
            return { key: m.key, label: m.label, income: inc, expense: exp };
        });
    }

    function nodeIncome() {
        return {
            title: '<i class="fas fa-arrow-down"></i> آمدن (6 ماہ)', crumb: 'آمدن',
            render: function (g, b) {
                var fm = financeMonths();
                g.innerHTML = global.emsBarChartSVG(fm.map(function (m) { return { label: m.label, value: m.income, display: (m.income >= 1000 ? Math.round(m.income / 1000) + 'k' : m.income), color: '#2ecc71' }; }));
                buildTable(b, ['مہینہ', 'آمدن'], fm.slice().reverse().map(function (m) {
                    return { cells: [m.key, rs(m.income)], onClick: function () { global.emsDrillPush(nodeFinanceMonth(m.key)); } };
                }));
            }
        };
    }
    function nodeExpense() {
        return {
            title: '<i class="fas fa-arrow-up"></i> اخراجات (شعبہ وار)', crumb: 'اخراجات',
            render: function (g, b) {
                var ledger = readLedger().filter(function (l) { return l.type === 'Expense'; });
                var byCat = {};
                ledger.forEach(function (l) { var k = l.category || 'متفرق'; byCat[k] = (byCat[k] || 0) + (Number(l.amount) || 0); });
                var entries = Object.keys(byCat).map(function (k) { return { label: k, value: byCat[k] }; }).sort(function (a, b) { return b.value - a.value; });
                g.innerHTML = global.emsDonutSVG(entries.slice(0, 8).map(function (e, i) { return { label: e.label, value: e.value, color: palette(i) }; }), rs(entries.reduce(function (s, e) { return s + e.value; }, 0)).replace('Rs ', ''), 'کل اخراجات');
                buildTable(b, ['مد', 'رقم'], entries.map(function (e) {
                    return { cells: [esc(e.label), rs(e.value)], onClick: function () { global.emsDrillPush(nodeExpenseCat(e.label)); } };
                }));
            }
        };
    }
    function nodeExpenseCat(cat) {
        var list = readLedger().filter(function (l) { return l.type === 'Expense' && (l.category || 'متفرق') === cat; });
        return {
            title: '<i class="fas fa-folder"></i> ' + esc(cat) + ' (' + list.length + ')', crumb: cat,
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">' + esc(cat) + ' — کل ' + rs(list.reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0)) + '</p>';
                var rows = list.slice().reverse().map(function (l) {
                    return { cells: [esc(l.date || '-'), esc(l.details || '-'), '<span style="color:#e74c3c;font-weight:bold;">' + rs(l.amount) + '</span>'] };
                });
                if (rows.length > DRILL_PAGE_SIZE) {
                    buildChunkedTableFromRows(b, ['تاریخ', 'تفصیل', 'رقم'], rows);
                } else {
                    buildTable(b, ['تاریخ', 'تفصیل', 'رقم'], rows);
                }
            }
        };
    }
    function nodeFinanceMonth(key) {
        var ledger = readLedger(), collections = readCollections();
        var rows = [];
        collections.forEach(function (c) {
            var amt = feeCollectionEffectiveAmount(c);
            if (!amt || monthKey(c.date) !== key) return;
            rows.push({ date: c.date, kind: 'آمدن (فیس)', detail: c.studentName || '-', amount: amt, income: true, sid: c.studentId });
        });
        ledger.forEach(function (l) {
            if (monthKey(l.date) !== key) return;
            if (l.type === 'Income') {
                if (!isLegacyManualFeeLedgerEntry(l)) rows.push({ date: l.date, kind: 'آمدن', detail: l.details || l.category || '-', amount: Number(l.amount) || 0, income: true });
            } else if (l.type === 'Expense') rows.push({ date: l.date, kind: 'اخراجات', detail: l.details || l.category || '-', amount: Number(l.amount) || 0, income: false });
        });
        rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        var inc = rows.filter(function (r) { return r.income; }).reduce(function (s, r) { return s + r.amount; }, 0);
        var exp = rows.filter(function (r) { return !r.income; }).reduce(function (s, r) { return s + r.amount; }, 0);
        return {
            title: '<i class="fas fa-calendar-alt"></i> ' + key + ' (' + rows.length + ')', crumb: key,
            render: function (g, b) {
                g.innerHTML = global.emsGroupedBarsSVG([{ label: 'اس ماہ', a: inc, b: exp }]) + '<p style="text-align:center;font-weight:bold;">خالص: ' + rs(inc - exp) + '</p>';
                var tableRows = rows.map(function (r) {
                    return {
                        cells: [esc(r.date), r.kind, esc(r.detail), '<span style="color:' + (r.income ? 'green' : 'red') + ';font-weight:bold;">' + rs(r.amount) + '</span>'],
                        onClick: r.sid ? function () { global.emsDrillPush(nodePerson(r.sid)); } : null
                    };
                });
                if (tableRows.length > DRILL_PAGE_SIZE) {
                    buildChunkedTableFromRows(b, ['تاریخ', 'قسم', 'تفصیل', 'رقم'], tableRows);
                } else {
                    buildTable(b, ['تاریخ', 'قسم', 'تفصیل', 'رقم'], tableRows);
                }
            }
        };
    }
    function nodeNet() {
        return {
            title: '<i class="fas fa-balance-scale"></i> خالص بیلنس (آمدن بمقابلہ اخراجات)', crumb: 'خالص بیلنس',
            render: function (g, b) {
                var fm = financeMonths();
                g.innerHTML = global.emsGroupedBarsSVG(fm.map(function (m) { return { label: m.label, a: m.income, b: m.expense }; }));
                buildTable(b, ['مہینہ', 'آمدن', 'اخراجات', 'خالص'], fm.slice().reverse().map(function (m) {
                    return { cells: [m.key, rs(m.income), rs(m.expense), '<strong style="color:' + (m.income - m.expense >= 0 ? 'green' : 'red') + ';">' + rs(m.income - m.expense) + '</strong>'], onClick: function () { global.emsDrillPush(nodeFinanceMonth(m.key)); } };
                }));
            }
        };
    }
    function nodeExpenseToday() {
        var todayStr = new Date().toISOString().split('T')[0];
        var list = readLedger().filter(function (l) { return l.type === 'Expense' && l.date === todayStr; });
        return {
            title: '<i class="fas fa-file-invoice-dollar"></i> آج کے اخراجات', crumb: 'آج کے اخراجات',
            render: function (g, b) {
                var byCat = {}; list.forEach(function (l) { var k = l.category || 'متفرق'; byCat[k] = (byCat[k] || 0) + (Number(l.amount) || 0); });
                var entries = Object.keys(byCat).map(function (k, i) { return { label: k, value: byCat[k], color: palette(i) }; });
                g.innerHTML = entries.length ? global.emsBarChartSVG(entries.map(function (e) { return { label: e.label, value: e.value, display: rs(e.value).replace('Rs ', ''), color: e.color }; })) : '<p style="text-align:center;color:#94a3b8;">آج کوئی خرچ نہیں</p>';
                buildTable(b, ['مد', 'تفصیل', 'رقم'], list.map(function (l) {
                    return { cells: [esc(l.category || '-'), esc(l.details || '-'), '<span style="color:#e74c3c;font-weight:bold;">' + rs(l.amount) + '</span>'], onClick: function () { global.emsDrillPush(nodeExpenseCat(l.category || 'متفرق')); } };
                }));
            }
        };
    }
    function nodeArrears() {
        return {
            title: '<i class="fas fa-hand-holding-usd"></i> بقایا فیس', crumb: 'بقایا فیس',
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                b.innerHTML = '';
                var collections = readCollections(), setups = readFeeSetups();
                var paidByStudent = buildPaidByStudentIndex(collections);
                var arrearsRows = [];
                var offset = 0;
                function scanStudents() {
                    return drillPagePeople('student', null, offset, DRILL_SCAN_SIZE).then(function (res) {
                        asArray(res.rows).forEach(function (s) {
                            var setup = setups[s.id];
                            if (!setup) return;
                            var paid = paidByStudent[s.id] || 0;
                            var due = Math.max(0, (Number(setup.netPayable) || 0) - paid);
                            if (due > 0) {
                                arrearsRows.push({
                                    cells: [esc(s.id), '<strong>' + esc(s.name) + '</strong>', esc(s.class || '-'),
                                        '<span style="color:#e74c3c;font-weight:bold;">' + rs(due) + '</span>'],
                                    onClick: function () { global.emsDrillPush(nodePerson(s.id)); },
                                    _due: due
                                });
                            }
                        });
                        offset += DRILL_SCAN_SIZE;
                        if (res.rawHasMore && res.rows && res.rows.length >= DRILL_SCAN_SIZE) {
                            return scanStudents();
                        }
                        arrearsRows.sort(function (a, b) { return b._due - a._due; });
                        var total = arrearsRows.length;
                        var titleEl = document.getElementById('dash-drill-title');
                        if (titleEl) {
                            titleEl.innerHTML = '<i class="fas fa-hand-holding-usd"></i> بقایا فیس (' + total.toLocaleString() + ' طلبہ)';
                        }
                        g.innerHTML = total
                            ? global.emsBarChartSVG(arrearsRows.slice(0, 8).map(function (e, i) {
                                return {
                                    label: (e.cells[1] || '').replace(/<[^>]+>/g, '').substring(0, 8),
                                    value: e._due,
                                    display: rs(e._due).replace('Rs ', ''),
                                    color: '#e67e22'
                                };
                            }))
                            : '<p style="text-align:center;color:#2ecc71;">کوئی بقایا نہیں!</p>';
                        if (total > DRILL_PAGE_SIZE) {
                            buildChunkedTableFromRows(b, ['آئی ڈی', 'نام', 'درجہ', 'بقایا'], arrearsRows);
                        } else {
                            buildTable(b, ['آئی ڈی', 'نام', 'درجہ', 'بقایا'], arrearsRows);
                        }
                    });
                }
                scanStudents();
            }
        };
    }
    function nodeComplaints() {
        return {
            title: '<i class="fas fa-exclamation-circle"></i> شکایات', crumb: 'شکایات',
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                getComplaints().then(function (cmp) {
                    var sev = complaintsBySeverity(cmp);
                    g.innerHTML = global.emsDonutSVG([
                        { label: 'سنگین', value: sev.high, color: '#e74c3c' },
                        { label: 'درمیانی', value: sev.med, color: '#f1c40f' },
                        { label: 'معمولی', value: sev.low, color: '#3498db' }
                    ], cmp.length, 'کل شکایات');
                    var groups = [['سنگین', 'high'], ['درمیانی', 'med'], ['معمولی', 'low']];
                    buildTable(b, ['شدت', 'تعداد'], groups.map(function (gr) {
                        return { cells: ['<span class="drill-chip" style="background:' + (gr[1] === 'high' ? '#e74c3c' : gr[1] === 'med' ? '#f1c40f' : '#3498db') + '">' + gr[0] + '</span>', sev[gr[1]]], onClick: function () { global.emsDrillPush(nodeComplaintsSeverity(cmp, gr[0])); } };
                    }));
                });
            }
        };
    }
    function nodeComplaintsSeverity(cmp, sevName) {
        var list = cmp.filter(function (c) { return severityOf(c).t === sevName; });
        return {
            title: '<i class="fas fa-list"></i> ' + sevName + ' شکایات (' + list.length + ')', crumb: sevName,
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">' + sevName + ' درجے کی ' + list.length.toLocaleString() + ' شکایات</p>';
                var rows = list.slice().reverse().map(function (c) {
                    return {
                        cells: [esc(c.date || '-'), esc(c.type || '-'), esc((c.details || '').substring(0, 50))],
                        onClick: c.individualId ? function () { global.emsDrillPush(nodePerson(c.individualId)); } : null
                    };
                });
                if (rows.length > DRILL_PAGE_SIZE) {
                    buildChunkedTableFromRows(b, ['تاریخ', 'قسم', 'تفصیل'], rows);
                } else {
                    buildTable(b, ['تاریخ', 'قسم', 'تفصیل'], rows);
                }
            }
        };
    }
    function nodeAnnouncements() {
        var anns = readAnnouncements();
        return {
            title: '<i class="fas fa-bullhorn"></i> اعلانات (' + anns.length + ')', crumb: 'اعلانات',
            render: function (g, b) {
                var byAud = {}; anns.forEach(function (a) { var k = a.audience || 'سب'; byAud[k] = (byAud[k] || 0) + 1; });
                var entries = Object.keys(byAud).map(function (k, i) { return { label: k, value: byAud[k], color: palette(i) }; });
                g.innerHTML = entries.length ? global.emsDonutSVG(entries, anns.length, 'کل اعلانات') : '<p style="text-align:center;color:#94a3b8;">کوئی اعلان نہیں</p>';
                var rows = anns.slice().reverse().map(function (a) {
                    return { cells: [esc(a.date || '-'), '<strong>' + esc(a.title || '-') + '</strong>', esc(a.audience || 'سب')] };
                });
                if (rows.length > DRILL_PAGE_SIZE) {
                    buildChunkedTableFromRows(b, ['تاریخ', 'عنوان', 'ہدف'], rows);
                } else {
                    buildTable(b, ['تاریخ', 'عنوان', 'ہدف'], rows);
                }
            }
        };
    }

    function nodeExams() {
        var exams = readExams();
        var avg = exams.length ? Math.round(exams.reduce(function (s, e) { return s + (Number(e.percentage) || 0); }, 0) / exams.length) : 0;
        return {
            title: '<i class="fas fa-graduation-cap"></i> امتحانات (' + exams.length + ' نتائج)', crumb: 'امتحانات',
            render: function (g, b) {
                var byName = {};
                exams.forEach(function (e) {
                    var k = e.examName || e.examType || 'عام';
                    if (!byName[k]) byName[k] = { count: 0, sum: 0, classes: {} };
                    byName[k].count++;
                    byName[k].sum += Number(e.percentage) || 0;
                    var cls = e.className || e.class || 'نامعلوم';
                    if (!byName[k].classes[cls]) byName[k].classes[cls] = 0;
                    byName[k].classes[cls]++;
                });
                var entries = Object.keys(byName).map(function (k, i) {
                    return { label: k, value: byName[k].count, avg: Math.round(byName[k].sum / byName[k].count), color: palette(i) };
                }).sort(function (a, b) { return b.value - a.value; });
                g.innerHTML = entries.length
                    ? global.emsDonutSVG(entries.slice(0, 8).map(function (e) { return { label: e.label, value: e.value, color: e.color }; }), avg + '%', 'اوسط فیصد')
                    : '<p style="text-align:center;color:#94a3b8;">کوئی نتیجہ نہیں</p>';
                buildTable(b, ['امتحان', 'نتائج', 'اوسط%'], entries.map(function (e) {
                    return { cells: [esc(e.label), e.value, e.avg + '%'], onClick: function () { global.emsDrillPush(nodeExamsByName(e.label)); } };
                }));
                b.innerHTML += '<div style="text-align:center;margin-top:10px;"><button class="btn btn-sm btn-outline" onclick="window.closeModal(\'dash-drill-modal\'); document.getElementById(\'tab-exams\').click();"><i class="fas fa-external-link-alt"></i> امتحانات کھولیں</button></div>';
            }
        };
    }
    function nodeExamsByName(examName) {
        var list = readExams().filter(function (e) { return (e.examName || e.examType || 'عام') === examName; });
        var byClass = {};
        list.forEach(function (e) {
            var cls = e.className || e.class || 'نامعلوم';
            if (!byClass[cls]) byClass[cls] = { count: 0, sum: 0 };
            byClass[cls].count++;
            byClass[cls].sum += Number(e.percentage) || 0;
        });
        var entries = Object.keys(byClass).map(function (k) {
            return { label: k, count: byClass[k].count, avg: Math.round(byClass[k].sum / byClass[k].count) };
        }).sort(function (a, b) { return b.count - a.count; });
        return {
            title: '<i class="fas fa-folder-open"></i> ' + esc(examName), crumb: examName,
            render: function (g, b) {
                g.innerHTML = '<p style="text-align:center;color:#64748b;">' + esc(examName) + ' — ' + list.length + ' نتائج</p>';
                buildTable(b, ['درجہ', 'نتائج', 'اوسط%'], entries.map(function (e) {
                    return { cells: [esc(e.label), e.count, e.avg + '%'], onClick: function () { global.emsDrillPush(nodeExamsByClass(examName, e.label)); } };
                }));
            }
        };
    }
    function nodeExamsByClass(examName, className) {
        var list = readExams().filter(function (e) {
            return (e.examName || e.examType || 'عام') === examName && (e.className || e.class || 'نامعلوم') === className;
        });
        return {
            title: '<i class="fas fa-users"></i> ' + esc(className) + ' (' + list.length + ')', crumb: className,
            render: function (g, b) {
                var avg = list.length ? Math.round(list.reduce(function (s, e) { return s + (Number(e.percentage) || 0); }, 0) / list.length) : 0;
                g.innerHTML = global.emsProgressSVG(avg, avg >= 80 ? '#2ecc71' : (avg >= 50 ? '#f1c40f' : '#e74c3c'), 'درجہ اوسط');
                var rows = list.map(function (e) {
                    return {
                        cells: ['<strong>' + esc(e.studentName || e.name || '-') + '</strong>', esc(e.bookName || e.subject || '-'), (Number(e.percentage) || 0) + '%', esc(e.grade || e.rank || '-')],
                        onClick: e.studentId ? function () { global.emsDrillPush(nodePerson(e.studentId)); } : null
                    };
                });
                if (rows.length > DRILL_PAGE_SIZE) {
                    buildChunkedTableFromRows(b, ['طالب', 'کتاب', 'فیصد', 'درجہ'], rows);
                } else {
                    buildTable(b, ['طالب', 'کتاب', 'فیصد', 'درجہ'], rows);
                }
            }
        };
    }

    function readCurPlans() {
        try { return JSON.parse(localStorage.getItem('ems_curriculum_plans') || '[]'); } catch (e) { return []; }
    }
    function readCurDaily() {
        try { return JSON.parse(localStorage.getItem('ems_curriculum_daily') || '[]'); } catch (e) { return []; }
    }
    function nodeCurriculum(filterStatus) {
        return function () {
            var plans = readCurPlans();
            var daily = readCurDaily();
            var compute = typeof global.curComputeStatus === 'function' ? global.curComputeStatus : function () { return { pct: 0, status: 'green', remaining: 0, expectedPct: 0, gap: 0 }; };
            var filtered = plans.filter(function (p) {
                if (!filterStatus) return true;
                return compute(p, daily).status === filterStatus;
            });
            var stats = typeof global.curGetDashboardStats === 'function' ? global.curGetDashboardStats() : { green: 0, yellow: 0, red: 0, avgPct: 0, books: plans.length };
            return {
                title: '<i class="fas fa-book-open"></i> نصاب نگرانی' + (filterStatus === 'green' ? ' (ہدف پر)' : filterStatus === 'red' ? ' (تاخیر)' : ''), crumb: 'نصاب',
                render: function (g, b) {
                    g.innerHTML = global.emsDonutSVG([
                        { label: 'ہدف پر', value: stats.green, color: '#22c55e' },
                        { label: 'معمولی', value: stats.yellow, color: '#eab308' },
                        { label: 'تاخیر', value: stats.red, color: '#ef4444' }
                    ], stats.avgPct + '%', 'اوسط تکمیل');
                    var rows = filtered.map(function (p) {
                        var st = compute(p, daily);
                        var statusLabel = st.status === 'green' ? 'ہدف پر' : (st.status === 'yellow' ? 'معمولی تاخیر' : 'نمایاں تاخیر');
                        return {
                            cells: [esc(p.bookName), esc(p.grade || '—'), st.pct + '%', st.expectedPct + '%', st.remaining, '<span class="cur-badge cur-' + st.status + '">' + statusLabel + '</span>'],
                            onClick: function () { global.emsDrillPush(nodeCurriculumBook(p.id)); }
                        };
                    });
                    if (rows.length > DRILL_PAGE_SIZE) {
                        buildChunkedTableFromRows(b, ['کتاب', 'درجہ', 'حقیقی%', 'متوقع%', 'باقی', 'حالت'], rows);
                    } else {
                        buildTable(b, ['کتاب', 'درجہ', 'حقیقی%', 'متوقع%', 'باقی', 'حالت'], rows);
                    }
                    var btnWrap = document.createElement('div');
                    btnWrap.style.cssText = 'text-align:center;margin-top:10px;';
                    btnWrap.innerHTML = '<button class="btn btn-sm btn-outline" onclick="window.closeModal(\'dash-drill-modal\'); window.curOpenFromDashboard(\'cur-win-monitor\');"><i class="fas fa-external-link-alt"></i> نصاب کھولیں</button>';
                    b.appendChild(btnWrap);
                }
            };
        };
    }
    function nodeCurriculumBook(bookId) {
        var plans = readCurPlans();
        var p = plans.find(function (x) { return x.id === bookId; });
        var daily = readCurDaily().filter(function (d) { return d.bookId === bookId; }).slice().reverse();
        var compute = typeof global.curComputeStatus === 'function' ? global.curComputeStatus : function () { return { pct: 0, expectedPct: 0, remaining: 0, gap: 0, status: 'green' }; };
        var st = p ? compute(p, readCurDaily()) : { pct: 0, expectedPct: 0, remaining: 0, gap: 0 };
        return {
            title: '<i class="fas fa-book"></i> ' + esc(p ? p.bookName : bookId), crumb: p ? p.bookName : bookId,
            render: function (g, b) {
                g.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;margin-bottom:12px;">' +
                    '<div style="background:#f8fafc;padding:10px;border-radius:8px;"><div style="font-size:22px;font-weight:bold;color:#7c3aed;">' + st.pct + '%</div><div style="font-size:12px;color:#64748b;">تکمیل</div></div>' +
                    '<div style="background:#f8fafc;padding:10px;border-radius:8px;"><div style="font-size:22px;font-weight:bold;">' + st.expectedPct + '%</div><div style="font-size:12px;color:#64748b;">متوقع</div></div>' +
                    '<div style="background:#f8fafc;padding:10px;border-radius:8px;"><div style="font-size:22px;font-weight:bold;color:#ef4444;">' + st.remaining + '</div><div style="font-size:12px;color:#64748b;">باقی</div></div></div>';
                buildTable(b, ['تاریخ', 'استاد', 'صفحہ', 'سطر', 'نوٹ'], daily.slice(0, 30).map(function (d) {
                    return { cells: [esc(d.date), esc(d.teacherName), d.page, d.line, esc(d.note || '—')] };
                }));
            }
        };
    }

    function drillRankStudents(mode) {
        var ranked = [];
        var offset = 0;
        function scan() {
            return drillPagePeople('student', null, offset, DRILL_SCAN_SIZE).then(function (res) {
                asArray(res.rows).forEach(function (u) {
                    var sc = typeof global.tarComputePersonScore === 'function'
                        ? global.tarComputePersonScore(u.id) : { overall: null, prayer: null, hasScoreData: false };
                    if (!sc.hasScoreData || sc.overall == null) return;
                    ranked.push({ u: u, sc: sc });
                });
                offset += DRILL_SCAN_SIZE;
                if (res.rawHasMore && res.rows && res.rows.length >= DRILL_SCAN_SIZE) return scan();
                ranked.sort(function (a, b) { return b.sc.overall - a.sc.overall; });
                if (mode === 'prayer') ranked.sort(function (a, b) { return b.sc.prayer - a.sc.prayer; });
                return ranked;
            });
        }
        return scan();
    }

    function nodeTraining(mode) {
        return function () {
            var st = typeof global.tarGetDashboardStats === 'function'
                ? global.tarGetDashboardStats() : { avgScore: 0, avgPrayer: 0, students: 0, alerts: 0 };
            return {
                title: '<i class="fas fa-mosque"></i> تربیت و نظم', crumb: 'تربیت',
                render: function (g, b) {
                    g.innerHTML = '<p style="text-align:center;color:#64748b;">لوڈ ہو رہا ہے...</p>';
                    b.innerHTML = '';
                    Promise.all([drillCountByType('student'), drillRankStudents(mode)]).then(function (res) {
                        var studTotal = res[0];
                        var ranked = res[1] || [];
                        st.students = studTotal || st.students || ranked.length;
                        g.innerHTML = global.emsDonutSVG([
                            { label: 'تربیت', value: st.avgScore, color: '#0d9488' },
                            { label: 'نماز', value: st.avgPrayer, color: '#6366f1' }
                        ], formatCount(st.students || 0));
                        var rows = ranked.map(function (r) {
                            var fmt = typeof global.tarFormatScore === 'function'
                                ? global.tarFormatScore
                                : function (v) { return v == null ? '—' : (v + '%'); };
                            return {
                                cells: ['<strong>' + esc(r.u.name) + '</strong>', esc(r.u.class || '—'), fmt(r.sc.overall), fmt(r.sc.prayer)],
                                onClick: function () {
                                    if (typeof global.tarDrillPerson === 'function') global.tarDrillPerson(r.u.id);
                                }
                            };
                        });
                        if (rows.length > DRILL_PAGE_SIZE) {
                            buildChunkedTableFromRows(b, ['نام', 'درجہ', 'اسکور', 'نماز%'], rows);
                        } else {
                            buildTable(b, ['نام', 'درجہ', 'اسکور', 'نماز%'], rows);
                        }
                        var btnWrap = document.createElement('div');
                        btnWrap.style.textAlign = 'center';
                        btnWrap.style.marginTop = '10px';
                        btnWrap.innerHTML = '<button class="btn btn-sm btn-outline" onclick="window.closeModal(\'dash-drill-modal\'); window.tarOpenFromDashboard(\'tar-win-dashboard\');"><i class="fas fa-external-link-alt"></i> تربیت کھولیں</button>';
                        b.appendChild(btnWrap);
                    });
                }
            };
        };
    }
    function nodeTrainingAlerts() {
        return {
            title: '<i class="fas fa-bell"></i> تربیتی الرٹس', crumb: 'الرٹس',
            render: function (g, b) {
                var alerts = typeof global.tarGetAlerts === 'function' ? global.tarGetAlerts() : [];
                g.innerHTML = '<p style="text-align:center;font-size:18px;font-weight:bold;color:#ef4444;">' + alerts.length + ' فعال الرٹس</p>';
                buildTable(b, ['نام', 'پیغام'], alerts.map(function (a) {
                    return { cells: ['<strong>' + esc(a.name) + '</strong>', esc(a.msg)], onClick: function () { if (typeof global.tarDrillPerson === 'function') global.tarDrillPerson(a.personId); } };
                }));
            }
        };
    }

    // ---------------- مرکزی dispatcher ----------------
    var BUILDERS = {
        student: nodePeople('student', 'طلبہ', 'fa-user-graduate'),
        teacher: nodePeople('teacher', 'اساتذہ', 'fa-chalkboard-teacher'),
        staff: nodePeople('staff', 'عملہ', 'fa-users-cog'),
        attendance: function () { return nodeAttendance(); },
        income: nodeIncome,
        expense: nodeExpense,
        net: nodeNet,
        'expense-today': nodeExpenseToday,
        'month-collection': function () { return nodeFinanceMonth(new Date().toISOString().substring(0, 7)); },
        'remaining-fee': function () { return nodeArrears(); },
        complaints: nodeComplaints,
        announcements: function () { return nodeAnnouncements(); },
        exams: nodeExams,
        curriculum: nodeCurriculum(null),
        'curriculum-green': nodeCurriculum('green'),
        'curriculum-red': nodeCurriculum('red'),
        training: nodeTraining(null),
        'training-prayer': nodeTraining('prayer'),
        'training-alerts': nodeTrainingAlerts
    };

    global.emsCardDrill = function (type) {
        var builder = BUILDERS[type];
        if (!builder) return;
        var node = typeof builder === 'function' ? builder() : builder;
        global.emsDrillOpen(node);
    };

})(window);
