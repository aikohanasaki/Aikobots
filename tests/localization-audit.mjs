import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse as parseJs } from 'acorn';
import { parse as parseHtml } from 'parse5';

const PUBLIC_ROOT = path.resolve(process.cwd(), 'public');
const SKIPPED_DIRECTORIES = new Set(['lib', 'locales', 'third-party']);
const LOCALIZABLE_EXTENSIONS = new Set(['.html', '.js']);
const ATTRIBUTE_DIRECTIVE = /^\[([^\]\s]+)\](.+)$/;
const LOCALIZABLE_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];
const OPENING_TAG = /<[a-z][^<>]*?>/gis;
const LEAF_TEXT = /<([a-z][\w:-]*)(\s[^<>]*?)?>([^<>{}$]*[A-Za-z][^<>{}$]*)<\/\1>/gis;
const FIX_ATTRIBUTES = process.argv.includes('--fix-attributes');
const FIX_DYNAMIC = process.argv.includes('--fix-dynamic');
const FIX_TEXT = process.argv.includes('--fix-text');
const CHECK_LOCALES = process.argv.includes('--check-locales');
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const PRIORITY_LOCALES = ['de-de', 'fr-fr', 'ja-jp'];
const PROTECTED_BRANDS = [
    'Aikobots', 'STMB', 'Memory Books', 'Data Maid', 'SillyTavern', 'OpenAI', 'Anthropic',
    'Claude', 'Cohere', 'CometAPI', 'DeepSeek', 'Electron Hub', 'Fireworks AI',
    'Google AI Studio', 'Google Vertex AI', 'Groq', 'MistralAI', 'Moonshot AI',
    'NanoGPT', 'NovelAI', 'OpenRouter', 'Perplexity', 'Pollinations', 'SiliconFlow',
    'xAI', 'Z.AI', 'Azure OpenAI', 'Gemini', 'Gemma', 'KoboldAI', 'TabbyAPI',
];
const NONLOCALIZABLE_ATTRIBUTE_VALUES = new Set([
    'Gemini 2.0 Flash Experimental',
    'Gemini 1.5+, LearnLM',
]);
const NONLOCALIZABLE_TEXT_VALUES = new Set([
    'Aikobots', 'AI21', 'Anthropic', 'Claude', 'Cohere', 'CometAPI', 'DeepSeek',
    'Electron Hub', 'Fireworks AI', 'Google AI Studio', 'Google Vertex AI', 'Groq',
    'MistralAI', 'Moonshot AI', 'NanoGPT', 'Navy', 'OpenAI', 'OpenRouter',
    'Perplexity', 'Pollinations', 'SiliconFlow', 'xAI', 'xAI (Grok)', 'Z.AI', 'Zanity',
    'Azure OpenAI', 'Gemma / Gemini', 'Mistral V1', 'Mistral Nemo', 'Claude 1/2',
    'DeepSeek V3', 'Gemini 2.5 Flash Preview TTS', 'Gemini 2.5 Pro Preview TTS',
    'OpenAI Function Calling',
]);
const NONLOCALIZABLE_DYNAMIC_VALUES = new Set([
    ...NONLOCALIZABLE_TEXT_VALUES,
    'Anlas:',
    'NovelAI API',
    'STMB',
]);
const NONLOCALIZABLE_TEXT_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea']);

/**
 * Returns first-party frontend source files that may contain localization tags.
 * @param {string} directory Directory to scan
 * @returns {string[]} Source file paths
 */
function getSourceFiles(directory) {
    const files = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                files.push(...getSourceFiles(path.join(directory, entry.name)));
            }
            continue;
        }

        const filePath = path.join(directory, entry.name);
        if (LOCALIZABLE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.min.js')) {
            files.push(filePath);
        }
    }

    return files.sort();
}

/**
 * Adds a localization key and its first source location to the source catalog.
 * @param {Map<string, {filePath: string, offset: number, sourceText: string}>} catalog Source catalog
 * @param {string} key Localization key
 * @param {string} filePath Source file
 * @param {number} offset Source offset
 * @param {string} [sourceText=key] English source text
 */
function addCatalogKey(catalog, key, filePath, offset, sourceText = key) {
    if (!key || NONLOCALIZABLE_DYNAMIC_VALUES.has(key) || NONLOCALIZABLE_ATTRIBUTE_VALUES.has(key)) {
        return;
    }
    if (!catalog.has(key)) {
        catalog.set(key, { filePath, offset, sourceText });
    } else if (catalog.get(key).sourceText === key && sourceText !== key) {
        catalog.get(key).sourceText = sourceText;
    } else if (sourceText === key && /[A-Z\s]/.test(key)) {
        catalog.get(key).sourceText = key;
    }
}

/**
 * Decodes HTML source entities to the text exposed by the browser DOM.
 * @param {string} text Raw HTML source text
 * @returns {string} Browser-equivalent fallback text
 */
function decodeHtmlSourceText(text) {
    return String(text)
        .replaceAll('&#10;', '\n')
        .replaceAll('&#13;', '\r')
        .replaceAll('&nbsp;', '\u00A0')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', '\'')
        .replaceAll('&lcub;', '{')
        .replaceAll('&rcub;', '}')
        .replaceAll('&amp;', '&');
}

/**
 * Collects source-derived localization keys in deterministic source order.
 * @param {string[]} filePaths Frontend source files
 * @returns {Map<string, {filePath: string, offset: number, sourceText: string}>} Localization key catalog
 */
function collectSourceCatalog(filePaths) {
    const catalog = new Map();

    for (const filePath of filePaths) {
        const source = fs.readFileSync(filePath, 'utf8');
        for (const match of source.matchAll(/\bdata-i18n\s*=\s*(["'])(.*?)\1/gs)) {
            for (const directive of match[2].split(';')) {
                if (/\$\{|\{\{|<%/.test(directive)) {
                    continue;
                }
                const attributeMatch = directive.match(/^\[([^\]\s]+)\](.+)$/);
                const key = attributeMatch?.[2] || directive;
                let sourceText = key;
                if (attributeMatch) {
                    const openingTagStart = source.lastIndexOf('<', match.index);
                    const openingTagEnd = source.indexOf('>', match.index);
                    const openingTag = openingTagStart >= 0 && openingTagEnd >= 0
                        ? source.slice(openingTagStart, openingTagEnd + 1)
                        : '';
                    const escapedAttribute = attributeMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    sourceText = openingTag.match(new RegExp(`\\b${escapedAttribute}\\s*=\\s*(["'])(.*?)\\1`, 's'))?.[2] || key;
                } else {
                    const openingTagStart = source.lastIndexOf('<', match.index);
                    const openingTagEnd = source.indexOf('>', match.index);
                    const tagName = source.slice(openingTagStart + 1, openingTagEnd).match(/^([a-z][\w:-]*)/i)?.[1];
                    const closingTag = tagName ? source.indexOf(`</${tagName}>`, openingTagEnd) : -1;
                    const innerText = closingTag >= 0 ? source.slice(openingTagEnd + 1, closingTag) : '';
                    if (/[A-Za-z]/.test(innerText) && !/[<>{}$]/.test(innerText)) {
                        sourceText = innerText;
                    }
                }
                addCatalogKey(catalog, key, filePath, match.index, decodeHtmlSourceText(sourceText));
            }
        }

        if (path.extname(filePath) !== '.js') {
            continue;
        }

        let ast;
        try {
            ast = parseJs(source, { ecmaVersion: 'latest', sourceType: 'module' });
        } catch {
            continue;
        }

        const translateBindings = new Set();
        const templateBindings = new Set();
        for (const statement of ast.body) {
            if (statement.type !== 'ImportDeclaration' || !String(statement.source?.value || '').endsWith('i18n.js')) {
                continue;
            }
            for (const specifier of statement.specifiers) {
                if (specifier.type !== 'ImportSpecifier') {
                    continue;
                }
                if (specifier.imported?.name === 'translate') {
                    translateBindings.add(specifier.local.name);
                }
                if (specifier.imported?.name === 't') {
                    templateBindings.add(specifier.local.name);
                }
            }
        }

        const stack = [ast];
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') {
                continue;
            }
            if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && translateBindings.has(node.callee.name)) {
                const keyNode = node.arguments[1] || node.arguments[0];
                if (keyNode?.type === 'Literal' && typeof keyNode.value === 'string') {
                    const sourceTextNode = node.arguments[0];
                    const sourceText = sourceTextNode?.type === 'Literal' && typeof sourceTextNode.value === 'string'
                        ? sourceTextNode.value
                        : keyNode.value;
                    addCatalogKey(catalog, keyNode.value, filePath, keyNode.start, sourceText);
                }
            }
            if (node.type === 'TaggedTemplateExpression' && node.tag?.type === 'Identifier' && templateBindings.has(node.tag.name)) {
                let key = '';
                node.quasi.quasis.forEach((part, index) => {
                    key += part.value.cooked || '';
                    if (index < node.quasi.expressions.length) {
                        key += `\${${index}}`;
                    }
                });
                addCatalogKey(catalog, key, filePath, node.start);
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        if (item?.type) stack.push(item);
                    });
                } else if (value?.type) {
                    stack.push(value);
                }
            }
        }
    }

    return catalog;
}

/**
 * Gets a one-based line number for an offset.
 * @param {string} source File contents
 * @param {number} offset Character offset
 * @returns {number} Line number
 */
function getLineNumber(source, offset) {
    return source.slice(0, offset).split('\n').length;
}

/**
 * Determines whether a literal attribute contains authored UI copy.
 * @param {string} attribute Attribute name
 * @param {string} value Attribute value
 * @returns {boolean} Whether the attribute needs localization
 */
function isLocalizableAttribute(attribute, value) {
    const visibleValue = value.replace(/&[a-z]+;/gi, '');
    if (!/[A-Za-z]/.test(visibleValue) || /^\\[nrt]+$/.test(visibleValue) || /\{\{|\$\{|<%|\+\s*t`|[`]/.test(value)) {
        return false;
    }
    if (NONLOCALIZABLE_ATTRIBUTE_VALUES.has(value)) {
        return false;
    }
    if (/^(?:https?:|data:|mailto:|\/|%|&mdash;)/i.test(value)) {
        return false;
    }
    if (attribute === 'placeholder' && (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(value) || /_|^fa-|^[a-z]+(?:-[a-z]+)+$/.test(value))) {
        return false;
    }
    if (attribute === 'alt' && /^img\d*$/i.test(value)) {
        return false;
    }
    return true;
}

/**
 * Checks whether an offset is inside an HTML comment.
 * @param {string} source File contents
 * @param {number} offset Character offset
 * @returns {boolean} Whether the offset is commented out
 */
function isInHtmlComment(source, offset) {
    return source.lastIndexOf('<!--', offset) > source.lastIndexOf('-->', offset);
}

/**
 * Finds the end of a quoted JavaScript string.
 * @param {string} source File contents
 * @param {number} start Opening quote offset
 * @returns {number} Closing quote offset, or -1
 */
function findStringEnd(source, start) {
    const quote = source[start];
    for (let index = start + 1; index < source.length; index++) {
        if (source[index] === '\\') {
            index++;
            continue;
        }
        if (source[index] === quote) {
            return index;
        }
    }
    return -1;
}

/**
 * Determines whether a literal assigned to a visible text sink is authored UI copy.
 * @param {string} value Literal contents
 * @returns {boolean} Whether the literal needs localization
 */
function isLocalizableDynamicLiteral(value) {
    // Interpolated values may be user, provider, model, or server data. Only the
    // authored template segments are candidates for localization.
    const unescaped = value.replace(/\$\{[^{}]*\}/g, '').replace(/\\['"`\\]/g, '');
    const trimmed = unescaped.trim();
    return /[A-Za-z]/.test(unescaped)
        && !/^\s*</.test(unescaped)
        && !/^(?:undefined|pipe|anonymous:\s*)$/i.test(unescaped)
        && !NONLOCALIZABLE_DYNAMIC_VALUES.has(trimmed)
        && !/^[A-Z][A-Za-z0-9]*(?:Error)$/.test(trimmed)
        && !/^[A-Z0-9_-]{2,}$/.test(trimmed)
        && (/\s/.test(unescaped) || /^[A-Z]/.test(unescaped) || /^\([^)]*[A-Za-z][^)]*\)$/.test(unescaped));
}

/**
 * Extracts authored text from an untagged JavaScript string or template literal.
 * @param {import('acorn').Node} node Expression node
 * @returns {string|null} Literal text, or null for translated/computed values
 */
function getRawLiteralText(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
    }
    if (node?.type === 'TemplateLiteral') {
        return node.quasis.map(part => part.value.cooked || '').join(' ');
    }
    return null;
}

/**
 * Gets raw literal branches from a popup option expression.
 * @param {import('acorn').Node} node Expression node
 * @returns {import('acorn').Node[]} Raw literal nodes
 */
function getRawLiteralNodes(node) {
    if (getRawLiteralText(node) !== null) {
        return [node];
    }
    if (node?.type === 'ConditionalExpression') {
        return [...getRawLiteralNodes(node.consequent), ...getRawLiteralNodes(node.alternate)];
    }
    return [];
}

/**
 * Finds raw authored popup bodies using syntax-aware argument inspection.
 * @param {string} source File contents
 * @param {string} filePath Source file path
 * @returns {string[]} Findings
 */
function auditPopupBodies(source, filePath) {
    const findings = [];
    let ast;
    try {
        ast = parseJs(source, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch {
        return findings;
    }

    const stack = [ast];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') {
            continue;
        }
        if (node.type === 'CallExpression'
            && node.callee?.type === 'MemberExpression'
            && node.callee.object?.type === 'MemberExpression'
            && node.callee.object.object?.name === 'Popup'
            && node.callee.object.property?.name === 'show'
            && ['confirm', 'text', 'input'].includes(node.callee.property?.name)) {
            const body = node.arguments?.[1];
            const literal = getRawLiteralText(body);
            const visibleText = literal?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';
            if (isLocalizableDynamicLiteral(visibleText)) {
                const line = getLineNumber(source, body.start);
                const relativePath = path.relative(process.cwd(), filePath);
                findings.push(`${relativePath}:${line}: literal popup body is not localized`);
            }
        }
        if (node.type === 'CallExpression'
            && node.callee?.type === 'MemberExpression'
            && node.callee.object?.name === 'toastr'
            && ['success', 'info', 'warning', 'error'].includes(node.callee.property?.name)) {
            for (const argument of node.arguments.slice(0, 2)) {
                for (const literalNode of getRawLiteralNodes(argument)) {
                    const literal = getRawLiteralText(literalNode);
                    if (!isLocalizableDynamicLiteral(literal || '')) {
                        continue;
                    }
                    const line = getLineNumber(source, literalNode.start);
                    const relativePath = path.relative(process.cwd(), filePath);
                    findings.push(`${relativePath}:${line}: literal toastr copy is not localized "${literal.replace(/\s+/g, ' ').trim()}"`);
                }
            }
        }
        if (node.type === 'Property' && ['okButton', 'cancelButton'].includes(node.key?.name || node.key?.value)) {
            for (const literalNode of getRawLiteralNodes(node.value)) {
                const literal = getRawLiteralText(literalNode);
                if (!isLocalizableDynamicLiteral(literal || '')) {
                    continue;
                }
                const line = getLineNumber(source, literalNode.start);
                const relativePath = path.relative(process.cwd(), filePath);
                findings.push(`${relativePath}:${line}: literal popup button is not localized`);
            }
        }
        if (node.type === 'Property' && (node.key?.name || node.key?.value) === 'customButtons') {
            const customStack = [node.value];
            while (customStack.length) {
                const customNode = customStack.pop();
                if (!customNode || typeof customNode !== 'object') {
                    continue;
                }
                if (customNode.type === 'Property' && (customNode.key?.name || customNode.key?.value) === 'text') {
                    for (const literalNode of getRawLiteralNodes(customNode.value)) {
                        const literal = getRawLiteralText(literalNode);
                        if (!isLocalizableDynamicLiteral(literal || '')) {
                            continue;
                        }
                        const line = getLineNumber(source, literalNode.start);
                        const relativePath = path.relative(process.cwd(), filePath);
                        findings.push(`${relativePath}:${line}: literal custom popup button is not localized`);
                    }
                }
                for (const value of Object.values(customNode)) {
                    if (Array.isArray(value)) {
                        value.forEach(item => {
                            if (item?.type) customStack.push(item);
                        });
                    } else if (value?.type) {
                        customStack.push(value);
                    }
                }
            }
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(item => {
                    if (item?.type) stack.push(item);
                });
            } else if (value?.type) {
                stack.push(value);
            }
        }
    }

    return findings;
}

/**
 * Audits visible text nodes that are mixed with child elements in static HTML.
 * @param {string} source File contents
 * @param {string} filePath Source file path
 * @returns {string[]} Findings
 */
function auditHtmlTextNodes(source, filePath) {
    const findings = [];
    const document = parseHtml(source, { sourceCodeLocationInfo: true });
    const stack = [{ node: document, localizedAncestor: false }];

    while (stack.length) {
        const { node, localizedAncestor } = stack.pop();
        const attrs = Array.isArray(node.attrs) ? node.attrs : [];
        const i18n = attrs.find(attribute => attribute.name === 'data-i18n')?.value;
        const localizesText = localizedAncestor || (i18n?.split(';').some(directive => directive.trim() && !directive.trim().startsWith('[')) ?? false);

        if (node.nodeName === '#text' && !localizesText) {
            const parentTag = node.parentNode?.tagName || '';
            const parentAttrs = Array.isArray(node.parentNode?.attrs)
                ? node.parentNode.attrs.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ')
                : '';
            if (isLocalizableLeafText(parentTag, `<${parentTag} ${parentAttrs}>`, node.value)) {
                const line = node.sourceCodeLocation?.startLine || 1;
                const relativePath = path.relative(process.cwd(), filePath);
                findings.push(`${relativePath}:${line}: untagged static text node "${node.value.replace(/\s+/g, ' ').trim()}"`);
            }
        }

        for (const child of node.childNodes || []) {
            stack.push({ node: child, localizedAncestor: localizesText });
        }
        if (node.content) {
            stack.push({ node: node.content, localizedAncestor: localizesText });
        }
    }

    return findings;
}

/**
 * Determines whether leaf-element text is authored UI copy.
 * @param {string} tagName Element tag name
 * @param {string} openingTag Opening element markup
 * @param {string} value Leaf text contents
 * @returns {boolean} Whether the text needs localization
 */
function isLocalizableLeafText(tagName, openingTag, value) {
    const text = value.replace(/\s+/g, ' ').trim();
    const visibleText = text.replace(/&[a-z0-9#]+;/gi, '');
    if (!text || text.includes(';') || !/[A-Za-z]/.test(visibleText) || NONLOCALIZABLE_TEXT_TAGS.has(tagName.toLowerCase())) {
        return false;
    }
    if (NONLOCALIZABLE_TEXT_VALUES.has(text) || /\{\{|\$\{|<%|%[a-z_]+%|[`'"]\s*\+|\+\s*[`'"]|\bt`/.test(text)) {
        return false;
    }
    if (/^(?:https?:|data:|mailto:|\/)/i.test(text) || /^[\w./-]+\.[a-z0-9]{2,}(?:\s|$)/i.test(text)) {
        return false;
    }
    const tokenText = text.replace(/:$/, '');
    if (/^[a-z0-9_.:/-]+$/i.test(tokenText) && /[0-9_./-]/.test(tokenText)) {
        return false;
    }
    const optionValue = tagName.toLowerCase() === 'option'
        ? openingTag.match(/\bvalue\s*=\s*(["'])(.*?)\1/i)?.[2]
        : null;
    if (optionValue && optionValue.toLowerCase() === text.toLowerCase() && /[0-9_./-]/.test(optionValue)) {
        return false;
    }
    return true;
}

/**
 * Checks whether data-i18n includes a text directive rather than attributes only.
 * @param {string} openingTag Opening element markup
 * @returns {boolean} Whether element text is already tagged
 */
function hasTextDirective(openingTag) {
    const value = openingTag.match(/\bdata-i18n\s*=\s*(["'])(.*?)\1/is)?.[2];
    return value !== undefined && value.split(';').some(directive => directive.trim() && !directive.trim().startsWith('['));
}

/**
 * Queues wrappers around literal arguments found by a sink pattern.
 * @param {string} source File contents
 * @param {RegExp} pattern Pattern ending immediately before the literal
 * @param {Array<{offset: number, text: string}>} insertions Pending insertions
 * @param {Set<string>} requiredImports Required i18n import specifiers
 * @param {string} translateName Local name for the translation function
 */
function wrapSinkLiterals(source, pattern, insertions, requiredImports, translateName) {
    for (const match of source.matchAll(pattern)) {
        let literalStart = match.index + match[0].length;
        while (/\s/.test(source[literalStart])) {
            literalStart++;
        }

        const quote = source[literalStart];
        if (quote === '`') {
            const literalEnd = findStringEnd(source, literalStart);
            if (literalEnd === -1 || !isLocalizableDynamicLiteral(source.slice(literalStart + 1, literalEnd))) {
                continue;
            }
            insertions.push({ offset: literalStart, text: 't' });
            requiredImports.add('t');
            continue;
        }
        if (quote !== '\'' && quote !== '"') {
            continue;
        }

        const literalEnd = findStringEnd(source, literalStart);
        if (literalEnd === -1) {
            continue;
        }
        const value = source.slice(literalStart + 1, literalEnd);
        if (!isLocalizableDynamicLiteral(value)) {
            continue;
        }

        insertions.push({ offset: literalStart, text: `${translateName}(` });
        insertions.push({ offset: literalEnd + 1, text: ')' });
        requiredImports.add(translateName === 'translate' ? 'translate' : `translate as ${translateName}`);
    }
}

/**
 * Adds localization imports required by transformed dynamic UI copy.
 * @param {string} source File contents
 * @param {string} filePath Source file path
 * @param {Set<string>} requiredImports Required i18n exports
 * @returns {string} Updated file contents
 */
function addLocalizationImports(source, filePath, requiredImports) {
    if (!requiredImports.size) {
        return source;
    }

    const existingImport = source.match(/import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*i18n\.js)\2;/s);
    if (existingImport) {
        const names = existingImport[1].split(',').map(name => name.trim()).filter(Boolean);
        const mergedNames = Array.from(new Set([...names, ...requiredImports])).sort();
        return source.replace(existingImport[0], `import { ${mergedNames.join(', ')} } from ${existingImport[2]}${existingImport[3]}${existingImport[2]};`);
    }

    const i18nPath = path.resolve(PUBLIC_ROOT, 'scripts', 'i18n.js');
    let relativeImport = path.relative(path.dirname(filePath), i18nPath).replaceAll('\\', '/');
    if (!relativeImport.startsWith('.')) {
        relativeImport = `./${relativeImport}`;
    }
    return `import { ${Array.from(requiredImports).sort().join(', ')} } from '${relativeImport}';\n${source}`;
}

/**
 * Wraps literal toastr messages while leaving computed and external values untouched.
 * @param {string} source File contents
 * @param {string} filePath Source file path
 * @returns {string} Updated file contents
 */
function wrapDynamicUiLiterals(source, filePath) {
    const insertions = [];
    const requiredImports = new Set();
    const translateName = /\b(?:async\s+)?function\s+translate\b|(?:const|let|var|class)\s+translate\b/.test(source)
        ? 'translateUi'
        : 'translate';
    const ast = parseJs(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const stack = [ast];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') {
            continue;
        }
        if (node.type === 'CallExpression'
            && node.callee?.type === 'MemberExpression'
            && node.callee.object?.name === 'toastr'
            && ['success', 'info', 'warning', 'error'].includes(node.callee.property?.name)) {
            for (const argument of node.arguments.slice(0, 2)) {
                for (const literalNode of getRawLiteralNodes(argument)) {
                    const literal = getRawLiteralText(literalNode);
                    if (!isLocalizableDynamicLiteral(literal || '')) {
                        continue;
                    }
                    if (literalNode.type === 'TemplateLiteral') {
                        insertions.push({ offset: literalNode.start, text: 't' });
                        requiredImports.add('t');
                    } else {
                        insertions.push({ offset: literalNode.start, text: `${translateName}(` });
                        insertions.push({ offset: literalNode.end, text: ')' });
                        requiredImports.add(translateName === 'translate' ? 'translate' : `translate as ${translateName}`);
                    }
                }
            }
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(item => {
                    if (item?.type) stack.push(item);
                });
            } else if (value?.type) {
                stack.push(value);
            }
        }
    }

    wrapSinkLiterals(source, /\b(?:callGenericPopup|new\s+Popup)\s*\(\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\bPopup\.show\.(?:confirm|text|input)\s*\(\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\.(?:textContent|innerText)\s*=\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\.(?:title|placeholder|alt)\s*=\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\.setAttribute\s*\(\s*(['"])(?:title|placeholder|aria-label|alt)\1\s*,\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\.attr\s*\(\s*(['"])(?:title|placeholder|aria-label|alt)\1\s*,\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\.text\s*\(\s*/g, insertions, requiredImports, translateName);
    wrapSinkLiterals(source, /\b(?:okButton|cancelButton)\s*:\s*/g, insertions, requiredImports, translateName);

    for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
        source = source.slice(0, insertion.offset) + insertion.text + source.slice(insertion.offset);
    }

    return addLocalizationImports(source, filePath, requiredImports);
}

/**
 * Adds missing localization directives for literal user-facing attributes.
 * @param {string} source File contents
 * @returns {string} Updated file contents
 */
function addAttributeDirectives(source) {
    return source.replace(OPENING_TAG, (openingTag, offset) => {
        if (isInHtmlComment(source, offset)) {
            return openingTag;
        }
        let updatedTag = openingTag;
        const directives = [];

        for (const attribute of LOCALIZABLE_ATTRIBUTES) {
            const escapedAttribute = attribute.replace('-', '\\-');
            const attributePattern = new RegExp(`(?<![-\\w])${escapedAttribute}\\s*=\\s*(["'])(.*?)\\1`, 'is');
            const attributeMatch = updatedTag.match(attributePattern);
            if (!attributeMatch || !isLocalizableAttribute(attribute, attributeMatch[2]) || attributeMatch[2].includes(';')) {
                continue;
            }

            const directivePattern = new RegExp(`\\[${escapedAttribute}\\]`);
            const existingI18n = updatedTag.match(/\bdata-i18n\s*=\s*(["'])(.*?)\1/is);
            if (existingI18n && directivePattern.test(existingI18n[2])) {
                continue;
            }

            directives.push(`[${attribute}]${attributeMatch[2]}`);
        }

        if (!directives.length) {
            return updatedTag;
        }

        const existingI18n = updatedTag.match(/\bdata-i18n\s*=\s*(["'])(.*?)\1/is);
        if (existingI18n) {
            const replacement = `data-i18n=${existingI18n[1]}${existingI18n[2]};${directives.join(';')}${existingI18n[1]}`;
            return updatedTag.replace(existingI18n[0], replacement);
        }

        return updatedTag.replace(/\s*(\/?>)$/, ` data-i18n="${directives.join(';')}"$1`);
    });
}

/**
 * Adds localization directives to literal leaf-element copy.
 * @param {string} source File contents
 * @returns {string} Updated file contents
 */
function addTextDirectives(source) {
    return source.replace(LEAF_TEXT, (element, tagName, attributes = '', text, offset) => {
        if (isInHtmlComment(source, offset)) {
            return element;
        }
        const openingTag = `<${tagName}${attributes}>`;
        if (hasTextDirective(openingTag) || !isLocalizableLeafText(tagName, openingTag, text)) {
            return element;
        }

        const normalizedText = text.replace(/\s+/g, ' ').trim();
        const key = (normalizedText.match(/^\[\s*(.*?)\s*\]$/)?.[1] || normalizedText).replaceAll('"', '&quot;');
        const existingI18n = openingTag.match(/\bdata-i18n\s*=\s*(["'])(.*?)\1/is);
        if (existingI18n) {
            const localizedOpeningTag = openingTag.replace(existingI18n[0], `data-i18n=${existingI18n[1]}${existingI18n[2]};${key}${existingI18n[1]}`);
            return element.replace(openingTag, localizedOpeningTag);
        }
        const localizedOpeningTag = openingTag.slice(0, -1) + ` data-i18n="${key}">`;
        return element.replace(openingTag, localizedOpeningTag);
    });
}

/**
 * Audits data-i18n syntax and attribute fallbacks in a frontend source file.
 * @param {string} filePath Source file path
 * @returns {string[]} Findings
 */
function auditFile(filePath) {
    let source = fs.readFileSync(filePath, 'utf8');
    if (FIX_ATTRIBUTES) {
        const updatedSource = addAttributeDirectives(source);
        if (updatedSource !== source) {
            fs.writeFileSync(filePath, updatedSource);
            source = updatedSource;
        }
    }
    if (FIX_TEXT) {
        const updatedSource = addTextDirectives(source);
        if (updatedSource !== source) {
            fs.writeFileSync(filePath, updatedSource);
            source = updatedSource;
        }
    }
    if (FIX_DYNAMIC && path.extname(filePath) === '.js' && path.resolve(filePath) !== path.resolve(PUBLIC_ROOT, 'scripts', 'i18n.js')) {
        const updatedSource = wrapDynamicUiLiterals(source, filePath);
        if (updatedSource !== source) {
            fs.writeFileSync(filePath, updatedSource);
            source = updatedSource;
        }
    }
    const findings = [];
    const directivePattern = /\bdata-i18n\s*=\s*(["'])(.*?)\1/gs;

    for (const match of source.matchAll(directivePattern)) {
        const line = getLineNumber(source, match.index);
        const relativePath = path.relative(process.cwd(), filePath);
        const directives = match[2].split(';');

        for (const directive of directives) {
            if (!directive.trim()) {
                findings.push(`${relativePath}:${line}: empty data-i18n directive`);
                continue;
            }

            if (!/^\[[^\]\s]+\]/.test(directive)) {
                continue;
            }

            const attributeMatch = directive.match(ATTRIBUTE_DIRECTIVE);
            if (!attributeMatch || !attributeMatch[2].trim()) {
                findings.push(`${relativePath}:${line}: malformed data-i18n directive "${directive}"`);
                continue;
            }

            const openingTagStart = source.lastIndexOf('<', match.index);
            const openingTagEnd = source.indexOf('>', match.index);
            if (openingTagStart === -1 || openingTagEnd === -1) {
                findings.push(`${relativePath}:${line}: could not locate element for "${directive}"`);
                continue;
            }

            const openingTag = source.slice(openingTagStart, openingTagEnd + 1);
            const escapedAttribute = attributeMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!new RegExp(`\\b${escapedAttribute}\\s*=`).test(openingTag)) {
                findings.push(`${relativePath}:${line}: "${directive}" has no source ${attributeMatch[1]} attribute`);
            }
        }
    }

    for (const match of source.matchAll(OPENING_TAG)) {
        if (isInHtmlComment(source, match.index)) {
            continue;
        }
        const openingTag = match[0];
        const i18nValue = openingTag.match(/\bdata-i18n\s*=\s*(["'])(.*?)\1/is)?.[2] || '';

        for (const attribute of LOCALIZABLE_ATTRIBUTES) {
            const escapedAttribute = attribute.replace('-', '\\-');
            const attributeMatch = openingTag.match(new RegExp(`(?<![-\\w])${escapedAttribute}\\s*=\\s*(["'])(.*?)\\1`, 'is'));
            if (!attributeMatch || !isLocalizableAttribute(attribute, attributeMatch[2])) {
                continue;
            }
            if (new RegExp(`\\[${escapedAttribute}\\]`).test(i18nValue)) {
                continue;
            }

            const line = getLineNumber(source, match.index);
            const relativePath = path.relative(process.cwd(), filePath);
            findings.push(`${relativePath}:${line}: untagged ${attribute} attribute "${attributeMatch[2]}"`);
        }
    }

    for (const match of source.matchAll(LEAF_TEXT)) {
        if (isInHtmlComment(source, match.index)) {
            continue;
        }
        const openingTag = `<${match[1]}${match[2] || ''}>`;
        if (hasTextDirective(openingTag) || !isLocalizableLeafText(match[1], openingTag, match[3])) {
            continue;
        }
        const line = getLineNumber(source, match.index);
        const relativePath = path.relative(process.cwd(), filePath);
        findings.push(`${relativePath}:${line}: untagged literal leaf text "${match[3].replace(/\s+/g, ' ').trim()}"`);
    }

    if (path.extname(filePath) === '.html') {
        findings.push(...auditHtmlTextNodes(source, filePath));
    }

    if (path.extname(filePath) === '.js') {
        const dynamicSinkPatterns = [
            { pattern: /\b(?:callGenericPopup|new\s+Popup)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, message: 'literal popup copy is not localized', valueIndex: 2 },
            { pattern: /\bPopup\.show\.(?:confirm|text|input)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, message: 'literal popup heading is not localized', valueIndex: 2 },
            { pattern: /\.(?:textContent|innerText)\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/g, message: 'literal DOM text is not localized', valueIndex: 2 },
            { pattern: /\.(?:title|placeholder|alt)\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/g, message: 'literal DOM attribute is not localized', valueIndex: 2 },
            { pattern: /\.setAttribute\s*\(\s*(['"])(?:title|placeholder|aria-label|alt)\1\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2/g, message: 'literal DOM attribute is not localized', valueIndex: 3 },
            { pattern: /\.attr\s*\(\s*(['"])(?:title|placeholder|aria-label|alt)\1\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2/g, message: 'literal jQuery attribute is not localized', valueIndex: 3 },
            { pattern: /\.text\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, message: 'literal jQuery text is not localized', valueIndex: 2 },
            { pattern: /\b(?:okButton|cancelButton)\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g, message: 'literal popup button is not localized', valueIndex: 2 },
        ];
        for (const sink of dynamicSinkPatterns) {
            for (const match of source.matchAll(sink.pattern)) {
                if (sink.valueIndex && !isLocalizableDynamicLiteral(match[sink.valueIndex])) {
                    continue;
                }
                const line = getLineNumber(source, match.index);
                const relativePath = path.relative(process.cwd(), filePath);
                findings.push(`${relativePath}:${line}: ${sink.message}`);
            }
        }
        findings.push(...auditPopupBodies(source, filePath));
    }

    return findings;
}

/**
 * Extracts protected syntax that translations must preserve exactly.
 * @param {string} text English source or translated text
 * @returns {string[]} Sorted protected tokens
 */
function getProtectedTokens(text) {
    const tokens = [];
    const patterns = [
        ['placeholder', /\$\{\d+\}/g],
        ['macro', /\{\{[^{}]+\}\}/g],
        ['url', /https?:\/\/[^\s"'<>()[\]{}]+/g],
        ['html', /<\/?(?:a|b|br|code|div|em|i|kbd|li|ol|p|pre|small|span|strong|ul)\b[^>]*>/gi],
        ['shortcut', /\b(?:Ctrl|Alt|Shift|Cmd|Command|Meta)(?:\+[A-Za-z0-9]+)+\b/g],
        ['sentinel', /\b(?:OVERWRITE|START)\b/g],
        ['file', /\b[\w.-]+\.(?:jsonl?|png|jpe?g|webp|ya?ml|txt|md|sqlite|html|js|css)\b/gi],
        ['format', /%[sdif]/g],
        ['replacement', /\$(?:\d+|&|<[\w-]+>)/g],
        ['icon', /:[a-z][\w-]*:/gi],
    ];
    for (const [type, pattern] of patterns) {
        for (const match of String(text).matchAll(pattern)) {
            tokens.push(`${type}:${match[0]}`);
        }
    }
    for (const match of String(text).matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)) {
        tokens.push(`code:${match[1]}`);
    }
    for (const brand of PROTECTED_BRANDS) {
        for (let offset = String(text).indexOf(brand); offset >= 0; offset = String(text).indexOf(brand, offset + brand.length)) {
            tokens.push(`brand:${brand}`);
        }
    }
    for (const match of String(text).matchAll(/\/([a-z][\w-]*)/g)) {
        const previous = text[match.index - 1] || '';
        if (!/[A-Za-z0-9_/:<]/.test(previous)) {
            tokens.push(`command:/${match[1]}`);
        }
    }
    return tokens.sort();
}

/**
 * Finds duplicate object keys in a JSON locale file.
 * @param {string} raw Locale JSON source
 * @returns {string[]} Duplicate keys
 */
function getDuplicateJsonKeys(raw) {
    const ast = parseJs(`(${raw})`, { ecmaVersion: 'latest' });
    const properties = ast.body[0]?.expression?.properties || [];
    const seen = new Set();
    const duplicates = [];
    for (const property of properties) {
        const key = property.key?.value ?? property.key?.name;
        if (seen.has(key)) {
            duplicates.push(key);
        }
        seen.add(key);
    }
    return duplicates;
}

/**
 * Audits priority locale coverage and protected translation syntax.
 * @param {Map<string, {filePath: string, offset: number, sourceText: string}>} catalog Source key catalog
 * @returns {string[]} Locale findings
 */
function auditPriorityLocales(catalog) {
    const findings = [];
    for (const locale of PRIORITY_LOCALES) {
        const localePath = path.join(PUBLIC_ROOT, 'locales', `${locale}.json`);
        const relativePath = path.relative(process.cwd(), localePath);
        const raw = fs.readFileSync(localePath, 'utf8');
        let data;
        try {
            data = JSON.parse(raw);
        } catch (error) {
            findings.push(`${relativePath}: invalid JSON: ${error.message}`);
            continue;
        }

        let duplicates = [];
        try {
            duplicates = getDuplicateJsonKeys(raw);
        } catch (error) {
            findings.push(`${relativePath}: could not inspect duplicate keys: ${error.message}`);
        }
        if (duplicates.length) {
            findings.push(`${relativePath}: duplicate keys: ${duplicates.join(', ')}`);
        }

        const missing = [];
        const blank = [];
        const invalidValues = [];
        const privateUseMarkers = [];
        const tokenMismatches = [];
        for (const [key, source] of catalog) {
            if (!Object.hasOwn(data, key)) {
                missing.push(key);
                continue;
            }
            if (typeof data[key] !== 'string') {
                invalidValues.push(key);
                continue;
            }
            if (!data[key].trim()) {
                blank.push(key);
                continue;
            }
            if (/[\uE000-\uF8FF]|__AIBOTPROTECTED\d+X__/u.test(data[key])) {
                privateUseMarkers.push(key);
            }
            const sourceTokens = getProtectedTokens(source.sourceText);
            const translatedTokens = getProtectedTokens(data[key]);
            const retainedTokens = translatedTokens.filter(token => sourceTokens.includes(token));
            const sourceBrands = sourceTokens.filter(token => token.startsWith('brand:'));
            const translatedBrands = translatedTokens.filter(token => token.startsWith('brand:'));
            if (JSON.stringify(sourceTokens) !== JSON.stringify(retainedTokens)
                || JSON.stringify(sourceBrands) !== JSON.stringify(translatedBrands)) {
                tokenMismatches.push(key);
            }
        }

        const staleCount = Object.keys(data).filter(key => !catalog.has(key)).length;
        const identicalCount = [...catalog.keys()].filter(key => Object.hasOwn(data, key) && data[key] === catalog.get(key).sourceText).length;
        console.log(`${locale}: ${catalog.size - missing.length}/${catalog.size} keys; ${missing.length} missing; ${staleCount} stale; ${identicalCount} source-identical`);

        if (!ALLOW_MISSING && missing.length) {
            findings.push(`${relativePath}: ${missing.length} missing source keys (first 20: ${missing.slice(0, 20).join(' | ')})`);
        }
        if (blank.length) {
            findings.push(`${relativePath}: blank used values: ${blank.join(' | ')}`);
        }
        if (invalidValues.length) {
            findings.push(`${relativePath}: non-string used values: ${invalidValues.join(' | ')}`);
        }
        if (privateUseMarkers.length) {
            findings.push(`${relativePath}: private-use translation markers: ${privateUseMarkers.join(' | ')}`);
        }
        if (tokenMismatches.length) {
            findings.push(`${relativePath}: protected-token mismatches: ${tokenMismatches.join(' | ')}`);
        }
    }
    return findings;
}

const sourceFiles = getSourceFiles(PUBLIC_ROOT);
const findings = sourceFiles.flatMap(auditFile);
if (CHECK_LOCALES) {
    const catalog = collectSourceCatalog(sourceFiles);
    console.log(`Source localization catalog: ${catalog.size} keys.`);
    findings.push(...auditPriorityLocales(catalog));
}

if (findings.length) {
    console.error(`Localization audit failed with ${findings.length} finding(s):`);
    findings.forEach(finding => console.error(`- ${finding}`));
    process.exitCode = 1;
} else {
    console.log('Localization audit passed.');
}
