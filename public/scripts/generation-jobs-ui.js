import { getRequestHeaders } from '../script.js';
import { t } from './i18n.js';
import { POPUP_RESULT, POPUP_TYPE, Popup, callGenericPopup } from './popup.js';
import { cancelGenerationWithConfirmation } from './generation-recovery.js';

/** Shows account allowances and active jobs, with explicit per-job cancellation. */
export async function openGenerationJobs() {
    const root = document.createElement('div');
    root.className = 'flex-container flexFlowColumn flexGap10';
    const heading = document.createElement('h3');
    heading.textContent = t`My Generation Jobs`;
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'menu_button';
    refresh.textContent = t`Refresh`;
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    const content = document.createElement('div');
    root.append(heading, refresh, notice, content);

    const addText = (parent, text, tag = 'p') => {
        const element = document.createElement(tag);
        element.textContent = text;
        parent.append(element);
    };
    const age = (now, timestamp) => {
        const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return t`${hours} h ${minutes} min ${seconds % 60} s`;
    };

    const load = async () => {
        root.querySelectorAll('button').forEach(button => { button.disabled = true; });
        notice.textContent = t`Loading generation jobs…`;
        try {
            const response = await fetch('/api/backends/chat-completions/generations/active', {
                headers: getRequestHeaders(), cache: 'no-store', signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) throw new Error('Generation jobs unavailable.');
            const { jobs, account, limits, serverTime, staleAfterMs } = await response.json();
            content.replaceChildren();
            addText(content, t`Generation allowances`, 'h4');
            addText(content, t`Non-patrons: ${limits.standardConcurrent} concurrent generation(s). Patrons: ${limits.patronConcurrent} concurrent generation(s).`);
            addText(content, t`Your account`, 'h4');
            addText(content, account.patron ? t`Patron: Yes` : t`Patron: No`);
            if (!account.accountsEnabled) addText(content, t`Accounts are disabled; the configured concurrent allowance applies.`);
            else if (account.admin) addText(content, t`Administrators receive the configured patron allowance.`);
            addText(content, t`Your concurrent allowance: ${limits.concurrent}. Maximum outstanding jobs: ${limits.outstanding}.`);
            addText(content, t`Outstanding jobs include running jobs, queued jobs, and jobs awaiting cancellation. The maximum is your concurrent allowance plus the queue allowance.`);
            const occupied = jobs.filter(job => ['running', 'cancel_requested'].includes(job.state)).length;
            const queued = jobs.filter(job => job.state === 'queued').length;
            const cancelling = jobs.filter(job => job.state === 'cancel_requested').length;
            addText(content, t`Concurrent slots occupied: ${occupied} / ${limits.concurrent}`);
            addText(content, t`Queued: ${queued}. Cancellation requested: ${cancelling}.`);
            if (occupied >= limits.concurrent) addText(content, t`Your concurrent generation limit is reached. Queued jobs must wait for a slot to become available.`);
            addText(content, t`Stalled jobs still occupy slots until stopped. Server-wide capacity can also cause waiting.`);
            addText(content, t`Your jobs`, 'h4');
            if (!jobs.length) addText(content, t`You have no active generation jobs.`);
            for (const job of jobs) {
                const row = document.createElement('div');
                row.className = 'flex-container flexFlowColumn flexGap10';
                addText(row, job.id, 'code');
                const state = job.state === 'queued' ? t`Queued`
                    : job.state === 'running' ? t`Running` : t`Cancellation requested`;
                addText(row, state);
                addText(row, t`Time since requested: ${age(serverTime, job.createdAt)}`);
                addText(row, t`Last activity: ${age(serverTime, job.updatedAt)} ago`);
                if (serverTime - job.updatedAt >= staleAfterMs) {
                    addText(row, t`No recent activity — may be stalled. Missing activity does not prove the job has stopped.`);
                }
                if (job.state === 'cancel_requested') {
                    addText(row, t`Cancellation requested. Stalled-worker cleanup may take about a minute. Refresh to check.`);
                } else {
                    const cancel = document.createElement('button');
                    cancel.type = 'button';
                    cancel.className = 'menu_button';
                    cancel.textContent = t`Cancel`;
                    cancel.addEventListener('click', async () => {
                        root.querySelectorAll('button').forEach(button => { button.disabled = true; });
                        try {
                            const confirmed = await Popup.show.confirm(t`Cancel generation?`, t`Stop this generation? Unfinished output may be lost. Saved chat messages will not be deleted.`);
                            if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;
                            const acknowledged = await cancelGenerationWithConfirmation(job.id, { getHeaders: getRequestHeaders });
                            if (acknowledged) await load();
                            else notice.textContent = t`Cancellation could not be confirmed. Refresh before retrying.`;
                        } finally {
                            root.querySelectorAll('button').forEach(button => { button.disabled = false; });
                        }
                    });
                    row.append(cancel);
                }
                content.append(row);
            }
            notice.textContent = '';
        } catch {
            notice.textContent = t`Could not refresh generation jobs. Any displayed information is outdated. Try Refresh again.`;
        } finally {
            root.querySelectorAll('button').forEach(button => { button.disabled = false; });
        }
    };
    refresh.addEventListener('click', load);
    const popup = callGenericPopup(root, POPUP_TYPE.TEXT, '', {
        okButton: t`Close`, allowVerticalScrolling: true, allowHorizontalScrolling: false,
    });
    await load();
    await popup;
}
