import { DOMPurify } from '../lib.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { generateStmbText, createStmbEntry, updateStmbEntryByUid } from './stmb-api.js';
import { applyClipReviewSuggestion, isClipEntryTitle, showTopicalClipPopup } from './stmb-clips.js';
import {
    CLIP_REVIEW_ENTRY_TITLE,
    CLIP_REVIEW_METADATA_KEY,
    CLIP_REVIEW_TEMPLATE_KEY,
    LEGACY_CLIP_REVIEW_ENTRY_TITLE,
    MEMORY_ASSISTANCE_MODE_AUTOMATIC,
    MEMORY_ASSISTANCE_MODE_OFF,
    MEMORY_ASSISTANCE_MODE_UPDATE_AND_SUGGEST,
    applyAutomaticClipReviewCandidates,
    classifyMemoryAssistanceOutcome,
    makeClipReviewRecord,
    normalizeMemoryAssistanceMode,
    packClipReviewBatches,
    parseClipReviewResponse,
    parseClipSuggestionsResponse,
    rebuildOrdinaryClipAdditions,
    renderClipReviewReport,
} from './stmb-clip-review-policy.js';
import { compiledSceneToText } from './stmb-core.js';
import { awaitStmbJobApproval, registerStmbJobExecutor } from './stmb-jobs.js';
import { getTemplate } from './stmb-sideprompts-manager.js';
import { escapeHtml, withGoBackButton } from './utils.js';
import {
    getLorebookStorageForRequest,
    isReservedTemplateWorldName,
    loadWorldInfo,
    world_names,
    worldInfoCache,
} from './world-info.js';

let runtime = {};

/** Configures UI and generation dependencies supplied by the core STMB runtime. */
export function configureStmbClipReviewRuntime(nextRuntime = {}) {
    runtime = { ...runtime, ...nextRuntime };
}

function tr(fallback, key = fallback) {
    return runtime.translate?.(fallback, key) || fallback;
}

function getClipEntries(lorebookData) {
    return Object.values(lorebookData?.entries || {})
        .filter(entry => isClipEntryTitle(entry?.comment || ''))
        .sort((left, right) => String(left.comment || '').localeCompare(String(right.comment || '')));
}

function findEntryByTitle(lorebookData, title) {
    return Object.values(lorebookData?.entries || {})
        .find(entry => String(entry?.comment || '') === String(title || '')) || null;
}

function findReportEntry(lorebookData) {
    return findEntryByTitle(lorebookData, CLIP_REVIEW_ENTRY_TITLE)
        || findEntryByTitle(lorebookData, LEGACY_CLIP_REVIEW_ENTRY_TITLE);
}

function buildReviewPrompt(instructions, compiledScene, records) {
    const promptRecords = records.map(({ uid, type, title, topic, keywords, content }) => ({ uid, type, title, topic, keywords, content }));
    return `${instructions}

=== NEW SCENE ===
${compiledSceneToText(compiledScene)}

=== EXISTING CLIPS ===
${JSON.stringify(promptRecords, null, 2)}

=== REQUIRED JSON RESPONSE ===
${tr(`Return one JSON object that maps each Clip UID needing an update to one suggestion string.
For an ordinary Clip, the string must be one exact excerpt copied from a single message in NEW SCENE.
For a Topical Clip, the string must be the complete revised Clip body.
Omit Clips that do not need an update. If no Clips need an update, return {}.
Return only JSON. Do not return an array, Markdown fence, reason, message ID, or explanation.`, 'STMemoryBooks_ClipReview_ResponseContract')}`;
}

function buildTopicPrompt(instructions, compiledScene, records) {
    const existing = records
        .filter(record => record.type === 'topical')
        .map(({ title, topic, keywords }) => ({ title, topic, keywords }));
    return `${instructions}

=== NEW SCENE ===
${compiledSceneToText(compiledScene)}

=== EXISTING TOPICAL CLIPS ===
${JSON.stringify(existing, null, 2)}

=== REQUIRED JSON RESPONSE ===
${tr(`Return one JSON object with a "topics" array containing zero to five new Topical Clip suggestions.
Each item must contain "topic" as a non-empty string and "keywords" as an array of activation-keyword strings.
If no new topics are needed, return {"topics":[]}.
Return only JSON. Do not return Markdown fences, reasons, message IDs, or explanations.`, 'STMemoryBooks_ClipSuggestions_ResponseContract')}`;
}

async function requestText(prompt, profile, signal) {
    if (typeof runtime.buildGenerateData !== 'function') throw new Error('STMB Memory Assistance generation is not configured.');
    const generateData = await runtime.buildGenerateData([{ role: 'user', content: prompt }], profile || null);
    return String((await generateStmbText({ generateData }, { signal }))?.text || '').trim();
}

function buildMessageSource(compiledScene) {
    return {
        chat_id: String(compiledScene?.metadata?.chatId || ''),
        start: compiledScene?.metadata?.sceneStart ?? null,
        end: compiledScene?.metadata?.sceneEnd ?? null,
        scene_start_uuid: String(compiledScene?.metadata?.sceneStartUuid || ''),
        scene_end_uuid: String(compiledScene?.metadata?.sceneEndUuid || ''),
    };
}

async function saveReport(lorebookName, compiledScene, candidates, status, details = {}, options = {}) {
    const sceneStart = compiledScene?.metadata?.sceneStart ?? 0;
    const sceneEnd = compiledScene?.metadata?.sceneEnd ?? 0;
    const metadata = {
        version: 2,
        status,
        generatedAt: new Date().toISOString(),
        chatId: String(compiledScene?.metadata?.chatId || ''),
        sceneStart,
        sceneEnd,
        sceneStartUuid: String(compiledScene?.metadata?.sceneStartUuid || ''),
        sceneEndUuid: String(compiledScene?.metadata?.sceneEndUuid || ''),
        candidates,
        ...details,
    };
    const content = renderClipReviewReport({ sceneStart, sceneEnd, candidates, status, ...details });
    const fresh = await loadWorldInfo(lorebookName);
    if (!fresh?.entries) throw new Error('Memory Assistance report target is unavailable.');
    const existing = findReportEntry(fresh);
    const currentReportHash = existing ? makeClipReviewRecord(existing).contentHash : '';
    if ((options.expectMissing === true && existing)
        || (options.expectedReportHash && currentReportHash !== options.expectedReportHash)) {
        const error = new Error('The Memory Assistance report changed. Reload suggestions and try again.');
        error.code = 'CLIP_REVIEW_REPORT_CHANGED';
        throw error;
    }
    if (existing) {
        await updateStmbEntryByUid({
            lorebookName,
            storage: 'user',
            uid: existing.uid,
            title: CLIP_REVIEW_ENTRY_TITLE,
            content,
            expectedContentHash: currentReportHash,
            metadataUpdates: { [CLIP_REVIEW_METADATA_KEY]: metadata },
            entryOverrides: { disable: true, constant: false, vectorized: false, selective: true, preventRecursion: true, delayUntilRecursion: false },
        });
        worldInfoCache.delete(lorebookName);
        return;
    }
    await createStmbEntry({
        lorebookName,
        storage: 'user',
        title: CLIP_REVIEW_ENTRY_TITLE,
        content,
        metadataUpdates: { [CLIP_REVIEW_METADATA_KEY]: metadata },
        defaults: { vectorized: false, selective: true, order: 20, position: 0 },
        entryOverrides: { disable: true, constant: false, vectorized: false, selective: true, preventRecursion: true, delayUntilRecursion: false },
    });
    worldInfoCache.delete(lorebookName);
}

async function selectRecords(context, records, mode) {
    if (mode === MEMORY_ASSISTANCE_MODE_AUTOMATIC || records.length <= 5) return records;
    const response = await awaitStmbJobApproval(context, {
        kind: 'memoryAssistanceSelection',
        records: records.map(record => ({
            uid: record.uid,
            title: record.title,
            type: record.type,
            topic: record.topic,
            keywords: record.keywords,
            estimatedTokens: Math.ceil(record.content.length / 4),
        })),
    }, { detail: tr('Choose Clips to review', 'STMemoryBooks_ClipReview_SelectTitle') });
    if (!response || ['cancel', 'reject'].includes(response.decision)) return null;
    const selectedUids = new Set((response.editedData?.selectedUids || []).map(String));
    if (response.editedData?.selectAll === true) return records;
    return records.filter(record => selectedUids.has(record.uid));
}

async function allowOversizedBatch(context, estimatedTokens, threshold) {
    if (estimatedTokens <= threshold) return true;
    const response = await awaitStmbJobApproval(context, {
        kind: 'memoryAssistanceTokenWarning',
        estimatedTokens,
        threshold,
    }, { detail: tr('Memory Assistance token warning', 'STMemoryBooks_ClipReview_TokenWarningTitle') });
    return response?.decision === 'approve';
}

async function executeMemoryAssistanceJob(job, context) {
    const payload = job?.payload || {};
    const lorebookName = String(job?.lorebookName || payload.lorebookName || '').trim();
    const compiledScene = payload.compiledScene;
    const mode = normalizeMemoryAssistanceMode(payload.mode);
    if (!lorebookName || !compiledScene || !Array.isArray(compiledScene.messages)) {
        throw new Error(tr('Failed to run Memory Assistance.', 'STMemoryBooks_ClipReview_CommandFailed'));
    }
    if (mode === MEMORY_ASSISTANCE_MODE_OFF) {
        context.setResult({ type: 'memoryAssistance', status: 'skipped_off' });
        context.patch({ state: 'skipped', detail: tr('Memory Assistance is off. Choose a mode before running it.', 'STMemoryBooks_ClipReview_CommandOff') });
        return;
    }
    if (getLorebookStorageForRequest(lorebookName) !== 'user') {
        context.setResult({ type: 'memoryAssistance', status: 'skipped_secure' });
        context.patch({ state: 'skipped', detail: tr('Memory Assistance skipped this protected Memory Book.', 'STMemoryBooks_ClipReview_SkippedProtected') });
        return;
    }

    context.setState('assembling_prompt', { detail: tr('Memory Assistance', 'STMemoryBooks_ClipReview_Name') });
    const lorebookData = await loadWorldInfo(lorebookName);
    if (!lorebookData?.entries) {
        throw new Error(tr('Memory Assistance could not load its target Memory Book.', 'STMemoryBooks_ClipReview_TargetUnavailable'));
    }
    const priorReportEntry = findReportEntry(lorebookData);
    const priorReportHash = priorReportEntry ? makeClipReviewRecord(priorReportEntry).contentHash : '';
    const records = getClipEntries(lorebookData).map(makeClipReviewRecord);
    const suggestTopics = mode === MEMORY_ASSISTANCE_MODE_UPDATE_AND_SUGGEST;
    if (records.length === 0 && !suggestTopics) {
        if (priorReportEntry) {
            await saveReport(lorebookName, compiledScene, [], 'complete', {}, { expectedReportHash: priorReportHash });
        }
        context.setResult({ type: 'memoryAssistance', status: 'complete', candidateCount: 0 });
        return;
    }
    const selected = await selectRecords(context, records, mode);
    if (selected === null) {
        context.patch({ state: 'canceled', detail: tr('Cancel', 'STMemoryBooks_Cancel') });
        return;
    }
    const template = await getTemplate(CLIP_REVIEW_TEMPLATE_KEY);
    if (!String(template?.prompt || '').trim()) throw new Error('The Memory Assistance prompt is missing.');
    const profile = template.settings?.overrideProfileEnabled
        ? runtime.getProfile?.(Number(template.settings.overrideProfileIndex)) || payload.profile
        : payload.profile;

    let topicSuggestions = [];
    let suggestionPassSucceeded = !suggestTopics;
    let suggestionPassCompleted = false;
    let suggestionPassFailed = false;
    let suggestionPassDeclined = false;
    const threshold = Math.max(1000, Number(payload.tokenWarningThreshold) || 50000);
    if (suggestTopics) {
        try {
            context.setState('generating', { detail: tr('Review Topics', 'STMemoryBooks_ClipSuggestions_Review') });
            const topicPrompt = String(template.settings?.suggestionsPrompt || '').trim();
            if (!topicPrompt) throw new Error('The Memory Assistance topic suggestions prompt is missing.');
            const finalPrompt = buildTopicPrompt(topicPrompt, compiledScene, records);
            const allowed = await allowOversizedBatch(context, Math.ceil(finalPrompt.length / 4) + 400, threshold);
            if (allowed) {
                topicSuggestions = parseClipSuggestionsResponse(await requestText(finalPrompt, profile, context.signal), records);
                suggestionPassSucceeded = true;
                suggestionPassCompleted = true;
            } else {
                suggestionPassDeclined = true;
            }
        } catch (error) {
            if (context.signal?.aborted) throw error;
            suggestionPassFailed = true;
        }
    }

    const batches = packClipReviewBatches(selected, compiledSceneToText(compiledScene), threshold);
    const candidates = [];
    let failedBatchCount = 0;
    let declinedBatchCount = 0;
    for (const batch of batches) {
        try {
            context.setState('generating', { detail: tr('Memory Assistance', 'STMemoryBooks_ClipReview_Name') });
            const finalPrompt = buildReviewPrompt(template.prompt, compiledScene, batch);
            if (mode !== MEMORY_ASSISTANCE_MODE_AUTOMATIC
                && !await allowOversizedBatch(context, Math.ceil(finalPrompt.length / 4) + 800, threshold)) {
                declinedBatchCount++;
                continue;
            }
            candidates.push(...parseClipReviewResponse(await requestText(finalPrompt, profile, context.signal), batch, compiledScene.messages));
        } catch (error) {
            if (context.signal?.aborted) throw error;
            failedBatchCount++;
        }
    }
    const messageSource = buildMessageSource(compiledScene);
    for (const candidate of candidates) candidate.messageSource = messageSource;
    let outcome = classifyMemoryAssistanceOutcome({
        batchCount: batches.length,
        failedBatchCount,
        declinedBatchCount,
        suggestionPassRequested: suggestTopics,
        suggestionPassSucceeded,
        suggestionPassFailed,
        suggestionPassDeclined,
    });
    if (outcome.preserveReport) {
        const status = outcome.terminalState === 'failed' ? 'failed_preserved' : 'canceled_preserved';
        context.setResult({
            type: 'memoryAssistance',
            status,
            mode,
            candidateCount: 0,
            failedBatchCount,
            declinedBatchCount,
            suggestionPassFailed,
            suggestionPassDeclined,
        });
        if (outcome.terminalState === 'failed') {
            throw new Error(tr('A Memory Assistance batch failed.', 'STMemoryBooks_ClipReview_BatchFailed'));
        }
        context.patch({ state: 'canceled', detail: tr('Cancel', 'STMemoryBooks_Cancel') });
        return;
    }

    let pendingCandidates = candidates;
    let appliedCount = 0;
    let failedCount = 0;
    let reviewCount = 0;
    let status = outcome.reportStatus;
    if (mode === MEMORY_ASSISTANCE_MODE_AUTOMATIC) {
        ({ pendingCandidates, appliedCount, failedCount, reviewCount } = await applyAutomaticClipReviewCandidates(
            candidates,
            candidate => applyClipReviewSuggestion(lorebookName, candidate, { deferLongEntryToReview: true }),
            {
                signal: context.signal,
                applyError: tr('Failed to apply the Clip suggestion.', 'STMemoryBooks_ClipReview_ApplyFailed'),
                onFailure: error => console.warn('STMB Memory Assistance automatic apply failed', error),
            },
        ));
        outcome = classifyMemoryAssistanceOutcome({
            batchCount: batches.length,
            failedBatchCount,
            declinedBatchCount,
            suggestionPassRequested: suggestTopics,
            suggestionPassSucceeded,
            suggestionPassFailed,
            suggestionPassDeclined,
            applyFailedCount: failedCount,
            automatic: true,
        });
        status = outcome.reportStatus;
    }

    context.setState('saving', { detail: tr('Memory Assistance', 'STMemoryBooks_ClipReview_Name') });
    await saveReport(lorebookName, compiledScene, pendingCandidates, status, {
        appliedCount,
        failedCount,
        reviewCount,
        failedBatchCount,
        declinedBatchCount,
        topicSuggestions,
        suggestionPassCompleted,
        suggestionPassFailed,
        suggestionPassDeclined,
    }, {
        expectedReportHash: priorReportHash,
        expectMissing: !priorReportEntry,
    });
    context.setResult({
        type: 'memoryAssistance',
        status,
        mode,
        candidateCount: pendingCandidates.length,
        topicSuggestionCount: topicSuggestions.length,
        appliedCount,
        failedCount,
        reviewCount,
        failedBatchCount,
        declinedBatchCount,
        suggestionPassFailed,
        suggestionPassDeclined,
    });
    if (outcome.terminalState === 'failed') {
        throw new Error(tr('A Memory Assistance batch failed.', 'STMemoryBooks_ClipReview_BatchFailed'));
    }
}

/** Builds dependent Memory Assistance jobs without reading Clip content into the queue payload. */
export function buildQueuedMemoryAssistanceJobs({ lorebookNames, compiledScene, range, profile, sceneContext, settings } = {}) {
    const moduleSettings = settings?.moduleSettings || settings || {};
    const mode = normalizeMemoryAssistanceMode(moduleSettings.memoryAssistanceMode, moduleSettings.clipReviewAlwaysAfterMemory === true);
    if (mode === MEMORY_ASSISTANCE_MODE_OFF) return [];
    const names = [...new Set((lorebookNames || []).map(name => String(name || '').trim()).filter(Boolean))];
    return names
        .filter(name => getLorebookStorageForRequest(name) === 'user')
        .map((lorebookName, index) => ({
            type: 'memoryAssistance',
            range,
            lorebookName,
            sceneContext,
            characterName: compiledScene?.metadata?.characterName || '',
            chatTitle: compiledScene?.metadata?.chatId || '',
            payload: {
                lorebookName,
                compiledScene,
                profile,
                mode,
                trigger: 'onAfterMemory',
                tokenWarningThreshold: moduleSettings.tokenWarningThreshold,
                targetOrder: index,
            },
        }));
}

function getSelectableReviewLorebooks() {
    return (Array.isArray(world_names) ? world_names : [])
        .filter(name => !isReservedTemplateWorldName(name) && getLorebookStorageForRequest(name) === 'user');
}

async function persistRemainingReport(lorebookName, metadata, expectedReportHash) {
    await saveReport(lorebookName, {
        metadata: {
            chatId: metadata.chatId,
            sceneStart: metadata.sceneStart,
            sceneEnd: metadata.sceneEnd,
            sceneStartUuid: metadata.sceneStartUuid,
            sceneEndUuid: metadata.sceneEndUuid,
        },
    }, metadata.candidates || [], metadata.status || 'complete', {
        appliedCount: Number(metadata.appliedCount || 0),
        failedCount: Number(metadata.failedCount || 0),
        reviewCount: Number(metadata.reviewCount || 0),
        failedBatchCount: Number(metadata.failedBatchCount || 0),
        declinedBatchCount: Number(metadata.declinedBatchCount || 0),
        topicSuggestions: Array.isArray(metadata.topicSuggestions) ? metadata.topicSuggestions : [],
        suggestionPassCompleted: metadata.suggestionPassCompleted === true,
        suggestionPassFailed: metadata.suggestionPassFailed === true,
        suggestionPassDeclined: metadata.suggestionPassDeclined === true,
    }, { expectedReportHash });
}

/** Opens the persisted Memory Assistance review and topic-draft workflow. */
export async function showClipReviewSuggestionsPopup(options = {}) {
    const names = getSelectableReviewLorebooks();
    if (names.length === 0) {
        toastr.error(tr('No Memory Books were found.', 'STMemoryBooks_Compaction_NoLorebooks'), 'STMB');
        return;
    }
    const bookOptions = ['<option></option>', ...names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)].join('');
    const popupOptions = { wide: true, large: true, allowVerticalScrolling: true, okButton: false, cancelButton: tr('Close', 'STMemoryBooks_Close') };
    const popup = new Popup(DOMPurify.sanitize(`
        <h3 data-i18n="STMemoryBooks_ClipReview_SuggestionsTitle">${escapeHtml(tr('Memory Assistance Suggestions', 'STMemoryBooks_ClipReview_SuggestionsTitle'))}</h3>
        <select id="stmb-clip-review-book" class="text_pole">${bookOptions}</select>
        <div id="stmb-clip-review-suggestions" class="world_entry_form_control"></div>
    `), POPUP_TYPE.TEXT, '', options.showGoBack ? withGoBackButton(popupOptions) : popupOptions);
    const showPromise = popup.show();
    let lorebookName = '';
    let lorebookData = null;
    let metadata = null;
    let reportExpectedHash = '';
    const container = () => popup.dlg?.querySelector('#stmb-clip-review-suggestions');
    const render = () => {
        const target = container();
        if (!target) return;
        const topics = Array.isArray(metadata?.topicSuggestions) ? metadata.topicSuggestions : [];
        const candidates = Array.isArray(metadata?.candidates) ? metadata.candidates : [];
        const topicRows = topics.length > 0
            ? topics.map(item => `<div class="stmb-clip-topic-row" data-topic-id="${escapeHtml(item.id)}"><label>${escapeHtml(tr('Topic', 'STMemoryBooks_TopicalClip_Topic'))}<input class="text_pole stmb-clip-topic-name" value="${escapeHtml(item.topic)}"></label><label>${escapeHtml(tr('Keywords', 'STMemoryBooks_TopicalClip_Keywords'))}<input class="text_pole stmb-clip-topic-keywords" value="${escapeHtml((item.keywords || []).join(', '))}"></label><div class="buttons_block gap10px"><button type="button" class="menu_button stmb-clip-topic-create">${escapeHtml(tr('Create this Topical Clip', 'STMemoryBooks_ClipSuggestions_Include'))}</button><button type="button" class="menu_button stmb-clip-topic-dismiss">${escapeHtml(tr('Dismiss', 'STMemoryBooks_ClipReview_Dismiss'))}</button></div></div>`).join('')
            : `<p>${escapeHtml(tr('No new topics were suggested. You can add one manually.', 'STMemoryBooks_ClipSuggestions_None'))}</p>`;
        const topicHtml = metadata?.suggestionPassCompleted || topics.length ? `<section class="info_block marginTop10"><h4>${escapeHtml(tr('Suggested New Topical Clips', 'STMemoryBooks_ClipSuggestions_Title'))}</h4><p>${escapeHtml(tr('Choose topics to turn into Topical Clip drafts. You can edit suggestions or add your own topics.', 'STMemoryBooks_ClipSuggestions_Description'))}</p>${topicRows}<button type="button" class="menu_button stmb-clip-topic-add">${escapeHtml(tr('Add Topic', 'STMemoryBooks_ClipSuggestions_Add'))}</button></section>` : '';
        const candidateHtml = candidates.map(candidate => {
            const currentEntry = Object.values(lorebookData?.entries || {}).find(entry => String(entry?.uid) === String(candidate.uid));
            const suggestion = candidate.type === 'ordinary' ? (candidate.additions || []).map(item => item.text).join('\n') : candidate.proposedContent;
            return `<section class="info_block marginTop10" data-clip-review-uid="${escapeHtml(candidate.uid)}"><h4>${escapeHtml(candidate.title)}</h4>${candidate.applyError ? `<p class="redWarning">${escapeHtml(candidate.applyError)}</p>` : ''}${candidate.reviewReason ? `<p class="warning">${escapeHtml(candidate.reviewReason)}</p>` : ''}<h5>${escapeHtml(tr('Current entry content', 'STMemoryBooks_Clip_CurrentContent'))}</h5><textarea class="text_pole" rows="5" readonly>${escapeHtml(currentEntry?.content || '')}</textarea><h5>${escapeHtml(tr('Suggested edit', 'STMemoryBooks_ClipReview_SuggestedEdit'))}</h5><textarea class="text_pole stmb-clip-review-draft" rows="6">${escapeHtml(suggestion || '')}</textarea><div class="buttons_block gap10px"><button type="button" class="menu_button stmb-clip-review-apply">${escapeHtml(tr('Apply', 'STMemoryBooks_ClipReview_Apply'))}</button><button type="button" class="menu_button stmb-clip-review-dismiss">${escapeHtml(tr('Dismiss', 'STMemoryBooks_ClipReview_Dismiss'))}</button></div></section>`;
        }).join('');
        target.innerHTML = topicHtml || candidateHtml ? `${topicHtml}${candidateHtml}` : `<div class="opacity70p">${escapeHtml(tr('There are no current Memory Assistance suggestions.', 'STMemoryBooks_ClipReview_NoSuggestions'))}</div>`;
    };
    const load = async name => {
        lorebookName = String(name || '');
        lorebookData = lorebookName ? await loadWorldInfo(lorebookName) : null;
        const reportEntry = findReportEntry(lorebookData);
        metadata = reportEntry?.[CLIP_REVIEW_METADATA_KEY] || null;
        reportExpectedHash = reportEntry ? makeClipReviewRecord(reportEntry).contentHash : '';
        render();
    };
    popup.dlg?.querySelector('#stmb-clip-review-book')?.addEventListener('change', event => { void load(event.target.value); });
    container()?.addEventListener('click', async event => {
        try {
            if (event.target.closest('.stmb-clip-topic-add')) {
                metadata.topicSuggestions = Array.isArray(metadata.topicSuggestions) ? metadata.topicSuggestions : [];
                metadata.topicSuggestions.push({ id: `topic-manual-${Date.now().toString(36)}`, topic: '', keywords: [] });
                await persistRemainingReport(lorebookName, metadata, reportExpectedHash);
                await load(lorebookName);
                return;
            }
            const topicRow = event.target.closest('.stmb-clip-topic-row');
            if (topicRow) {
                const suggestion = metadata?.topicSuggestions?.find(item => item.id === topicRow.dataset.topicId);
                if (!suggestion) return;
                if (event.target.closest('.stmb-clip-topic-create')) {
                    const topic = String(topicRow.querySelector('.stmb-clip-topic-name')?.value || '').replace(/\s+/g, ' ').trim();
                    const keywords = String(topicRow.querySelector('.stmb-clip-topic-keywords')?.value || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
                    if (!topic) return;
                    const saved = await showTopicalClipPopup({ lorebookName, topic, keywords: keywords.length ? keywords : [topic] });
                    if (!saved) return;
                } else if (!event.target.closest('.stmb-clip-topic-dismiss')) return;
                metadata.topicSuggestions = metadata.topicSuggestions.filter(item => item.id !== suggestion.id);
                await persistRemainingReport(lorebookName, metadata, reportExpectedHash);
                await load(lorebookName);
                return;
            }
            const section = event.target.closest('[data-clip-review-uid]');
            if (!section) return;
            const candidate = metadata?.candidates?.find(item => String(item.uid) === String(section.dataset.clipReviewUid));
            if (!candidate) return;
            if (event.target.closest('.stmb-clip-review-apply')) {
                const edited = String(section.querySelector('.stmb-clip-review-draft')?.value || '').trim();
                if (candidate.type === 'ordinary') candidate.additions = rebuildOrdinaryClipAdditions(candidate, edited);
                else candidate.proposedContent = edited;
                if (!await applyClipReviewSuggestion(lorebookName, candidate)) return;
            } else if (!event.target.closest('.stmb-clip-review-dismiss')) return;
            metadata.candidates = metadata.candidates.filter(item => String(item.uid) !== String(candidate.uid));
            if (metadata.status === 'automatic') {
                metadata.failedCount = metadata.candidates.filter(item => Boolean(item.applyError)).length;
                metadata.reviewCount = metadata.candidates.filter(item => !item.applyError).length;
            }
            await persistRemainingReport(lorebookName, metadata, reportExpectedHash);
            await load(lorebookName);
        } catch (error) {
            console.error('STMB Memory Assistance suggestion action failed', error);
            toastr.error(error?.message || tr('Failed to apply the Clip suggestion.', 'STMemoryBooks_ClipReview_ApplyFailed'), 'STMB');
            if (error?.code === 'CLIP_REVIEW_REPORT_CHANGED') await load(lorebookName);
        }
    });
    const select = popup.dlg?.querySelector('#stmb-clip-review-book');
    if (select && names[0]) {
        select.value = names[0];
        await load(names[0]);
    }
    await showPromise;
}

registerStmbJobExecutor('memoryAssistance', executeMemoryAssistanceJob);
