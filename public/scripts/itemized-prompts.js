import { DiffMatchPatch, DOMPurify, localforage } from '../lib.js';
import { chat, event_types, eventSource, getCurrentChatId, reloadCurrentChat } from '../script.js';
import { t } from './i18n.js';
import { oai_settings } from './openai.js';
import { Popup, POPUP_TYPE } from './popup.js';
import { power_user, registerDebugFunction } from './power-user.js';
import { isMobile } from './RossAscends-mods.js';
import { renderTemplateAsync } from './templates.js';
import { getFriendlyTokenizerName, getTokenCountAsync } from './tokenizers.js';
import { copyText } from './utils.js';

let PromptArrayItemForRawPromptDisplay;
let priorPromptArrayItemForRawPromptDisplay;

const promptStorage = localforage.createInstance({ name: 'SillyTavern_Prompts' });
export let itemizedPrompts = [];

/**
 * Gets the itemized prompts for a chat.
 * @param {string} chatId Chat ID to load
 */
export async function loadItemizedPrompts(chatId) {
    try {
        if (!chatId) {
            itemizedPrompts = [];
            return;
        }

        itemizedPrompts = await promptStorage.getItem(chatId);

        if (!itemizedPrompts) {
            itemizedPrompts = [];
        }
    } catch (error) {
        console.error('Error loading itemized prompts for chat', chatId, error);
        itemizedPrompts = [];
    }
}

/**
 * Saves the itemized prompts for a chat.
 * @param {string} chatId Chat ID to save itemized prompts for
 */
export async function saveItemizedPrompts(chatId) {
    try {
        if (!chatId) {
            return;
        }

        await promptStorage.setItem(chatId, itemizedPrompts);
    } catch (error) {
        console.error('Error saving itemized prompts for chat', chatId, error);
    }
}

/**
 * Replaces the itemized prompt text for a message.
 * @param {number} mesId Message ID to get itemized prompt for
 * @param {string} promptText New raw prompt text
 * @returns
 */
export async function replaceItemizedPromptText(mesId, promptText) {
    if (!Array.isArray(itemizedPrompts)) {
        itemizedPrompts = [];
    }

    const itemizedPrompt = itemizedPrompts.find(x => x.mesId === mesId);

    if (!itemizedPrompt) {
        return;
    }

    itemizedPrompt.rawPrompt = promptText;
}

/**
 * Deletes the itemized prompts for a chat.
 * @param {string} chatId Chat ID to delete itemized prompts for
 */
export async function deleteItemizedPrompts(chatId) {
    try {
        if (!chatId) {
            return;
        }

        await promptStorage.removeItem(chatId);
    } catch (error) {
        console.error('Error deleting itemized prompts for chat', chatId, error);
    }
}

/**
 * Empties the itemized prompts array and caches.
 */
export async function clearItemizedPrompts() {
    try {
        await promptStorage.clear();
        itemizedPrompts = [];
    } catch (error) {
        console.error('Error clearing itemized prompts', error);
    }
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getPercentage(value, total) {
    return total > 0 ? ((value / total) * 100).toFixed(2) : '0.00';
}

function buildWorldInfoPreview(content, maxLength = 240) {
    const normalized = String(content ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function formatHiddenWorldInfoPlaceholder(placement) {
    void placement;
    return '(hidden entry)';
}

function aggregatePromptInspectorWorldInfoEntries(entries = []) {
    const visibleEntries = [];
    const hiddenEntries = [];

    for (const entry of entries) {
        if (entry?.hidden) {
            hiddenEntries.push(entry);
        } else {
            visibleEntries.push(entry);
        }
    }

    if (!hiddenEntries.length) {
        return visibleEntries;
    }

    const hiddenCount = hiddenEntries.length;
    const hiddenTokens = hiddenEntries.reduce((total, entry) => total + toNumber(entry?.tokens), 0);
    const displayContent = t`${hiddenCount} hidden entries`;
    visibleEntries.push({
        book: '',
        displayName: t`Hidden entries (${hiddenCount})`,
        placement: '',
        metaText: t`hidden`,
        tokens: hiddenTokens,
        hidden: true,
        displayContent,
        previewContent: displayContent,
        isExpandable: false,
        isHiddenSummary: true,
    });

    return visibleEntries;
}

function getPromptWorldInfoEntries(itemizedPrompt, incomingMesId) {
    const messageWorldInfoReport = chat[incomingMesId]?.extra?.worldInfoReport;
    const rawWorldInfoEntries = Array.isArray(messageWorldInfoReport?.activatedEntries)
        ? messageWorldInfoReport.activatedEntries
        : itemizedPrompt?.serverAssemblyDebugDump?.assembly?.worldInfo?.activatedEntries;

    return Array.isArray(rawWorldInfoEntries)
        ? rawWorldInfoEntries.filter(entry => entry?.status === 'admitted')
        : [];
}

function buildWorldInfoPlacementRedactionMap(entries = []) {
    return entries.reduce((result, entry) => {
        const placement = String(entry?.placement || '').trim();
        if (!placement) {
            return result;
        }

        const text = entry?.hidden
            ? formatHiddenWorldInfoPlaceholder(placement)
            : String(entry?.displayContent ?? entry?.content ?? '').trim();

        if (!text) {
            return result;
        }

        result[placement] = result[placement] || [];
        result[placement].push(text);
        return result;
    }, {});
}

function flattenMessagesStateToRedactedPrompt(node, placementMap, depthPlacementQueue) {
    if (!node || typeof node !== 'object') {
        return [];
    }

    if (node.type === 'collection') {
        if (node.identifier === 'worldInfoBefore') {
            return placementMap.before || [];
        }
        if (node.identifier === 'worldInfoAfter') {
            return placementMap.after || [];
        }

        return Array.isArray(node.collection)
            ? node.collection.flatMap(child => flattenMessagesStateToRedactedPrompt(child, placementMap, depthPlacementQueue))
            : [];
    }

    if (node.type !== 'message') {
        return [];
    }

    if (node.injected && node.role === 'system' && depthPlacementQueue.length > 0) {
        const nextPlacement = depthPlacementQueue.shift();
        return placementMap[nextPlacement] || ['(hidden entry)'];
    }

    const content = String(node.content ?? '').trim();
    return content ? [content] : [];
}

function getRedactedRawPromptText(itemizedPrompt, incomingMesId) {
    const entries = getPromptWorldInfoEntries(itemizedPrompt, incomingMesId);
    const hasHiddenEntries = entries.some(entry => entry?.hidden);
    const rawPrompt = itemizedPrompt?.rawPrompt;

    if (!hasHiddenEntries) {
        return Array.isArray(rawPrompt) ? rawPrompt.map(x => x.content).join('\n') : String(rawPrompt ?? '');
    }

    const messagesState = itemizedPrompt?.serverAssemblyDebugDump?.assembly?.messagesState;
    if (!messagesState || typeof messagesState !== 'object') {
        return Array.isArray(rawPrompt) ? rawPrompt.map(x => x.content).join('\n') : String(rawPrompt ?? '');
    }

    const placementMap = buildWorldInfoPlacementRedactionMap(entries);
    const depthPlacementQueue = Object.keys(placementMap)
        .filter(key => key.startsWith('depth:'))
        .sort((a, b) => {
            const [aDepth = 0, aRole = 0] = a.split(':').slice(1).map(Number);
            const [bDepth = 0, bRole = 0] = b.split(':').slice(1).map(Number);
            return bDepth - aDepth || aRole - bRole;
        });

    return flattenMessagesStateToRedactedPrompt(messagesState, placementMap, depthPlacementQueue).join('\n');
}

export async function itemizedParams(itemizedPrompts, thisPromptSet, incomingMesId) {
    const itemizedPrompt = itemizedPrompts[thisPromptSet];
    if (!itemizedPrompt) {
        console.warn('itemizedPrompt not found at index', thisPromptSet);
        return null;
    }

    const serverItemization = itemizedPrompt.serverAssemblyDebugDump?.assembly?.itemization;
    const rawWorldInfoEntries = getPromptWorldInfoEntries(itemizedPrompt, incomingMesId);
    const params = {
        charDescriptionTokens: serverItemization ? toNumber(serverItemization.charDescriptionTokens) : await getTokenCountAsync(itemizedPrompt.charDescription),
        charPersonalityTokens: serverItemization ? toNumber(serverItemization.charPersonalityTokens) : await getTokenCountAsync(itemizedPrompt.charPersonality),
        scenarioTextTokens: serverItemization ? toNumber(serverItemization.scenarioTextTokens) : await getTokenCountAsync(itemizedPrompt.scenarioText),
        userPersonaStringTokens: serverItemization ? toNumber(serverItemization.userPersonaStringTokens) : await getTokenCountAsync(itemizedPrompt.userPersona),
        worldInfoStringTokens: serverItemization ? toNumber(serverItemization.worldInfoStringTokens) : await getTokenCountAsync(itemizedPrompt.worldInfoString),
        worldInfoDepthTokens: serverItemization ? toNumber(serverItemization.worldInfoDepthTokens) : await getTokenCountAsync(itemizedPrompt.chatSystemInjects),
        allAnchorsTokens: serverItemization ? toNumber(serverItemization.allAnchorsTokens) : await getTokenCountAsync(itemizedPrompt.allAnchors),
        summarizeStringTokens: serverItemization ? toNumber(serverItemization.summarizeStringTokens) : await getTokenCountAsync(itemizedPrompt.summarizeString),
        authorsNoteStringTokens: serverItemization ? toNumber(serverItemization.authorsNoteStringTokens) : await getTokenCountAsync(itemizedPrompt.authorsNoteString),
        smartContextStringTokens: serverItemization ? toNumber(serverItemization.smartContextStringTokens) : await getTokenCountAsync(itemizedPrompt.smartContextString),
        beforeScenarioAnchorTokens: serverItemization ? toNumber(serverItemization.beforeScenarioAnchorTokens) : await getTokenCountAsync(itemizedPrompt.beforeScenarioAnchor),
        afterScenarioAnchorTokens: serverItemization ? toNumber(serverItemization.afterScenarioAnchorTokens) : await getTokenCountAsync(itemizedPrompt.afterScenarioAnchor),
        zeroDepthAnchorTokens: await getTokenCountAsync(itemizedPrompt.zeroDepthAnchor), // TODO: unused
        thisPrompt_padding: itemizedPrompt.padding,
        this_main_api: itemizedPrompt.main_api,
        chatInjects: await getTokenCountAsync(itemizedPrompt.chatInjects),
        chatVectorsStringTokens: serverItemization ? toNumber(serverItemization.chatVectorsStringTokens) : await getTokenCountAsync(itemizedPrompt.chatVectorsString),
        dataBankVectorsStringTokens: serverItemization ? toNumber(serverItemization.dataBankVectorsStringTokens) : await getTokenCountAsync(itemizedPrompt.dataBankVectorsString),
        modelUsed: chat[incomingMesId]?.extra?.model,
        apiUsed: chat[incomingMesId]?.extra?.api,
        presetName: itemizedPrompt.presetName || t`(Unknown)`,
        messagesCount: String(itemizedPrompt.messagesCount ?? ''),
        examplesCount: String(itemizedPrompt.examplesCount ?? ''),
        worldInfoEntries: [],
    };
    const allWorldInfoEntries = rawWorldInfoEntries.map(entry => {
        const displayContent = String(entry?.displayContent ?? entry?.content ?? '');
        const previewContent = buildWorldInfoPreview(displayContent);
        const placement = entry?.placement || '';
        const hidden = Boolean(entry?.hidden);
        return {
            book: entry?.book || '',
            displayName: hidden ? t`Hidden entry` : (entry?.displayName || ''),
            placement,
            metaText: hidden
                ? (placement ? `${placement} | hidden` : 'hidden')
                : placement,
            tokens: toNumber(entry?.tokens),
            hidden,
            displayContent,
            previewContent,
            isExpandable: previewContent !== displayContent,
            isHiddenSummary: false,
        };
    });
    params.worldInfoEntries = aggregatePromptInspectorWorldInfoEntries(allWorldInfoEntries);
    params.hasWorldInfoEntries = params.worldInfoEntries.length > 0;
    params.hiddenWorldInfoTokens = allWorldInfoEntries
        .filter(entry => entry.hidden)
        .reduce((total, entry) => total + toNumber(entry.tokens), 0);
    params.visibleWorldInfoTokens = allWorldInfoEntries
        .filter(entry => !entry.hidden)
        .reduce((total, entry) => total + toNumber(entry.tokens), 0);

    const getFriendlyName = (value) => $(`#rm_api_block select option[value="${value}"]`).first().text() || value;

    if (params.apiUsed) {
        params.apiUsed = getFriendlyName(params.apiUsed);
    }

    if (params.this_main_api) {
        params.mainApiFriendlyName = getFriendlyName(params.this_main_api);
    }

    if (params.this_main_api == 'openai') {
        const oaiMaxContext = toNumber(oai_settings.openai_max_context);
        const oaiMaxTokens = toNumber(oai_settings.openai_max_tokens);

        //for OAI API
        //console.log('-- Counting OAI Tokens');
        if (serverItemization && itemizedPrompt.serverPromptAssembly) {
            params.oaiMainTokens = toNumber(serverItemization.oaiMainTokens);
            params.oaiStartTokens = toNumber(serverItemization.oaiStartTokens);
            params.ActualChatHistoryTokens = toNumber(serverItemization.oaiConversationTokens);
            params.examplesStringTokens = toNumber(serverItemization.oaiExamplesTokens);
            params.oaiPromptTokens = toNumber(serverItemization.oaiPromptTokens);
            params.oaiBiasTokens = toNumber(serverItemization.oaiBiasTokens);
            params.oaiJailbreakTokens = toNumber(serverItemization.oaiJailbreakTokens);
            params.oaiNudgeTokens = toNumber(serverItemization.oaiNudgeTokens);
            params.oaiImpersonateTokens = toNumber(serverItemization.oaiImpersonateTokens);
            params.oaiNsfwTokens = toNumber(serverItemization.oaiNsfwTokens);
            params.finalPromptTokens = toNumber(serverItemization.finalPromptTokens);
            params.thisPrompt_max_context = toNumber(serverItemization.maxContext) || (oaiMaxContext - oaiMaxTokens);
        } else {
            //params.finalPromptTokens = itemizedPrompts[thisPromptSet].oaiTotalTokens;
            params.oaiMainTokens = toNumber(itemizedPrompt.oaiMainTokens);
            params.oaiStartTokens = toNumber(itemizedPrompt.oaiStartTokens);
            params.ActualChatHistoryTokens = toNumber(itemizedPrompt.oaiConversationTokens);
            params.examplesStringTokens = toNumber(itemizedPrompt.oaiExamplesTokens);
            params.oaiBiasTokens = toNumber(itemizedPrompt.oaiBiasTokens);
            params.oaiJailbreakTokens = toNumber(itemizedPrompt.oaiJailbreakTokens);
            params.oaiNudgeTokens = toNumber(itemizedPrompt.oaiNudgeTokens);
            params.oaiImpersonateTokens = toNumber(itemizedPrompt.oaiImpersonateTokens);
            params.oaiNsfwTokens = toNumber(itemizedPrompt.oaiNsfwTokens);
            params.oaiPromptTokens = toNumber(itemizedPrompt.oaiPromptTokens) - (params.afterScenarioAnchorTokens + params.beforeScenarioAnchorTokens) + params.examplesStringTokens;
            params.finalPromptTokens =
                params.oaiStartTokens +
                params.oaiPromptTokens +
                params.oaiMainTokens +
                params.oaiNsfwTokens +
                params.oaiBiasTokens +
                params.oaiImpersonateTokens +
                params.oaiJailbreakTokens +
                params.oaiNudgeTokens +
                params.ActualChatHistoryTokens +
                params.worldInfoStringTokens +
                params.beforeScenarioAnchorTokens +
                params.afterScenarioAnchorTokens;
            params.thisPrompt_max_context = oaiMaxContext - oaiMaxTokens;
        }
        params.worldInfoTotalTokens = params.worldInfoStringTokens + params.worldInfoDepthTokens;

        params.oaiStartTokensPercentage = getPercentage(params.oaiStartTokens, params.finalPromptTokens);
        params.storyStringTokensPercentage = getPercentage(params.oaiPromptTokens, params.finalPromptTokens);
        params.ActualChatHistoryTokensPercentage = getPercentage(params.ActualChatHistoryTokens, params.finalPromptTokens);
        params.promptBiasTokensPercentage = getPercentage(params.oaiBiasTokens, params.finalPromptTokens);
        params.worldInfoTotalTokensPercentage = getPercentage(params.worldInfoTotalTokens, params.finalPromptTokens);
        params.worldInfoStringTokensPercentage = params.worldInfoTotalTokensPercentage;
        params.allAnchorsTokensPercentage = getPercentage(params.allAnchorsTokens, params.finalPromptTokens);
        params.selectedTokenizer = getFriendlyTokenizerName(params.this_main_api).tokenizerName;
        params.oaiSystemTokens = params.oaiImpersonateTokens + params.oaiJailbreakTokens + params.oaiNudgeTokens + params.oaiStartTokens + params.oaiNsfwTokens + params.oaiMainTokens;
        params.oaiSystemTokensPercentage = getPercentage(params.oaiSystemTokens, params.finalPromptTokens);
        params.hiddenPromptTokens = params.hiddenWorldInfoTokens;
        params.nonHiddenPromptTokens = Math.max(0, params.finalPromptTokens - params.hiddenPromptTokens);
    } else {
        //for non-OAI APIs
        //console.log('-- Counting non-OAI Tokens');
        params.finalPromptTokens = await getTokenCountAsync(itemizedPrompt.finalPrompt);
        params.storyStringTokens = await getTokenCountAsync(itemizedPrompt.storyString) - params.worldInfoStringTokens;
        params.examplesStringTokens = await getTokenCountAsync(itemizedPrompt.examplesString);
        params.mesSendStringTokens = await getTokenCountAsync(itemizedPrompt.mesSendString);
        params.ActualChatHistoryTokens = params.mesSendStringTokens - (params.allAnchorsTokens - (params.beforeScenarioAnchorTokens + params.afterScenarioAnchorTokens)) - params.worldInfoDepthTokens + power_user.token_padding;
        params.instructionTokens = await getTokenCountAsync(itemizedPrompt.instruction);
        params.promptBiasTokens = await getTokenCountAsync(itemizedPrompt.promptBias);
        params.worldInfoTotalTokens = params.worldInfoStringTokens + params.worldInfoDepthTokens;

        params.totalTokensInPrompt =
            params.storyStringTokens +     //chardefs total
            params.worldInfoTotalTokens +
            params.examplesStringTokens + // example messages
            params.ActualChatHistoryTokens +  //chat history
            params.allAnchorsTokens +      // AN and/or legacy anchors
            //afterScenarioAnchorTokens +       //only counts if AN is set to 'after scenario'
            //zeroDepthAnchorTokens +           //same as above, even if AN not on 0 depth
            params.promptBiasTokens;       //{{}}
        //- thisPrompt_padding;  //not sure this way of calculating is correct, but the math results in same value as 'finalPrompt'
        params.thisPrompt_max_context = itemizedPrompt.this_max_context;
        params.thisPrompt_actual = params.thisPrompt_max_context - params.thisPrompt_padding;

        //console.log('-- applying % on non-OAI tokens');
        params.storyStringTokensPercentage = getPercentage(params.storyStringTokens, params.totalTokensInPrompt);
        params.ActualChatHistoryTokensPercentage = getPercentage(params.ActualChatHistoryTokens, params.totalTokensInPrompt);
        params.promptBiasTokensPercentage = getPercentage(params.promptBiasTokens, params.totalTokensInPrompt);
        params.worldInfoTotalTokensPercentage = getPercentage(params.worldInfoTotalTokens, params.totalTokensInPrompt);
        params.worldInfoStringTokensPercentage = params.worldInfoTotalTokensPercentage;
        params.allAnchorsTokensPercentage = getPercentage(params.allAnchorsTokens, params.totalTokensInPrompt);
        params.selectedTokenizer = itemizedPrompt.tokenizer || getFriendlyTokenizerName(params.this_main_api).tokenizerName;
        params.hiddenPromptTokens = params.hiddenWorldInfoTokens;
        params.nonHiddenPromptTokens = Math.max(0, params.totalTokensInPrompt - params.hiddenPromptTokens);
    }
    return params;
}

export function findItemizedPromptSet(itemizedPrompts, incomingMesId) {
    let thisPromptSet = undefined;
    for (let i = 0; i < itemizedPrompts.length; i++) {
        console.log(`looking for ${incomingMesId} vs ${itemizedPrompts[i].mesId}`);
        if (itemizedPrompts[i].mesId === incomingMesId) {
            console.log(`found matching mesID ${i}`);
            thisPromptSet = i;
            PromptArrayItemForRawPromptDisplay = i;
            console.log(`wanting to raw display of ArrayItem: ${PromptArrayItemForRawPromptDisplay} which is mesID ${incomingMesId}`);
            console.log(itemizedPrompts[thisPromptSet]);
            break;
        } else if (itemizedPrompts[i].rawPrompt) {
            priorPromptArrayItemForRawPromptDisplay = i;
        }
    }
    return thisPromptSet;
}

function initializeWorldInfoEntryToggles(popup) {
    popup.dlg.querySelectorAll('.promptInspectorWorldInfoEntry').forEach((entry) => {
        if (!(entry instanceof HTMLElement)) {
            return;
        }

        const toggle = entry.querySelector('.promptInspectorWorldInfoToggle');
        if (!(toggle instanceof HTMLElement)) {
            return;
        }

        const setExpanded = (expanded) => {
            const label = expanded ? t`Hide entry` : t`Show entry`;
            entry.dataset.expanded = String(expanded);
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.setAttribute('aria-label', label);
            toggle.title = label;
            toggle.classList.toggle('fa-chevron-right', !expanded);
            toggle.classList.toggle('fa-chevron-down', expanded);
        };

        setExpanded(false);
        const toggleExpanded = () => {
            setExpanded(entry.dataset.expanded !== 'true');
        };

        toggle.addEventListener('click', toggleExpanded);
        toggle.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleExpanded();
            }
        });
    });
}

export async function promptItemize(itemizedPrompts, requestedMesId) {
    console.log('PROMPT ITEMIZE ENTERED');
    var incomingMesId = Number(requestedMesId);
    console.debug(`looking for MesId ${incomingMesId}`);
    var thisPromptSet = findItemizedPromptSet(itemizedPrompts, incomingMesId);

    if (thisPromptSet === undefined) {
        console.log(`couldnt find the right mesId. looked for ${incomingMesId}`);
        console.log(itemizedPrompts);
        return null;
    }

    const params = await itemizedParams(itemizedPrompts, thisPromptSet, incomingMesId);
    if (!params) {
        console.warn(`could not build itemized prompt params for mesId ${incomingMesId}`);
        return null;
    }
    const getPromptText = (promptIndex) => {
        const prompt = itemizedPrompts[promptIndex];
        return getRedactedRawPromptText(prompt, Number(prompt?.mesId ?? incomingMesId));
    };

    const template = params.this_main_api == 'openai'
        ? await renderTemplateAsync('itemizationChat', params)
        : await renderTemplateAsync('itemizationText', params);

    const popup = new Popup(template, POPUP_TYPE.TEXT, '', {
        wide: true,
        wider: true,
        allowVerticalScrolling: true,
        leftAlign: true,
    });

    initializeWorldInfoEntryToggles(popup);

    const currentPromptText = getPromptText(PromptArrayItemForRawPromptDisplay);
    const priorPromptText = priorPromptArrayItemForRawPromptDisplay !== undefined
        ? getPromptText(priorPromptArrayItemForRawPromptDisplay)
        : '';
    const hasCurrentPromptText = Boolean(currentPromptText.trim());
    const hasPriorPromptText = Boolean(priorPromptText.trim());

    /** @type {HTMLElement} */
    const diffPrevPrompt = popup.dlg.querySelector('#diffPrevPrompt');
    if (hasCurrentPromptText && hasPriorPromptText) {
        diffPrevPrompt.style.display = '';
        diffPrevPrompt.addEventListener('click', function () {
            const dmp = new DiffMatchPatch();
            const text1 = priorPromptText;
            const text2 = currentPromptText;

            dmp.Diff_Timeout = 2.0;

            const d = dmp.diff_main(text1, text2);
            let ds = dmp.diff_prettyHtml(d);
            // make it readable
            ds = ds.replaceAll('background:#e6ffe6;', 'background:#b9f3b9; color:black;');
            ds = ds.replaceAll('background:#ffe6e6;', 'background:#f5b4b4; color:black;');
            ds = ds.replaceAll('&para;', '');
            const container = document.createElement('div');
            container.innerHTML = DOMPurify.sanitize(ds);
            const rawPromptWrapper = document.getElementById('rawPromptWrapper');
            rawPromptWrapper.replaceChildren(container);
            $('#rawPromptPopup').slideToggle();
        });
    } else {
        diffPrevPrompt.style.display = 'none';
    }
    const copyPromptToClipboard = popup.dlg.querySelector('#copyPromptToClipboard');
    if (hasCurrentPromptText) {
        copyPromptToClipboard.addEventListener('pointerup', async function () {
            await copyText(currentPromptText);
            toastr.info(t`Copied!`);
        });
    } else {
        copyPromptToClipboard.style.display = 'none';
    }

    const showRawPrompt = popup.dlg.querySelector('#showRawPrompt');
    if (hasCurrentPromptText) {
        showRawPrompt.addEventListener('click', async function () {
        //console.log(itemizedPrompts[PromptArrayItemForRawPromptDisplay].rawPrompt);
        console.log(PromptArrayItemForRawPromptDisplay);
        console.log(itemizedPrompts);
        console.log(itemizedPrompts[PromptArrayItemForRawPromptDisplay].rawPrompt);
        const rawPrompt = currentPromptText;

        // Mobile needs special handholding. The side-view on the popup wouldn't work,
        // so we just show an additional popup for this.
        if (isMobile()) {
            const content = document.createElement('div');
            content.classList.add('tokenItemizingMaintext');
            content.innerText = rawPrompt;
            const popup = new Popup(content, POPUP_TYPE.TEXT, null, { allowVerticalScrolling: true, leftAlign: true });
            await popup.show();
            return;
        }

        //let DisplayStringifiedPrompt = JSON.stringify(itemizedPrompts[PromptArrayItemForRawPromptDisplay].rawPrompt).replace(/\n+/g, '<br>');
        const rawPromptWrapper = document.getElementById('rawPromptWrapper');
        rawPromptWrapper.innerText = rawPrompt;
        $('#rawPromptPopup').slideToggle();
        });
    } else {
        showRawPrompt.style.display = 'none';
    }

    await popup.show();
}

export function initItemizedPrompts() {
    registerDebugFunction('clearPrompts', 'Delete itemized prompts', 'Deletes all itemized prompts from the local storage.', async () => {
        await clearItemizedPrompts();
        toastr.info('Itemized prompts deleted.');
        if (getCurrentChatId()) {
            await reloadCurrentChat();
        }
    });

    $(document).on('pointerup', '.mes_prompt', async function () {
        let mesIdForItemization = $(this).closest('.mes').attr('mesId');
        console.log(`looking for mesID: ${mesIdForItemization}`);
        if (itemizedPrompts.length !== undefined && itemizedPrompts.length !== 0) {
            const itemizedPrompt = itemizedPrompts.find(x => Number(x.mesId) === Number(mesIdForItemization));
            if (itemizedPrompt?.serverPromptAssembly && !itemizedPrompt?.serverAssemblyDebugDump?.assembly?.itemization) {
                if (typeof globalThis.SillyTavern?.storeLastServerDispatchSnapshotToPrompt === 'function') {
                    try {
                        await globalThis.SillyTavern.storeLastServerDispatchSnapshotToPrompt(Number(mesIdForItemization));
                    } catch (error) {
                        console.error('Failed to attach last server dispatch snapshot to prompt record', error);
                    }
                }

                if (!itemizedPrompt?.serverAssemblyDebugDump?.assembly?.itemization && typeof globalThis.SillyTavern?.debugServerAssembly === 'function') {
                    try {
                        await globalThis.SillyTavern.debugServerAssembly();
                    } catch (error) {
                        console.error('Failed to refresh server prompt assembly debug dump', error);
                    }
                }
            }
            await promptItemize(itemizedPrompts, mesIdForItemization);
        }
    });

    eventSource.on(event_types.CHAT_DELETED, async (name) => {
        await deleteItemizedPrompts(name);
    });
    eventSource.on(event_types.GROUP_CHAT_DELETED, async (name) => {
        await deleteItemizedPrompts(name);
    });
}
