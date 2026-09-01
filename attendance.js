// ============================================================================
// ایڈوانسڈ اسمارٹ حاضری سسٹم - مکمل اور حتمی جاوا اسکرپٹ (Firebase Cloud Version)
// ============================================================================

// --- گلوبل اسٹیٹ ویری ایبلز (اس ماڈیول کے لیے مخصوص) ---
window.currentAttState = {
  month: '',
  type: '',
  classId: '',
  period: '',
  locked: false,
  records: {},
};
window.currentEventParticipants = [];

function attTenantDoc(db, uid) {
  if (typeof window.emsFirestoreTenantDocRef === 'function') {
    return window.emsFirestoreTenantDocRef(db, uid);
  }
  return db.collection('All_Madrasas').doc(uid);
}

function attTenantSubCol(db, uid, sub) {
  if (typeof window.emsFirestoreSubColRef === 'function') {
    return window.emsFirestoreSubColRef(db, uid, sub);
  }
  return attTenantDoc(db, uid).collection(sub);
}

function attIsEligibleRegistration(u) {
  if (!u || !attGetUserId(u)) return false;
  if (typeof window.EmsQueryUtils !== 'undefined' && typeof window.EmsQueryUtils.isActiveRegistrationStatus === 'function') {
    var s = String(u.status == null ? '' : u.status).trim().toLowerCase();
    if (s === 'pending') return true;
    return window.EmsQueryUtils.isActiveRegistrationStatus(u.status);
  }
  var s = String(u.status == null ? '' : u.status).trim().toLowerCase();
  if (!s) return true;
  if (s === 'rejected' || s === 'suspended' || s === 'withdrawn' || s === 'inactive' || s === 'deleted') {
    return false;
  }
  return true;
}

function attGetUserId(u) {
  if (!u) return '';
  return String(u.id || u.regId || u.uid || u.docId || '').trim();
}
window.attGetUserId = attGetUserId;

function attGetUserClass(u) {
  if (!u) return '';
  return String(u.class || u.className || u.grade || u.section || '').trim();
}

function attFilterEligibleUsers(list) {
  return (list || []).filter(attIsEligibleRegistration);
}

/** Normalize legacy/cloud rows where type casing or field is missing. */
function attNormalizeUserType(u) {
  if (!u) return '';
  var t = String(u.type || '').trim().toLowerCase();
  if (t === 'students') return 'student';
  if (t === 'teachers') return 'teacher';
  if (t === 'student' || t === 'teacher' || t === 'staff') return t;
  var id = attGetUserId(u).toUpperCase();
  if (/^STD[\W_-]?/.test(id) || /^STU[\W_-]?/.test(id)) return 'student';
  if (/^TCH[\W_-]?/.test(id) || /^TCR[\W_-]?/.test(id)) return 'teacher';
  if (/^STF[\W_-]?/.test(id)) return 'staff';
  var cls = attGetUserClass(u);
  if (cls && cls !== 'نامعلوم') return 'student';
  return '';
}

function attUserMatchesType(u, wantType) {
  return attNormalizeUserType(u) === wantType;
}

function attIsStaffAttendanceRegister() {
  var t = window.currentAttState && window.currentAttState.type;
  return t === 'teachers' || t === 'staff';
}

function attIsSelfAttendanceEditBlocked(uid) {
  if (!attIsStaffAttendanceRegister()) return false;
  if (typeof window.emsAttendanceSelfEditBlocked !== 'function') return false;
  return !!window.emsAttendanceSelfEditBlocked(uid).blocked;
}

function attGuardSelfAttendanceEdit(uid, opts) {
  opts = opts || {};
  if (!attIsSelfAttendanceEditBlocked(uid)) return false;
  if (!opts.silent && typeof window.showToast === 'function') {
    var check = window.emsAttendanceSelfEditBlocked(uid);
    window.showToast((check && check.message) || 'آپ اپنی حاضری خود درج نہیں کر سکتے۔', 'error');
  }
  return true;
}

function attClassMatches(u, classId) {
  if (!classId) return true;
  return attGetUserClass(u) === String(classId || '').trim();
}

function attMergeUniqueById(list) {
  var seen = Object.create(null);
  var out = [];
  (list || []).forEach(function (u) {
    var id = attGetUserId(u);
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push(u);
  });
  return out;
}

function attGetFirestoreDb() {
  if (typeof db !== 'undefined' && db) return db;
  if (typeof window.getDbOrNull === 'function') return window.getDbOrNull();
  return null;
}

function attEnsureAttStateShape() {
  if (!window.currentAttState) window.currentAttState = {};
  if (!window.currentAttState.records) window.currentAttState.records = {};
  if (!window.currentAttState.remarks) window.currentAttState.remarks = {};
  if (!window.currentAttState.late) window.currentAttState.late = {};
  if (!window.currentAttState.dailyLocks) window.currentAttState.dailyLocks = {};
  if (!window.currentAttState.periodRecords) window.currentAttState.periodRecords = {};
}

function attReadConfigJson(key, fallback) {
  try {
    var raw = typeof window.emsSafeLocalGet === 'function'
      ? window.emsSafeLocalGet(key)
      : localStorage.getItem(key);
    if (raw == null || raw === '') return fallback;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return fallback;
  }
}

function attGetAttSymbols() {
  return attReadConfigJson('ems_att_symbols', null) || { P: 'P', A: 'A', L: 'L' };
}

/**
 * Read both current symbols and historical attendance symbols by meaning.
 * A madrasa may have saved ح/غ/ر and later opened on a device whose local
 * symbols are P/A/L (or the reverse). Dashboard readers already understand
 * both forms; Smart Register must do the same without rewriting saved data.
 */
function attStatusKind(status, symbols) {
  symbols = symbols || attGetAttSymbols();
  var st = String(status == null ? '' : status).trim();
  if (!st) return '';
  if (st === 'جزوی حاضری') return 'partial';
  if (st === 'نامکمل') return 'incomplete';
  if (typeof window !== 'undefined' && typeof window.attMetricsClassifyStatus === 'function') {
    var metricKind = window.attMetricsClassifyStatus(st, symbols);
    if (metricKind === 'P' || metricKind === 'A' || metricKind === 'L') return metricKind;
  }
  if (st === String(symbols.P || '') || st === 'P' || st === 'حاضر' || st === 'ح') return 'P';
  if (st === String(symbols.A || '') || st === 'A' || st === 'غائب' || st === 'غ'
      || st === 'غیر حاضر' || st === 'غیرحاضر') return 'A';
  if (st === String(symbols.L || '') || st === 'L' || st === 'رخصت' || st === 'ر'
      || st.toLowerCase() === 'leave') return 'L';
  return 'other';
}

/** Display a saved mark using this device's selected symbols. */
function attDisplayStatus(status, symbols) {
  symbols = symbols || attGetAttSymbols();
  var kind = attStatusKind(status, symbols);
  if (kind === 'P') return symbols.P || 'P';
  if (kind === 'A') return symbols.A || 'A';
  if (kind === 'L') return symbols.L || 'L';
  if (kind === 'partial') return 'جزوی حاضری';
  if (kind === 'incomplete') return 'نامکمل';
  return status == null ? '' : String(status);
}

function attReadTimetablePeriods() {
  return attActiveTimetablePeriods();
}

function attReadAllTimetablePeriodsRaw() {
  try {
    var raw = typeof window.emsSafeLocalGet === 'function'
      ? window.emsSafeLocalGet('ems_att_periods')
      : localStorage.getItem('ems_att_periods');
    var list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function attSaveTimetablePeriodsSync(periods) {
  var list = Array.isArray(periods) ? periods : [];
  if (typeof attPersistConfigBlob === 'function') {
    var op = attPersistConfigBlob(ATT_PERIODS_KEY, list);
    op.catch(function () { /* caller/UI reports when applicable */ });
    return op;
  }
  try {
    localStorage.setItem('ems_att_periods', JSON.stringify(list));
    return Promise.resolve({ ok: true, local: true, offline: true });
  } catch (eSave) { /* quota */ }
  return Promise.resolve({ ok: false, reason: 'local_write_failed' });
}

function attNormalizeTeacherDisplayName(name) {
  return String(name || '').replace(/\[.*?\]\s*/g, '').trim();
}

function attCollectRegisteredTeachers() {
  return attFilterEligibleUsers(attGetUsers()).filter(function (u) {
    return attUserMatchesType(u, 'teacher');
  });
}

/** Runtime matching uses stable teacherId only — never display name. */
function attPeriodTeacherIdMatches(period, teacherUid) {
  var uid = String(teacherUid || '').trim();
  if (!uid || !period) return false;
  var pid = String(period.teacherId || '').trim();
  return !!pid && pid === uid;
}

/** Legacy migration helper — returns id only when the name match is uniquely provable. */
function attFindUniqueTeacherIdByName(name, roster) {
  var target = attNormalizeTeacherDisplayName(name);
  if (!target) return null;
  var matches = (roster || []).filter(function (u) {
    if (!u) return false;
    var n = attNormalizeTeacherDisplayName(u.name || u.fullName || '');
    return n && n === target;
  });
  if (matches.length !== 1) return null;
  return attGetUserId(matches[0]) || null;
}

function attMigrateLegacyPeriodTeacherIds(periods) {
  var roster = attCollectRegisteredTeachers();
  var custom = [];
  try {
    var customRaw = typeof window.emsSafeLocalGet === 'function'
      ? window.emsSafeLocalGet('ems_att_custom_teachers')
      : localStorage.getItem('ems_att_custom_teachers');
    custom = customRaw ? (typeof customRaw === 'string' ? JSON.parse(customRaw) : customRaw) : [];
    if (!Array.isArray(custom)) custom = [];
  } catch (eCustom) { custom = []; }
  var customRoster = custom.map(function (c) {
    return { id: c.id, name: c.name, type: 'teacher' };
  });
  var changed = false;
  (periods || []).forEach(function (p) {
    if (!p || String(p.teacherId || '').trim()) return;
    var unique = attFindUniqueTeacherIdByName(p.teacherName, roster)
      || attFindUniqueTeacherIdByName(p.teacherName, customRoster);
    if (unique) {
      p.teacherId = unique;
      changed = true;
    }
  });
  return changed;
}

function attHydrateTimetablePeriods() {
  var periods = attReadAllTimetablePeriodsRaw();
  if (attMigrateLegacyPeriodTeacherIds(periods)) {
    attSaveTimetablePeriodsSync(periods);
    if (typeof console !== 'undefined' && console.info) {
      console.info('[EMS attendance] migrated legacy timetable teacherId fields', { count: periods.length });
    }
  }
  return periods;
}

function attIsPeriodArchived(period) {
  return !!(period && (period.archived === true || period.deleted === true));
}

function attActiveTimetablePeriods(allPeriods) {
  return (allPeriods || attHydrateTimetablePeriods()).filter(function (p) {
    return p && p.id && !attIsPeriodArchived(p);
  });
}

function attResolvePeriodById(periodId) {
  var id = String(periodId || '').trim();
  if (!id) return null;
  var all = attHydrateTimetablePeriods();
  for (var i = 0; i < all.length; i++) {
    if (all[i] && all[i].id === id) return all[i];
  }
  return null;
}

/** Timetable periods for one teacher on a JS weekday (0=Sun … 6=Sat). */
function attTeacherPeriodsForWeekday(teacherUid, teacherName, weekday) {
  var uid = String(teacherUid || '').trim();
  var wd = Number(weekday);
  if (!uid) return [];
  return attReadTimetablePeriods().filter(function (p) {
    if (!p || !p.id) return false;
    var days = Array.isArray(p.days) ? p.days : [];
    // The timetable UI has always labelled an empty day list as "روزانہ".
    // Honour that same meaning in Smart Register; previously such a lesson was
    // visible in the timetable but disappeared from attendance on every day.
    var onDay = !days.length || days.some(function (d) { return Number(d) === wd; });
    if (!onDay) return false;
    return attPeriodTeacherIdMatches(p, uid);
  }).slice().sort(function (a, b) {
    return String(a.start || '').localeCompare(String(b.start || ''));
  });
}

/** Active timetable periods plus archived/orphan periods that still have saved marks. */
function attTeacherPeriodsForRegisterDay(teacherUid, teacherName, day, weekday, savedPeriodMap) {
  var uid = String(teacherUid || '').trim();
  var periods = attTeacherPeriodsForWeekday(uid, teacherName, weekday);
  var seen = Object.create(null);
  periods.forEach(function (p) { if (p && p.id) seen[p.id] = true; });
  var pmap = savedPeriodMap || (window.currentAttState
    && window.currentAttState.periodRecords
    && window.currentAttState.periodRecords[uid]
    && window.currentAttState.periodRecords[uid][day]) || {};
  Object.keys(pmap).forEach(function (pid) {
    if (seen[pid] || pmap[pid] == null || pmap[pid] === '') return;
    var meta = attResolvePeriodById(pid);
    if (meta) {
      periods.push(meta);
    } else {
      periods.push({
        id: pid,
        name: 'محفوظ گھنٹہ',
        className: '-',
        bookName: '',
        start: '',
        archived: true
      });
    }
    seen[pid] = true;
  });
  return periods.slice().sort(function (a, b) {
    return String(a.start || a.id || '').localeCompare(String(b.start || b.id || ''));
  });
}

/** Timetable periods for one class on a JS weekday (0=Sun … 6=Sat). */
function attStudentPeriodsForWeekday(className, weekday) {
  var cls = String(className || '').trim();
  var wd = Number(weekday);
  if (!cls) return [];
  return attReadTimetablePeriods().filter(function (p) {
    if (!p || !p.id) return false;
    var days = Array.isArray(p.days) ? p.days : [];
    var onDay = !days.length || days.some(function (d) { return Number(d) === wd; });
    if (!onDay) return false;
    return String(p.className || '').trim() === cls;
  }).slice().sort(function (a, b) {
    return String(a.start || '').localeCompare(String(b.start || ''));
  });
}

/** Active class periods plus archived/orphan periods that still contain saved marks. */
function attStudentPeriodsForRegisterDay(className, day, weekday, savedPeriodMap) {
  var periods = attStudentPeriodsForWeekday(className, weekday);
  var seen = Object.create(null);
  periods.forEach(function (p) { if (p && p.id) seen[p.id] = true; });
  var pmap = savedPeriodMap || {};
  Object.keys(pmap).forEach(function (pid) {
    if (seen[pid] || pmap[pid] == null || pmap[pid] === '') return;
    var meta = attResolvePeriodById(pid);
    periods.push(meta || {
      id: pid,
      name: 'محفوظ گھنٹہ',
      className: className || '-',
      bookName: '',
      start: '',
      archived: true
    });
    seen[pid] = true;
  });
  return periods.slice().sort(function (a, b) {
    return String(a.start || a.id || '').localeCompare(String(b.start || b.id || ''));
  });
}

function attIsTeacherRegister() {
  return !!(window.currentAttState && window.currentAttState.type === 'teachers');
}

function attPrunePeriodRecordsMap(map) {
  if (!map || typeof map !== 'object') return {};
  var out = {};
  Object.keys(map).forEach(function (uid) {
    var days = map[uid];
    if (!days || typeof days !== 'object') return;
    var dayOut = {};
    Object.keys(days).forEach(function (day) {
      var periods = days[day];
      if (!periods || typeof periods !== 'object') return;
      var clean = {};
      Object.keys(periods).forEach(function (pid) {
        var v = periods[pid];
        if (v == null || v === '') return;
        clean[pid] = v;
      });
      if (Object.keys(clean).length) dayOut[day] = clean;
    });
    if (Object.keys(dayOut).length) out[uid] = dayOut;
  });
  return out;
}

var ATT_ROLLUP_PARTIAL = 'جزوی حاضری';
var ATT_ROLLUP_INCOMPLETE = 'نامکمل';

/** Roll period-hour marks into one day label (P/A/L, جزوی حاضری, or نامکمل). */
function attRollupPeriodDayStatus(periodMap, symbols, expectedPeriodIds) {
  symbols = symbols || { P: 'P', A: 'A', L: 'L' };
  var PARTIAL = 'جزوی حاضری';
  var INCOMPLETE = 'نامکمل';
  var ids = Array.isArray(expectedPeriodIds) && expectedPeriodIds.length
    ? expectedPeriodIds
    : Object.keys(periodMap || {});
  var filled = [];
  var empty = 0;
  ids.forEach(function (pid) {
    var v = periodMap && periodMap[pid];
    if (v == null || v === '') empty += 1;
    else {
      // Keep this rollup usable by older/lightweight callers that load only
      // the period helper (Collective Register and isolated tests).
      var kind = typeof attStatusKind === 'function' ? attStatusKind(v, symbols) : '';
      if (!kind) {
        var text = String(v).trim();
        if (text === symbols.P || text === 'P' || text === 'حاضر' || text === 'ح') kind = 'P';
        else if (text === symbols.A || text === 'A' || text === 'غائب' || text === 'غ'
            || text === 'غیر حاضر' || text === 'غیرحاضر') kind = 'A';
        else if (text === symbols.L || text === 'L' || text === 'رخصت' || text === 'ر'
            || text.toLowerCase() === 'leave') kind = 'L';
      }
      filled.push(kind === 'P' || kind === 'A' || kind === 'L' ? kind : String(v));
    }
  });
  if (!filled.length) return '';
  if (empty > 0) return INCOMPLETE;
  var first = filled[0];
  if (filled.every(function (v) { return v === first; })) {
    if (first === 'P') return symbols.P || 'P';
    if (first === 'A') return symbols.A || 'A';
    if (first === 'L') return symbols.L || 'L';
    return first;
  }
  return PARTIAL;
}

function attDisplayDayMark(uid, day, weekday, opts) {
  opts = opts || {};
  var fallback = opts.fallback || '';
  var symbols = attGetAttSymbols();
  if (!window.currentAttState) return attDisplayStatus(fallback, symbols);
  var pmap = (window.currentAttState.periodRecords[uid]
    && window.currentAttState.periodRecords[uid][day]) || {};
  var curPeriod = window.currentAttState.period || 'all';
  if (curPeriod && curPeriod !== 'all') {
    var one = pmap[curPeriod];
    // A period-filtered register must show that exact hour, matching the
    // dashboard's period filter; a daily mark is not evidence for this hour.
    return attDisplayStatus((one != null && one !== '') ? one : '', symbols);
  }
  // Daily records are the canonical dashboard/report state. Prefer the saved
  // rollup so Smart Register cannot display a different result after timetable
  // periods are renamed, archived, or moved to another weekday.
  if (fallback != null && fallback !== '') return attDisplayStatus(fallback, symbols);
  var periods = [];
  if (attIsTeacherRegister()) {
    periods = attTeacherPeriodsForRegisterDay(uid, opts.name || '', day, weekday, pmap);
  } else if (!attIsStaffAttendanceRegister()) {
    periods = attStudentPeriodsForRegisterDay(opts.className || '', day, weekday, pmap);
  }
  if (!periods.length) return attDisplayStatus(fallback, symbols);
  var ids = periods.map(function (p) { return p.id; });
  return attDisplayStatus(attRollupPeriodDayStatus(pmap, symbols, ids) || fallback, symbols);
}

function attEnsurePeriodDayMap(uid, day) {
  attEnsureAttStateShape();
  if (!window.currentAttState.periodRecords[uid]) window.currentAttState.periodRecords[uid] = {};
  if (!window.currentAttState.periodRecords[uid][day]) window.currentAttState.periodRecords[uid][day] = {};
  return window.currentAttState.periodRecords[uid][day];
}

function attExpectedPeriodIdsForUserDay(uid, day) {
  if (!window.currentAttState || !window.currentAttState.month) return [];
  var parts = String(window.currentAttState.month).split('-');
  var dnum = Number(day);
  var dd = dnum < 10 ? '0' + dnum : String(dnum);
  var wd = new Date(parts[0] + '-' + parts[1] + '-' + dd).getDay();
  var periods = [];
  if (attIsTeacherRegister()) {
    periods = attTeacherPeriodsForWeekday(uid, attFindTeacherNameByUid(uid), wd);
  } else if (!attIsStaffAttendanceRegister()) {
    var u = attFindRegisterUser(uid);
    periods = attStudentPeriodsForWeekday(attGetUserClass(u) || window.currentAttState.classId || '', wd);
  }
  return periods.map(function (p) { return p.id; });
}

function attSyncLegacyFromPeriods(uid, day) {
  var symbols = attGetAttSymbols();
  var pmap = (window.currentAttState.periodRecords[uid] && window.currentAttState.periodRecords[uid][day]) || {};
  var rolled = attRollupPeriodDayStatus(pmap, symbols, attExpectedPeriodIdsForUserDay(uid, day));
  if (!window.currentAttState.records[uid]) window.currentAttState.records[uid] = {};
  if (rolled) window.currentAttState.records[uid][day] = rolled;
  else delete window.currentAttState.records[uid][day];
}

function attApplyStatusToAllTeacherPeriods(uid, day, status, periods) {
  var pmap = attEnsurePeriodDayMap(uid, day);
  if (!periods || !periods.length) return;
  periods.forEach(function (p) {
    if (status) pmap[p.id] = status;
    else delete pmap[p.id];
  });
  if (!Object.keys(pmap).length) {
    delete window.currentAttState.periodRecords[uid][day];
  }
  attSyncLegacyFromPeriods(uid, day);
}

function attClearTeacherPeriodsForDay(uid, day) {
  if (!window.currentAttState || !window.currentAttState.periodRecords) return;
  if (window.currentAttState.periodRecords[uid]) {
    delete window.currentAttState.periodRecords[uid][day];
  }
}

function attEscJsStr(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function attBuildTeacherPeriodBoxesHtml(uid, teacherName, day, weekday, symbols, locked) {
  var periods = attTeacherPeriodsForRegisterDay(uid, teacherName, day, weekday);
  if (!periods.length) return '';
  var pmap = (window.currentAttState.periodRecords[uid] && window.currentAttState.periodRecords[uid][day]) || {};
  var boxes = periods.map(function (p, idx) {
    var rawStatus = pmap[p.id] || '';
    var statusKind = attStatusKind(rawStatus, symbols);
    var st = attDisplayStatus(rawStatus, symbols);
    var cls = 'att-period-box';
    if (statusKind === 'P') cls += ' is-p';
    else if (statusKind === 'A') cls += ' is-a';
    else if (statusKind === 'L') cls += ' is-l';
    var title = (p.name || ('گھنٹہ ' + (idx + 1)))
      + (p.className && p.className !== '-' ? ' · ' + p.className : '')
      + (p.bookName ? ' · ' + p.bookName : '')
      + (p.start ? ' · ' + p.start : '');
    var label = st || String(idx + 1);
    if (locked) {
      return '<span class="' + cls + '" title="' + attEscJsStr(title) + '">' + label + '</span>';
    }
    return '<button type="button" class="' + cls + '" title="' + attEscJsStr(title)
      + '" data-pid="' + attEscJsStr(p.id) + '"'
      + ' onclick="event.stopPropagation(); cycleTeacherPeriodStatus(\'' + attEscJsStr(uid) + '\', ' + day
      + ', \'' + attEscJsStr(p.id) + '\')">' + label + '</button>';
  }).join('');
  var bulk = '';
  if (!locked) {
    bulk = '<div class="att-period-bulk">'
      + '<button type="button" class="att-period-bulk-btn is-p" title="تمام گھنٹے حاضر"'
      + ' onclick="event.stopPropagation(); setTeacherAllPeriods(\'' + attEscJsStr(uid) + '\', ' + day + ', \'' + symbols.P + '\')">سب ' + symbols.P + '</button>'
      + '<button type="button" class="att-period-bulk-btn is-a" title="تمام گھنٹے غیر حاضر"'
      + ' onclick="event.stopPropagation(); setTeacherAllPeriods(\'' + attEscJsStr(uid) + '\', ' + day + ', \'' + symbols.A + '\')">سب ' + symbols.A + '</button>'
      + '<button type="button" class="att-period-bulk-btn is-l" title="تمام گھنٹے رخصت"'
      + ' onclick="event.stopPropagation(); setTeacherAllPeriods(\'' + attEscJsStr(uid) + '\', ' + day + ', \'' + symbols.L + '\')">سب ' + symbols.L + '</button>'
      + '<button type="button" class="att-period-bulk-btn is-clear" title="تمام گھنٹے صاف"'
      + ' onclick="event.stopPropagation(); setTeacherAllPeriods(\'' + attEscJsStr(uid) + '\', ' + day + ', \'\')">×</button>'
      + '</div>';
  }
  return '<div class="att-period-wrap" onclick="event.stopPropagation()">'
    + '<div class="att-period-boxes">' + boxes + '</div>'
    + bulk
    + '</div>';
}


function attMarkLocalWrite() {
  // Multiple cells can be changed within the same millisecond. A strictly
  // increasing edit time prevents an older in-flight cloud acknowledgement
  // from being mistaken for the newest local attendance state.
  var now = Math.max(Date.now(), Number(_attLastLocalWriteTs || 0) + 1);
  _attLastLocalWriteTs = now;
  if (window.currentAttState) window.currentAttState._localWriteTs = now;
  return now;
}

/** Ignore stale Firestore snapshots; equal timestamp is the full cloud acknowledgement. */
function attShouldApplyRemoteSnapshot(remoteData) {
  var localTs = (window.currentAttState && window.currentAttState._localWriteTs) || _attLastLocalWriteTs || 0;
  if (!localTs) return true;
  if (Date.now() - localTs < ATT_REMOTE_GRACE_MS) return false;
  // The write patch and resulting complete Firestore document carry the same timestamp.
  // Accepting equality repairs a partial local snapshot without losing a successful clear.
  return attRecordTimestamp(remoteData) >= localTs;
}

function attGetRegisterUsers() {
  if (window.currentAttState && window.currentAttState.targetUsers && window.currentAttState.targetUsers.length) {
    return attFilterEligibleUsers(window.currentAttState.targetUsers.slice());
  }
  if (typeof window.getFilteredUsers === 'function') return window.getFilteredUsers();
  return [];
}

function attQuickRefreshRegister() {
  if (!window.currentAttState || !window.currentAttState.month) return;
  buildSmartRegisterImmediate(window.currentAttState.month, attGetRegisterUsers());
}

function attRefreshLockChrome() {
  var lockCheck = document.getElementById('att-lock-check');
  var btnSaveLock = document.getElementById('btn-att-save-lock');
  var btnEditMode = document.getElementById('btn-att-edit-mode');
  var locked = !!(window.currentAttState && window.currentAttState.locked);
  if (lockCheck) lockCheck.checked = locked;
  if (btnSaveLock) btnSaveLock.style.display = locked ? 'none' : 'inline-flex';
  if (btnEditMode) btnEditMode.style.display = locked ? 'inline-flex' : 'none';
}

function attGetUsersRaw() {
  if (typeof window.emsGetUsersMerged === 'function') {
    var merged = window.emsGetUsersMerged();
    if (merged && merged.length) return merged;
  }
  if (typeof window.emsGetUsersSync === 'function') {
    return window.emsGetUsersSync() || [];
  }
  return [];
}

function attApplyDeptFilter(users) {
  if (!Array.isArray(users) || !users.length) return users || [];
  if (typeof window.emsFilterByDepartment === 'function') {
    return window.emsFilterByDepartment(users);
  }
  return users;
}

function attGetUsers() {
  return attFilterEligibleUsers(attApplyDeptFilter(attGetUsersRaw()));
}

function attGetUsersWhenReady() {
  var ready = typeof window.emsEnsureRepositoryReady === 'function'
    ? window.emsEnsureRepositoryReady()
    : Promise.resolve();
  return ready.then(function () {
    return attGetUsers();
  });
}
window.attGetUsersWhenReady = attGetUsersWhenReady;

var ATT_REGISTER_ROW_PAGE = 50;
var ATT_REMOTE_GRACE_MS = 5000;
var _attLastLocalWriteTs = 0;
var _attDropdownReady = false;
var _attDropdownCacheGen = -1;
var _attDropdownRepoCount = -1;
var _attPeriodSelectBound = false;
var _attClassSelectBound = false;
var _attTypeSelectBound = false;
var _attRegisterQuickSearchBound = false;
var _buildSmartRegisterScheduled = false;
var _buildSmartRegisterPending = null;
var _attDeptRefreshTimer = null;
var _attDashSaveRenderTimer = null;
var ATT_DASH_SAVE_RENDER_DEBOUNCE_MS = 650;
var ATT_SEARCH_MAX = 50;
var ATT_SEARCH_DEBOUNCE_MS = 150;

function attDebounce(fn, ms) {
  var timer = null;
  return function () {
    var ctx = this;
    var args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      fn.apply(ctx, args);
    }, ms);
  };
}

function attScheduleDashboardRefreshFromSave() {
  if (typeof window.emsInvalidateAttDashboardCache === 'function') {
    window.emsInvalidateAttDashboardCache();
  }
  if (!attPanelIsVisible('att-dashboard-panel')) return;
  if (_attDashSaveRenderTimer) clearTimeout(_attDashSaveRenderTimer);
  _attDashSaveRenderTimer = setTimeout(function () {
    _attDashSaveRenderTimer = null;
    if (attPanelIsVisible('att-dashboard-panel') && typeof window.renderAttDashboard === 'function') {
      window.renderAttDashboard();
    }
  }, ATT_DASH_SAVE_RENDER_DEBOUNCE_MS);
}

function attPanelIsVisible(panelId) {
  if (typeof window.emsAttPanelIsVisible === 'function') return window.emsAttPanelIsVisible(panelId);
  var el = document.getElementById(panelId);
  if (!el) return false;
  return el.classList.contains('active');
}

/** True when attendance UI should paint (module visible or register session active). */
function attShouldRenderRegister() {
  if (typeof window.emsIsAttendanceModuleActive === 'function' && window.emsIsAttendanceModuleActive()) {
    return true;
  }
  var mod = document.getElementById('module-attendance');
  if (mod && mod.classList.contains('active') && mod.style.display !== 'none') return true;
  if (window.currentAttState && window.currentAttState.month && window.currentAttState.targetUsers && window.currentAttState.targetUsers.length) {
    return true;
  }
  return false;
}

function attResolveRosterLimit() {
  var limit = typeof window.emsResolveFetchLimit === 'function' ? window.emsResolveFetchLimit(5000) : 5000;
  if (!limit || limit < 1) return 5000;
  return limit;
}

function attOnRepositoryDataReady() {
  if (typeof window.emsIsAttendanceModuleActive === 'function' && !window.emsIsAttendanceModuleActive()) return;
  loadAttDropdowns(true);
  if (window.currentAttState && window.currentAttState.month && window.currentAttState.targetUsers && window.currentAttState.targetUsers.length) {
    buildSmartRegister(window.currentAttState.month, window.getFilteredUsers());
  } else if (typeof attTryAutoLoadRegister === 'function') {
    attTryAutoLoadRegister();
  }
}

// =========================================================
// فائر بیس لائیو سنک (حاضری ماڈیول) — tenantId via emsGetTenantId()
// =========================================================
function getAttendanceTenantId() {
  // Canonical verified tenant only — fail closed on mismatch / transition.
  if (typeof window.emsGetCanonicalTenantId === 'function') {
    return window.emsGetCanonicalTenantId();
  }
  if (typeof window.emsGetTenantId === 'function') {
    var tid = window.emsGetTenantId();
    if (tid) return tid;
  }
  if (window.CURRENT_MADRASA_TENANT_ID) return window.CURRENT_MADRASA_TENANT_ID;
  return null;
}

/**
 * Canonical storage scope before any attendance key/doc id is built.
 * Students stay class-scoped; teachers/staff always use classId="" and period="all".
 */
function attNormalizeStorageScope(month, type, classId, period) {
  month = month || '';
  type = type || 'students';
  classId = classId != null ? String(classId) : '';
  period = period || 'all';
  if (attIsCanonicalUnified()) {
    if (type === 'students' && classId) {
      return { month: month, type: type, classId: classId, period: 'all' };
    }
    if (type === 'teachers' || type === 'staff') {
      return { month: month, type: type, classId: '', period: 'all' };
    }
  }
  return { month: month, type: type, classId: classId, period: period };
}

function attSheetKeys(month, type, classId, period) {
  var scope = attNormalizeStorageScope(month, type, classId, period);
  month = scope.month;
  type = scope.type;
  classId = scope.classId;
  period = scope.period;
  var uid = getAttendanceTenantId();
  if (!uid) return { cloudDocId: null, localKey: null, tenantId: null };
  var p = period || 'all';
  var cloudDocId = typeof window.emsAttCloudDocId === 'function'
    ? window.emsAttCloudDocId(month, type, classId, p)
    : 'att_rec_' + month + '_' + type + '_' + classId + '_' + p;
  var localKey = typeof window.emsAttLocalStorageKey === 'function'
    ? window.emsAttLocalStorageKey(uid, month, type, classId, p)
    : cloudDocId;
  return { cloudDocId: cloudDocId, localKey: localKey, tenantId: uid };
}

/** Rollback: localStorage.setItem('ems_att_canonical_unified','0') then reload. */
function attIsCanonicalUnified() {
  try {
    var v = localStorage.getItem('ems_att_canonical_unified');
    if (v === '0' || v === 'false') return false;
  } catch (e) { /* quota / private mode */ }
  return true;
}

/** Every register shares one canonical sheet (period=all); period picker is view-only. */
function attResolveSheetKeys(month, type, classId, period) {
  var scope = attNormalizeStorageScope(month, type, classId, period);
  if (attIsCanonicalUnified() && scope.type === 'students' && scope.classId) {
    return attCanonicalStudentKeys(scope.month, scope.classId);
  }
  return attSheetKeys(scope.month, scope.type, scope.classId, scope.period);
}

function attNotifyCanonicalUpdated(classId, month, data) {
  if (typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('ems:attendance-canonical-updated', {
        detail: { classId: classId, month: month }
      }));
    } catch (eEv) { /* legacy */ }
  }
  attAdoptCanonicalIntoOpenRegister(classId, month, data);
}

function attLastSessionStorageKey() {
  var uid = getAttendanceTenantId() || 'local';
  return 'ems_att_last_session_' + uid;
}

function attSaveLastSession(month, type, classId, period) {
  var scope = attNormalizeStorageScope(month, type, classId, period);
  try {
    localStorage.setItem(attLastSessionStorageKey(), JSON.stringify({
      month: scope.month,
      type: scope.type,
      classId: scope.classId,
      period: scope.period,
      ts: Date.now()
    }));
  } catch (e) { /* quota */ }
}

function attRestoreLastSession() {
  try {
    var raw = localStorage.getItem(attLastSessionStorageKey());
    if (!raw) return false;
    var s = JSON.parse(raw);
    if (!s || !s.month) return false;
    var typeSel = document.getElementById('att-reg-type');
    var clsSel = document.getElementById('att-reg-class');
    var perSel = document.getElementById('att-reg-period');
    var monthInput = document.getElementById('att-reg-month');
    if (typeSel && s.type) typeSel.value = s.type;
    if (monthInput && s.month) monthInput.value = s.month;
    if (clsSel && s.classId) clsSel.value = s.classId;
    if (perSel && s.period) perSel.value = s.period;
    return true;
  } catch (e) {
    return false;
  }
}

function attIsOfflineMode() {
  if (window.EMS_NETWORK_OFFLINE_AT_BOOT) return true;
  if (window.EMS_OFFLINE_ONLY) return true;
  if (!navigator.onLine) return true;
  return false;
}

function attPersistSheetLocal(cloudDocId, localKey, data) {
  if (!localKey) localKey = cloudDocId;
  if (typeof window.emsOfflineWriteLocalSync === 'function') {
    // Never report a blocked tenant partition or a storage failure as saved.
    return window.emsOfflineWriteLocalSync(localKey, data) !== false;
  } else {
    try {
      var str = JSON.stringify(data);
      if (window._emsOriginalSetItem) {
        window._emsSuppressSync = true;
        window._emsOriginalSetItem.call(localStorage, localKey, str);
        window._emsSuppressSync = false;
      } else {
        localStorage.setItem(localKey, str);
      }
    } catch (e) {
      console.warn('[EMS] att local sync write failed', e);
      return false;
    }
  }
  return true;
}

var _attCloudPersistTimer = null;
var _attCloudPersistPending = null;
var _attCloudPersistInflight = Object.create(null);
var _attSaveToastShown = false;

window.attHasPendingCloudPersistForDoc = function (cloudDocId) {
  if (!cloudDocId) return false;
  return !!(
    (_attCloudPersistPending && _attCloudPersistPending.cloudDocId === cloudDocId)
    || _attCloudPersistInflight[cloudDocId]
  );
};

function attScheduleCloudPersist(cloudDocId, localKey, dataToSave, showToast, cloudPatch, opts) {
  opts = opts || {};
  if (_attCloudPersistPending && _attCloudPersistPending.cloudDocId
      && _attCloudPersistPending.cloudDocId !== cloudDocId) {
    if (_attCloudPersistTimer) {
      clearTimeout(_attCloudPersistTimer);
      _attCloudPersistTimer = null;
    }
    attRunPendingCloudPersist();
  }
  var mergedPatch = cloudPatch;
  if (_attCloudPersistPending && _attCloudPersistPending.cloudDocId === cloudDocId) {
    mergedPatch = attMergeCloudPatches(_attCloudPersistPending.cloudPatch, cloudPatch);
  }
  _attCloudPersistPending = {
    cloudDocId: cloudDocId,
    localKey: localKey,
    dataToSave: dataToSave,
    cloudPatch: mergedPatch,
    showToast: !!showToast || !!(
      _attCloudPersistPending && _attCloudPersistPending.showToast
    )
  };
  if (_attCloudPersistTimer) clearTimeout(_attCloudPersistTimer);
  // The outbox is durable and coalesces document updates itself. Queue now so
  // an app/tab close cannot occur during a debounce window.
  var delay = 0;
  _attCloudPersistTimer = setTimeout(function () {
    _attCloudPersistTimer = null;
    attRunPendingCloudPersist();
  }, delay);
}

function attFlushPendingCloudPersist() {
    if (_attCloudPersistTimer) {
      clearTimeout(_attCloudPersistTimer);
      _attCloudPersistTimer = null;
    }
    if (_attCloudPersistPending) attRunPendingCloudPersist();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', attFlushPendingCloudPersist);
  window.addEventListener('visibilitychange', function () {
    if (document && document.visibilityState === 'hidden') attFlushPendingCloudPersist();
  });
}

function attRunPendingCloudPersist() {
    var p = _attCloudPersistPending;
    _attCloudPersistPending = null;
    if (!p || typeof window.emsOfflinePersistAttendance !== 'function') {
      if (p && typeof window.attSaveStatusOnCloudResult === 'function') {
        window.attSaveStatusOnCloudResult(p.cloudDocId, {
          ok: false,
          code: 'OUTBOX_UNAVAILABLE',
          error: 'attendance sync outbox unavailable'
        });
      }
      if (p && typeof window.showToast === 'function') {
        window.showToast('خرابی: حاضری سنک outbox تیار نہیں — صفحہ دوبارہ لوڈ کریں', 'error');
      }
      return;
    }
    var persistOpts = {
      localKey: p.localKey,
      skipLocalSync: true,
      tenantId: getAttendanceTenantId()
    };
    if (p.cloudPatch && Object.keys(p.cloudPatch).length) {
      persistOpts.patch = p.cloudPatch;
    }
    // Clears must hit Firebase like P/A/L — prefer patch with deletes / map replace.
    if (typeof window.attSaveStatusMarkCloud === 'function') {
      window.attSaveStatusMarkCloud(p.cloudDocId, 'syncing');
    }
    _attCloudPersistInflight[p.cloudDocId] = Number(_attCloudPersistInflight[p.cloudDocId] || 0) + 1;
    window.emsOfflinePersistAttendance(p.cloudDocId, p.dataToSave, persistOpts).then(function (res) {
      if (typeof window.attSaveStatusOnCloudResult === 'function') {
        window.attSaveStatusOnCloudResult(p.cloudDocId, res || { ok: false, error: 'empty cloud result' });
      }
      if (!p.showToast || typeof window.showToast !== 'function') return;
      var n = (typeof window.emsNormalizeCloudResult === 'function')
        ? window.emsNormalizeCloudResult(res || {}, { localSaved: true })
        : (res || {});
      if (n.synced) {
        window.showToast('✅ حاضری محفوظ + کلاؤڈ سنک', 'success');
      } else if (n.cloudState === 'failed' || n.cloudState === 'conflict') {
        window.showToast('مقامی طور پر محفوظ — کلاؤڈ پر ناکام', 'warning');
      } else if ((n.offline || n.queued) && !_attSaveToastShown) {
        _attSaveToastShown = true;
        window.showToast('✅ حاضری آف لائن محفوظ — کلاؤڈ سنک بعد میں', 'success');
      }
    }).catch(function (err) {
      console.error('[EMS] save attendance', err);
      if (typeof window.attSaveStatusOnCloudResult === 'function') {
        window.attSaveStatusOnCloudResult(p.cloudDocId, {
          ok: false,
          error: err && err.message ? err.message : String(err)
        });
      }
    }).then(function () {
      var left = Number(_attCloudPersistInflight[p.cloudDocId] || 0) - 1;
      if (left > 0) _attCloudPersistInflight[p.cloudDocId] = left;
      else delete _attCloudPersistInflight[p.cloudDocId];
    });
}

function attReadSheetLocal(localKey) {
  try {
    var raw = null;
    // att_rec_* lives in durable/IDB memory — not localStorage (emsSafeLocalGet misses clears).
    if (typeof window.emsIsLargeBlobKey === 'function' && window.emsIsLargeBlobKey(localKey)
        && typeof window.emsDurableReadRaw === 'function') {
      raw = window.emsDurableReadRaw(localKey);
    } else if (typeof window.emsCacheGetRaw === 'function') {
      raw = window.emsCacheGetRaw(localKey);
    } else if (typeof window.emsSafeLocalGet === 'function') {
      raw = window.emsSafeLocalGet(localKey);
    } else {
      raw = localStorage.getItem(localKey);
    }
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (eRead) {
    return null;
  }
}

/** Merge field-path patches; prefer granular periodRecords paths over whole-map replace. */
function attMergeCloudPatches(prevPatch, nextPatch) {
  if (!prevPatch || !Object.keys(prevPatch).length) return nextPatch || {};
  if (!nextPatch || !Object.keys(nextPatch).length) return prevPatch || {};
  var merged = Object.assign({}, prevPatch, nextPatch);
  ['periodRecords', 'records', 'remarks', 'late'].forEach(function (field) {
    if (!merged[field]) return;
    var hasGranular = Object.keys(merged).some(function (k) {
      return k.indexOf(field + '.') === 0;
    });
    if (hasGranular) delete merged[field];
  });
  return merged;
}

function attStripPatchFieldPrefix(patch, field) {
  if (!patch) return;
  if (patch[field]) delete patch[field];
  Object.keys(patch).forEach(function (k) {
    if (k.indexOf(field + '.') === 0) delete patch[k];
  });
}

/** Granular periodRecords paths — one teacher/day/period per patch key. */
function attDiffPeriodRecordsPatch(prevMap, newMap, patch) {
  prevMap = prevMap || {};
  newMap = newMap || {};
  Object.keys(newMap).forEach(function (uid) {
    var prevDay = prevMap[uid] || {};
    var newDay = newMap[uid] || {};
    Object.keys(newDay).forEach(function (day) {
      var prevPeriods = prevDay[day] || {};
      var newPeriods = newDay[day] || {};
      Object.keys(newPeriods).forEach(function (pid) {
        if (prevPeriods[pid] !== newPeriods[pid]) {
          patch['periodRecords.' + uid + '.' + day + '.' + pid] = newPeriods[pid];
        }
      });
      Object.keys(prevPeriods).forEach(function (pid) {
        if (!(pid in newPeriods) && prevPeriods[pid] != null && prevPeriods[pid] !== '') {
          patch['periodRecords.' + uid + '.' + day + '.' + pid] = null;
        }
      });
    });
    Object.keys(prevDay).forEach(function (day) {
      if (!(day in newDay)) {
        patch['periodRecords.' + uid + '.' + day] = null;
      }
    });
  });
  Object.keys(prevMap).forEach(function (uid) {
    if (!newMap[uid]) {
      Object.keys(prevMap[uid] || {}).forEach(function (day) {
        patch['periodRecords.' + uid + '.' + day] = null;
      });
    }
  });
}

/** Remove a day key whether stored as number or string (JSON/Firestore). */
function attDeleteDayEntry(map, uid, day) {
  if (!map || !map[uid]) return;
  var row = map[uid];
  delete row[day];
  delete row[String(day)];
  var n = Number(day);
  if (!isNaN(n)) delete row[n];
}

/** Build Firestore field-path patch (records.uid.day) vs previous persisted sheet. */
function attComputeSheetCloudPatch(prevData, newData) {
  prevData = prevData || {};
  newData = newData || {};
  var patch = {};
  var prevRec = prevData.records || {};
  var newRec = newData.records || {};
  Object.keys(newRec).forEach(function (uid) {
    var prevDay = prevRec[uid] || {};
    var newDay = newRec[uid] || {};
    Object.keys(newDay).forEach(function (day) {
      if (prevDay[day] !== newDay[day]) {
        patch['records.' + uid + '.' + day] = newDay[day];
      }
    });
    Object.keys(prevDay).forEach(function (day) {
      if (!(day in newDay) && prevDay[day] != null && prevDay[day] !== '') {
        patch['records.' + uid + '.' + day] = null;
      }
    });
  });
  Object.keys(prevRec).forEach(function (uid) {
    if (!newRec[uid]) {
      Object.keys(prevRec[uid] || {}).forEach(function (day) {
        if (prevRec[uid][day] != null && prevRec[uid][day] !== '') {
          patch['records.' + uid + '.' + day] = null;
        }
      });
    }
  });

  function diffDayMapField(field) {
    var prevMap = prevData[field] || {};
    var newMap = newData[field] || {};
    var touched = false;
    Object.keys(prevMap).forEach(function (uid) {
      var prevDay = prevMap[uid] || {};
      var newDay = newMap[uid] || {};
      Object.keys(prevDay).forEach(function (day) {
        if (!(day in newDay)) {
          patch[field + '.' + uid + '.' + day] = null;
          touched = true;
        }
      });
    });
    Object.keys(newMap).forEach(function (uid) {
      var prevDay = prevMap[uid] || {};
      var newDay = newMap[uid] || {};
      if (JSON.stringify(prevDay) !== JSON.stringify(newDay)) touched = true;
    });
    if (touched && JSON.stringify(prevMap) !== JSON.stringify(newMap)) {
      // Full map replace — Firestore deep-merge cannot revive cleared days.
      patch[field] = newMap;
    }
  }
  diffDayMapField('remarks');
  diffDayMapField('late');
  attDiffPeriodRecordsPatch(prevData.periodRecords || {}, newData.periodRecords || {}, patch);

  function diffNested(field) {
    var a = prevData[field];
    var b = newData[field];
    if (JSON.stringify(a || {}) === JSON.stringify(b || {})) return;
    patch[field] = b || {};
  }
  diffNested('dailyLocks');

  if (prevData.locked !== newData.locked) patch.locked = !!newData.locked;
  if (prevData.timestamp !== newData.timestamp) patch.timestamp = newData.timestamp;
  if (newData.departmentId != null && prevData.departmentId !== newData.departmentId) {
    patch.departmentId = newData.departmentId;
  }
  return patch;
}

/** Ensure × / clear reaches Firebase without replacing unrelated period marks. */
function attAppendForcedClearPatch(patch, clearCells, newData) {
  patch = patch || {};
  clearCells = clearCells || [];
  if (!clearCells.length && !attPatchHasClears(patch)) return patch;

  if (clearCells.length) {
    // Clear each field's previous diff only once. Clearing it inside the loop
    // silently discarded every collective delete except the final person.
    ['records', 'remarks', 'late', 'periodRecords'].forEach(function (field) {
      attStripPatchFieldPrefix(patch, field);
    });
    clearCells.forEach(function (c) {
      var uid = c && c.uid;
      var day = c && c.day;
      if (!uid || day == null) return;
      ['records', 'remarks', 'late'].forEach(function (field) {
        patch[field + '.' + uid + '.' + day] = null;
      });
      patch['periodRecords.' + uid + '.' + day] = null;
    });
  } else {
    ['records', 'remarks', 'late', 'periodRecords'].forEach(function (field) {
      if (Object.keys(patch).some(function (k) { return k.indexOf(field + '.') === 0; })) {
        delete patch[field];
      }
    });
  }
  if (newData && newData.timestamp != null) patch.timestamp = newData.timestamp;
  if (newData && newData.dailyLocks) patch.dailyLocks = newData.dailyLocks;
  if (newData && typeof newData.locked === 'boolean') patch.locked = newData.locked;
  return patch;
}

function attPatchHasClears(patch) {
  if (!patch) return false;
  return Object.keys(patch).some(function (k) {
    return patch[k] === null && /^(records|remarks|late|periodRecords)\./.test(k);
  });
}

function attPauseDictObserver() {
  if (window.dictObserver) window.dictObserver.disconnect();
}

function attResumeDictObserver() {
  if (typeof window.emsStartDictObserver === 'function') window.emsStartDictObserver();
}

function attRefreshCellUI(uid, day) {
  var symbols = attGetAttSymbols();
  var fallback = (window.currentAttState && window.currentAttState.records[uid])
    ? (window.currentAttState.records[uid][day] || '') : '';
  var u = attFindRegisterUser(uid);
  var parts = String((window.currentAttState && window.currentAttState.month) || '').split('-');
  var wd = 0;
  if (parts.length >= 2) {
    var dnum = Number(day);
    var dd = dnum < 10 ? '0' + dnum : String(dnum);
    wd = new Date(parts[0] + '-' + parts[1] + '-' + dd).getDay();
  }
  var st = attDisplayDayMark(uid, day, wd, {
    fallback: fallback,
    name: u ? (u.name || '') : '',
    className: attGetUserClass(u)
  });
  var statusKind = attStatusKind(st, symbols);
  var printEl = document.getElementById('print-txt-' + uid + '-' + day);
  if (printEl) printEl.textContent = st;
  if (!printEl) return;
  var cell = printEl.closest('td');
  if (!cell) return;
  cell.classList.remove('att-cell-empty', 'att-cell-p', 'att-cell-a', 'att-cell-l', 'att-cell-partial', 'att-cell-incomplete');
  if (!st) cell.classList.add('att-cell-empty');
  else if (statusKind === 'P') cell.classList.add('att-cell-p');
  else if (statusKind === 'A') cell.classList.add('att-cell-a');
  else if (statusKind === 'L') cell.classList.add('att-cell-l');
  else if (statusKind === 'partial') cell.classList.add('att-cell-partial');
  else if (statusKind === 'incomplete') cell.classList.add('att-cell-incomplete');
  cell.querySelectorAll('.att-cell-btn.status-p').forEach(function (btn) {
    btn.classList.toggle('active', statusKind === 'P');
  });
  cell.querySelectorAll('.att-cell-btn.status-a').forEach(function (btn) {
    btn.classList.toggle('active', statusKind === 'A');
  });
  cell.querySelectorAll('.att-cell-btn.status-l').forEach(function (btn) {
    btn.classList.toggle('active', statusKind === 'L');
  });
  cell.querySelectorAll('.att-cell-btn.status-clear').forEach(function (btn) {
    btn.classList.toggle('active', !st);
  });
  cell.querySelectorAll('.att-cell-btn.status-custom').forEach(function (btn) {
    var remark = (window.currentAttState.remarks[uid] && window.currentAttState.remarks[uid][day]) || '';
    var late = (window.currentAttState.late[uid] && window.currentAttState.late[uid][day]) || '';
    btn.classList.toggle('active', !!(remark || late));
  });
  // Refresh teacher period mini-boxes in place (keep legacy controls).
  if (attIsTeacherRegister()) {
    var locked = !!(window.currentAttState.locked || window.currentAttState.dailyLocks[day]);
    var name = attFindTeacherNameByUid(uid);
    var parts = String(window.currentAttState.month || '').split('-');
    var full = parts[0] + '-' + parts[1] + '-' + (day < 10 ? '0' + day : day);
    var wd = new Date(full).getDay();
    var wrap = cell.querySelector('.att-period-wrap');
    var html = attBuildTeacherPeriodBoxesHtml(uid, name, day, wd, symbols, locked);
    if (wrap) {
      if (html) wrap.outerHTML = html;
      else wrap.remove();
    } else if (html) {
      var host = printEl.parentElement;
      if (host) host.insertAdjacentHTML('beforeend', html);
    }
  }
}

var attConfigUnsub = null;
let currentAttListener = null;
var _attRegisterLoadSeq = 0;

function attRegisterLoadIsCurrent(ctx) {
  if (!ctx) return true;
  if (ctx.requestId !== _attRegisterLoadSeq) return false;
  var activeTenant = getAttendanceTenantId();
  if (!activeTenant || String(activeTenant) !== String(ctx.tenantId || '')) return false;
  if (ctx.generation != null && typeof window.emsGetTenantGeneration === 'function'
      && window.emsGetTenantGeneration() !== ctx.generation) return false;
  return true;
}

function attSetRegisterLoadBusy(ctx, busy) {
  var btn = document.getElementById('btn-load-smart-register');
  if (!btn) return;
  if (!busy && btn._attLoadRequestId !== (ctx && ctx.requestId)) return;
  if (busy) {
    if (!btn._attLoadPrevHtml) btn._attLoadPrevHtml = btn.innerHTML;
    btn._attLoadRequestId = ctx && ctx.requestId;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> رجسٹر لوڈ ہو رہا ہے…';
  } else {
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
    btn.innerHTML = btn._attLoadPrevHtml || '<i class="fas fa-sync-alt"></i> رجسٹر لوڈ کریں';
    delete btn._attLoadPrevHtml;
    delete btn._attLoadRequestId;
  }
}

function stopAttendanceFirestoreSync() {
  if (attConfigUnsub) {
    attConfigUnsub();
    attConfigUnsub = null;
  }
  if (currentAttListener) {
    currentAttListener();
    currentAttListener = null;
  }
}

/** Reject Firestore snapshot callbacks from a stale tenant or generation. */
function attSnapshotMayMutateTenantState(sourceTenantId, listenerGeneration) {
  if (!sourceTenantId) return false;
  if (typeof window.emsAssertTenantBoundMutation === 'function') {
    return window.emsAssertTenantBoundMutation(sourceTenantId, listenerGeneration).ok === true;
  }
  if (typeof window.emsIsTenantTransitionInProgress === 'function'
    && window.emsIsTenantTransitionInProgress()) {
    return false;
  }
  if (listenerGeneration != null
    && typeof window.emsGetTenantGeneration === 'function'
    && window.emsGetTenantGeneration() !== listenerGeneration) {
    return false;
  }
  var active = typeof window.emsGetCanonicalTenantId === 'function'
    ? window.emsGetCanonicalTenantId()
    : getAttendanceTenantId();
  return !!(active && String(active) === String(sourceTenantId));
}

window.emsStartAttendanceSync = function () {
  if (typeof db === 'undefined' || !db) return;
  var tenantId = getAttendanceTenantId();
  if (!tenantId) return;
  stopAttendanceFirestoreSync();

  var listenerTenantId = tenantId;
  var listenerGeneration = typeof window.emsGetTenantGeneration === 'function'
    ? window.emsGetTenantGeneration()
    : 0;

  function attachCanonicalListener() {
    if (!attSnapshotMayMutateTenantState(listenerTenantId, listenerGeneration)) return;
    var canonCloudRef = attTimetableCanonicalCloudRef(db, tenantId);
    if (!canonCloudRef) return;
    attConfigUnsub = canonCloudRef.onSnapshot(function (doc) {
      if (!attSnapshotMayMutateTenantState(listenerTenantId, listenerGeneration)) return;
      var list = attTimetableListFromCloudSnapshot(doc);
      if (list == null) return;
      var bindingRepair = attCanonicalizeRemoteTimetableTeacherBindings(list);
      list = bindingRepair.list;
      var ownership = list.length ? attVerifyRemoteTimetableOwnership(list) : { ok: true };
      if (list.length && !ownership.ok) {
        console.warn('[EMS attendance] ignoring ModuleData timetable snapshot — teacher roster mismatch', ownership);
        return;
      }
      if (!attShouldAcceptRemoteTimetable(list, listenerTenantId)) {
        console.warn('[EMS attendance] ignoring ModuleData timetable snapshot — does not match this madrasa');
        return;
      }
      if (!list.length) {
        var localKeep = attReadAllTimetablePeriodsRaw();
        if (localKeep.length) return;
      }
      if (typeof window.emsOfflineWriteLocalSync === 'function') {
        window.emsOfflineWriteLocalSync('ems_att_periods', list, {
          tenantId: listenerTenantId,
          generation: listenerGeneration
        });
      } else {
        localStorage.setItem('ems_att_periods', JSON.stringify(list));
      }
      attRememberTrustedTimetable(listenerTenantId, list, 'snapshot');
      if (document.getElementById('settings-period-tbody')) window.loadPeriods();
    });
  }

  var migratePromise;
  if (typeof attIsOfflineMode === 'function' && attIsOfflineMode()) {
    attachCanonicalListener();
    migratePromise = Promise.resolve();
  } else if (typeof attMigrateLegacyCloudTimetablePeriods === 'function') {
    migratePromise = attMigrateLegacyCloudTimetablePeriods(tenantId, listenerTenantId, listenerGeneration)
      .then(function () { attachCanonicalListener(); })
      .catch(function () { attachCanonicalListener(); });
  } else {
    attachCanonicalListener();
    migratePromise = Promise.resolve();
  }

  if (window.currentAttState && window.currentAttState.dbKey && !attIsOfflineMode()) {
    setupLiveAttendanceListener(tenantId, window.currentAttState.dbKey);
  }
  return migratePromise;
};

window.emsStopAttendanceSync = stopAttendanceFirestoreSync;

(function attBindFirebaseAuthListener() {
  try {
    var fb = typeof window !== 'undefined' ? window.firebase : undefined;
    if (!fb || typeof fb.auth !== 'function') return;
    fb.auth().onAuthStateChanged(function (user) {
      if (!user) stopAttendanceFirestoreSync();
    });
  } catch (e) { /* offline — Firebase SDK not loaded */ }
})();

// --- Phase B0: local-first attendance sheet helpers ---
function attEmptyAttendanceRecord() {
  return { locked: false, records: {}, dailyLocks: {}, remarks: {}, late: {}, periodRecords: {} };
}

function attRecordTimestamp(rec) {
  if (!rec) return 0;
  if (rec.timestamp) return Number(rec.timestamp) || 0;
  if (rec.updatedAt) {
    var t = rec.updatedAt;
    if (typeof t === 'number') return t;
    if (t && typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t === 'string') return Date.parse(t) || 0;
  }
  return 0;
}

/** Drop null/empty day marks so cleared cells never reappear as status. */
function attPruneDayStatusMap(map) {
  if (!map || typeof map !== 'object') return {};
  var out = {};
  Object.keys(map).forEach(function (uid) {
    var days = map[uid];
    if (!days || typeof days !== 'object') return;
    var clean = {};
    Object.keys(days).forEach(function (day) {
      var v = days[day];
      if (v == null || v === '') return;
      clean[day] = v;
    });
    if (Object.keys(clean).length) out[uid] = clean;
  });
  return out;
}

function attNormalizeRecord(data) {
  var base = attEmptyAttendanceRecord();
  if (!data || typeof data !== 'object') return base;
  if (typeof window !== 'undefined'
      && typeof window.emsNormalizeAttendanceCloudDocument === 'function') {
    data = window.emsNormalizeAttendanceCloudDocument(data) || base;
  }
  return {
    locked: !!data.locked,
    records: attPruneDayStatusMap(data.records || {}),
    dailyLocks: data.dailyLocks || {},
    remarks: data.remarks || {},
    late: data.late || {},
    periodRecords: attPrunePeriodRecordsMap(data.periodRecords || {}),
    timestamp: attRecordTimestamp(data)
  };
}

/** True when a sheet has durable marks, locks, or a write timestamp — incl. periodRecords-only. */
function attHasMeaningfulAttendanceData(sheet) {
  if (!sheet || typeof sheet !== 'object') return false;
  if (attRecordTimestamp(sheet) > 0) return true;
  if (sheet.locked) return true;
  if (Object.keys(sheet.records || {}).length) return true;
  if (Object.keys(sheet.dailyLocks || {}).length) return true;
  if (Object.keys(sheet.periodRecords || {}).length) return true;
  if (Object.keys(sheet.remarks || {}).length) return true;
  if (Object.keys(sheet.late || {}).length) return true;
  return false;
}

function attReconcileAttendanceRecord(localRec, remoteRec) {
  if (!remoteRec) return attNormalizeRecord(localRec);
  if (!localRec) return attNormalizeRecord(remoteRec);
  var localTs = attRecordTimestamp(localRec);
  var remoteTs = attRecordTimestamp(remoteRec);
  if (remoteTs >= localTs) return attNormalizeRecord(remoteRec);
  // A genuinely newer offline/local mutation stays authoritative until cloud catches up.
  return attNormalizeRecord(localRec);
}

function attApplyAttendanceState(month, type, classId, period, keys, savedRecord, targets) {
  var cloudDocId = typeof keys === 'string' ? keys : keys.cloudDocId;
  var localKey = typeof keys === 'string' ? keys : keys.localKey;
  var rec = attNormalizeRecord(savedRecord);
  var writeTs = rec.timestamp || 0;
  if (writeTs) _attLastLocalWriteTs = writeTs;
  window.currentAttState = {
    month: month,
    type: type,
    classId: classId,
    period: period,
    dbKey: cloudDocId,
    localKey: localKey,
    locked: rec.locked,
    records: rec.records || {},
    dailyLocks: rec.dailyLocks || {},
    remarks: rec.remarks || {},
    late: rec.late || {},
    periodRecords: rec.periodRecords || {},
    targetUsers: targets || [],
    registerRowPage: 1,
    _localWriteTs: writeTs
  };
  if (typeof window.attSaveStatusSetSmartDoc === 'function') {
    window.attSaveStatusSetSmartDoc(cloudDocId);
  }
  if (typeof window.attSaveStatusBoot === 'function') window.attSaveStatusBoot();
}

function attCacheAttendanceFromRemote(cloudDocId, data, localKey) {
  localKey = localKey || (window.currentAttState && window.currentAttState.localKey) || cloudDocId;
  if (typeof window.emsOfflineCacheAttendanceFromRemote === 'function') {
    return window.emsOfflineCacheAttendanceFromRemote(cloudDocId, data, { localKey: localKey });
  }
  return Promise.resolve(false);
}

function attFetchAttendanceSheet(uid, keys) {
  var cloudDocId = typeof keys === 'string' ? keys : keys.cloudDocId;
  var localKey = typeof keys === 'string' ? keys : keys.localKey;
  var empty = attEmptyAttendanceRecord();
  var cacheFn = typeof window.emsOfflineGetCachedAttendance === 'function'
    ? window.emsOfflineGetCachedAttendance(cloudDocId, { localKey: localKey })
    : Promise.resolve(null);
  return cacheFn.then(function (cached) {
    if (cached) return attNormalizeRecord(cached);
    if (attIsOfflineMode()) return empty;
    var fsDb = attGetFirestoreDb();
    if (!fsDb) return empty;
    return attTenantSubCol(fsDb, uid, 'Attendance').doc(cloudDocId)
      .get({ source: 'default' })
      .then(function (doc) {
        var data = doc.exists ? attNormalizeRecord(doc.data()) : empty;
        if (doc.exists) attCacheAttendanceFromRemote(cloudDocId, data, localKey);
        return data;
      })
      .catch(function () { return empty; });
  });
}

function attBackgroundReconcile(uid, keys, localRec) {
  if (attIsOfflineMode()) return;
  var cloudDocId = typeof keys === 'string' ? keys : keys.cloudDocId;
  var localKey = typeof keys === 'string' ? keys : keys.localKey;
  var fsDb = attGetFirestoreDb();
  if (!fsDb) return;
  if (localRec && localRec.records && Object.keys(localRec.records).length) {
    var localTs = attRecordTimestamp(localRec);
    if (localTs > 0) { /* keep local when offline-written */ }
  }
  attTenantSubCol(fsDb, uid, 'Attendance').doc(cloudDocId)
    .get({ source: 'default' })
    .then(function (doc) {
      if (!window.currentAttState || window.currentAttState.dbKey !== cloudDocId) return;
      if (!doc.exists) return;
      var remote = doc.data();
      if (!attHasMeaningfulAttendanceData(remote)) return;
      var localTs = attRecordTimestamp(localRec);
      var remoteTs = attRecordTimestamp(remote);
      if (remoteTs < localTs) return;
      var merged = attReconcileAttendanceRecord(localRec, remote);
      attCacheAttendanceFromRemote(cloudDocId, merged, localKey);
      attApplyAttendanceState(
        window.currentAttState.month,
        window.currentAttState.type,
        window.currentAttState.classId,
        window.currentAttState.period,
        { cloudDocId: cloudDocId, localKey: localKey },
        merged,
        window.currentAttState.targetUsers
      );
      buildSmartRegister(window.currentAttState.month, window.getFilteredUsers());
      window.showToast('کلاؤڈ سے تازہ حاضری لاگو کر دی گئی', 'info');
    })
    .catch(function () { /* optional background sync */ });
}

var ATT_LEGACY_PERIOD_MERGE_KEY = 'att_legacy_period_merged_v1';

function attReadLegacyPeriodMergeLog() {
  try {
    var raw = typeof window.emsSafeLocalGet === 'function'
      ? window.emsSafeLocalGet(ATT_LEGACY_PERIOD_MERGE_KEY)
      : localStorage.getItem(ATT_LEGACY_PERIOD_MERGE_KEY);
    var parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (eLog) {
    return {};
  }
}

/** A merged sheet is never re-adopted, so later clears cannot be resurrected. */
function attMarkLegacyPeriodSheetsMerged(mergedKeys) {
  if (!mergedKeys || !mergedKeys.length) return;
  try {
    var log = attReadLegacyPeriodMergeLog();
    mergedKeys.forEach(function (key) { if (key) log[key] = 1; });
    localStorage.setItem(ATT_LEGACY_PERIOD_MERGE_KEY, JSON.stringify(log));
  } catch (eSet) { /* migration log is best-effort */ }
}

/** Legacy per-hour sheet keys for the same register (period != all), not yet merged. */
function attLegacyPeriodSheetKeys(allKeys, month, type, classId) {
  var head = '_' + month + '_' + type + '_' + (classId || '') + '_';
  var merged = attReadLegacyPeriodMergeLog();
  return (allKeys || []).filter(function (key) {
    if (!key || key.indexOf('att_rec_') !== 0) return false;
    if (merged[key]) return false;
    var idx = key.indexOf(head);
    if (idx < 0) return false;
    var periodId = key.slice(idx + head.length);
    return !!periodId && periodId !== 'all';
  });
}

/** Teacher/staff legacy keys with any classId or per-period sheet except the canonical __all sheet. */
function attLegacyTeacherStaffSheetKeys(allKeys, month, type, canonicalLocalKey) {
  var merged = attReadLegacyPeriodMergeLog();
  var typeMarker = '_' + month + '_' + type + '_';
  return (allKeys || []).filter(function (key) {
    if (!key || key.indexOf('att_rec_') !== 0) return false;
    if (merged[key]) return false;
    if (canonicalLocalKey && key === canonicalLocalKey) return false;
    var idx = key.indexOf(typeMarker);
    if (idx < 0) return false;
    var tail = key.slice(idx + typeMarker.length);
    return tail !== '_all';
  });
}

function attMergeLegacyFieldMaps(canon, legacy, field, adoptedCounter) {
  Object.keys(legacy[field] || {}).forEach(function (rowUid) {
    Object.keys(legacy[field][rowUid] || {}).forEach(function (day) {
      var val = legacy[field][rowUid][day];
      if (val == null || val === '') return;
      if (!canon[field][rowUid]) canon[field][rowUid] = {};
      if (Object.prototype.hasOwnProperty.call(canon[field][rowUid], day)) return;
      canon[field][rowUid][day] = val;
      adoptedCounter.count += 1;
    });
  });
}

function attMergeLegacyPeriodRecords(canon, legacy, adoptedCounter) {
  Object.keys(legacy.periodRecords || {}).forEach(function (rowUid) {
    Object.keys(legacy.periodRecords[rowUid] || {}).forEach(function (day) {
      var pmap = legacy.periodRecords[rowUid][day] || {};
      Object.keys(pmap).forEach(function (pid) {
        if (pmap[pid] == null || pmap[pid] === '') return;
        if (!canon.periodRecords[rowUid]) canon.periodRecords[rowUid] = {};
        if (!canon.periodRecords[rowUid][day]) canon.periodRecords[rowUid][day] = {};
        if (canon.periodRecords[rowUid][day][pid] != null) return;
        canon.periodRecords[rowUid][day][pid] = pmap[pid];
        adoptedCounter.count += 1;
      });
    });
  });
}

/**
 * Fold legacy per-hour sheets into the canonical sheet so a reopened register shows
 * the same marks the dashboard aggregates from every sheet of that month.
 */
function attAdoptLegacyPeriodSheets(keys, month, type, classId) {
  if (!attIsCanonicalUnified()) return Promise.resolve(null);
  if (typeof window.emsOfflineListAttendanceKeysAsync !== 'function') return Promise.resolve(null);

  var scope = attNormalizeStorageScope(month, type, classId, 'all');
  month = scope.month;
  type = scope.type;
  classId = scope.classId;

  var readSheet = typeof window.emsAttReadSheetByKeyAsync === 'function'
    ? window.emsAttReadSheetByKeyAsync
    : function (key) { return Promise.resolve(attReadSheetLocal(key)); };

  return window.emsOfflineListAttendanceKeysAsync(month).then(function (allKeys) {
    var legacyKeys = (type === 'teachers' || type === 'staff')
      ? attLegacyTeacherStaffSheetKeys(allKeys, month, type, keys.localKey || keys.cloudDocId)
      : attLegacyPeriodSheetKeys(allKeys, month, type, classId);
    if (!legacyKeys.length) return null;
    return Promise.all(legacyKeys.map(function (key) {
      return readSheet(key).then(function (sheet) {
        return { key: key, sheet: sheet };
      });
    }));
  }).then(function (legacySheets) {
    if (!legacySheets || !legacySheets.length) return null;

    var canon = attNormalizeRecord(
      attReadSheetLocal(keys.localKey || keys.cloudDocId) || attEmptyAttendanceRecord()
    );
    var canonicalHadMeaningfulData = attHasMeaningfulAttendanceData(canon);
    var canonicalHadPeriodCoverage = Object.keys(canon.periodRecords || {}).length > 0;
    var symbols = attGetAttSymbols();
    var adoptedCounter = { count: 0 };

    // When two historical sheets cover the same cell, adopt the newest source first.
    legacySheets.sort(function (a, b) {
      return attRecordTimestamp(b && b.sheet) - attRecordTimestamp(a && a.sheet);
    });

    legacySheets.forEach(function (entry) {
      var key = entry.key;
      var legacy = attNormalizeRecord(entry.sheet);
      var periodId = key.slice(key.lastIndexOf('_') + 1);
      if (!periodId) return;

      if (periodId === 'all') {
        if (!canonicalHadMeaningfulData) {
          attMergeLegacyFieldMaps(canon, legacy, 'records', adoptedCounter);
          ['remarks', 'late'].forEach(function (field) {
            attMergeLegacyFieldMaps(canon, legacy, field, adoptedCounter);
          });
        }
        if (!canonicalHadPeriodCoverage) {
          attMergeLegacyPeriodRecords(canon, legacy, adoptedCounter);
        }
        return;
      }

      // Once a canonical sheet has period coverage, absent cells are intentional
      // clears/not-marked values; old per-period documents must never revive them.
      if (canonicalHadPeriodCoverage) return;

      Object.keys(legacy.records || {}).forEach(function (rowUid) {
        Object.keys(legacy.records[rowUid] || {}).forEach(function (day) {
          var status = legacy.records[rowUid][day];
          if (status == null || status === '') return;
          if (!canon.periodRecords[rowUid]) canon.periodRecords[rowUid] = {};
          if (!canon.periodRecords[rowUid][day]) canon.periodRecords[rowUid][day] = {};
          if (canon.periodRecords[rowUid][day][periodId] != null) return;
          canon.periodRecords[rowUid][day][periodId] = status;
          adoptedCounter.count += 1;
        });
      });

      attMergeLegacyPeriodRecords(canon, legacy, adoptedCounter);

      ['remarks', 'late'].forEach(function (field) {
        Object.keys(legacy[field] || {}).forEach(function (rowUid) {
          Object.keys(legacy[field][rowUid] || {}).forEach(function (day) {
            var val = legacy[field][rowUid][day];
            if (!val) return;
            if (!canon[field][rowUid]) canon[field][rowUid] = {};
            if (canon[field][rowUid][day]) return;
            canon[field][rowUid][day] = val;
            adoptedCounter.count += 1;
          });
        });
      });
    });

    if (!adoptedCounter.count) {
      attMarkLegacyPeriodSheetsMerged(legacySheets.map(function (e) { return e.key; }));
      return null;
    }

    var dayLabels = [symbols.P, symbols.A, symbols.L];
    Object.keys(canon.periodRecords).forEach(function (rowUid) {
      Object.keys(canon.periodRecords[rowUid] || {}).forEach(function (day) {
        if (!canon.records[rowUid]) canon.records[rowUid] = {};
        if (canon.records[rowUid][day] != null && canon.records[rowUid][day] !== '') return;
        var rolled = attRollupPeriodDayStatus(canon.periodRecords[rowUid][day] || {}, symbols);
        // Only an unambiguous P/A/L becomes the day rollup; partial days stay for the
        // register to compute against that weekday's real timetable.
        if (rolled && dayLabels.indexOf(rolled) >= 0) canon.records[rowUid][day] = rolled;
      });
    });

    var payload = {
      locked: !!canon.locked,
      records: attPruneDayStatusMap(canon.records || {}),
      dailyLocks: canon.dailyLocks || {},
      remarks: canon.remarks || {},
      late: canon.late || {},
      periodRecords: attPrunePeriodRecordsMap(canon.periodRecords || {}),
      timestamp: attMarkLocalWrite()
    };
    attPersistSheetPayload(keys, payload, { quiet: true, immediateCloud: true });
    if (typeof console !== 'undefined' && console.info) {
      console.info('[EMS attendance] adopted legacy sheets into canonical register', {
        month: month,
        type: type,
        canonicalKey: keys.localKey || keys.cloudDocId,
        legacyKeys: legacySheets.map(function (e) { return e.key; }),
        adoptedCells: adoptedCounter.count
      });
    }
    attMarkLegacyPeriodSheetsMerged(legacySheets.map(function (e) { return e.key; }));
    return payload;
  }).catch(function () { return null; });
}

function attLoadRegisterLocalFirst(uid, targets, month, type, classId, period, loadCtx) {
  var scope = attNormalizeStorageScope(month, type, classId, period);
  var keys = attResolveSheetKeys(scope.month, scope.type, scope.classId, scope.period);
  attSaveLastSession(scope.month, scope.type, scope.classId, scope.period);

  function openRegister(savedRecord, toastMsg, toastType) {
    if (!attRegisterLoadIsCurrent(loadCtx)) return false;
    var rec = attNormalizeRecord(savedRecord);
    if (!attIsCanonicalUnified() && type === 'students' && period && period !== 'all') {
      rec = attOverlayCanonicalPeriodMarks(month, classId, period, rec);
    }
    attApplyAttendanceState(month, type, classId, period, keys, rec, targets);
    buildSmartRegisterImmediate(month, targets);
    if (!attIsOfflineMode()) {
      setupLiveAttendanceListener(uid, keys.cloudDocId);
    }
    if (toastMsg && typeof window.showToast === 'function') {
      window.showToast(toastMsg, toastType || 'success');
    }
    return true;
  }

  function fetchFromCloud(localRec) {
    if (!attRegisterLoadIsCurrent(loadCtx)) return Promise.resolve({ ok: false, stale: true });
    var fsDb = attGetFirestoreDb();
    if (attIsOfflineMode() || !fsDb) {
      if (localRec) {
        openRegister(localRec, '📴 آف لائن — لوکل ڈیٹا', 'warning');
        return Promise.resolve({ ok: true, local: true });
      }
      openRegister(attEmptyAttendanceRecord(), 'آف لائن — خالی رجسٹر', 'warning');
      return Promise.resolve({ ok: true, local: true, empty: true });
    }
    if (!localRec) {
      window.showToast('حاضری کا رجسٹر کلاؤڈ سے لوڈ ہو رہا ہے...', 'warning');
    }
    return attTenantSubCol(fsDb, uid, 'Attendance').doc(keys.cloudDocId)
      .get({ source: 'default' })
      .then(function (doc) {
        if (!attRegisterLoadIsCurrent(loadCtx)) return { ok: false, stale: true };
        var remote = doc.exists ? doc.data() : null;
        var merged = attReconcileAttendanceRecord(localRec, remote);
        attCacheAttendanceFromRemote(keys.cloudDocId, merged, keys.localKey);
        var msg = localRec
          ? (attRecordTimestamp(remote) > attRecordTimestamp(localRec) ? 'لوکل + کلاؤڈ ہم آہنگ' : 'لوکل کیش سے لوڈ')
          : (remote ? 'کلاؤڈ سے لوڈ ہو گیا' : 'نیا خالی رجسٹر');
        var typ = localRec ? 'success' : (remote ? 'info' : 'warning');
        return { ok: openRegister(merged, msg, typ), cloud: !!remote };
      })
      .catch(function (err) {
        if (!attRegisterLoadIsCurrent(loadCtx)) return { ok: false, stale: true };
        if (localRec) {
          openRegister(localRec, '📴 آف لائن — لوکل ڈیٹا', 'warning');
          return { ok: true, local: true };
        } else {
          window.showToast('ڈیٹا لوڈ کرنے میں مسئلہ: ' + err.message, 'error');
          return { ok: false, error: err && err.message ? err.message : String(err) };
        }
      });
  }

  var monthFresh = typeof window.emsAttEnsureMonthFresh === 'function'
    ? window.emsAttEnsureMonthFresh(scope.month)
    : Promise.resolve({ ok: false, localOnly: true });
  var cachePromise = monthFresh.then(function () {
    return attAdoptLegacyPeriodSheets(keys, scope.month, scope.type, scope.classId);
  }).then(function (adopted) {
    if (adopted) return adopted;
    return typeof window.emsOfflineGetCachedAttendance === 'function'
      ? window.emsOfflineGetCachedAttendance(keys.cloudDocId, { localKey: keys.localKey })
      : null;
  });

  return cachePromise.then(function (localData) {
    if (!attRegisterLoadIsCurrent(loadCtx)) return { ok: false, stale: true };
    var localRec = localData ? attNormalizeRecord(localData) : null;
    // Local sheet with meaningful data (incl. fully cleared w/ timestamp) is SSOT.
    if (localRec && attHasMeaningfulAttendanceData(localRec)) {
      openRegister(localRec, 'حاضری کا رجسٹر لوکل کیش سے لوڈ ہو گیا', 'success');
      attBackgroundReconcile(uid, keys, localRec);
      return { ok: true, local: true };
    }
    return fetchFromCloud(localRec);
  }).catch(function (err) {
    if (attRegisterLoadIsCurrent(loadCtx) && typeof window.showToast === 'function') {
      window.showToast('رجسٹر لوڈ ناکام — دوبارہ کوشش کریں', 'error');
    }
    return { ok: false, error: err && err.message ? err.message : String(err) };
  });
}

function attCollectTargetsFromRepoRelaxed(type, classId) {
  var wantType = type === 'students' ? 'student' : type === 'teachers' ? 'teacher' : 'staff';
  var targets = [];
  if (typeof window.emsRegRepoForEach !== 'function') return targets;
  window.emsRegRepoForEach(function (u) {
    if (!u || !attGetUserId(u)) return;
    if (type === 'students' && classId) {
      if (!attClassMatches(u, classId)) return;
    } else if (!attUserMatchesType(u, wantType)) {
      return;
    }
    targets.push(u);
  });
  return attFilterEligibleUsers(attMergeUniqueById(targets));
}

function attCollectTargetsFromRepo(type, classId) {
  var wantType = type === 'students' ? 'student' : type === 'teachers' ? 'teacher' : 'staff';
  var targets = [];
  var repoCount = typeof window.emsRegRepoGetCount === 'function' ? window.emsRegRepoGetCount() : 0;

  if (repoCount > 0 && typeof window.emsRegRepoForEach === 'function') {
    window.emsRegRepoForEach(function (u) {
      if (!u || !attGetUserId(u) || !attUserMatchesType(u, wantType)) return;
      if (type === 'students' && classId && !attClassMatches(u, classId)) return;
      targets.push(u);
    });
    targets = attApplyDeptFilter(targets);
  } else {
    var users = attGetUsers();
    targets = users.filter(function (u) { return attUserMatchesType(u, wantType); });
    if (type === 'students' && classId) {
      targets = targets.filter(function (u) { return attClassMatches(u, classId); });
    }
  }

  if (!targets.length && type === 'students' && classId) {
    targets = attCollectTargetsFromRepoRelaxed(type, classId);
  }

  targets = attFilterEligibleUsers(attMergeUniqueById(targets));
  var limit = attResolveRosterLimit();
  if (limit > 0 && targets.length > limit) targets = targets.slice(0, limit);
  return targets;
}

function attResolveTargetUsers(type, classId) {
  var resolve = function () {
    var targets = attCollectTargetsFromRepo(type, classId);
    if (targets.length) return Promise.resolve(targets);

    if (type === 'students' && classId && typeof window.emsFetchStudentsLocalFirst === 'function') {
      return window.emsFetchStudentsLocalFirst(classId).then(function (rows) {
        rows = attFilterEligibleUsers(attMergeUniqueById(rows || []));
        if (rows.length) return rows;
        if (typeof window.emsRegRepoFetchClassRoster === 'function') {
          return window.emsRegRepoFetchClassRoster(classId, { limit: attResolveRosterLimit() }).then(function (remoteRows) {
            remoteRows = attFilterEligibleUsers(attMergeUniqueById(remoteRows || []));
            return remoteRows.length ? remoteRows : attCollectTargetsFromRepoRelaxed(type, classId);
          });
        }
        return attCollectTargetsFromRepoRelaxed(type, classId);
      });
    }
    if (type === 'teachers' && typeof window.emsFetchStaffLocalFirst === 'function') {
      return window.emsFetchStaffLocalFirst('teacher').then(function (rows) {
        rows = attFilterEligibleUsers(attMergeUniqueById(rows || []));
        return rows.length ? rows : attCollectTargetsFromRepoRelaxed(type, classId);
      });
    }
    if (type === 'staff' && typeof window.emsFetchStaffLocalFirst === 'function') {
      return window.emsFetchStaffLocalFirst('staff').then(function (rows) {
        rows = attFilterEligibleUsers(attMergeUniqueById(rows || []));
        return rows.length ? rows : attCollectTargetsFromRepoRelaxed(type, classId);
      });
    }
    return Promise.resolve(attCollectTargetsFromRepoRelaxed(type, classId));
  };
  if (typeof window.emsEnsureRepositoryReady === 'function') {
    return window.emsEnsureRepositoryReady().then(function () { return resolve(); }).catch(function () { return resolve(); });
  }
  return resolve();
}

function setupLiveAttendanceListener(uid, cloudDocId) {
    if (currentAttListener) {
      currentAttListener();
      currentAttListener = null;
    }
    if (attIsOfflineMode()) return;
    var fsDb = attGetFirestoreDb();
    if (!fsDb || !uid || !cloudDocId) return;

    var listenerTenantId = uid;
    var listenerGeneration = typeof window.emsGetTenantGeneration === 'function'
      ? window.emsGetTenantGeneration()
      : 0;

    currentAttListener = attTenantDoc(fsDb, uid)
      .collection('Attendance').doc(cloudDocId).onSnapshot((doc) => {
        if (!attSnapshotMayMutateTenantState(listenerTenantId, listenerGeneration)) return;
        if(doc.exists) {
            let data = doc.data();
            if (!window.currentAttState || window.currentAttState.dbKey !== cloudDocId) return;
            if (!attShouldApplyRemoteSnapshot(data)) {
              attRefreshLockChrome();
              return;
            }
            var lk = window.currentAttState.localKey || cloudDocId;
            attCacheAttendanceFromRemote(cloudDocId, data, lk);
            let normalized = attNormalizeRecord(data);
            window.currentAttState.locked = normalized.locked;
            window.currentAttState.records = normalized.records;
            window.currentAttState.dailyLocks = normalized.dailyLocks;
            window.currentAttState.remarks = normalized.remarks;
            window.currentAttState.late = normalized.late;
            window.currentAttState.periodRecords = normalized.periodRecords || {};
            
            if(document.getElementById('smart-register-tbody') && document.getElementById('smart-register-tbody').innerHTML !== '') {
                attQuickRefreshRegister();
            }
        }
    });
}

function attHasValidRegisterSession() {
  var typeSel = document.getElementById('att-reg-type');
  var monthInput = document.getElementById('att-reg-month');
  var clsSel = document.getElementById('att-reg-class');
  if (!monthInput || !monthInput.value) return false;
  var type = typeSel ? typeSel.value : 'students';
  if (type === 'students') {
    return !!(clsSel && clsSel.value);
  }
  return true;
}

function attTryAutoLoadRegister() {
  if (!attPanelIsVisible('att-smart-register')) return;
  if (!attHasValidRegisterSession()) return;
  var tbody = document.getElementById('smart-register-tbody');
  if (tbody && tbody.innerHTML.trim() !== '' && window.currentAttState && window.currentAttState.month) {
    return;
  }
  var loadBtn = document.getElementById('btn-load-smart-register');
  if (loadBtn) loadBtn.click();
}
window.attTryAutoLoadRegister = attTryAutoLoadRegister;

function attReplayCurrentTabBoot() {
  var tabId = window._attCurrentTabId;
  if (!tabId) return;
  if (typeof window.emsReplayAttTabBoot === 'function') {
    window.emsReplayAttTabBoot(tabId);
  }
}

// ================== 1. نیویگیشن اور انیشلائزیشن ==================
function attRegisterTabBootHandlers() {
  if (typeof window.emsRegisterAttTabBoot !== 'function') return;
  window.emsRegisterAttTabBoot('att-dashboard-panel', function () {
    if (typeof window.renderAttDashboard === 'function') window.renderAttDashboard();
  });
  window.emsRegisterAttTabBoot('att-smart-register', function () {
    var afterReady = function () {
      loadAttDropdowns(false);
      attTryAutoLoadRegister();
    };
    if (typeof window.emsEnsureRepositoryReady === 'function') {
      window.emsEnsureRepositoryReady().then(afterReady).catch(afterReady);
    } else {
      afterReady();
    }
  });
  window.emsRegisterAttTabBoot('att-collective-register', function () {
    loadAttDropdowns(false);
    if (typeof window.attCollectiveBoot === 'function') window.attCollectiveBoot();
  });
  window.emsRegisterAttTabBoot('att-master-settings', function () {
    loadSettingsData();
    loadPeriods();
  });
  window.emsRegisterAttTabBoot('att-holiday-management', function () {
    loadHolidays();
  });
  window.emsRegisterAttTabBoot('att-event-register', function () {
    evtEnsureParticipantSearchBound();
    if (typeof window.renderSavedEvents === 'function') window.renderSavedEvents();
  });
  window.emsRegisterAttTabBoot('att-timetable', function () {
    if (!_attDropdownReady) loadAttDropdowns();
    if (typeof loadSettingsData === 'function') loadSettingsData();
    function afterLibReady() {
      var migrateResult = attMigratePeriodBooksToLibrary();
      if (migrateResult && migrateResult.added > 0 && typeof window.showToast === 'function') {
        window.showToast(
          migrateResult.added + ' کتاب/مضمون مرکزی کتب خانے میں شامل ہو گئیں (امتحانات و نصاب — تکرار کے بغیر)',
          'success'
        );
      }
      try { attSyncLibraryToCurriculum({ skipUi: true }); } catch (eCur) { /* ignore */ }
      if (typeof window.exmSyncTimetableBooksToMasterSheet === 'function') {
        try { window.exmSyncTimetableBooksToMasterSheet({ silent: true }); } catch (eTpl) { /* ignore */ }
      }
      var tenantId = typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null;
      var generation = typeof window.emsGetTenantGeneration === 'function'
        ? window.emsGetTenantGeneration()
        : 0;
      var healChain = Promise.resolve();
      if (tenantId && typeof attMigrateLegacyCloudTimetablePeriods === 'function') {
        healChain = attMigrateLegacyCloudTimetablePeriods(tenantId, tenantId, generation);
      }
      healChain
        .then(function () {
          if (tenantId && typeof attRunTimetableContaminationPass === 'function') {
            return attRunTimetableContaminationPass(tenantId);
          }
        })
        .catch(function () { /* ignore */ })
        .then(function () {
          if (typeof window.renderTimetable === 'function') window.renderTimetable();
        });
    }
    if (typeof window.curEnsureLibraryReady === 'function') {
      window.curEnsureLibraryReady().then(afterLibReady).catch(afterLibReady);
    } else if (typeof window.emsDurableEnsureKey === 'function') {
      Promise.resolve(window.emsDurableEnsureKey(ATT_LIB_BOOKS_KEY))
        .then(function () { return window.emsDurableEnsureKey(ATT_CUR_PLANS_KEY); })
        .then(afterLibReady)
        .catch(afterLibReady);
    } else {
      afterLibReady();
    }
  });
  window.emsRegisterAttTabBoot('att-reports-panel', function () {
    var toEl = document.getElementById('rep-att-to');
    var fromEl = document.getElementById('rep-att-from');
    var today = new Date().toISOString().split('T')[0];
    if (toEl && !toEl.value) toEl.value = today;
    if (fromEl && !fromEl.value) {
      var d = new Date();
      d.setDate(d.getDate() - 30);
      fromEl.value = d.toISOString().split('T')[0];
    }
  });
  window.emsRegisterAttTabBoot('att-audit-recycle', function () {
    loadAttAudit();
    loadRecycleBin();
  });
}
attRegisterTabBootHandlers();
attReplayCurrentTabBoot();

// حاضری ماڈیول کھلتے ہی ڈیفالٹ ڈیش بورڈ
window.emsOpenAttendance = function () {
  if (typeof window.emsStartAttendanceSync === 'function') {
    window.emsStartAttendanceSync();
  }
  if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();

  var dashBtn = document.querySelector('#att-ribbon-menu [onclick*="att-dashboard-panel"]');
  if (typeof window.switchAttTab === 'function') {
    window.switchAttTab('att-dashboard-panel', dashBtn);
  }

  var boot = function () {
    if (typeof window.emsDeferModuleWork === 'function') {
      window.emsDeferModuleWork(function () {
        loadAttDropdowns(true);
        attRestoreLastSession();
        setTimeout(attTryAutoLoadRegister, 250);
      }, { idle: true, timeout: 200 });
    } else {
      loadAttDropdowns(true);
    }
  };
  if (typeof window.emsEnsureRepositoryReady === 'function') {
    window.emsEnsureRepositoryReady().then(boot).catch(boot);
  } else {
    boot();
  }
};

function loadAttDropdowns(force) {
  var cacheGen = typeof window.emsRegRepoGetCacheGeneration === 'function'
    ? window.emsRegRepoGetCacheGeneration()
    : 0;
  var repoCount = typeof window.emsRegRepoGetCount === 'function' ? window.emsRegRepoGetCount() : 0;

  if (!force && _attDropdownReady && _attDropdownCacheGen === cacheGen && _attDropdownRepoCount === repoCount) return;

  var classes = attListAttendanceClasses();

  const classSelect = document.getElementById('att-reg-class');
  const modalClassSelect = document.getElementById('new-period-class');

  let classOptions = '<option value="">درجہ منتخب کریں...</option>' + classes.map((c) => `<option value="${c}">${c}</option>`).join('');
  if (classSelect) { let curr = classSelect.value; classSelect.innerHTML = classOptions; classSelect.value = curr; }
  if (modalClassSelect) { let curr2 = modalClassSelect.value; modalClassSelect.innerHTML = classOptions; modalClassSelect.value = curr2; }
  var colOne = document.getElementById('att-col-class-one');
  if (colOne) {
    var currCol = colOne.value;
    colOne.innerHTML = classOptions;
    if (currCol) colOne.value = currCol;
  }
  if (typeof window.attCollectiveFillClasses === 'function') {
    window.attCollectiveFillClasses(classes);
  }

  attPopulateRegisterPeriodSelect();
  attBindSmartRegisterSearch();
  var typeSelect = document.getElementById('att-reg-type');
  if (typeSelect && !_attTypeSelectBound) {
    _attTypeSelectBound = true;
    typeSelect.addEventListener('change', function () {
      var t = typeSelect.value;
      if (t === 'teachers' || t === 'staff') {
        var perSel = document.getElementById('att-reg-period');
        if (perSel) perSel.value = 'all';
        attPopulateRegisterPeriodSelect();
      }
    });
  }
  if (classSelect && !_attClassSelectBound) {
    _attClassSelectBound = true;
    classSelect.addEventListener('change', function () {
      // A class is the source of truth: never offer teachers/periods from another class.
      attPopulateRegisterPeriodSelect({ resetInvalid: true });
    });
  }

  const monthInput = document.getElementById('att-reg-month');
  if (monthInput && !monthInput.value) monthInput.value = new Date().toISOString().substring(0, 7);

  _attDropdownReady = true;
  _attDropdownCacheGen = cacheGen;
  _attDropdownRepoCount = repoCount;
}

function attReadRegisterPeriods() {
  return attReadTimetablePeriods();
}

/** Keep the smart-register period picker linked to its selected class. */
function attPopulateRegisterPeriodSelect(opts) {
  opts = opts || {};
  var periodSelect = document.getElementById('att-reg-period');
  var classSelect = document.getElementById('att-reg-class');
  if (!periodSelect) return;

  var selectedPeriod = String(periodSelect.value || 'all');
  var selectedClass = String(classSelect && classSelect.value || '').trim();
  var periods = attReadRegisterPeriods();
  var visiblePeriods = selectedClass
    ? periods.filter(function (p) { return String(p.className || '').trim() === selectedClass; })
    : periods;

  periodSelect.innerHTML = '';
  var allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'تمام دن / اجمالی حاضری';
  periodSelect.appendChild(allOpt);

  visiblePeriods.forEach(function (p) {
    if (!p || !p.id) return;
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.setAttribute('data-class', p.className || '');
    opt.textContent = '[' + (p.teacherName || 'استاد نامعلوم') + '] - '
      + (p.className || 'درجہ نامعلوم') + ' - ' + (p.bookName || '') + ' (' + (p.name || '') + ')';
    periodSelect.appendChild(opt);
  });

  periodSelect.value = Array.prototype.some.call(periodSelect.options, function (o) {
    return o.value === selectedPeriod;
  }) ? selectedPeriod : 'all';

  if (!_attPeriodSelectBound) {
    _attPeriodSelectBound = true;
    periodSelect.addEventListener('change', function () {
      var selectedOpt = this.options[this.selectedIndex];
      var autoClass = selectedOpt && selectedOpt.getAttribute('data-class');
      if (autoClass && classSelect && classSelect.value !== autoClass) {
        classSelect.value = autoClass;
        attPopulateRegisterPeriodSelect();
        periodSelect.value = selectedOpt.value;
      }
    });
  }
}

function attRenderSmartRegisterSearchResults(query) {
  var results = document.getElementById('att-reg-quick-search-results');
  if (!results) return;
  var needle = String(query || '').trim().toLocaleLowerCase();
  results.innerHTML = '';
  if (!needle) {
    results.hidden = true;
    return;
  }

  var matches = [];
  attListAttendanceClasses().forEach(function (className) {
    if (String(className).toLocaleLowerCase().indexOf(needle) >= 0) {
      matches.push({ kind: 'class', className: className, label: 'درجہ: ' + className });
    }
  });
  attReadRegisterPeriods().forEach(function (period) {
    var text = [period.teacherName, period.className, period.bookName, period.name].join(' ').toLocaleLowerCase();
    if (text.indexOf(needle) >= 0) {
      matches.push({
        kind: 'period',
        className: period.className || '',
        periodId: period.id,
        label: 'استاد: ' + (period.teacherName || 'نامعلوم') + ' — '
          + (period.className || 'درجہ نامعلوم') + ' — ' + (period.bookName || period.name || 'پیریڈ')
      });
    }
  });

  matches.slice(0, 12).forEach(function (match) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'smart-register-search-result';
    button.textContent = match.label;
    button.addEventListener('click', function () {
      var classSelect = document.getElementById('att-reg-class');
      var periodSelect = document.getElementById('att-reg-period');
      var typeSelect = document.getElementById('att-reg-type');
      if (typeSelect) typeSelect.value = 'students';
      if (classSelect && match.className) classSelect.value = match.className;
      attPopulateRegisterPeriodSelect();
      if (periodSelect) periodSelect.value = match.kind === 'period' ? match.periodId : 'all';
      var input = document.getElementById('att-reg-quick-search');
      if (input) input.value = '';
      results.hidden = true;
    });
    results.appendChild(button);
  });

  if (!matches.length) {
    var empty = document.createElement('p');
    empty.className = 'smart-register-search-empty';
    empty.textContent = 'کوئی درجہ یا استاد نہیں ملا';
    results.appendChild(empty);
  }
  results.hidden = false;
}

function attBindSmartRegisterSearch() {
  var input = document.getElementById('att-reg-quick-search');
  if (!input || _attRegisterQuickSearchBound) return;
  _attRegisterQuickSearchBound = true;
  input.addEventListener('input', attDebounce(function () {
    attRenderSmartRegisterSearchResults(input.value);
  }, ATT_SEARCH_DEBOUNCE_MS));
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') attRenderSmartRegisterSearchResults('');
  });
}

// ================== 2. ماسٹر سیٹنگز (ادارہ اور پیریڈز) ==================
function attSetActionButtonBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    if (!btn._attPrevHtml) btn._attPrevHtml = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (busyLabel) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + busyLabel;
  } else {
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
    if (btn._attPrevHtml) {
      btn.innerHTML = btn._attPrevHtml;
      delete btn._attPrevHtml;
    }
  }
}

function attRequirePersistSuccess(res) {
  if (!res || res.ok === false) {
    var err = new Error((res && (res.reason || res.error)) || 'local_write_failed');
    err.result = res || null;
    throw err;
  }
  return res;
}

document
  .getElementById('btn-save-basic-settings')
  ?.addEventListener('click', () => {
    var btn = document.getElementById('btn-save-basic-settings');
    if (btn && btn._attActionInflight) return btn._attActionInflight;
    const settings = {
      name: document.getElementById('set-madrasa-name').value,
      branch: document.getElementById('set-branch-name').value,
      year: document.getElementById('set-academic-year').value,
      footer: document.getElementById('set-print-footer').value,
    };
    attSetActionButtonBusy(btn, true, 'محفوظ ہو رہا ہے…');
    var op = attPersistConfigBlob(ATT_SETTINGS_KEY, settings).then(attRequirePersistSuccess).then(function () {
      window.showToast('بنیادی معلومات اس مدرسے میں محفوظ ہو گئیں!', 'success');
      logAttAudit('سیٹنگز اپڈیٹ', 'مدرسہ کی بنیادی معلومات تبدیل کی گئیں');
      return true;
    }).catch(function (err) {
      console.error('[EMS] attendance settings save', err);
      window.showToast('بنیادی معلومات محفوظ نہیں ہو سکیں', 'error');
      return false;
    }).finally(function () {
      if (btn) btn._attActionInflight = null;
      attSetActionButtonBusy(btn, false);
    });
    if (btn) btn._attActionInflight = op;
    return op;
  });

window.saveSymbols = function () {
  var btn = document.getElementById('btn-save-att-symbols');
  if (btn && btn._attActionInflight) return btn._attActionInflight;
  const symbols = {
    P: document.getElementById('sym-p').value || 'P',
    A: document.getElementById('sym-a').value || 'A',
    L: document.getElementById('sym-l').value || 'L',
  };
  attSetActionButtonBusy(btn, true, 'محفوظ…');
  var op = attPersistConfigBlob('ems_att_symbols', symbols).then(attRequirePersistSuccess).then(function () {
    window.showToast('حاضری کی علامات محفوظ ہو گئیں!', 'success');
    return true;
  }).catch(function (err) {
    console.error('[EMS] attendance symbols save', err);
    window.showToast('حاضری کی علامات محفوظ نہیں ہو سکیں', 'error');
    return false;
  }).finally(function () {
    if (btn) btn._attActionInflight = null;
    attSetActionButtonBusy(btn, false);
  });
  if (btn) btn._attActionInflight = op;
  return op;
};

function loadSettingsData() {
  const settings = attReadConfigJson('ems_att_settings', {}) || {};
  if (settings.name)
    document.getElementById('set-madrasa-name').value = settings.name;
  if (settings.branch)
    document.getElementById('set-branch-name').value = settings.branch;
  if (settings.year)
    document.getElementById('set-academic-year').value = settings.year;
  if (settings.footer)
    document.getElementById('set-print-footer').value = settings.footer;

  const symbols = attReadConfigJson('ems_att_symbols', null) || {
    P: 'P',
    A: 'A',
    L: 'L',
  };
  document.getElementById('sym-p').value = symbols.P;
  document.getElementById('sym-a').value = symbols.A;
  document.getElementById('sym-l').value = symbols.L;

  // Load Teachers for Period Modal
  const users = attGetUsers();
  const teachers = users.filter((u) => u.type === 'teacher');
  const tSelect = document.getElementById('new-period-teacher');
  if (tSelect) {
    tSelect.innerHTML =
      '<option value="">استاد منتخب کریں...</option>' +
      teachers
        .map((t) => `<option value="${t.id}">${t.name}</option>`)
        .join('');
  }
}

var ATT_DAYS_SHORT = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
function attDaysLabel(days) {
  if (!days || !days.length) return '<span style="color:#94a3b8;">روزانہ</span>';
  if (days.length === 7) return 'روزانہ';
  return days.slice().sort((a, b) => a - b).map((d) => ATT_DAYS_SHORT[d]).join('، ');
}

function loadPeriods() {
  const periods = attReadTimetablePeriods();
  const tbody = document.getElementById('settings-period-tbody');
  if (!tbody) return;
  if (!periods.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">ابھی کوئی سبق درج نہیں</td></tr>';
    return;
  }
  tbody.innerHTML = periods
    .map(function (p) {
      var pid = String(p.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var book = p.bookName && p.bookName !== '-' ? p.bookName : '—';
      var start = p.start && p.start !== '-' ? p.start : '—';
      var end = p.end && p.end !== '-' ? p.end : '—';
      var clsNote = p.className && p.className !== '-' ? '<br><small style="color:var(--accent);">' + p.className + '</small>' : '';
      return (
        '<tr>' +
        '<td><strong>' + p.name + '</strong>' + clsNote + '</td>' +
        '<td>' + book + '</td>' +
        '<td>' + start + '</td>' +
        '<td>' + end + '</td>' +
        '<td>' + (p.teacherName || '—') + '</td>' +
        '<td style="white-space:nowrap;">' +
        '<button class="icon-btn" onclick="editTimetablePeriod(\'' + pid + '\')" title="ترمیم"><i class="fas fa-pencil-alt"></i></button> ' +
        '<button class="icon-btn delete" onclick="deletePeriod(\'' + pid + '\')" title="حذف"><i class="fas fa-trash"></i></button>' +
        '</td></tr>'
      );
    })
    .join('');
}

window._attEditingPeriodId = null;

var ATT_LIB_BOOKS_KEY = 'ems_library_books';
var ATT_CUR_PLANS_KEY = 'ems_curriculum_plans';
var ATT_BOOK_ADD_NEW = '__ADD_NEW__';

function attFormatBookName(bookName) {
  if (!bookName || bookName === '-') return '';
  return bookName;
}

function attNormalizeLibraryBookDisplay(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
}

/** Same name once — trim/space-collapse + Unicode NFC + case-fold. */
function attLibraryBookDedupeKey(name) {
  var s = attNormalizeLibraryBookDisplay(name);
  if (!s) return '';
  try { s = s.normalize('NFC'); } catch (eNfc) { /* ignore */ }
  try { return s.toLocaleLowerCase('ur'); } catch (eUr) {
    try { return s.toLowerCase(); } catch (eLow) { return s; }
  }
}

/** Durable-aware read of مرکزی کتب خانہ (same SSOT as Exams / Curriculum). */
function attReadLibraryBooks() {
  var books = [];
  try {
    if (typeof window.emsCacheGetRaw === 'function') {
      var cached = window.emsCacheGetRaw(ATT_LIB_BOOKS_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) books = parsed;
      }
    }
  } catch (eCache) { /* ignore */ }
  if (!books.length && typeof window.emsDurableReadRaw === 'function') {
    try {
      var raw = window.emsDurableReadRaw(ATT_LIB_BOOKS_KEY);
      if (raw) {
        var parsedDurable = JSON.parse(raw);
        if (Array.isArray(parsedDurable)) books = parsedDurable;
      }
    } catch (eDurable) { /* ignore */ }
  }
  if (!books.length) {
    try {
      var ls = JSON.parse(localStorage.getItem(ATT_LIB_BOOKS_KEY) || '[]');
      if (Array.isArray(ls)) books = ls;
    } catch (eLs) { /* ignore */ }
  }
  return books
    .map(function (b) { return attNormalizeLibraryBookDisplay(b); })
    .filter(Boolean);
}
window.attReadLibraryBooks = attReadLibraryBooks;

/** Book names from شعبہ نصاب plans (same names that appear in curriculum library UI). */
function attReadCurriculumPlanBooks() {
  var plans = null;
  try {
    if (typeof window.curGetPlans === 'function') {
      plans = window.curGetPlans();
    }
  } catch (eCur) { plans = null; }
  if (!Array.isArray(plans) || !plans.length) {
    var raw = null;
    try {
      if (typeof window.emsCacheGetRaw === 'function') raw = window.emsCacheGetRaw(ATT_CUR_PLANS_KEY);
    } catch (eCache) { /* ignore */ }
    if ((raw == null || raw === '') && typeof window.emsDurableReadRaw === 'function') {
      try { raw = window.emsDurableReadRaw(ATT_CUR_PLANS_KEY); } catch (eDur) { /* ignore */ }
    }
    if (raw == null || raw === '') {
      try { raw = localStorage.getItem(ATT_CUR_PLANS_KEY); } catch (eLs) { /* ignore */ }
    }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) plans = parsed;
      } catch (eParse) { plans = []; }
    }
  }
  if (!Array.isArray(plans)) plans = [];
  var byKey = {};
  var out = [];
  plans.forEach(function (p) {
    var name = attNormalizeLibraryBookDisplay(p && p.bookName);
    if (!name || name === '-') return;
    var key = attLibraryBookDedupeKey(name);
    if (!key || byKey[key]) return;
    byKey[key] = true;
    out.push(name);
  });
  return out;
}

/** Push مرکزی کتب خانہ names into نصاب plans (mirrors exams master-sheet sync). */
function attSyncLibraryToCurriculum(opts) {
  opts = opts || {};
  function run() {
    if (typeof window.curSyncFromLibrary === 'function') {
      try { window.curSyncFromLibrary(); } catch (eSync) { /* ignore */ }
    }
    if (opts.skipUi) return;
    if (typeof window.curRenderPlanning === 'function'
        && document.getElementById('module-curriculum')
        && document.getElementById('module-curriculum').classList.contains('active')) {
      try { window.curRenderPlanning(); } catch (eUi) { /* ignore */ }
    }
  }
  if (typeof window.curEnsureLibraryReady === 'function') {
    return window.curEnsureLibraryReady().then(run).catch(run);
  }
  run();
  return Promise.resolve();
}
window.attSyncLibraryToCurriculum = attSyncLibraryToCurriculum;

function attWriteLibraryBooks(books, opts) {
  opts = opts || {};
  var list = Array.isArray(books) ? books : [];
  var str = JSON.stringify(list);
  if (typeof window.emsSaveModuleData === 'function') {
    window.emsSaveModuleData(ATT_LIB_BOOKS_KEY, str, { mutation: true, autoDelta: true });
  } else if (typeof window.emsDurableWriteRaw === 'function') {
    window.emsDurableWriteRaw(ATT_LIB_BOOKS_KEY, str);
    try { localStorage.setItem(ATT_LIB_BOOKS_KEY, str); } catch (eWrite) { /* ignore */ }
  } else {
    try { localStorage.setItem(ATT_LIB_BOOKS_KEY, str); } catch (eLs) { /* ignore */ }
  }
  if (typeof window.emsCacheInvalidate === 'function') {
    try { window.emsCacheInvalidate(ATT_LIB_BOOKS_KEY); } catch (eInv) { /* ignore */ }
  }
  if (!opts.skipRefresh && typeof window.refreshExamData === 'function') {
    try { window.refreshExamData(); } catch (eRefresh) { /* ignore */ }
  }
  if (!opts.skipCurSync) {
    try { attSyncLibraryToCurriculum({ skipUi: !!opts.skipCurUi }); } catch (eCur) { /* ignore */ }
  }
  return list;
}

function attEnsureLibraryBook(name) {
  name = attNormalizeLibraryBookDisplay(name);
  if (!name || name === '-') return name;
  var books = attReadLibraryBooks();
  var key = attLibraryBookDedupeKey(name);
  for (var i = 0; i < books.length; i++) {
    if (attLibraryBookDedupeKey(books[i]) === key) return books[i];
  }
  books.push(name);
  attWriteLibraryBooks(books);
  return name;
}

/** Unique کتاب/مضمون names already stored on timetable periods. */
function attCollectUniquePeriodBooks() {
  var periods = [];
  try {
    periods = JSON.parse(localStorage.getItem('ems_att_periods') || '[]') || [];
  } catch (eParse) { periods = []; }
  if (!Array.isArray(periods)) periods = [];
  var byKey = {};
  var out = [];
  periods.forEach(function (p) {
    var name = attNormalizeLibraryBookDisplay(attFormatBookName(p && p.bookName));
    if (!name || name === '-') return;
    var key = attLibraryBookDedupeKey(name);
    if (!key || byKey[key]) return;
    byKey[key] = true;
    out.push(name);
  });
  return out;
}

/**
 * Merge timetable + نصاب plan کتاب/مضمون into مرکزی کتب خانہ (deduped).
 * Idempotent — safe to run on every timetable open.
 */
function attMigratePeriodBooksToLibrary(opts) {
  opts = opts || {};
  var fromPeriods = attCollectUniquePeriodBooks();
  var fromCurriculum = attReadCurriculumPlanBooks();
  var existing = attReadLibraryBooks();
  var byKey = {};
  var merged = [];
  existing.forEach(function (b) {
    var name = attNormalizeLibraryBookDisplay(b);
    if (!name) return;
    var key = attLibraryBookDedupeKey(name);
    if (!key || byKey[key]) return;
    byKey[key] = true;
    merged.push(name);
  });
  var added = 0;
  function addName(name) {
    var key = attLibraryBookDedupeKey(name);
    if (!key || byKey[key]) return;
    byKey[key] = true;
    merged.push(name);
    added++;
  }
  fromPeriods.forEach(addName);
  fromCurriculum.forEach(addName);
  var changed = added > 0 || merged.length !== existing.length;
  if (changed) {
    attWriteLibraryBooks(merged, {
      skipRefresh: !!opts.skipRefresh,
      skipCurSync: opts.skipCurSync != null ? !!opts.skipCurSync : !!opts.skipRefresh
    });
  }
  return { added: added, total: merged.length, changed: changed };
}

window.attMigratePeriodBooksToLibrary = attMigratePeriodBooksToLibrary;

function attEscapeBookOption(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attFillPeriodBookSelect(selectedName) {
  var sel = document.getElementById('new-period-book');
  if (!sel || sel.tagName !== 'SELECT') return;
  /* Merge timetable + نصاب books into مرکزی کتب خانہ before painting options */
  attMigratePeriodBooksToLibrary({ skipRefresh: true, skipCurSync: true });
  var selected = attFormatBookName(selectedName);
  var books = attReadLibraryBooks().slice().sort(function (a, b) {
    try { return a.localeCompare(b, 'ur'); } catch (e) { return a < b ? -1 : a > b ? 1 : 0; }
  });
  if (selected && books.indexOf(selected) < 0) books.unshift(selected);
  var html = '<option value="">کتب خانہ سے منتخب کریں (امتحانات / نصاب)...</option>';
  books.forEach(function (b) {
    var safe = attEscapeBookOption(b);
    html += '<option value="' + safe + '">' + safe + '</option>';
  });
  html += '<option value="' + ATT_BOOK_ADD_NEW + '">＋ نئی کتاب شامل کریں...</option>';
  sel.innerHTML = html;
  sel.value = selected || '';
  var wrap = document.getElementById('new-period-book-custom-wrap');
  if (wrap) wrap.style.display = 'none';
  var custom = document.getElementById('new-period-book-custom');
  if (custom) custom.value = '';
}

window.attOnPeriodBookSelectChange = function () {
  var sel = document.getElementById('new-period-book');
  var wrap = document.getElementById('new-period-book-custom-wrap');
  if (!wrap) return;
  var isAdd = !!(sel && sel.value === ATT_BOOK_ADD_NEW);
  wrap.style.display = isAdd ? 'block' : 'none';
  if (!isAdd) {
    var custom = document.getElementById('new-period-book-custom');
    if (custom) custom.value = '';
  } else {
    var input = document.getElementById('new-period-book-custom');
    if (input) {
      try { input.focus(); } catch (eFocus) { /* ignore */ }
    }
  }
};

window.attRefreshPeriodBookSelect = function () {
  var sel = document.getElementById('new-period-book');
  if (!sel || sel.tagName !== 'SELECT') return;
  var cur = sel.value || '';
  var custom = document.getElementById('new-period-book-custom');
  var customVal = custom ? custom.value : '';
  var selected = cur === ATT_BOOK_ADD_NEW ? '' : cur;
  attFillPeriodBookSelect(selected);
  if (cur === ATT_BOOK_ADD_NEW) {
    sel.value = ATT_BOOK_ADD_NEW;
    window.attOnPeriodBookSelectChange();
    if (custom) custom.value = customVal;
  }
};

function attResolvePeriodBookName() {
  var sel = document.getElementById('new-period-book');
  var v = sel ? String(sel.value || '').trim() : '';
  if (v === ATT_BOOK_ADD_NEW) {
    var custom = document.getElementById('new-period-book-custom');
    return custom ? String(custom.value || '').trim() : '';
  }
  return v;
}

function attResetPeriodForm() {
  ['new-period-name', 'new-period-location', 'new-period-recovery-id', 'custom-teacher-name'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var recoveryId = document.getElementById('new-period-recovery-id');
  if (recoveryId) recoveryId.readOnly = false;
  var recoveryHelp = document.getElementById('new-period-recovery-id-help');
  if (recoveryHelp) {
    recoveryHelp.textContent = 'اگر اس گھنٹے کی پہلے سے حاضری لگی ہوئی ہے تو اس کا پرانا شناختی نمبر یہاں درج کریں۔ اسے صرف بحالی کی فہرست سے کاپی کریں؛ دہرے یا غیر محفوظ نمبر قبول نہیں ہوں گے۔';
  }
  attFillPeriodBookSelect('');
  var cls = document.getElementById('new-period-class');
  if (cls) cls.value = '';
  ['new-period-start', 'new-period-end'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('#new-period-days input').forEach(function (cb) {
    cb.checked = false;
  });
  var customArea = document.getElementById('custom-teacher-input-area');
  if (customArea) customArea.style.display = 'none';
  var delBtn = document.getElementById('btn-del-custom-teacher');
  if (delBtn) delBtn.style.display = 'none';
}

function attUpdatePeriodModalChrome() {
  var titleEl = document.getElementById('add-period-modal-title');
  var btnSave = document.getElementById('btn-save-period');
  var isEdit = !!window._attEditingPeriodId;
  if (titleEl) {
    titleEl.textContent = isEdit ? 'گھنٹہ ترمیم' : 'نیا گھنٹہ / پیریڈ شامل کریں';
  }
  if (btnSave) {
    btnSave.innerHTML = isEdit
      ? '<i class="fas fa-save"></i> ترمیم محفوظ کریں'
      : '<i class="fas fa-save"></i> محفوظ کر کے بند کریں';
  }
}

function attFillPeriodForm(p) {
  if (!p) return;
  var setVal = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('new-period-name', p.name);
  setVal('new-period-recovery-id', p.id);
  var recoveryId = document.getElementById('new-period-recovery-id');
  if (recoveryId) recoveryId.readOnly = true;
  var recoveryHelp = document.getElementById('new-period-recovery-id-help');
  if (recoveryHelp) {
    recoveryHelp.textContent = 'موجودہ گھنٹہ شناختی نمبر لاک ہے، کیونکہ اسے تبدیل کرنے سے سابقہ حاضری کا ربط ٹوٹ سکتا ہے۔';
  }
  setVal('new-period-class', p.className && p.className !== '-' ? p.className : '');
  attFillPeriodBookSelect(attFormatBookName(p.bookName));
  setVal('new-period-location', p.location || '');
  setVal('new-period-start', p.start && p.start !== '-' ? p.start : '');
  setVal('new-period-end', p.end && p.end !== '-' ? p.end : '');
  var tSelect = document.getElementById('new-period-teacher');
  if (tSelect && p.teacherId) tSelect.value = p.teacherId;
  if (typeof window.checkCustomTeacherSelect === 'function') window.checkCustomTeacherSelect();
  document.querySelectorAll('#new-period-days input').forEach(function (cb) {
    cb.checked = Array.isArray(p.days) && p.days.indexOf(parseInt(cb.value, 10)) >= 0;
  });
}

function attRefreshPeriodUiAfterSave(editedId) {
  if (typeof loadPeriods === 'function') loadPeriods();
  if (typeof window.renderTimetable === 'function') window.renderTimetable();
  if (typeof loadAttDropdowns === 'function') loadAttDropdowns(true);
  var perSel = document.getElementById('att-reg-period');
  if (editedId && perSel && perSel.value === editedId && typeof window.setupPrintHeader === 'function') {
    window.setupPrintHeader();
  }
}

function attSavePeriodFromModal(opts) {
  opts = opts || {};
  var closeAfter = !!opts.closeAfter;
  var addMore = !!opts.addMore;

  var name = document.getElementById('new-period-name')?.value.trim();
  var className = document.getElementById('new-period-class')?.value || '-';
  var bookName = attResolvePeriodBookName() || '-';
  var location = document.getElementById('new-period-location')?.value.trim() || '';
  var start = document.getElementById('new-period-start')?.value || '-';
  var end = document.getElementById('new-period-end')?.value || '-';
  var days = Array.from(document.querySelectorAll('#new-period-days input:checked')).map(function (c) {
    return parseInt(c.value, 10);
  });
  var tSelect = document.getElementById('new-period-teacher');
  var teacherId = tSelect ? tSelect.value : '';
  var teacherName = tSelect && tSelect.selectedIndex >= 0 ? tSelect.options[tSelect.selectedIndex].text : '-';
  var requestedRecoveryId = String(document.getElementById('new-period-recovery-id')?.value || '').trim();
  var customTeachersToSave = null;

  if (!name) {
    if (typeof window.showToast === 'function') window.showToast('گھنٹے کا نام درج کرنا لازمی ہے!', 'error');
    return false;
  }

  var bookSel = document.getElementById('new-period-book');
  if (bookSel && bookSel.value === ATT_BOOK_ADD_NEW && (!bookName || bookName === '-')) {
    if (typeof window.showToast === 'function') window.showToast('نئی کتاب کا نام درج کریں!', 'error');
    return false;
  }

  if (bookName && bookName !== '-') {
    attEnsureLibraryBook(bookName);
  }

  if (!teacherId) {
    if (typeof window.showToast === 'function') window.showToast('استاد منتخب کرنا لازمی ہے؛ بغیر استاد کے گھنٹہ حاضری میں ظاہر نہیں ہوگا۔', 'error');
    return false;
  }

  if (teacherId === 'ADD_NEW') {
    var customName = document.getElementById('custom-teacher-name')?.value.trim();
    if (!customName) {
      if (typeof window.showToast === 'function') window.showToast('نئے استاد کا نام درج کریں!', 'error');
      return false;
    }
    teacherId = window.generateID ? window.generateID('CTCH') : 'CTCH-' + Math.floor(Math.random() * 90000);
    teacherName = customName;
    var customTeachers = attReadConfigJson(ATT_CUSTOM_TEACHERS_KEY, []) || [];
    customTeachers.push({ id: teacherId, name: teacherName });
    customTeachersToSave = customTeachers;
  } else if (teacherId && teacherId !== '') {
    var regUser = attFindRegisterUser(teacherId);
    if (regUser) teacherId = attGetUserId(regUser) || teacherId;
    teacherName = teacherName.replace(/\[.*?\]\s*/, '');
  }

  var periods = attReadAllTimetablePeriodsRaw();
  var periodObj = {
    name: name,
    className: className,
    bookName: bookName,
    location: location,
    start: start,
    end: end,
    days: days,
    teacherId: teacherId,
    teacherName: teacherName,
  };
  var editedId = window._attEditingPeriodId;
  var isEdit = !!editedId;

  if (requestedRecoveryId && !/^[A-Za-z0-9_-]+$/.test(requestedRecoveryId)) {
    if (typeof window.showToast === 'function') {
      window.showToast('پرانا گھنٹہ شناختی نمبر صرف انگریزی حروف، اعداد، _ یا - پر مشتمل ہو سکتا ہے۔', 'error');
    }
    return false;
  }

  if (isEdit) {
    var idx = periods.findIndex(function (p) { return p.id === editedId; });
    if (idx < 0) {
      if (typeof window.showToast === 'function') window.showToast('گھنٹہ نہیں ملا — دوبارہ کوشش کریں', 'error');
      return false;
    }
    periodObj.id = editedId;
    periods[idx] = Object.assign({}, periods[idx], periodObj);
  } else {
    if (requestedRecoveryId) {
      var duplicate = periods.some(function (p) {
        return p && String(p.id || '').trim() === requestedRecoveryId;
      });
      if (duplicate) {
        if (typeof window.showToast === 'function') {
          window.showToast('یہ پرانا گھنٹہ شناختی نمبر پہلے سے موجود ہے؛ محفوظ شدہ حاضری کے لیے اسے دوسرے گھنٹے میں استعمال نہیں کیا جا سکتا۔', 'error');
        }
        return false;
      }
      periodObj.id = requestedRecoveryId;
    } else {
      periodObj.id = window.generateID ? window.generateID('PRD') : 'PRD-' + Math.floor(Math.random() * 90000);
    }
    periods.push(periodObj);
  }

  // Both local writes execute synchronously before their promises resolve, so
  // an immediate reload cannot miss the newly saved timetable.
  var customSave = customTeachersToSave
    ? attPersistConfigBlob(ATT_CUSTOM_TEACHERS_KEY, customTeachersToSave)
    : Promise.resolve({ ok: true });
  var periodSave = attSaveTimetablePeriodsSync(periods);
  return Promise.all([customSave, periodSave]).then(function (results) {
    results.forEach(function (res) {
      if (!res || res.ok === false) throw new Error((res && (res.reason || res.error)) || 'local_write_failed');
    });
  }).then(function () {
    attRefreshPeriodUiAfterSave(isEdit ? editedId : null);

    if (typeof window.showToast === 'function') {
      window.showToast(
        isEdit ? 'گھنٹہ (' + name + ') کامیابی سے اپڈیٹ ہو گیا!' : 'گھنٹہ (' + name + ') کامیابی سے محفوظ کر لیا گیا!',
        'success'
      );
    }
    if (typeof logAttAudit === 'function') {
      logAttAudit(isEdit ? 'گھنٹہ ترمیم' : 'نیا گھنٹہ', (isEdit ? 'ترمیم: ' : '') + name);
    }

    if (typeof window.exmSyncTimetableBooksToMasterSheet === 'function') {
      try { window.exmSyncTimetableBooksToMasterSheet({ silent: true }); } catch (eExmSync) { /* ignore */ }
    }

    if (addMore) {
      document.getElementById('new-period-name').value = '';
      attFillPeriodBookSelect('');
      document.getElementById('new-period-class').value = '';
      if (document.getElementById('new-period-location')) document.getElementById('new-period-location').value = '';
      var recoveryIdAfterSave = document.getElementById('new-period-recovery-id');
      if (recoveryIdAfterSave) {
        recoveryIdAfterSave.value = '';
        recoveryIdAfterSave.readOnly = false;
      }
      var recoveryHelpAfterSave = document.getElementById('new-period-recovery-id-help');
      if (recoveryHelpAfterSave) {
        recoveryHelpAfterSave.textContent = 'اگر اس گھنٹے کی پہلے سے حاضری لگی ہوئی ہے تو اس کا پرانا شناختی نمبر یہاں درج کریں۔ اسے صرف بحالی کی فہرست سے کاپی کریں؛ دہرے یا غیر محفوظ نمبر قبول نہیں ہوں گے۔';
      }
      window._attEditingPeriodId = null;
      attUpdatePeriodModalChrome();
    } else if (closeAfter) {
      attResetPeriodForm();
      window._attEditingPeriodId = null;
      attUpdatePeriodModalChrome();
      if (typeof window.closeModal === 'function') window.closeModal('add-period-modal');
    }

    return true;
  }).catch(function (err) {
    console.error('[EMS] timetable period save', err);
    if (typeof window.showToast === 'function') window.showToast('گھنٹہ محفوظ نہیں ہو سکا؛ موجودہ نظام الاوقات برقرار ہے۔', 'error');
    return false;
  });
}

var _attPeriodDeleteInflight = Object.create(null);
function attRemovePeriodById(periodId) {
  if (_attPeriodDeleteInflight[periodId]) return _attPeriodDeleteInflight[periodId];
  var periods = attReadAllTimetablePeriodsRaw();
  var idx = periods.findIndex(function (p) { return p.id === periodId; });
  if (idx < 0) {
    if (typeof window.showToast === 'function') window.showToast('گھنٹہ نہیں ملا', 'error');
    return false;
  }
  var toDelete = periods[idx];
  if (attIsPeriodArchived(toDelete)) {
    if (typeof window.showToast === 'function') window.showToast('گھنٹہ پہلے ہی حذف شدہ ہے', 'info');
    return false;
  }
  var label = toDelete.name || periodId;
  if (!confirm('کیا آپ واقعی "' + label + '" حذف کرنا چاہتے ہیں؟')) return false;
  periods[idx] = Object.assign({}, toDelete, {
    archived: true,
    archivedAt: Date.now()
  });
  _attPeriodDeleteInflight[periodId] = attSaveTimetablePeriodsSync(periods)
    .then(function (res) {
      if (!res || res.ok === false) throw new Error((res && (res.reason || res.error)) || 'local_write_failed');
      return res;
    }).then(function () {
      // The period is archived, not destroyed: old attendance keeps its hour id.
      moveToRecycleBin('Period', toDelete);
      var perSel = document.getElementById('att-reg-period');
      if (perSel && perSel.value === periodId) perSel.value = 'all';
      attRefreshPeriodUiAfterSave(null);
      if (typeof window.setupPrintHeader === 'function') window.setupPrintHeader();
      if (typeof logAttAudit === 'function') logAttAudit('گھنٹہ حذف', label);
      if (typeof window.showToast === 'function') window.showToast('گھنٹہ محفوظ طریقے سے آرکائیو کر دیا گیا؛ پرانی حاضری برقرار ہے۔', 'success');
      return true;
    }).catch(function (err) {
      console.error('[EMS] timetable period delete', err);
      if (typeof window.showToast === 'function') window.showToast('گھنٹہ حذف نہیں ہو سکا؛ نظام الاوقات برقرار ہے۔', 'error');
      return false;
    }).finally(function () {
      delete _attPeriodDeleteInflight[periodId];
    });
  return _attPeriodDeleteInflight[periodId];
}

window.attOpenNewPeriodModal = function () {
  window._attEditingPeriodId = null;
  attResetPeriodForm();
  attUpdatePeriodModalChrome();
  if (typeof window.loadPeriodTeachers === 'function') window.loadPeriodTeachers();
  if (typeof window.openModal === 'function') window.openModal('add-period-modal');
};

window.attClosePeriodModal = function () {
  window._attEditingPeriodId = null;
  attUpdatePeriodModalChrome();
  if (typeof window.closeModal === 'function') window.closeModal('add-period-modal');
};

// ============================================================================
// نظام الاوقات (Timetable) — استاد وار / درجہ وار + چھانٹی  (مرحلہ 4)
// ============================================================================
window._ttView = 'teacher';

window.ttSetView = function (view) {
  window._ttView = view;
  document.getElementById('tt-view-teacher')?.classList.toggle('active', view === 'teacher');
  document.getElementById('tt-view-class')?.classList.toggle('active', view === 'class');
  window.renderTimetable();
};

window.ttClearFilters = function () {
  ['tt-filter-teacher', 'tt-filter-class', 'tt-filter-book', 'tt-filter-day', 'tt-filter-search'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  window.renderTimetable();
};

function ttPopulateFilters() {
  const periods = attReadTimetablePeriods();
  const fill = (id, values, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${label}</option>` +
      [...new Set(values.filter(Boolean))].sort().map((v) => `<option value="${v}">${v}</option>`).join('');
    el.value = cur;
  };
  var registeredTeacherNames = attCollectRegisteredTeachers().map(function (teacher) {
    return teacher.name || teacher.fullName || '';
  });
  fill('tt-filter-teacher', periods.map((p) => p.teacherName).concat(registeredTeacherNames), 'تمام اساتذہ');
  fill('tt-filter-class', periods.map((p) => p.className).filter((c) => c && c !== '-'), 'تمام درجات');
  var periodBooks = periods.map((p) => p.bookName).filter((b) => b && b !== '-');
  var libBooks = attReadLibraryBooks();
  fill('tt-filter-book', periodBooks.concat(libBooks), 'تمام کتب');
}

function ttFilteredPeriods() {
  let periods = attReadTimetablePeriods();
  const fT = document.getElementById('tt-filter-teacher')?.value || '';
  const fC = document.getElementById('tt-filter-class')?.value || '';
  const fB = document.getElementById('tt-filter-book')?.value || '';
  const fD = document.getElementById('tt-filter-day')?.value || '';
  const fS = (document.getElementById('tt-filter-search')?.value || '').trim().toLowerCase();

  return periods.filter((p) => {
    if (fT && p.teacherName !== fT) return false;
    if (fC && p.className !== fC) return false;
    if (fB && p.bookName !== fB) return false;
    if (fD !== '' && p.days && p.days.length && p.days.indexOf(parseInt(fD, 10)) < 0) return false;
    if (fS) {
      const hay = `${p.teacherName} ${p.className} ${p.bookName} ${p.name} ${p.location || ''}`.toLowerCase();
      if (hay.indexOf(fS) < 0) return false;
    }
    return true;
  });
}

function ttPeriodCard(p) {
  const loc = p.location ? `<span class="tt-chip"><i class="fas fa-map-marker-alt"></i> ${p.location}</span>` : '';
  const time = p.start && p.start !== '-' ? `<span class="tt-chip"><i class="fas fa-clock"></i> ${p.start} - ${p.end}</span>` : '';
  const book = attFormatBookName(p.bookName) ? `<span class="tt-chip"><i class="fas fa-book"></i> ${attFormatBookName(p.bookName)}</span>` : '';
  const pid = String(p.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `
    <div class="tt-period">
        <div class="tt-period-main">
            <div class="tt-period-name">${p.name}</div>
            <div class="tt-period-meta">${book}${time}${loc}<span class="tt-chip tt-chip-day">${attDaysLabel(p.days)}</span></div>
        </div>
        <div class="tt-period-actions">
            <button class="btn btn-success btn-sm" onclick="ttTakeAttendance('${pid}')"><i class="fas fa-clipboard-check"></i> حاضری لیں</button>
            <button class="btn btn-outline btn-sm tt-btn-edit" onclick="editTimetablePeriod('${pid}')" title="ترمیم"><i class="fas fa-pencil-alt"></i> ترمیم</button>
            <button class="btn btn-danger btn-sm tt-btn-del" onclick="deleteTimetablePeriod('${pid}')" title="حذف"><i class="fas fa-trash-alt"></i> حذف</button>
        </div>
    </div>`;
}

window.editTimetablePeriod = function (periodId) {
  var p = attResolvePeriodById(periodId);
  if (!p || attIsPeriodArchived(p)) {
    if (typeof window.showToast === 'function') window.showToast('گھنٹہ نہیں ملا', 'error');
    return;
  }
  window._attEditingPeriodId = periodId;
  if (typeof window.loadPeriodTeachers === 'function') window.loadPeriodTeachers();
  attFillPeriodForm(p);
  attUpdatePeriodModalChrome();
  if (typeof window.openModal === 'function') window.openModal('add-period-modal');
};

window.deleteTimetablePeriod = function (periodId) {
  attRemovePeriodById(periodId);
};

window.renderTimetable = function () {
  const box = document.getElementById('tt-result');
  if (!box) return;
  ttPopulateFilters();
  const periods = ttFilteredPeriods();
  var teacherFilter = document.getElementById('tt-filter-teacher')?.value || '';
  var hasOtherFilter = ['tt-filter-class', 'tt-filter-book', 'tt-filter-day', 'tt-filter-search'].some(function (id) {
    var el = document.getElementById(id);
    return !!(el && String(el.value || '').trim());
  });
  const registeredTeachers = window._ttView === 'teacher' && !hasOtherFilter
    ? attCollectRegisteredTeachers().filter(function (teacher) {
      var label = teacher.name || teacher.fullName || '';
      return !teacherFilter || label === teacherFilter;
    })
    : [];

  if (!periods.length && !registeredTeachers.length) {
    box.innerHTML = '<div class="tt-empty"><i class="fas fa-table"></i><p>کوئی سبق موجود نہیں۔ "نیا سبق" سے اساتذہ کے اوقات درج کریں۔</p></div>';
    return;
  }

  // گروپ بندی — استاد وار یا درجہ وار
  const groups = {};
  periods.forEach((p) => {
    const k = (window._ttView === 'class' ? (p.className && p.className !== '-' ? p.className : 'متفرق') : (p.teacherName || 'نامعلوم'));
    (groups[k] = groups[k] || []).push(p);
  });
  // استاد وار منظر میں مکمل رجسٹر دکھائیں، چاہے کسی استاد کا ابھی
  // کوئی گھنٹہ مقرر نہ ہو۔ اس طرح 47 رجسٹرڈ اساتذہ میں سے بے گھنٹہ
  // استاد بھی غائب نہیں ہوتا۔
  if (window._ttView === 'teacher') {
    registeredTeachers.forEach(function (teacher) {
      var teacherId = attGetUserId(teacher);
      var hasPeriod = periods.some(function (period) {
        return attPeriodTeacherIdMatches(period, teacherId);
      });
      if (!hasPeriod) {
        var label = teacher.name || teacher.fullName || teacherId || 'نامعلوم';
        if (!groups[label]) groups[label] = [];
      }
    });
  }

  const icon = window._ttView === 'class' ? 'fa-layer-group' : 'fa-chalkboard-teacher';
  box.innerHTML = Object.keys(groups).sort().map((g) => {
    const items = groups[g].slice().sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const sub = window._ttView === 'class'
      ? `${[...new Set(items.map((i) => i.teacherName))].length} اساتذہ • ${items.length} اسباق`
      : `${[...new Set(items.map((i) => i.className).filter((c) => c && c !== '-'))].length} درجات • ${items.length} اسباق`;
    return `
      <div class="tt-group">
        <div class="tt-group-head"><span><i class="fas ${icon}"></i> ${g}</span><small>${sub}</small></div>
        <div class="tt-group-body">${items.length
          ? items.map(ttPeriodCard).join('')
          : '<div class="tt-empty" style="padding:14px;"><p style="margin:0;">اس استاد کا کوئی گھنٹہ مقرر نہیں۔</p></div>'}</div>
      </div>`;
  }).join('');
};

// نظام الاوقات سے براہِ راست حاضری لینا — اسمارٹ رجسٹر پر منتقلی
window.ttTakeAttendance = function (periodId) {
  const p = attResolvePeriodById(periodId);
  if (!p || attIsPeriodArchived(p)) return;

  const stuBtn = document.querySelector('#att-ribbon-menu [onclick*="att-smart-register"]');
  window.switchAttTab('att-smart-register', stuBtn);

  setTimeout(() => {
    const typeSel = document.getElementById('att-reg-type');
    const clsSel = document.getElementById('att-reg-class');
    const perSel = document.getElementById('att-reg-period');
    const monthInput = document.getElementById('att-reg-month');
    if (typeSel) typeSel.value = 'students';
    if (monthInput && !monthInput.value) monthInput.value = new Date().toISOString().substring(0, 7);
    if (clsSel && p.className && p.className !== '-') clsSel.value = p.className;
    if (perSel) perSel.value = p.id;
    document.getElementById('btn-load-smart-register')?.click();
    window.showToast(`"${p.teacherName}" کا سبق "${p.name}" — حاضری کے لیے تیار`, 'info');
  }, 150);
};

window.deletePeriod = function (id) {
  attRemovePeriodById(id);
};

// ================== 3. اسمارٹ حاضری رجسٹر (Phase B0 — local-first load) ==================
document.getElementById('btn-load-smart-register')?.addEventListener('click', () => {
    let uid = getAttendanceTenantId();
    if (!uid) return window.showToast("خرابی: پہلے جی میل سے لاگ ان کریں!", "error");

    const type = document.getElementById('att-reg-type').value;
    const classId = document.getElementById('att-reg-class').value;
    const month = document.getElementById('att-reg-month').value;
    let period = document.getElementById('att-reg-period').value;
    if (!period) period = 'all';

    if (!month) return window.showToast('مہینہ منتخب کریں!', 'error');
    if (type === 'students' && !classId) return window.showToast('درجہ منتخب کرنا لازمی ہے!', 'error');

    var loadCtx = {
      requestId: ++_attRegisterLoadSeq,
      tenantId: uid,
      generation: typeof window.emsGetTenantGeneration === 'function'
        ? window.emsGetTenantGeneration() : null
    };
    attSetRegisterLoadBusy(loadCtx, true);

    var loadRegister = function () {
      return attResolveTargetUsers(type, classId).then(function (targets) {
        if (!attRegisterLoadIsCurrent(loadCtx)) return { ok: false, stale: true };
        targets = attFilterEligibleUsers(attMergeUniqueById(targets));
        if (targets.length === 0) {
          var repoCount = typeof window.emsRegRepoGetCount === 'function' ? window.emsRegRepoGetCount() : 0;
          console.warn('[EMS attendance] zero roster targets', { type: type, classId: classId, repoCount: repoCount });
          window.showToast('اس کرائیٹیریا کے مطابق کوئی ریکارڈ نہیں ملا!', 'error');
          return { ok: false, reason: 'empty_roster' };
        }
        return attLoadRegisterLocalFirst(uid, targets, month, type, classId, period, loadCtx);
      }).catch(function (err) {
        console.error('[EMS attendance] load register failed', err);
        if (attRegisterLoadIsCurrent(loadCtx)) {
          window.showToast('رجسٹر لوڈ ناکام — دوبارہ کوشش کریں', 'error');
        }
        return { ok: false, error: err && err.message ? err.message : String(err) };
      });
    };
    var ready;
    if (typeof window.emsEnsureRepositoryReady === 'function') {
      ready = Promise.resolve(window.emsEnsureRepositoryReady()).catch(function () { return null; });
    } else {
      ready = Promise.resolve();
    }
    ready.then(loadRegister).finally(function () {
      attSetRegisterLoadBusy(loadCtx, false);
    });
});

window.toggleAttViewMode = function () {
  if (window.currentAttState && window.currentAttState.month && window.currentAttState.targetUsers && window.currentAttState.targetUsers.length) {
    buildSmartRegisterImmediate(window.currentAttState.month, window.getFilteredUsers());
  }
};

window.buildSmartRegister = function (monthStr, usersList) {
  var forceRender = !!(monthStr && Array.isArray(usersList) && usersList.length);
  if (!forceRender && !attShouldRenderRegister()) return;
  _buildSmartRegisterPending = { monthStr: monthStr, usersList: usersList, forceRender: forceRender };
  if (_buildSmartRegisterScheduled) return;
  _buildSmartRegisterScheduled = true;
  var run = function () {
    _buildSmartRegisterScheduled = false;
    var pending = _buildSmartRegisterPending;
    _buildSmartRegisterPending = null;
    if (!pending || (!pending.forceRender && !attShouldRenderRegister())) return;
    buildSmartRegisterImmediate(pending.monthStr, pending.usersList);
    if (_buildSmartRegisterPending) {
      window.buildSmartRegister(_buildSmartRegisterPending.monthStr, _buildSmartRegisterPending.usersList);
    }
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
};

function buildSmartRegisterImmediate(monthStr, usersList) {
  const thead = document.getElementById('smart-register-thead');
  const tbody = document.getElementById('smart-register-tbody');
  if (!thead || !tbody) return;

  attPauseDictObserver();
  try {
  attEnsureAttStateShape();

  const holidays = JSON.parse(localStorage.getItem('ems_att_holidays')) || [];
  const symbols = JSON.parse(localStorage.getItem('ems_att_symbols')) || {
    P: 'P',
    A: 'A',
    L: 'L',
  };
  const [year, month] = monthStr.split('-');
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysUrdu = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];

  const viewModeEl = document.querySelector('input[name="att_view_mode"]:checked');
  const isSingleDay = viewModeEl && viewModeEl.value === 'day';
  const todayDateNum = new Date().getDate();

  let startDay = isSingleDay ? todayDateNum : 1;
  let endDay = isSingleDay ? todayDateNum : daysInMonth;

  if (!window.currentAttState.registerRowPage) window.currentAttState.registerRowPage = 1;
  const rowPage = window.currentAttState.registerRowPage;
  const rowPageSize = ATT_REGISTER_ROW_PAGE;

  const sortedUsers = (usersList || []).slice().sort(function (a, b) {
    return String(attGetUserId(a)).localeCompare(String(attGetUserId(b)));
  });
  const totalUsers = sortedUsers.length;
  const totalRowPages = Math.max(1, Math.ceil(totalUsers / rowPageSize));
  if (rowPage > totalRowPages) window.currentAttState.registerRowPage = totalRowPages;
  const safeRowPage = window.currentAttState.registerRowPage || 1;
  const rowStart = (safeRowPage - 1) * rowPageSize;
  const pageUsers = sortedUsers.slice(rowStart, rowStart + rowPageSize);

  if (!window.currentAttState.dailyLocks) window.currentAttState.dailyLocks = {};

  let headHTML = `<tr><th style="position:sticky; right:0; top:0; background:var(--secondary); z-index:15; min-width:200px; border-right: 1px solid #cbd5e1;">${attIsTeacherRegister() ? 'استاد کا نام / ID' : 'طالب علم کا نام / ID'}</th>`;

  for (let d = startDay; d <= endDay; d++) {
    let currentFullDate = `${year}-${month}-${d < 10 ? '0' + d : d}`;
    let dateObj = new Date(currentFullDate);
    let dayName = daysUrdu[dateObj.getDay()];
    let isFriday = dateObj.getDay() === 5;
    let isHoliday = holidays.some(
      (h) => currentFullDate >= h.start && currentFullDate <= h.end
    );

    let colClass = isFriday || isHoliday ? 'col-holiday-header' : '';
    let displayDay = isHoliday ? 'تعطیل' : dayName;
    let isDailyLocked = window.currentAttState.dailyLocks[d] || false;
    let dailyLockIcon = isDailyLocked ? 'fa-lock' : 'fa-unlock';
    let dailyLockClass = isDailyLocked ? 'locked' : 'unlocked';

    headHTML += `
            <th class="${colClass}" style="min-width: 90px; text-align: center; position:sticky; top:0; z-index:10;">
                ${
                  !(isFriday || isHoliday) && !window.currentAttState.locked
                    ? `
                <div class="daily-lock-btn ${dailyLockClass}" data-att-day="${d}" onclick="toggleDailyLock(${d})" title="اس دن کو لاک / ان لاک کریں">
                    <i class="fas ${dailyLockIcon}"></i>
                </div>`
                    : ''
                }
                <div style="font-size:16px;">${d}</div>
                <div style="font-size:11px; font-weight:normal; margin-bottom:5px;">${displayDay}</div>
                ${
                  !(isFriday || isHoliday) &&
                  !window.currentAttState.locked &&
                  !isDailyLocked
                    ? `
                <div class="att-cell-controls">
                    <button class="att-cell-btn att-status-present-action" onclick="masterToggle('${symbols.P}', ${d})">${symbols.P}</button>
                    <button class="att-cell-btn att-status-absent-action" onclick="masterToggle('${symbols.A}', ${d})">${symbols.A}</button>
                    <button class="att-cell-btn att-status-leave-action" onclick="masterToggle('${symbols.L}', ${d})">${symbols.L}</button>
                    <button class="att-cell-btn status-clear" onclick="masterClearColumn(${d})" title="تمام کو صاف / خالی">×</button>
                </div>`
                    : ''
                }
            </th>`;
  }
  thead.innerHTML = headHTML + '</tr>';

  const frag = document.createDocumentFragment();
  if (!pageUsers.length) {
    tbody.innerHTML = '<tr><td colspan="' + Math.max(2, endDay - startDay + 2) + '" style="text-align:center;color:#94a3b8;padding:24px;">'
      + (attIsTeacherRegister()
        ? 'کوئی استاد نہیں — مہینہ منتخب کر کے «رجسٹر لوڈ کریں» دبائیں'
        : 'کوئی طالب علم نہیں — درجہ اور مہینہ منتخب کر کے «رجسٹر لوڈ کریں» دبائیں')
      + '</td></tr>';
    var emptyPager = document.getElementById('att-register-row-pager');
    if (emptyPager) emptyPager.style.display = 'none';
  } else {

  var teacherMode = attIsTeacherRegister();

  pageUsers.forEach((u) => {
      var uid = attGetUserId(u);
      if (!uid) return;
      if (!window.currentAttState.records[uid])
        window.currentAttState.records[uid] = {};
      if (!window.currentAttState.remarks[uid])
        window.currentAttState.remarks[uid] = {};
      if (!window.currentAttState.late[uid])
        window.currentAttState.late[uid] = {};
      if (!window.currentAttState.periodRecords[uid])
        window.currentAttState.periodRecords[uid] = {};

      let uRecords = window.currentAttState.records[uid];
      let uRemarks = window.currentAttState.remarks[uid];
      let uLate = window.currentAttState.late[uid];

      const tr = document.createElement('tr');
      let rowHtml = `<td style="position:sticky; right:0; background:#f8fafc; z-index:5; border-right: 1px solid #cbd5e1;"><strong>${u.name || ''}</strong><br><small style="color:var(--accent);">${uid}</small></td>`;

      for (let d = startDay; d <= endDay; d++) {
        let currentFullDate = `${year}-${month}-${d < 10 ? '0' + d : d}`;
        let dateObj = new Date(currentFullDate);
        let isFriday = dateObj.getDay() === 5;
        let isHoliday = holidays.some(
          (h) => currentFullDate >= h.start && currentFullDate <= h.end
        );

        let st = attDisplayDayMark(uid, d, dateObj.getDay(), {
          fallback: uRecords[d] || '',
          name: u.name || '',
          className: attGetUserClass(u)
        });
        let statusKind = attStatusKind(st, symbols);
        let remark = uRemarks[d] || '';
        let lateTime = uLate[d] || '';
        let isGlobalLocked = window.currentAttState.locked;
        let isDailyLocked = window.currentAttState.dailyLocks[d] || false;
        let cellLocked = !!(isGlobalLocked || isDailyLocked);

        let cellClass =
          isFriday || isHoliday
            ? 'col-holiday'
            : cellLocked
            ? 'col-locked'
            : 'att-cell-clickable';
        if (remark !== '') cellClass += ' has-hidden-remark';
        if (!isFriday && !isHoliday && !cellLocked) {
          if (!st) cellClass += ' att-cell-empty';
          else if (statusKind === 'P') cellClass += ' att-cell-p';
          else if (statusKind === 'A') cellClass += ' att-cell-a';
          else if (statusKind === 'L') cellClass += ' att-cell-l';
          else if (statusKind === 'partial') cellClass += ' att-cell-partial';
          else if (statusKind === 'incomplete') cellClass += ' att-cell-incomplete';
        }
        if (teacherMode) cellClass += ' att-cell-teacher';

        if (isFriday || isHoliday) {
          rowHtml += `<td class="${cellClass}">تعطیل</td>`;
        } else {
          var periodHtml = teacherMode
            ? attBuildTeacherPeriodBoxesHtml(uid, u.name || '', d, dateObj.getDay(), symbols, cellLocked)
            : '';
          rowHtml += `
                <td class="${cellClass}" onclick="cycleCellStatus(event, '${uid}', ${d})" title="کلک: حاضر → غائب → رخصت → صاف">
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40px;">
                        <span class="print-status-text" id="print-txt-${uid}-${d}">${st}</span>
                        ${lateTime ? `<div style="font-size:10px; color:#e67e22; font-weight:bold; background:#fffaf0; padding:2px 5px; border-radius:4px; margin-top:2px;">${lateTime}</div>` : ''}
                        ${periodHtml}
                    </div>
                    <div class="att-cell-controls" title="یومیہ حاضری (پرانا سسٹم)">
                        <button class="att-cell-btn status-p ${statusKind === 'P' ? 'active' : ''}" onclick="event.stopPropagation(); setCellStatus('${uid}', ${d}, '${symbols.P}')">${symbols.P}</button>
                        <button class="att-cell-btn status-a ${statusKind === 'A' ? 'active' : ''}" onclick="event.stopPropagation(); setCellStatus('${uid}', ${d}, '${symbols.A}')">${symbols.A}</button>
                        <button class="att-cell-btn status-l ${statusKind === 'L' ? 'active' : ''}" onclick="event.stopPropagation(); setCellStatus('${uid}', ${d}, '${symbols.L}')">${symbols.L}</button>
                        <button class="att-cell-btn status-clear ${!st ? 'active' : ''}" onclick="event.stopPropagation(); clearCellStatus('${uid}', ${d})" title="صاف / خالی">×</button>
                        <button class="att-cell-btn status-custom ${lateTime || remark ? 'active' : ''}" onclick="event.stopPropagation(); openCustomStatusModal('${uid}', '${(u.name || '').replace(/'/g, "\\'")}', ${d})" title="تفصیل / تاخیر">+</button>
                    </div>
                </td>`;
        }
      }
      tr.innerHTML = rowHtml;
      frag.appendChild(tr);
  });
  tbody.innerHTML = '';
  tbody.appendChild(frag);

  var pagerHost = document.getElementById('att-register-row-pager');
  if (!pagerHost) {
    pagerHost = document.createElement('div');
    pagerHost.id = 'att-register-row-pager';
    pagerHost.style.cssText = 'margin:10px 0;text-align:center;font-size:13px;';
    tbody.parentElement.parentElement.insertBefore(pagerHost, tbody.parentElement);
  }
  if (totalUsers > rowPageSize) {
    pagerHost.innerHTML = `<span>صفحہ ${safeRowPage} / ${totalRowPages} · ${totalUsers} ${teacherMode ? 'اساتذہ' : 'طلباء'}</span>
      <button type="button" class="btn btn-sm btn-secondary" style="margin:0 6px;" ${safeRowPage <= 1 ? 'disabled' : ''} onclick="window.attRegisterRowPage(${safeRowPage - 1})">پچھلا</button>
      <button type="button" class="btn btn-sm btn-secondary" ${safeRowPage >= totalRowPages ? 'disabled' : ''} onclick="window.attRegisterRowPage(${safeRowPage + 1})">اگلا</button>`;
    pagerHost.style.display = 'block';
  } else {
    pagerHost.style.display = 'none';
  }

  }

  attRefreshLockChrome();

  setupPrintHeader();
  } finally {
    attResumeDictObserver();
  }
}

window.attRegisterRowPage = function (page) {
  window.currentAttState.registerRowPage = Math.max(1, page || 1);
  attQuickRefreshRegister();
};

window.toggleDailyLock = function (day) {
  if (!window.currentAttState) return;
  if (window.currentAttState.locked)
    return window.showToast('پہلے «لاک کھولیں / ترمیم کریں» سے ماہانہ لاک کھولیں!', 'error');
  attEnsureAttStateShape();
  var prev = !!window.currentAttState.dailyLocks[day];
  window.currentAttState.dailyLocks[day] = !prev;
  if (!saveAttState(window.currentAttState.locked)) {
    window.currentAttState.dailyLocks[day] = prev;
    return;
  }
  attQuickRefreshRegister();
  window.showToast(
    window.currentAttState.dailyLocks[day]
      ? `${day} تاریخ لاک کر دی گئی ہے`
      : `${day} تاریخ ان لاک ہو گئی ہے`,
    window.currentAttState.dailyLocks[day] ? 'error' : 'warning'
  );
};

function attForEachFilteredRosterUser(fn) {
  attEnsureAttStateShape();
  var users = typeof getFilteredUsers === 'function' ? getFilteredUsers() : attGetRegisterUsers();
  if (!users || !users.length) return 0;
  var count = 0;
  users.forEach(function (u) {
    var uid = attGetUserId(u);
    if (!uid) return;
    if (!window.currentAttState.records[uid]) window.currentAttState.records[uid] = {};
    if (!window.currentAttState.remarks[uid]) window.currentAttState.remarks[uid] = {};
    if (!window.currentAttState.late[uid]) window.currentAttState.late[uid] = {};
    fn(uid);
    count++;
  });
  return count;
}

function attFindRegisterUser(uid) {
  var users = attGetRegisterUsers() || [];
  var id = String(uid);
  for (var i = 0; i < users.length; i++) {
    if (attGetUserId(users[i]) === id) return users[i];
  }
  return null;
}

function attFindTeacherNameByUid(uid) {
  var u = attFindRegisterUser(uid);
  return u ? (u.name || '') : '';
}

function attTeacherPeriodsForDayNum(uid, day) {
  if (!window.currentAttState || !window.currentAttState.month) return [];
  var parts = String(window.currentAttState.month).split('-');
  var year = parts[0];
  var month = parts[1];
  var full = year + '-' + month + '-' + (day < 10 ? '0' + day : day);
  var wd = new Date(full).getDay();
  return attTeacherPeriodsForRegisterDay(uid, attFindTeacherNameByUid(uid), day, wd);
}

function attStudentPeriodsForDayNum(uid, day) {
  if (!window.currentAttState || !window.currentAttState.month) return [];
  var parts = String(window.currentAttState.month).split('-');
  var year = parts[0];
  var month = parts[1];
  var full = year + '-' + month + '-' + (Number(day) < 10 ? '0' + Number(day) : String(Number(day)));
  var wd = new Date(full).getDay();
  var u = attFindRegisterUser(uid);
  var pmap = window.currentAttState.periodRecords && window.currentAttState.periodRecords[uid]
    && window.currentAttState.periodRecords[uid][day];
  return attStudentPeriodsForRegisterDay(
    attGetUserClass(u) || window.currentAttState.classId || '',
    day,
    wd,
    pmap
  );
}

function attApplyRosterPeriodStatus(uid, day, status) {
  var curPeriod = (window.currentAttState && window.currentAttState.period) || 'all';
  if (attIsTeacherRegister()) {
    // One shared sheet now holds every hour, so a selected hour must not overwrite the rest.
    if (curPeriod && curPeriod !== 'all') {
      var tmap = attEnsurePeriodDayMap(uid, day);
      if (status) tmap[curPeriod] = status;
      else delete tmap[curPeriod];
      if (!Object.keys(tmap).length && window.currentAttState.periodRecords[uid]) {
        delete window.currentAttState.periodRecords[uid][day];
      }
      return;
    }
    var tPeriods = attTeacherPeriodsForDayNum(uid, day);
    if (tPeriods.length) attApplyStatusToAllTeacherPeriods(uid, day, status, tPeriods);
    return;
  }
  if (attIsStaffAttendanceRegister()) return;
  if (curPeriod && curPeriod !== 'all') {
    var pmap = attEnsurePeriodDayMap(uid, day);
    if (status) pmap[curPeriod] = status;
    else delete pmap[curPeriod];
    if (!Object.keys(pmap).length && window.currentAttState.periodRecords[uid]) {
      delete window.currentAttState.periodRecords[uid][day];
    }
    return;
  }
  var sPeriods = attStudentPeriodsForDayNum(uid, day);
  if (sPeriods.length) attApplyStatusToAllTeacherPeriods(uid, day, status, sPeriods);
}

window.setTeacherAllPeriods = function (uid, day, status) {
  if (!window.currentAttState) return;
  if (attGuardSelfAttendanceEdit(uid)) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day])
    return window.showToast('یہ انٹری لاک ہے!', 'warning');
  var periods = attTeacherPeriodsForDayNum(uid, day);
  if (!periods.length) {
    if (status) window.setCellStatus(uid, day, status);
    else window.clearCellStatus(uid, day);
    return;
  }
  attApplyStatusToAllTeacherPeriods(uid, day, status || '', periods);
  attRefreshCellUI(uid, day);
  saveAttState(false, { quiet: true });
};

window.cycleTeacherPeriodStatus = function (uid, day, periodId) {
  if (!window.currentAttState) return;
  if (attGuardSelfAttendanceEdit(uid)) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day])
    return window.showToast('یہ انٹری لاک ہے!', 'warning');
  var symbols = attGetAttSymbols();
  var pmap = attEnsurePeriodDayMap(uid, day);
  var st = pmap[periodId] || '';
  if (!st) pmap[periodId] = symbols.P;
  else if (st === symbols.P) pmap[periodId] = symbols.A;
  else if (st === symbols.A) pmap[periodId] = symbols.L;
  else if (st === symbols.L) delete pmap[periodId];
  else pmap[periodId] = symbols.P;
  if (!Object.keys(pmap).length && window.currentAttState.periodRecords[uid]) {
    delete window.currentAttState.periodRecords[uid][day];
  }
  attSyncLegacyFromPeriods(uid, day);
  attRefreshCellUI(uid, day);
  saveAttState(false, { quiet: true });
};

window.setTeacherPeriodStatus = function (uid, day, periodId, status) {
  if (!window.currentAttState) return;
  if (attGuardSelfAttendanceEdit(uid)) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day])
    return window.showToast('یہ انٹری لاک ہے!', 'warning');
  var pmap = attEnsurePeriodDayMap(uid, day);
  if (status) pmap[periodId] = status;
  else delete pmap[periodId];
  if (!Object.keys(pmap).length && window.currentAttState.periodRecords[uid]) {
    delete window.currentAttState.periodRecords[uid][day];
  }
  attSyncLegacyFromPeriods(uid, day);
  attRefreshCellUI(uid, day);
  saveAttState(false, { quiet: true });
};

window.masterToggle = function (status, day) {
  if (!window.currentAttState) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day]) return;
  var selfSkipped = false;
  var teacherMode = attIsTeacherRegister();
  attForEachFilteredRosterUser(function (uid) {
    if (attIsSelfAttendanceEditBlocked(uid)) { selfSkipped = true; return; }
    window.currentAttState.records[uid][day] = status;
    window.currentAttState.remarks[uid][day] = '';
    window.currentAttState.late[uid][day] = '';
    if (teacherMode) {
      var periods = attTeacherPeriodsForDayNum(uid, day);
      if (periods.length) attApplyStatusToAllTeacherPeriods(uid, day, status, periods);
    } else {
      attApplyRosterPeriodStatus(uid, day, status);
    }
  });
  if (selfSkipped && typeof window.showToast === 'function') {
    window.showToast('آپ اپنی حاضری خود درج نہیں کر سکتے۔', 'error');
  }
  saveAttState(false);
  buildSmartRegister(window.currentAttState.month, getFilteredUsers());
};

window.masterClearColumn = function (day) {
  if (!window.currentAttState) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day]) return;
  if (!confirm('اس دن کی تمام حاضری خالی کریں؟')) return;
  var selfSkipped = false;
  var cleared = [];
  attForEachFilteredRosterUser(function (uid) {
    if (attIsSelfAttendanceEditBlocked(uid)) { selfSkipped = true; return; }
    attDeleteDayEntry(window.currentAttState.records, uid, day);
    attDeleteDayEntry(window.currentAttState.remarks, uid, day);
    attDeleteDayEntry(window.currentAttState.late, uid, day);
    attClearTeacherPeriodsForDay(uid, day);
    cleared.push({ uid: uid, day: day });
  });
  if (selfSkipped && typeof window.showToast === 'function') {
    window.showToast('آپ اپنی حاضری خود درج نہیں کر سکتے۔', 'error');
  }
  saveAttState(false, { clearCells: cleared, immediateCloud: true });
  buildSmartRegister(window.currentAttState.month, getFilteredUsers());
};

window.setCellStatus = function (uid, day, status) {
  if (!window.currentAttState) return;
  if (attGuardSelfAttendanceEdit(uid)) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day])
    return window.showToast('یہ انٹری لاک ہے!', 'warning');
  if (!window.currentAttState.records[uid]) window.currentAttState.records[uid] = {};
  window.currentAttState.records[uid][day] = status;
  if (attIsTeacherRegister()) {
    var periods = attTeacherPeriodsForDayNum(uid, day);
    if (periods.length) attApplyStatusToAllTeacherPeriods(uid, day, status, periods);
  } else {
    attApplyRosterPeriodStatus(uid, day, status);
  }
  attRefreshCellUI(uid, day);
  saveAttState(false, { quiet: true });
};

window.clearCellStatus = function (uid, day) {
  if (!window.currentAttState) return;
  if (attGuardSelfAttendanceEdit(uid)) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day])
    return window.showToast('یہ انٹری لاک ہے!', 'warning');
  attDeleteDayEntry(window.currentAttState.records, uid, day);
  attDeleteDayEntry(window.currentAttState.remarks, uid, day);
  attDeleteDayEntry(window.currentAttState.late, uid, day);
  attClearTeacherPeriodsForDay(uid, day);
  attRefreshCellUI(uid, day);
  // Force Firebase map-replace + immediate flush (same outbox as P/A/L).
  saveAttState(false, { quiet: true, clearCells: [{ uid: uid, day: day }], immediateCloud: true });
};

window.cycleCellStatus = function (ev, uid, day) {
  if (ev && ev.target && ev.target.closest && ev.target.closest('.att-cell-btn, .att-cell-controls')) return;
  if (!window.currentAttState) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day]) return;
  var symbols = {};
  try {
    symbols = JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
  } catch (eSym) {
    symbols = { P: 'P', A: 'A', L: 'L' };
  }
  var st = (window.currentAttState.records[uid] && window.currentAttState.records[uid][day]) || '';
  if (!st) window.setCellStatus(uid, day, symbols.P);
  else if (st === symbols.P) window.setCellStatus(uid, day, symbols.A);
  else if (st === symbols.A) window.setCellStatus(uid, day, symbols.L);
  else if (st === symbols.L) window.clearCellStatus(uid, day);
  else window.setCellStatus(uid, day, symbols.P);
};

let tempCustomTarget = {};
window.openCustomStatusModal = function (uid, name, day) {
  if (attGuardSelfAttendanceEdit(uid)) return;
  if (window.currentAttState.locked || window.currentAttState.dailyLocks[day])
    return window.showToast('یہ دن لاک ہے!', 'warning');
  tempCustomTarget = { uid, day };
  document.getElementById('custom-status-student-name').innerText = name;

  let currentLate = window.currentAttState.late[uid] ? window.currentAttState.late[uid][day] || '' : '';
  let currentRemark = window.currentAttState.remarks[uid] ? window.currentAttState.remarks[uid][day] || '' : '';

  document.getElementById('custom-late-input').value = currentLate;
  document.getElementById('custom-reason-input').value = currentRemark;
  window.openModal('add-custom-status-modal');
};

document.getElementById('btn-apply-custom-status')?.addEventListener('click', () => {
    let lateText = document.getElementById('custom-late-input').value.trim();
    let reasonText = document.getElementById('custom-reason-input').value.trim();

    if (tempCustomTarget.uid) {
      if (attGuardSelfAttendanceEdit(tempCustomTarget.uid)) return;
      if (!window.currentAttState.late[tempCustomTarget.uid])
        window.currentAttState.late[tempCustomTarget.uid] = {};
      window.currentAttState.late[tempCustomTarget.uid][tempCustomTarget.day] = lateText;

      if (!window.currentAttState.remarks[tempCustomTarget.uid])
        window.currentAttState.remarks[tempCustomTarget.uid] = {};
      window.currentAttState.remarks[tempCustomTarget.uid][tempCustomTarget.day] = reasonText;

      saveAttState(window.currentAttState.locked);
      buildSmartRegister(window.currentAttState.month, getFilteredUsers());
      window.closeModal('add-custom-status-modal');
    }
  });

function attCanonicalStudentKeys(month, classId) {
  return attSheetKeys(month, 'students', classId, 'all');
}

function attOverlayCanonicalPeriodMarks(month, classId, period, rec) {
  rec = rec || attEmptyAttendanceRecord();
  if (!period || period === 'all' || !classId) return rec;
  var keys = attCanonicalStudentKeys(month, classId);
  var canon = attReadSheetLocal(keys.localKey || keys.cloudDocId);
  if (!canon || !canon.periodRecords) return rec;
  rec.records = rec.records || {};
  rec.periodRecords = rec.periodRecords || {};
  Object.keys(canon.periodRecords).forEach(function (uid) {
    var days = canon.periodRecords[uid] || {};
    Object.keys(days).forEach(function (day) {
      var st = days[day] && days[day][period];
      if (st == null || st === '') return;
      if (!rec.records[uid]) rec.records[uid] = {};
      rec.records[uid][day] = st;
      if (!rec.periodRecords[uid]) rec.periodRecords[uid] = {};
      if (!rec.periodRecords[uid][day]) rec.periodRecords[uid][day] = {};
      rec.periodRecords[uid][day][period] = st;
    });
  });
  return rec;
}

function attMirrorCurrentToCanonical(dataToSave, opts) {
  opts = opts || {};
  if (attIsCanonicalUnified()) return;
  var st = window.currentAttState;
  if (!st || st.type !== 'students' || !st.classId || !st.month) return;
  var period = st.period || 'all';
  if (!period || period === 'all') return;
  var keys = attCanonicalStudentKeys(st.month, st.classId);
  var canon = attNormalizeRecord(attReadSheetLocal(keys.localKey || keys.cloudDocId) || attEmptyAttendanceRecord());
  var symbols = attGetAttSymbols();
  function touchDay(uid, day, status) {
    if (!canon.periodRecords[uid]) canon.periodRecords[uid] = {};
    if (!canon.periodRecords[uid][day]) canon.periodRecords[uid][day] = {};
    if (status) canon.periodRecords[uid][day][period] = status;
    else delete canon.periodRecords[uid][day][period];
    if (!Object.keys(canon.periodRecords[uid][day]).length) {
      delete canon.periodRecords[uid][day];
    }
    var u = attFindRegisterUser(uid);
    var parts = String(st.month).split('-');
    var dnum = Number(day);
    var dd = dnum < 10 ? '0' + dnum : String(dnum);
    var wd = new Date(parts[0] + '-' + parts[1] + '-' + dd).getDay();
    var periods = attStudentPeriodsForWeekday(attGetUserClass(u) || st.classId, wd);
    var ids = periods.map(function (p) { return p.id; });
    var rolled = attRollupPeriodDayStatus(canon.periodRecords[uid][day] || {}, symbols, ids);
    if (!canon.records[uid]) canon.records[uid] = {};
    if (rolled) canon.records[uid][day] = rolled;
    else delete canon.records[uid][day];
  }
  Object.keys(dataToSave.periodRecords || {}).forEach(function (uid) {
    Object.keys(dataToSave.periodRecords[uid] || {}).forEach(function (day) {
      var pmap = dataToSave.periodRecords[uid][day] || {};
      var mark = pmap[period];
      if (mark != null && mark !== '') touchDay(uid, day, mark);
    });
  });
  (opts.clearCells || []).forEach(function (c) {
    if (!c || !c.uid) return;
    touchDay(c.uid, c.day, '');
  });
  var payload = {
    locked: !!canon.locked,
    records: attPruneDayStatusMap(canon.records || {}),
    dailyLocks: canon.dailyLocks || {},
    remarks: canon.remarks || {},
    late: canon.late || {},
    periodRecords: attPrunePeriodRecordsMap(canon.periodRecords || {}),
    timestamp: attMarkLocalWrite()
  };
  attPersistSheetPayload(keys, payload, { quiet: true, immediateCloud: true });
}

function attPersistSheetPayload(keys, dataToSave, opts) {
  opts = opts || {};
  var cloudDocId = typeof keys === 'string' ? keys : (keys && keys.cloudDocId);
  var localKey = typeof keys === 'string' ? keys : ((keys && keys.localKey) || cloudDocId);
  if (!cloudDocId || !dataToSave) return false;
  if (typeof window.emsStampDepartment === 'function') {
    window.emsStampDepartment(dataToSave);
  }
  var prevSheet = attReadSheetLocal(localKey);
  var cloudPatch = attComputeSheetCloudPatch(prevSheet, dataToSave);
  if (opts.clearCells && opts.clearCells.length) {
    cloudPatch = attAppendForcedClearPatch(cloudPatch, opts.clearCells, dataToSave);
  } else if (attPatchHasClears(cloudPatch)) {
    cloudPatch = attAppendForcedClearPatch(cloudPatch, [], dataToSave);
  }
  var localOk = attPersistSheetLocal(cloudDocId, localKey, dataToSave);
  if (!localOk) return false;
  if (typeof window.emsIsAttendanceModuleActive === 'function' && window.emsIsAttendanceModuleActive()) {
    attScheduleDashboardRefreshFromSave();
  }
  if (typeof window.emsOfflinePersistAttendance === 'function') {
    attScheduleCloudPersist(
      cloudDocId,
      localKey,
      dataToSave,
      !opts.quiet,
      cloudPatch,
      { immediate: !!(opts.immediateCloud || (opts.clearCells && opts.clearCells.length)) }
    );
  }
  if (localOk && attIsCanonicalUnified() && opts.classId && opts.month) {
    var canonKeys = attCanonicalStudentKeys(opts.month, opts.classId);
    if (cloudDocId === canonKeys.cloudDocId) {
      attNotifyCanonicalUpdated(opts.classId, opts.month, dataToSave);
    }
  }
  return localOk;
}

function attLoadCanonicalClassSheet(month, classId) {
  var keys = attCanonicalStudentKeys(month, classId);
  var tenant = getAttendanceTenantId() || 'local';
  var fresh = typeof window.emsAttEnsureMonthFresh === 'function'
    ? window.emsAttEnsureMonthFresh(month)
    : Promise.resolve({ ok: false, localOnly: true });
  return fresh.then(function () {
    return attAdoptLegacyPeriodSheets(keys, month, 'students', classId);
  }).then(function (adopted) {
    if (adopted) return adopted;
    if (typeof window.emsOfflineGetCachedAttendance === 'function') {
      return window.emsOfflineGetCachedAttendance(keys.cloudDocId, { localKey: keys.localKey });
    }
    return attReadSheetLocal(keys.localKey || keys.cloudDocId);
  }).then(function (local) {
    if (local && attHasMeaningfulAttendanceData(local)) return local;
    return attFetchAttendanceSheet(tenant, keys);
  }).then(function (data) {
    return { keys: keys, classId: classId, data: attNormalizeRecord(data || attEmptyAttendanceRecord()) };
  });
}

/** Canonical month sheet for teachers or staff (classId="" period=all). */
function attLoadStaffTypeSheet(month, type) {
  var keys = attSheetKeys(month, type, '', 'all');
  var tenant = getAttendanceTenantId() || 'local';
  var fresh = typeof window.emsAttEnsureMonthFresh === 'function'
    ? window.emsAttEnsureMonthFresh(month)
    : Promise.resolve({ ok: false, localOnly: true });
  return fresh.then(function () {
    return attAdoptLegacyPeriodSheets(keys, month, type, '');
  }).then(function (adopted) {
    if (adopted) return adopted;
    if (typeof window.emsOfflineGetCachedAttendance === 'function') {
      return window.emsOfflineGetCachedAttendance(keys.cloudDocId, { localKey: keys.localKey });
    }
    return attReadSheetLocal(keys.localKey || keys.cloudDocId);
  }).then(function (local) {
    if (local && attHasMeaningfulAttendanceData(local)) return local;
    return attFetchAttendanceSheet(tenant, keys);
  }).then(function (data) {
    return { keys: keys, sheetType: type, data: attNormalizeRecord(data || attEmptyAttendanceRecord()) };
  });
}

/** True when a teacher has an active timetable period for the given class name. */
function attTeacherServesClass(teacherUid, teacherName, className) {
  var uid = String(teacherUid || '').trim();
  var cls = String(className || '').trim();
  if (!uid || !cls) return false;
  return attReadTimetablePeriods().some(function (p) {
    if (!p || !p.id || attIsPeriodArchived(p)) return false;
    if (String(p.className || '').trim() !== cls) return false;
    return attPeriodTeacherIdMatches(p, uid);
  });
}

/** Filter teachers to those teaching any of the given class names (timetable-based). */
function attFilterTeachersByClassScopes(teachers, classIds) {
  var ids = Array.isArray(classIds) ? classIds.filter(Boolean) : [];
  if (!ids.length) return teachers || [];
  return (teachers || []).filter(function (u) {
    var uid = attGetUserId(u);
    if (!uid) return false;
    for (var i = 0; i < ids.length; i++) {
      if (attTeacherServesClass(uid, u.name || '', ids[i])) return true;
    }
    return false;
  });
}

function attAdoptCanonicalIntoOpenRegister(classId, month, data) {
  var st = window.currentAttState;
  if (!st || st.type !== 'students' || st.month !== month || String(st.classId) !== String(classId)) return;
  if (!data) return;
  st.records = data.records || {};
  st.periodRecords = data.periodRecords || {};
  if (data.remarks) st.remarks = data.remarks;
  if (data.late) st.late = data.late;
  if (typeof data.locked === 'boolean') st.locked = data.locked;
  if (!attIsCanonicalUnified() && st.period && st.period !== 'all') {
    attOverlayCanonicalPeriodMarks(month, classId, st.period, st);
  }
  attQuickRefreshRegister();
}

function attListAttendanceClasses() {
  var classes = [];
  if (typeof window.emsRegRepoCollectClasses === 'function') {
    classes = window.emsRegRepoCollectClasses() || [];
  }
  var repoCount = typeof window.emsRegRepoGetCount === 'function' ? window.emsRegRepoGetCount() : 0;
  if (!classes.length && repoCount > 0 && typeof window.emsRegRepoForEach === 'function') {
    var seen = Object.create(null);
    window.emsRegRepoForEach(function (u) {
      if (!u || !attUserMatchesType(u, 'student')) return;
      var c = attGetUserClass(u);
      if (!c || c === 'نامعلوم' || seen[c]) return;
      seen[c] = true;
      classes.push(c);
    });
    classes.sort();
  }
  if (!classes.length) {
    var users = attGetUsers();
    if (typeof window.emsFilterByDepartment === 'function') {
      users = window.emsFilterByDepartment(users);
    }
    classes = [];
    var seen2 = Object.create(null);
    (users || []).forEach(function (u) {
      if (!attUserMatchesType(u, 'student')) return;
      var c = attGetUserClass(u);
      if (!c || c === 'نامعلوم' || seen2[c]) return;
      seen2[c] = true;
      classes.push(c);
    });
    classes.sort();
  }
  return classes;
}

function attWritePeriodOnSheetData(data, uid, day, periodId, status, expectedIds) {
  if (!data) return;
  data.periodRecords = data.periodRecords || {};
  data.records = data.records || {};
  if (!data.periodRecords[uid]) data.periodRecords[uid] = {};
  if (!data.periodRecords[uid][day]) data.periodRecords[uid][day] = {};
  if (status) data.periodRecords[uid][day][periodId] = status;
  else delete data.periodRecords[uid][day][periodId];
  if (!Object.keys(data.periodRecords[uid][day]).length) {
    delete data.periodRecords[uid][day];
  }
  var rolled = attRollupPeriodDayStatus(
    data.periodRecords[uid][day] || {},
    attGetAttSymbols(),
    expectedIds
  );
  if (!data.records[uid]) data.records[uid] = {};
  if (rolled) data.records[uid][day] = rolled;
  else delete data.records[uid][day];
}

/** Clear one person's complete day, including hidden/archived hour marks. */
function attClearDayOnSheetData(data, uid, day) {
  if (!data || !uid || day == null) return false;
  data.records = data.records || {};
  data.remarks = data.remarks || {};
  data.late = data.late || {};
  data.periodRecords = data.periodRecords || {};
  attDeleteDayEntry(data.records, uid, day);
  attDeleteDayEntry(data.remarks, uid, day);
  attDeleteDayEntry(data.late, uid, day);
  attDeleteDayEntry(data.periodRecords, uid, day);
  return true;
}

window.attStudentPeriodsForWeekday = attStudentPeriodsForWeekday;
window.attStudentPeriodsForRegisterDay = attStudentPeriodsForRegisterDay;
window.attTeacherPeriodsForWeekday = attTeacherPeriodsForWeekday;
window.attTeacherPeriodsForRegisterDay = attTeacherPeriodsForRegisterDay;
window.attPeriodTeacherIdMatches = attPeriodTeacherIdMatches;
window.attFindUniqueTeacherIdByName = attFindUniqueTeacherIdByName;
window.attMigrateLegacyPeriodTeacherIds = attMigrateLegacyPeriodTeacherIds;
window.attResolvePeriodById = attResolvePeriodById;
window.attIsPeriodArchived = attIsPeriodArchived;
window.attActiveTimetablePeriods = attActiveTimetablePeriods;
window.attReadAllTimetablePeriodsRaw = attReadAllTimetablePeriodsRaw;
window.attRemovePeriodById = attRemovePeriodById;
window.attRollupPeriodDayStatus = attRollupPeriodDayStatus;
window.attDisplayDayMark = attDisplayDayMark;
window.attSheetKeys = attSheetKeys;
window.attResolveSheetKeys = attResolveSheetKeys;
window.getAttendanceTenantId = getAttendanceTenantId;
window.attNormalizeStorageScope = attNormalizeStorageScope;
window.attLegacyTeacherStaffSheetKeys = attLegacyTeacherStaffSheetKeys;
window.attHasMeaningfulAttendanceData = attHasMeaningfulAttendanceData;
window.attIsCanonicalUnified = attIsCanonicalUnified;
window.attNotifyCanonicalUpdated = attNotifyCanonicalUpdated;
window.attCanonicalStudentKeys = attCanonicalStudentKeys;
window.attPersistSheetPayload = attPersistSheetPayload;
window.attLoadCanonicalClassSheet = attLoadCanonicalClassSheet;
window.attLoadStaffTypeSheet = attLoadStaffTypeSheet;
window.attTeacherServesClass = attTeacherServesClass;
window.attFilterTeachersByClassScopes = attFilterTeachersByClassScopes;
window.attAdoptCanonicalIntoOpenRegister = attAdoptCanonicalIntoOpenRegister;
window.attListAttendanceClasses = attListAttendanceClasses;
function attWriteDayMarkOnSheetData(data, uid, day, status) {
  if (!data) return;
  data.records = data.records || {};
  if (!data.records[uid]) data.records[uid] = {};
  if (status) data.records[uid][day] = status;
  else delete data.records[uid][day];
}

window.attWritePeriodOnSheetData = attWritePeriodOnSheetData;
window.attWriteDayMarkOnSheetData = attWriteDayMarkOnSheetData;
window.attClearDayOnSheetData = attClearDayOnSheetData;
window.attNextLocalWriteTimestamp = attMarkLocalWrite;
window.attGetAttSymbols = attGetAttSymbols;
window.attStatusKind = attStatusKind;
window.attDisplayStatus = attDisplayStatus;
window.attGetUserId = attGetUserId;
window.attGetUserClass = attGetUserClass;
window.attCollectTargetsFromRepo = attCollectTargetsFromRepo;
window.attResolveTargetUsers = attResolveTargetUsers;
window.attEscJsStr = attEscJsStr;
window.attPruneDayStatusMap = attPruneDayStatusMap;
window.attPrunePeriodRecordsMap = attPrunePeriodRecordsMap;
window.attMergeCloudPatches = attMergeCloudPatches;
window.attComputeSheetCloudPatch = attComputeSheetCloudPatch;
window.attAppendForcedClearPatch = attAppendForcedClearPatch;
window.attDiffPeriodRecordsPatch = attDiffPeriodRecordsPatch;
window.ATT_ROLLUP_PARTIAL = ATT_ROLLUP_PARTIAL;
window.ATT_ROLLUP_INCOMPLETE = ATT_ROLLUP_INCOMPLETE;
window.attFlushAllDeferredCloud = attFlushPendingCloudPersist;

function saveAttState(isLocked, opts) {
    opts = opts || {};
    if (typeof window.emsRequireStaffAction === 'function') {
        if (!window.emsRequireStaffAction('attendance', 'edit')) return false;
    }
    var uid = getAttendanceTenantId() || 'local';
    if (!window.currentAttState || !window.currentAttState.dbKey) {
      if (typeof window.showToast === 'function') {
        window.showToast('پہلے رجسٹر لوڈ کریں', 'error');
      }
      return false;
    }

    if (typeof window.emsIsAttendanceModuleActive === 'function' && window.emsIsAttendanceModuleActive()) {
      attScheduleDashboardRefreshFromSave();
    }

    attEnsureAttStateShape();
    window.currentAttState.locked = !!isLocked;
    var now = attMarkLocalWrite();

    // Deep clone so durable/IDB snapshot keeps clears even if UI state mutates later.
    var dataToSave = {
        locked: !!isLocked,
        records: attPruneDayStatusMap(JSON.parse(JSON.stringify(window.currentAttState.records || {}))),
        dailyLocks: JSON.parse(JSON.stringify(window.currentAttState.dailyLocks || {})),
        remarks: JSON.parse(JSON.stringify(window.currentAttState.remarks || {})),
        late: JSON.parse(JSON.stringify(window.currentAttState.late || {})),
        periodRecords: attPrunePeriodRecordsMap(JSON.parse(JSON.stringify(window.currentAttState.periodRecords || {}))),
        timestamp: now
    };
    window.currentAttState.records = dataToSave.records;
    window.currentAttState.dailyLocks = dataToSave.dailyLocks;
    window.currentAttState.remarks = dataToSave.remarks;
    window.currentAttState.late = dataToSave.late;
    window.currentAttState.periodRecords = dataToSave.periodRecords;
    if (typeof window.emsStampDepartment === 'function') {
        window.emsStampDepartment(dataToSave);
    }

    var cloudDocId = window.currentAttState.dbKey;
    var localKey = window.currentAttState.localKey || cloudDocId;
    var prevSheet = attReadSheetLocal(localKey);
    var cloudPatch = attComputeSheetCloudPatch(prevSheet, dataToSave);
    if (opts.clearCells && opts.clearCells.length) {
      cloudPatch = attAppendForcedClearPatch(cloudPatch, opts.clearCells, dataToSave);
    } else if (attPatchHasClears(cloudPatch)) {
      cloudPatch = attAppendForcedClearPatch(cloudPatch, [], dataToSave);
    }
    attSaveLastSession(
      window.currentAttState.month,
      window.currentAttState.type,
      window.currentAttState.classId,
      window.currentAttState.period
    );

    var localOk = attPersistSheetLocal(cloudDocId, localKey, dataToSave);
    if (!localOk) {
      if (typeof window.attSaveStatusMarkLocal === 'function') {
        window.attSaveStatusMarkLocal(cloudDocId, 'failed');
      }
      if (typeof window.showToast === 'function') {
        window.showToast('حاضری لوکل محفوظ ناکام', 'error');
      }
      return false;
    }
    if (typeof window.attSaveStatusSetSmartDoc === 'function') {
      window.attSaveStatusSetSmartDoc(cloudDocId);
    }
    if (typeof window.attSaveStatusMarkLocal === 'function') {
      window.attSaveStatusMarkLocal(cloudDocId, 'saved');
    }

    if (typeof window.emsOfflinePersistAttendance === 'function') {
        attScheduleCloudPersist(
          cloudDocId,
          localKey,
          dataToSave,
          !opts.quiet,
          cloudPatch,
          { immediate: !!(opts.immediateCloud || (opts.clearCells && opts.clearCells.length)) }
        );
    } else if (typeof window.showToast === 'function') {
        window.showToast('خرابی: حاضری سنک outbox تیار نہیں — مقامی محفوظ ہو گیا', 'warning');
    }

    if (typeof window.emsLogAudit === 'function') {
        window.emsLogAudit('attendance', isLocked ? 'lock' : 'save', cloudDocId || '', {
            month: window.currentAttState.month,
            classId: window.currentAttState.classId
        });
    }
    if (attIsCanonicalUnified() && window.currentAttState.type === 'students' && window.currentAttState.classId) {
      attNotifyCanonicalUpdated(window.currentAttState.classId, window.currentAttState.month, dataToSave);
    } else {
      attMirrorCurrentToCanonical(dataToSave, opts);
    }
    return true;
}

document.getElementById('btn-att-save-lock')?.addEventListener('click', () => {
  if (!saveAttState(true)) return;
  window.showToast('رجسٹر اس آلے پر محفوظ اور لاک ہو گیا؛ کلاؤڈ حالت اوپر دکھائی جائے گی۔', 'success');
  logAttAudit(
    'رجسٹر لاک',
    `مہینہ: ${window.currentAttState.month}, کلاس: ${window.currentAttState.classId}`
  );
  attQuickRefreshRegister();
});

document.getElementById('btn-att-edit-mode')?.addEventListener('click', () => {
  if (!saveAttState(false)) return;
  window.showToast(
    'لاک اس آلے پر کھل گیا؛ ترمیم محفوظ ہونے کے بعد کلاؤڈ حالت اوپر دکھائی جائے گی۔',
    'warning'
  );
  logAttAudit(
    'ایڈٹ موڈ',
    `رجسٹر ان لاک کیا گیا: ${window.currentAttState.month}`
  );
  attQuickRefreshRegister();
});

document.getElementById('att-lock-check')?.addEventListener('change', function (e) {
  var wantLock = !!e.target.checked;
  if (!window.currentAttState) return;
  if (wantLock && !window.currentAttState.locked) {
    e.target.checked = false;
    if (typeof window.showToast === 'function') {
      window.showToast('لاک کے لیے «محفوظ کریں» بٹن استعمال کریں', 'info');
    }
    return;
  }
  if (!wantLock && window.currentAttState.locked) {
    e.target.checked = true;
    if (typeof window.showToast === 'function') {
      window.showToast('لاک کھولنے کے لیے «لاک کھولیں / ترمیم کریں» دبائیں', 'warning');
    }
  }
});

window.getFilteredUsers = function() {
  if (window.currentAttState && window.currentAttState.targetUsers && window.currentAttState.targetUsers.length) {
    return attFilterEligibleUsers(window.currentAttState.targetUsers.slice());
  }
  let users = attGetUsers();
  if (typeof window.emsFilterByDepartment === 'function') {
    users = window.emsFilterByDepartment(users);
  }
  var wantType = window.currentAttState.type === 'students'
    ? 'student'
    : window.currentAttState.type === 'teachers'
    ? 'teacher'
    : 'staff';
  let targets = users.filter(function (u) { return attUserMatchesType(u, wantType); });
  if (window.currentAttState.type === 'students') {
    targets = targets.filter(function (u) { return attClassMatches(u, window.currentAttState.classId); });
  }
  return attFilterEligibleUsers(targets);
}

window.setupPrintHeader = function () {
  const settings = JSON.parse(localStorage.getItem('ems_att_settings')) || {};
  const periods = JSON.parse(localStorage.getItem('ems_att_periods')) || [];

  let elMadrasa = document.getElementById('reg-hdr-madrasa');
  if (elMadrasa)
    elMadrasa.innerText = settings.name || 'نام مدرسہ (سیٹنگز سے درج کریں)';

  let elBranch = document.getElementById('reg-hdr-branch');
  if (elBranch) elBranch.innerText = settings.branch || '';

  let elYear = document.getElementById('reg-hdr-year');
  if (elYear) elYear.innerText = settings.year || '-';

  let elClass = document.getElementById('reg-hdr-class');
  if (elClass) elClass.innerText = window.currentAttState.classId || 'تمام';

  let elMonth = document.getElementById('reg-hdr-month');
  if (elMonth) elMonth.innerText = window.currentAttState.month;

  let periodSelect = document.getElementById('att-reg-period');
  let periodId = periodSelect ? periodSelect.value : null;

  let elPeriod = document.getElementById('reg-hdr-period');
  let elTeacher = document.getElementById('reg-hdr-teacher');
  let elTime = document.getElementById('reg-hdr-time');

  if (periodId === 'all' || !periodId) {
    if (elPeriod) elPeriod.innerText = 'اجمالی حاضری / تمام دن';
    if (elTeacher) elTeacher.innerText = '-';
    if (elTime) elTime.innerText = '';
  } else {
    let currentPeriod = periods.find((p) => p.id === periodId);
    if (currentPeriod) {
      var bookLabel = attFormatBookName(currentPeriod.bookName);
      if (elPeriod) elPeriod.innerText = bookLabel ? bookLabel + ' — ' + currentPeriod.name : currentPeriod.name;
      if (elTeacher) elTeacher.innerText = currentPeriod.teacherName || '-';
      if (elTime)
        elTime.innerText = `(${currentPeriod.start} تا ${currentPeriod.end})`;
    }
  }

  let hdr = document.getElementById('att-on-screen-header');
  if (hdr) {
    hdr.style.display = 'block';
    hdr.style.position = 'sticky';
    // مدرسہ کا لوگو (مرکزی برانڈنگ سے) — اوپر دائیں
    const b = window.EmsBranding ? window.EmsBranding.get() : null;
    let logoEl = document.getElementById('att-hdr-logo');
    if (b && b.logo) {
      if (!logoEl) {
        logoEl = document.createElement('img');
        logoEl.id = 'att-hdr-logo';
        logoEl.style.cssText = 'position:absolute; top:12px; right:16px; width:64px; height:64px; object-fit:contain;';
        hdr.appendChild(logoEl);
      }
      logoEl.src = b.logo;
    } else if (logoEl) {
      logoEl.remove();
    }
    if (b && b.madrasaName && elMadrasa && !settings.name) elMadrasa.innerText = b.madrasaName;
  }

  let tbl = document.getElementById('smart-register-table');
  if (tbl) {
    tbl.style.borderTop = 'none';
    tbl.style.borderTopLeftRadius = '0';
    tbl.style.borderTopRightRadius = '0';
  }
};

// ============================================================================
// برانڈڈ پرنٹ (لوگو + نام + مہر + دستخط)  (مرحلہ 6)
// ============================================================================
window.attBrandHeaderHTML = function () {
  const B = window.EmsBranding;
  const s = JSON.parse(localStorage.getItem('ems_att_settings')) || {};
  if (B && typeof B.has === 'function' && B.has() && typeof B.letterHeaderHTML === 'function') {
    return B.letterHeaderHTML();
  }
  return `
    <div style="text-align:center; border-bottom:3px double #2c3e50; padding-bottom:10px; margin-bottom:14px;">
        <h1 style="font-family:'Noto Nastaliq Urdu',serif; margin:0; color:#2c3e50; font-size:30px;">${s.name || 'نام مدرسہ'}</h1>
        <div style="color:#555;">${s.branch || ''}${s.year ? ' • تعلیمی سال: ' + s.year : ''}</div>
    </div>`;
};

window.attSignFooterHTML = function () {
  const B = window.EmsBranding;
  const s = JSON.parse(localStorage.getItem('ems_att_settings')) || {};
  if (B && typeof B.has === 'function' && B.has() && typeof B.signatureBlock === 'function') {
    return '<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:45px; gap:20px;">' +
      B.signatureBlock('دستخط ناظمِ تعلیمات', 'sigNazimTaleem') +
      (typeof B.sealHTML === 'function' ? B.sealHTML(85) : '') +
      B.signatureBlock('دستخط مہتمم', 'sigMohtamim') +
      '</div>';
  }
  return `
    <div style="display:flex; justify-content:space-between; margin-top:55px; font-weight:bold; color:#2c3e50;">
        <div style="border-top:1px solid #2c3e50; padding-top:6px; width:30%; text-align:center;">دستخط ناظمِ تعلیمات</div>
        <div style="border-top:1px solid #2c3e50; padding-top:6px; width:30%; text-align:center;">مہر</div>
        <div style="border-top:1px solid #2c3e50; padding-top:6px; width:30%; text-align:center;">${s.footer || 'دستخط مہتمم'}</div>
    </div>`;
};

// عارضی برانڈڈ ریپر بنا کر پرنٹ — صفحے کا CSS برقرار رہتا ہے
function attPrintWithBranding(innerHTML, title) {
  const wrap = document.createElement('div');
  wrap.id = 'att-print-wrap-temp';
  wrap.style.cssText = 'background:#fff; padding:4px; color:#000;';
  wrap.innerHTML =
    window.attBrandHeaderHTML() +
    (title ? `<h2 style="text-align:center; font-family:'Noto Nastaliq Urdu',serif; margin:4px 0 8px; color:#000; font-size:16px;">${title}</h2>` : '') +
    innerHTML +
    window.attSignFooterHTML();
  document.body.appendChild(wrap);
  if (typeof window.printDiv === 'function') window.printDiv('att-print-wrap-temp');
  setTimeout(() => { const t = document.getElementById('att-print-wrap-temp'); if (t) t.remove(); }, 100);
}

window.attPrintRegister = function () {
  const area = document.getElementById('att-register-print-area');
  if (!area) return;
  const st = window.currentAttState || {};

  // کلون: اسکرین sticky / کنٹرول / تنگ سیلز پرنٹ میں کٹائی نہ کریں
  var clone = area.cloneNode(true);
  clone.querySelectorAll('.att-cell-controls, .daily-lock-btn, .att-period-bulk, .no-print').forEach(function (el) {
    el.remove();
  });
  clone.querySelectorAll('[style]').forEach(function (el) {
    var s = el.getAttribute('style') || '';
    s = s
      .replace(/position\s*:\s*sticky\s*;?/gi, '')
      .replace(/z-index\s*:\s*[^;]+;?/gi, '')
      .replace(/min-height\s*:\s*[^;]+;?/gi, '')
      .replace(/min-width\s*:\s*[^;]+;?/gi, '')
      .replace(/max-width\s*:\s*[^;]+;?/gi, '')
      .replace(/max-height\s*:\s*[^;]+;?/gi, '')
      .replace(/overflow\s*:\s*[^;]+;?/gi, '');
    el.setAttribute('style', s);
  });
  clone.querySelectorAll('#smart-register-table').forEach(function (tbl) {
    tbl.style.minWidth = '0';
    tbl.style.width = '100%';
    tbl.style.tableLayout = 'auto';
  });

  const printCss = `
<style>
@page { size: A3 landscape; margin: 8mm; }
* { box-sizing: border-box; }
body {
  padding: 6px !important; margin: 0 !important;
  background:#fff !important; color:#000 !important;
  overflow: visible !important;
  font-family: "Noto Nastaliq Urdu","Jameel Noori Nastaleeq",serif !important;
}
.att-brand-header, .att-brand-header * { color:#000 !important; background:transparent !important; }
.att-brand-header img { max-height: 48px !important; }
.att-brand-header h1, .att-brand-header h2 { font-size: 18px !important; margin: 4px 0 !important; color:#000 !important; line-height:1.5 !important; }
h2 { font-size:16px !important; margin:4px 0 8px !important; color:#000 !important; line-height:1.5 !important; }

/* معلومات پٹی — سیاہ باؤنڈری + سیاہ لکھائی (پرنٹر بیک گراؤنڈ بند ہو تو بھی نظر آئے) */
.att-print-meta {
  display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; align-items:center;
  background:#000 !important; color:#fff !important;
  -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important;
  padding:6px 10px; margin:0 0 8px; font-size:12px; font-weight:700;
  border:2px solid #000 !important; border-radius:0;
}
.att-print-meta span { color:#fff !important; }

#att-register-print-area, #att-register-print-area * {
  overflow: visible !important; max-height: none !important;
}
#smart-register-table {
  width:100% !important; min-width:0 !important; max-width:100% !important;
  border-collapse:collapse !important; table-layout:auto !important;
  background:#fff !important; color:#000 !important;
  border:2px solid #000 !important; font-size:12px !important;
}
#smart-register-table th, #smart-register-table td {
  border:1px solid #000 !important;
  padding:4px 5px !important;
  vertical-align:middle !important;
  line-height:1.55 !important;
  overflow: visible !important;
  word-wrap: break-word !important;
  overflow-wrap: anywhere !important;
  white-space: normal !important;
  -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important;
}
/* ہیڈر پٹی: سیاہ + سفید لکھائی؛ اگر بیک گراؤنڈ نہ چھپے تو باؤڈر سے پٹی واضح */
#smart-register-table thead th {
  background:#000 !important; color:#fff !important;
  font-size:11px !important; font-weight:800 !important;
  border:1.5px solid #000 !important;
  text-align:center !important;
}
#smart-register-table thead th,
#smart-register-table thead th * {
  color:#fff !important;
  background:#000 !important;
  line-height:1.45 !important;
}
#smart-register-table thead th div { margin:0 !important; padding:1px 0 !important; }
#smart-register-table tbody td {
  background:#fff !important; color:#000 !important; font-size:12px !important;
  text-align:center !important;
}
#smart-register-table tbody td:first-child {
  background:#fff !important; color:#000 !important;
  text-align:right !important;
  min-width:130px !important; max-width:none !important; width:18% !important;
}
#smart-register-table tbody td:first-child,
#smart-register-table tbody td:first-child strong {
  font-size:14px !important; font-weight:700 !important; color:#000 !important;
  line-height:1.55 !important;
}
#smart-register-table tbody td:first-child small {
  font-size:11px !important; font-weight:600 !important; color:#000 !important;
  display:inline-block !important; margin-top:2px !important;
}
.print-status-text {
  display:inline-block !important; font-size:12px !important; color:#000 !important;
  font-weight:800 !important; line-height:1.5 !important;
  min-height:1.2em !important;
}
.att-cell-btn, .daily-lock-btn, .att-period-bulk, .no-print, .att-cell-controls { display:none !important; }
.att-period-box {
  border:1px solid #000 !important; color:#000 !important; background:#fff !important;
  font-size:11px !important; line-height:1.4 !important; padding:1px 3px !important;
}
.col-holiday, .col-holiday-header { background:#fff !important; color:#000 !important; }
#smart-register-table thead th.col-holiday-header,
#smart-register-table thead th.col-holiday-header * {
  background:#000 !important; color:#fff !important;
}
#smart-register-table tbody td > div {
  min-height:0 !important; overflow:visible !important; line-height:1.5 !important;
}
</style>`;
  const info = `
    <div class="att-print-meta">
        <span>درجہ/شعبہ: ${st.classId || 'تمام'}</span>
        <span>مہینہ: ${st.month || '-'}</span>
        <span>قسم: ${st.type || '-'}</span>
    </div>`;
  attPrintWithBranding(printCss + info + clone.innerHTML, 'حاضری رجسٹر');
};

window.attPrintReport = function () {
  var cache = window._attReportRowHtmlCache || [];
  var tbody = document.getElementById('att-report-tbody');
  var scrollWrap = document.getElementById('att-report-scroll-wrap') || attEnsureReportScrollWrap();
  if (tbody && cache.length) {
    tbody.innerHTML = cache.join('');
  }
  const area = document.getElementById('att-report-print-area');
  if (!area) return;
  attPrintWithBranding(area.innerHTML, '');
  if (tbody && cache.length) {
    attRenderChunkedRows({
      tbody: tbody,
      scrollEl: scrollWrap,
      rows: cache,
      footId: 'att-report-chunk-foot',
      disposeKey: 'report'
    });
  }
};

// مرکزی برانڈنگ مینجمنٹ کھولیں (رجسٹریشن ماڈیول)
window.attOpenBranding = function () {
  const tab = document.getElementById('tab-admission');
  if (tab) tab.click();
  setTimeout(() => {
    const bbtn = document.querySelector('#reg-ribbon-menu [onclick*="reg-branding-panel"]');
    if (typeof window.switchRegTab === 'function') window.switchRegTab('reg-branding-panel', bbtn);
  }, 250);
};

// ================== 4. تعطیلات (Holiday Management) ==================
var ATT_SYMBOLS_KEY = 'ems_att_symbols';
var ATT_HOLIDAYS_KEY = 'ems_att_holidays';
var ATT_SETTINGS_KEY = 'ems_att_settings';
var ATT_PERIODS_KEY = 'ems_att_periods';
var ATT_CUSTOM_TEACHERS_KEY = 'ems_att_custom_teachers';
/** Canonical cloud doc: ModuleData/Attendance__ems_att_periods (sync-engine write path). */
var ATT_PERIODS_CANONICAL_CLOUD_DOC = 'Attendance__ems_att_periods';
/** Legacy cloud doc: Attendance_Config/periods (read-only migration source). */
var ATT_PERIODS_LEGACY_CLOUD_COL = 'Attendance_Config';
var ATT_PERIODS_LEGACY_CLOUD_DOC = 'periods';
var ATT_TIMETABLE_CLOUD_LEGACY_MIGRATED_KEY = 'ems_timetable_cloud_legacy_migrated_v1';

function attTimetableCanonicalCloudRef(db, tenantId) {
  if (!db || !tenantId) return null;
  return attTenantSubCol(db, tenantId, 'ModuleData').doc(ATT_PERIODS_CANONICAL_CLOUD_DOC);
}

function attTimetableLegacyCloudRef(db, tenantId) {
  if (!db || !tenantId) return null;
  return attTenantSubCol(db, tenantId, ATT_PERIODS_LEGACY_CLOUD_COL).doc(ATT_PERIODS_LEGACY_CLOUD_DOC);
}

function attCloudDocTimestamp(data) {
  if (!data) return 0;
  if (data.updatedAt) {
    var t = data.updatedAt;
    if (typeof t === 'number') return t;
    if (t && typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t === 'string') return Date.parse(t) || 0;
  }
  return 0;
}

function attTimetableListFromCloudSnapshot(doc) {
  if (!doc || !doc.exists) return null;
  var data = typeof doc.data === 'function' ? doc.data() : doc.data;
  if (!data) return [];
  if (data.data != null) return attParseTimetablePeriodList(data.data);
  if (Array.isArray(data.list)) return data.list;
  return attParseTimetablePeriodList(data);
}

function attTimetableCloudLegacyMigratedPhysicalKey(tenantId) {
  if (typeof window.emsScopedKey === 'function') {
    return window.emsScopedKey(ATT_TIMETABLE_CLOUD_LEGACY_MIGRATED_KEY, tenantId);
  }
  return ATT_TIMETABLE_CLOUD_LEGACY_MIGRATED_KEY + '__' + tenantId;
}

function attIsTimetableCloudLegacyMigrated(tenantId) {
  try {
    var key = attTimetableCloudLegacyMigratedPhysicalKey(tenantId);
    if (window._emsOriginalGetItem) {
      return window._emsOriginalGetItem.call(localStorage, key) === '1';
    }
    return localStorage.getItem(key) === '1';
  } catch (eFlag) { return false; }
}

function attMarkTimetableCloudLegacyMigrated(tenantId) {
  try {
    var key = attTimetableCloudLegacyMigratedPhysicalKey(tenantId);
    if (window._emsOriginalSetItem) {
      window._emsOriginalSetItem.call(localStorage, key, '1');
    } else {
      localStorage.setItem(key, '1');
    }
  } catch (eMark) { /* ignore */ }
}

function attPeriodIdSet(list) {
  var set = Object.create(null);
  (list || []).forEach(function (p) {
    if (p && p.id) set[String(p.id)] = true;
  });
  return set;
}

function attIntersectPeriodIds(a, b) {
  var out = [];
  Object.keys(a || {}).forEach(function (id) {
    if (b && b[id]) out.push(id);
  });
  return out;
}

function attTimetableListsAreDifferentTimetables(a, b) {
  a = Array.isArray(a) ? a : [];
  b = Array.isArray(b) ? b : [];
  if (!a.length || !b.length) return false;
  return attIntersectPeriodIds(attPeriodIdSet(a), attPeriodIdSet(b)).length === 0;
}

function attTimetableRosterClassSet() {
  var set = Object.create(null);
  function add(name) {
    name = String(name || '').trim();
    if (name && name !== 'نامعلوم' && name !== '-') set[name] = true;
  }
  try {
    (typeof attGetUsers === 'function' ? attGetUsers() : []).forEach(function (u) {
      add(typeof attGetUserClass === 'function' ? attGetUserClass(u) : (u && (u.class || u.className)));
    });
  } catch (eUsers) { /* ignore */ }
  try {
    var raw = localStorage.getItem('ems_classes');
    var parsed = raw ? JSON.parse(raw) : [];
    (Array.isArray(parsed) ? parsed : []).forEach(function (c) {
      if (!c) return;
      add(c.name || c.className || c.title);
    });
  } catch (eCls) { /* ignore */ }
  return set;
}

function attTimetableRosterTeacherIdSet() {
  var set = Object.create(null);
  try {
    (typeof attGetUsers === 'function' ? attGetUsers() : []).forEach(function (u) {
      if (!u) return;
      if (typeof attUserMatchesType === 'function' && !attUserMatchesType(u, 'teacher')) return;
      var id = typeof attGetUserId === 'function' ? attGetUserId(u) : (u.id || u.uid || u.userId);
      id = String(id || '').trim();
      if (id) set[id] = true;
    });
  } catch (eTeachers) { /* ignore */ }
  try {
    var custom = attReadConfigJson(ATT_CUSTOM_TEACHERS_KEY, []) || [];
    custom.forEach(function (c) {
      if (c && c.id) set[String(c.id)] = true;
    });
  } catch (eCustom) { /* ignore */ }
  return set;
}

function attTimetableRosterTeacherNameSet() {
  var set = Object.create(null);
  function add(name) {
    name = String(name || '').trim();
    if (name && name !== 'نامعلوم' && name !== '-') set[name] = true;
  }
  try {
    (typeof attGetUsers === 'function' ? attGetUsers() : []).forEach(function (u) {
      if (!u) return;
      if (typeof attUserMatchesType === 'function' && !attUserMatchesType(u, 'teacher')) return;
      add(u.name || u.fullName || u.teacherName);
    });
  } catch (eTeachers) { /* ignore */ }
  try {
    var custom = attReadConfigJson(ATT_CUSTOM_TEACHERS_KEY, []) || [];
    custom.forEach(function (c) {
      add(c && c.name);
    });
  } catch (eCustom) { /* ignore */ }
  return set;
}

function attTimetableRosterHasTeachers() {
  var ids = attTimetableRosterTeacherIdSet();
  var names = attTimetableRosterTeacherNameSet();
  return Object.keys(ids).length > 0 || Object.keys(names).length > 0;
}

function attTimetableTeacherNameBindingKey(name) {
  return String(name || '').replace(/\[.*?\]\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Repair a small number of stale/custom teacher ids in a remote timetable only
 * when the displayed name maps to exactly one registered teacher and at least
 * 80% of the timetable is already bound by valid ids. This lets a mostly-valid
 * tenant timetable heal isolated CTCH ids without weakening the foreign-copy
 * guard for short or unrelated timetables.
 */
function attCanonicalizeRemoteTimetableTeacherBindings(list) {
  list = Array.isArray(list) ? list : [];
  var registered = (typeof attGetUsers === 'function' ? attGetUsers() : []).filter(function (teacher) {
    return teacher && typeof attUserMatchesType === 'function'
      && attUserMatchesType(teacher, 'teacher');
  });
  var registeredIds = Object.create(null);
  var registeredByName = Object.create(null);
  registered.forEach(function (teacher) {
    var id = attGetUserId(teacher);
    if (!id) return;
    registeredIds[id] = true;
    var key = attTimetableTeacherNameBindingKey(teacher.name || teacher.fullName || '');
    if (!key) return;
    if (!registeredByName[key]) registeredByName[key] = [];
    registeredByName[key].push(id);
  });

  var acceptedIds = attTimetableRosterTeacherIdSet();
  var matchedById = 0;
  var repairs = [];
  var unresolved = [];
  list.forEach(function (period, index) {
    if (!period) {
      unresolved.push({ index: index, periodId: '', reason: 'empty_period' });
      return;
    }
    var teacherId = String(period.teacherId || '').trim();
    if (teacherId && registeredIds[teacherId]) {
      matchedById++;
      return;
    }
    var nameKey = attTimetableTeacherNameBindingKey(period.teacherName || '');
    var matches = nameKey ? (registeredByName[nameKey] || []) : [];
    if (teacherId && matches.length === 1) {
      repairs.push({
        index: index,
        periodId: String(period.id || ''),
        previousTeacherId: teacherId,
        teacherId: matches[0]
      });
      return;
    }
    if (teacherId && acceptedIds[teacherId]) {
      matchedById++;
      return;
    }
    // Missing ids remain governed by the existing exact-name ownership rule;
    // this helper only repairs a conflicting/stale id.
    if (!teacherId && matches.length === 1) return;
    unresolved.push({
      index: index,
      periodId: String(period.id || ''),
      teacherId: teacherId,
      reason: matches.length > 1 ? 'teacher_name_not_unique' : 'teacher_not_registered'
    });
  });

  var requiredBound = Math.max(3, Math.ceil(list.length * 0.8));
  var maxRepairCount = Math.max(2, Math.ceil(list.length * 0.1));
  var safe = list.length > 0
    && repairs.length > 0
    && repairs.length <= maxRepairCount
    && matchedById >= requiredBound
    && unresolved.length === 0;
  if (!safe) {
    return {
      list: list,
      repaired: false,
      repairCount: 0,
      proposedRepairs: repairs,
      unresolved: unresolved,
      matchedById: matchedById
    };
  }

  var repairedList = list.map(function (period) {
    return period && typeof period === 'object' ? Object.assign({}, period) : period;
  });
  repairs.forEach(function (repair) {
    repairedList[repair.index].teacherId = repair.teacherId;
  });
  return {
    list: repairedList,
    repaired: true,
    repairCount: repairs.length,
    repairs: repairs,
    unresolved: [],
    matchedById: matchedById
  };
}

function attTimetableListHasTeacherFields(list) {
  return (list || []).some(function (p) {
    if (!p) return false;
    return !!(String(p.teacherId || '').trim() || String(p.teacherName || '').trim());
  });
}

function attTimetableTeacherRosterScore(list) {
  var teacherIds = attTimetableRosterTeacherIdSet();
  var teacherNames = attTimetableRosterTeacherNameSet();
  var score = 0;
  (list || []).forEach(function (p) {
    if (!p) return;
    var tid = String(p.teacherId || '').trim();
    if (tid && teacherIds[tid]) score += 3;
    var tn = String(p.teacherName || '').trim();
    if (tn && teacherNames[tn]) score += 3;
  });
  return score;
}

function attTimetableFailsRosterTeacherBinding(list) {
  list = Array.isArray(list) ? list : [];
  if (!list.length || !attTimetableListHasTeacherFields(list)) return false;
  if (!attTimetableRosterHasTeachers()) return false;
  return attTimetableTeacherRosterScore(list) === 0;
}

/**
 * A cloud timetable is allowed into a tenant only when every lesson can be
 * tied to that tenant's active teacher roster. A teacher id takes precedence
 * over a display name, so a matching name cannot mask a conflicting id.
 */
function attVerifyRemoteTimetableOwnership(list) {
  list = Array.isArray(list) ? list : [];
  if (!list.length) return { ok: false, reason: 'empty_timetable', matched: 0, unmatched: 0 };

  var teacherIds = attTimetableRosterTeacherIdSet();
  var teacherNames = attTimetableRosterTeacherNameSet();
  if (!Object.keys(teacherIds).length && !Object.keys(teacherNames).length) {
    return { ok: false, reason: 'teacher_roster_unavailable', matched: 0, unmatched: list.length };
  }

  var matched = 0;
  var unmatched = [];
  list.forEach(function (period) {
    if (!period) {
      unmatched.push('');
      return;
    }
    var teacherId = String(period.teacherId || '').trim();
    var teacherName = String(period.teacherName || '').trim();
    var owned = teacherId ? !!teacherIds[teacherId] : !!(teacherName && teacherNames[teacherName]);
    if (owned) matched++;
    else unmatched.push(String(period.id || teacherId || teacherName || 'unknown'));
  });

  return {
    ok: matched > 0 && unmatched.length === 0,
    reason: unmatched.length ? 'teacher_roster_mismatch' : (matched ? 'ok' : 'no_teacher_binding'),
    matched: matched,
    unmatched: unmatched.length,
    unmatchedPeriodIds: unmatched
  };
}

function attTimetableRosterHasMembers() {
  var classes = attTimetableRosterClassSet();
  return Object.keys(classes).length > 0 || attTimetableRosterHasTeachers();
}

function attTimetableRosterScore(list) {
  var classes = attTimetableRosterClassSet();
  var classScore = 0;
  (list || []).forEach(function (p) {
    if (!p) return;
    var cn = String(p.className || '').trim();
    if (cn && cn !== '-' && classes[cn]) classScore += 2;
  });
  var teacherScore = attTimetableTeacherRosterScore(list);
  if (attTimetableFailsRosterTeacherBinding(list)) return 0;
  return classScore + teacherScore;
}

function attTimetableListsEqual(a, b) {
  try {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  } catch (eEq) {
    return false;
  }
}

function attRefreshTimetableUi() {
  if (typeof window.loadPeriods === 'function') window.loadPeriods();
  if (typeof window.renderTimetable === 'function') window.renderTimetable();
}

function attChooseBestTimetableCandidate(candidates, tenantId) {
  var viable = [];
  (candidates || []).forEach(function (c) {
    if (!c || !Array.isArray(c.list) || !c.list.length || !c.source) return;
    if (typeof attTimetableFailsRosterTeacherBinding === 'function'
      && attTimetableFailsRosterTeacherBinding(c.list)) {
      return;
    }
    if (typeof attTimetableLooksLikeForeignCopy === 'function'
      && attTimetableLooksLikeForeignCopy(c.list, tenantId)) {
      return;
    }
    viable.push({
      list: c.list,
      source: c.source,
      score: attTimetableRosterScore(c.list),
      persistCanonical: c.persistCanonical
    });
  });
  if (!viable.length) {
    return { list: [], source: 'empty', persistCanonical: false, score: 0 };
  }
  var rank = {
    cloud_legacy: 4,
    quarantine_local: 3,
    local_scoped: 2,
    cloud_canonical: 1
  };
  viable.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return (rank[b.source] || 0) - (rank[a.source] || 0);
  });
  var best = viable[0];
  if (attTimetableRosterHasMembers() && best.score === 0 && viable.length === 1) {
    return { list: [], source: 'roster_reject', persistCanonical: false, score: 0 };
  }
  if (attTimetableRosterHasMembers() && best.score === 0 && viable.length > 1) {
    var legacyPick = viable.find(function (v) { return v.source === 'cloud_legacy'; });
    var quarantinePick = viable.find(function (v) { return v.source === 'quarantine_local'; });
    best = quarantinePick || legacyPick || best;
  }
  var persist = best.persistCanonical;
  if (persist == null) {
    persist = best.source === 'cloud_legacy'
      || best.source === 'quarantine_local'
      || String(best.source || '').indexOf('legacy') >= 0;
  }
  return {
    list: best.list,
    source: best.source,
    persistCanonical: !!persist,
    score: best.score
  };
}

var _attTrustedTimetable = { tenantId: null, list: [], source: '' };

function attRememberTrustedTimetable(tenantId, list, source) {
  _attTrustedTimetable = {
    tenantId: tenantId || null,
    list: Array.isArray(list) ? list : [],
    source: source || ''
  };
}

function attShouldAcceptRemoteTimetable(incoming, tenantId) {
  incoming = Array.isArray(incoming) ? incoming : [];
  if (typeof attTimetableFailsRosterTeacherBinding === 'function'
    && attTimetableFailsRosterTeacherBinding(incoming)) {
    return false;
  }
  if (typeof attTimetableLooksLikeForeignCopy === 'function'
    && attTimetableLooksLikeForeignCopy(incoming, tenantId)) {
    return false;
  }

  // Do not let a short, unrelated cloud list erase a timetable that is already
  // present in this madrasa's partition.  `_attTrustedTimetable` is empty on a
  // fresh page load, so it cannot be the only guard here.  A cloud list may
  // replace a disjoint local list only when its teacher/class evidence is
  // strictly stronger; equal/unknown scores must keep the local timetable.
  var local = typeof attReadAllTimetablePeriodsRaw === 'function'
    ? attReadAllTimetablePeriodsRaw() : [];
  if (local.length) {
    if (!incoming.length) return false;
    if (attTimetableListsAreDifferentTimetables(incoming, local)) {
      return attTimetableRosterScore(incoming) > attTimetableRosterScore(local);
    }
    if (incoming.length < local.length
      && attTimetableRosterScore(incoming) <= attTimetableRosterScore(local)) {
      return false;
    }
  }

  var trusted = _attTrustedTimetable;
  if (!trusted || trusted.tenantId !== tenantId || !trusted.list.length) return true;
  if (!attTimetableListsAreDifferentTimetables(incoming, trusted.list)) return true;
  return attTimetableRosterScore(incoming) > attTimetableRosterScore(trusted.list);
}

/**
 * Device-independent choose: when ModuleData and Attendance_Config hold
 * two different timetables (disjoint period ids), Attendance_Config is this
 * madrasa's original. ModuleData received leaked foreign writes via sync.
 * Does not require another tenant's data to exist on this device.
 */
function attChooseTimetableFromCloudLists(canonList, legacyList, tenantId, opts) {
  opts = opts || {};
  canonList = Array.isArray(canonList) ? canonList : [];
  legacyList = Array.isArray(legacyList) ? legacyList : [];
  var localList = Array.isArray(opts.localList) ? opts.localList : [];
  var quarantineList = Array.isArray(opts.quarantineList) ? opts.quarantineList : [];

  if (!legacyList.length && !canonList.length && !localList.length && !quarantineList.length) {
    return { list: [], source: 'empty', persistCanonical: false, score: 0 };
  }

  if (legacyList.length && canonList.length
    && attTimetableListsAreDifferentTimetables(canonList, legacyList)) {
    var sCanon = attTimetableRosterScore(canonList);
    var sLegacy = attTimetableRosterScore(legacyList);
    if (sLegacy > sCanon) {
      return { list: legacyList, source: 'legacy_roster', persistCanonical: true, score: sLegacy };
    }
    if (sCanon > sLegacy) {
      return { list: canonList, source: 'canonical_roster', persistCanonical: false, score: sCanon };
    }
    return { list: legacyList, source: 'legacy_disjoint', persistCanonical: true, score: sLegacy };
  }

  if (typeof attTimetableLooksLikeForeignCopy === 'function'
    && attTimetableLooksLikeForeignCopy(canonList, tenantId)
    && legacyList.length
    && !attTimetableLooksLikeForeignCopy(legacyList, tenantId)) {
    return {
      list: legacyList,
      source: 'legacy_canon_foreign_local',
      persistCanonical: true,
      score: attTimetableRosterScore(legacyList)
    };
  }

  return attChooseBestTimetableCandidate([
    { list: legacyList, source: 'cloud_legacy' },
    { list: quarantineList, source: 'quarantine_local', persistCanonical: true },
    { list: localList, source: 'local_scoped', persistCanonical: false },
    { list: canonList, source: 'cloud_canonical' }
  ], tenantId);
}

function attApplyTimetableHealChoice(choice, tenantId, generation) {
  if (!choice || !tenantId) {
    return Promise.resolve({ ok: false, reason: 'no_choice' });
  }
  attRememberTrustedTimetable(tenantId, choice.list || [], choice.source || '');
  var localChanged = !attTimetableListsEqual(attReadAllTimetablePeriodsRaw(), choice.list);
  if (localChanged && attSnapshotMayMutateTenantState(tenantId, generation)) {
    if (typeof window.emsOfflineWriteLocalSync === 'function') {
      window.emsOfflineWriteLocalSync(ATT_PERIODS_KEY, choice.list, {
        tenantId: tenantId,
        generation: generation
      });
    }
  }
  if (!choice.persistCanonical || !choice.list.length) {
    if (localChanged) attRefreshTimetableUi();
    return Promise.resolve({
      ok: true,
      healed: localChanged,
      skippedCloud: !choice.persistCanonical,
      reason: choice.source,
      count: (choice.list || []).length
    });
  }
  return attPersistConfigBlob(ATT_PERIODS_KEY, choice.list).then(function (res) {
    if (!res || res.ok === false) throw new Error((res && (res.reason || res.error)) || 'local_write_failed');
    return res;
  }).then(function () {
    attMarkTimetableCloudLegacyMigrated(tenantId);
    attRefreshTimetableUi();
    console.info('[EMS attendance] restored this madrasa timetable', {
      tenantId: tenantId,
      source: choice.source,
      count: choice.list.length,
      score: choice.score
    });
    return {
      ok: true,
      migrated: true,
      healed: true,
      count: choice.list.length,
      source: choice.source,
      destination: 'ModuleData/' + ATT_PERIODS_CANONICAL_CLOUD_DOC
    };
  });
}

window.attChooseBestTimetableCandidate = attChooseBestTimetableCandidate;
window.attApplyTimetableHealChoice = attApplyTimetableHealChoice;
window.attTimetableRosterScore = attTimetableRosterScore;

window.attChooseTimetableFromCloudLists = attChooseTimetableFromCloudLists;
window.attShouldAcceptRemoteTimetable = attShouldAcceptRemoteTimetable;
window.attTimetableListsAreDifferentTimetables = attTimetableListsAreDifferentTimetables;
window.attTimetableFailsRosterTeacherBinding = attTimetableFailsRosterTeacherBinding;
window.attTimetableTeacherRosterScore = attTimetableTeacherRosterScore;
window.attVerifyRemoteTimetableOwnership = attVerifyRemoteTimetableOwnership;
window.attCanonicalizeRemoteTimetableTeacherBindings = attCanonicalizeRemoteTimetableTeacherBindings;

/**
 * Manual, read-from-cloud timetable recovery used by Attendance cloud pull.
 * The tenant id is verified by ems-cloud-pull, but tenant verification alone
 * does not prove that a historic canonical timetable belongs to this madrasa.
 * Keep a non-empty local timetable when the cloud candidate has weaker or
 * equal evidence; this prevents an explicit cloud pull from reviving a known
 * foreign/short list. A new device with no local timetable can still restore
 * a verified canonical document.
 */
window.emsPullAttendanceTimetableFromCloud = function (tenantId) {
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) return Promise.resolve({ ok: false, reason: 'no_tenant', count: 0 });
  var verifiedTenantId = typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null;
  if (!verifiedTenantId || String(verifiedTenantId) !== String(tenantId)) {
    return Promise.resolve({ ok: false, reason: 'tenant_guard', count: 0 });
  }
  var fsDb = typeof db !== 'undefined' ? db : null;
  if (!fsDb && typeof window.emsFirestoreGetDb === 'function') fsDb = window.emsFirestoreGetDb();
  var canonRef = attTimetableCanonicalCloudRef(fsDb, tenantId);
  if (!canonRef) {
    return Promise.resolve({ ok: false, reason: 'firestore_unavailable', count: 0 });
  }
  var generation = typeof window.emsGetTenantGeneration === 'function'
    ? window.emsGetTenantGeneration() : 0;
  return canonRef.get({ source: 'server' }).then(function (snap) {
    if (!snap.exists) return { ok: false, reason: 'timetable_not_found', count: 0 };
    var list = attTimetableListFromCloudSnapshot(snap) || [];
    if (!list.length) return { ok: false, reason: 'empty_cloud_timetable', count: 0 };
    var bindingRepair = attCanonicalizeRemoteTimetableTeacherBindings(list);
    list = bindingRepair.list;
    var ownership = attVerifyRemoteTimetableOwnership(list);
    if (!ownership.ok) {
      return {
        ok: false,
        reason: 'cloud_timetable_rejected',
        count: 0,
        ownership: ownership,
        message: 'کلاؤڈ نظام الاوقات موجودہ مدرسہ کے رجسٹرڈ اساتذہ سے ثابت نہیں ہوا، اس لیے اسے لاگو نہیں کیا گیا۔'
      };
    }
    if (!attShouldAcceptRemoteTimetable(list, tenantId)) {
      return {
        ok: false,
        reason: 'cloud_timetable_rejected',
        count: 0,
        message: 'کلاؤڈ نظام الاوقات مقامی محفوظ فہرست سے کمزور یا غیر متعلق معلوم ہوا، اس لیے اسے لاگو نہیں کیا گیا۔'
      };
    }
    if (!attSnapshotMayMutateTenantState(tenantId, generation)) {
      return { ok: false, reason: 'tenant_guard', count: 0 };
    }
    return attApplyTimetableHealChoice({
      list: list,
      source: 'manual_verified_canonical',
      persistCanonical: false,
      score: attTimetableRosterScore(list)
    }, tenantId, generation).then(function (result) {
      var teachers = Object.create(null);
      list.forEach(function (period) {
        if (!period) return;
        var teacherKey = String(period.teacherId || period.teacherName || '').trim();
        if (teacherKey) teachers[teacherKey] = true;
      });
      attRefreshTimetableUi();
      return Object.assign({}, result || {}, {
        ok: true,
        count: list.length,
        teacherCount: Object.keys(teachers).length,
        repairedTeacherBindingCount: bindingRepair.repairCount || 0,
        source: 'manual_verified_canonical',
        cloudPath: 'All_Madrasas/' + tenantId + '/ModuleData/' + ATT_PERIODS_CANONICAL_CLOUD_DOC
      });
    });
  }).catch(function (err) {
    return { ok: false, reason: 'timetable_pull_failed', count: 0, error: err && err.message };
  });
};

function attHealTimetableLocally(tenantId, generation) {
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) return Promise.resolve({ ok: false, reason: 'no_tenant' });
  var localList = attReadAllTimetablePeriodsRaw();
  var scopedKey = typeof window.emsScopedKey === 'function'
    ? window.emsScopedKey(ATT_PERIODS_KEY, tenantId)
    : ('ems_t_' + tenantId + '__' + ATT_PERIODS_KEY);
  var quarantineKey = scopedKey ? (scopedKey + '_quarantine_v1') : null;
  var quarantineList = quarantineKey && typeof attRawLocalGetPhysical === 'function'
    ? attParseTimetablePeriodList(attRawLocalGetPhysical(quarantineKey))
    : [];
  var choice = attChooseBestTimetableCandidate([
    { list: quarantineList, source: 'quarantine_local', persistCanonical: false },
    { list: localList, source: 'local_scoped', persistCanonical: false }
  ], tenantId);
  if (!choice.list.length) {
    return Promise.resolve({ ok: true, skipped: true, reason: choice.source || 'no_local_candidate' });
  }
  if (!attTimetableListsEqual(localList, choice.list)
    || (attTimetableRosterHasMembers()
      && attTimetableRosterScore(localList) === 0
      && attTimetableRosterScore(choice.list) > 0)) {
    return attApplyTimetableHealChoice(choice, tenantId, generation);
  }
  return Promise.resolve({ ok: true, skipped: true, reason: 'local_ok' });
}

/**
 * One-shot / every-open cloud choose: Attendance_Config vs ModuleData.
 * ModuleData often holds a leaked foreign timetable. Attendance_Config was
 * never written by the leak/sync_module path, so when the two lists have
 * disjoint period ids it is this madrasa's own timetable.
 * The migrated flag must not skip a later disjoint restore.
 */
function attMigrateLegacyCloudTimetablePeriods(tenantId, sourceTenantId, generation) {
  tenantId = tenantId || sourceTenantId;
  if (!tenantId) {
    return Promise.resolve({ ok: false, reason: 'no_tenant' });
  }
  if (attIsOfflineMode()) {
    return attHealTimetableLocally(tenantId, generation);
  }
  var fsDb = typeof db !== 'undefined' ? db : null;
  if (!fsDb) return attHealTimetableLocally(tenantId, generation);

  var canonRef = attTimetableCanonicalCloudRef(fsDb, tenantId);
  var legacyRef = attTimetableLegacyCloudRef(fsDb, tenantId);
  if (!canonRef || !legacyRef) {
    return Promise.resolve({ ok: false, reason: 'no_cloud_ref' });
  }

  return attRecoverStrongLocalLegacyTimetable(tenantId).then(function () {
    return Promise.all([
      canonRef.get({ source: 'server' }).catch(function () { return { exists: false, _readError: true }; }),
      legacyRef.get({ source: 'server' }).catch(function () { return { exists: false, _readError: true }; })
    ]);
  }).then(function (results) {
    var canonDoc = results[0];
    var legacyDoc = results[1];
    if (legacyDoc && legacyDoc._readError) {
      var localKeepOnUnread = typeof attReadAllTimetablePeriodsRaw === 'function'
        ? attReadAllTimetablePeriodsRaw() : [];
      if (localKeepOnUnread.length) {
        attRememberTrustedTimetable(tenantId, localKeepOnUnread, 'local_legacy_unread');
      }
      return { ok: false, reason: 'legacy_unread' };
    }
    var canonList = (canonDoc && canonDoc.exists && !canonDoc._readError)
      ? (attTimetableListFromCloudSnapshot(canonDoc) || []) : [];
    var legacyList = (legacyDoc && legacyDoc.exists)
      ? (attTimetableListFromCloudSnapshot(legacyDoc) || []) : [];
    canonList = attCanonicalizeRemoteTimetableTeacherBindings(canonList).list;
    legacyList = attCanonicalizeRemoteTimetableTeacherBindings(legacyList).list;
    var localList = attReadAllTimetablePeriodsRaw();
    var scopedKey = typeof window.emsScopedKey === 'function'
      ? window.emsScopedKey(ATT_PERIODS_KEY, tenantId)
      : ('ems_t_' + tenantId + '__' + ATT_PERIODS_KEY);
    var quarantineKey = scopedKey ? (scopedKey + '_quarantine_v1') : null;
    var quarantineList = quarantineKey && typeof attRawLocalGetPhysical === 'function'
      ? attParseTimetablePeriodList(attRawLocalGetPhysical(quarantineKey))
      : [];
    var choice = attChooseTimetableFromCloudLists(canonList, legacyList, tenantId, {
      localList: localList,
      quarantineList: quarantineList
    });

    if ((!choice.list || !choice.list.length)
      && canonList.length
      && typeof attTimetableFailsRosterTeacherBinding === 'function'
      && attTimetableFailsRosterTeacherBinding(canonList)
      && (!localList.length || attTimetableFailsRosterTeacherBinding(localList))
      && !quarantineList.length
      && !legacyList.length) {
      choice = {
        list: [],
        source: 'purge_foreign_canonical',
        persistCanonical: true,
        score: 0
      };
    }

    if (!attSnapshotMayMutateTenantState(sourceTenantId, generation)) {
      return { ok: false, reason: 'tenant_guard' };
    }

    return attApplyTimetableHealChoice(choice, sourceTenantId, generation);
  }).catch(function (err) {
    return { ok: false, reason: 'migration_error', detail: err && err.message ? String(err.message) : '' };
  });
}

function attEnqueueSyncModuleBlob(key, value) {
  if (typeof window.emsOfflineEnqueueSyncModule !== 'function') {
    return Promise.resolve({ ok: true, synced: false, offline: true });
  }
  var tenantId = typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null;
  if (!tenantId) {
    return Promise.resolve({ ok: false, reason: 'tenant_partition_write_blocked', code: 'TENANT_REQUIRED' });
  }
  var jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
  return window.emsOfflineEnqueueSyncModule(key, jsonStr, {
    module: 'Attendance',
    tenantId: tenantId
  }).then(function (res) {
    if (res && res.ok === false) return res;
    return { ok: true, synced: false, offline: true };
  });
}

/** Local persist + Firestore outbox for attendance config blobs (symbols, holidays, etc.). */
function attPersistConfigBlob(key, value) {
  if (!key) return Promise.resolve({ ok: false, reason: 'no_key' });
  var tenantId = typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null;
  if (typeof window.emsOfflineWriteLocalSync === 'function') {
    if (!window.emsOfflineWriteLocalSync(key, value, { tenantId: tenantId })) {
      return Promise.resolve({ ok: false, reason: 'tenant_partition_write_blocked' });
    }
  } else {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (eWrite) {
      return Promise.resolve({ ok: false, reason: 'local_write_failed' });
    }
  }
  return attEnqueueSyncModuleBlob(key, value);
}

function attParseTimetablePeriodList(raw) {
  if (raw == null) return [];
  try {
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (eParse) { return []; }
}

function attPeriodRecoveryRecency(period) {
  if (!period) return 0;
  return Number(period.updatedAt || period.savedAt || period.archivedAt || period.createdAt || 0);
}

function attRawLocalGetPhysical(key) {
  try {
    if (window._emsOriginalGetItem) {
      return window._emsOriginalGetItem.call(localStorage, key);
    }
    return localStorage.getItem(key);
  } catch (eRaw) { return null; }
}

/**
 * Rescue a former browser-global timetable only when its teacher binding is
 * decisively stronger than the current tenant list. This is deliberately
 * local-only: it never queues a cloud write and never deletes the source.
 */
function attRecoverStrongLocalLegacyTimetable(tenantId) {
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) return Promise.resolve({ ok: false, reason: 'NO_TENANT', restored: 0 });

  var current = attReadAllTimetablePeriodsRaw();
  var idbRead = typeof window.emsIdbKvGet === 'function'
    ? window.emsIdbKvGet(ATT_PERIODS_KEY).catch(function () { return null; })
    : Promise.resolve(null);

  return idbRead.then(function (idbRaw) {
    var byId = Object.create(null);
    [attParseTimetablePeriodList(attRawLocalGetPhysical(ATT_PERIODS_KEY)), attParseTimetablePeriodList(idbRaw)]
      .forEach(function (list) {
        list.forEach(function (period) {
          if (!period || !period.id) return;
          var id = String(period.id);
          var previous = byId[id];
          if (!previous || attPeriodRecoveryRecency(period) >= attPeriodRecoveryRecency(previous)) byId[id] = period;
        });
      });
    var candidate = Object.keys(byId).map(function (id) { return byId[id]; });
    if (!candidate.length || !attTimetableListHasTeacherFields(candidate)) {
      return { ok: true, skipped: true, reason: 'NO_STRONG_LEGACY', restored: 0 };
    }

    var rosterIds = attTimetableRosterTeacherIdSet();
    var rosterNames = attTimetableRosterTeacherNameSet();
    function boundTeacherCount(list) {
      var bound = Object.create(null);
      (list || []).forEach(function (period) {
        if (!period) return;
        var id = String(period.teacherId || '').trim();
        var name = String(period.teacherName || '').trim();
        if (id && rosterIds[id]) bound['id:' + id] = true;
        else if (name && rosterNames[name]) bound['name:' + name] = true;
      });
      return Object.keys(bound).length;
    }

    var candidateScore = attTimetableRosterScore(candidate);
    var currentScore = attTimetableRosterScore(current);
    var candidateTeachers = boundTeacherCount(candidate);
    var currentTeachers = boundTeacherCount(current);
    var isStrong = candidateTeachers >= 3
      && candidateTeachers > currentTeachers
      && candidateScore > currentScore
      && candidate.length > current.length;
    if (!isStrong) {
      return {
        ok: true,
        skipped: true,
        reason: 'LEGACY_NOT_STRONGER',
        restored: 0,
        candidateCount: candidate.length,
        candidateTeachers: candidateTeachers,
        currentCount: current.length,
        currentTeachers: currentTeachers
      };
    }

    var wrote = false;
    if (typeof window.emsOfflineWriteLocalSync === 'function') {
      wrote = window.emsOfflineWriteLocalSync(ATT_PERIODS_KEY, candidate, { tenantId: tenantId }) !== false;
    } else {
      try {
        localStorage.setItem(ATT_PERIODS_KEY, JSON.stringify(candidate));
        wrote = true;
      } catch (eWrite) { wrote = false; }
    }
    if (!wrote) return { ok: false, reason: 'LOCAL_WRITE_FAILED', restored: 0 };

    attRememberTrustedTimetable(tenantId, candidate, 'strong_local_legacy');
    attRefreshTimetableUi();
    try {
      var auditKey = typeof window.emsScopedKey === 'function'
        ? window.emsScopedKey('ems_timetable_strong_legacy_recovery_v1', tenantId)
        : ('ems_timetable_strong_legacy_recovery_v1__' + tenantId);
      if (window._emsOriginalSetItem) {
        window._emsOriginalSetItem.call(localStorage, auditKey, JSON.stringify({
          at: Date.now(), source: ATT_PERIODS_KEY, count: candidate.length, teachers: candidateTeachers
        }));
      }
    } catch (eAudit) { /* local audit only */ }
    return {
      ok: true,
      restored: candidate.length,
      teachers: candidateTeachers,
      source: 'strong_local_legacy',
      cloudWritten: false
    };
  });
}

/**
 * Non-destructive legacy timetable recovery — merges provably-owned global copies
 * into the tenant-scoped canonical partition. Never deletes the legacy source.
 */
function attRecoverLegacyTimetablePeriods(tenantId) {
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) {
    return Promise.resolve({ ok: false, reason: 'NO_TENANT', copied: 0, merged: 0, conflictCount: 0 });
  }
  var destination = typeof window.emsScopedKey === 'function'
    ? window.emsScopedKey(ATT_PERIODS_KEY, tenantId)
    : null;
  if (!destination) {
    return Promise.resolve({ ok: false, reason: 'NO_SCOPED_KEY', copied: 0, merged: 0, conflictCount: 0 });
  }
  if (window.EMS_TENANT_LEGACY_MIGRATION_ALLOWED === false) {
    return Promise.resolve({
      ok: false,
      reason: 'LEGACY_NOT_ATTRIBUTABLE',
      copied: 0,
      merged: 0,
      conflictCount: 0
    });
  }

  var legacyLocal = attParseTimetablePeriodList(attRawLocalGetPhysical(ATT_PERIODS_KEY));
  var legacyIdbRead = typeof window.emsIdbKvGet === 'function'
    ? window.emsIdbKvGet(ATT_PERIODS_KEY)
    : Promise.resolve(null);

  return legacyIdbRead.then(function (legacyIdbRaw) {
    var legacyById = Object.create(null);
    legacyLocal.concat(attParseTimetablePeriodList(legacyIdbRaw)).forEach(function (p) {
      if (!p || !p.id) return;
      var prev = legacyById[p.id];
      if (!prev || attPeriodRecoveryRecency(p) >= attPeriodRecoveryRecency(prev)) {
        legacyById[p.id] = p;
      }
    });
    var legacyIds = Object.keys(legacyById);
    if (!legacyIds.length) {
      return { ok: true, source: ATT_PERIODS_KEY, destination: destination, copied: 0, merged: 0, conflictCount: 0 };
    }

    var foreignIds = {};
    if (typeof attTimetableIdsOverlapOtherTenant === 'function') {
      attTimetableIdsOverlapOtherTenant(
        legacyIds.map(function (id) { return legacyById[id]; }),
        tenantId
      ).forEach(function (hit) {
        (hit.periodIds || []).forEach(function (id) { foreignIds[id] = true; });
      });
    }
    legacyIds = legacyIds.filter(function (id) { return !foreignIds[id]; });
    if (!legacyIds.length) {
      return {
        ok: true,
        skipped: true,
        reason: 'LEGACY_BELONGS_TO_OTHER_TENANT',
        copied: 0,
        merged: 0,
        conflictCount: 0
      };
    }

    var canonical = attReadAllTimetablePeriodsRaw();
    if (canonical.length) {
      return {
        ok: true,
        skipped: true,
        reason: 'SCOPED_ALREADY_HAS_DATA',
        copied: 0,
        merged: 0,
        conflictCount: 0
      };
    }
    var canonById = Object.create(null);
    canonical.forEach(function (p) {
      if (p && p.id) canonById[p.id] = p;
    });

    var out = canonical.slice();
    var copied = 0;
    var merged = 0;
    var conflicts = [];

    legacyIds.forEach(function (id) {
      var legacy = legacyById[id];
      var existing = canonById[id];
      if (!existing) {
        out.push(legacy);
        canonById[id] = legacy;
        copied++;
        return;
      }
      if (JSON.stringify(existing) === JSON.stringify(legacy)) return;
      var legacyScore = attPeriodRecoveryRecency(legacy);
      var canonScore = attPeriodRecoveryRecency(existing);
      if (legacyScore > canonScore) {
        var idx = out.findIndex(function (p) { return p && p.id === id; });
        if (idx >= 0) out[idx] = legacy;
        canonById[id] = legacy;
        merged++;
      } else if (canonScore > legacyScore) {
        return;
      } else {
        conflicts.push({ id: id, legacy: legacy, canonical: existing });
      }
    });

    if (copied > 0 || merged > 0) {
      attSaveTimetablePeriodsSync(out);
    }

    var report = {
      ok: true,
      tenantId: tenantId,
      source: ATT_PERIODS_KEY,
      destination: destination,
      copied: copied,
      merged: merged,
      conflictCount: conflicts.length,
      conflicts: conflicts
    };
    try {
      localStorage.setItem('ems_timetable_recovery_v1__' + tenantId, JSON.stringify({
        at: Date.now(),
        report: report
      }));
    } catch (eAudit) { /* ignore */ }
    if (copied > 0 || merged > 0 || conflicts.length > 0) {
      console.info('[EMS attendance] timetable legacy recovery', report);
    }
    return report;
  });
}

window.attRecoverLegacyTimetablePeriods = attRecoverLegacyTimetablePeriods;
window.attRecoverStrongLocalLegacyTimetable = attRecoverStrongLocalLegacyTimetable;

var ATT_PERIODS_QUARANTINE_SUFFIX = '_quarantine_v1';
var ATT_TIMETABLE_CONTAMINATION_AUDIT_KEY = 'ems_timetable_contamination_audit_v1';
var ATT_TIMETABLE_CONTAMINATION_RECOVERY_KEY = 'ems_timetable_contamination_recovery_v1';

function attTimetableScopedPhysicalKey(tenantId) {
  if (typeof window.emsScopedKey === 'function') {
    return window.emsScopedKey(ATT_PERIODS_KEY, tenantId);
  }
  return tenantId ? ('ems_t_' + tenantId + '__' + ATT_PERIODS_KEY) : null;
}

function attTimetableQuarantinePhysicalKey(tenantId) {
  var scoped = attTimetableScopedPhysicalKey(tenantId);
  return scoped ? (scoped + ATT_PERIODS_QUARANTINE_SUFFIX) : null;
}

function attEnumeratePhysicalLocalKeys() {
  var keys = [];
  try {
    var store = localStorage;
    var n = store.length;
    for (var i = 0; i < n; i++) {
      var k = store.key(i);
      if (k) keys.push(k);
    }
  } catch (eEnum) {
    try {
      if (window._emsOriginalGetItem && typeof localStorage === 'object') {
        // Fall through — length enumeration still works on wrapper
      }
    } catch (e2) { /* ignore */ }
  }
  return keys;
}

function attSummarizeTimetableList(list) {
  list = Array.isArray(list) ? list : [];
  var archived = list.filter(function (p) {
    return p && (p.archived === true || p.deleted === true);
  });
  return {
    count: list.length,
    active: list.length - archived.length,
    archived: archived.length,
    periodIds: list.map(function (p) { return p && p.id; }).filter(Boolean)
  };
}

/** Period ids in `list` that already live in another madrasa's scoped partition. */
function attTimetableIdsOverlapOtherTenant(list, tenantId) {
  var ids = attPeriodIdSet(list);
  var prefix = 'ems_t_';
  var suffix = '__' + ATT_PERIODS_KEY;
  var hits = [];
  attEnumeratePhysicalLocalKeys().forEach(function (key) {
    if (!key || key.indexOf(prefix) !== 0) return;
    if (key.indexOf(ATT_PERIODS_QUARANTINE_SUFFIX) >= 0) return;
    if (key.length < suffix.length || key.slice(-suffix.length) !== suffix) return;
    var otherTid = key.slice(prefix.length, key.length - suffix.length);
    if (!otherTid || otherTid.indexOf('__') >= 0) return;
    if (tenantId && String(otherTid) === String(tenantId)) return;
    var otherList = attParseTimetablePeriodList(attRawLocalGetPhysical(key));
    var overlap = attIntersectPeriodIds(ids, attPeriodIdSet(otherList));
    if (overlap.length) {
      hits.push({ otherTenantId: otherTid, periodIds: overlap, key: key });
    }
  });
  return hits;
}

function attTimetableLooksLikeForeignCopy(list, tenantId) {
  if (!list || !list.length) return false;
  return attTimetableIdsOverlapOtherTenant(list, tenantId).length > 0;
}

/**
 * TASK 5.1 — Read-only contamination auditor.
 * Never writes, never deletes. Maps every timetable copy visible on this device
 * and flags cross-tenant period-id collisions + unattributed legacy copies.
 */
function attAuditTimetableContamination(tenantId, opts) {
  opts = opts || {};
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  var scopedKey = attTimetableScopedPhysicalKey(tenantId);
  var findings = [];
  var sources = [];

  function pushSource(label, key, list, attributable, ownerTenantId) {
    var summary = attSummarizeTimetableList(list);
    sources.push({
      label: label,
      key: key,
      exists: !!(list && list.length),
      attributable: !!attributable,
      ownerTenantId: ownerTenantId || null,
      summary: summary
    });
    return summary;
  }

  var scopedList = scopedKey
    ? attParseTimetablePeriodList(attRawLocalGetPhysical(scopedKey))
    : [];
  pushSource('scoped_local', scopedKey, scopedList, !!tenantId, tenantId);

  var legacyList = attParseTimetablePeriodList(attRawLocalGetPhysical(ATT_PERIODS_KEY));
  pushSource('legacy_global_local', ATT_PERIODS_KEY, legacyList, false, null);

  var quarantineKey = attTimetableQuarantinePhysicalKey(tenantId);
  var quarantineList = quarantineKey
    ? attParseTimetablePeriodList(attRawLocalGetPhysical(quarantineKey))
    : [];
  pushSource('quarantine_local', quarantineKey, quarantineList, !!tenantId, tenantId);

  var otherTenantCopies = [];
  var prefix = 'ems_t_';
  var suffix = '__' + ATT_PERIODS_KEY;
  attEnumeratePhysicalLocalKeys().forEach(function (key) {
    if (!key || key.indexOf(prefix) !== 0) return;
    if (key.indexOf(suffix) < 0) return;
    if (key.indexOf(ATT_PERIODS_QUARANTINE_SUFFIX) >= 0) return;
    if (scopedKey && key === scopedKey) return;
    var mid = key.slice(prefix.length, key.length - suffix.length);
    if (!mid || mid.indexOf('__') >= 0) return;
    var otherList = attParseTimetablePeriodList(attRawLocalGetPhysical(key));
    if (!otherList.length) return;
    otherTenantCopies.push({ tenantId: mid, key: key, list: otherList });
    pushSource('other_tenant_scoped', key, otherList, true, mid);
  });

  var scopedIds = attPeriodIdSet(scopedList);
  var legacyIds = attPeriodIdSet(legacyList);

  if (legacyList.length && !tenantId) {
    findings.push({
      code: 'LEGACY_UNATTRIBUTED_NO_TENANT',
      severity: 'high',
      detail: 'Global ems_att_periods exists with no verified tenant'
    });
  } else if (legacyList.length && scopedList.length === 0) {
    findings.push({
      code: 'LEGACY_ONLY_NO_SCOPED',
      severity: 'medium',
      detail: 'Legacy global has periods but tenant partition is empty'
    });
  } else if (legacyList.length && scopedList.length) {
    var sharedLegacy = attIntersectPeriodIds(scopedIds, legacyIds);
    if (sharedLegacy.length) {
      findings.push({
        code: 'LEGACY_OVERLAP_SCOPED',
        severity: 'low',
        periodIds: sharedLegacy,
        detail: 'Legacy global shares period ids with scoped partition'
      });
    }
  }

  var crossTenantHits = [];
  otherTenantCopies.forEach(function (other) {
    var overlap = attIntersectPeriodIds(scopedIds, attPeriodIdSet(other.list));
    if (overlap.length) {
      crossTenantHits.push({
        otherTenantId: other.tenantId,
        periodIds: overlap
      });
    }
  });
  if (crossTenantHits.length) {
    findings.push({
      code: 'CROSS_TENANT_PERIOD_ID_COLLISION',
      severity: 'critical',
      hits: crossTenantHits,
      detail: 'Same period ids present in another madrasa partition on this device'
    });
  }

  if (opts.cloudCanonicalList && Array.isArray(opts.cloudCanonicalList)) {
    pushSource('cloud_canonical', 'ModuleData/' + ATT_PERIODS_CANONICAL_CLOUD_DOC,
      opts.cloudCanonicalList, !!tenantId, tenantId);
    var cloudIds = attPeriodIdSet(opts.cloudCanonicalList);
    var localOnly = Object.keys(scopedIds).filter(function (id) { return !cloudIds[id]; });
    if (localOnly.length && opts.cloudCanonicalList.length) {
      findings.push({
        code: 'LOCAL_AHEAD_OR_DIVERGED',
        severity: 'medium',
        periodIds: localOnly,
        detail: 'Scoped local has period ids absent from canonical cloud'
      });
    }
  }

  if (opts.cloudLegacyList && Array.isArray(opts.cloudLegacyList) && opts.cloudLegacyList.length) {
    pushSource('cloud_legacy', ATT_PERIODS_LEGACY_CLOUD_COL + '/' + ATT_PERIODS_LEGACY_CLOUD_DOC,
      opts.cloudLegacyList, !!tenantId, tenantId);
  }

  var report = {
    ok: true,
    readOnly: true,
    tenantId: tenantId || null,
    at: Date.now(),
    contaminated: findings.some(function (f) {
      return f.severity === 'critical' || f.severity === 'high';
    }),
    findings: findings,
    sources: sources,
    otherTenantCopyCount: otherTenantCopies.length
  };

  try {
    if (tenantId) {
      var auditKey = typeof window.emsScopedKey === 'function'
        ? window.emsScopedKey(ATT_TIMETABLE_CONTAMINATION_AUDIT_KEY, tenantId)
        : (ATT_TIMETABLE_CONTAMINATION_AUDIT_KEY + '__' + tenantId);
      if (window._emsOriginalSetItem) {
        window._emsOriginalSetItem.call(localStorage, auditKey, JSON.stringify(report));
      } else {
        localStorage.setItem(auditKey, JSON.stringify(report));
      }
    }
  } catch (eAuditWrite) { /* ignore */ }

  return report;
}

/**
 * TASK 5.2 — Safe recovery for contaminated/unprovable timetable copies.
 * Prefer canonical cloud when provided. Quarantine suspicious local periods.
 * Never deletes legacy or other-tenant sources.
 */
function attRecoverContaminatedTimetable(tenantId, opts) {
  opts = opts || {};
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) {
    return Promise.resolve({ ok: false, reason: 'NO_TENANT', quarantined: 0, restored: 0 });
  }

  var audit = attAuditTimetableContamination(tenantId, {
    cloudCanonicalList: opts.cloudCanonicalList,
    cloudLegacyList: opts.cloudLegacyList
  });

  var scopedKey = attTimetableScopedPhysicalKey(tenantId);
  var quarantineKey = attTimetableQuarantinePhysicalKey(tenantId);
  var scopedList = attParseTimetablePeriodList(attRawLocalGetPhysical(scopedKey));
  var preferred = null;
  var preferredSource = null;

  function listIsSafe(list) {
    return Array.isArray(list) && list.length > 0 && !attTimetableLooksLikeForeignCopy(list, tenantId);
  }

  var quarantineList = quarantineKey
    ? attParseTimetablePeriodList(attRawLocalGetPhysical(quarantineKey))
    : [];
  var choice = typeof attChooseTimetableFromCloudLists === 'function'
    ? attChooseTimetableFromCloudLists(opts.cloudCanonicalList || [], opts.cloudLegacyList || [], tenantId, {
      localList: scopedList,
      quarantineList: quarantineList
    })
    : null;
  if (choice && choice.list.length && listIsSafe(choice.list)) {
    preferred = choice.list.slice();
    if (choice.source === 'quarantine_local') {
      preferredSource = 'quarantine_local';
    } else if (String(choice.source || '').indexOf('legacy') >= 0 || choice.source === 'cloud_legacy') {
      preferredSource = 'cloud_legacy';
    } else {
      preferredSource = 'cloud_canonical';
    }
  } else if (listIsSafe(opts.cloudLegacyList)
    && (!listIsSafe(opts.cloudCanonicalList)
      || attTimetableLooksLikeForeignCopy(opts.cloudCanonicalList, tenantId))) {
    preferred = opts.cloudLegacyList.slice();
    preferredSource = 'cloud_legacy';
  } else if (listIsSafe(opts.cloudCanonicalList)) {
    preferred = opts.cloudCanonicalList.slice();
    preferredSource = 'cloud_canonical';
  } else if (listIsSafe(opts.cloudLegacyList)) {
    preferred = opts.cloudLegacyList.slice();
    preferredSource = 'cloud_legacy';
  }

  var scopedContaminated = attTimetableLooksLikeForeignCopy(scopedList, tenantId);
  var rosterMismatch = scopedList.length && attTimetableRosterHasMembers()
    && attTimetableRosterScore(scopedList) === 0
    && preferred && attTimetableRosterScore(preferred) > 0;
  var critical = (audit.findings || []).some(function (f) {
    return f.code === 'CROSS_TENANT_PERIOD_ID_COLLISION';
  }) || scopedContaminated || rosterMismatch;

  var toQuarantine = [];
  var restored = 0;
  var action = 'none';

  function writeTrustedList(list) {
    if (typeof attPersistConfigBlob === 'function') {
      attPersistConfigBlob(ATT_PERIODS_KEY, list);
      return;
    }
    if (typeof window.emsOfflineWriteLocalSync === 'function') {
      window.emsOfflineWriteLocalSync(ATT_PERIODS_KEY, list, { tenantId: tenantId });
    } else if (window._emsOriginalSetItem && scopedKey) {
      try {
        window._emsOriginalSetItem.call(localStorage, scopedKey, JSON.stringify(list));
      } catch (eWrite) { /* ignore */ }
    }
  }

  if (critical && preferred) {
    toQuarantine = scopedList.slice();
    writeTrustedList(preferred);
    restored = preferred.length;
    action = 'restore_cloud_quarantine_local';
  } else if (critical && !preferred) {
    toQuarantine = scopedList.slice();
    writeTrustedList([]);
    action = 'quarantine_and_clear_foreign';
  } else if (!scopedList.length && preferred) {
    writeTrustedList(preferred);
    restored = preferred.length;
    action = 'seed_from_' + preferredSource;
  } else if (rosterMismatch && preferred) {
    toQuarantine = scopedList.slice();
    writeTrustedList(preferred);
    restored = preferred.length;
    action = 'restore_roster_quarantine_local';
  } else if (preferred && scopedList.length
      && choice && choice.persistCanonical
      && attTimetableListsAreDifferentTimetables(scopedList, preferred)) {
    toQuarantine = scopedList.slice();
    writeTrustedList(preferred);
    restored = preferred.length;
    action = 'restore_cloud_quarantine_local';
  } else if (
    (audit.findings || []).some(function (f) { return f.code === 'LEGACY_ONLY_NO_SCOPED'; })
    && window.EMS_TENANT_LEGACY_MIGRATION_ALLOWED === false
  ) {
    // Unprovable legacy — quarantine global copy under this tenant's quarantine key
    // without promoting into canonical partition.
    var legacyOnly = attParseTimetablePeriodList(attRawLocalGetPhysical(ATT_PERIODS_KEY));
    toQuarantine = legacyOnly.slice();
    action = 'quarantine_unprovable_legacy';
  }

  var quarantined = 0;
  if (toQuarantine.length && quarantineKey) {
    var existingQ = attParseTimetablePeriodList(attRawLocalGetPhysical(quarantineKey));
    var byId = Object.create(null);
    existingQ.concat(toQuarantine).forEach(function (p) {
      if (!p || !p.id) return;
      var prev = byId[p.id];
      if (!prev || attPeriodRecoveryRecency(p) >= attPeriodRecoveryRecency(prev)) {
        byId[p.id] = p;
      }
    });
    var mergedQ = Object.keys(byId).map(function (id) { return byId[id]; });
    try {
      if (window._emsOriginalSetItem) {
        window._emsOriginalSetItem.call(localStorage, quarantineKey, JSON.stringify(mergedQ));
      } else {
        localStorage.setItem(quarantineKey, JSON.stringify(mergedQ));
      }
      quarantined = toQuarantine.length;
    } catch (eQ) { /* ignore */ }
  }

  var result = {
    ok: true,
    tenantId: tenantId,
    action: action,
    preferredSource: preferredSource,
    quarantined: quarantined,
    restored: restored,
    audit: audit,
    at: Date.now()
  };

  try {
    var recKey = typeof window.emsScopedKey === 'function'
      ? window.emsScopedKey(ATT_TIMETABLE_CONTAMINATION_RECOVERY_KEY, tenantId)
      : (ATT_TIMETABLE_CONTAMINATION_RECOVERY_KEY + '__' + tenantId);
    if (window._emsOriginalSetItem) {
      window._emsOriginalSetItem.call(localStorage, recKey, JSON.stringify(result));
    } else {
      localStorage.setItem(recKey, JSON.stringify(result));
    }
  } catch (eRec) { /* ignore */ }

  if (quarantined || restored || critical) {
    console.info('[EMS attendance] timetable contamination recovery', {
      action: action,
      quarantined: quarantined,
      restored: restored,
      contaminated: audit.contaminated
    });
  }

  return Promise.resolve(result);
}

/**
 * Fetch cloud snapshots (when available) then run audit + safe recovery.
 * Offline / no Firestore → local-only audit + recovery rules.
 */
function attRunTimetableContaminationPass(tenantId) {
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) {
    return Promise.resolve({ ok: false, reason: 'NO_TENANT' });
  }

  var fsDb = typeof db !== 'undefined' ? db : null;
  var cloudCanonical = null;
  var cloudLegacy = null;
  var chain = Promise.resolve();

  if (fsDb && !attIsOfflineMode()) {
    var canonRef = attTimetableCanonicalCloudRef(fsDb, tenantId);
    var legacyRef = attTimetableLegacyCloudRef(fsDb, tenantId);
    chain = Promise.all([
      canonRef ? canonRef.get({ source: 'server' }).catch(function () { return { exists: false }; }) : Promise.resolve({ exists: false }),
      legacyRef ? legacyRef.get({ source: 'server' }).catch(function () { return { exists: false }; }) : Promise.resolve({ exists: false })
    ]).then(function (docs) {
      cloudCanonical = attTimetableListFromCloudSnapshot(docs[0]);
      cloudLegacy = attTimetableListFromCloudSnapshot(docs[1]);
      cloudCanonical = attCanonicalizeRemoteTimetableTeacherBindings(cloudCanonical || []).list;
      cloudLegacy = attCanonicalizeRemoteTimetableTeacherBindings(cloudLegacy || []).list;
    });
  }

  return chain.then(function () {
    return attRecoverContaminatedTimetable(tenantId, {
      cloudCanonicalList: cloudCanonical,
      cloudLegacyList: cloudLegacy
    });
  }).catch(function () {
    return attRecoverContaminatedTimetable(tenantId, {});
  });
}

window.attAuditTimetableContamination = attAuditTimetableContamination;
window.attRecoverContaminatedTimetable = attRecoverContaminatedTimetable;
window.attRunTimetableContaminationPass = attRunTimetableContaminationPass;
window.attTimetableLooksLikeForeignCopy = attTimetableLooksLikeForeignCopy;
window.attHealTimetableLocally = attHealTimetableLocally;

window.attDebugTimetableHeal = function (tenantId) {
  tenantId = tenantId || (typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null);
  if (!tenantId) return Promise.resolve({ ok: false, reason: 'no_tenant' });
  var fsDb = typeof db !== 'undefined' ? db : null;
  var out = {
    tenantId: tenantId,
    offline: typeof attIsOfflineMode === 'function' ? attIsOfflineMode() : null,
    local: attReadAllTimetablePeriodsRaw(),
    quarantine: [],
    cloudCanonical: null,
    cloudLegacy: null,
    choice: null
  };
  var scopedKey = typeof window.emsScopedKey === 'function'
    ? window.emsScopedKey(ATT_PERIODS_KEY, tenantId)
    : ('ems_t_' + tenantId + '__' + ATT_PERIODS_KEY);
  var qKey = scopedKey ? (scopedKey + '_quarantine_v1') : null;
  if (qKey && typeof attRawLocalGetPhysical === 'function') {
    out.quarantine = attParseTimetablePeriodList(attRawLocalGetPhysical(qKey));
  }
  function score(list) { return attTimetableRosterScore(list); }
  out.localScore = score(out.local);
  out.quarantineScore = score(out.quarantine);
  if (!fsDb || attIsOfflineMode()) {
    out.choice = attChooseBestTimetableCandidate([
      { list: out.quarantine, source: 'quarantine_local' },
      { list: out.local, source: 'local_scoped' }
    ], tenantId);
    return Promise.resolve(out);
  }
  var canonRef = attTimetableCanonicalCloudRef(fsDb, tenantId);
  var legacyRef = attTimetableLegacyCloudRef(fsDb, tenantId);
  return Promise.all([
    canonRef ? canonRef.get({ source: 'server' }).catch(function () { return { exists: false }; }) : Promise.resolve({ exists: false }),
    legacyRef ? legacyRef.get({ source: 'server' }).catch(function () { return { exists: false }; }) : Promise.resolve({ exists: false })
  ]).then(function (docs) {
    out.cloudCanonical = attTimetableListFromCloudSnapshot(docs[0]) || [];
    out.cloudLegacy = attTimetableListFromCloudSnapshot(docs[1]) || [];
    out.canonScore = score(out.cloudCanonical);
    out.legacyScore = score(out.cloudLegacy);
    out.choice = attChooseTimetableFromCloudLists(out.cloudCanonical, out.cloudLegacy, tenantId, {
      localList: out.local,
      quarantineList: out.quarantine
    });
    return out;
  });
};

if (typeof window.addEventListener === 'function') {
  window.addEventListener('ems:tenant-storage-ready', function (ev) {
    var tid = ev && ev.detail && ev.detail.tenantId;
    if (!tid) return;
    attRecoverLegacyTimetablePeriods(tid).catch(function () { /* ignore */ });
  });
  window.addEventListener('ems:tenant-storage-ready', function (ev) {
    var tid = ev && ev.detail && ev.detail.tenantId;
    if (!tid) return;
    attRunTimetableContaminationPass(tid).catch(function () { /* ignore */ });
  });
}

function attReadHolidaysDb() {
  try {
    if (typeof window.emsSafeLocalGet === 'function') {
      var viaSafe = window.emsSafeLocalGet(ATT_HOLIDAYS_KEY);
      if (viaSafe) {
        var parsedSafe = typeof viaSafe === 'string' ? JSON.parse(viaSafe) : viaSafe;
        return Array.isArray(parsedSafe) ? parsedSafe : [];
      }
    }
    var raw = localStorage.getItem(ATT_HOLIDAYS_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (eRead) {
    return [];
  }
}

document.getElementById('btn-add-holiday')?.addEventListener('click', () => {
  var btn = document.getElementById('btn-add-holiday');
  if (btn && btn._attActionInflight) return btn._attActionInflight;
  const title = document.getElementById('hol-title').value.trim();
  const start = document.getElementById('hol-start-date').value;
  const end = document.getElementById('hol-end-date').value;

  if (!title || !start || !end)
    return window.showToast('تمام خانے پُر کریں!', 'error');
  if (end < start) return window.showToast('اختتامی تاریخ شروع کی تاریخ سے پہلے نہیں ہو سکتی!', 'error');

  let holidays = attReadHolidaysDb();
  holidays.push({ id: window.generateID ? window.generateID('HOL') : 'HOL-'+Math.floor(Math.random()*9000), title, start, end });
  attSetActionButtonBusy(btn, true, 'محفوظ ہو رہا ہے…');
  var op = attPersistConfigBlob(ATT_HOLIDAYS_KEY, holidays).then(attRequirePersistSuccess).then(function () {
    document.getElementById('hol-title').value = '';
    loadHolidays();
    window.showToast('تعطیل محفوظ ہو گئی!', 'success');
    logAttAudit('تعطیل درج', `عنوان: ${title}`);
    return true;
  }).catch(function (err) {
    console.error('[EMS] attendance holiday save', err);
    window.showToast('تعطیل محفوظ نہیں ہو سکی', 'error');
    return false;
  }).finally(function () {
    if (btn) btn._attActionInflight = null;
    attSetActionButtonBusy(btn, false);
  });
  if (btn) btn._attActionInflight = op;
  return op;
});

function loadHolidays() {
  const holidays = attReadHolidaysDb();
  const tbody = document.getElementById('holiday-tbody');
  if (!tbody) return;
  tbody.innerHTML = holidays
    .map((h) => {
      let days = Math.round((new Date(h.end) - new Date(h.start)) / (1000 * 60 * 60 * 24)) + 1;
      return `<tr>
            <td><strong>${h.title}</strong></td><td>${h.start}</td><td>${h.end}</td><td>${days} دن</td>
            <td><button class="icon-btn delete" onclick="deleteHoliday('${h.id}')"><i class="fas fa-trash"></i></button></td>
        </tr>`;
    })
    .join('');
}

var _attHolidayDeleteInflight = Object.create(null);
window.deleteHoliday = function (id) {
  if (_attHolidayDeleteInflight[id]) return _attHolidayDeleteInflight[id];
  if (!confirm('حذف کریں؟')) return;
  let holidays = attReadHolidaysDb();
  let toDelete = holidays.find((h) => h.id === id);
  if (!toDelete) return window.showToast('تعطیل کا ریکارڈ نہیں ملا', 'error');
  holidays = holidays.filter((h) => h.id !== id);
  _attHolidayDeleteInflight[id] = attPersistConfigBlob(ATT_HOLIDAYS_KEY, holidays)
    .then(attRequirePersistSuccess).then(function () {
    moveToRecycleBin('Holiday', toDelete);
    loadHolidays();
    window.showToast('تعطیل حذف کر دی گئی', 'success');
    return true;
  }).catch(function (err) {
    console.error('[EMS] attendance holiday delete', err);
    window.showToast('تعطیل حذف نہیں ہو سکی', 'error');
    return false;
  }).finally(function () {
    delete _attHolidayDeleteInflight[id];
  });
  return _attHolidayDeleteInflight[id];
};

// ================== 5. آڈٹ لاگ اور ریسائیکل بن ==================
function logAttAudit(action, details) {
  let logs = JSON.parse(localStorage.getItem('ems_att_audit')) || [];
  logs.unshift({ time: new Date().toLocaleString('ur-PK'), action, details });
  if (logs.length > 50) logs.pop();
  localStorage.setItem('ems_att_audit', JSON.stringify(logs));
}

function loadAttAudit() {
  let logs = JSON.parse(localStorage.getItem('ems_att_audit')) || [];
  const tbody = document.getElementById('att-audit-tbody');
  if (tbody)
    tbody.innerHTML = logs
      .map((l) => `<tr><td>${l.time}</td><td><strong>${l.action}</strong></td><td>${l.details}</td></tr>`)
      .join('');
}

function moveToRecycleBin(type, data) {
  let bin = JSON.parse(localStorage.getItem('ems_att_recycle')) || [];
  bin.unshift({
    id: window.generateID ? window.generateID('BIN') : 'BIN-'+Math.floor(Math.random()*9000),
    deleteDate: new Date().toLocaleString('ur-PK'),
    type,
    data,
  });
  localStorage.setItem('ems_att_recycle', JSON.stringify(bin));
}

function loadRecycleBin() {
  let bin = JSON.parse(localStorage.getItem('ems_att_recycle')) || [];
  const tbody = document.getElementById('att-recycle-tbody');
  if (tbody)
    tbody.innerHTML = bin
      .map(
        (b) => `
        <tr>
            <td>${b.deleteDate}</td><td><span class="badge" style="background:#e74c3c; color:white; padding:3px 8px; border-radius:4px;">${b.type}</span></td>
            <td>${JSON.stringify(b.data).substring(0, 50)}...</td>
            <td>
                <button class="btn btn-outline btn-icon-only" style="padding:5px;" onclick="restoreRecycle('${b.id}')" title="بحال کریں"><i class="fas fa-undo"></i></button>
            </td>
        </tr>`
      )
      .join('');
}

var _attRecycleRestoreInflight = Object.create(null);
window.restoreRecycle = function (id) {
  if (_attRecycleRestoreInflight[id]) return _attRecycleRestoreInflight[id];
  let bin = JSON.parse(localStorage.getItem('ems_att_recycle')) || [];
  let item = bin.find((b) => b.id === id);
  if (!item) return;

  var persist;
  if (item.type === 'Holiday') {
    let hols = attReadHolidaysDb();
    var holIdx = hols.findIndex(function (h) { return h && item.data && h.id === item.data.id; });
    if (holIdx >= 0) hols[holIdx] = item.data;
    else hols.push(item.data);
    persist = attPersistConfigBlob(ATT_HOLIDAYS_KEY, hols);
  } else if (item.type === 'Period') {
    let per = attReadAllTimetablePeriodsRaw();
    var perIdx = per.findIndex(function (p) { return p && item.data && p.id === item.data.id; });
    var restoredPeriod = Object.assign({}, item.data || {});
    delete restoredPeriod.archived;
    delete restoredPeriod.archivedAt;
    delete restoredPeriod.deleted;
    if (perIdx >= 0) per[perIdx] = restoredPeriod;
    else per.push(restoredPeriod);
    persist = attSaveTimetablePeriodsSync(per);
  } else {
    window.showToast('یہ ریکارڈ خودکار بحالی کے لیے معاون نہیں', 'error');
    return Promise.resolve(false);
  }

  _attRecycleRestoreInflight[id] = Promise.resolve(persist).then(attRequirePersistSuccess).then(function () {
    localStorage.setItem(
      'ems_att_recycle',
      JSON.stringify(bin.filter((b) => b.id !== id))
    );
    loadRecycleBin();
    if (item.type === 'Period') attRefreshPeriodUiAfterSave(item.data && item.data.id);
    window.showToast('ریکارڈ کامیابی سے بحال کر دیا گیا!', 'success');
    return true;
  }).catch(function (err) {
    console.error('[EMS] attendance recycle restore', err);
    window.showToast('ریکارڈ بحال نہیں ہو سکا؛ ریسائیکل بن میں محفوظ ہے۔', 'error');
    return false;
  }).finally(function () {
    delete _attRecycleRestoreInflight[id];
  });
  return _attRecycleRestoreInflight[id];
};

window.emptyRecycleBin = function () {
  if (
    confirm(
      'کیا آپ واقعی ریسائیکل بن مکمل خالی کرنا چاہتے ہیں؟ یہ عمل ناقابل واپسی ہے۔'
    )
  ) {
    localStorage.setItem('ems_att_recycle', JSON.stringify([]));
    loadRecycleBin();
    window.showToast('ریسائیکل بن خالی کر دیا گیا!', 'error');
  }
};

function attRunWhenDomReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function attBindModuleLifecycle() {
  if (window._attModuleLifecycleBound) return;
  window._attModuleLifecycleBound = true;

  window.addEventListener('ems:repository-ready', attOnRepositoryDataReady);
  window.addEventListener('ems:users-changed', function () {
    if (typeof window.emsIsAttendanceModuleActive === 'function' && !window.emsIsAttendanceModuleActive()) return;
    _attDropdownCacheGen = -1;
    loadAttDropdowns(true);
  });

  attRunWhenDomReady(function () {
    document.getElementById('tab-attendance')?.addEventListener('click', () => {
      var afterReady = function () {
        loadAttDropdowns(true);
        logAttAudit('سسٹم اوپن', 'حاضری ماڈیول کھولا گیا');
      };
      if (typeof window.emsEnsureRepositoryReady === 'function') {
        window.emsEnsureRepositoryReady().then(afterReady).catch(afterReady);
      } else {
        afterReady();
      }
    });

    var applyMainDashAtt = function () {
      if (document.getElementById('dash-att-rate') && typeof window.emsApplyDashboardAttendance === 'function') {
        var users = attGetUsers();
        var totalStudents = users.filter(function (u) { return attUserMatchesType(u, 'student'); }).length;
        window.emsApplyDashboardAttendance(totalStudents);
      }
    };
    if (typeof window.emsEnsureRepositoryReady === 'function') {
      window.emsEnsureRepositoryReady().then(applyMainDashAtt).catch(applyMainDashAtt);
    } else {
      applyMainDashAtt();
    }
  });
}

attBindModuleLifecycle();

// ============================================================================
// حصہ 6: خصوصی تقریبات کا رجسٹر (Event Register Logic)
// ============================================================================
var EVT_EVENTS_DB_KEY = 'ems_att_events_db';

function evtReadEventsDb() {
  try {
    if (typeof window.emsSafeLocalGet === 'function') {
      var viaSafe = window.emsSafeLocalGet(EVT_EVENTS_DB_KEY);
      if (viaSafe) {
        var parsedSafe = typeof viaSafe === 'string' ? JSON.parse(viaSafe) : viaSafe;
        return Array.isArray(parsedSafe) ? parsedSafe : [];
      }
    }
    var raw = localStorage.getItem(EVT_EVENTS_DB_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (eRead) {
    return [];
  }
}

function evtWriteEventsDbLocal(events) {
  events = Array.isArray(events) ? events : [];
  if (typeof window.emsOfflineWriteLocalSync === 'function') {
    var tenantId = typeof getAttendanceTenantId === 'function' ? getAttendanceTenantId() : null;
    return window.emsOfflineWriteLocalSync(EVT_EVENTS_DB_KEY, events, { tenantId: tenantId }) === true;
  }
  try {
    localStorage.setItem(EVT_EVENTS_DB_KEY, JSON.stringify(events));
    return true;
  } catch (eWrite) {
    console.warn('[EMS] evt local write failed', eWrite);
    return false;
  }
}

function attEventCloudDocId(eventId) {
  return 'att_evt_' + String(eventId || '').trim();
}

function attComputeEventCloudPatch(prev, next) {
  prev = prev || {};
  next = next || {};
  var patch = {};
  ['name', 'type', 'date', 'time', 'timestamp'].forEach(function (field) {
    if (next[field] !== undefined && next[field] !== prev[field]) {
      patch[field] = next[field];
    }
  });
  var prevParts = JSON.stringify(prev.participants || []);
  var nextParts = JSON.stringify(next.participants || []);
  if (prevParts !== nextParts) {
    patch.participants = next.participants || [];
  }
  return patch;
}

function attEnqueueEventsDbSync(eventsDb) {
  return attEnqueueSyncModuleBlob(EVT_EVENTS_DB_KEY, eventsDb);
}

/**
 * Persist one event to the single canonical event store.
 * Canonical SSOT: tenant-scoped ModuleData/Attendance__ems_att_events_db.
 * Historical Attendance/att_evt_* documents are read-only migration evidence.
 */
window.attSaveEventAttendance = function (eventRecord, opts) {
  opts = opts || {};
  if (!eventRecord || !eventRecord.id) {
    return Promise.resolve({ ok: false, reason: 'invalid_event' });
  }

  var events = evtReadEventsDb();
  var prev = null;
  var idx = events.findIndex(function (e) { return e && e.id === eventRecord.id; });
  var stamped = Object.assign({}, eventRecord, {
    timestamp: eventRecord.timestamp || Date.now()
  });

  if (idx >= 0) {
    prev = events[idx];
    events[idx] = Object.assign({}, events[idx], stamped);
    stamped = events[idx];
  } else {
    events.push(stamped);
  }

  if (!evtWriteEventsDbLocal(events)) {
    return Promise.resolve({ ok: false, reason: 'local_write_failed' });
  }

  var chain = attEnqueueEventsDbSync(events);

  return chain.then(function (syncRes) {
    return {
      ok: true,
      local: true,
      synced: !!(syncRes && syncRes.synced),
      offline: !!(syncRes && syncRes.offline) || !(syncRes && syncRes.synced),
      id: stamped.id
    };
  }).catch(function (err) {
    console.error('[EMS] attSaveEventAttendance', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  });
};

/** Remove event from the canonical event blob. Legacy att_evt_* docs are never mutated. */
window.attDeleteEventAttendance = function (eventId) {
  if (!eventId) return Promise.resolve({ ok: false, reason: 'invalid_id' });
  var events = evtReadEventsDb();
  events = events.filter(function (e) { return !e || e.id !== eventId; });
  if (!evtWriteEventsDbLocal(events)) {
    return Promise.resolve({ ok: false, reason: 'local_write_failed' });
  }

  var chain = attEnqueueEventsDbSync(events);

  return chain.then(function (syncRes) {
    return {
      ok: true,
      local: true,
      synced: !!(syncRes && syncRes.synced),
      offline: !!(syncRes && syncRes.offline) || !(syncRes && syncRes.synced)
    };
  });
};

function evtGetUsers() {
  return attGetUsers();
}
window.currentEventParticipants = window.currentEventParticipants || [];
window._evtEditId = null;

function evtToParticipant(u) {
  return {
    id: u.id, name: u.name, type: u.type,
    role: u.class || u.dept || u.appointed || 'اسٹاف',
    cls: u.class || '', status: 'P',
  };
}

var EVT_SEARCH_MAX = ATT_SEARCH_MAX;
var _evtSearchUsersCache = null;
var _evtSearchDebounce = null;

function evtParticipantLabel(u) {
  if (!u) return '';
  return u.name + ' (' + (u.type === 'student' ? 'طالب علم: ' + (u.class || '') : 'اسٹاف') + ')';
}

function evtInitParticipantSearch() {
  _evtSearchUsersCache = evtGetUsers();
  var input = document.getElementById('evt-participant-search');
  var results = document.getElementById('evt-participant-results');
  if (input) {
    input.value = '';
    input.removeAttribute('data-selected-uid');
  }
  if (results) {
    results.innerHTML = '';
    results.style.display = 'none';
  }
}

function evtFilterUsersForSearch(q) {
  q = String(q || '').trim().toLowerCase();
  var users = _evtSearchUsersCache || evtGetUsers();
  var already = Object.create(null);
  (window.currentEventParticipants || []).forEach(function (p) {
    if (p && p.id) already[p.id] = true;
  });
  var filtered = users.filter(function (u) {
    if (!u || !u.id || already[u.id]) return false;
    if (!q) return false;
    var hay = [u.id, u.name, u.class, u.type, u.dept].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  return filtered.slice(0, EVT_SEARCH_MAX);
}

function evtRenderParticipantSearchResults(q) {
  var box = document.getElementById('evt-participant-results');
  var input = document.getElementById('evt-participant-search');
  if (!box || !input) return;
  var matches = evtFilterUsersForSearch(q);
  if (!q) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  if (!matches.length) {
    box.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">کوئی نتیجہ نہیں</div>';
    box.style.display = 'block';
    return;
  }
  box.innerHTML = matches.map(function (u) {
    return '<button type="button" class="evt-search-item" data-uid="' + u.id + '" style="display:block;width:100%;text-align:right;padding:8px 12px;border:none;border-bottom:1px solid #eef2f6;background:#fff;cursor:pointer;">' + evtParticipantLabel(u) + '</button>';
  }).join('');
  box.style.display = 'block';
}

function evtResolveSelectedParticipantUid() {
  var input = document.getElementById('evt-participant-search');
  if (!input) return '';
  var uid = input.getAttribute('data-selected-uid') || '';
  if (uid) return uid;
  var q = String(input.value || '').trim().toLowerCase();
  if (!q) return '';
  var users = _evtSearchUsersCache || evtGetUsers();
  var exact = users.find(function (u) {
    if (!u || !u.id) return false;
    return String(u.id).toLowerCase() === q || String(u.name || '').toLowerCase() === q;
  });
  return exact ? exact.id : '';
}

function evtEnsureParticipantSearchBound() {
  if (window._evtParticipantSearchBound) return;
  var input = document.getElementById('evt-participant-search');
  var results = document.getElementById('evt-participant-results');
  if (!input || !results) return;
  window._evtParticipantSearchBound = true;
  _evtSearchDebounce = attDebounce(function () {
    evtRenderParticipantSearchResults(input.value);
  }, ATT_SEARCH_DEBOUNCE_MS);

  input.addEventListener('input', function () {
    input.removeAttribute('data-selected-uid');
    _evtSearchDebounce();
  });

  input.addEventListener('focus', function () {
    if (input.value) _evtSearchDebounce();
  });

  results.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.evt-search-item') : null;
    if (!btn) return;
    var pickUid = btn.getAttribute('data-uid');
    if (!pickUid) return;
    input.setAttribute('data-selected-uid', pickUid);
    input.value = btn.textContent || pickUid;
    results.style.display = 'none';
  });

  document.addEventListener('click', function (ev) {
    if (!results.contains(ev.target) && ev.target !== input) {
      results.style.display = 'none';
    }
  });
}

function evtPopulateExcludeClass() {
  const sel = document.getElementById('evt-exclude-class');
  if (!sel) return;
  const groups = [...new Set(window.currentEventParticipants.map((p) => p.cls).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">پورا درجہ/شعبہ خارج کریں...</option>' +
    groups.map((c) => `<option value="${c}">${c}</option>`).join('');
}

document.getElementById('btn-create-event')?.addEventListener('click', () => {
  const name = document.getElementById('evt-name').value.trim();
  const date = document.getElementById('evt-date').value;

  if (!name || !date) return window.showToast('تقریب کا نام اور تاریخ درج کرنا لازمی ہے!', 'error');

  window._evtEditId = null;
  window.currentEventParticipants = [];
  document.getElementById('evt-attendance-tbody').innerHTML = '';

  evtEnsureParticipantSearchBound();
  evtInitParticipantSearch();

  document.getElementById('evt-participants-panel').style.display = 'block';
  renderEventParticipants();
  window.showToast('نیا رجسٹر تیار ہے۔ "فوری انتخاب" سے سب شامل کریں، پھر ضرورت کے مطابق خارج کریں۔', 'success');
});

// فوری اجتماعی انتخاب — سب منتخب کریں
window.evtBulkSelect = function (group) {
  if (group === 'clear') {
    window.currentEventParticipants = [];
  } else {
    const users = evtGetUsers();
    const filtered = group === 'all' ? users : users.filter((u) => u.type === group);
    window.currentEventParticipants = filtered.map(evtToParticipant);
  }
  evtPopulateExcludeClass();
  renderEventParticipants();
  window.showToast(`${window.currentEventParticipants.length} افراد منتخب ہو گئے`, 'info');
};

// پورا درجہ/شعبہ خارج کریں
document.getElementById('evt-exclude-class')?.addEventListener('change', function () {
  const cls = this.value;
  if (!cls) return;
  const before = window.currentEventParticipants.length;
  window.currentEventParticipants = window.currentEventParticipants.filter((p) => p.cls !== cls);
  this.value = '';
  evtPopulateExcludeClass();
  renderEventParticipants();
  window.showToast(`"${cls}" کے ${before - window.currentEventParticipants.length} افراد خارج کر دیے گئے`, 'warning');
});

// تمام شرکاء کی حالت یکمشت مقرر کریں
window.evtMarkAll = function (key) {
  const symbols = JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
  const val = symbols[key] || key;
  window.currentEventParticipants.forEach((p) => (p.status = val));
  renderEventParticipants();
};

window.evtCancelEdit = function () {
  window._evtEditId = null;
  window.currentEventParticipants = [];
  document.getElementById('evt-participants-panel').style.display = 'none';
};

document.getElementById('btn-add-participant')?.addEventListener('click', () => {
    const uid = evtResolveSelectedParticipantUid();
    if (!uid) return window.showToast('براہ کرم تلاش کر کے فرد منتخب کریں!', 'warning');

    if (window.currentEventParticipants.find((p) => p.id === uid)) {
      return window.showToast('یہ شخص پہلے ہی فہرست میں شامل ہے!', 'warning');
    }

    const user = evtGetUsers().find((u) => u.id === uid);
    if (!user) return;

    window.currentEventParticipants.push(evtToParticipant(user));
    evtPopulateExcludeClass();
    evtInitParticipantSearch();
    renderEventParticipants();
  });

function renderEventParticipants() {
  const tbody = document.getElementById('evt-attendance-tbody');
  if (!tbody) return;
  attEnsureEvtStatusDelegation();
  const symbols = JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };

  const badge = document.getElementById('evt-count-badge');
  if (badge) badge.textContent = `کل شرکاء: ${window.currentEventParticipants.length}`;

  var scrollEl = tbody.closest('table') && tbody.closest('table').parentElement;
  if (scrollEl && !scrollEl.style.maxHeight) {
    scrollEl.style.maxHeight = '48vh';
    scrollEl.style.overflowY = 'auto';
  }

  if (window.currentEventParticipants.length === 0) {
    attDisposeChunked('evt');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">"فوری انتخاب" سے سب شامل کریں یا انفرادی شریک تلاش کریں</td></tr>';
    var evtFoot = document.getElementById('evt-chunk-foot');
    if (evtFoot) evtFoot.textContent = '';
    return;
  }

  var rowHtml = window.currentEventParticipants.map(function (p) {
    return attBuildEventParticipantRow(p, symbols);
  });

  attRenderChunkedRows({
    tbody: tbody,
    scrollEl: scrollEl,
    rows: rowHtml,
    footId: 'evt-chunk-foot',
    emptyHtml: '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">کوئی شریک نہیں</td></tr>',
    disposeKey: 'evt'
  });
}

window.removeEventParticipant = function (uid) {
  window.currentEventParticipants = window.currentEventParticipants.filter((p) => p.id !== uid);
  evtPopulateExcludeClass();
  renderEventParticipants();
};

function evtSyncStatusesFromUI() {
  document.querySelectorAll('.evt-status-select').forEach((sel) => {
    let participant = window.currentEventParticipants.find((x) => x.id === sel.getAttribute('data-uid'));
    if (participant) participant.status = sel.value;
  });
}

document.getElementById('btn-save-event-att')?.addEventListener('click', () => {
  if (window.currentEventParticipants.length === 0) return window.showToast('فہرست میں کوئی شریک موجود نہیں!', 'error');

  evtSyncStatusesFromUI();

  var eventName = document.getElementById('evt-name').value.trim();
  var eventDate = document.getElementById('evt-date').value;
  if (!eventName || !eventDate) {
    return window.showToast('تقریب کا نام اور تاریخ لازمی ہیں!', 'error');
  }

  const payload = {
    name: eventName,
    type: document.getElementById('evt-type').value,
    date: eventDate,
    time: document.getElementById('evt-time').value,
    participants: window.currentEventParticipants,
    timestamp: new Date().getTime(),
  };

  const isEdit = !!window._evtEditId;
  if (isEdit) {
    payload.id = window._evtEditId;
  } else {
    payload.id = window.generateID ? window.generateID('EVT') : 'EVT-' + Math.floor(Math.random() * 9000);
  }

  const btn = document.getElementById('btn-save-event-att');
  if (btn) {
    btn.disabled = true;
  }

  Promise.resolve(window.attSaveEventAttendance(payload, { isEdit: isEdit })).then(function (res) {
    if (!res || !res.ok) {
      window.showToast('تقریب محفوظ نہیں ہو سکی', 'error');
      return;
    }
    if (isEdit) {
      window.showToast('تقریباتی رجسٹر میں ترمیم محفوظ ہو گئی!', 'success');
      if (typeof logAttAudit === 'function') logAttAudit('تقریب ترمیم', `تقریب: ${payload.name}`);
    } else {
      window.showToast('تقریب کی مکمل حاضری کامیابی سے محفوظ کر لی گئی!', 'success');
      if (typeof logAttAudit === 'function') logAttAudit('تقریب حاضری', `تقریب: ${payload.name} | شرکاء: ${payload.participants.length}`);
    }
    if (res.offline && !res.synced) {
      window.showToast('آف لائن محفوظ — کلاؤڈ سنک بعد میں', 'info');
    }
    window._evtEditId = null;
    window.currentEventParticipants = [];
    document.getElementById('evt-participants-panel').style.display = 'none';
    renderSavedEvents();
  }).catch(function (err) {
    console.error('[EMS] btn-save-event-att', err);
    window.showToast('تقریب محفوظ نہیں ہو سکی', 'error');
  }).finally(function () {
    if (btn) btn.disabled = false;
  });
});

// محفوظ شدہ تقریبات کی فہرست (CRUD)
window.renderSavedEvents = function () {
  const tbody = document.getElementById('evt-saved-tbody');
  if (!tbody) return;
  const symbols = JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
  const events = evtReadEventsDb();

  if (events.length === 0) {
    attDisposeChunked('evt-saved');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">ابھی کوئی تقریب محفوظ نہیں</td></tr>';
    var emptyFoot = document.getElementById('evt-saved-chunk-foot');
    if (emptyFoot) emptyFoot.textContent = '';
    return;
  }

  var rowHtml = events
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .map(function (e) {
      const present = (e.participants || []).filter((p) => p.status === symbols.P).length;
      const absent = (e.participants || []).filter((p) => p.status === symbols.A).length;
      const leave = (e.participants || []).filter((p) => p.status === symbols.L).length;
      var eid = String(e.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return (
        '<td><strong>' + (e.name || '-') + '</strong>' + (e.time ? '<br><small style="color:#7f8c8d;">' + e.time + '</small>' : '') + '</td>' +
        '<td><span class="evt-type-tag">' + (e.type || '-') + '</span></td>' +
        '<td>' + (e.date || '-') + '</td>' +
        '<td style="text-align:center; font-weight:bold;">' + (e.participants || []).length + '</td>' +
        '<td style="text-align:center;"><span class="att-status-present" style="font-weight:bold;">' + present + '</span> / <span class="att-status-absent" style="font-weight:bold;">' + absent + '</span> / <span class="att-status-leave" style="font-weight:bold;">' + leave + '</span></td>' +
        '<td>' +
        '<button class="icon-btn" style="color:var(--accent);" title="ترمیم" onclick="editEvent(\'' + eid + '\')"><i class="fas fa-edit"></i></button> ' +
        '<button class="icon-btn delete" title="حذف" onclick="deleteEvent(\'' + eid + '\')"><i class="fas fa-trash"></i></button>' +
        '</td>'
      );
    });

  var scrollEl = tbody.closest('table') && tbody.closest('table').parentElement;
  if (scrollEl && !scrollEl.style.maxHeight) {
    scrollEl.style.maxHeight = '48vh';
    scrollEl.style.overflowY = 'auto';
  }

  attRenderChunkedRows({
    tbody: tbody,
    scrollEl: scrollEl,
    rows: rowHtml,
    footId: 'evt-saved-chunk-foot',
    emptyHtml: '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">ابھی کوئی تقریب محفوظ نہیں</td></tr>',
    disposeKey: 'evt-saved'
  });
};

window.editEvent = function (id) {
  const events = evtReadEventsDb();
  const e = events.find((x) => x.id === id);
  if (!e) return;

  window._evtEditId = id;
  window.currentEventParticipants = JSON.parse(JSON.stringify(e.participants || []));
  document.getElementById('evt-name').value = e.name || '';
  document.getElementById('evt-type').value = e.type || 'اجلاس';
  document.getElementById('evt-date').value = e.date || '';
  document.getElementById('evt-time').value = e.time || '';

  evtEnsureParticipantSearchBound();
  evtInitParticipantSearch();

  evtPopulateExcludeClass();
  document.getElementById('evt-participants-panel').style.display = 'block';
  renderEventParticipants();
  document.getElementById('evt-participants-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  window.showToast('ترمیم کے لیے رجسٹر کھل گیا', 'info');
};

window.deleteEvent = function (id) {
  if (!confirm('کیا آپ واقعی یہ تقریباتی رجسٹر حذف کرنا چاہتے ہیں؟')) return;
  const events = evtReadEventsDb();
  const ev = events.find((x) => x.id === id);
  Promise.resolve(window.attDeleteEventAttendance(id)).then(function (res) {
    if (!res || !res.ok) {
      window.showToast('تقریب حذف نہیں ہو سکی', 'error');
      return;
    }
    if (typeof moveToRecycleBin === 'function' && ev) moveToRecycleBin('تقریباتی رجسٹر', ev);
    if (typeof logAttAudit === 'function') logAttAudit('تقریب حذف', `تقریب: ${ev ? ev.name : id}`);
    renderSavedEvents();
    window.showToast('تقریباتی رجسٹر حذف کر دیا گیا', 'error');
  });
};

// ============================================================================
// حصہ 7: خودکار رپورٹنگ، فیصد اور خلاصہ (Reports Logic)
// ============================================================================
var ATT_CHUNK_PAGE_SIZE = 50;
var ATT_CHUNK_DOM_MAX = 200;
window._attChunkDisposers = window._attChunkDisposers || Object.create(null);

function attEnsureReportScrollWrap() {
  var table = document.getElementById('att-report-table');
  if (!table) return null;
  var wrap = document.getElementById('att-report-scroll-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'att-report-scroll-wrap';
    wrap.style.cssText = 'max-height:60vh;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }
  return wrap;
}

function attDisposeChunked(disposeKey) {
  if (!disposeKey || !window._attChunkDisposers[disposeKey]) return;
  try { window._attChunkDisposers[disposeKey](); } catch (eDisp) { /* ignore */ }
  delete window._attChunkDisposers[disposeKey];
}

/** Chunked tbody renderer — 50 rows/page on scroll; DOM capped (dashboard pattern). */
function attRenderChunkedRows(cfg) {
  cfg = cfg || {};
  var tbody = cfg.tbody;
  var scrollEl = cfg.scrollEl;
  var rows = cfg.rows || [];
  var footId = cfg.footId;
  var emptyHtml = cfg.emptyHtml;
  var pageSize = cfg.pageSize || ATT_CHUNK_PAGE_SIZE;
  var domMax = cfg.domMax || ATT_CHUNK_DOM_MAX;
  var disposeKey = cfg.disposeKey;

  if (disposeKey) attDisposeChunked(disposeKey);
  if (!tbody) return;

  var foot = footId ? document.getElementById(footId) : null;
  if (!foot && footId) {
    foot = document.createElement('div');
    foot.id = footId;
    foot.style.cssText = 'font-size:12px;color:#94a3b8;text-align:center;padding:8px 4px;';
    var anchor = scrollEl || tbody.closest('table');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(foot, anchor.nextSibling);
  }

  var state = { offset: 0, loading: false, done: false, loaded: 0, total: rows.length };

  function updateFooter() {
    if (!foot) return;
    foot.textContent = 'دکھائے گئے: ' + state.loaded.toLocaleString() + ' / ' + state.total.toLocaleString();
  }

  function evictOverflowRows() {
    while (tbody.children.length > domMax) {
      var first = tbody.firstElementChild;
      if (!first) break;
      var rowH = first.offsetHeight || 0;
      tbody.removeChild(first);
      if (rowH > 0 && scrollEl && scrollEl.scrollTop > 0) {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - rowH);
      }
    }
  }

  function appendBatch(batch) {
    batch = batch || [];
    if (!batch.length && state.loaded === 0) {
      tbody.innerHTML = emptyHtml || '<tr><td colspan="8" style="text-align:center;">کوئی ریکارڈ نہیں</td></tr>';
      if (foot) foot.textContent = '0 / 0';
      state.done = true;
      return;
    }
    if (state.loaded === 0) tbody.innerHTML = '';
    batch.forEach(function (html) {
      var tr = document.createElement('tr');
      tr.innerHTML = html;
      tbody.appendChild(tr);
    });
    state.loaded += batch.length;
    evictOverflowRows();
    updateFooter();
  }

  function loadMore() {
    if (state.loading || state.done) return;
    state.loading = true;
    var batch = rows.slice(state.offset, state.offset + pageSize);
    appendBatch(batch);
    state.offset += batch.length;
    state.loading = false;
    if (!batch.length || batch.length < pageSize || state.offset >= rows.length) {
      state.done = true;
      updateFooter();
    }
  }

  var onScroll = function () {
    if (state.done || state.loading || !scrollEl) return;
    if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 48) loadMore();
  };

  if (scrollEl) {
    if (scrollEl._attChunkScroll) scrollEl.removeEventListener('scroll', scrollEl._attChunkScroll);
    scrollEl._attChunkScroll = onScroll;
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
  }

  if (disposeKey) {
    window._attChunkDisposers[disposeKey] = function () {
      if (scrollEl && scrollEl._attChunkScroll) {
        scrollEl.removeEventListener('scroll', scrollEl._attChunkScroll);
        scrollEl._attChunkScroll = null;
      }
    };
  }

  loadMore();
}

function attBuildEventParticipantRow(p, symbols) {
  var uid = String(p.id || '').replace(/'/g, "\\'");
  var eventKind = attStatusKind(p.status, symbols);
  var eventStatusClass = eventKind === 'P' ? 'att-status-present'
    : (eventKind === 'A' ? 'att-status-absent' : (eventKind === 'L' ? 'att-status-leave' : ''));
  return '<tr>' +
    '<td><small>' + (p.id || '') + '</small></td>' +
    '<td><strong>' + (p.name || '') + '</strong><br><small style="color:var(--accent);">' + (p.role || '') + '</small></td>' +
    '<td>' +
    '<select class="input-control evt-status-select ' + eventStatusClass + '" data-uid="' + (p.id || '') + '" style="width: 150px; font-weight:bold; padding:5px;">' +
    '<option value="' + symbols.P + '" ' + (p.status === symbols.P ? 'selected' : '') + '>حاضر (' + symbols.P + ')</option>' +
    '<option value="' + symbols.A + '" ' + (p.status === symbols.A ? 'selected' : '') + '>غیر حاضر (' + symbols.A + ')</option>' +
    '<option value="' + symbols.L + '" ' + (p.status === symbols.L ? 'selected' : '') + '>رخصت (' + symbols.L + ')</option>' +
    '</select></td>' +
    '<td><button class="icon-btn delete" onclick="removeEventParticipant(\'' + uid + '\')"><i class="fas fa-trash"></i></button></td>' +
    '</tr>';
}

function attEnsureEvtStatusDelegation() {
  if (window._evtStatusDelegationBound) return;
  var tbody = document.getElementById('evt-attendance-tbody');
  if (!tbody) return;
  window._evtStatusDelegationBound = true;
  tbody.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel || !sel.classList || !sel.classList.contains('evt-status-select')) return;
    var uid = sel.getAttribute('data-uid');
    var participant = window.currentEventParticipants.find(function (x) { return x.id === uid; });
    if (participant) participant.status = sel.value;
    sel.classList.remove('att-status-present', 'att-status-absent', 'att-status-leave');
    var kind = attStatusKind(sel.value, attGetAttSymbols());
    if (kind === 'P') sel.classList.add('att-status-present');
    else if (kind === 'A') sel.classList.add('att-status-absent');
    else if (kind === 'L') sel.classList.add('att-status-leave');
  });
}

function attReportStatusKind(status, symbols) {
  if (typeof window.attMetricsClassifyStatus === 'function') {
    var bucket = window.attMetricsClassifyStatus(status, symbols);
    if (bucket === 'P') return 'present';
    if (bucket === 'A') return 'absent';
    if (bucket === 'L') return 'leave';
    return 'other';
  }
  var st = String(status == null ? '' : status).trim();
  if (!st) return '';
  if (st === symbols.P || st === 'P' || st === 'حاضر' || st === 'ح') return 'present';
  if (st === symbols.A || st === 'A' || st === 'غائب' || st === 'غ' || st === 'غیر حاضر') return 'absent';
  if (st === symbols.L || st === 'L' || st === 'رخصت' || st === 'ر' || st === 'Leave') return 'leave';
  return 'other';
}

function attReportFindUserRecord(records, user) {
  if (!records || !user) return null;
  var ids = [attGetUserId(user), user.id, user.regId, user.uid, user.docId].filter(Boolean);
  var seen = Object.create(null);
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i]).trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    if (records[id]) return records[id];
  }
  return null;
}

function attBuildReportRowHtml(user, allRecords, fromDate, toDate, symbols) {
  var collected = (typeof window.attMetricsReportCollectMarks === 'function')
    ? window.attMetricsReportCollectMarks(user, allRecords, fromDate, toDate, symbols)
    : null;
  var finalMarks = collected ? collected.finalMarks : Object.create(null);
  var reasons = collected ? collected.reasons : Object.create(null);

  if (!collected) {
    var periodMarks = Object.create(null);
    var dailyMarks = Object.create(null);
    reasons = Object.create(null);

    function inRange(sheet, dayKey) {
      var dayNum = parseInt(dayKey, 10);
      if (!dayNum || dayNum < 1 || dayNum > 31) return '';
      var fullDate = sheet.month + '-' + (dayNum < 10 ? '0' + dayNum : String(dayNum));
      return fullDate >= fromDate && fullDate <= toDate ? fullDate : '';
    }
    function shouldReplace(candidate, current) {
      if (!current) return true;
      if (candidate.timestamp !== current.timestamp) return candidate.timestamp > current.timestamp;
      return candidate.kind !== 'other' && current.kind === 'other';
    }
    function addReason(date, remark, timestamp) {
      if (!remark) return;
      if (!reasons[date] || timestamp >= reasons[date].timestamp) {
        reasons[date] = { text: date + ': ' + remark, timestamp: timestamp };
      }
    }

    allRecords.forEach(function (sheet) {
      var userRecord = attReportFindUserRecord(sheet.records, user) || {};
      var userPeriods = attReportFindUserRecord(sheet.periodRecords, user) || {};
      var userRemarks = attReportFindUserRecord(sheet.remarks, user) || {};
      var timestamp = Number(sheet.timestamp) || 0;

      Object.keys(userPeriods).forEach(function (dayKey) {
        var fullDate = inRange(sheet, dayKey);
        if (!fullDate || !userPeriods[dayKey] || typeof userPeriods[dayKey] !== 'object') return;
        Object.keys(userPeriods[dayKey]).forEach(function (periodId) {
          var kind = attReportStatusKind(userPeriods[dayKey][periodId], symbols);
          if (!kind || kind === 'other') return;
          var key = fullDate + '|' + String(periodId);
          var candidate = { kind: kind, timestamp: timestamp };
          if (shouldReplace(candidate, periodMarks[key])) periodMarks[key] = candidate;
        });
        addReason(fullDate, userRemarks[dayKey], timestamp);
      });

      Object.keys(userRecord).forEach(function (dayKey) {
        var fullDate = inRange(sheet, dayKey);
        if (!fullDate) return;
        var kind = attReportStatusKind(userRecord[dayKey], symbols);
        if (!kind || kind === 'other') return;
        var candidate = { kind: kind, timestamp: timestamp };
        if (shouldReplace(candidate, dailyMarks[fullDate])) dailyMarks[fullDate] = candidate;
        addReason(fullDate, userRemarks[dayKey], timestamp);
      });
    });

    Object.keys(periodMarks).forEach(function (key) {
      finalMarks[key] = periodMarks[key];
    });
    Object.keys(dailyMarks).forEach(function (date) {
      var hasPeriodForDate = Object.keys(periodMarks).some(function (key) {
        return key.indexOf(date + '|') === 0;
      });
      if (!hasPeriodForDate) finalMarks[date + '|daily'] = dailyMarks[date];
    });
  }

  var totalHours = 0, present = 0, absent = 0, leave = 0;
  Object.keys(finalMarks).forEach(function (key) {
    var kind = finalMarks[key].kind;
    totalHours++;
    if (kind === 'present') present++;
    else if (kind === 'absent') absent++;
    else if (kind === 'leave') leave++;
  });
  if (totalHours <= 0) return null;

  var percentage = Math.round((present / totalHours) * 100);
  var pctColor = percentage >= 75 ? 'var(--success)' : percentage >= 50 ? 'var(--warning)' : 'var(--danger)';
  var remarksText = Object.keys(reasons).sort().map(function (date) {
    return reasons[date].text;
  }).join(' | ');
  var uid = attGetUserId(user);
  return '<tr>' +
    '<td><strong>' + (user.name || uid) + '</strong><br><small style="color:#7f8c8d;">' + uid + '</small></td>' +
    '<td>' + (attGetUserClass(user) || user.type || '—') + '</td>' +
    '<td style="font-weight:bold;">' + totalHours + '</td>' +
    '<td class="att-status-present" style="font-weight:bold;">' + present + '</td>' +
    '<td class="att-status-absent" style="font-weight:bold;">' + absent + '</td>' +
    '<td class="att-status-leave" style="font-weight:bold;">' + leave + '</td>' +
    '<td style="color:' + pctColor + '; font-weight:bold; font-size:16px;" title="گھنٹہ حاضری (P / P+A+L)">' + percentage + '%</td>' +
    '<td><input type="text" class="input-control" value="' + remarksText.replace(/"/g, '&quot;') + '" placeholder="تبصرہ / کیفیت..." style="border:none; border-bottom:1px solid #ccc; width:100%; border-radius:0; background:transparent;"></td>' +
    '</tr>';
}

var _repSearchUsersCache = null;
var _repSearchDebounce = null;

function repInitIndividualSearch() {
  _repSearchUsersCache = attGetUsers();
  var input = document.getElementById('rep-att-individual-search');
  var hidden = document.getElementById('rep-att-specific');
  var results = document.getElementById('rep-att-individual-results');
  if (input) {
    input.value = '';
    input.removeAttribute('data-selected-uid');
  }
  if (hidden) hidden.value = '';
  if (results) {
    results.innerHTML = '';
    results.style.display = 'none';
  }
}

function repFilterUsersForSearch(q) {
  q = String(q || '').trim().toLowerCase();
  var users = _repSearchUsersCache || attGetUsers();
  if (!q) return [];
  return users.filter(function (u) {
    if (!u || !attGetUserId(u)) return false;
    var hay = [attGetUserId(u), u.name, u.class, u.type, u.dept].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }).slice(0, ATT_SEARCH_MAX);
}

function repRenderIndividualSearchResults(q) {
  var box = document.getElementById('rep-att-individual-results');
  var input = document.getElementById('rep-att-individual-search');
  var hidden = document.getElementById('rep-att-specific');
  if (!box || !input) return;
  var matches = repFilterUsersForSearch(q);
  if (!q) {
    box.innerHTML = '';
    box.style.display = 'none';
    if (hidden) hidden.value = '';
    return;
  }
  if (!matches.length) {
    box.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">کوئی نتیجہ نہیں</div>';
    box.style.display = 'block';
    if (hidden) hidden.value = '';
    return;
  }
  box.innerHTML = matches.map(function (u) {
    var uid = attGetUserId(u);
    return '<button type="button" class="rep-search-item" data-uid="' + uid + '" style="display:block;width:100%;text-align:right;padding:8px 12px;border:none;border-bottom:1px solid #eef2f6;background:#fff;cursor:pointer;">' + evtParticipantLabel(u) + '</button>';
  }).join('');
  box.style.display = 'block';
}

function repResolveSelectedIndividualUid() {
  var hidden = document.getElementById('rep-att-specific');
  if (hidden && hidden.value) return hidden.value;
  var input = document.getElementById('rep-att-individual-search');
  if (!input) return '';
  var uid = input.getAttribute('data-selected-uid') || '';
  if (uid) return uid;
  var q = String(input.value || '').trim().toLowerCase();
  if (!q) return '';
  var users = _repSearchUsersCache || attGetUsers();
  var exact = users.find(function (u) {
    if (!u || !attGetUserId(u)) return false;
    return String(attGetUserId(u)).toLowerCase() === q || String(u.name || '').toLowerCase() === q;
  });
  return exact ? attGetUserId(exact) : '';
}

function repEnsureIndividualSearchBound() {
  if (window._repIndividualSearchBound) return;
  var input = document.getElementById('rep-att-individual-search');
  var results = document.getElementById('rep-att-individual-results');
  var hidden = document.getElementById('rep-att-specific');
  if (!input || !results) return;
  window._repIndividualSearchBound = true;

  _repSearchDebounce = attDebounce(function () {
    repRenderIndividualSearchResults(input.value);
  }, ATT_SEARCH_DEBOUNCE_MS);

  input.addEventListener('input', function () {
    input.removeAttribute('data-selected-uid');
    if (hidden) hidden.value = '';
    _repSearchDebounce();
  });

  input.addEventListener('focus', function () {
    if (input.value) _repSearchDebounce();
  });

  results.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.rep-search-item') : null;
    if (!btn) return;
    var pickUid = btn.getAttribute('data-uid');
    if (!pickUid) return;
    input.setAttribute('data-selected-uid', pickUid);
    input.value = btn.textContent || pickUid;
    if (hidden) hidden.value = pickUid;
    results.style.display = 'none';
  });

  document.addEventListener('click', function (ev) {
    if (!results.contains(ev.target) && ev.target !== input) {
      results.style.display = 'none';
    }
  });
}

window.generateAttReport = function () {
  var fromDate = document.getElementById('rep-att-from') && document.getElementById('rep-att-from').value;
  var toDate = document.getElementById('rep-att-to') && document.getElementById('rep-att-to').value;
  var targetType = document.getElementById('rep-att-target') && document.getElementById('rep-att-target').value;
  var specificVal = '';
  if (targetType === 'class') {
    var classSel = document.getElementById('rep-att-specific-class');
    specificVal = classSel ? classSel.value : '';
  } else if (targetType === 'individual') {
    specificVal = repResolveSelectedIndividualUid();
  }

  if (!fromDate || !toDate) {
    if (typeof window.showToast === 'function') window.showToast('رپورٹ کے لیے شروع اور اختتامی تاریخ کا انتخاب لازمی ہے!', 'error');
    return Promise.resolve();
  }
  if (fromDate > toDate) {
    if (typeof window.showToast === 'function') window.showToast('شروع کی تاریخ اختتام سے بعد نہیں ہو سکتی!', 'error');
    return Promise.resolve();
  }
  if (targetType !== 'all' && !specificVal) {
    if (typeof window.showToast === 'function') window.showToast('رپورٹ کا ہدف منتخب کریں!', 'error');
    return Promise.resolve();
  }

  var users = attGetUsers();
  var targetUsers = [];
  if (targetType === 'all') targetUsers = users;
  else if (targetType === 'class') {
    targetUsers = users.filter(function (u) {
      return attGetUserClass(u) === specificVal || String(u.class || '') === specificVal;
    });
  } else if (targetType === 'individual') {
    targetUsers = users.filter(function (u) {
      return attGetUserId(u) === specificVal || String(u.id || '') === specificVal;
    });
  }

  if (!targetUsers.length) {
    if (typeof window.showToast === 'function') window.showToast('اس کرائیٹیریا پر کوئی فرد موجود نہیں!', 'error');
    return Promise.resolve();
  }

  var tbody = document.getElementById('att-report-tbody');
  var printArea = document.getElementById('att-report-print-area');
  var btn = document.getElementById('btn-generate-att-report');
  if (!tbody) return Promise.resolve();

  attDisposeChunked('report');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;"><i class="fas fa-spinner fa-spin"></i> رپورٹ تیار ہو رہی ہے...</td></tr>';
  if (btn) {
    btn.disabled = true;
    if (!btn.dataset.prevHtml) btn.dataset.prevHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> لوڈ ہو رہا ہے...';
  }

  var symbols = {};
  try {
    symbols = JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
  } catch (eSym) {
    symbols = { P: 'P', A: 'A', L: 'L' };
  }

  var collectFn = typeof window.emsAttCollectReportSheetsAsync === 'function'
    ? window.emsAttCollectReportSheetsAsync
    : function () { return Promise.resolve([]); };

  return collectFn(fromDate, toDate).then(function (allRecords) {
    var rowHtmlList = [];
    targetUsers.forEach(function (user) {
      var row = attBuildReportRowHtml(user, allRecords, fromDate, toDate, symbols);
      if (row) rowHtmlList.push(row);
    });

    window._attReportRowHtmlCache = rowHtmlList.slice();

    if (!rowHtmlList.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;">مطلوبہ تاریخوں (' + fromDate + ' تا ' + toDate + ') کے دوران ان افراد کا کوئی حاضری ریکارڈ موجود نہیں ہے۔<br><small style="color:#94a3b8;">پہلے اسمارٹ رجسٹر میں حاضری درج کریں۔</small></td></tr>';
      window._attReportRowHtmlCache = [];
      var emptyFoot = document.getElementById('att-report-chunk-foot');
      if (emptyFoot) emptyFoot.textContent = '';
      if (typeof window.showToast === 'function') {
        window.showToast('اس تاریخ کی حد میں کوئی حاضری ڈیٹا نہیں ملا', 'warning');
      }
    } else {
      var scrollWrap = attEnsureReportScrollWrap();
      attRenderChunkedRows({
        tbody: tbody,
        scrollEl: scrollWrap,
        rows: rowHtmlList,
        footId: 'att-report-chunk-foot',
        disposeKey: 'report'
      });
      if (typeof window.showToast === 'function') {
        window.showToast('رپورٹ کامیابی کے ساتھ تیار ہو گئی ہے!', 'success');
      }
    }

    var repTitle = document.getElementById('rep-print-title');
    if (repTitle) repTitle.innerText = 'حاضری کا تفصیلی خلاصہ (' + fromDate + ' تا ' + toDate + ')';

    if (printArea) {
      printArea.style.display = 'block';
      printArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }).catch(function (err) {
    console.error('[EMS] generateAttReport', err);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--danger);">رپورٹ لوڈ نہیں ہو سکی۔ دوبارہ کوشش کریں۔</td></tr>';
    if (typeof window.showToast === 'function') window.showToast('رپورٹ تیار کرنے میں خرابی', 'error');
  }).finally(function () {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.prevHtml || '<i class="fas fa-search"></i> رپورٹ تیار کریں';
    }
  });
};

document.getElementById('rep-att-target')?.addEventListener('change', function () {
    const val = this.value;
    const dynamicDiv = document.getElementById('rep-att-dynamic-target');
    const classSelect = document.getElementById('rep-att-specific-class');
    const individualWrap = document.getElementById('rep-att-individual-wrap');

    if (val === 'all') {
      dynamicDiv.style.display = 'none';
    } else {
      dynamicDiv.style.display = 'block';
      const users = attGetUsers();

      if (val === 'class') {
        if (classSelect) {
          classSelect.style.display = 'block';
          const classes = [...new Set(users.map((u) => u.class).filter((c) => c && c !== 'نامعلوم'))];
          classSelect.innerHTML = '<option value="">مخصوص درجہ منتخب کریں...</option>' + classes.map((c) => `<option value="${c}">${c}</option>`).join('');
        }
        if (individualWrap) individualWrap.style.display = 'none';
        repInitIndividualSearch();
      } else if (val === 'individual') {
        if (classSelect) classSelect.style.display = 'none';
        if (individualWrap) individualWrap.style.display = 'block';
        repEnsureIndividualSearchBound();
        repInitIndividualSearch();
      }
    }
  });

document.getElementById('btn-generate-att-report')?.addEventListener('click', function () {
  Promise.resolve(window.generateAttReport()).catch(function (e) {
    console.error('[EMS] btn-generate-att-report', e);
  });
});

// ============================================================================
// ایڈوانسڈ کسٹم ٹیچر لاجک
// ============================================================================
window.loadPeriodTeachers = function () {
  const users = attGetUsers();
  const registeredTeachers = users.filter(function (u) { return attUserMatchesType(u, 'teacher'); });
  const customTeachers = attReadConfigJson(ATT_CUSTOM_TEACHERS_KEY, []) || [];

  const tSelect = document.getElementById('new-period-teacher');
  if (!tSelect) return;

  let html = '<option value="">استاد منتخب کریں...</option>';
  html += '<option value="ADD_NEW" style="color: blue; font-weight: bold;">+ نیا استاد شامل کریں...</option>';

  registeredTeachers.forEach(function (t) {
    var tid = attGetUserId(t);
    if (!tid) return;
    html += '<option value="' + tid + '" class="registered-teacher-option" data-type="registered">[رجسٹرڈ] ' + (t.name || '') + '</option>';
  });
  customTeachers.forEach(function (t) { html += '<option value="' + t.id + '" class="custom-teacher-option" data-type="custom">[عارضی/کسٹم] ' + t.name + '</option>'; });

  tSelect.innerHTML = html;
};

window.checkCustomTeacherSelect = function () {
  const tSelect = document.getElementById('new-period-teacher');
  const customInputArea = document.getElementById('custom-teacher-input-area');
  const delBtn = document.getElementById('btn-del-custom-teacher');

  if (tSelect.value === 'ADD_NEW') {
    if (customInputArea) customInputArea.style.display = 'block';
    if (delBtn) delBtn.style.display = 'none';
  } else {
    if (customInputArea) customInputArea.style.display = 'none';
    const selectedOption = tSelect.options[tSelect.selectedIndex];
    if (selectedOption && selectedOption.getAttribute('data-type') === 'custom') {
      if (delBtn) delBtn.style.display = 'inline-flex';
    } else {
      if (delBtn) delBtn.style.display = 'none';
    }
  }
};

window.deleteCustomTeacher = function () {
  const tSelect = document.getElementById('new-period-teacher');
  const idToDelete = tSelect.value;
  if (!idToDelete || !confirm('کیا آپ واقعی اس کسٹم استاد کو مستقل حذف کرنا چاہتے ہیں؟')) return;

  var referenced = attReadAllTimetablePeriodsRaw().some(function (p) {
    return p && String(p.teacherId || '') === String(idToDelete);
  });
  if (referenced) {
    window.showToast('یہ استاد نظام الاوقات کے گھنٹوں سے منسلک ہے؛ پرانی حاضری کے تحفظ کے لیے پہلے گھنٹے کسی دوسرے استاد کو منتقل کریں۔', 'error');
    return Promise.resolve(false);
  }

  let customTeachers = attReadConfigJson(ATT_CUSTOM_TEACHERS_KEY, []) || [];
  var nextTeachers = customTeachers.filter((t) => t.id !== idToDelete);
  if (nextTeachers.length === customTeachers.length) {
    window.showToast('کسٹم استاد نہیں ملا', 'error');
    return Promise.resolve(false);
  }
  var delBtn = document.getElementById('btn-del-custom-teacher');
  if (delBtn && delBtn._attActionInflight) return delBtn._attActionInflight;
  attSetActionButtonBusy(delBtn, true, 'حذف…');
  var op = attPersistConfigBlob(ATT_CUSTOM_TEACHERS_KEY, nextTeachers)
    .then(attRequirePersistSuccess).then(function () {
      window.showToast('کسٹم استاد حذف کر دیا گیا', 'success');
      loadPeriodTeachers();
      checkCustomTeacherSelect();
      return true;
    }).catch(function (err) {
      console.error('[EMS] custom attendance teacher delete', err);
      window.showToast('کسٹم استاد حذف نہیں ہو سکا', 'error');
      return false;
    }).finally(function () {
      if (delBtn) delBtn._attActionInflight = null;
      attSetActionButtonBusy(delBtn, false);
    });
  if (delBtn) delBtn._attActionInflight = op;
  return op;
};

document.querySelector('[onclick="switchAttTab(\'att-master-settings\', this)"]')?.addEventListener('click', loadPeriodTeachers);

// ============================================================================
// پیریڈ سیو / ترمیم (یک مرکزی ہینڈلر)
// ============================================================================
document.addEventListener('click', function (e) {
  var btnSaveClose = e.target.closest('#btn-save-period');
  var btnSaveMore = e.target.closest('#btn-save-add-more');

  if (btnSaveClose || btnSaveMore) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (window._attPeriodSaveInflight) return;
    var activeBtn = btnSaveClose || btnSaveMore;
    var result = attSavePeriodFromModal({ closeAfter: !!btnSaveClose, addMore: !!btnSaveMore });
    if (result === false) return;
    attSetActionButtonBusy(activeBtn, true, 'محفوظ ہو رہا ہے…');
    window._attPeriodSaveInflight = Promise.resolve(result).finally(function () {
      window._attPeriodSaveInflight = null;
      attSetActionButtonBusy(activeBtn, false);
    });
  }
}, true);

if (typeof window.emsRegisterDepartmentRefresh === 'function') {
  window.emsRegisterDepartmentRefresh('attendance', function () {
    if (typeof window.emsIsAttendanceModuleActive === 'function' && !window.emsIsAttendanceModuleActive()) return;
    if (typeof window.emsInvalidateAttDashboardCache === 'function') {
      window.emsInvalidateAttDashboardCache();
    }
    _attDropdownCacheGen = -1;
    clearTimeout(_attDeptRefreshTimer);
    _attDeptRefreshTimer = setTimeout(function () {
      if (typeof loadAttDropdowns === 'function') loadAttDropdowns(true);
      if (attPanelIsVisible('att-dashboard-panel') && typeof window.renderAttDashboard === 'function') {
        window.renderAttDashboard();
      }
      if (attPanelIsVisible('att-smart-register')
          && window.currentAttState
          && window.currentAttState.month
          && typeof buildSmartRegister === 'function') {
        buildSmartRegister(window.currentAttState.month, window.getFilteredUsers());
      }
    }, 180);
  });
}
