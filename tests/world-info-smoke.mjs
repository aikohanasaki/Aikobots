import path from 'node:path';
import process from 'node:process';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');
setConfigFilePath(CONFIG_PATH);

const { resolveSortedEntriesPayload } = await import('../src/endpoints/worldinfo.js');
const { scanWorldInfo } = await import('../src/prompting/world-info-scan.js');

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function runScenario(name, fn) {
    await fn();
    console.log(`PASS ${name}`);
}

/**
 * @param {Record<string, any[]>} worldEntries
 */
function createWorldInfoOptions(worldEntries) {
    return {
        readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []).map(entry => ({
            world: name,
            ...entry,
        })),
        getHiddenBooks: () => [],
        hasLorebook: (_user, name) => Boolean(worldEntries[name]),
    };
}

async function resolveWorldOrder(worldEntries, body) {
    const result = await resolveSortedEntriesPayload(
        { profile: { handle: 'tester' } },
        body,
        createWorldInfoOptions(worldEntries),
    );

    return result.entries.map(entry => entry.world);
}

await runScenario('single-character unified pool ordering', async () => {
    const worldEntries = {
        Global: [{ uid: 1, order: 900, content: 'global' }],
        Character: [{ uid: 2, order: 100, content: 'character' }],
        Persona: [{ uid: 3, order: 20, content: 'persona' }],
        Chat: [{ uid: 4, order: 10, content: 'chat' }],
    };

    const worlds = await resolveWorldOrder(worldEntries, {
        selectedWorldInfo: ['Global'],
        chatWorld: 'Chat',
        personaWorld: 'Persona',
        characterWorld: 'Character',
        selectedGroup: false,
        activeSpeaker: { filename: 'hero', name: 'Hero' },
    });
    assert(
        JSON.stringify(worlds) === JSON.stringify(['Global', 'Character', 'Persona', 'Chat']),
        `unexpected ordering: ${JSON.stringify(worlds)}`,
    );
});

await runScenario('source bucket assignment does not change final ordering', async () => {
    const worldEntries = {
        Atlas: [{ uid: 1, order: 900, content: 'atlas' }],
        Beacon: [{ uid: 2, order: 400, content: 'beacon' }],
        Cipher: [{ uid: 3, order: 200, content: 'cipher' }],
        Delta: [{ uid: 4, order: 50, content: 'delta' }],
    };

    const orderingA = await resolveWorldOrder(worldEntries, {
        selectedWorldInfo: ['Atlas'],
        chatWorld: 'Beacon',
        personaWorld: 'Cipher',
        characterWorld: 'Delta',
        selectedGroup: false,
        activeSpeaker: { filename: 'hero' },
    });

    const orderingB = await resolveWorldOrder(worldEntries, {
        selectedWorldInfo: ['Delta'],
        chatWorld: 'Atlas',
        personaWorld: 'Beacon',
        characterWorld: 'Cipher',
        selectedGroup: false,
        activeSpeaker: { filename: 'hero' },
    });

    assert(
        JSON.stringify(orderingA) === JSON.stringify(['Atlas', 'Beacon', 'Cipher', 'Delta']),
        `unexpected ordering A: ${JSON.stringify(orderingA)}`,
    );
    assert(
        JSON.stringify(orderingB) === JSON.stringify(orderingA),
        `source bucket affected ordering: ${JSON.stringify(orderingB)} vs ${JSON.stringify(orderingA)}`,
    );
});

await runScenario('single-character chats ignore speaker-only filtering and overrides', async () => {
    const worldEntries = {
        SpeakerOnly: [{
            uid: 1,
            order: 10,
            content: 'speaker-only',
            lorebookSettings: {
                onlyWhenSpeaking: true,
                characterOverrides: {
                    hero: { priority: 5, orderAdjustment: 100 },
                },
            },
        }],
        Baseline: [{ uid: 2, order: 50, content: 'baseline' }],
    };

    const matched = await resolveSortedEntriesPayload(
        { profile: { handle: 'tester' } },
        {
            selectedWorldInfo: ['SpeakerOnly', 'Baseline'],
            selectedGroup: false,
            activeSpeaker: { filename: 'hero' },
        },
        createWorldInfoOptions(worldEntries),
    );

    const unmatched = await resolveSortedEntriesPayload(
        { profile: { handle: 'tester' } },
        {
            selectedWorldInfo: ['SpeakerOnly', 'Baseline'],
            selectedGroup: false,
            activeSpeaker: { filename: 'villain' },
        },
        createWorldInfoOptions(worldEntries),
    );

    assert(
        JSON.stringify(matched.entries.map(entry => entry.world)) === JSON.stringify(['Baseline', 'SpeakerOnly']),
        `single-chat override application failed: ${JSON.stringify(matched.entries.map(entry => entry.world))}`,
    );
    assert(
        JSON.stringify(unmatched.entries.map(entry => entry.world)) === JSON.stringify(['Baseline', 'SpeakerOnly']),
        `single-chat speaker filtering failed: ${JSON.stringify(unmatched.entries.map(entry => entry.world))}`,
    );
});

await runScenario('group-only adjustment applies only in group generation', async () => {
    const worldEntries = {
        GroupOnly: [{
            uid: 1,
            order: 10,
            content: 'group-only',
            lorebookSettings: {
                orderAdjustment: 500,
                orderAdjustmentGroupOnly: true,
            },
        }],
        Baseline: [{ uid: 2, order: 100, content: 'baseline' }],
    };

    const nonGroup = await resolveSortedEntriesPayload(
        { profile: { handle: 'tester' } },
        {
            selectedWorldInfo: ['GroupOnly', 'Baseline'],
            selectedGroup: false,
            activeSpeaker: { filename: 'hero' },
        },
        createWorldInfoOptions(worldEntries),
    );

    const group = await resolveSortedEntriesPayload(
        { profile: { handle: 'tester' } },
        {
            selectedWorldInfo: ['GroupOnly', 'Baseline'],
            selectedGroup: true,
            activeSpeaker: { filename: 'hero' },
        },
        createWorldInfoOptions(worldEntries),
    );

    assert(
        JSON.stringify(nonGroup.entries.map(entry => entry.world)) === JSON.stringify(['Baseline', 'GroupOnly']),
        `non-group ordering failed: ${JSON.stringify(nonGroup.entries.map(entry => entry.world))}`,
    );
    assert(
        JSON.stringify(group.entries.map(entry => entry.world)) === JSON.stringify(['GroupOnly', 'Baseline']),
        `group ordering failed: ${JSON.stringify(group.entries.map(entry => entry.world))}`,
    );
});

await runScenario('group drafted responder overrides are used', async () => {
    const worldEntries = {
        VillainBook: [{
            uid: 1,
            order: 10,
            content: 'villain-book',
            lorebookSettings: {
                onlyWhenSpeaking: true,
                characterOverrides: {
                    villain: { priority: 5, orderAdjustment: 200 },
                },
            },
        }],
        HeroBook: [{
            uid: 2,
            order: 20,
            content: 'hero-book',
            lorebookSettings: {
                onlyWhenSpeaking: true,
                characterOverrides: {
                    hero: { priority: 5, orderAdjustment: 200 },
                },
            },
        }],
        Shared: [{ uid: 3, order: 100, content: 'shared' }],
    };

    const result = await resolveSortedEntriesPayload(
        { profile: { handle: 'tester' } },
        {
            selectedWorldInfo: ['VillainBook', 'HeroBook', 'Shared'],
            selectedGroup: true,
            activeSpeaker: { filename: 'villain', avatar: 'villain.png', name: 'Villain' },
        },
        createWorldInfoOptions(worldEntries),
    );

    const worlds = result.entries.map(entry => entry.world);
    assert(
        JSON.stringify(worlds) === JSON.stringify(['VillainBook', 'Shared']),
        `group drafted speaker filtering failed: ${JSON.stringify(worlds)}`,
    );
});

await runScenario('speaker overrides match by name, avatar basename, and filename', async () => {
    const worldEntries = {
        NameBook: [{
            uid: 1,
            order: 10,
            content: 'name-book',
            lorebookSettings: {
                onlyWhenSpeaking: true,
                characterOverrides: {
                    'villain prime': { priority: 5 },
                },
            },
        }],
        AvatarBook: [{
            uid: 2,
            order: 20,
            content: 'avatar-book',
            lorebookSettings: {
                onlyWhenSpeaking: true,
                characterOverrides: {
                    'villain-avatar': { priority: 5 },
                },
            },
        }],
        FileBook: [{
            uid: 3,
            order: 30,
            content: 'file-book',
            lorebookSettings: {
                onlyWhenSpeaking: true,
                characterOverrides: {
                    'villain-file': { priority: 5 },
                },
            },
        }],
    };

    const nameMatch = await resolveWorldOrder(worldEntries, {
        selectedWorldInfo: ['NameBook'],
        selectedGroup: true,
        activeSpeaker: { name: 'Villain Prime', avatar: 'other.png', filename: 'other' },
    });
    const avatarMatch = await resolveWorldOrder(worldEntries, {
        selectedWorldInfo: ['AvatarBook'],
        selectedGroup: true,
        activeSpeaker: { name: 'Other', avatar: 'villain-avatar.png', filename: 'other' },
    });
    const fileMatch = await resolveWorldOrder(worldEntries, {
        selectedWorldInfo: ['FileBook'],
        selectedGroup: true,
        activeSpeaker: { name: 'Other', avatar: 'other.png', filename: 'villain-file' },
    });

    assert(JSON.stringify(nameMatch) === JSON.stringify(['NameBook']), `name match failed: ${JSON.stringify(nameMatch)}`);
    assert(JSON.stringify(avatarMatch) === JSON.stringify(['AvatarBook']), `avatar match failed: ${JSON.stringify(avatarMatch)}`);
    assert(JSON.stringify(fileMatch) === JSON.stringify(['FileBook']), `filename match failed: ${JSON.stringify(fileMatch)}`);
});

await runScenario('per-lorebook budgets trim within one lorebook only', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 100,
        settings: {
            world_info_budget: 100,
            world_info_budget_cap: 0,
            world_info_recursive: false,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 300,
                content: 'A'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 10 },
            },
            {
                uid: 2,
                world: 'Alpha',
                order: 200,
                content: 'B'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 10 },
            },
            {
                uid: 3,
                world: 'Beta',
                order: 100,
                content: 'C'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'default' },
            },
        ],
    });

    const activated = result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`);
    assert(
        JSON.stringify(activated) === JSON.stringify(['Alpha.1', 'Beta.3']),
        `per-lorebook budget failed: ${JSON.stringify(activated)}`,
    );
});

await runScenario('per-lorebook budgets are isolated across multiple lorebooks', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 200,
        settings: {
            world_info_budget: 100,
            world_info_budget_cap: 0,
            world_info_recursive: false,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 300,
                content: 'A'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 10 },
            },
            {
                uid: 2,
                world: 'Alpha',
                order: 290,
                content: 'B'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 10 },
            },
            {
                uid: 3,
                world: 'Beta',
                order: 280,
                content: 'C'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 10 },
            },
            {
                uid: 4,
                world: 'Beta',
                order: 270,
                content: 'D'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 10 },
            },
            {
                uid: 5,
                world: 'Gamma',
                order: 260,
                content: 'E'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'default' },
            },
        ],
    });

    const activated = result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`);
    assert(
        JSON.stringify(activated) === JSON.stringify(['Alpha.1', 'Beta.3', 'Gamma.5']),
        `lorebook budget isolation failed: ${JSON.stringify(activated)}`,
    );
});

await runScenario('randomTrim keeps a random in-budget subset without changing native ordering logic', async () => {
    const originalRandom = Math.random;
    Math.random = () => 0;

    try {
        const result = await scanWorldInfo({
            chat: [],
            maxContext: 100,
            settings: {
                world_info_budget: 100,
                world_info_budget_cap: 0,
                world_info_recursive: false,
            },
            sortedEntries: [
                {
                    uid: 1,
                    world: 'Alpha',
                    order: 300,
                    content: 'A'.repeat(20),
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'fixed', budget: 10, randomTrim: true },
                },
                {
                    uid: 2,
                    world: 'Alpha',
                    order: 200,
                    content: 'B'.repeat(20),
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'fixed', budget: 10, randomTrim: true },
                },
            ],
        });

        const activated = result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`);
        assert(
            JSON.stringify(activated) === JSON.stringify(['Alpha.2']),
            `randomTrim failed: ${JSON.stringify(activated)}`,
        );
    } finally {
        Math.random = originalRandom;
    }
});

await runScenario('ignoreBudget bypasses lorebook and global budgets', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 20,
        settings: {
            world_info_budget: 25,
            world_info_budget_cap: 0,
            world_info_recursive: false,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 200,
                content: 'A'.repeat(20),
                decorators: ['@@activate'],
                ignoreBudget: true,
                lorebookSettings: { budgetMode: 'fixed', budget: 1 },
            },
            {
                uid: 2,
                world: 'Alpha',
                order: 100,
                content: 'B'.repeat(20),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 1 },
            },
        ],
    });

    const activated = result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`);
    assert(
        JSON.stringify(activated) === JSON.stringify(['Alpha.1']),
        `ignoreBudget handling failed: ${JSON.stringify(activated)}`,
    );
});

await runScenario('fixed lorebook budget drops entries exactly on the boundary', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 100,
        settings: {
            world_info_budget: 100,
            world_info_budget_cap: 0,
            world_info_recursive: false,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 100,
                content: 'X'.repeat(9),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'fixed', budget: 3 },
            },
        ],
    });

    assert(
        JSON.stringify(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)) === JSON.stringify([]),
        `fixed boundary behavior failed: ${JSON.stringify(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`))}`,
    );
});

await runScenario('percentage-context lorebook budget drops entries exactly on the boundary', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 12,
        settings: {
            world_info_budget: 100,
            world_info_budget_cap: 0,
            world_info_recursive: false,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 100,
                content: 'X'.repeat(9),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'percentage_context', budget: 25 },
            },
        ],
    });

    assert(
        JSON.stringify(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)) === JSON.stringify([]),
        `percentage_context boundary behavior failed: ${JSON.stringify(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`))}`,
    );
});

await runScenario('percentage-budget lorebook budget drops entries exactly on the boundary', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 40,
        settings: {
            world_info_budget: 50,
            world_info_budget_cap: 0,
            world_info_recursive: false,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 100,
                content: 'X'.repeat(9),
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'percentage_budget', budget: 15 },
            },
        ],
    });

    assert(
        JSON.stringify(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)) === JSON.stringify([]),
        `percentage_budget boundary behavior failed: ${JSON.stringify(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`))}`,
    );
});

await runScenario('non-recursing admitted entries still count against later global budget checks', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 40,
        settings: {
            world_info_budget: 25,
            world_info_budget_cap: 0,
            world_info_recursive: true,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 200,
                content: 'A'.repeat(20),
                decorators: ['@@activate'],
                preventRecursion: true,
                lorebookSettings: { budgetMode: 'default' },
            },
            {
                uid: 2,
                world: 'Gamma',
                order: 150,
                content: 'G',
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'default' },
            },
            {
                uid: 3,
                world: 'Beta',
                order: 100,
                content: 'B'.repeat(12),
                decorators: ['@@activate'],
                delayUntilRecursion: true,
                lorebookSettings: { budgetMode: 'default' },
            },
        ],
    });

    const activated = result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`);
    assert(
        JSON.stringify(activated) === JSON.stringify(['Alpha.1', 'Gamma.2']),
        `later-pass global budget accounting failed: ${JSON.stringify(activated)}`,
    );
    assert(result.overflowed === true, 'expected global budget overflow to be reported');
});

await runScenario('debug summary preserves recursion round numbers for delayed entries', async () => {
    const result = await scanWorldInfo({
        chat: [],
        maxContext: 100,
        settings: {
            world_info_budget: 100,
            world_info_budget_cap: 0,
            world_info_recursive: true,
        },
        sortedEntries: [
            {
                uid: 1,
                world: 'Alpha',
                order: 200,
                content: 'starter',
                decorators: ['@@activate'],
                lorebookSettings: { budgetMode: 'default' },
            },
            {
                uid: 2,
                world: 'Beta',
                order: 100,
                content: 'delayed entry',
                decorators: ['@@activate'],
                delayUntilRecursion: true,
                lorebookSettings: { budgetMode: 'default' },
            },
        ],
    });

    const debugEntries = Object.fromEntries(result.worldInfo.activatedEntries.map(entry => [entry.uid, entry]));
    assert(debugEntries[1]?.scanState === 'initial', `expected Alpha.1 to activate in initial scan, got ${debugEntries[1]?.scanState}`);
    assert(debugEntries[1]?.roundIndex === 1, `expected Alpha.1 roundIndex 1, got ${debugEntries[1]?.roundIndex}`);
    assert(debugEntries[2]?.scanState === 'recursion', `expected Beta.2 to activate in recursion, got ${debugEntries[2]?.scanState}`);
    assert(debugEntries[2]?.roundIndex === 2, `expected Beta.2 roundIndex 2, got ${debugEntries[2]?.roundIndex}`);

    const rounds = result.worldInfo.rounds.map(round => ({
        roundIndex: round.roundIndex,
        admitted: round.entries.filter(entry => entry.status === 'admitted').map(entry => entry.uid),
    }));
    assert(
        JSON.stringify(rounds) === JSON.stringify([
            { roundIndex: 1, admitted: [1] },
            { roundIndex: 2, admitted: [2] },
        ]),
        `unexpected debug rounds: ${JSON.stringify(rounds)}`,
    );
});

console.log('World Info smoke test complete.');
