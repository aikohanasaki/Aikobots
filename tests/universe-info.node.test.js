import assert from 'node:assert/strict';
import test from 'node:test';
import { getUniverseDefaults, getUniverseListing, validateUniverseInfo } from '../public/scripts/universe-info.js';

test('universe names strip complete prefixes while preserving ambiguous and empty names', () => {
    for (const [name, owners, expected] of [
        ['9Z Wonderland', [], 'Wonderland'], ['9Z', [], '9Z'],
        ['Y-Shared-World', ['alice', 'bob'], 'Shared-World'], ['Y-', [], 'Y-'],
        ['Z-alice-smith-World-Name', ['alice-smith'], 'World-Name'],
        ['Z-alice-smith-World', ['alice', 'alice-smith'], 'Z-alice-smith-World'],
        ['Z-former-owner-World', ['new-owner'], 'Z-former-owner-World'],
        ['Unprefixed', [], 'Unprefixed'],
    ]) assert.equal(getUniverseDefaults(name, owners).name, expected);
    assert.equal(getUniverseDefaults('Y-World', ['alice', 'bob']).creator, 'alice, bob');
});

test('directory overrides are optional, clearable, and explicitly allowlisted', () => {
    const base = getUniverseListing('9Z World', ['alice']);
    assert.equal(base.name, 'World');
    assert.equal(base.creator, 'alice');
    const override = getUniverseListing('9Z World', ['alice'], { nameOverride: ' New ', creatorOverride: ' Team ', entries: 'SYNTHETIC_PRIVATE', tags: [' fantasy ', 'fantasy', ''] });
    assert.equal(override.name, 'New');
    assert.equal(override.creator, 'Team');
    assert.deepEqual(override.tags, ['fantasy']);
    assert.equal(JSON.stringify(override).includes('SYNTHETIC_PRIVATE'), false);
    assert.deepEqual(getUniverseListing('9Z World', ['alice'], { nameOverride: ' ', creatorOverride: '' }), base);
});

test('metadata validates bounded text, tags, and credential-free HTTPS URLs without echoing input', () => {
    for (const value of [null, [], { tags: 'bad' }, { tags: Array(31).fill('x') }, { tags: ['x'.repeat(81)] }, { tags: [], description: 42 }, { tags: [], nameOverride: 'x'.repeat(201) },
        ...['javascript:alert(1)', 'http://example.test', 'https://user:password@example.test', '//example.test'].map(imageUrl => ({ tags: [], imageUrl }))]) {
        assert.throws(() => validateUniverseInfo(value), { message: 'Invalid universe information.' });
    }
    assert.equal(validateUniverseInfo({ tags: [], imageUrl: 'https://example.test/image.png', description: '<script>synthetic</script>' }).description, '<script>synthetic</script>');
});
