import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const promptParityDir = path.resolve(process.cwd(), 'tests', 'prompt-parity');
const schema = JSON.parse(fs.readFileSync(path.join(promptParityDir, 'cases.schema.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(promptParityDir, 'cases.json'), 'utf8'));

function expectStringArray(value) {
    expect(Array.isArray(value)).toBe(true);
    value.forEach(item => expect(typeof item).toBe('string'));
}

describe('prompt parity corpus', () => {
    it('matches the declared schema shape', () => {
        expect(Number.isInteger(corpus.version)).toBe(true);
        expect(Array.isArray(corpus.cases)).toBe(true);
        expect(corpus.cases.length).toBeGreaterThanOrEqual(schema.properties.cases.minItems);

        const seenIds = new Set();
        const typeEnum = new Set(schema.$defs.case.properties.type.enum);
        const availabilityEnum = new Set(schema.$defs.case.properties.availability.enum);
        const roleEnum = new Set(schema.$defs.chatSeedEntry.properties.role.enum);

        for (const testCase of corpus.cases) {
            for (const requiredKey of schema.$defs.case.required) {
                expect(Object.hasOwn(testCase, requiredKey)).toBe(true);
            }

            expect(typeof testCase.id).toBe('string');
            expect(testCase.id).toMatch(/^[a-z0-9-]+$/);
            expect(seenIds.has(testCase.id)).toBe(false);
            seenIds.add(testCase.id);

            expect(typeof testCase.title).toBe('string');
            expect(testCase.title.length).toBeGreaterThan(0);
            expect(typeof testCase.category).toBe('string');
            expect(testCase.category.length).toBeGreaterThan(0);
            expect(typeEnum.has(testCase.type)).toBe(true);
            expect(typeof testCase.input).toBe('string');
            expectStringArray(testCase.setup);
            expectStringArray(testCase.mutations);
            expectStringArray(testCase.toggles);
            expectStringArray(testCase.expectedSignals);
            expectStringArray(testCase.tags);
            expect(typeof testCase.notes).toBe('string');
            expect(availabilityEnum.has(testCase.availability)).toBe(true);
            expect(Array.isArray(testCase.chatSeed)).toBe(true);

            for (const seedEntry of testCase.chatSeed) {
                expect(typeof seedEntry).toBe('object');
                expect(seedEntry).not.toBeNull();
                expect(roleEnum.has(seedEntry.role)).toBe(true);
                expect(typeof seedEntry.content).toBe('string');
                if (seedEntry.name !== undefined) {
                    expect(typeof seedEntry.name).toBe('string');
                }
                if (seedEntry.hidden !== undefined) {
                    expect(typeof seedEntry.hidden).toBe('boolean');
                }
                if (seedEntry.swipeIndex !== undefined) {
                    expect(Number.isInteger(seedEntry.swipeIndex)).toBe(true);
                    expect(seedEntry.swipeIndex).toBeGreaterThanOrEqual(0);
                }
                if (seedEntry.swipes !== undefined) {
                    expect(Array.isArray(seedEntry.swipes)).toBe(true);
                    seedEntry.swipes.forEach(swipe => expect(typeof swipe).toBe('string'));
                }
            }
        }
    });

    it('covers required mutation, swipe, and world-info compare cases', () => {
        const ids = new Set(corpus.cases.map(testCase => testCase.id));

        [
            'wi-basic-before',
            'wi-budget-overflow-global',
            'wi-budget-overflow-per-book',
            'hide-middle-message',
            'hide-edit-unhide',
            'edit-user-message',
            'delete-middle-message',
            'swipe-switch-nonzero',
            'swipe-edit-selected',
            'swipe-delete-selected',
            'swipe-delete-nonselected',
            'swipe-switch-hide-unhide',
        ].forEach(id => expect(ids.has(id)).toBe(true));
    });

    it('includes all generation types in runnable cases', () => {
        const types = new Set(corpus.cases.map(testCase => testCase.type));
        ['normal', 'continue', 'impersonate', 'quiet'].forEach(type => expect(types.has(type)).toBe(true));
    });
});
