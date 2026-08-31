import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance retry idempotency', function () {
    it('coalesces full and patch retries by tenant + canonical document id', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toMatch(/identityType = isAttendanceQueueType\(type\) \? 'attendance_doc'/);
        expect(src).toMatch(/queueRowsSameIdentity[\s\S]*?String\(a\.docId\) === String\(b\.docId\)/);
        expect(src).toMatch(/upsertQueueByDocId[\s\S]*?coalesceAttendanceRows/);
    });

    it('retries update/set the same Attendance document and never add a second document', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var start = src.indexOf('function flushAttendanceRow');
        var end = src.indexOf('\n    function flushModuleItemRow', start);
        var block = src.slice(start, end);
        expect(block).toContain("collection('Attendance').doc(row.docId)");
        expect(block).toContain('ref.set(payload, { merge: false })');
        expect(block).toContain('ref.update(patch)');
        expect(block).toContain('applyAttendancePatchToDocument({}, patch)');
        expect(block).toContain('ref.set(createDocument, { merge: false })');
        expect(block).not.toContain('ref.set(patch, { merge: true })');
        expect(block).not.toMatch(/\.add\s*\(/);
    });

    it('normal retry sends only failed queued rows without creating new marks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var start = src.indexOf('global.emsOfflineRetryFailedSync');
        var block = src.slice(start, start + 2200);
        expect(block).toMatch(/filter[\s\S]*?r\.failed[\s\S]*?rowBelongsToActiveTenant/);
        expect(block).toContain('upsertQueueByDocId(row.type, row.docId, row)');
        expect(block).toContain('flushMutationRowAndDequeue(storedRow || row)');
    });

    it('never dequeues a newer attendance edit after an older request finishes', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('function queueRowsSameStoredVersion');
        expect(src).toContain('row.queueToken = nextQueueToken()');
        expect(src).toContain('function deleteQueueRowIfFlushedVersion');
        expect(src).toContain('if (!queueRowsSameStoredVersion(current, row))');
        expect(src).toContain('pendingNewer: true');
        expect(src).not.toMatch(/listQueue\(\)[\s\S]{0,250}deleteQueueRow\(hit\.id\)/);
    });

    it('flushes the coalesced stored patch, not the unmerged incoming object', function () {
        var cloud = fs.readFileSync(path.join(ROOT, 'ems-cloud-mutation.js'), 'utf8');
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(cloud).toContain('emsOfflineFlushMutationRow(storedRow)');
        expect(offline).toContain('flushMutationRowAndDequeue(storedRow)');
    });

    it('creates a missing sheet only for Firestore not-found, never for network/permission failure', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var start = src.indexOf('function flushAttendancePatchRow');
        var end = src.indexOf('\n    function flushModuleItemRow', start);
        var block = src.slice(start, end);
        expect(block).toContain('isFirestoreNotFoundCode(res && res.code)');
        expect(block).toMatch(/if\s*\(!isFirestoreNotFoundCode\(res && res\.code\)\)\s*return res/);
    });
});
