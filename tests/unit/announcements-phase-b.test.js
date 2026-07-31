import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadParentAnnouncementHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
    function extractFn(name) {
        var re = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
        var m = src.match(re);
        if (!m) throw new Error('Could not extract ' + name);
        return m[0];
    }
    var body = [
        extractFn('normalizeAnnouncementAudience'),
        extractFn('announcementVisibleToParent'),
        'global.normalizeAnnouncementAudience = normalizeAnnouncementAudience;',
        'global.announcementVisibleToParent = announcementVisibleToParent;'
    ].join('\n');
    var ctx = { global: {} };
    vm.runInNewContext(body, ctx, { filename: 'parent-data-helpers.js' });
    return ctx.global.announcementVisibleToParent;
}

describe('Announcements Phase B — maker-checker & interactive proposals', function () {
    it('annSaveAnnouncement routes staff decisions to pending status', function () {
        var src = fs.readFileSync(path.join(ROOT, 'announcements.js'), 'utf8');
        expect(src).toContain('annCanPublishDecisionDirectly');
        expect(src).toContain('annResolvePublishStatus');
        expect(src).toMatch(/annSaveAnnouncement[\s\S]*?status:\s*window\.annResolvePublishStatus\(kind/);
        expect(src).toMatch(/kind === 'decision'[\s\S]*?pending/);
        expect(src).toContain('فیصلہ زیرِ منظوری بھیج دیا گیا');
    });

    it('annApproveDecision allows owner/super-admin to publish pending decisions', function () {
        var src = fs.readFileSync(path.join(ROOT, 'announcements.js'), 'utf8');
        expect(src).toContain('annApproveDecision');
        expect(src).toMatch(/annApproveDecision[\s\S]*?annCanPublishDecisionDirectly/);
        expect(src).toMatch(/ann\.status = 'published'/);
        expect(src).toMatch(/ann-pending-queue|annApproveDecision/);
    });

    it('announcementVisibleToParent hides pending decisions from parents', function () {
        var visible = loadParentAnnouncementHelpers();
        var profile = { className: 'A', department: 'X' };
        expect(visible({ audience: 'all', status: 'pending', kind: 'decision' }, 'STD001', profile)).toBe(false);
        expect(visible({ audience: 'all', status: 'published', kind: 'decision' }, 'STD001', profile)).toBe(true);
    });

    it('submitParentVote cloud function is wired with secure vote storage', function () {
        var parentData = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        var index = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(parentData).toContain('submitParentVote');
        expect(parentData).toContain('AnnouncementVotes');
        expect(parentData).toMatch(/if \(voteType === 'agree'\) agree/);
        expect(parentData).toContain('else disagree += 1');
        expect(parentData).toMatch(/kind !== 'proposal' && kind !== 'advice'/);
        expect(index).toContain('exports.submitParentVote = parentData.submitParentVote');
    });

    it('firestore rules lock AnnouncementVotes to server-only writes', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('match /AnnouncementVotes/{voteId}');
        expect(rules).toMatch(/AnnouncementVotes[\s\S]*?allow write: if false/);
    });

    it('parent-portal renders vote buttons for proposal and advice', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(src).toContain('ppSubmitAnnouncementVote');
        expect(src).toMatch(/renderAnnouncementsHtml[\s\S]*?kind === 'proposal' \|\| a\.kind === 'advice'/);
        expect(src).toContain('متفق');
        expect(src).toContain('غیر متفق');
        expect(src).toContain("emsCallFunction('submitParentVote'");
    });

    it('staff archive and preview show vote tallies for proposals', function () {
        var src = fs.readFileSync(path.join(ROOT, 'announcements.js'), 'utf8');
        expect(src).toContain('annVoteTallyHtml');
        expect(src).toMatch(/annRenderArchive[\s\S]*?annVoteTallyHtml/);
        expect(src).toMatch(/annPreview[\s\S]*?annVoteTallyHtml/);
    });
});
