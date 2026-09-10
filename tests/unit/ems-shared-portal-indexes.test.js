import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Shared portal Gmail save indexes', function () {
    it('declares every collection-group authUid index used by the identity safety check', function () {
        const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8'));

        ['Staff_Links', 'Parent_Links', 'Student_Links'].forEach(function (collectionGroup) {
            const override = (config.fieldOverrides || []).find(function (item) {
                return item.collectionGroup === collectionGroup && item.fieldPath === 'authUid';
            });
            expect(override, collectionGroup + ' authUid collection-group index is required').toBeTruthy();
            expect(override.indexes).toContainEqual({
                order: 'ASCENDING',
                queryScope: 'COLLECTION_GROUP'
            });
        });
    });
});
