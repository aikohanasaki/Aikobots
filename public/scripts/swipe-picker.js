import { SWIPE_DIRECTION, SWIPE_SOURCE } from './constants.js';
import { t } from './i18n.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { power_user } from './power-user.js';
import { isMobile } from './RossAscends-mods.js';
import { getTokenCountAsync } from './tokenizers.js';
import { addLongPressEvent, clamp, copyText, timestampToMoment } from './utils.js';
import { chat, deleteSwipe, ensureSwipes, isMessageSwipeable, isSwipingAllowed, swipe, syncMesToSwipe } from '/script.js';

export function canOpenSwipePickerForMessage(messageId) {
    const message = chat[messageId];
    if (!message) {
        return false;
    }

    if (ensureSwipes(message)) {
        syncMesToSwipe(messageId);
    }

    return Boolean(
        message?.swipes?.length > 1 &&
        !message?.is_user &&
        !(message?.extra?.isSmallSys) &&
        !(message?.extra?.swipeable === false),
    );
}

export function canJumpToSwipeForMessage(messageId) {
    const message = chat[messageId];
    return canOpenSwipePickerForMessage(messageId) && isSwipingAllowed() && isMessageSwipeable(messageId, message);
}

async function openSwipePicker(messageId) {
    const message = chat[messageId];
    if (!canOpenSwipePickerForMessage(messageId)) {
        toastr.info(t`This message has no alternate swipes yet.`, t`Jump to Swipe`);
        return;
    }

    const canJumpToSwipe = canJumpToSwipeForMessage(messageId);
    let selectedSwipeId = clamp(Number(message.swipe_id ?? 0), 0, message.swipes.length - 1);
    const swipeIdInputId = `swipe_picker_id_${messageId}`;
    const wrapper = document.createElement('div');
    wrapper.classList.add('swipe_picker_popup_body', 'flex-container', 'flexFlowColumn', 'wide100p');

    const listContainer = document.createElement('div');
    listContainer.classList.add('swipe_picker_div', 'flex1');
    wrapper.appendChild(listContainer);

    /** @type {Popup} */
    let popup;
    /** @type {HTMLInputElement|null} */
    let swipeIdInput = null;

    function syncSwipeIdInput() {
        if (swipeIdInput) {
            swipeIdInput.value = String(selectedSwipeId + 1);
        }
    }

    function setSelectedSwipe(nextSwipeId) {
        selectedSwipeId = clamp(Number(nextSwipeId), 0, message.swipes.length - 1);
        listContainer.querySelectorAll('.swipe_picker_block').forEach((element) => {
            const isSelected = Number(element.getAttribute('data-swipe-id')) === selectedSwipeId;
            element.toggleAttribute('highlight', isSelected);
        });
        syncSwipeIdInput();
    }

    function canDeleteSwipeFromPicker(swipeId) {
        if ((message?.swipes?.length ?? 0) <= 1) {
            return false;
        }

        const currentSwipeId = clamp(Number(message.swipe_id ?? 0), 0, message.swipes.length - 1);
        return canJumpToSwipe || swipeId !== currentSwipeId;
    }

    async function renderSwipeList() {
        const blocks = await Promise.all(message.swipes.map(async (swipeText, index) => {
            const swipe = String(swipeText ?? '');
            const previewText = swipe.replace(/\s+/g, ' ').trim();
            const swipeInfo = Array.isArray(message.swipe_info) ? message.swipe_info[index] : null;
            const tokenCount = swipeInfo?.extra?.token_count ?? await getTokenCountAsync(swipe, 0);
            const sendDate = swipeInfo?.send_date ? timestampToMoment(swipeInfo.send_date).format('lll') : '';
            const canDeleteSwipe = canDeleteSwipeFromPicker(index);

            const block = document.createElement('button');
            block.type = 'button';
            block.classList.add('swipe_picker_block');
            block.setAttribute('data-swipe-id', String(index));
            block.addEventListener('click', () => setSelectedSwipe(index));
            block.addEventListener('dblclick', async () => {
                if (canJumpToSwipe) {
                    setSelectedSwipe(index);
                    await popup.completeAffirmative();
                }
            });

            const header = document.createElement('span');
            header.classList.add('swipe_picker_block_header');
            header.textContent = `#${index + 1}${index === Number(message.swipe_id ?? 0) ? ` ${t`[Current]`}` : ''}`;

            const details = document.createElement('span');
            details.classList.add('swipe_picker_block_details');
            details.textContent = [sendDate, previewText ? `${previewText.length} ${t`chars`}` : '', tokenCount ? `${tokenCount}t` : ''].filter(Boolean).join(' | ');

            const preview = document.createElement('span');
            preview.classList.add('swipe_picker_block_preview');
            preview.textContent = previewText ? swipe : t`(empty swipe)`;

            const actions = document.createElement('span');
            actions.classList.add('swipe_picker_actions');

            const copyButton = document.createElement('span');
            copyButton.classList.add('swipe_picker_copy', 'fa-solid', 'fa-copy');
            copyButton.title = t`Copy`;
            copyButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await copyText(swipe);
                toastr.info(t`Copied!`, '', { timeOut: 2000 });
            });

            const deleteButton = document.createElement('span');
            deleteButton.classList.add('swipe_picker_delete', 'fa-solid', 'fa-trash-can');
            deleteButton.setAttribute('aria-disabled', String(!canDeleteSwipe));
            deleteButton.classList.toggle('disabled', !canDeleteSwipe);
            deleteButton.title = canDeleteSwipe ? t`Delete Swipe` : '';
            deleteButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canDeleteSwipe) {
                    return;
                }

                if (power_user.confirm_message_delete) {
                    const confirm = await Popup.show.confirm(t`Are you sure you want to delete swipe #${index + 1}?`, '', {
                        okButton: t`Delete Swipe`,
                        cancelButton: t`Cancel`,
                    });
                    if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
                        return;
                    }
                }

                const nextSelectedSwipeId = index < selectedSwipeId
                    ? selectedSwipeId - 1
                    : index > selectedSwipeId
                        ? selectedSwipeId
                        : Math.min(selectedSwipeId, message.swipes.length - 2);
                const newSwipeId = await deleteSwipe(index, messageId);
                if (!Number.isInteger(newSwipeId)) {
                    return;
                }

                selectedSwipeId = clamp(nextSelectedSwipeId, 0, message.swipes.length - 1);
                if (swipeIdInput) {
                    swipeIdInput.max = String(message.swipes.length);
                }
                await renderSwipeList();
            });

            actions.append(copyButton, deleteButton);
            block.append(header, details, preview, actions);
            return block;
        }));

        listContainer.replaceChildren(...blocks);
        setSelectedSwipe(selectedSwipeId);
    }

    popup = new Popup(wrapper, POPUP_TYPE.CONFIRM, t`Swipe Selection`, {
        okButton: canJumpToSwipe ? t`Go` : false,
        cancelButton: false,
        customInputs: [{
            id: swipeIdInputId,
            label: t`Swipe ID`,
            type: 'text',
            defaultState: String(selectedSwipeId + 1),
            tooltip: `1-${message.swipes.length}`,
        }],
        large: true,
        wider: true,
        allowVerticalScrolling: true,
        onClosing: function (popup) {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            const input = popup.dlg.querySelector(`#${swipeIdInputId}`);
            const targetSwipeNumber = Number.parseInt(String(input instanceof HTMLInputElement ? input.value : '').trim(), 10);
            if (!Number.isInteger(targetSwipeNumber) || targetSwipeNumber < 1 || targetSwipeNumber > message.swipes.length) {
                toastr.warning(t`Enter a swipe ID between 1 and ${message.swipes.length}.`, t`Jump to Swipe`);
                return false;
            }

            setSelectedSwipe(targetSwipeNumber - 1);
            return true;
        },
    });

    popup.dlg.classList.add('swipe_picker_popup');
    swipeIdInput = popup.dlg.querySelector(`#${swipeIdInputId}`);
    if (swipeIdInput instanceof HTMLInputElement) {
        swipeIdInput.type = 'number';
        swipeIdInput.min = '1';
        swipeIdInput.max = String(message.swipes.length);
        swipeIdInput.step = '1';
        swipeIdInput.inputMode = 'numeric';
        swipeIdInput.addEventListener('input', function () {
            const nextSwipeId = Number.parseInt(this.value, 10);
            if (Number.isInteger(nextSwipeId) && nextSwipeId >= 1 && nextSwipeId <= message.swipes.length) {
                setSelectedSwipe(nextSwipeId - 1);
            }
        });
        swipeIdInput.addEventListener('blur', syncSwipeIdInput);
    }

    await renderSwipeList();
    const popupResult = await popup.show();

    if (popupResult !== POPUP_RESULT.AFFIRMATIVE || !canJumpToSwipe) {
        return;
    }

    const targetSwipeId = clamp(selectedSwipeId, 0, message.swipes.length - 1);
    const currentSwipeId = clamp(Number(message.swipe_id ?? 0), 0, message.swipes.length - 1);
    if (targetSwipeId === currentSwipeId) {
        toastr.info(t`Already showing swipe #${targetSwipeId + 1}.`, t`Jump to Swipe`);
        return;
    }

    const direction = targetSwipeId > currentSwipeId ? SWIPE_DIRECTION.RIGHT : SWIPE_DIRECTION.LEFT;
    await swipe(null, direction, { source: SWIPE_SOURCE.SWIPE_PICKER, forceMesId: messageId, forceSwipeId: targetSwipeId });
}

export function initSwipePicker() {
    async function onSwipeCounterClick(e) {
        e.preventDefault();
        e.stopPropagation();

        const mesId = Number($(this).closest('.mes').attr('mesid'));
        await openSwipePicker(mesId);
    }

    if (isMobile()) {
        addLongPressEvent('.swipes-counter.swipe-picker-enabled', onSwipeCounterClick);
    } else {
        $(document).on('click', '.swipes-counter.swipe-picker-enabled', onSwipeCounterClick);
    }

    $(document).on('keydown', '.swipes-counter.swipe-picker-enabled', async function (e) {
        if (e.key === ' ') {
            await onSwipeCounterClick.call(this, e);
        }
    });

    $(document).on('click', '.mes_swipe_picker', async function (e) {
        e.preventDefault();
        e.stopPropagation();

        const mesId = Number($(this).closest('.mes').attr('mesid'));
        await openSwipePicker(mesId);
    });
}
