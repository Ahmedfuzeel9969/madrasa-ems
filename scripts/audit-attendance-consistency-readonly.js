#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — inventory canonical vs legacy attendance documents for one tenant.
 * No document is created, updated, or deleted.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var tenantArg = process.argv.find(function (a) { return a.indexOf('--tenant=') === 0; });
var TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : 'bpV58OqWSKhRbvXL57CvihIlDj63';
var COMPACT = process.argv.indexOf('--compact') >= 0;

async function setupCliCreds() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var cfgPath = candidates.find(function (p) { return p && fs.existsSync(p); });
  if (!cfgPath) return false;
  var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules/firebase-tools/lib/defaultCredentials'));
  var credPath = await defaults.getCredentialPathAsync({ user: cfg.user, tokens: cfg.tokens });
  if (!credPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function parseDocId(id) {
  if (!id || id.indexOf('att_rec_') !== 0) return null;
  var parts = id.slice('att_rec_'.length).split('_');
  if (parts.length < 4) return null;
  return {
    month: parts[0],
    type: parts[1],
    classId: parts.slice(2, -1).join('_'),
    period: parts[parts.length - 1]
  };
}

function countDayValues(records) {
  var cells = 0;
  var users = 0;
  Object.keys(records || {}).forEach(function (uid) {
    var days = records[uid];
    if (!days || typeof days !== 'object') return;
    var n = Object.keys(days).filter(function (day) {
      return days[day] != null && String(days[day]) !== '';
    }).length;
    if (n) users += 1;
    cells += n;
  });
  return { users: users, cells: cells };
}

function countPeriodValues(periodRecords) {
  var cells = 0;
  var users = 0;
  var periodIds = Object.create(null);
  Object.keys(periodRecords || {}).forEach(function (uid) {
    var days = periodRecords[uid];
    var userCells = 0;
    Object.keys(days || {}).forEach(function (day) {
      var pmap = days[day];
      Object.keys(pmap || {}).forEach(function (pid) {
        if (pmap[pid] == null || String(pmap[pid]) === '') return;
        periodIds[pid] = true;
        userCells += 1;
      });
    });
    if (userCells) users += 1;
    cells += userCells;
  });
  return { users: users, cells: cells, periodIds: Object.keys(periodIds) };
}

function valuePresent(value) {
  return value != null && String(value) !== '';
}

function recordTimestamp(data) {
  data = data || {};
  if (data.timestamp) return Number(data.timestamp) || 0;
  if (data.clientUpdatedAt) return Number(data.clientUpdatedAt) || 0;
  var updatedAt = data.updatedAt;
  if (updatedAt && typeof updatedAt.toMillis === 'function') return updatedAt.toMillis();
  if (typeof updatedAt === 'number') return updatedAt;
  if (typeof updatedAt === 'string') return Date.parse(updatedAt) || 0;
  return 0;
}

function canonicalDocIdFor(parsed) {
  if (!parsed) return '';
  var classId = parsed.type === 'teachers' || parsed.type === 'staff'
    ? ''
    : parsed.classId;
  return 'att_rec_' + parsed.month + '_' + parsed.type + '_' + classId + '_all';
}

function isCanonicalScope(parsed) {
  if (!parsed || parsed.period !== 'all') return false;
  if (parsed.type === 'teachers' || parsed.type === 'staff') return parsed.classId === '';
  return true;
}

function compareValue(bucket, sourceValue, targetValue, detail) {
  if (!valuePresent(sourceValue)) return;
  bucket.sourceCells += 1;
  if (!valuePresent(targetValue)) {
    bucket.missingInCanonical += 1;
    if (bucket.samples.length < 20) bucket.samples.push(Object.assign({ result: 'missing' }, detail));
    return;
  }
  if (String(sourceValue) === String(targetValue)) {
    bucket.sameAsCanonical += 1;
    return;
  }
  bucket.conflicts += 1;
  if (bucket.samples.length < 20) {
    bucket.samples.push(Object.assign({
      result: 'conflict',
      sourceValue: sourceValue,
      canonicalValue: targetValue
    }, detail));
  }
}

function compareLegacyWithCanonical(source, canonical) {
  var parsed = source.parsed;
  var sourceData = source.data || {};
  var targetData = canonical && canonical.data || {};
  var bucket = {
    sourceId: source.id,
    canonicalId: canonicalDocIdFor(parsed),
    canonicalExists: !!canonical,
    sourceTimestamp: recordTimestamp(sourceData),
    canonicalTimestamp: recordTimestamp(targetData),
    sourceCells: 0,
    sameAsCanonical: 0,
    missingInCanonical: 0,
    conflicts: 0,
    samples: []
  };

  if (parsed.period === 'all') {
    ['records', 'remarks', 'late'].forEach(function (field) {
      Object.keys(sourceData[field] || {}).forEach(function (uid) {
        Object.keys(sourceData[field][uid] || {}).forEach(function (day) {
          compareValue(
            bucket,
            sourceData[field][uid][day],
            targetData[field] && targetData[field][uid] && targetData[field][uid][day],
            { field: field, uid: uid, day: day }
          );
        });
      });
    });
  } else {
    Object.keys(sourceData.records || {}).forEach(function (uid) {
      Object.keys(sourceData.records[uid] || {}).forEach(function (day) {
        compareValue(
          bucket,
          sourceData.records[uid][day],
          targetData.periodRecords && targetData.periodRecords[uid]
            && targetData.periodRecords[uid][day]
            && targetData.periodRecords[uid][day][parsed.period],
          { field: 'periodRecords', uid: uid, day: day, periodId: parsed.period }
        );
      });
    });
  }

  Object.keys(sourceData.periodRecords || {}).forEach(function (uid) {
    Object.keys(sourceData.periodRecords[uid] || {}).forEach(function (day) {
      Object.keys(sourceData.periodRecords[uid][day] || {}).forEach(function (periodId) {
        compareValue(
          bucket,
          sourceData.periodRecords[uid][day][periodId],
          targetData.periodRecords && targetData.periodRecords[uid]
            && targetData.periodRecords[uid][day]
            && targetData.periodRecords[uid][day][periodId],
          { field: 'periodRecords', uid: uid, day: day, periodId: periodId }
        );
      });
    });
  });
  return bucket;
}

async function main() {
  if (!(await setupCliCreds())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TENANT);
  var profileSnap = await tenantRef.get();
  var profile = profileSnap.exists ? profileSnap.data() || {} : {};
  var snap = await tenantRef.collection('Attendance').get();
  var rows = [];
  var docsById = Object.create(null);
  var attendanceDocs = [];
  var summary = {
    totalDocs: snap.size,
    canonicalDocs: 0,
    legacyPeriodDocs: 0,
    eventDocs: 0,
    otherDocs: 0,
    canonicalDailyCells: 0,
    canonicalPeriodCells: 0,
    legacyDailyCells: 0,
    legacyPeriodCells: 0
  };

  snap.forEach(function (doc) {
    var parsed = parseDocId(doc.id);
    if (!parsed) {
      if (doc.id.indexOf('att_evt_') === 0) summary.eventDocs += 1;
      else summary.otherDocs += 1;
      return;
    }
    var data = doc.data() || {};
    attendanceDocs.push({ id: doc.id, parsed: parsed, data: data });
    docsById[doc.id] = attendanceDocs[attendanceDocs.length - 1];
    var daily = countDayValues(data.records || {});
    var hourly = countPeriodValues(data.periodRecords || data.teacherPeriodRecords || {});
    var kind = isCanonicalScope(parsed)
      ? 'canonical'
      : (parsed.period === 'all'
        ? 'legacy_scope'
        : (/^PRD-/.test(parsed.period) ? 'legacy_period' : 'other_register'));
    if (kind === 'canonical') {
      summary.canonicalDocs += 1;
      summary.canonicalDailyCells += daily.cells;
      summary.canonicalPeriodCells += hourly.cells;
    } else if (kind === 'legacy_period' || kind === 'legacy_scope') {
      summary.legacyPeriodDocs += 1;
      summary.legacyDailyCells += daily.cells;
      summary.legacyPeriodCells += hourly.cells;
    } else {
      summary.otherDocs += 1;
    }
    rows.push({
      id: doc.id,
      kind: kind,
      month: parsed.month,
      type: parsed.type,
      classId: parsed.classId,
      period: parsed.period,
      dailyUsers: daily.users,
      dailyCells: daily.cells,
      periodUsers: hourly.users,
      periodCells: hourly.cells,
      periodIdCount: hourly.periodIds.length,
      hasTimestamp: !!(data.timestamp || data.updatedAt || data.clientUpdatedAt)
    });
  });

  var byMonthType = Object.create(null);
  rows.forEach(function (row) {
    var key = row.month + '|' + row.type;
    if (!byMonthType[key]) {
      byMonthType[key] = { month: row.month, type: row.type, canonicalDocs: 0, legacyPeriodDocs: 0, canonicalCells: 0, legacyCells: 0 };
    }
    var bucket = byMonthType[key];
    if (row.kind === 'canonical') {
      bucket.canonicalDocs += 1;
      bucket.canonicalCells += row.dailyCells + row.periodCells;
    } else if (row.kind === 'legacy_period' || row.kind === 'legacy_scope') {
      bucket.legacyPeriodDocs += 1;
      bucket.legacyCells += row.dailyCells + row.periodCells;
    }
  });

  var comparisons = attendanceDocs.filter(function (entry) {
    return !isCanonicalScope(entry.parsed);
  }).map(function (entry) {
    return compareLegacyWithCanonical(entry, docsById[canonicalDocIdFor(entry.parsed)] || null);
  }).filter(function (row) {
    return row.sourceCells > 0;
  });

  var comparisonSummary = comparisons.reduce(function (acc, row) {
    acc.sources += 1;
    acc.sourceCells += row.sourceCells;
    acc.sameAsCanonical += row.sameAsCanonical;
    acc.missingInCanonical += row.missingInCanonical;
    acc.conflicts += row.conflicts;
    if (!row.canonicalExists) acc.sourcesWithoutCanonical += 1;
    return acc;
  }, {
    sources: 0,
    sourcesWithoutCanonical: 0,
    sourceCells: 0,
    sameAsCanonical: 0,
    missingInCanonical: 0,
    conflicts: 0
  });

  var result = {
    ok: true,
    project: PROJECT,
    tenantId: TENANT,
    tenantName: profile.name || profile.madrasaName || profile.instituteName || '',
    summary: summary,
    byMonthType: Object.keys(byMonthType).sort().map(function (key) { return byMonthType[key]; }),
    canonicalDocuments: rows.filter(function (row) { return row.kind === 'canonical'; }),
    legacyVsCanonical: {
      summary: comparisonSummary,
      sourcesWithDifferences: comparisons.filter(function (row) {
        return row.missingInCanonical || row.conflicts;
      })
    },
    legacyDocumentsWithMarks: rows.filter(function (row) {
      return (row.kind === 'legacy_period' || row.kind === 'legacy_scope') && (row.dailyCells || row.periodCells);
    })
  };
  if (COMPACT) {
    result.legacyVsCanonical.sourcesWithDifferences = result.legacyVsCanonical.sourcesWithDifferences.map(function (row) {
      return {
        sourceId: row.sourceId,
        canonicalId: row.canonicalId,
        canonicalExists: row.canonicalExists,
        sourceTimestamp: row.sourceTimestamp,
        canonicalTimestamp: row.canonicalTimestamp,
        sourceCells: row.sourceCells,
        sameAsCanonical: row.sameAsCanonical,
        missingInCanonical: row.missingInCanonical,
        conflicts: row.conflicts
      };
    });
    delete result.canonicalDocuments;
    delete result.legacyDocumentsWithMarks;
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (err) {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  process.exit(1);
});
