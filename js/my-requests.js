/**
 * 我的補卡申請（員工自助管理）
 *
 * 職責：
 *   - loadMyRequests(): 呼叫 getReviewRequest({ userId: self, audit: 'all' })
 *   - renderMyRequests(items, filter): 依篩選 chip 顯示，audit='?' 顯示 編輯 / 刪除 按鈕
 *   - 編輯 modal：修改 datetime + note，提交 updateAdjustRequest
 *   - 刪除 confirm：呼叫 deleteAdjustRequest
 *
 * 依賴全域：callApifetch、showNotification、showConfirmDialog、DOMPurify、
 *           renderTranslations、t（i18n）、cacheManager
 *
 * 被 app.js 在 bindEvents 時掛 tab click handler + refresh button
 */

(function () {
    'use strict';

    let _currentFilter = '?'; // 預設先看待審核（員工最常需要動作的）
    let _cachedItems = [];

    const $ = (id) => document.getElementById(id);
    const tt = (key, fallback) => (typeof t === 'function' ? (t(key) || fallback) : fallback);

    /**
     * 載入「我的申請」列表
     */
    async function loadMyRequests({ force = false } = {}) {
        const loading = $('my-requests-loading');
        const empty = $('my-requests-empty');
        const list = $('my-requests-list');
        if (!list) return;

        if (loading) loading.style.display = 'block';
        if (empty) empty.style.display = 'none';
        list.innerHTML = '';

        try {
            const sessionUserId = localStorage.getItem('sessionUserId');
            if (!sessionUserId) {
                if (loading) loading.style.display = 'none';
                if (empty) {
                    empty.textContent = tt('MY_REQUESTS_NOT_LOGGED_IN', '請先登入');
                    empty.style.display = 'block';
                }
                return;
            }

            const res = await callApifetch({
                action: 'getReviewRequest',
                userId: sessionUserId,
                audit: 'all',
                limit: 200,
            });

            if (!res || !res.ok) {
                if (loading) loading.style.display = 'none';
                if (empty) {
                    empty.textContent = tt('MY_REQUESTS_LOAD_FAILED', '取得申請失敗：') +
                        (res?.code || res?.msg || 'unknown');
                    empty.style.display = 'block';
                }
                return;
            }

            // 只看「補打卡」的（過濾掉 系統請假記錄 之類）
            // remark === '補打卡' 是 adjustmentType 的字串
            _cachedItems = (res.reviewRequest || []).filter((r) =>
                r.remark === '補打卡' || r.adjustmentType === '補打卡' || /補打卡/.test(r.remark || '')
            );

            if (loading) loading.style.display = 'none';
            renderMyRequests();
        } catch (err) {
            console.error('loadMyRequests 失敗:', err);
            if (loading) loading.style.display = 'none';
            if (empty) {
                empty.textContent = tt('MY_REQUESTS_LOAD_FAILED', '取得申請失敗：') + (err?.message || 'error');
                empty.style.display = 'block';
            }
        }
    }

    /**
     * 依當前 filter 渲染清單
     */
    function renderMyRequests() {
        const list = $('my-requests-list');
        const empty = $('my-requests-empty');
        if (!list) return;

        const items = _cachedItems.filter((r) => {
            if (_currentFilter === 'all') return true;
            return (r.audit || '?') === _currentFilter;
        });

        list.innerHTML = '';
        if (items.length === 0) {
            if (empty) {
                empty.textContent = tt('MY_REQUESTS_EMPTY', '目前沒有符合條件的補卡申請。');
                empty.style.display = 'block';
            }
            return;
        }
        if (empty) empty.style.display = 'none';

        // 按時間倒序（已經是後端 orderBy timestamp desc）
        items.forEach((r) => {
            const li = document.createElement('li');
            li.className = 'p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50';

            const audit = r.audit || '?';
            const statusInfo = _statusBadge(audit);
            const typeText = r.type || '';
            const targetTime = r.targetTime || '';
            const appTime = r.applicationTime || '';
            const isPending = audit === '?';

            const safeId = String(r.id || '').replace(/[^a-zA-Z0-9_-]/g, '');

            // XSS safe: 透過 DOMPurify
            const html = `
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-base font-bold text-gray-800 dark:text-white">${tt('PUNCH_' + (typeText === '上班' ? 'IN' : 'OUT'), typeText)}</span>
                            ${statusInfo}
                        </div>
                        <p class="text-sm text-gray-700 dark:text-gray-200">
                            <span class="text-gray-500 dark:text-gray-400">${tt('MY_REQUESTS_TARGET_TIME', '目標時間：')}</span>
                            ${targetTime}
                        </p>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            ${tt('MY_REQUESTS_APPLY_TIME', '申請時間：')}${appTime}
                        </p>
                    </div>
                    ${isPending ? `
                        <div class="flex flex-col gap-1 shrink-0">
                            <button class="my-req-edit-btn px-3 py-1 text-xs font-medium rounded
                                           bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200
                                           border border-indigo-300 dark:border-indigo-700
                                           hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                                    data-id="${safeId}">
                                ${tt('BTN_EDIT', '修改')}
                            </button>
                            <button class="my-req-delete-btn px-3 py-1 text-xs font-medium rounded
                                           bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200
                                           border border-red-300 dark:border-red-700
                                           hover:bg-red-100 dark:hover:bg-red-900/50"
                                    data-id="${safeId}">
                                ${tt('BTN_DELETE', '刪除')}
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
            li.innerHTML = DOMPurify.sanitize(html);
            list.appendChild(li);
        });
    }

    function _statusBadge(audit) {
        if (audit === 'v') {
            return `<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">${tt('STATUS_APPROVED', '已核准')}</span>`;
        }
        if (audit === 'x') {
            return `<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">${tt('STATUS_REJECTED', '已退回')}</span>`;
        }
        return `<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">${tt('STATUS_PENDING', '待審核')}</span>`;
    }

    /**
     * 開啟編輯 modal
     */
    function _openEditModal(id) {
        const item = _cachedItems.find((r) => String(r.id) === String(id));
        if (!item) {
            showNotification(tt('MSG_NOT_FOUND', '找不到該申請'), 'error');
            return;
        }

        // 移除既有 modal
        let modal = $('my-req-edit-modal');
        if (modal) modal.remove();

        // 將 targetTime ('YYYY-MM-DD HH:mm:ss') 轉為 datetime-local 格式 'YYYY-MM-DDTHH:mm'
        const tt2dt = (s) => {
            if (!s) return '';
            const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
            return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : '';
        };

        modal = document.createElement('div');
        modal.id = 'my-req-edit-modal';
        modal.className = 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4';
        modal.innerHTML = DOMPurify.sanitize(`
            <div class="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-md shadow-2xl">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-lg font-bold text-gray-900 dark:text-white">
                        ${tt('MY_REQUESTS_EDIT_TITLE', '修改補卡申請')}
                    </h3>
                    <button id="my-req-edit-close" class="text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white text-2xl leading-none" aria-label="關閉">&times;</button>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-300 mb-1">
                    ${tt('LABEL_TYPE', '類型')}：<span class="font-semibold">${item.type || ''}</span>
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    ${tt('MY_REQUESTS_ORIGINAL', '原時間')}：${item.targetTime || ''}
                </p>
                <div class="space-y-3">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            ${tt('SELECT_DATETIME_LABEL', '選擇日期與時間')}
                        </label>
                        <input type="datetime-local" id="my-req-edit-datetime"
                               value="${tt2dt(item.targetTime)}"
                               class="w-full p-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            ${tt('NOTE_LABEL', '備註（可選）')}
                        </label>
                        <input type="text" id="my-req-edit-note"
                               placeholder="${tt('MY_REQUESTS_NOTE_PLACEHOLDER', '修改原因 / 補充說明')}"
                               class="w-full p-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                    </div>
                </div>
                <div class="mt-4 flex gap-2">
                    <button id="my-req-edit-submit"
                            class="flex-1 py-2 px-4 rounded-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition">
                        ${tt('BTN_SAVE', '儲存修改')}
                    </button>
                    <button id="my-req-edit-cancel"
                            class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        ${tt('BTN_CANCEL', '取消')}
                    </button>
                </div>
            </div>
        `);
        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        $('my-req-edit-close').addEventListener('click', close);
        $('my-req-edit-cancel').addEventListener('click', close);

        $('my-req-edit-submit').addEventListener('click', async () => {
            const datetime = $('my-req-edit-datetime').value;
            const note = $('my-req-edit-note').value;
            if (!datetime) {
                showNotification(tt('MSG_PLEASE_SELECT_REPAIR_DATETIME', '請選擇日期時間'), 'error');
                return;
            }

            const submitBtn = $('my-req-edit-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = tt('LOADING', '處理中...');

            try {
                const isoStr = new Date(datetime).toISOString();
                const res = await callApifetch({
                    action: 'updateAdjustRequest',
                    id: item.id,
                    datetime: isoStr,
                    note: note || '',
                });
                if (!res || !res.ok) {
                    showNotification(tt(res?.code || 'UNKNOWN_ERROR', res?.msg || '修改失敗'), 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = tt('BTN_SAVE', '儲存修改');
                    return;
                }
                showNotification(tt('MY_REQUESTS_UPDATE_SUCCESS', '已更新申請'), 'success');
                close();
                // 重新載入（後端有快取失效，安全起見也清前端 month cache）
                try {
                    if (typeof cacheManager !== 'undefined' && cacheManager?.clear) {
                        cacheManager.clear('month');
                        cacheManager.clear('abnormal');
                    }
                } catch (_) { /* ignore */ }
                await loadMyRequests({ force: true });
            } catch (err) {
                console.error('updateAdjustRequest 失敗:', err);
                showNotification(tt('NETWORK_ERROR', '網路錯誤'), 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = tt('BTN_SAVE', '儲存修改');
            }
        });
    }

    /**
     * 刪除單筆（confirm + API call）
     */
    async function _confirmDelete(id) {
        const item = _cachedItems.find((r) => String(r.id) === String(id));
        if (!item) {
            showNotification(tt('MSG_NOT_FOUND', '找不到該申請'), 'error');
            return;
        }
        const confirmMsg = tt('MY_REQUESTS_DELETE_CONFIRM', '確定要刪除這筆補卡申請？此操作無法復原。') +
            `\n\n${item.type || ''} @ ${item.targetTime || ''}`;
        const confirmed = typeof showConfirmDialog === 'function'
            ? await showConfirmDialog(confirmMsg)
            : window.confirm(confirmMsg);
        if (!confirmed) return;

        try {
            const res = await callApifetch({
                action: 'deleteAdjustRequest',
                id: item.id,
            });
            if (!res || !res.ok) {
                showNotification(tt(res?.code || 'UNKNOWN_ERROR', res?.msg || '刪除失敗'), 'error');
                return;
            }
            showNotification(tt('MY_REQUESTS_DELETE_SUCCESS', '已刪除申請'), 'success');
            try {
                if (typeof cacheManager !== 'undefined' && cacheManager?.clear) {
                    cacheManager.clear('month');
                    cacheManager.clear('abnormal');
                }
            } catch (_) { /* ignore */ }
            await loadMyRequests({ force: true });
        } catch (err) {
            console.error('deleteAdjustRequest 失敗:', err);
            showNotification(tt('NETWORK_ERROR', '網路錯誤'), 'error');
        }
    }

    /**
     * 切換 filter chip active 樣式 + 重 render
     */
    function _setFilter(newFilter) {
        _currentFilter = newFilter;
        const buttons = document.querySelectorAll('.my-req-filter-btn');
        buttons.forEach((btn) => {
            const isActive = btn.dataset.filter === newFilter;
            // 移掉所有 ring 與 active bg，再依 newFilter 加回 active style
            btn.classList.remove('ring-2', 'ring-amber-500', 'ring-green-500', 'ring-red-500', 'ring-indigo-500',
                'bg-amber-100', 'dark:bg-amber-900/40', 'text-amber-700', 'dark:text-amber-200',
                'bg-green-100', 'dark:bg-green-900/40', 'text-green-700', 'dark:text-green-200',
                'bg-red-100', 'dark:bg-red-900/40', 'text-red-700', 'dark:text-red-200',
                'bg-indigo-100', 'dark:bg-indigo-900/40', 'text-indigo-700', 'dark:text-indigo-200',
                'bg-gray-100', 'dark:bg-gray-800', 'text-gray-700', 'dark:text-gray-300');

            if (isActive) {
                if (newFilter === '?') btn.classList.add('bg-amber-100', 'dark:bg-amber-900/40', 'text-amber-700', 'dark:text-amber-200', 'ring-2', 'ring-amber-500');
                else if (newFilter === 'v') btn.classList.add('bg-green-100', 'dark:bg-green-900/40', 'text-green-700', 'dark:text-green-200', 'ring-2', 'ring-green-500');
                else if (newFilter === 'x') btn.classList.add('bg-red-100', 'dark:bg-red-900/40', 'text-red-700', 'dark:text-red-200', 'ring-2', 'ring-red-500');
                else btn.classList.add('bg-indigo-100', 'dark:bg-indigo-900/40', 'text-indigo-700', 'dark:text-indigo-200', 'ring-2', 'ring-indigo-500');
            } else {
                btn.classList.add('bg-gray-100', 'dark:bg-gray-800', 'text-gray-700', 'dark:text-gray-300');
            }
        });
        renderMyRequests();
    }

    /**
     * 初始化事件委派（在 DOMContentLoaded 或 app.js bindEvents 內呼叫一次）
     */
    function initMyRequests() {
        // 篩選 chip
        document.addEventListener('click', (e) => {
            const filterBtn = e.target.closest('.my-req-filter-btn');
            if (filterBtn) {
                _setFilter(filterBtn.dataset.filter);
                return;
            }
            const editBtn = e.target.closest('.my-req-edit-btn');
            if (editBtn) {
                _openEditModal(editBtn.dataset.id);
                return;
            }
            const deleteBtn = e.target.closest('.my-req-delete-btn');
            if (deleteBtn) {
                _confirmDelete(deleteBtn.dataset.id);
                return;
            }
        });

        // refresh button
        const refreshBtn = $('my-requests-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => loadMyRequests({ force: true }));
        }
    }

    // 暴露給 ui.js switchTab 與 app.js
    window.loadMyRequests = loadMyRequests;
    window.initMyRequests = initMyRequests;

    // module 載入時自動 init（事件委派只綁一次）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMyRequests);
    } else {
        initMyRequests();
    }
})();

console.log('✓ my-requests 模組已加載');
