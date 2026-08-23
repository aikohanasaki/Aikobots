import { t, translate } from './i18n.js';
import { getRequestHeaders, messageFormatting, refreshCsrfToken, sanitizeMessageHtml } from '../script.js';
import { POPUP_RESULT, POPUP_TYPE, Popup, callGenericPopup } from './popup.js';
import { renderTemplateAsync } from './templates.js';
import { ensureImageFormatSupported, getBase64Async, humanFileSize } from './utils.js';

/**
 * @type {import('../../src/users.js').UserViewModel} Logged in user
 */
export let currentUser = null;
export let accountsEnabled = false;

// Extend the session every 10 minutes
const SESSION_EXTEND_INTERVAL = 10 * 60 * 1000;
const MESSAGE_SUMMARY_INTERVAL = 60 * 1000;
const SUBMISSION_DISTRIBUTION_MODES = Object.freeze({
    WHITELIST: 'whitelist',
    GLOBAL: 'global',
    GLOBAL_BLACKLIST: 'global_blacklist',
});

/**
 * Enable or disable user account controls in the UI.
 * @param {boolean} isEnabled User account controls enabled
 * @returns {Promise<void>}
 */
export async function setUserControls(isEnabled) {
    accountsEnabled = isEnabled;

    if (!isEnabled) {
        $('#logout_button').hide();
        $('#admin_button').hide();
        $('#messages_button').hide();
        setMessagesBadge(false);
        return;
    }

    $('#logout_button').show();
    await getCurrentUser();
}

/**
 * Check if the current user is an admin.
 * @returns {boolean} True if the current user is an admin
 */
export function isAdmin() {
    if (!accountsEnabled) {
        return true;
    }

    if (!currentUser) {
        return false;
    }

    return Boolean(currentUser.admin);
}

/** Returns whether the current account can use patron features. */
export function isPatron() {
    return isAdmin() || Boolean(currentUser?.patron);
}

/**
 * Gets the handle string of the current user.
 * @returns {string} User handle
 */
export function getCurrentUserHandle() {
    return currentUser?.handle || 'default-user';
}

/**
 * Get the current user.
 * @returns {Promise<void>}
 */
async function getCurrentUser() {
    try {
        const response = await fetch('/api/users/me', {
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Failed to get current user');
        }

        currentUser = await response.json();
        $('#admin_button').toggle(accountsEnabled && isAdmin());
        $('#messages_button').toggle(accountsEnabled);
        await refreshMessagesSummary();
    } catch (error) {
        console.error('Error getting current user:', error);
    }
}

function setMessagesBadge(hasUnread) {
    $('#messages_button .messages_badge_dot').toggle(Boolean(hasUnread));
}

async function refreshMessagesSummary() {
    if (!accountsEnabled || !currentUser) {
        setMessagesBadge(false);
        return null;
    }

    try {
        const response = await fetch('/api/users/messages/summary', {
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Failed to get message summary');
        }

        const data = await response.json();
        setMessagesBadge(Boolean(data?.hasUnread));
        return data;
    } catch (error) {
        console.error('Error getting message summary:', error);
        return null;
    }
}

async function getUserMessageThread() {
    const response = await fetch('/api/users/messages/thread', {
        headers: getRequestHeaders(),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data?.error || 'Failed to get message thread');
    }

    return data;
}

async function sendUserMessage(body) {
    const response = await fetch('/api/users/messages/thread', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ body }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to send message');
    }
}

async function getAdminMessageThreads() {
    const response = await fetch('/api/users/messages/admin/threads', {
        headers: getRequestHeaders(),
    });

    const data = await response.json().catch(() => ([]));

    if (!response.ok) {
        throw new Error(data?.error || 'Failed to get admin message threads');
    }

    return data;
}

async function getAdminMessageThread(handle) {
    const response = await fetch(`/api/users/messages/admin/threads/${encodeURIComponent(handle)}`, {
        headers: getRequestHeaders(),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data?.error || 'Failed to get admin message thread');
    }

    return data;
}

async function sendAdminMessage(handle, body) {
    const response = await fetch(`/api/users/messages/admin/threads/${encodeURIComponent(handle)}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ body }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to send admin message');
    }
}

function getMessageHtml(message) {
    if (typeof message?.html === 'string' && message.html.length) {
        return sanitizeMessageHtml(message.html, {
            RETURN_DOM: false,
            RETURN_DOM_FRAGMENT: false,
            RETURN_TRUSTED_TYPE: false,
        });
    }

    try {
        return messageFormatting(String(message?.body || ''), '', false, message?.senderRole === 'user', -1, {}, false);
    } catch {
        return $('<div></div>').text(String(message?.body || '')).html();
    }
}

function renderMessageThread(container, messages = [], currentHandle = '') {
    container.empty();

    if (!messages.length) {
        container.append('<div class="userMessagesThreadEmpty" data-i18n="No messages yet.">No messages yet.</div>');
        return;
    }

    for (const message of messages) {
        const row = $('<div class="userMessageRow"></div>');
        row.toggleClass('is-own', message.senderHandle === currentHandle);

        const meta = $('<div class="userMessageMeta"></div>');
        meta.append($('<span></span>').text(message.senderName || message.senderHandle || 'Unknown'));
        meta.append($('<span></span>').text(new Date(message.createdAt).toLocaleString()));

        const body = $('<div class="userMessageBody mes_text"></div>');
        body.html(getMessageHtml(message));

        row.append(meta, body);
        container.append(row);
    }

    const element = container.get(0);
    if (element) {
        element.scrollTop = element.scrollHeight;
    }
}

/**
 * Get a list of all users.
 * @returns {Promise<import('../../src/users.js').UserViewModel[]>} Users
 */
async function getUsers() {
    try {
        const response = await fetch('/api/users/get', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Failed to get users');
        }

        return response.json();
    } catch (error) {
        console.error('Error getting users:', error);
    }
}

/**
 * Formats an optional admin-visible timestamp.
 * @param {number} value Timestamp in milliseconds
 * @returns {string} Formatted timestamp
 */
function formatAdminTimestamp(value) {
    return Number.isFinite(value) ? new Date(value).toLocaleString() : 'Never';
}

/**
 * Gets character submissions visible to the current user.
 * @param {string} [status]
 * @returns {Promise<object[]>}
 */
async function getCharacterSubmissions(status = '') {
    try {
        const response = await fetch('/api/character-submissions/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(status ? { status } : {}),
        });

        if (!response.ok) {
            throw new Error('Failed to get character submissions');
        }

        return await response.json();
    } catch (error) {
        console.error('Error getting character submissions:', error);
        return [];
    }
}

function createEmptyCharacterDistributionPolicy(ownerHandle = '', publishedFilename = '', characterKey = '') {
    return {
        key: '',
        ownerHandle: String(ownerHandle || '').trim(),
        characterKey: String(characterKey || '').trim(),
        publishedFilename: String(publishedFilename || '').trim().replace(/\.png$/i, ''),
        blacklistHandles: [],
        adminBlacklistHandles: [],
        userBlacklistHandles: [],
        whitelistHandles: [],
        hasBlacklist: false,
        hasAdminBlacklist: false,
        hasUserBlacklist: false,
        hasWhitelist: false,
        updatedAt: null,
        updatedBy: null,
    };
}

async function getCharacterDistributionPolicy(ownerHandle, publishedFilename, characterKey = '') {
    const normalizedOwnerHandle = String(ownerHandle || '').trim();
    const normalizedCharacterKey = String(characterKey || '').trim().replace(/\.png$/i, '');
    const normalizedPublishedFilename = String(publishedFilename || '').trim().replace(/\.png$/i, '');

    if (!normalizedPublishedFilename) {
        return createEmptyCharacterDistributionPolicy(normalizedOwnerHandle, normalizedPublishedFilename, normalizedCharacterKey);
    }

    try {
        const response = await fetch('/api/characters/distribution-policy', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ownerHandle: normalizedOwnerHandle,
                characterKey: normalizedCharacterKey,
                publishedFilename: normalizedPublishedFilename,
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to get character distribution policy');
        }

        return {
            ...createEmptyCharacterDistributionPolicy(normalizedOwnerHandle, normalizedPublishedFilename, normalizedCharacterKey),
            ...data,
        };
    } catch (error) {
        console.error('Error getting character distribution policy:', error);
        return createEmptyCharacterDistributionPolicy(normalizedOwnerHandle, normalizedPublishedFilename, normalizedCharacterKey);
    }
}

async function getCharacterSubmissionDistributionDefaults(sourceAvatar) {
    const avatar = String(sourceAvatar || '').trim();
    if (!avatar) {
        return {
            requestedDistributionMode: SUBMISSION_DISTRIBUTION_MODES.GLOBAL,
            requestedTargetHandles: [],
            requestedBlacklistHandles: [],
            whitelistHandles: [],
            adminBlacklistHandles: [],
        };
    }

    try {
        const response = await fetch('/api/character-submissions/distribution-defaults', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ sourceAvatar: avatar }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to get character submission distribution defaults');
        }

        const requestedDistributionMode = normalizeSubmissionDistributionMode(data?.requestedDistributionMode)
            || SUBMISSION_DISTRIBUTION_MODES.GLOBAL;

        return {
            requestedDistributionMode,
            requestedTargetHandles: Array.isArray(data?.requestedTargetHandles)
                ? data.requestedTargetHandles.map(handle => String(handle || '').trim()).filter(Boolean)
                : [],
            requestedBlacklistHandles: Array.isArray(data?.requestedBlacklistHandles)
                ? data.requestedBlacklistHandles.map(handle => String(handle || '').trim()).filter(Boolean)
                : [],
            whitelistHandles: Array.isArray(data?.whitelistHandles)
                ? data.whitelistHandles.map(handle => String(handle || '').trim()).filter(Boolean)
                : [],
            adminBlacklistHandles: Array.isArray(data?.adminBlacklistHandles)
                ? data.adminBlacklistHandles.map(handle => String(handle || '').trim()).filter(Boolean)
                : [],
        };
    } catch (error) {
        console.error('Error getting character submission distribution defaults:', error);
        return {
            requestedDistributionMode: SUBMISSION_DISTRIBUTION_MODES.GLOBAL,
            requestedTargetHandles: [],
            requestedBlacklistHandles: [],
            whitelistHandles: [],
            adminBlacklistHandles: [],
        };
    }
}

/**
 * Submits an existing character card with an admin distribution request.
 * @param {string} sourceAvatar
 * @returns {Promise<object | null>}
 */
async function submitCharacterSubmission({
    sourceAvatar,
    requestedDistributionMode = SUBMISSION_DISTRIBUTION_MODES.GLOBAL,
    requestedTargetHandles = [],
    requestedBlacklistHandles = [],
}) {
    try {
        const avatar = String(sourceAvatar || '').trim();
        if (!avatar) {
            throw new Error('Choose a character first.');
        }

        const response = await fetch('/api/character-submissions/submit', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                sourceAvatar: avatar,
                requestedDistributionMode,
                requestedTargetHandles,
                requestedBlacklistHandles,
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to submit character');
        }

        return data;
    } catch (error) {
        console.error('Error submitting character:', error);
        toastr.error(error.message || 'Unknown error', translate('Failed to submit character'));
        return null;
    }
}

/**
 * Sends an admin distribution action for a submission.
 * @param {object} payload
 * @returns {Promise<object | null>}
 */
async function reviewCharacterSubmission(payload) {
    try {
        const response = await fetch('/api/character-submissions/review', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to process character admin distribution');
        }

        return data;
    } catch (error) {
        console.error('Error reviewing submission:', error);
        toastr.error(error.message || 'Unknown error', translate('Admin distribution failed'));
        return null;
    }
}

/**
 * Gets the admin-visible source character list for a user.
 * @param {string} sourceOwnerHandle
 * @returns {Promise<object[]>}
 */
async function getAdminPushSourceCharacters(sourceOwnerHandle) {
    const response = await fetch('/api/characters/admin/source-list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ sourceOwnerHandle }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || 'Failed to load source characters');
    }

    return Array.isArray(data?.characters) ? data.characters : [];
}

/**
 * Pushes a source user's character through the admin direct distribution API.
 * @param {object} payload Distribution payload
 * @returns {Promise<object>}
 */
async function pushAdminSourceCharacter(payload) {
    const response = await fetch('/api/characters/distribute', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || 'Failed to push bot');
    }

    return data;
}

/**
 * Sends a cleanup action for a submission.
 * @param {object} payload
 * @returns {Promise<object | null>}
 */
async function cleanupCharacterSubmission(payload) {
    try {
        const response = await fetch('/api/character-submissions/cleanup', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to clean up character submission');
        }

        return data;
    } catch (error) {
        console.error('Error cleaning up submission:', error);
        toastr.error(error.message || 'Unknown error', translate('Submission cleanup failed'));
        return null;
    }
}

/**
 * Parses a typed username list into unique handles.
 * Accepts commas, whitespace, and newlines as separators.
 * @param {string} value
 * @returns {string[]}
 */
function parseDistributionHandles(value) {
    return [...new Set(String(value || '')
        .split(/[\s,]+/g)
        .map(handle => handle.trim())
        .filter(Boolean))];
}

function normalizeDistributionHandles(handles = []) {
    return [...new Set((Array.isArray(handles) ? handles : [])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
}

function formatDistributionHandles(handles = []) {
    return normalizeDistributionHandles(handles).join(', ');
}

/**
 * Creates a human-friendly submission status label.
 * @param {string} status
 * @returns {string}
 */
function getSubmissionStatusLabel(status) {
    switch (status) {
        case 'approved':
            return 'Approved';
        case 'rejected':
            return 'Rejected';
        default:
            return 'Pending Admin Distribution';
    }
}

function normalizeSubmissionDistributionMode(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return Object.values(SUBMISSION_DISTRIBUTION_MODES).includes(normalizedValue)
        ? normalizedValue
        : null;
}

function getSubmissionDistributionSettings(distributionMode) {
    switch (distributionMode) {
        case SUBMISSION_DISTRIBUTION_MODES.WHITELIST:
            return {
                publishMode: 'selected',
                applyBlacklist: false,
                persistWhitelist: true,
            };
        case SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST:
            return {
                publishMode: 'global',
                applyBlacklist: true,
                persistWhitelist: false,
            };
        default:
            return {
                publishMode: 'global',
                applyBlacklist: false,
                persistWhitelist: false,
            };
    }
}

/**
 * Renders a submission card.
 * @param {object} submission
 * @param {object} [options]
 * @param {boolean} [options.admin=false]
 * @param {function} [options.onReview]
 * @returns {JQuery<HTMLElement>}
 */
function buildSubmissionCard(submission, { admin = false, onReview = null } = {}) {
    const card = $(`
        <div class="submission_card flex-container flexGap10 alignItemsFlexStart">
            <img class="submission_preview" alt="Character preview" data-i18n="[alt]Character preview">
            <div class="flex1 flex-container flexFlowColumn flexNoGap">
                <div class="flex-container alignItemsCenter flexGap10">
                    <h3 class="submission_name margin0"></h3>
                    <small class="submission_status opacity50p"></small>
                </div>
                <div class="submission_meta">
                    <div><span data-i18n="Owner:">Owner:</span> <span class="submission_owner"></span></div>
                    <div><span data-i18n="Submitted:">Submitted:</span> <span class="submission_submitted"></span></div>
                    <div class="submission_reviewed_row"><span data-i18n="Admin Action:">Admin Action:</span> <span class="submission_reviewed"></span></div>
                    <div class="submission_publish_row"><span data-i18n="Published As:">Published As:</span> <span class="submission_published"></span></div>
                    <div class="submission_targets_row"><span data-i18n="Targets:">Targets:</span> <span class="submission_targets"></span></div>
                </div>
                <div class="submission_notes"></div>
                <div class="submission_tags opacity50p"></div>
            </div>
            <div class="submission_actions flex-container flexFlowColumn"></div>
        </div>
    `);

    card.find('.submission_preview')
        .attr('src', submission.hasStoredCard === false ? '' : submission.previewUrl)
        .toggle(submission.hasStoredCard !== false);
    card.find('.submission_name').text(submission.characterName || submission.submittedFilename || submission.id);
    card.find('.submission_status').text(getSubmissionStatusLabel(submission.status));
    const ownerLabel = Array.isArray(submission.ownerHandles) && submission.ownerHandles.length > 0
        ? submission.ownerHandles.join(', ')
        : submission.ownerHandle;
    card.find('.submission_owner').text(ownerLabel);
    card.find('.submission_submitted').text(new Date(submission.submittedAt).toLocaleString());
    card.find('.submission_reviewed_row').toggle(Boolean(submission.reviewedAt));
    card.find('.submission_reviewed').text(submission.reviewedAt ? `${new Date(submission.reviewedAt).toLocaleString()} by ${submission.reviewedBy || 'Unknown'}` : '');
    card.find('.submission_publish_row').toggle(Boolean(submission.publishedFilename));
    card.find('.submission_published').text(submission.publishedFilename || '');
    card.find('.submission_targets_row').toggle(Array.isArray(submission.targetHandles) && submission.targetHandles.length > 0);
    card.find('.submission_targets').text(Array.isArray(submission.targetHandles) ? submission.targetHandles.join(', ') : '');
    const primaryNote = admin
        ? (submission.status === 'pending'
            ? String(submission.adminQueueReason || '').trim() || 'Reason unavailable.'
            : '')
        : String(submission.creatorNotes || '').trim();
    card.find('.submission_notes')
        .toggle(Boolean(submission.reviewNote || primaryNote))
        .append(primaryNote
            ? $('<div class="submission_review_note"></div>').text(admin ? `Inbox reason: ${primaryNote}` : primaryNote)
            : '')
        .append(submission.reviewNote ? $('<div class="submission_review_note opacity50p"></div>').text(t`Admin note: ${submission.reviewNote}`) : '');
    card.find('.submission_tags').toggle(Array.isArray(submission.tags) && submission.tags.length > 0).text(Array.isArray(submission.tags) ? submission.tags.join(', ') : '');

    if (admin && typeof onReview === 'function') {
        const actionButton = submission.status === 'pending' && submission.hasStoredCard !== false
            ? $('<div class="menu_button menu_button_icon"><i class="fa-fw fa-solid fa-gavel"></i><span data-i18n="Admin Distribution">Admin Distribution</span></div>')
            : $('<div class="menu_button menu_button_icon"><i class="fa-fw fa-solid fa-box-archive"></i><span data-i18n="Manage">Manage</span></div>');
        actionButton.on('click', () => onReview(submission));
        card.find('.submission_actions').append(actionButton);
    }

    return card;
}

/**
 * Renders a list of submission cards into a container.
 * @param {JQuery<HTMLElement>} container
 * @param {object[]} submissions
 * @param {object} [options]
 * @param {boolean} [options.admin=false]
 * @param {function} [options.onReview]
 */
function renderSubmissionCards(container, submissions, { admin = false, onReview = null } = {}) {
    container.empty();

    if (!submissions.length) {
        container.append('<div class="opacity50p" data-i18n="No submissions found.">No submissions found.</div>');
        return;
    }

    for (const submission of submissions) {
        container.append(buildSubmissionCard(submission, { admin, onReview }));
    }
}

/**
 * Opens the user's submission status list.
 * @returns {Promise<void>}
 */
async function openMySubmissionsPopup() {
    const submissions = await getCharacterSubmissions();
    const container = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    container.append('<h3 class="margin0" data-i18n="My Submissions">My Submissions</h3>');
    container.append('<div class="opacity50p" data-i18n="Approved entries in this list are already published.">Approved entries in this list are already published.</div>');
    const list = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    container.append(list);
    renderSubmissionCards(list, submissions);
    callGenericPopup(container, POPUP_TYPE.TEXT, '', { okButton: translate('Close'), wide: true, allowVerticalScrolling: true });
}

/**
 * Submits the selected character for admin distribution.
 * @param {{ name?: string, avatar?: string }} character
 * @returns {Promise<object | null>}
 */
export async function submitSelectedCharacterForReview(character) {
    const avatar = String(character?.avatar || '').trim();
    if (!avatar || avatar === 'none') {
        toastr.error(translate('Choose a saved character first.'), translate('Submission unavailable'));
        return null;
    }

    const displayName = String(character?.name || avatar);
    const distributionDefaults = await getCharacterSubmissionDistributionDefaults(avatar);
    let requestedDistributionMode = distributionDefaults.requestedDistributionMode;
    const container = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    container.append('<h3 class="margin0" data-i18n="Submit Character">Submit Character</h3>');
    const text = $('<div></div>');
    text.append(document.createTextNode('Choose the requested admin distribution for '));
    text.append($('<strong></strong>').text(displayName));
    text.append(document.createTextNode('.'));
    container.append(text);
    container.append('<div class="opacity50p" data-i18n="Admins can edit these lists or approve them as-is.">Admins can edit these lists or approve them as-is.</div>');
    container.append($(`
        <label class="flex-container flexFlowColumn flexNoGap">
            <span data-i18n="Admin Distribution">Admin Distribution</span>
            <select class="text_pole submission-distribution-mode">
                <option value="${SUBMISSION_DISTRIBUTION_MODES.WHITELIST}" data-i18n="Whitelist">Whitelist</option>
                <option value="${SUBMISSION_DISTRIBUTION_MODES.GLOBAL}" data-i18n="Global">Global</option>
                <option value="${SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST}" data-i18n="Global With Blacklist">Global With Blacklist</option>
            </select>
        </label>
    `));
    container.append(`
        <label class="submission-whitelist-targets-block flex-container flexFlowColumn flexNoGap">
            <span data-i18n="Whitelisted Usernames">Whitelisted Usernames</span>
            <small class="opacity50p" data-i18n="Type in the usernames separated by a comma.">Type in the usernames separated by a comma.</small>
            <textarea class="text_pole submission-whitelist-targets" rows="3" placeholder="Comma or newline separated usernames" data-i18n="[placeholder]Comma or newline separated usernames"></textarea>
        </label>
    `);
    container.append(`
        <label class="submission-blacklist-targets-block flex-container flexFlowColumn flexNoGap">
            <span data-i18n="Blacklisted Usernames">Blacklisted Usernames</span>
            <small class="opacity50p" data-i18n="Type in the usernames separated by a comma.">Type in the usernames separated by a comma.</small>
            <textarea class="text_pole submission-blacklist-targets" rows="3" placeholder="Comma or newline separated usernames" data-i18n="[placeholder]Comma or newline separated usernames"></textarea>
        </label>
    `);
    container.find('.submission-distribution-mode').val(requestedDistributionMode).on('change', function () {
        requestedDistributionMode = String($(this).val());
        syncSubmissionDistributionBlocks();
    });
    const defaultWhitelistHandles = distributionDefaults.whitelistHandles.length > 0
        ? distributionDefaults.whitelistHandles
        : distributionDefaults.requestedTargetHandles;
    const defaultAdminBlacklistHandles = distributionDefaults.adminBlacklistHandles.length > 0
        ? distributionDefaults.adminBlacklistHandles
        : distributionDefaults.requestedBlacklistHandles;
    container.find('.submission-whitelist-targets').val(formatDistributionHandles(defaultWhitelistHandles));
    container.find('.submission-blacklist-targets').val(formatDistributionHandles(defaultAdminBlacklistHandles));

    function syncSubmissionDistributionBlocks() {
        container.find('.submission-whitelist-targets-block').toggle(requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.WHITELIST);
        container.find('.submission-blacklist-targets-block').toggle(requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST);
    }

    syncSubmissionDistributionBlocks();

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, '', {
        okButton: translate('Submit'),
        cancelButton: translate('Cancel'),
        wide: true,
        allowVerticalScrolling: true,
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    const requestedTargetHandles = requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.WHITELIST
        ? parseDistributionHandles(container.find('.submission-whitelist-targets').val())
        : [];
    const requestedBlacklistHandles = requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST
        ? parseDistributionHandles(container.find('.submission-blacklist-targets').val())
        : [];
    if (requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.WHITELIST && requestedTargetHandles.length === 0) {
        toastr.error(translate('Choose at least one whitelisted user.'), translate('Submission unavailable'));
        return null;
    }

    if (requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST && requestedBlacklistHandles.length === 0) {
        toastr.error(translate('Choose at least one blacklisted user.'), translate('Submission unavailable'));
        return null;
    }

    const submission = await submitCharacterSubmission({
        sourceAvatar: avatar,
        requestedDistributionMode,
        requestedTargetHandles,
        requestedBlacklistHandles,
    });
    if (!submission) {
        return null;
    }

    if (submission.autoApproved) {
        const skippedNotice = Array.isArray(submission.skippedHandles) && submission.skippedHandles.length > 0
            ? ` Skipped: ${submission.skippedHandles.join(', ')}`
            : '';
        toastr.success(t`Published ${submission.publishedFilename || submission.submittedFilename}${skippedNotice}`, translate('Character auto-approved'));
    } else {
        toastr.success(t`Submitted ${submission.submittedFilename}`, translate('Character submitted'));
    }
    return submission;
}

/**
 * Opens the admin distribution dialog for a submission.
 * @param {object} submission
 * @param {function} callback
 * @returns {Promise<void>}
 */
async function openSubmissionReviewPopup(submission, callback) {
    const ownerHandle = String(submission.ownerHandle || getCurrentUserHandle()).trim();
    const characterKey = String(submission.sharedCharacterKey || '').trim().replace(/\.png$/i, '');
    const requestedDistributionMode = normalizeSubmissionDistributionMode(submission.requestedDistributionMode);
    const requestedDistributionSettings = getSubmissionDistributionSettings(requestedDistributionMode);
    const hasRequestedDistribution = Boolean(requestedDistributionMode);
    const requestedTargetHandles = Array.isArray(submission.requestedTargetHandles) ? submission.requestedTargetHandles : [];
    const requestedBlacklistHandles = Array.isArray(submission.requestedBlacklistHandles) ? submission.requestedBlacklistHandles : [];
    let publishMode = submission.publishMode || requestedDistributionSettings.publishMode || 'global';
    let reviewNote = String(submission.reviewNote || '');
    let publishedFilename = String((submission.publishedFilename || submission.characterName || submission.submittedFilename || '').replace(/\.png$/i, ''));
    let applyBlacklist = hasRequestedDistribution ? requestedDistributionSettings.applyBlacklist : false;
    let persistWhitelist = hasRequestedDistribution ? requestedDistributionSettings.persistWhitelist : false;
    let hasUserBlacklist = false;
    let policyRequestId = 0;
    let policyRefreshTimer = null;
    const initialTargetHandles = hasRequestedDistribution
        ? (requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.WHITELIST ? requestedTargetHandles : [])
        : (Array.isArray(submission.targetHandles) ? submission.targetHandles : []);
    const initialBlacklistHandles = hasRequestedDistribution && requestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST
        ? requestedBlacklistHandles
        : [];
    const REVIEW_POPUP_RESULT_REJECT = POPUP_RESULT.CUSTOM1;
    const REVIEW_POPUP_RESULT_DELETE_ASSET = POPUP_RESULT.CUSTOM2;
    const REVIEW_POPUP_RESULT_DELETE_ALL = POPUP_RESULT.CUSTOM3;

    const container = $(`
        <div class="flex-container flexFlowColumn flexGap10">
            <div class="flex-container flexGap10 alignItemsFlexStart">
                <img class="submission_preview" alt="Character preview" data-i18n="[alt]Character preview">
                <div class="flex1">
                    <h3 class="margin0 submission-title"></h3>
                    <div class="opacity50p">Owner: <span class="submission-owner"></span></div>
                    <div class="opacity50p">Status: <span class="submission-status"></span></div>
                    <div class="opacity50p review-stored-card-status"></div>
                </div>
            </div>
            <label class="flex-container flexFlowColumn flexNoGap review-publish-mode-block">
                <span data-i18n="Publish Mode">Publish Mode</span>
                <select class="text_pole review-publish-mode">
                    <option value="selected" data-i18n="Selected Users">Selected Users</option>
                    <option value="global" data-i18n="Global">Global</option>
                </select>
            </label>
            <label class="flex-container flexFlowColumn flexNoGap review-published-filename-block">
                <span data-i18n="Published Filename">Published Filename</span>
                <input class="text_pole review-published-filename" type="text">
            </label>
            <label class="review-apply-blacklist-block flex-container alignItemsCenter flexGap10">
                <input type="checkbox" class="review-apply-blacklist">
                <span data-i18n="Apply admin blacklist">Apply admin blacklist</span>
            </label>
            <div class="review-blacklist-targets-block flex-container flexFlowColumn flexGap5">
                <span data-i18n="Blacklisted Usernames">Blacklisted Usernames</span>
                <small class="opacity50p review-blacklist-help" data-i18n="Type in the usernames separated by a comma.">Type in the usernames separated by a comma.</small>
                <textarea class="text_pole review-blacklist-targets" rows="3" placeholder="Comma or newline separated usernames" data-i18n="[placeholder]Comma or newline separated usernames"></textarea>
            </div>
            <div class="review-user-blacklist-targets-block flex-container flexFlowColumn flexGap5">
                <span data-i18n="User-Blacklisted Usernames">User-Blacklisted Usernames</span>
                <small class="opacity50p" data-i18n="Self-enrolled opt-outs are always enforced and cannot be edited here.">Self-enrolled opt-outs are always enforced and cannot be edited here.</small>
                <textarea class="text_pole review-user-blacklist-targets" rows="3" readonly></textarea>
            </div>
            <div class="review-targets-block flex-container flexFlowColumn flexGap5">
                <span data-i18n="Recipient Usernames">Recipient Usernames</span>
                <small class="opacity50p" data-i18n="Type in the usernames separated by a comma.">Type in the usernames separated by a comma.</small>
                <textarea class="text_pole review-targets" rows="3" placeholder="Comma or newline separated usernames" data-i18n="[placeholder]Comma or newline separated usernames"></textarea>
            </div>
            <label class="review-persist-whitelist-block flex-container alignItemsCenter flexGap10">
                <input type="checkbox" class="review-persist-whitelist">
                <span data-i18n="Save whitelist for future selected pushes">Save whitelist for future selected pushes</span>
            </label>
            <label class="flex-container flexFlowColumn flexNoGap">
                <span data-i18n="Admin Note">Admin Note</span>
                <textarea class="text_pole review-note" rows="3"></textarea>
            </label>
        </div>
    `);

    container.find('.submission_preview')
        .attr('src', submission.hasStoredCard === false ? '' : submission.previewUrl)
        .toggle(submission.hasStoredCard !== false);
    container.find('.submission-title').text(submission.characterName || submission.submittedFilename);
    container.find('.submission-owner').text(Array.isArray(submission.ownerHandles) && submission.ownerHandles.length > 0
        ? submission.ownerHandles.join(', ')
        : submission.ownerHandle);
    container.find('.submission-status').text(getSubmissionStatusLabel(submission.status));
    container.find('.review-stored-card-status').text(submission.hasStoredCard === false ? 'Stored card asset has already been deleted.' : '');
    const isPending = submission.status === 'pending';
    const canApprove = isPending && submission.hasStoredCard !== false;

    function syncPolicyBlocks() {
        container.find('.review-publish-mode-block, .review-published-filename-block').toggle(canApprove);
        container.find('.review-targets-block').toggle(canApprove && publishMode === 'selected');
        container.find('.review-persist-whitelist-block').toggle(canApprove && publishMode === 'selected');
        container.find('.review-apply-blacklist-block').toggle(canApprove && publishMode === 'global');
        container.find('.review-blacklist-targets-block').toggle(canApprove && publishMode === 'global' && applyBlacklist);
        container.find('.review-user-blacklist-targets-block').toggle(hasUserBlacklist);
    }

    async function loadPolicyForCurrentFilename({ overwriteRecipients = false } = {}) {
        const requestId = ++policyRequestId;
        const policy = await getCharacterDistributionPolicy(ownerHandle, publishedFilename, characterKey);
        if (requestId !== policyRequestId) {
            return;
        }
        hasUserBlacklist = policy.hasUserBlacklist;
        const userBlacklistHandles = normalizeDistributionHandles(policy.userBlacklistHandles);
        container.find('.review-user-blacklist-targets').val(formatDistributionHandles(userBlacklistHandles));

        if (hasRequestedDistribution) {
            const mergedBlacklistHandles = normalizeDistributionHandles([
                ...initialBlacklistHandles,
                ...policy.adminBlacklistHandles,
            ]);
            applyBlacklist = publishMode === 'global'
                && (requestedDistributionSettings.applyBlacklist || policy.hasAdminBlacklist);
            persistWhitelist = requestedDistributionSettings.persistWhitelist;
            container.find('.review-apply-blacklist').prop('checked', applyBlacklist);
            container.find('.review-persist-whitelist').prop('checked', persistWhitelist);
            container.find('.review-blacklist-targets').val(formatDistributionHandles(applyBlacklist ? mergedBlacklistHandles : []));
            container.find('.review-targets').val(formatDistributionHandles(initialTargetHandles));
            container.find('.review-blacklist-help').text(translate('Type in admin-managed blacklisted usernames separated by a comma.'));
            syncPolicyBlocks();
            return;
        }

        applyBlacklist = policy.hasAdminBlacklist;
        persistWhitelist = policy.hasWhitelist;
        container.find('.review-apply-blacklist').prop('checked', applyBlacklist);
        container.find('.review-persist-whitelist').prop('checked', persistWhitelist);
        container.find('.review-blacklist-targets').val(formatDistributionHandles(applyBlacklist ? policy.adminBlacklistHandles : []));
        container.find('.review-blacklist-help').text(translate('Type in admin-managed blacklisted usernames separated by a comma.'));

        if (policy.hasWhitelist) {
            container.find('.review-targets').val(formatDistributionHandles(policy.whitelistHandles));
        } else if (overwriteRecipients) {
            container.find('.review-targets').val(formatDistributionHandles(initialTargetHandles));
        } else {
            container.find('.review-targets').val('');
        }

        syncPolicyBlocks();
    }

    function queuePolicyRefresh() {
        if (!canApprove) {
            return;
        }

        clearTimeout(policyRefreshTimer);
        policyRefreshTimer = setTimeout(() => {
            policyRefreshTimer = null;
            void loadPolicyForCurrentFilename();
        }, 250);
    }

    container.find('.review-publish-mode').val(publishMode).on('change', function () {
        publishMode = String($(this).val());
        syncPolicyBlocks();
        if (publishMode === 'global') {
            void loadPolicyForCurrentFilename();
        }
    });
    container.find('.review-published-filename').val(publishedFilename).on('input', function () {
        publishedFilename = String($(this).val());
        queuePolicyRefresh();
    });
    container.find('.review-note').val(reviewNote).on('input', function () {
        reviewNote = String($(this).val());
    });
    container.find('.review-apply-blacklist').on('change', function () {
        applyBlacklist = Boolean($(this).prop('checked'));
        syncPolicyBlocks();
    });
    container.find('.review-persist-whitelist').on('change', function () {
        persistWhitelist = Boolean($(this).prop('checked'));
    });
    syncPolicyBlocks();
    await loadPolicyForCurrentFilename({ overwriteRecipients: true });

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, '', {
        okButton: canApprove ? translate('Approve & Distribute') : false,
        cancelButton: translate('Cancel'),
        wide: true,
        allowVerticalScrolling: true,
        customButtons: [
            ...(isPending ? [{
                text: translate('Reject'),
                result: REVIEW_POPUP_RESULT_REJECT,
                classes: ['warning'],
            }] : []),
            {
                text: translate('Delete Stored Asset'),
                result: REVIEW_POPUP_RESULT_DELETE_ASSET,
                classes: ['warning'],
            },
            {
                text: translate('Delete Submission'),
                result: REVIEW_POPUP_RESULT_DELETE_ALL,
                classes: ['warning'],
            },
        ],
    });
    clearTimeout(policyRefreshTimer);

    if (result === POPUP_RESULT.CANCELLED || result === POPUP_RESULT.NEGATIVE) {
        return;
    }

    if (result === REVIEW_POPUP_RESULT_REJECT) {
        const rejected = await reviewCharacterSubmission({
            id: submission.id,
            action: 'reject',
            reviewNote,
        });

        if (rejected) {
            toastr.success(translate('Submission rejected'), translate('Admin distribution updated'));
            callback();
        }
        return;
    }

    if (result === REVIEW_POPUP_RESULT_DELETE_ASSET || result === REVIEW_POPUP_RESULT_DELETE_ALL) {
        const deleteMode = result === REVIEW_POPUP_RESULT_DELETE_ASSET ? 'asset' : 'all';
        const confirm = await Popup.show.confirm(
            translate(deleteMode === 'asset' ? 'Delete Stored Asset' : 'Delete Submission'),
            deleteMode === 'asset'
                ? translate('Delete only the stored submission PNG copy? The user source card will not be touched.')
                : translate('Delete this submission record and its stored PNG copy? This cannot be undone.'),
            {
                okButton: translate(deleteMode === 'asset' ? 'Delete Asset' : 'Delete Submission'),
                cancelButton: translate('Cancel'),
            },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            return;
        }

        const cleaned = await cleanupCharacterSubmission({
            id: submission.id,
            deleteMode,
        });

        if (cleaned) {
            toastr.success(
                deleteMode === 'asset' ? translate('Stored submission asset deleted') : translate('Submission deleted'),
                translate('Submission cleanup complete'),
            );
            callback();
        }
        return;
    }

    const targetHandles = parseDistributionHandles(container.find('.review-targets').val());
    const blacklistHandles = applyBlacklist
        ? parseDistributionHandles(container.find('.review-blacklist-targets').val())
        : [];
    if (publishMode === 'selected' && targetHandles.length === 0) {
        toastr.error(translate('Choose at least one recipient.'), translate('Admin distribution cancelled'));
        return;
    }

    const approved = await reviewCharacterSubmission({
        id: submission.id,
        action: 'approve',
        publishMode,
        targetHandles,
        publishedFilename,
        reviewNote,
        applyBlacklist,
        blacklistHandles,
        persistWhitelist,
        whitelistHandles: persistWhitelist ? targetHandles : [],
    });

    if (approved) {
        const skippedNotice = Array.isArray(approved.skippedHandles) && approved.skippedHandles.length > 0
            ? ` Skipped: ${approved.skippedHandles.join(', ')}`
            : '';
        toastr.success(t`Published ${approved.publishedFilename || approved.characterName}${skippedNotice}`, translate('Admin distribution approved'));
        callback();
    }
}

/**
 * Enable a user account.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function enableUser(handle, callback) {
    try {
        const response = await fetch('/api/users/enable', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to enable user'));
            throw new Error('Failed to enable user');
        }

        callback();
    } catch (error) {
        console.error('Error enabling user:', error);
    }
}

async function disableUser(handle, callback) {
    try {
        const response = await fetch('/api/users/disable', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data?.error || 'Unknown error', translate('Failed to disable user'));
            throw new Error('Failed to disable user');
        }

        callback();
    } catch (error) {
        console.error('Error disabling user:', error);
    }
}

/**
 * Promote a user to admin.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function promoteUser(handle, callback) {
    try {
        const response = await fetch('/api/users/promote', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to promote user'));
            throw new Error('Failed to promote user');
        }

        callback();
    } catch (error) {
        console.error('Error promoting user:', error);
    }
}

/**
 * Demote a user from admin.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function demoteUser(handle, callback) {
    try {
        const response = await fetch('/api/users/demote', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to demote user'));
            throw new Error('Failed to demote user');
        }

        callback();
    } catch (error) {
        console.error('Error demoting user:', error);
    }
}

/** Updates patron access for one user from the admin panel. */
async function setPatron(handle, patron, callback) {
    try {
        const response = await fetch('/api/users/patron', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, patron }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to update patron access');
        }
        callback();
    } catch (error) {
        console.error('Error updating patron access:', error);
        toastr.error(error.message || 'Unknown error', translate('Failed to update patron access'));
    }
}

/** Invalidates every login and active-tab session for one user. */
async function resetUserSession(handle, callback) {
    try {
        if (handle === currentUser.handle) {
            toastr.error(translate('You cannot reset your own session.'), translate('Failed to reset user session'));
            return;
        }

        const content = $('<div class="flex-container flexFlowColumn flexGap10"></div>')
            .append($('<p></p>').text(translate('This will log the user out everywhere, clear their active-tab lock, and require them to log in again.')))
            .append($('<strong></strong>').text(handle));
        const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, translate('Reset User Session'), {
            okButton: translate('Reset Session'),
            cancelButton: translate('Cancel'),
            wide: false,
            large: false,
        });
        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            return;
        }

        const response = await fetch('/api/users/reset-session', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to reset user session');
        }

        toastr.success(translate('User logged out everywhere'), translate('Session Reset'));
        callback();
    } catch (error) {
        console.error('Error resetting user session:', error);
        toastr.error(translate('Failed to reset user session'));
    }
}

/**
 * Create a new user.
 * @param {HTMLFormElement} form Form element
 */
async function createUser(form, callback) {
    const errors = [];
    const formData = new FormData(form);

    if (!formData.get('handle')) {
        errors.push('Handle is required');
    }

    if (formData.get('password') !== formData.get('confirm')) {
        errors.push('Passwords do not match');
    }

    if (errors.length) {
        toastr.error(errors.join(', '), translate('Failed to create user'));
        return;
    }

    const body = {};
    formData.forEach(function (value, key) {
        if (key === 'confirm') {
            return;
        }
        if (key.startsWith('_')) {
            key = key.substring(1);
        }
        body[key] = value;
    });
    body.patron = formData.has('patron');

    try {
        const response = await fetch('/api/users/create', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to create user'));
            throw new Error('Failed to create user');
        }

        form.reset();
        callback();
    } catch (error) {
        console.error('Error creating user:', error);
    }
}

/**
 * Backup a user's data.
 * @param {string} handle Handle of the user to backup
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function backupUserData(handle, callback) {
    try {
        toastr.info(translate('Please wait for the download to start.'), translate('Backup Requested'));
        const response = await fetch('/api/users/backup', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to backup user data'));
            throw new Error('Failed to backup user data');
        }

        const blob = await response.blob();
        const header = response.headers.get('Content-Disposition');
        const parts = header.split(';');
        const filename = parts[1].split('=')[1].replaceAll('"', '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        callback();
    } catch (error) {
        console.error('Error backing up user data:', error);
    }
}

/**
 * Shows a popup to change a user's password.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function changePassword(handle, callback) {
    try {
        const template = $(await renderTemplateAsync('changePassword'));
        template.find('.currentPasswordBlock').toggle(!isAdmin());
        let newPassword = '';
        let confirmPassword = '';
        let oldPassword = '';
        template.find('input[name="current"]').on('input', function () {
            oldPassword = String($(this).val());
        });
        template.find('input[name="password"]').on('input', function () {
            newPassword = String($(this).val());
        });
        template.find('input[name="confirm"]').on('input', function () {
            confirmPassword = String($(this).val());
        });
        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: translate('Change'), cancelButton: translate('Cancel'), wide: false, large: false });
        if (result === POPUP_RESULT.CANCELLED || result === POPUP_RESULT.NEGATIVE) {
            throw new Error('Change password cancelled');
        }

        if (newPassword !== confirmPassword) {
            toastr.error(translate('Passwords do not match'), translate('Failed to change password'));
            throw new Error('Passwords do not match');
        }

        const response = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, newPassword, oldPassword }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to change password'));
            throw new Error('Failed to change password');
        }

        toastr.success(translate('Password changed successfully'), translate('Password Changed'));
        callback();
    }
    catch (error) {
        console.error('Error changing password:', error);
    }
}

/**
 * Delete a user.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function deleteUser(handle, callback) {
    try {
        if (handle === currentUser.handle) {
            toastr.error(translate('Cannot delete yourself'), translate('Failed to delete user'));
            throw new Error('Cannot delete yourself');
        }

        let purge = false;
        let confirmHandle = '';

        const template = $(await renderTemplateAsync('deleteUser'));
        template.find('#deleteUserName').text(handle);
        template.find('input[name="deleteUserData"]').on('input', function () {
            purge = $(this).is(':checked');
        });
        template.find('input[name="deleteUserHandle"]').on('input', function () {
            confirmHandle = String($(this).val());
        });

        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: translate('Delete'), cancelButton: translate('Cancel'), wide: false, large: false });

        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Delete user cancelled');
        }

        if (handle !== confirmHandle) {
            toastr.error(translate('Handles do not match'), translate('Failed to delete user'));
            throw new Error('Handles do not match');
        }

        const response = await fetch('/api/users/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, purge }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to delete user'));
            throw new Error('Failed to delete user');
        }

        toastr.success(translate('User deleted successfully'), translate('User Deleted'));
        callback();
    } catch (error) {
        console.error('Error deleting user:', error);
    }
}

/**
 * Reset a user's settings.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function resetSettings(handle, callback) {
    try {
        let password = '';
        const template = $(await renderTemplateAsync('resetSettings'));
        template.find('input[name="password"]').on('input', function () {
            password = String($(this).val());
        });
        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: translate('Reset'), cancelButton: translate('Cancel'), wide: false, large: false });

        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Reset settings cancelled');
        }

        const response = await fetch('/api/users/reset-settings', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, password }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to reset settings'));
            throw new Error('Failed to reset settings');
        }

        toastr.success(translate('Settings reset successfully'), translate('Settings Reset'));
        callback();
    } catch (error) {
        console.error('Error resetting settings:', error);
    }
}

/**
 * Change a user's display name.
 * @param {string} handle User handle
 * @param {string} name Current name
 * @param {function} callback Success callback
 */
async function changeName(handle, name, callback) {
    try {
        const template = $(await renderTemplateAsync('changeName'));
        const result = await callGenericPopup(template, POPUP_TYPE.INPUT, name, { okButton: translate('Change'), cancelButton: translate('Cancel'), wide: false, large: false });

        if (!result) {
            throw new Error('Change name cancelled');
        }

        name = String(result);

        const response = await fetch('/api/users/change-name', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, name }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to change name'));
            throw new Error('Failed to change name');
        }

        toastr.success(translate('Name changed successfully'), translate('Name Changed'));
        callback();

    } catch (error) {
        console.error('Error changing name:', error);
    }
}

/**
 * Restore a settings snapshot.
 * @param {string} name Snapshot name
 * @param {function} callback Success callback
 */
async function restoreSnapshot(name, callback) {
    try {
        const confirm = await callGenericPopup(
            t`Are you sure you want to restore the settings from "${name}"?`,
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: translate('Restore'), cancelButton: translate('Cancel'), wide: false, large: false },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Restore snapshot cancelled');
        }

        const response = await fetch('/api/settings/restore-snapshot', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to restore snapshot'));
            throw new Error('Failed to restore snapshot');
        }

        callback();
    } catch (error) {
        console.error('Error restoring snapshot:', error);
    }

}

/**
 * Load the content of a settings snapshot.
 * @param {string} name Snapshot name
 * @returns {Promise<string>} Snapshot content
 */
async function loadSnapshotContent(name) {
    try {
        const response = await fetch('/api/settings/load-snapshot', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to load snapshot content'));
            throw new Error('Failed to load snapshot content');
        }

        return response.text();
    } catch (error) {
        console.error('Error loading snapshot content:', error);
    }
}

/**
 * Gets a list of settings snapshots.
 * @returns {Promise<Snapshot[]>} List of snapshots
 * @typedef {Object} Snapshot
 * @property {string} name Snapshot name
 * @property {number} date Date in milliseconds
 * @property {number} size File size in bytes
 */
async function getSnapshots() {
    try {
        const response = await fetch('/api/settings/get-snapshots', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to get settings snapshots'));
            throw new Error('Failed to get settings snapshots');
        }

        const snapshots = await response.json();
        return snapshots;
    } catch (error) {
        console.error('Error getting settings snapshots:', error);
        return [];
    }
}

/**
 * Make a snapshot of the current settings.
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function makeSnapshot(callback) {
    try {
        const response = await fetch('/api/settings/make-snapshot', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to make snapshot'));
            throw new Error('Failed to make snapshot');
        }

        toastr.success(translate('Snapshot created successfully'), translate('Snapshot Created'));
        callback();
    } catch (error) {
        console.error('Error making snapshot:', error);
    }
}

/**
 * Open the settings snapshots view.
 */
async function viewSettingsSnapshots() {
    const template = $(await renderTemplateAsync('snapshotsView'));
    async function renderSnapshots() {
        const snapshots = await getSnapshots();
        template.find('.snapshotList').empty();

        for (const snapshot of snapshots.sort((a, b) => b.date - a.date)) {
            const snapshotBlock = template.find('.snapshotTemplate .snapshot').clone();
            snapshotBlock.find('.snapshotName').text(snapshot.name);
            snapshotBlock.find('.snapshotDate').text(new Date(snapshot.date).toLocaleString());
            snapshotBlock.find('.snapshotSize').text(humanFileSize(snapshot.size));
            snapshotBlock.find('.snapshotRestoreButton').on('click', async (e) => {
                e.stopPropagation();
                restoreSnapshot(snapshot.name, () => location.reload());
            });
            snapshotBlock.find('.inline-drawer-toggle').on('click', async () => {
                const contentBlock = snapshotBlock.find('.snapshotContent');
                if (!contentBlock.val()) {
                    const content = await loadSnapshotContent(snapshot.name);
                    contentBlock.val(content);
                }

            });
            template.find('.snapshotList').append(snapshotBlock);
        }
    }

    callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: translate('Close'), wide: false, large: false, allowVerticalScrolling: true });
    template.find('.makeSnapshotButton').on('click', () => makeSnapshot(renderSnapshots));
    renderSnapshots();
}

/**
 * Reset everything to default.
 * @param {function} callback Success callback
 */
async function resetEverything(callback) {
    try {
        const step1Response = await fetch('/api/users/reset-step1', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!step1Response.ok) {
            const data = await step1Response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to reset'));
            throw new Error('Failed to reset everything');
        }

        let password = '';
        let code = '';

        const template = $(await renderTemplateAsync('userReset'));
        template.find('input[name="password"]').on('input', function () {
            password = String($(this).val());
        });
        template.find('input[name="code"]').on('input', function () {
            code = String($(this).val());
        });
        const confirm = await callGenericPopup(
            template,
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: translate('Reset'), cancelButton: translate('Cancel'), wide: false, large: false },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Reset everything cancelled');
        }

        const step2Response = await fetch('/api/users/reset-step2', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ password, code }),
        });

        if (!step2Response.ok) {
            const data = await step2Response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to reset'));
            throw new Error('Failed to reset everything');
        }

        toastr.success(translate('Everything reset successfully'), translate('Reset Everything'));
        callback();
    } catch (error) {
        console.error('Error resetting everything:', error);
    }

}

async function openUserProfile() {
    await getCurrentUser();
    const template = $(await renderTemplateAsync('userProfile'));
    template.find('.userName').text(currentUser.name);
    template.find('.userHandle').text(currentUser.handle);
    template.find('.avatar img').attr('src', currentUser.avatar);
    template.find('.userRole').text(translate(currentUser.admin ? 'Admin' : currentUser.patron ? 'Patron' : 'User'));
    template.find('.userCreated').text(new Date(currentUser.created).toLocaleString());
    template.find('.hasPassword').toggle(currentUser.password);
    template.find('.noPassword').toggle(!currentUser.password);
    template.find('.userSettingsSnapshotsButton').on('click', () => viewSettingsSnapshots());
    template.find('.userSubmissionsButton').on('click', () => openMySubmissionsPopup());
    template.find('.userChangeNameButton').on('click', async () => changeName(currentUser.handle, currentUser.name, async () => {
        await getCurrentUser();
        template.find('.userName').text(currentUser.name);
    }));
    template.find('.userChangePasswordButton').on('click', () => changePassword(currentUser.handle, async () => {
        await getCurrentUser();
        template.find('.hasPassword').toggle(currentUser.password);
        template.find('.noPassword').toggle(!currentUser.password);
    }));
    template.find('.userBackupButton').on('click', function () {
        $(this).addClass('disabled');
        backupUserData(currentUser.handle, () => {
            $(this).removeClass('disabled');
        });
    });
    template.find('.userResetSettingsButton').on('click', () => resetSettings(currentUser.handle, () => location.reload()));
    template.find('.userResetAllButton').on('click', () => resetEverything(() => location.reload()));
    template.find('.userAvatarChange').on('click', () => template.find('.avatarUpload').trigger('click'));
    template.find('.avatarUpload').on('change', async function () {
        if (!(this instanceof HTMLInputElement)) {
            return;
        }

        const file = this.files[0];
        if (!file) {
            return;
        }

        await cropAndUploadAvatar(currentUser.handle, file);
        await getCurrentUser();
        template.find('.avatar img').attr('src', currentUser.avatar);
    });
    template.find('.userAvatarRemove').on('click', async function () {
        await changeAvatar(currentUser.handle, '');
        await getCurrentUser();
        template.find('.avatar img').attr('src', currentUser.avatar);
    });

    if (!accountsEnabled) {
        template.find('[data-require-accounts]').hide();
        template.find('.accountsDisabledHint').show();
    }

    const popupOptions = {
        okButton: translate('Close'),
        wide: false,
        large: false,
        allowVerticalScrolling: true,
        allowHorizontalScrolling: false,
    };
    callGenericPopup(template, POPUP_TYPE.TEXT, '', popupOptions);
}

async function openUserMessagesPopup() {
    const template = $(await renderTemplateAsync('userMessages'));
    const threadContainer = template.find('.userMessagesThread');
    const composer = template.find('.userMessagesComposer');
    const sendButton = template.find('.userMessagesSendButton');
    let isSendingMessage = false;

    function setComposerSendingState(isSending) {
        sendButton.toggleClass('disabled', isSending);
        sendButton.prop('disabled', isSending);
        composer.prop('disabled', isSending);
    }

    async function loadThread() {
        try {
            const thread = await getUserMessageThread();
            renderMessageThread(threadContainer, thread.messages, currentUser?.handle);
            await refreshMessagesSummary();
        } catch (error) {
            console.error('Error loading user messages:', error);
            toastr.error(error.message || 'Unknown error', translate('Failed to load messages'));
        }
    }

    async function sendMessage() {
        if (isSendingMessage) {
            return;
        }

        const body = String(composer.val() || '');

        try {
            isSendingMessage = true;
            setComposerSendingState(true);
            await sendUserMessage(body);
            composer.val('');
            await loadThread();
        } catch (error) {
            console.error('Error sending user message:', error);
            toastr.error(error.message || 'Unknown error', translate('Failed to send message'));
        } finally {
            isSendingMessage = false;
            setComposerSendingState(false);
        }
    }

    sendButton.on('click', () => sendMessage());
    composer.on('keydown', async (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            await sendMessage();
        }
    });

    callGenericPopup(template, POPUP_TYPE.TEXT, '', {
        okButton: translate('Close'),
        wide: true,
        large: false,
        allowVerticalScrolling: true,
        allowHorizontalScrolling: false,
    });

    await loadThread();
}

/**
 * Crop and upload an avatar image.
 * @param {string} handle User handle
 * @param {File} file Avatar file
 * @returns {Promise<string>}
 */
async function cropAndUploadAvatar(handle, file) {
    const dataUrl = await getBase64Async(await ensureImageFormatSupported(file));
    const croppedImage = await callGenericPopup(translate('Set the crop position of the avatar image'), POPUP_TYPE.CROP, '', { cropAspect: 1, cropImage: dataUrl });
    if (!croppedImage) {
        return;
    }

    await changeAvatar(handle, String(croppedImage));

    return String(croppedImage);
}

/**
 * Change the avatar of the user.
 * @param {string} handle User handle
 * @param {string} avatar File to upload or base64 string
 * @returns {Promise<void>} Avatar URL
 */
async function changeAvatar(handle, avatar) {
    try {
        const response = await fetch('/api/users/change-avatar', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar, handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', translate('Failed to change avatar'));
            return;
        }
    } catch (error) {
        console.error('Error changing avatar:', error);
    }
}

async function openAdminPanel(initialTab = 'usersList') {
    let selectedMessageHandle = '';
    let threadSummaries = [];
    let isSendingAdminMessage = false;
    let adminPanelUsers = [];
    let pushBotSourceCharacters = [];
    let pushBotPolicyRequestId = 0;
    let pushBotsInitialized = false;

    function showAdminTab(target) {
        template.find('.adminNav > button').each(function () {
            $(this).toggleClass('active', String($(this).data('target-tab')) === target);
        });
        template.find('.navTab').each(function () {
            $(this).toggle(this.classList.contains(target));
        });
    }

    async function loadAdminPanelUsers() {
        adminPanelUsers = await getUsers() || [];
        return adminPanelUsers;
    }

    async function renderUsers() {
        const users = await loadAdminPanelUsers();
        template.find('.usersList').empty();
        for (const user of users) {
            const userBlock = template.find('.userAccountTemplate .userAccount').clone();
            userBlock.find('.userName').text(user.name);
            userBlock.find('.userHandle').text(user.handle);
            userBlock.find('.userStatus').text(translate(user.enabled ? 'Enabled' : 'Disabled'));
            userBlock.find('.userRole').text(translate(user.admin ? 'Admin' : user.patron ? 'Patron' : 'User'));
            userBlock.find('.userPatronStatus').text(translate(user.admin || user.patron ? 'Enabled' : 'Disabled'));
            userBlock.find('.avatar img').attr('src', user.avatar);
            userBlock.find('.hasPassword').toggle(user.password);
            userBlock.find('.noPassword').toggle(!user.password);
            userBlock.find('.userCreated').text(new Date(user.created).toLocaleString());
            userBlock.find('.userLastActivity').text(formatAdminTimestamp(user.lastActivityAt));
            userBlock.find('.userLastOpened').text(user.lastOpened?.name || 'Unknown');
            userBlock.find('.userEnableButton').toggle(!user.enabled).on('click', () => enableUser(user.handle, renderUsers));
            userBlock.find('.userDisableButton').toggle(user.enabled).on('click', () => disableUser(user.handle, renderUsers));
            userBlock.find('.userPromoteButton').toggle(!user.admin).on('click', () => promoteUser(user.handle, renderUsers));
            userBlock.find('.userDemoteButton').toggle(user.admin).on('click', () => demoteUser(user.handle, renderUsers));
            userBlock.find('.userPatronButton').toggle(!user.admin).on('click', () => setPatron(user.handle, !user.patron, renderUsers));
            userBlock.find('.userPatronButton').attr('title', user.patron ? translate('Remove patron access') : translate('Grant patron access'));
            userBlock.find('.userChangePasswordButton').on('click', () => changePassword(user.handle, renderUsers));
            userBlock.find('.userResetSessionButton').toggle(user.handle !== currentUser.handle).on('click', () => resetUserSession(user.handle, renderUsers));
            userBlock.find('.userDelete').on('click', () => deleteUser(user.handle, renderUsers));
            userBlock.find('.userChangeNameButton').on('click', async () => changeName(user.handle, user.name, renderUsers));
            userBlock.find('.userBackupButton').on('click', function () {
                $(this).addClass('disabled').off('click');
                backupUserData(user.handle, renderUsers);
            });
            userBlock.find('.userAvatarChange').on('click', () => userBlock.find('.avatarUpload').trigger('click'));
            userBlock.find('.avatarUpload').on('change', async function () {
                if (!(this instanceof HTMLInputElement)) {
                    return;
                }

                const file = this.files[0];
                if (!file) {
                    return;
                }

                await cropAndUploadAvatar(user.handle, file);
                renderUsers();
            });
            userBlock.find('.userAvatarRemove').on('click', async function () {
                await changeAvatar(user.handle, '');
                renderUsers();
            });
            template.find('.usersList').append(userBlock);
        }

        if (pushBotsInitialized) {
            void renderPushBots();
        }
    }

    function getSelectedPushBotAvatars() {
        const selectedValue = template.find('.pushBotSourceCharacter').val();
        if (Array.isArray(selectedValue)) {
            return selectedValue.map(value => String(value || '').trim()).filter(Boolean);
        }

        const avatar = String(selectedValue || '').trim();
        return avatar ? [avatar] : [];
    }

    function getSelectedPushBotCharacters() {
        const selectedAvatars = new Set(getSelectedPushBotAvatars());
        return pushBotSourceCharacters.filter(character => selectedAvatars.has(character.avatar));
    }

    function getSelectedPushBotCharacter() {
        return getSelectedPushBotCharacters()[0] || null;
    }

    function isPushBotBatchMode() {
        return getSelectedPushBotAvatars().length > 1;
    }

    function getPushBotDisplayName(character) {
        return String(character?.name || character?.avatar || '').trim() || 'Unknown bot';
    }

    function getPushBotPublishedFilenameFallback(character) {
        return String(character?.name || character?.avatar || '').replace(/\.png$/i, '').trim();
    }

    function syncPushBotBlocks() {
        const batchMode = isPushBotBatchMode();
        const publishMode = String(template.find('.pushBotPublishMode').val() || 'global');
        const applyBlacklist = Boolean(template.find('.pushBotApplyBlacklist').prop('checked'));
        const hasUserBlacklist = String(template.find('.pushBotUserBlacklistHandles').val() || '').trim().length > 0;

        template.find('.pushBotPublishedFilename, .pushBotPublishMode, .pushBotTargetHandles, .pushBotApplyBlacklist, .pushBotBlacklistHandles, .pushBotUserBlacklistHandles')
            .prop('disabled', batchMode);
        template.find('.pushBotBatchPolicyNotice').toggle(batchMode);
        template.find('.pushBotSubmitButton span').text(batchMode ? 'Push Bots' : 'Push Bot');
        template.find('.pushBotTargetsBlock').toggle(!batchMode && publishMode === 'selected');
        template.find('.pushBotApplyBlacklistBlock').toggle(!batchMode && publishMode === 'global');
        template.find('.pushBotBlacklistBlock').toggle(!batchMode && publishMode === 'global' && applyBlacklist);
        template.find('.pushBotUserBlacklistBlock').toggle(!batchMode && hasUserBlacklist);
    }

    async function loadPushBotPolicy({ overwriteRecipients = false } = {}) {
        const sourceOwnerHandle = String(template.find('.pushBotSourceUser').val() || '').trim();
        const character = getSelectedPushBotCharacter();
        const publishedFilename = String(template.find('.pushBotPublishedFilename').val() || '').trim();
        const requestId = ++pushBotPolicyRequestId;

        if (isPushBotBatchMode()) {
            template.find('.pushBotTargetHandles, .pushBotBlacklistHandles, .pushBotUserBlacklistHandles').val('');
            syncPushBotBlocks();
            return;
        }

        if (!sourceOwnerHandle || !character || !publishedFilename) {
            template.find('.pushBotUserBlacklistHandles').val('');
            syncPushBotBlocks();
            return;
        }

        const ownerHandle = String(character.ownerHandle || sourceOwnerHandle).trim();
        const characterKey = String(character.sharedCharacterKey || '').trim();
        const policy = await getCharacterDistributionPolicy(ownerHandle, publishedFilename, characterKey);
        if (requestId !== pushBotPolicyRequestId) {
            return;
        }

        template.find('.pushBotApplyBlacklist').prop('checked', policy.hasAdminBlacklist);
        template.find('.pushBotBlacklistHandles').val(formatDistributionHandles(policy.adminBlacklistHandles));
        template.find('.pushBotUserBlacklistHandles').val(formatDistributionHandles(policy.userBlacklistHandles));

        if (overwriteRecipients && policy.hasWhitelist) {
            template.find('.pushBotTargetHandles').val(formatDistributionHandles(policy.whitelistHandles));
        }

        syncPushBotBlocks();
    }

    function populatePushBotCharacters() {
        const select = template.find('.pushBotSourceCharacter');
        select.empty();

        if (!pushBotSourceCharacters.length) {
            select.append($('<option></option>').val('').text(translate('No bots available')));
            select.prop('disabled', true);
            template.find('.pushBotPublishedFilename').val('');
            syncPushBotBlocks();
            return;
        }

        select.prop('disabled', false);
        for (const character of pushBotSourceCharacters) {
            const label = character.name && character.name !== character.avatar
                ? `${character.name} (${character.avatar})`
                : character.avatar;
            select.append($('<option></option>').val(character.avatar).text(label));
        }
        select.find('option').first().prop('selected', true);

        const selectedCharacter = getSelectedPushBotCharacter();
        template.find('.pushBotPublishedFilename').val(getPushBotPublishedFilenameFallback(selectedCharacter));
        void loadPushBotPolicy({ overwriteRecipients: true });
    }

    async function loadPushBotCharacters() {
        const sourceOwnerHandle = String(template.find('.pushBotSourceUser').val() || '').trim();
        pushBotSourceCharacters = [];
        populatePushBotCharacters();

        if (!sourceOwnerHandle) {
            return;
        }

        try {
            pushBotSourceCharacters = await getAdminPushSourceCharacters(sourceOwnerHandle);
            populatePushBotCharacters();
        } catch (error) {
            console.error('Error loading source bots:', error);
            toastr.error(error.message || 'Unknown error', translate('Failed to load source bots'));
        }
    }

    async function renderPushBots() {
        pushBotsInitialized = true;
        const sourceSelect = template.find('.pushBotSourceUser');
        const currentSource = String(sourceSelect.val() || '').trim();
        sourceSelect.empty()
            .append($('<option></option>').val('').text(translate('Loading users...')))
            .prop('disabled', true);
        pushBotSourceCharacters = [];
        populatePushBotCharacters();

        const users = adminPanelUsers.length ? adminPanelUsers : await loadAdminPanelUsers();
        const enabledUsers = users.filter(user => user.enabled);
        sourceSelect.empty();

        if (!enabledUsers.length) {
            sourceSelect.append($('<option></option>').val('').text(translate('No enabled users available')));
            sourceSelect.prop('disabled', true);
            return;
        }

        for (const user of enabledUsers) {
            sourceSelect.append($('<option></option>').val(user.handle).text(`${user.name} (${user.handle})`));
        }
        sourceSelect.prop('disabled', false);

        if (currentSource && enabledUsers.some(user => user.handle === currentSource)) {
            sourceSelect.val(currentSource);
        }

        if (!String(sourceSelect.val() || '').trim() && enabledUsers.length > 0) {
            sourceSelect.val(enabledUsers[0].handle);
        }

        await loadPushBotCharacters();
    }

    function getReusablePushBotDistributionPayload({ sourceOwnerHandle, character }) {
        const defaults = character?.distributionDefaults && typeof character.distributionDefaults === 'object'
            ? character.distributionDefaults
            : {};
        const publishMode = String(defaults.publishMode || '').trim();
        const publishedFilename = String(defaults.publishedFilename || '').trim();

        if (!defaults.reusable || !publishedFilename) {
            return null;
        }

        const basePayload = {
            sourceType: 'character',
            sourceOwnerHandle,
            sourceAvatar: character.avatar,
            publishedFilename,
            publishMode,
        };

        if (publishMode === 'global') {
            return basePayload;
        }

        if (publishMode === 'selected') {
            const targetHandles = Array.isArray(defaults.whitelistHandles) && defaults.whitelistHandles.length > 0
                ? defaults.whitelistHandles
                : Array.isArray(defaults.requestedTargetHandles) ? defaults.requestedTargetHandles : [];

            if (targetHandles.length === 0) {
                return null;
            }

            return {
                ...basePayload,
                targetHandles,
            };
        }

        return null;
    }

    async function submitPushBotBatch({ sourceOwnerHandle, selectedCharacters }) {
        const confirm = await Popup.show.confirm(
            translate('Push Bots'),
            t`Push ${selectedCharacters.length} bots from ${sourceOwnerHandle}? Each bot will reuse its last push settings. Existing bots with the same published filenames will be overwritten.`,
            {
                okButton: translate('Push Bots'),
                cancelButton: translate('Cancel'),
            },
        );
        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            return;
        }

        const submitButton = template.find('.pushBotSubmitButton');
        submitButton.prop('disabled', true).addClass('disabled');

        const pushed = [];
        const skipped = [];
        const failed = [];

        try {
            for (const character of selectedCharacters) {
                const payload = getReusablePushBotDistributionPayload({ sourceOwnerHandle, character });

                if (!payload) {
                    skipped.push(getPushBotDisplayName(character));
                    continue;
                }

                try {
                    const result = await pushAdminSourceCharacter(payload);
                    pushed.push(result.publishedFilename || payload.publishedFilename || getPushBotDisplayName(character));
                } catch (error) {
                    console.error('Error pushing bot:', error);
                    failed.push(getPushBotDisplayName(character));
                }
            }

            const details = [];
            if (skipped.length > 0) {
                details.push(`Skipped: ${skipped.join(', ')}`);
            }
            if (failed.length > 0) {
                details.push(`Failed: ${failed.join(', ')}`);
            }

            const message = `Pushed ${pushed.length}, failed ${failed.length}, skipped ${skipped.length}.${details.length ? ` ${details.join(' ')}` : ''}`;
            if (failed.length > 0 || skipped.length > 0) {
                toastr.warning(message, translate('Admin batch push complete'));
            } else {
                toastr.success(message, translate('Admin batch push complete'));
            }

            await loadPushBotCharacters();
        } finally {
            submitButton.prop('disabled', false).removeClass('disabled');
        }
    }

    async function submitPushBot() {
        const sourceOwnerHandle = String(template.find('.pushBotSourceUser').val() || '').trim();
        const selectedCharacters = getSelectedPushBotCharacters();
        const character = selectedCharacters[0] || null;
        const publishMode = String(template.find('.pushBotPublishMode').val() || 'global');
        const publishedFilename = String(template.find('.pushBotPublishedFilename').val() || '').trim();
        const targetHandles = parseDistributionHandles(template.find('.pushBotTargetHandles').val());
        const applyBlacklist = Boolean(template.find('.pushBotApplyBlacklist').prop('checked'));
        const blacklistHandles = applyBlacklist
            ? parseDistributionHandles(template.find('.pushBotBlacklistHandles').val())
            : [];

        if (!sourceOwnerHandle || selectedCharacters.length === 0) {
            toastr.error(translate('Choose a source user and bot.'), translate('Admin push unavailable'));
            return;
        }

        if (selectedCharacters.length > 1) {
            await submitPushBotBatch({ sourceOwnerHandle, selectedCharacters });
            return;
        }

        if (publishMode === 'selected' && targetHandles.length === 0) {
            toastr.error(translate('Choose at least one recipient.'), translate('Admin push cancelled'));
            return;
        }

        const destinationLabel = publishMode === 'global'
            ? 'all enabled users'
            : targetHandles.join(', ');
        const confirm = await Popup.show.confirm(
            translate('Push Bot'),
            t`Push "${character.name || character.avatar}" from ${sourceOwnerHandle} to ${destinationLabel}? Existing bots with the same published filename will be overwritten.`,
            {
                okButton: translate('Push Bot'),
                cancelButton: translate('Cancel'),
            },
        );
        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            return;
        }

        const submitButton = template.find('.pushBotSubmitButton');
        submitButton.prop('disabled', true).addClass('disabled');

        try {
            const result = await pushAdminSourceCharacter({
                sourceType: 'character',
                sourceOwnerHandle,
                sourceAvatar: character.avatar,
                publishedFilename,
                publishMode,
                targetHandles,
                applyBlacklist: publishMode === 'global' ? applyBlacklist : undefined,
                blacklistHandles,
            });
            const skippedNotice = Array.isArray(result.skippedHandles) && result.skippedHandles.length > 0
                ? ` Skipped: ${result.skippedHandles.join(', ')}`
                : '';
            toastr.success(t`Published ${result.publishedFilename || publishedFilename || character.avatar}${skippedNotice}`, translate('Admin push complete'));
            await loadPushBotPolicy({ overwriteRecipients: false });
        } catch (error) {
            console.error('Error pushing bot:', error);
            toastr.error(error.message || 'Unknown error', translate('Admin push failed'));
        } finally {
            submitButton.prop('disabled', false).removeClass('disabled');
        }
    }

    let submissionStatusFilter = 'pending';

    async function renderSubmissions() {
        const submissions = await getCharacterSubmissions(submissionStatusFilter);
        renderSubmissionCards(template.find('.submissionsList'), submissions, {
            admin: true,
            onReview: (submission) => openSubmissionReviewPopup(submission, renderSubmissions),
        });
    }

    function paintMessageSummaries() {
        const list = template.find('.adminMessagesList');
        list.empty();

        if (!threadSummaries.length) {
            list.append('<div class="userMessagesThreadEmpty" data-i18n="No user threads available.">No user threads available.</div>');
            return;
        }

        for (const summary of threadSummaries) {
            const item = $('<div class="adminMessageListItem"></div>');
            item.toggleClass('is-active', summary.userHandle === selectedMessageHandle);
            item.append($('<div class="flex-container justifySpaceBetween alignItemsCenter"></div>')
                .append($('<strong></strong>').text(summary.userName))
                .append($('<small class="opacity70p"></small>').text(summary.userHandle)));
            item.append($('<div class="adminMessageListPreview"></div>').text(summary.lastPreview || 'No messages yet.'));
            item.append($('<div class="adminMessageListTimestamp"></div>').text(summary.lastMessageAt ? new Date(summary.lastMessageAt).toLocaleString() : ''));

            if (summary.hasUnread) {
                item.append('<span class="adminMessageListItemUnreadDot"></span>');
            }

            item.on('click', async () => {
                selectedMessageHandle = summary.userHandle;
                await renderSelectedAdminThread(summary.userHandle);
            });

            list.append(item);
        }
    }

    async function loadMessageSummaries() {
        try {
            threadSummaries = await getAdminMessageThreads();

            if (!threadSummaries.some(summary => summary.userHandle === selectedMessageHandle)) {
                selectedMessageHandle = threadSummaries.find(summary => summary.hasUnread)?.userHandle || threadSummaries[0]?.userHandle || '';
            }

            paintMessageSummaries();
            await refreshMessagesSummary();
        } catch (error) {
            console.error('Error loading admin message summaries:', error);
            toastr.error(error.message || 'Unknown error', translate('Failed to load messages'));
        }
    }

    async function renderSelectedAdminThread(handle, reloadSummaries = true) {
        const paneTitle = template.find('.adminMessagesPaneTitle');
        const threadContainer = template.find('.adminMessagesThread');

        if (!handle) {
            paneTitle.text(translate('Messages'));
            threadContainer.html('<div class="userMessagesThreadEmpty" data-i18n="Select a user to view messages.">Select a user to view messages.</div>');
            return;
        }

        try {
            const summary = threadSummaries.find(item => item.userHandle === handle);
            const thread = await getAdminMessageThread(handle);
            paneTitle.text(summary ? `${summary.userName} (${handle})` : handle);
            renderMessageThread(threadContainer, thread.messages, currentUser?.handle);

            if (reloadSummaries) {
                await loadMessageSummaries();
            } else {
                paintMessageSummaries();
                await refreshMessagesSummary();
            }
        } catch (error) {
            console.error('Error loading admin thread:', error);
            toastr.error(error.message || 'Unknown error', translate('Failed to load messages'));
        }
    }

    function setAdminComposerSendingState(isSending) {
        const composer = template.find('.adminMessagesComposer');
        const sendButton = template.find('.adminMessagesSendButton');
        sendButton.toggleClass('disabled', isSending);
        sendButton.prop('disabled', isSending);
        composer.prop('disabled', isSending);
    }

    async function sendAdminMessageFromComposer() {
        if (isSendingAdminMessage) {
            return;
        }

        if (!selectedMessageHandle) {
            toastr.warning(translate('Select a user thread first.'), translate('No thread selected'));
            return;
        }

        const composer = template.find('.adminMessagesComposer');
        const body = String(composer.val() || '');

        try {
            isSendingAdminMessage = true;
            setAdminComposerSendingState(true);
            await sendAdminMessage(selectedMessageHandle, body);
            composer.val('');
            await loadMessageSummaries();
            await renderSelectedAdminThread(selectedMessageHandle, false);
        } catch (error) {
            console.error('Error sending admin message:', error);
            toastr.error(error.message || 'Unknown error', translate('Failed to send message'));
        } finally {
            isSendingAdminMessage = false;
            setAdminComposerSendingState(false);
        }
    }

    const template = $(await renderTemplateAsync('admin'));

    template.find('.adminNav > button').on('click', function () {
        const target = String($(this).data('target-tab'));
        showAdminTab(target);
    });

    template.find('.createUserDisplayName').on('input', async function () {
        const slug = await slugify(String($(this).val()));
        template.find('.createUserHandle').val(slug);
    });

    template.find('.userCreateForm').on('submit', function (event) {
        if (!(event.target instanceof HTMLFormElement)) {
            return;
        }

        event.preventDefault();
        createUser(event.target, () => {
            template.find('.manageUsersButton').trigger('click');
            renderUsers();
        });
    });
    template.find('.submissionStatusFilter').val(submissionStatusFilter).on('change', function () {
        submissionStatusFilter = String($(this).val() || '').trim();
        void renderSubmissions();
    });
    template.find('.manageSubmissionsButton').on('click', () => renderSubmissions());
    template.find('.refreshSubmissionQueueButton').on('click', () => renderSubmissions());
    template.find('.pushBotsButton').on('click', () => renderPushBots());
    template.find('.pushBotSourceUser').on('change', () => loadPushBotCharacters());
    template.find('.pushBotSourceCharacter').on('change', function () {
        const character = getSelectedPushBotCharacter();
        template.find('.pushBotPublishedFilename').val(isPushBotBatchMode() ? '' : getPushBotPublishedFilenameFallback(character));
        void loadPushBotPolicy({ overwriteRecipients: true });
    });
    template.find('.pushBotPublishedFilename').on('input', () => {
        if (!isPushBotBatchMode()) {
            void loadPushBotPolicy();
        }
    });
    template.find('.pushBotPublishMode').on('change', function () {
        syncPushBotBlocks();
        void loadPushBotPolicy({ overwriteRecipients: true });
    });
    template.find('.pushBotApplyBlacklist').on('change', () => syncPushBotBlocks());
    template.find('.pushBotSubmitButton').on('click', () => submitPushBot());
    template.find('.manageMessagesButton').on('click', async () => {
        await loadMessageSummaries();
        await renderSelectedAdminThread(selectedMessageHandle, false);
    });
    template.find('.refreshMessagesButton').on('click', async () => {
        await loadMessageSummaries();
        await renderSelectedAdminThread(selectedMessageHandle, false);
    });
    template.find('.adminMessagesSendButton').on('click', () => sendAdminMessageFromComposer());
    template.find('.adminMessagesComposer').on('keydown', async (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            await sendAdminMessageFromComposer();
        }
    });

    callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: translate('Close'), wide: true, large: false, allowVerticalScrolling: true, allowHorizontalScrolling: false });
    renderUsers();
    renderSubmissions();
    void renderPushBots();
    syncPushBotBlocks();
    await loadMessageSummaries();
    showAdminTab(initialTab);

    if (initialTab === 'messagesTab') {
        await renderSelectedAdminThread(selectedMessageHandle, false);
    } else if (initialTab === 'pushBotsTab') {
        await renderPushBots();
    }
}

/**
 * Log out the current user.
 * @returns {Promise<void>}
 */
async function logout() {
    let response = await fetch('/api/users/logout', {
        method: 'POST',
        headers: getRequestHeaders(),
    });

    if (response.status === 403) {
        try {
            await refreshCsrfToken();
            response = await fetch('/api/users/logout', {
                method: 'POST',
                headers: getRequestHeaders(),
            });
        } catch (error) {
            console.error('Failed to refresh CSRF token during logout:', error);
        }
    }

    if (!response.ok) {
        try {
            const sessionResponse = await fetch('/api/users/me');
            if (sessionResponse.status !== 403) {
                toastr.error(translate('Refresh the page and try again.'), translate('Logout failed'));
                return;
            }
        } catch (error) {
            console.error('Failed to verify session state during logout:', error);
            toastr.error(translate('Refresh the page and try again.'), translate('Logout failed'));
            return;
        }
    }

    // On an explicit logout stop auto login
    // to allow user to change username even
    // when auto auth (such as authelia or basic)
    // would be valid
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('noauto', 'true');

    window.location.search = urlParams.toString();
}

/**
 * Runs a text through the slugify API endpoint.
 * @param {string} text Text to slugify
 * @returns {Promise<string>} Slugified text
 */
async function slugify(text) {
    try {
        const response = await fetch('/api/users/slugify', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            throw new Error('Failed to slugify text');
        }

        return response.text();
    } catch (error) {
        console.error('Error slugifying text:', error);
        return text;
    }
}

/**
 * Pings the server to extend the user session.
 */
async function extendUserSession() {
    try {
        const response = await fetch('/api/ping?extend=1', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Ping did not succeed', { cause: response.status });
        }
    } catch (error) {
        console.error('Failed to extend user session', error);
    }
}

jQuery(() => {
    $('#logout_button').on('click', () => {
        logout();
    });
    $('#admin_button').on('click', () => {
        openAdminPanel();
    });
    $('#messages_button').on('click', () => {
        if (isAdmin()) {
            openAdminPanel('messagesTab');
            return;
        }

        openUserMessagesPopup();
    });
    $('#account_button').on('click', () => {
        openUserProfile();
    });
    setInterval(async () => {
        if (currentUser) {
            await extendUserSession();
        }
    }, SESSION_EXTEND_INTERVAL);
    setInterval(async () => {
        if (currentUser) {
            await refreshMessagesSummary();
        }
    }, MESSAGE_SUMMARY_INTERVAL);
    window.addEventListener('focus', () => {
        if (currentUser) {
            refreshMessagesSummary();
        }
    });
});
