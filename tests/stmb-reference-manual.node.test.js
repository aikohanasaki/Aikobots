import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStmbAIReferenceManualLocale } from '../public/scripts/stmb-core.js';

test('AI Reference Manual locale follows available native-language guides', () => {
    assert.equal(resolveStmbAIReferenceManualLocale('de-de'), 'de-de');
    assert.equal(resolveStmbAIReferenceManualLocale('fr-FR'), 'fr-fr');
    assert.equal(resolveStmbAIReferenceManualLocale('ja_JP'), 'ja-jp');
    assert.equal(resolveStmbAIReferenceManualLocale('ru'), 'ru-ru');
});

test('AI Reference Manual locale maps Portuguese and falls back to English', () => {
    assert.equal(resolveStmbAIReferenceManualLocale('pt-pt'), 'pt-br');
    assert.equal(resolveStmbAIReferenceManualLocale('pt'), 'pt-br');
    assert.equal(resolveStmbAIReferenceManualLocale('nl-nl'), 'en');
    assert.equal(resolveStmbAIReferenceManualLocale(''), 'en');
});
