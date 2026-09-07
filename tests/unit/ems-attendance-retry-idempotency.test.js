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

    it('retries full writes on the same document and applies patches transactionally', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var start = src.indexOf('function flushAttendanceRow');
        var end = src.indexOf('\n    function flushModuleItemRow', start);
        var block = src.slice(start, end);
        expect(block).toContain("collection('Attendance').doc(row.docId)");
        expect(block).toContain('runAttendanceFullTransaction(db, ref, payload');
        expect(block).toContain('applyAttendancePatchToDocument({}, patch)');
        expect(block).toContain('runAttendancePatchTransaction(db, ref, patch, createDocument, {');
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

    it('creates or updates a sheet inside one Firestore transaction', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var start = src.indexOf('function runAttendancePatchTransaction');
        var end = src.indexOf('\n    /** One tenant/document', start);
        var block = src.slice(start, end);
        expect(block).toContain('db.runTransaction');
        expect(block).toContain('tx.get(ref)');
        expect(block).toContain('tx.set(ref, createPayload, { merge: false })');
        expect(block).toContain('tx.update(ref, updatePayload)');
        expect(block).not.toContain('ref.get(');
    });
});
