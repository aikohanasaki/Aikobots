import { describe, expect, it } from '@jest/globals';

import { TavernCardValidator } from '../validator/TavernCardValidator.js';

function makeV2Card(dataOverrides = {}) {
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: 'Test Character',
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            creator: '',
            character_version: '',
            extensions: {},
            ...dataOverrides,
        },
    };
}

describe('TavernCardValidator', () => {
    it('accepts v2 cards without tags', () => {
        const validator = new TavernCardValidator(makeV2Card());

        expect(validator.validate()).toBe(2);
    });

    it('rejects v2 cards with non-array tags', () => {
        const validator = new TavernCardValidator(makeV2Card({ tags: 'tag-one' }));

        expect(validator.validate()).toBe(false);
    });
});
