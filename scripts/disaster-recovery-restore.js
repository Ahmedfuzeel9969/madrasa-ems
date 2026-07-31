/**
 * EMS Disaster Recovery — restore + count verification (Priority 1)
 *
 * Usage:
 *   node scripts/disaster-recovery-restore.js --bundle=backups/dr-XXX/tenant-encrypted.emsbak --passphrase=secret
 *   node scripts/disaster-recovery-restore.js --simulate --dir=backups/dr-test-sim
 *
 * --simulate runs machine-failure recovery test (no Firebase required).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const backupLib = require('./backup-lib');

const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  var opts = {
    bundle: null,
    passphrase: process.env.EMS_BACKUP_PASSPHRASE || null,
    out: null,
    simulate: false,
    simDir: null,
    verifyOnly: false
  };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--bundle=') === 0) opts.bundle = arg.split('=')[1];
    if (arg.indexOf('--passphrase=') === 0) opts.passphrase = arg.split('=')[1];
    if (arg.indexOf('--out=') === 0) opts.out = arg.split('=')[1];
    if (arg === '--simulate') opts.simulate = true;
    if (arg.indexOf('--dir=') === 0) opts.simDir = arg.split('=')[1];
    if (arg === '--verify-only') opts.verifyOnly = true;
  });
  return opts;
}

function restoreFromBundle(bundlePath, passphrase, outDir) {
  if (!fs.existsSync(bundlePath)) {
    throw new Error('Bundle not found: ' + bundlePath);
  }
  if (!passphrase) {
    throw new Error('Passphrase required — EMS_BACKUP_PASSPHRASE or --passphrase=');
  }
  var bundle = backupLib.readJson(bundlePath);
  var decrypted = backupLib.decryptPayload(bundle, passphrase);
  var exportData = decrypted.export;
  var expectedInventory = decrypted.inventory || backupLib.inventoryTenantPayload(exportData);

  fs.mkdirSync(outDir, { recursive: true });
  var restoredPath = path.join(outDir, 'tenant-export-restored.json');
  backupLib.writeJson(restoredPath, exportData);

  var actualInventory = backupLib.inventoryTenantPayload(exportData);
  var verification = backupLib.compareInventories(expectedInventory, actualInventory);

  return {
    restoredPath: restoredPath,
    tenantId: exportData.tenantId,
    verification: verification,
    inventory: actualInventory
  };
}

function runSimulation(simDir, passphrase) {
  passphrase = passphrase || 'test-passphrase-12345678';
  fs.mkdirSync(simDir, { recursive: true });

  var fakeTenant = {
    tenantId: 'sim-tenant-dr-001',
    exportedAt: new Date().toISOString(),
    registration: {
      users: Array.from({ length: 150 }, function (_, i) {
        return { id: 'STU-' + i, type: 'student', name: 'Student ' + i };
      }),
      rejected: [{ id: 'REJ-1', name: 'Rejected 1' }]
    },
    attendance: [{ id: 'ATT-2025-07', data: { present: 120 } }],
    complaints: [{ id: 'CMP-1', subject: 'Test' }],
    modules: {
      ems_fee_collections: JSON.stringify([{ id: 'FEE-1', amount: 500 }])
    },
    idb: {
      data: {
        ems_classes: JSON.stringify([{ id: 'c1', name: 'Class 1' }])
      }
    }
  };

  backupLib.writeJson(path.join(simDir, 'tenant-export.json'), fakeTenant);

  console.log('[simulate] Original inventory:', JSON.stringify(backupLib.inventoryTenantPayload(fakeTenant)));

  var result = backupLib.simulateMachineFailureRecovery(simDir, passphrase);
  console.log('[simulate] Machine wiped and restored from encrypted bundle');
  console.log('[simulate] Verification:', result.verification.ok ? 'PASS' : 'FAIL');
  if (!result.verification.ok) {
    console.error('[simulate] Diffs:', JSON.stringify(result.verification.diffs));
    process.exitCode = 1;
  } else {
    console.log('[simulate] Counts match:', JSON.stringify(result.inventory));
  }
  return result;
}

function main() {
  var args = parseArgs();

  if (args.simulate) {
    var dir = args.simDir || path.join(ROOT, 'backups', 'dr-test-sim-' + Date.now());
    return runSimulation(dir, args.passphrase);
  }

  if (!args.bundle) {
    console.error('Usage:');
    console.error('  node scripts/disaster-recovery-restore.js --bundle=path/to/tenant-encrypted.emsbak --passphrase=XXX');
    console.error('  node scripts/disaster-recovery-restore.js --simulate [--dir=path]');
    process.exit(1);
  }

  var bundlePath = path.isAbsolute(args.bundle)
    ? args.bundle
    : path.join(ROOT, args.bundle);
  var outDir = args.out || path.join(path.dirname(bundlePath), 'restored');

  console.log('\n=== EMS Disaster Recovery Restore ===');
  console.log('Bundle:', bundlePath);

  var result = restoreFromBundle(bundlePath, args.passphrase, outDir);
  console.log('Restored to:', result.restoredPath);
  console.log('Tenant:', result.tenantId);
  console.log('Inventory:', JSON.stringify(result.inventory));

  if (result.verification.ok) {
    console.log('\n[VERIFY] PASS — recovery counts match original backup inventory');
  } else {
    console.error('\n[VERIFY] FAIL — count mismatch:');
    result.verification.diffs.forEach(function (d) {
      console.error(' ', d.field + ': expected ' + d.expected + ', got ' + d.actual);
    });
    process.exitCode = 1;
  }

  if (!args.verifyOnly) {
    console.log('\nNext steps:');
    console.log('  1. Import tenant-export-restored.json via Admin SDK or in-app EmsBackupService');
    console.log('  2. Run gcloud firestore import if using cloud export tier');
    console.log('  3. Restore Storage mirror with gsutil');
    console.log('  See docs/DISASTER-RECOVERY-PROCEDURE.md');
  }

  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[dr-restore] FAILED:', err.message);
    process.exit(1);
  }
}

module.exports = { restoreFromBundle: restoreFromBundle, runSimulation: runSimulation };
