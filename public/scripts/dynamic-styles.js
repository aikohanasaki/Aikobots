import { INTERACTABLE_CONTROL_CLASS } from './keyboard.js';

/** @type {CSSStyleSheet} */
let dynamicStyleSheet = null;
/** @type {CSSStyleSheet} */
let dynamicExtensionStyleSheet = null;

/**
 * An observer that will check if any new stylesheets are added to the head
 * @type {MutationObserver}
 */
const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        if (mutation.type !== 'childList') return;

        mutation.addedNodes.forEach(node => {
            if (node instanceof HTMLLinkElement && node.tagName === 'LINK' && node.rel === 'stylesheet') {
                node.addEventListener('load', () => {
                    try {
                        applyDynamicFocusStyles(node.sheet);
                    } catch (e) {
                        console.warn('Failed to process new stylesheet:', e);
                    }
                });
            }
        });
    });
});

/**
 * Generates dynamic focus styles based on the given stylesheet, taking its hover styles as reference
 *
 * @param {CSSStyleSheet} styleSheet - The stylesheet to process
 * @param {object} [options] - Optional configuration options
 * @param {boolean} [options.fromExtension=false] - Indicates if the styles are from an extension
 */
function applyDynamicFocusStyles(styleSheet, { fromExtension = false } = {}) {
    /** @typedef {{ type: 'media'|'supports'|'container', conditionText: string }} WrapperCond */
    /** @type {{focusBaseSelector: string, focusSelector: string, styleText: string, wrappers: WrapperCond[]}[]} */
    const hoverRules = [];
    /** @type {Set<string>} */
    const focusRules = new Set();

    const PLACEHOLDER = ':__PLACEHOLDER__';
    const NATIVE_FOCUSABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);

    /**
     * Checks whether the given character is escaped by an odd number of preceding backslashes
     *
     * @param {string} value
     * @param {number} index
     * @returns {boolean}
     */
    function isEscaped(value, index) {
        let backslashCount = 0;

        for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) {
            backslashCount++;
        }

        return backslashCount % 2 === 1;
    }

    /**
     * Finds all top-level :hover occurrences, ignoring nested selectors inside [] and ()
     *
     * @param {string} selector
     * @returns {number[]}
     */
    function findTopLevelHoverIndices(selector) {
        const indices = [];
        let bracketDepth = 0;
        let parenDepth = 0;

        for (let i = 0; i < selector.length; i++) {
            if (isEscaped(selector, i)) continue;

            const char = selector[i];

            if (char === '[') {
                bracketDepth++;
                continue;
            }

            if (char === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                continue;
            }

            if (char === '(') {
                parenDepth++;
                continue;
            }

            if (char === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
                continue;
            }

            if (bracketDepth === 0 && parenDepth === 0 && selector.startsWith(':hover', i)) {
                const nextChar = selector[i + 6];
                if (!nextChar || !/[\w-]/.test(nextChar)) {
                    indices.push(i);
                }
            }
        }

        return indices;
    }

    /**
     * Finds the start of the top-level compound selector containing the given index
     *
     * @param {string} selector
     * @param {number} index
     * @returns {number}
     */
    function findCompoundStart(selector, index) {
        let bracketDepth = 0;
        let parenDepth = 0;

        for (let i = index - 1; i >= 0; i--) {
            if (isEscaped(selector, i)) continue;

            const char = selector[i];

            if (char === ']') {
                bracketDepth++;
                continue;
            }

            if (char === '[') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                continue;
            }

            if (char === ')') {
                parenDepth++;
                continue;
            }

            if (char === '(') {
                parenDepth = Math.max(0, parenDepth - 1);
                continue;
            }

            if (bracketDepth === 0 && parenDepth === 0 && /[\s>+~]/.test(char)) {
                return i + 1;
            }
        }

        return 0;
    }

    /**
     * Finds the end of the top-level compound selector containing the given index
     *
     * @param {string} selector
     * @param {number} index
     * @returns {number}
     */
    function findCompoundEnd(selector, index) {
        let bracketDepth = 0;
        let parenDepth = 0;

        for (let i = index; i < selector.length; i++) {
            if (isEscaped(selector, i)) continue;

            const char = selector[i];

            if (char === '[') {
                bracketDepth++;
                continue;
            }

            if (char === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                continue;
            }

            if (char === '(') {
                parenDepth++;
                continue;
            }

            if (char === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
                continue;
            }

            if (bracketDepth === 0 && parenDepth === 0 && /[\s>+~]/.test(char)) {
                return i;
            }
        }

        return selector.length;
    }

    /**
     * Checks whether the hovered subject is already a native or explicitly focusable control
     *
     * @param {string} compoundBeforeHover
     * @returns {boolean}
     */
    function isObviouslyFocusable(compoundBeforeHover) {
        const trimmed = compoundBeforeHover.trim();
        const typeMatch = trimmed.match(/^([a-zA-Z][\w-]*)(?=[#.[:]|$)/);

        if (typeMatch && NATIVE_FOCUSABLE_TAGS.has(typeMatch[1].toLowerCase())) {
            return true;
        }

        return trimmed.includes(`.${INTERACTABLE_CONTROL_CLASS}`)
            || trimmed.includes('[tabindex')
            || trimmed.includes('[contenteditable')
            || trimmed.includes('[href')
            || trimmed.includes(':any-link')
            || trimmed.includes(':link')
            || trimmed.includes(':visited');
    }

    /**
     * Checks whether the browser accepts the given selector
     *
     * @param {string} selector
     * @returns {boolean}
     */
    function isSupportedSelector(selector) {
        try {
            return typeof CSS?.supports !== 'function' || CSS.supports(`selector(${selector})`);
        } catch {
            return false;
        }
    }

    /**
     * Converts a hover selector into the focus selector that should be auto-generated.
     * Only rightmost hovered subjects are transformed. Parent-hover patterns should define explicit focus CSS.
     *
     * @param {string} selector
     * @returns {{ focusBaseSelector: string, focusSelector: string } | null}
     */
    function buildDynamicFocusSelector(selector) {
        const hoverIndices = findTopLevelHoverIndices(selector);
        if (hoverIndices.length !== 1) return null;

        const hoverIndex = hoverIndices[0];
        const compoundStart = findCompoundStart(selector, hoverIndex);
        const compoundEnd = findCompoundEnd(selector, hoverIndex + 6);

        // Skip parent-hover patterns like `.container:hover .child`.
        if (compoundEnd !== selector.length) return null;

        const compoundBeforeHover = selector.slice(compoundStart, hoverIndex);
        if (compoundBeforeHover.includes('::')) return null;

        const focusInsertion = isObviouslyFocusable(compoundBeforeHover)
            ? ':focus-visible'
            : `.${INTERACTABLE_CONTROL_CLASS}:focus-visible`;

        const focusSelector = `${selector.slice(0, hoverIndex)}${focusInsertion}${selector.slice(hoverIndex + 6)}`;
        if (!isSupportedSelector(focusSelector)) return null;

        const focusBaseSelector = focusSelector.replace(/:focus(-within|-visible)?/g, PLACEHOLDER).trim();
        return { focusBaseSelector, focusSelector };
    }

    /**
     * Builds a stable signature string for a chain of wrapper conditions so we can distinguish
     * identical selectors under different contexts (e.g., different @media queries)
     * @param {WrapperCond[]} wrappers
     * @returns {string}
     */
    function wrapperSignature(wrappers) {
        return wrappers.map(w => `${w.type}:${w.conditionText}`).join(';');
    }

    /**
     * Processes the CSS rules and separates selectors for hover and focus
     * @param {CSSRuleList} rules - The CSS rules to process
     * @param {WrapperCond[]} wrappers - Current chain of wrapper conditions (@media/@supports/etc.)
     */
    function processRules(rules, wrappers = []) {
        Array.from(rules).forEach(rule => {
            if (rule instanceof CSSImportRule) {
                // Make sure that @import rules are processed recursively
                // If the @import has media conditions, treat them as wrappers as well
                /** @type {WrapperCond[]} */
                const extra = (rule.media && rule.media.mediaText) ? [{ type: 'media', conditionText: rule.media.mediaText }] : [];
                processImportedStylesheet(rule.styleSheet, [...wrappers, ...extra]);
            } else if (rule instanceof CSSStyleRule) {
                // Separate multiple selectors on a rule
                const selectors = rule.selectorText.split(',').map(s => s.trim());

                // We collect all hover and focus rules to be able to later decide which hover rules don't have a matching focus rule
                selectors.forEach(selector => {
                    const isHover = selector.includes(':hover'), isFocus = selector.includes(':focus');
                    if (isHover && isFocus) {
                        // We currently do nothing here. Rules containing both hover and focus are very specific and should never be automatically touched
                    }
                    else if (isHover) {
                        const dynamicFocusSelector = buildDynamicFocusSelector(selector);

                        if (dynamicFocusSelector) {
                            hoverRules.push({
                                focusBaseSelector: dynamicFocusSelector.focusBaseSelector,
                                focusSelector: dynamicFocusSelector.focusSelector,
                                styleText: rule.style.cssText,
                                wrappers: [...wrappers],
                            });
                        }
                    } else if (isFocus) {
                        // We need to make sure that we remember all existing :focus, :focus-within and :focus-visible rules
                        const baseSelector = selector.replace(/:focus(-within|-visible)?/g, PLACEHOLDER).trim();
                        focusRules.add(`${baseSelector}|${wrapperSignature(wrappers)}`);
                    }
                });
            } else if (rule instanceof CSSMediaRule) {
                // Recursively process nested @media rules
                processRules(rule.cssRules, [...wrappers, { type: 'media', conditionText: rule.conditionText }]);
            } else if (rule instanceof CSSSupportsRule) {
                // Recursively process nested @supports rules
                processRules(rule.cssRules, [...wrappers, { type: 'supports', conditionText: rule.conditionText }]);
            } else if (rule instanceof window.CSSContainerRule) {
                // Recursively process nested @container rules (if supported by the browser)
                // Note: conditionText contains the query like "(min-width: 300px)" or "style(color)"
                // Using 'container' as the type ensures uniqueness separate from @media/@supports
                processRules(rule.cssRules, [...wrappers, { type: 'container', conditionText: rule.conditionText }]);
            }
        });
    }

    /**
     * Processes the CSS rules of an imported stylesheet recursively
     * @param {CSSStyleSheet} sheet - The imported stylesheet to process
     * @param {WrapperCond[]} wrappers - Wrapper conditions inherited from (at)import media
     */
    function processImportedStylesheet(sheet, wrappers = []) {
        if (sheet && sheet.cssRules) {
            processRules(sheet.cssRules, wrappers);
        }
    }

    processRules(styleSheet.cssRules, []);

    /** @type {CSSStyleSheet} */
    let targetStyleSheet = null;

    // Now finally create the dynamic focus rules
    hoverRules.forEach(({ focusBaseSelector, focusSelector, styleText, wrappers }) => {
        if (!focusRules.has(`${focusBaseSelector}|${wrapperSignature(wrappers)}`)) {
            // Only initialize the dynamic stylesheet if needed
            targetStyleSheet ??= getDynamicStyleSheet({ fromExtension });

            // The closest keyboard-equivalent to :hover styling is utilizing the :focus-visible rule from modern browsers.
            // It lets the browser decide whether a focus highlighting is expected and makes sense.
            // So we take all :hover rules that don't have a manually defined focus rule yet, and create their
            // :focus-visible counterpart, which will make the styling work the same for keyboard and mouse.
            // Parent-hover patterns such as `.parent:hover .child` must define explicit focus CSS instead of relying on this heuristic.
            // If something like :focus-within or a more specific selector like `.blah:has(:focus-visible)` for elements inside,
            // it should be manually defined in CSS.
            let focusRule = `${focusSelector} { ${styleText} }`;

            // Wrap the generated rule into the same @media/@supports/@container chain (if any)
            if (wrappers.length > 0) {
                // Build nested blocks from outermost to innermost
                // Example: @media (x) { @supports (y) { <rule> } }
                focusRule = wrappers.reduceRight((inner, w) => {
                    if (w.type === 'media') return `@media ${w.conditionText} { ${inner} }`;
                    if (w.type === 'supports') return `@supports ${w.conditionText} { ${inner} }`;
                    if (w.type === 'container') return `@container ${w.conditionText} { ${inner} }`;
                    return inner;
                }, focusRule);
            }

            try {
                targetStyleSheet.insertRule(focusRule, targetStyleSheet.cssRules.length);
            } catch (e) {
                console.warn('Failed to insert focus rule:', e);
            }
        }
    });
}

/**
 * Retrieves the stylesheet that should be used for dynamic rules
 *
 * @param {object} options - The options object
 * @param {boolean} [options.fromExtension=false] - Indicates whether the rules are coming from extensions
 * @return {CSSStyleSheet} The dynamic stylesheet
 */
function getDynamicStyleSheet({ fromExtension = false } = {}) {
    if (fromExtension) {
        if (!dynamicExtensionStyleSheet) {
            const styleSheetElement = document.createElement('style');
            styleSheetElement.setAttribute('id', 'dynamic-extension-styles');
            document.head.appendChild(styleSheetElement);
            dynamicExtensionStyleSheet = styleSheetElement.sheet;
        }
        return dynamicExtensionStyleSheet;
    } else {
        if (!dynamicStyleSheet) {
            const styleSheetElement = document.createElement('style');
            styleSheetElement.setAttribute('id', 'dynamic-styles');
            document.head.appendChild(styleSheetElement);
            dynamicStyleSheet = styleSheetElement.sheet;
        }
        return dynamicStyleSheet;
    }
}

/**
 * Initializes dynamic styles for ST
 */
export function initDynamicStyles() {
    // Start observing the head for any new added stylesheets
    observer.observe(document.head, {
        childList: true,
        subtree: true,
    });

    // Process all stylesheets on initial load
    Array.from(document.styleSheets).forEach(sheet => {
        try {
            applyDynamicFocusStyles(sheet, { fromExtension: sheet.href?.toLowerCase().includes('scripts/extensions') == true });
        } catch (e) {
            console.warn('Failed to process stylesheet on initial load:', e);
        }
    });
}
