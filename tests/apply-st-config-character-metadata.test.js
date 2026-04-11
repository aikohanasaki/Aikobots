import { describe, expect, it } from '@jest/globals';

import {
    applySingleOwnerPushedMetadata,
    buildCharacterMetadataMigrationPlan,
} from '../scripts/apply-st-config-character-metadata.mjs';

describe('apply st_config character metadata migration helpers', () => {
    it('builds a migration plan with inferred owners', () => {
        const templateSource = {
            templates: {},
            characters: {
                Zee: {
                    templates: ['AIKOBOTS'],
                    add: ['9ZZ Zee'],
                    remove: [],
                },
                Kael: {
                    templates: ['UNIVERSAL', 'VANTERRA'],
                    add: ['Z-echomeria-Kael'],
                    remove: [],
                },
            },
        };

        const plan = buildCharacterMetadataMigrationPlan(templateSource, [
            'C:\\cards\\Zee.png',
            'C:\\cards\\Kael.png',
        ]);

        expect(plan.missing).toEqual([]);
        expect(plan.duplicateMatches).toEqual([]);
        expect(plan.matched).toEqual([
            expect.objectContaining({
                characterName: 'Kael',
                ownerHandle: 'echomeria',
                secureLorebooks: ['Z-echomeria-Kael'],
                hiddenTemplates: ['UNIVERSAL', 'VANTERRA'],
            }),
            expect.objectContaining({
                characterName: 'Zee',
                ownerHandle: 'default-user',
                secureLorebooks: ['9ZZ Zee'],
                hiddenTemplates: ['AIKOBOTS'],
            }),
        ]);
    });

    it('applies single-owner pushed metadata to a card object', () => {
        const card = {
            data: {
                extensions: {},
            },
        };

        applySingleOwnerPushedMetadata(card, {
            characterName: 'Zee',
            ownerHandle: 'default-user',
            ownerHandles: ['default-user'],
            sharedCharacterKey: 'Zee',
            secureLorebooks: ['9ZZ Zee', '9Z Universal Commands'],
        });

        expect(card.data.extensions.aikobots).toEqual({
            owner_handle: 'default-user',
            owner_handles: ['default-user'],
            sharing_mode: 'single',
            shared_character_key: 'Zee',
            secure_lorebooks: ['9ZZ Zee', '9Z Universal Commands'],
        });
    });
});
