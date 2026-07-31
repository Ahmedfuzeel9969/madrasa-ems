/**
 * EMS Disaster Recovery — shared backup/restore utilities (Priority 1)
 * Used by disaster-recovery-backup.js, disaster-recovery-restore.js, and unit tests.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BACKUP_FORMAT = 'ems-dr-bundle';
const BACKUP_FORMAT_VERSION = 1;
const ENCRYPTION_ALGO = 'aes-256-gcm';

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function countArrayLike(val) {
  if (val == null) return 0;
  if (Array.isArray(val)) return val.length;
  if (typeof val === 'object') return Object.keys(val).length;
  return 1;
}

function countRecordsInKey(key, raw) {
  if (raw == null) return 0;
  if (typeof raw !== 'string') return countArrayLike(raw);
  try {
    return countArrayLike(JSON.parse(raw));
  } catch (e) {
    return 0;
  }
}

/**
 * Build a stable inventory of business record counts from a tenant export payload.
 */
function inventoryTenantPayload(payload) {
  var counts = {
    registrations: 0,
    rejected: 0,
    attendance_registers: 0,
    complaints: 0,
    module_keys: 0,
    idb_keys: 0,
    total_records: 0
  };
  if (!payload) return counts;

  if (payload.registration) {
    counts.registrations = countArrayLike(payload.registration.users);
    counts.rejected = countArrayLike(payload.registration.rejected);
  }
  if (payload.attendance) {
    counts.attendance_registers = countArrayLike(payload.attendance);
  }
  if (payload.complaints) {
    counts.complaints = countArrayLike(payload.complaints);
  }
  if (payload.feeCollections) {
    counts.fee_collections = countArrayLike(payload.feeCollections);
  }
  if (payload.staffPermissions) {
    counts.staff_permissions = countArrayLike(payload.staffPermissions);
  }
  if (payload.staffLinks) {
    counts.staff_links = countArrayLike(payload.staffLinks);
  }
  if (payload.parentLinks) {
    counts.parent_links = countArrayLike(payload.parentLinks);
  }
  if (payload.storageFiles) {
    counts.storage_files = countArrayLike(payload.storageFiles);
  }
  if (payload.modules && typeof payload.modules === 'object') {
    counts.module_keys = Object.keys(payload.modules).length;
    Object.keys(payload.modules).forEach(function (k) {
      counts.total_records += countRecordsInKey(k, payload.modules[k]);
    });
  }
  if (payload.idb && payload.idb.data) {
    counts.idb_keys = Object.keys(payload.idb.data).length;
    Object.keys(payload.idb.data).forEach(function (k) {
      counts.total_records += countRecordsInKey(k, payload.idb.data[k]);
    });
  }
  counts.total_records += counts.registrations + counts.rejected
    + counts.attendance_registers + counts.complaints
    + (counts.fee_collections || 0);
  return counts;
}

function compareInventories(expected, actual) {
  var keys = ['registrations', 'rejected', 'attendance_registers', 'complaints',
    'fee_collections', 'staff_permissions', 'staff_links', 'parent_links',
    'storage_files', 'module_keys', 'idb_keys', 'total_records'];
  var diffs = [];
  keys.forEach(function (k) {
    var e = expected[k] || 0;
    var a = actual[k] || 0;
    if (e !== a) diffs.push({ field: k, expected: e, actual: a });
  });
  return {
    ok: diffs.length === 0,
    diffs: diffs,
    expected: expected,
    actual: actual
  };
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32);
}

/**
 * Encrypt JSON-serializable payload → { format, version, salt, iv, tag, ciphertext, checksum }
 */
function encryptPayload(payload, passphrase) {
  if (!passphrase || String(passphrase).length < 8) {
    throw new Error('Passphrase must be at least 8 characters (set EMS_BACKUP_PASSPHRASE)');
  }
  var plain = Buffer.from(JSON.stringify(payload), 'utf8');
  var salt = crypto.randomBytes(16);
  var iv = crypto.randomBytes(12);
  var key = deriveKey(passphrase, salt);
  var cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  var encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  var tag = cipher.getAuthTag();
  var bundle = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    encrypted: true,
    algo: ENCRYPTION_ALGO,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    plaintextChecksum: sha256Hex(plain),
    createdAt: new Date().toISOString()
  };
  return bundle;
}

function decryptPayload(bundle, passphrase) {
  if (!bundle || bundle.format !== BACKUP_FORMAT) {
    throw new Error('Invalid backup bundle format');
  }
  if (!bundle.encrypted) {
    return typeof bundle.payload === 'string' ? JSON.parse(bundle.payload) : bundle.payload;
  }
  var salt = Buffer.from(bundle.salt, 'base64');
  var iv = Buffer.from(bundle.iv, 'base64');
  var tag = Buffer.from(bundle.tag, 'base64');
  var ciphertext = Buffer.from(bundle.ciphertext, 'base64');
  var key = deriveKey(passphrase, salt);
  var decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(tag);
  var plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (bundle.plaintextChecksum && sha256Hex(plain) !== bundle.plaintextChecksum) {
    throw new Error('Decrypted checksum mismatch — wrong passphrase or corrupted file');
  }
  return JSON.parse(plain.toString('utf8'));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Simulate complete machine failure: backup tenant dir → wipe → restore → verify counts.
 */
function simulateMachineFailureRecovery(tenantDir, passphrase, opts) {
  opts = opts || {};
  var source = readJson(path.join(tenantDir, 'tenant-export.json'));
  var inventory = inventoryTenantPayload(source);
  var bundle = encryptPayload({
    tenantId: source.tenantId || opts.tenantId || 'sim-tenant',
    export: source,
    inventory: inventory
  }, passphrase);
  var bundlePath = path.join(tenantDir, 'encrypted.emsbak');
  writeJson(bundlePath, bundle);

  // Wipe simulated machine state
  var wipedPath = path.join(tenantDir, 'tenant-export.json');
  fs.unlinkSync(wipedPath);
  if (fs.existsSync(path.join(tenantDir, 'idb-mirror.json'))) {
    fs.unlinkSync(path.join(tenantDir, 'idb-mirror.json'));
  }

  // Restore
  var restoredBundle = readJson(bundlePath);
  var decrypted = decryptPayload(restoredBundle, passphrase);
  var restoredExport = decrypted.export;
  writeJson(path.join(tenantDir, 'tenant-export.json'), restoredExport);

  var restoredInventory = inventoryTenantPayload(restoredExport);
  var verification = compareInventories(inventory, restoredInventory);
  return {
    bundlePath: bundlePath,
    wiped: true,
    verification: verification,
    inventory: inventory
  };
}

module.exports = {
  BACKUP_FORMAT: BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION: BACKUP_FORMAT_VERSION,
  sha256Hex: sha256Hex,
  inventoryTenantPayload: inventoryTenantPayload,
  compareInventories: compareInventories,
  encryptPayload: encryptPayload,
  decryptPayload: decryptPayload,
  writeJson: writeJson,
  readJson: readJson,
  simulateMachineFailureRecovery: simulateMachineFailureRecovery,
  countRecordsInKey: countRecordsInKey
};
