import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyStmbConnectionProfileSelection,
    applyStmbProfileConnection,
    createDefaultStmbProfile,
    normalizeStmbSettings,
    resolveStmbProfileConnectionSummary,
} from '../public/scripts/stmb-core.js';

test('legacy direct profiles remain usable and migrate model and temperature to overrides', () => {
    const settings = normalizeStmbSettings({
        moduleSettings: {},
        migrationVersion: 4,
        profiles: [createDefaultStmbProfile(), {
            name: 'Legacy',
            connection: {
                api: 'openai',
                model: 'legacy-model',
                temperature: 0.7,
                endpoint: 'https://example.invalid',
                apiKey: 'stored legacy key',
            },
        }],
        defaultProfile: 1,
    });
    const profile = settings.profiles[1];

    assert.equal(settings.migrationVersion, 5);
    assert.equal(profile.modelOverride, 'legacy-model');
    assert.equal(profile.temperatureOverride, 0.7);
    assert.equal(profile.connection.api, 'openai');
    assert.equal(profile.connection.endpoint, 'https://example.invalid');
    assert.equal(profile.connection.apiKey, 'stored legacy key');
});

test('a central profile binding keeps overrides and drops duplicated direct connection data', () => {
    const settings = normalizeStmbSettings({
        moduleSettings: {},
        migrationVersion: 4,
        profiles: [createDefaultStmbProfile(), {
            name: 'Central',
            connectionProfileId: 'connection-1',
            modelOverride: 'override-model',
            temperatureOverride: 0,
            connection: {
                api: 'openai',
                model: 'old-model',
                endpoint: 'https://old.invalid',
                apiKey: 'old key',
            },
        }],
        defaultProfile: 1,
    });
    const profile = settings.profiles[1];

    assert.equal(settings.migrationVersion, 5);
    assert.equal(profile.connectionProfileId, 'connection-1');
    assert.equal(profile.modelOverride, 'override-model');
    assert.equal(profile.temperatureOverride, 0);
    assert.deepEqual(profile.connection, { api: 'connection_profile' });
});

test('connection profile summaries show effective details and identify overrides', () => {
    const summary = resolveStmbProfileConnectionSummary({
        connectionProfileId: 'connection-1',
        connectionProfileName: 'Saved Connection',
        connection: { api: 'connection_profile' },
        modelOverride: 'override-model',
        temperatureOverride: 0,
    }, {
        connectionProfile: {
            id: 'connection-1',
            name: 'Saved Connection',
            api: 'openai',
            model: 'profile-model',
        },
        connectionSnapshot: {
            profileId: 'connection-1',
            profileName: 'Saved Connection',
            source: 'openai',
            model: 'override-model',
            temperature: 0,
        },
    });

    assert.deepEqual(summary, {
        usesConnectionProfile: true,
        connectionProfileName: 'Saved Connection',
        provider: 'openai',
        model: 'override-model',
        temperature: 0,
        modelIsOverride: true,
        temperatureIsOverride: true,
    });
});

test('connection profile summaries distinguish inherited model and temperature', () => {
    const summary = resolveStmbProfileConnectionSummary({
        connectionProfileId: 'connection-1',
        connection: { api: 'connection_profile' },
        modelOverride: '',
        temperatureOverride: null,
    }, {
        connectionProfile: {
            name: 'Saved Connection',
            api: 'openai',
        },
        connectionSnapshot: {
            source: 'openai',
            model: 'profile-model',
            temperature: 0.7,
        },
    });

    assert.equal(summary.connectionProfileName, 'Saved Connection');
    assert.equal(summary.model, 'profile-model');
    assert.equal(summary.temperature, 0.7);
    assert.equal(summary.modelIsOverride, false);
    assert.equal(summary.temperatureIsOverride, false);
});

test('normalization preserves a settings version newer than this build', () => {
    const settings = normalizeStmbSettings({
        moduleSettings: {},
        migrationVersion: 6,
    });

    assert.equal(settings.migrationVersion, 6);
});

test('clearing a central connection profile selection removes the cloned binding', () => {
    const profile = {
        connectionProfileId: 'connection-1',
        connectionProfileName: 'Profile One',
        connection: { api: 'connection_profile' },
    };

    applyStmbConnectionProfileSelection(profile, '');

    assert.equal(profile.connectionProfileId, '');
    assert.equal(profile.connectionProfileName, '');
    assert.deepEqual(profile.connection, { api: 'current_st' });
});

test('clearing the selection preserves a legacy direct connection', () => {
    const connection = {
        api: 'openai',
        endpoint: 'https://example.invalid',
        apiKey: 'stored legacy key',
    };
    const profile = {
        connectionProfileId: '',
        connectionProfileName: '',
        connection,
    };

    applyStmbConnectionProfileSelection(profile, '');

    assert.equal(profile.connection, connection);
});

test('STMB connection profiles materialize and apply one request snapshot', () => {
    const generateData = { messages: [{ role: 'user', content: 'test' }] };
    const expectedSnapshot = { profileId: 'connection-1' };
    let materialized;
    const result = applyStmbProfileConnection(generateData, {
        connectionProfileId: 'connection-1',
        modelOverride: 'override-model',
        temperatureOverride: 0,
    }, {
        createConnectionProfileRequestSnapshot(profileId, overrides) {
            materialized = { profileId, overrides };
            return expectedSnapshot;
        },
        applyConnectionProfileSnapshot(data, snapshot, overrides) {
            assert.equal(data, generateData);
            assert.equal(snapshot, expectedSnapshot);
            return { ...data, ...overrides };
        },
    });

    assert.deepEqual(materialized, {
        profileId: 'connection-1',
        overrides: { model: 'override-model', temperature: 0 },
    });
    assert.equal(result.model, 'override-model');
    assert.equal(result.temperature, 0);
});

test('the current-ST connection applies overrides and requires a model', () => {
    const result = applyStmbProfileConnection({
        model: 'current-model',
        temperature: 0.7,
    }, {
        connection: { api: 'current_st' },
        modelOverride: 'override-model',
        temperatureOverride: 0,
    });

    assert.equal(result.model, 'override-model');
    assert.equal(result.temperature, 0);
    assert.throws(
        () => applyStmbProfileConnection({}, { connection: { api: 'current_st' } }),
        /Enter a model ID/,
    );
});

test('legacy STMB connections map model and temperature overrides once', () => {
    const result = applyStmbProfileConnection({}, {
        modelOverride: 'override-model',
        temperatureOverride: 0,
        connection: {
            api: 'openai',
            model: 'legacy-model',
            temperature: 0.7,
        },
    });

    assert.equal(result.chat_completion_source, 'openai');
    assert.equal(result.model, 'override-model');
    assert.equal(result.temperature, 0);
});
