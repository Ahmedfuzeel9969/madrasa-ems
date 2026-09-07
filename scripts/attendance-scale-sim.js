#!/usr/bin/env node
'use strict';

/**
 * Synthetic, read-layer attendance isolation/load simulation.
 * It never connects to Firebase and never writes tenant data.
 */
var path = require('path');
var finalState = require(path.resolve(__dirname, '..', 'functions/lib/attendance-final-state.js'));

function argNumber(name, fallback) {
  var prefix = '--' + name + '=';
  var raw = process.argv.find(function (value) { return value.indexOf(prefix) === 0; });
  var parsed = raw ? Number(raw.slice(prefix.length)) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function percentile(values, p) {
  if (!values.length) return 0;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function makeRecords(tenantIndex, people, days, status) {
  var records = {};
  for (var person = 0; person < people; person++) {
    var id = 'TEN-' + tenantIndex + '-P-' + person;
    records[id] = {};
    for (var day = 1; day <= days; day++) {
      records[id][day] = typeof status === 'function' ? status(person, day) : status;
    }
  }
  return records;
}

function runSimulation(opts) {
  var durations = [];
  var totalFinalCells = 0;
  var crossTenantLeaks = 0;
  var canonicalClearFailures = 0;
  var started = process.hrtime.bigint();
  for (var tenant = 0; tenant < opts.tenants; tenant++) {
    var legacyRecords = makeRecords(tenant, opts.people, opts.days, 'P');
    var canonicalRecords = makeRecords(tenant, opts.people, opts.days, function (person, day) {
      if (person === 0 && day === 1) return null;
      return (person + day) % 11 === 0 ? 'A' : ((person + day) % 17 === 0 ? 'L' : 'P');
    });
    // A deliberate canonical clear removes the mark and records a tombstone.
    delete canonicalRecords['TEN-' + tenant + '-P-0'][1];
    var before = process.hrtime.bigint();
    var resolved = finalState.buildFinalAttendanceState([
      {
        id: 'att_rec_2026-09_students_Class-A_PRD-1',
        data: { timestamp: 200, records: legacyRecords }
      },
      {
        id: 'att_rec_2026-09_students_Class-A_all',
        data: {
          timestamp: 100,
          records: canonicalRecords,
          clearedCells: { days: { ['TEN-' + tenant + '-P-0']: { 1: true } } }
        }
      }
    ], '2026-09', { includeTypes: ['students'] });
    var after = process.hrtime.bigint();
    durations.push(Number(after - before) / 1e6);
    var keys = Object.keys(resolved);
    totalFinalCells += keys.length;
    if (resolved['TEN-' + tenant + '-P-0|1']) canonicalClearFailures++;
    keys.forEach(function (key) {
      if (key.indexOf('TEN-' + tenant + '-P-') !== 0) crossTenantLeaks++;
    });
  }
  var totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    ok: crossTenantLeaks === 0 && canonicalClearFailures === 0,
    mode: 'synthetic_read_only',
    tenants: opts.tenants,
    peoplePerTenant: opts.people,
    days: opts.days,
    generatedCells: opts.tenants * opts.people * opts.days * 2,
    finalCells: totalFinalCells,
    crossTenantLeaks: crossTenantLeaks,
    canonicalClearFailures: canonicalClearFailures,
    totalMs: Number(totalMs.toFixed(2)),
    averageTenantMs: Number((totalMs / opts.tenants).toFixed(4)),
    p95TenantMs: Number(percentile(durations, 0.95).toFixed(4)),
    maxTenantMs: Number(Math.max.apply(Math, durations).toFixed(4)),
    note: 'This validates deterministic tenant isolation/CPU behavior, not Firebase quota or network capacity.'
  };
}

if (require.main === module) {
  var result = runSimulation({
    tenants: argNumber('tenants', 1000),
    people: argNumber('people', 100),
    days: Math.min(31, argNumber('days', 26))
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

module.exports = { runSimulation: runSimulation, makeRecords: makeRecords, percentile: percentile };
