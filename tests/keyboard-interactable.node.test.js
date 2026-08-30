import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const keyboardSource = fs.readFileSync(new URL('../public/scripts/keyboard.js', import.meta.url), 'utf8');

test('keyboard activation cancels Enter before clicking custom interactables', () => {
    assert.match(
        keyboardSource,
        /if \(target\.matches\(nativeInteractableSelector\)\) \{\s*return;\s*\}\s*event\.preventDefault\(\);\s*console\.debug\([\s\S]*?target\.click\(\);/u,
    );
});
