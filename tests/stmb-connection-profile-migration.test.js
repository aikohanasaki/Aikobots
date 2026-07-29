import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDefaultStmbProfile,
    normalizeStmbSettings,
} from '../public/scripts/stmb-core.js';

function normalizeProfile(profile) {
    return normalizeStmbSettings({
        moduleSettings: {},
        profiles: [createDefaultStmbProfile(), profile],
        defaultProfile: 1,
    }).profiles[1];
}

test('legacy direct profiles remain usable and migrate model and temperature to overrides', () => {
    const profile = normalizeProfile({
        name: 'Legacy',
        connection: {
            api: 'openai',
            model: 'legacy-model',
            temperature: 0.7,
            endpoint: 'https://example.invalid',
            apiKey: 'stored legacy key',
        },
    });

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
