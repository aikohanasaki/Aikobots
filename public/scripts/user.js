import { getRequestHeaders } from '../script.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from './popup.js';
import { renderTemplateAsync } from './templates.js';
import { ensureImageFormatSupported, getBase64Async, humanFileSize } from './utils.js';

/**
 * @type {import('../../src/users.js').UserViewModel} Logged in user
 */
export let currentUser = null;
export let accountsEnabled = false;

// Extend the session every 10 minutes
const SESSION_EXTEND_INTERVAL = 10 * 60 * 1000;

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
        $('.character_distribute_button').css('display', isAdmin() ? 'flex' : 'none');
    } catch (error) {
        console.error('Error getting current user:', error);
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

/**
 * Submits an existing character card for admin review.
 * @param {string} sourceAvatar
 * @returns {Promise<object | null>}
 */
async function submitCharacterSubmission(sourceAvatar) {
    try {
        const avatar = String(sourceAvatar || '').trim();
        if (!avatar) {
            throw new Error('Choose a character first.');
        }

        const response = await fetch('/api/character-submissions/submit', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ sourceAvatar: avatar }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to submit character');
        }

        return data;
    } catch (error) {
        console.error('Error submitting character:', error);
        toastr.error(error.message || 'Unknown error', 'Failed to submit character');
        return null;
    }
}

/**
 * Sends a review action for a submission.
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
            throw new Error(data?.error || 'Failed to review character submission');
        }

        return data;
    } catch (error) {
        console.error('Error reviewing submission:', error);
        toastr.error(error.message || 'Unknown error', 'Submission review failed');
        return null;
    }
}

/**
 * Sends a distribution request for a character.
 * @param {object} payload
 * @returns {Promise<object | null>}
 */
async function distributeCharacterRequest(payload) {
    try {
        const response = await fetch('/api/characters/distribute', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to distribute character');
        }

        return data;
    } catch (error) {
        console.error('Error distributing character:', error);
        toastr.error(error.message || 'Unknown error', 'Character distribution failed');
        return null;
    }
}

/**
 * Builds a user checklist for distribution/review dialogs.
 * @param {import('../../src/users.js').UserViewModel[]} users
 * @param {string[]} [selectedHandles]
 * @returns {JQuery<HTMLElement>}
 */
function buildUserChecklist(users, selectedHandles = []) {
    const wrapper = $('<div class="flex-container flexFlowColumn flexGap5"></div>');

    for (const user of users) {
        const label = $('<label class="flex-container alignItemsCenter flexGap10"></label>');
        const input = $('<input type="checkbox" class="distribution-target">')
            .val(user.handle)
            .prop('checked', selectedHandles.includes(user.handle));

        label.append(input);
        label.append($('<span></span>').text(user.name));
        label.append($('<small class="opacity50p"></small>').text(user.handle));
        wrapper.append(label);
    }

    return wrapper;
}

/**
 * Gets the currently-selected handles from a checklist container.
 * @param {JQuery<HTMLElement>} container
 * @returns {string[]}
 */
function getSelectedHandles(container) {
    return container.find('.distribution-target:checked').map((_, element) => String($(element).val())).get();
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
            return 'Pending Review';
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
            <img class="submission_preview" alt="Character preview">
            <div class="flex1 flex-container flexFlowColumn flexNoGap">
                <div class="flex-container alignItemsCenter flexGap10">
                    <h3 class="submission_name margin0"></h3>
                    <small class="submission_status opacity50p"></small>
                </div>
                <div class="submission_meta">
                    <div><span>Owner:</span> <span class="submission_owner"></span></div>
                    <div><span>Submitted:</span> <span class="submission_submitted"></span></div>
                    <div class="submission_reviewed_row"><span>Reviewed:</span> <span class="submission_reviewed"></span></div>
                    <div class="submission_publish_row"><span>Published As:</span> <span class="submission_published"></span></div>
                    <div class="submission_targets_row"><span>Targets:</span> <span class="submission_targets"></span></div>
                </div>
                <div class="submission_notes"></div>
                <div class="submission_tags opacity50p"></div>
            </div>
            <div class="submission_actions flex-container flexFlowColumn"></div>
        </div>
    `);

    card.find('.submission_preview').attr('src', submission.previewUrl);
    card.find('.submission_name').text(submission.characterName || submission.submittedFilename || submission.id);
    card.find('.submission_status').text(getSubmissionStatusLabel(submission.status));
    card.find('.submission_owner').text(submission.ownerHandle);
    card.find('.submission_submitted').text(new Date(submission.submittedAt).toLocaleString());
    card.find('.submission_reviewed_row').toggle(Boolean(submission.reviewedAt));
    card.find('.submission_reviewed').text(submission.reviewedAt ? `${new Date(submission.reviewedAt).toLocaleString()} by ${submission.reviewedBy || 'Unknown'}` : '');
    card.find('.submission_publish_row').toggle(Boolean(submission.publishedFilename));
    card.find('.submission_published').text(submission.publishedFilename || '');
    card.find('.submission_targets_row').toggle(Array.isArray(submission.targetHandles) && submission.targetHandles.length > 0);
    card.find('.submission_targets').text(Array.isArray(submission.targetHandles) ? submission.targetHandles.join(', ') : '');
    card.find('.submission_notes')
        .toggle(Boolean(submission.reviewNote || submission.creatorNotes))
        .append(Boolean(submission.creatorNotes) ? $('<div class="submission_review_note"></div>').text(submission.creatorNotes) : '')
        .append(Boolean(submission.reviewNote) ? $('<div class="submission_review_note opacity50p"></div>').text(`Review note: ${submission.reviewNote}`) : '');
    card.find('.submission_tags').toggle(Array.isArray(submission.tags) && submission.tags.length > 0).text(Array.isArray(submission.tags) ? submission.tags.join(', ') : '');

    if (admin && submission.status === 'pending' && typeof onReview === 'function') {
        const reviewButton = $('<div class="menu_button menu_button_icon"><i class="fa-fw fa-solid fa-gavel"></i><span>Review</span></div>');
        reviewButton.on('click', () => onReview(submission));
        card.find('.submission_actions').append(reviewButton);
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
        container.append('<div class="opacity50p">No submissions found.</div>');
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
    container.append('<h3 class="margin0">My Submissions</h3>');
    const list = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    container.append(list);
    renderSubmissionCards(list, submissions);
    callGenericPopup(container, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true, allowVerticalScrolling: true });
}

/**
 * Submits the selected character for review.
 * @param {{ name?: string, avatar?: string }} character
 * @returns {Promise<object | null>}
 */
export async function submitSelectedCharacterForReview(character) {
    const avatar = String(character?.avatar || '').trim();
    if (!avatar || avatar === 'none') {
        toastr.error('Choose a saved character first.', 'Submission unavailable');
        return null;
    }

    const displayName = String(character?.name || avatar);
    const container = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    container.append('<h3 class="margin0">Submit Character</h3>');
    const text = $('<div></div>');
    text.append(document.createTextNode('Submit '));
    text.append($('<strong></strong>').text(displayName));
    text.append(document.createTextNode(' for admin review and distribution?'));
    container.append(text);

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Submit',
        cancelButton: 'Cancel',
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    const submission = await submitCharacterSubmission(avatar);
    if (!submission) {
        return null;
    }

    toastr.success(`Submitted ${submission.submittedFilename}`, 'Character submitted');
    return submission;
}

/**
 * Opens the review dialog for an admin.
 * @param {object} submission
 * @param {function} callback
 * @returns {Promise<void>}
 */
async function openSubmissionReviewPopup(submission, callback) {
    const users = (await getUsers() || []).filter(user => user.enabled);
    let publishMode = 'selected';
    let reviewNote = String(submission.reviewNote || '');
    let publishedFilename = String((submission.publishedFilename || submission.characterName || submission.submittedFilename || '').replace(/\.png$/i, ''));
    const checklist = buildUserChecklist(users, submission.targetHandles || []);

    const container = $(`
        <div class="flex-container flexFlowColumn flexGap10">
            <div class="flex-container flexGap10 alignItemsFlexStart">
                <img class="submission_preview" alt="Character preview">
                <div class="flex1">
                    <h3 class="margin0 submission-title"></h3>
                    <div class="opacity50p">Owner: <span class="submission-owner"></span></div>
                </div>
            </div>
            <label class="flex-container flexFlowColumn flexNoGap">
                <span>Publish Mode</span>
                <select class="text_pole review-publish-mode">
                    <option value="selected">Selected Users</option>
                    <option value="global">Global</option>
                </select>
            </label>
            <label class="flex-container flexFlowColumn flexNoGap">
                <span>Published Filename</span>
                <input class="text_pole review-published-filename" type="text">
            </label>
            <div class="review-targets-block flex-container flexFlowColumn flexGap5">
                <span>Recipients</span>
            </div>
            <label class="flex-container flexFlowColumn flexNoGap">
                <span>Review Note</span>
                <textarea class="text_pole review-note" rows="3"></textarea>
            </label>
        </div>
    `);

    container.find('.submission_preview').attr('src', submission.previewUrl);
    container.find('.submission-title').text(submission.characterName || submission.submittedFilename);
    container.find('.submission-owner').text(submission.ownerHandle);
    container.find('.review-publish-mode').val(publishMode).on('change', function () {
        publishMode = String($(this).val());
        container.find('.review-targets-block').toggle(publishMode === 'selected');
    });
    container.find('.review-published-filename').val(publishedFilename).on('input', function () {
        publishedFilename = String($(this).val());
    });
    container.find('.review-note').val(reviewNote).on('input', function () {
        reviewNote = String($(this).val());
    });
    container.find('.review-targets-block').append(checklist).toggle(publishMode === 'selected');

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Approve & Publish',
        cancelButton: 'Cancel',
        wide: true,
        allowVerticalScrolling: true,
        customButtons: [{
            text: 'Reject',
            result: POPUP_RESULT.CUSTOM1,
            classes: ['warning'],
        }],
    });

    if (result === POPUP_RESULT.CANCELLED || result === POPUP_RESULT.NEGATIVE) {
        return;
    }

    if (result === POPUP_RESULT.CUSTOM1) {
        const rejected = await reviewCharacterSubmission({
            id: submission.id,
            action: 'reject',
            reviewNote,
        });

        if (rejected) {
            toastr.success('Submission rejected', 'Review updated');
            callback();
        }
        return;
    }

    const targetHandles = getSelectedHandles(checklist);
    if (publishMode === 'selected' && targetHandles.length === 0) {
        toastr.error('Choose at least one recipient.', 'Review cancelled');
        return;
    }

    const approved = await reviewCharacterSubmission({
        id: submission.id,
        action: 'approve',
        publishMode,
        targetHandles,
        publishedFilename,
        reviewNote,
    });

    if (approved) {
        toastr.success(`Published ${approved.publishedFilename || approved.characterName}`, 'Submission approved');
        callback();
    }
}

/**
 * Opens the admin distribution popup for an existing character card.
 * @param {{ name: string, avatar: string }} character
 * @returns {Promise<void>}
 */
export async function openCharacterDistributePopup(character) {
    if (!isAdmin()) {
        return;
    }

    const users = (await getUsers() || []).filter(user => user.enabled);
    let publishMode = 'selected';
    let publishedFilename = String(character?.name || '').trim();
    const checklist = buildUserChecklist(users);

    const container = $(`
        <div class="flex-container flexFlowColumn flexGap10">
            <h3 class="margin0">Distribute Character</h3>
            <div class="opacity50p distribute-character-name"></div>
            <label class="flex-container flexFlowColumn flexNoGap">
                <span>Publish Mode</span>
                <select class="text_pole distribute-publish-mode">
                    <option value="selected">Selected Users</option>
                    <option value="global">Global</option>
                </select>
            </label>
            <label class="flex-container flexFlowColumn flexNoGap">
                <span>Published Filename</span>
                <input class="text_pole distribute-published-filename" type="text">
            </label>
            <div class="distribute-targets-block flex-container flexFlowColumn flexGap5">
                <span>Recipients</span>
            </div>
        </div>
    `);

    container.find('.distribute-character-name').text(`${character.name} (${character.avatar})`);
    container.find('.distribute-publish-mode').val(publishMode).on('change', function () {
        publishMode = String($(this).val());
        container.find('.distribute-targets-block').toggle(publishMode === 'selected');
    });
    container.find('.distribute-published-filename').val(publishedFilename).on('input', function () {
        publishedFilename = String($(this).val());
    });
    container.find('.distribute-targets-block').append(checklist).toggle(publishMode === 'selected');

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Distribute',
        cancelButton: 'Cancel',
        wide: true,
        allowVerticalScrolling: true,
    });

    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }

    const targetHandles = getSelectedHandles(checklist);
    if (publishMode === 'selected' && targetHandles.length === 0) {
        toastr.error('Choose at least one recipient.', 'Distribution cancelled');
        return;
    }

    const distribution = await distributeCharacterRequest({
        sourceType: 'character',
        sourceAvatar: character.avatar,
        publishMode,
        targetHandles,
        publishedFilename,
    });

    if (distribution) {
        toastr.success(`Distributed ${distribution.publishedFilename}`, 'Character published');
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
            toastr.error(data.error || 'Unknown error', 'Failed to enable user');
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
            toastr.error(data?.error || 'Unknown error', 'Failed to disable user');
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
            toastr.error(data.error || 'Unknown error', 'Failed to promote user');
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
            toastr.error(data.error || 'Unknown error', 'Failed to demote user');
            throw new Error('Failed to demote user');
        }

        callback();
    } catch (error) {
        console.error('Error demoting user:', error);
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
        toastr.error(errors.join(', '), 'Failed to create user');
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

    try {
        const response = await fetch('/api/users/create', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to create user');
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
        toastr.info('Please wait for the download to start.', 'Backup Requested');
        const response = await fetch('/api/users/backup', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to backup user data');
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
        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: 'Change', cancelButton: 'Cancel', wide: false, large: false });
        if (result === POPUP_RESULT.CANCELLED || result === POPUP_RESULT.NEGATIVE) {
            throw new Error('Change password cancelled');
        }

        if (newPassword !== confirmPassword) {
            toastr.error('Passwords do not match', 'Failed to change password');
            throw new Error('Passwords do not match');
        }

        const response = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, newPassword, oldPassword }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to change password');
            throw new Error('Failed to change password');
        }

        toastr.success('Password changed successfully', 'Password Changed');
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
            toastr.error('Cannot delete yourself', 'Failed to delete user');
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

        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: 'Delete', cancelButton: 'Cancel', wide: false, large: false });

        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Delete user cancelled');
        }

        if (handle !== confirmHandle) {
            toastr.error('Handles do not match', 'Failed to delete user');
            throw new Error('Handles do not match');
        }

        const response = await fetch('/api/users/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, purge }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to delete user');
            throw new Error('Failed to delete user');
        }

        toastr.success('User deleted successfully', 'User Deleted');
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
        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: 'Reset', cancelButton: 'Cancel', wide: false, large: false });

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
            toastr.error(data.error || 'Unknown error', 'Failed to reset settings');
            throw new Error('Failed to reset settings');
        }

        toastr.success('Settings reset successfully', 'Settings Reset');
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
        const result = await callGenericPopup(template, POPUP_TYPE.INPUT, name, { okButton: 'Change', cancelButton: 'Cancel', wide: false, large: false });

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
            toastr.error(data.error || 'Unknown error', 'Failed to change name');
            throw new Error('Failed to change name');
        }

        toastr.success('Name changed successfully', 'Name Changed');
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
            `Are you sure you want to restore the settings from "${name}"?`,
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Restore', cancelButton: 'Cancel', wide: false, large: false },
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
            toastr.error(data.error || 'Unknown error', 'Failed to restore snapshot');
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
            toastr.error(data.error || 'Unknown error', 'Failed to load snapshot content');
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
            toastr.error(data.error || 'Unknown error', 'Failed to get settings snapshots');
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
            toastr.error(data.error || 'Unknown error', 'Failed to make snapshot');
            throw new Error('Failed to make snapshot');
        }

        toastr.success('Snapshot created successfully', 'Snapshot Created');
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

    callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: false, large: false, allowVerticalScrolling: true });
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
            toastr.error(data.error || 'Unknown error', 'Failed to reset');
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
            { okButton: 'Reset', cancelButton: 'Cancel', wide: false, large: false },
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
            toastr.error(data.error || 'Unknown error', 'Failed to reset');
            throw new Error('Failed to reset everything');
        }

        toastr.success('Everything reset successfully', 'Reset Everything');
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
    template.find('.userRole').text(currentUser.admin ? 'Admin' : 'User');
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
        okButton: 'Close',
        wide: false,
        large: false,
        allowVerticalScrolling: true,
        allowHorizontalScrolling: false,
    };
    callGenericPopup(template, POPUP_TYPE.TEXT, '', popupOptions);
}

/**
 * Crop and upload an avatar image.
 * @param {string} handle User handle
 * @param {File} file Avatar file
 * @returns {Promise<string>}
 */
async function cropAndUploadAvatar(handle, file) {
    const dataUrl = await getBase64Async(await ensureImageFormatSupported(file));
    const croppedImage = await callGenericPopup('Set the crop position of the avatar image', POPUP_TYPE.CROP, '', { cropAspect: 1, cropImage: dataUrl });
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
            toastr.error(data.error || 'Unknown error', 'Failed to change avatar');
            return;
        }
    } catch (error) {
        console.error('Error changing avatar:', error);
    }
}

async function openAdminPanel() {
    async function renderUsers() {
        const users = await getUsers();
        template.find('.usersList').empty();
        for (const user of users) {
            const userBlock = template.find('.userAccountTemplate .userAccount').clone();
            userBlock.find('.userName').text(user.name);
            userBlock.find('.userHandle').text(user.handle);
            userBlock.find('.userStatus').text(user.enabled ? 'Enabled' : 'Disabled');
            userBlock.find('.userRole').text(user.admin ? 'Admin' : 'User');
            userBlock.find('.avatar img').attr('src', user.avatar);
            userBlock.find('.hasPassword').toggle(user.password);
            userBlock.find('.noPassword').toggle(!user.password);
            userBlock.find('.userCreated').text(new Date(user.created).toLocaleString());
            userBlock.find('.userEnableButton').toggle(!user.enabled).on('click', () => enableUser(user.handle, renderUsers));
            userBlock.find('.userDisableButton').toggle(user.enabled).on('click', () => disableUser(user.handle, renderUsers));
            userBlock.find('.userPromoteButton').toggle(!user.admin).on('click', () => promoteUser(user.handle, renderUsers));
            userBlock.find('.userDemoteButton').toggle(user.admin).on('click', () => demoteUser(user.handle, renderUsers));
            userBlock.find('.userChangePasswordButton').on('click', () => changePassword(user.handle, renderUsers));
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
    }

    async function renderSubmissions() {
        const submissions = await getCharacterSubmissions();
        renderSubmissionCards(template.find('.submissionsList'), submissions, {
            admin: true,
            onReview: (submission) => openSubmissionReviewPopup(submission, renderSubmissions),
        });
    }

    const template = $(await renderTemplateAsync('admin'));

    template.find('.adminNav > button').on('click', function () {
        const target = String($(this).data('target-tab'));
        template.find('.navTab').each(function () {
            $(this).toggle(this.classList.contains(target));
        });
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
    template.find('.manageSubmissionsButton').on('click', () => renderSubmissions());
    template.find('.refreshSubmissionQueueButton').on('click', () => renderSubmissions());

    callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: false, large: false, allowVerticalScrolling: true, allowHorizontalScrolling: false });
    renderUsers();
    renderSubmissions();
}

/**
 * Log out the current user.
 * @returns {Promise<void>}
 */
async function logout() {
    await fetch('/api/users/logout', {
        method: 'POST',
        headers: getRequestHeaders(),
    });

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
    $('#account_button').on('click', () => {
        openUserProfile();
    });
    setInterval(async () => {
        if (currentUser) {
            await extendUserSession();
        }
    }, SESSION_EXTEND_INTERVAL);
});
