/**
Copyright (C) 2025 0J (Lin Jie / 0rigin1856)

This file is part of 0riginAttendance-System.

0riginAttendance-System is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 2 of the License, or
(at your option) any later version.

0riginAttendance-System is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with 0riginAttendance-System. If not, see <https://www.gnu.org/licenses/>.
Please credit "0J (Lin Jie / 0rigin1856)" when redistributing or modifying this project.
 */
// ===================================
// 補打卡模組（原 punch.js Region 4）
//
// 職責：
// - validateAdjustTime：驗證補打卡日期時間是否在合法範圍內
// - bindPunchEvents：綁定補打卡 Modal、請假/休假按鈕等 UI 事件
//
// 依賴全域：state.js 的 DOM 綁定、core.js 的 callApifetch/showNotification、
//           ui.js 的 generalButtonState、checkAbnormal（abnormal-records.js）
//
// 被 app.js:296 呼叫進行事件綁定初始化。
// ===================================

// ===================================
// #region 補打卡 UI 與 API 邏輯
// ===================================

function validateAdjustTime(value) {
    const selected = new Date(value);
    const now = new Date();
    // 這裡我們只檢查選取的時間是否在當前月份內且不晚於今天
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59); // 設置到今天最後一秒

    if (selected < monthStart) {
        showNotification(t("ERR_BEFORE_MONTH_START"), "error");
        return false;
    }
    // 不允許選今天以後
    if (selected > today) {
        showNotification(t("ERR_AFTER_TODAY"), "error");
        return false;
    }
    return true;
}

// ===================================
// 2026-05-14：月曆獨立補卡 Modal helpers
// ===================================

/**
 * 渲染補卡表單 HTML（mode = 'in' | 'out' | 'full'）
 *
 * @param {HTMLElement} container 目標容器
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} mode 'in' | 'out' | 'full'
 * @param {boolean} showModeSelector 是否顯示模式切換按鈕（月曆觸發 true，異常清單觸發 false）
 */
function _renderMakeupFormHtml(container, date, mode, showModeSelector) {
    const tt = (k, fallback) => (typeof t === 'function' ? (t(k) || fallback) : fallback);
    const isIn = mode === 'in';
    const isOut = mode === 'out';
    const isFull = mode === 'full';

    let formTitle, buttonsHtml, inputsHtml;

    if (isFull) {
        formTitle = tt('STATUS_BOTH_MISSING', '本日未打卡');
        inputsHtml = `
            <div class="form-group mb-3">
                <label for="adjustInTime" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${tt('LABEL_PUNCH_IN_TIME', '上班時間：')}</label>
                <input id="adjustInTime" type="datetime-local"
                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white focus:ring-indigo-500 focus:border-indigo-500">
            </div>
            <div class="form-group mb-3">
                <label for="adjustOutTime" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${tt('LABEL_PUNCH_OUT_TIME', '下班時間：')}</label>
                <input id="adjustOutTime" type="datetime-local"
                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white focus:ring-indigo-500 focus:border-indigo-500">
            </div>`;
        buttonsHtml = `<button data-type="full" data-i18n="BTN_ADJUST_FULL"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            ${tt('BTN_ADJUST_FULL', '補全日打卡')}
                        </button>`;
    } else {
        formTitle = isIn ? tt('STATUS_PUNCH_IN_MISSING', '未打上班卡') : tt('STATUS_PUNCH_OUT_MISSING', '未打下班卡');
        inputsHtml = `
            <div class="form-group mb-3">
                <label for="adjustDateTime" data-i18n="SELECT_DATETIME_LABEL" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${tt('SELECT_DATETIME_LABEL', '選擇日期與時間：')}</label>
                <input id="adjustDateTime" type="datetime-local"
                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white focus:ring-indigo-500 focus:border-indigo-500">
            </div>`;
        if (isIn) {
            buttonsHtml = `<button data-type="in" data-i18n="BTN_ADJUST_IN"
                                    class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                                ${tt('BTN_ADJUST_IN', '補全上班打卡')}
                            </button>`;
        } else {
            buttonsHtml = `<button data-type="out" data-i18n="BTN_ADJUST_OUT"
                                    class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                                ${tt('BTN_ADJUST_OUT', '補全下班打卡')}
                            </button>`;
        }
    }

    // Mode selector（3 個 segmented button）
    const activeCls = 'bg-indigo-600 text-white';
    const inactiveCls = 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600';
    const selectorHtml = showModeSelector ? `
        <div class="grid grid-cols-3 gap-1 mb-3 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <button type="button" class="makeup-mode-btn px-2 py-1 rounded text-sm font-medium transition ${isIn ? activeCls : inactiveCls}"
                    data-mode="in" data-date="${date}" data-i18n="MAKEUP_MODE_IN_ONLY">${tt('MAKEUP_MODE_IN_ONLY', '只補上班')}</button>
            <button type="button" class="makeup-mode-btn px-2 py-1 rounded text-sm font-medium transition ${isOut ? activeCls : inactiveCls}"
                    data-mode="out" data-date="${date}" data-i18n="MAKEUP_MODE_OUT_ONLY">${tt('MAKEUP_MODE_OUT_ONLY', '只補下班')}</button>
            <button type="button" class="makeup-mode-btn px-2 py-1 rounded text-sm font-medium transition ${isFull ? activeCls : inactiveCls}"
                    data-mode="full" data-date="${date}" data-i18n="MAKEUP_MODE_FULL">${tt('MAKEUP_MODE_FULL', '補全日')}</button>
        </div>` : '';

    const formHtml = `
        <div class="p-4 ${showModeSelector ? '' : 'border-t border-gray-200'} fade-in ">
            ${selectorHtml}
            <p class="font-semibold mb-2">${formTitle}：<span class="text-indigo-600">${date}</span></p>
            <div id="timeInputsContainer">${inputsHtml}</div>
            <div class="grid grid-cols-1 sm:grid-cols-1 gap-2">${buttonsHtml}</div>
        </div>`;

    container.innerHTML = DOMPurify.sanitize(formHtml);
    if (typeof renderTranslations === 'function') renderTranslations(container);

    // 設置默認時間值
    if (isFull) {
        const inEl = container.querySelector('#adjustInTime');
        const outEl = container.querySelector('#adjustOutTime');
        if (inEl) inEl.value = `${date}T08:00`;
        if (outEl) outEl.value = `${date}T18:00`;
    } else {
        const defaultTime = isIn ? '08:00' : '18:00';
        const el = container.querySelector('#adjustDateTime');
        if (el) el.value = `${date}T${defaultTime}`;
    }
}

// 2026-06-10：病假證明照片暫存（壓縮後的 base64 data URL，提交時帶給 submitLeave）
// 每次開「請假」表單時重置為 null
let _pendingLeaveProof = null;

/**
 * 開啟月曆 modal 並回傳 modal 內表單容器
 * @param {string} [titleKey] i18n 鍵（補打卡 / 請假 / 休假各自標題），預設補卡申請
 * @param {string} [titleFallback] 對應 fallback 文字
 */
function _openMakeupModal(titleKey, titleFallback) {
    const modal = document.getElementById('makeup-modal');
    if (!modal) return null;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const titleEl = document.getElementById('makeup-modal-title');
    if (titleEl) {
        const key = titleKey || 'MAKEUP_MODAL_TITLE';
        titleEl.setAttribute('data-i18n', key);
        titleEl.textContent = (typeof t === 'function' ? (t(key) || titleFallback) : titleFallback) || '補卡申請';
    }
    return document.getElementById('makeup-modal-form-container');
}

/**
 * 把圖檔壓縮成 JPEG base64 data URL（resize ≤ maxDim、quality 自適應）
 * 目標 < ~525KB（base64 ≤ ~700k 字元），確保 Firestore doc 遠低於 1MiB。
 * @returns {Promise<string>} data URL
 */
function _compressImageToDataUrl(file, maxDim = 1280, quality = 0.6) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\//.test(file.type)) {
            reject(new Error('not-image'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read-fail'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('decode-fail'));
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width >= height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                // 白底（避免 PNG 透明轉 JPEG 變黑）
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                let q = quality;
                let dataUrl = canvas.toDataURL('image/jpeg', q);
                while (dataUrl.length > 700000 && q > 0.3) {
                    q -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', q);
                }
                resolve(dataUrl);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// 病假證明照片：選檔 / 換檔 / 移除（document 事件委派，涵蓋兩個 host container）
document.addEventListener('click', (e) => {
    if (e.target.closest('#leaveProofPick')) {
        const input = document.getElementById('leaveProofInput');
        if (input) input.click();
    } else if (e.target.closest('#leaveProofRemove')) {
        _pendingLeaveProof = null;
        const preview = document.getElementById('leaveProofPreview');
        const removeBtn = document.getElementById('leaveProofRemove');
        const input = document.getElementById('leaveProofInput');
        if (preview) { preview.classList.add('hidden'); preview.src = ''; }
        if (removeBtn) removeBtn.classList.add('hidden');
        if (input) input.value = '';
    }
});
document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'leaveProofInput') {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const tt = (k, fb) => (typeof t === 'function' ? (t(k) || fb) : fb);
        try {
            const preview = document.getElementById('leaveProofPreview');
            const removeBtn = document.getElementById('leaveProofRemove');
            showNotification(tt('MSG_PHOTO_PROCESSING', '照片處理中...'), 'info');
            const dataUrl = await _compressImageToDataUrl(file);
            if (dataUrl.length > 700000) {
                showNotification(tt('MSG_PHOTO_TOO_LARGE', '照片太大，請重拍或換一張'), 'error');
                return;
            }
            _pendingLeaveProof = dataUrl;
            if (preview) { preview.src = dataUrl; preview.classList.remove('hidden'); }
            if (removeBtn) removeBtn.classList.remove('hidden');
        } catch (err) {
            console.error('壓縮照片失敗:', err);
            showNotification(tt('MSG_PHOTO_FAILED', '照片讀取失敗，請換一張'), 'error');
        }
    }
});

/** 產生病假證明照片區塊 HTML */
function _leaveProofSectionHtml() {
    const tt = (k, fb) => (typeof t === 'function' ? (t(k) || fb) : fb);
    return `
        <div class="form-group mb-3">
            <label class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300" data-i18n="LEAVE_PROOF_LABEL">${tt('LEAVE_PROOF_LABEL', '證明照片（病假請附，其他選填）')}</label>
            <input type="file" id="leaveProofInput" accept="image/*" capture="environment" class="hidden">
            <div class="flex items-center gap-2">
                <button type="button" id="leaveProofPick"
                        class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">
                    📷 <span data-i18n="BTN_ADD_PHOTO">${tt('BTN_ADD_PHOTO', '拍照 / 選擇照片')}</span>
                </button>
                <button type="button" id="leaveProofRemove"
                        class="hidden px-3 py-2 text-sm rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                    <span data-i18n="LEAVE_PROOF_REMOVE">${tt('LEAVE_PROOF_REMOVE', '移除')}</span>
                </button>
            </div>
            <img id="leaveProofPreview" alt="proof" class="hidden mt-2 max-h-40 rounded border border-gray-200 dark:border-gray-700">
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1" data-i18n="LEAVE_PROOF_HINT">${tt('LEAVE_PROOF_HINT', '建議拍攝診斷證明或就醫單據，上傳後會壓縮')}</p>
        </div>`;
}

/** 關閉月曆補卡 modal 並清空表單 */
function _closeMakeupModal() {
    const modal = document.getElementById('makeup-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    const c = document.getElementById('makeup-modal-form-container');
    if (c) c.replaceChildren();
}

// 點 backdrop / 關閉按鈕關閉 modal
document.addEventListener('click', (e) => {
    if (e.target.id === 'makeup-modal-backdrop' || e.target.id === 'makeup-modal-close') {
        _closeMakeupModal();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('makeup-modal');
        if (modal && modal.style.display !== 'none') _closeMakeupModal();
    }
});

/**
 * 集中綁定所有與打卡、異常相關的事件
 * 供 app.js 的 bindEvents 呼叫
 */
function bindPunchEvents() {

    // 1. 處理補打卡表單 (點擊 '補打卡' 按鈕)
    // 2026-05-14：改用 document 事件委派，涵蓋三個來源：
    //   - 首頁儀表板「異常記錄」清單（#abnormal-list）→ 渲染到 adjustmentFormContainer
    //   - 員工月曆「+ 補打卡」(.makeup-from-calendar-btn) → 渲染到 #makeup-modal-form-container（獨立 modal）
    //   - admin 月曆「+ 代員工補卡」(.adjust-btn-as-admin) → 由 admin.js 處理
    if (adjustmentFormContainer) {
        document.addEventListener('click', (e) => {
            // 排除 admin 代補卡（由 admin.js 自己 handler）
            if (e.target.classList.contains('adjust-btn-as-admin')) return;

            // 月曆 modal 內 mode 切換按鈕（上班 / 下班 / 全日）
            if (e.target.classList.contains('makeup-mode-btn')) {
                const newMode = e.target.dataset.mode;
                const date = e.target.dataset.date;
                const container = document.getElementById('makeup-modal-form-container');
                if (container && newMode && date) {
                    _renderMakeupFormHtml(container, date, newMode, /* showModeSelector */ true);
                }
                return;
            }

            if (e.target.classList.contains('adjust-btn')) {
                // 補打卡按鈕處理邏輯
                const date = e.target.dataset.date;
                const reason = e.target.dataset.reason;

                // 2026-05-14：判斷渲染目標
                //   來自月曆 → 開 modal 並渲染到 modal 內 form container（獨立申請流程）
                //   來自儀表板異常清單 → 渲染到 adjustmentFormContainer（原邏輯）
                const isFromCalendar = e.target.classList.contains('makeup-from-calendar-btn');
                const targetContainer = isFromCalendar ? _openMakeupModal() : adjustmentFormContainer;
                if (!targetContainer) return;

                // 預設 mode：
                //   - STATUS_PUNCH_IN_MISSING → 'in'
                //   - STATUS_PUNCH_OUT_MISSING → 'out'
                //   - 其他（含月曆預設 STATUS_BOTH_MISSING）→ 'full'
                let initialMode = 'full';
                if (reason === 'STATUS_PUNCH_IN_MISSING') initialMode = 'in';
                else if (reason === 'STATUS_PUNCH_OUT_MISSING') initialMode = 'out';

                // 月曆觸發的補卡才顯示 mode selector（讓使用者切換 上/下/全日）
                // 異常清單觸發的不顯示（reason 由系統判定，使用者不該切換）
                _renderMakeupFormHtml(targetContainer, date, initialMode, isFromCalendar);
            } else if (e.target.classList.contains('leave-btn')) {
                // 請假按鈕處理邏輯
                const date = e.target.dataset.date;
                // 來自月曆（.from-calendar）→ 開 modal；來自儀表板異常清單 → 內嵌表單
                const isFromCalendar = e.target.classList.contains('from-calendar');
                const targetContainer = isFromCalendar
                    ? _openMakeupModal('LEAVE_MODAL_TITLE', '請假申請')
                    : adjustmentFormContainer;
                if (!targetContainer) return;
                _pendingLeaveProof = null; // 重置上一次的照片

                const formHtml = `
                    <div class="p-4 ${isFromCalendar ? '' : 'border-t border-gray-200'} fade-in ">
                        <p class="font-semibold mb-2 text-orange-600">${t('LEAVE_TITLE') || '請假：'}<span class="text-orange-600">${date}</span></p>
                        <div class="form-group mb-3">
                            <label for="leaveReason" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${t('LEAVE_REASON_LABEL') || '請假原因：'}</label>
                            <select id="leaveReason"
                                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white">
                                <option value="${t('LEAVE_SICK') || '病假'}">${t('LEAVE_SICK') || '病假'}</option>
                                <option value="${t('LEAVE_PERSONAL') || '事假'}">${t('LEAVE_PERSONAL') || '事假'}</option>
                                <option value="${t('LEAVE_OTHER') || '其他'}">${t('LEAVE_OTHER') || '其他'}</option>
                            </select>
                        </div>
                        <div class="form-group mb-3">
                            <label for="leaveNote" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${t('NOTE_LABEL') || '備註：'}</label>
                            <textarea id="leaveNote"
                                      class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white"
                                      rows="3" placeholder="${t('LEAVE_PLACEHOLDER') || '請輸入請假備註...'}"></textarea>
                        </div>
                        ${_leaveProofSectionHtml()}
                        <button data-type="leave" data-date="${date}"
                                class="submit-leave-btn w-full py-2 px-4 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white">
                            ${t('SUBMIT_LEAVE') || '提交請假'}
                        </button>
                    </div>
                `;
                // ✅ XSS防護：使用 DOMPurify 淨化 HTML（保留 data-* 與 input capture）
                targetContainer.innerHTML = DOMPurify.sanitize(formHtml);
                if (typeof renderTranslations === 'function') renderTranslations(targetContainer);
            } else if (e.target.classList.contains('vacation-btn')) {
                // 休假按鈕處理邏輯
                const date = e.target.dataset.date;
                const isFromCalendar = e.target.classList.contains('from-calendar');
                const targetContainer = isFromCalendar
                    ? _openMakeupModal('VACATION_MODAL_TITLE', '休假申請')
                    : adjustmentFormContainer;
                if (!targetContainer) return;

                const formHtml = `
                    <div class="p-4 ${isFromCalendar ? '' : 'border-t border-gray-200'} fade-in ">
                        <p class="font-semibold mb-2 text-green-600">${t('VACATION_TITLE') || '休假：'}<span class="text-green-600">${date}</span></p>
                        <div class="form-group mb-3">
                            <label for="vacationType" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${t('VACATION_TYPE_LABEL') || '休假類型：'}</label>
                            <select id="vacationType"
                                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white">
                                <option value="${t('VACATION_ANNUAL') || '年假'}">${t('VACATION_ANNUAL') || '年假'}</option>
                                <option value="${t('VACATION_SPECIAL') || '特休'}">${t('VACATION_SPECIAL') || '特休'}</option>
                                <option value="${t('VACATION_COMPENSATORY') || '補休'}">${t('VACATION_COMPENSATORY') || '補休'}</option>
                            </select>
                        </div>
                        <div class="form-group mb-3">
                            <label for="vacationNote" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">${t('NOTE_LABEL') || '備註：'}</label>
                            <textarea id="vacationNote"
                                      class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white"
                                      rows="3" placeholder="${t('VACATION_PLACEHOLDER') || '請輸入休假備註...'}"></textarea>
                        </div>
                        <button data-type="vacation" data-date="${date}"
                                class="submit-vacation-btn w-full py-2 px-4 rounded-lg font-bold bg-green-500 hover:bg-green-600 text-white">
                            ${t('SUBMIT_VACATION') || '提交休假'}
                        </button>
                    </div>
                `;
                // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                targetContainer.innerHTML = DOMPurify.sanitize(formHtml);
                if (typeof renderTranslations === 'function') renderTranslations(targetContainer);
            }
        });

        // 2. 處理補打卡、請假、休假表單的提交
        // 2026-05-14：改為 document delegation，同時涵蓋 adjustmentFormContainer 與 #makeup-modal-form-container
        document.addEventListener('click', async (e) => {
            const adjustButton = e.target.closest('.submit-adjust-btn');
            const leaveButton = e.target.closest('.submit-leave-btn');
            const vacationButton = e.target.closest('.submit-vacation-btn');

            // 偵測按鈕在哪個容器（決定要 reset 哪個 + 是否關 modal）
            const inModal = !!(adjustButton || leaveButton || vacationButton) &&
                !!(e.target.closest('#makeup-modal-form-container'));
            const hostContainer = inModal
                ? document.getElementById('makeup-modal-form-container')
                : adjustmentFormContainer;

            if (adjustButton) {
                // 🌟 修正點 (問題8.6)：補打卡前添加確認
                const loadingText = t('LOADING') || '處理中...';
                const type = adjustButton.dataset.type;

                // 判斷是否為全日打卡（兩個時間輸入框都存在）
                const adjustInTimeInput = document.getElementById("adjustInTime");
                const adjustOutTimeInput = document.getElementById("adjustOutTime");
                const isBothTimeInputs = adjustInTimeInput && adjustOutTimeInput;

                let inDateTime, outDateTime;

                if (isBothTimeInputs) {
                    // 全日打卡：需要兩個時間
                    inDateTime = adjustInTimeInput?.value;
                    outDateTime = adjustOutTimeInput?.value;

                    if (!inDateTime || !outDateTime) {
                        showNotification(t("MSG_PLEASE_SELECT_PUNCH_TIMES"), "error");
                        return;
                    }
                    if (!validateAdjustTime(inDateTime) || !validateAdjustTime(outDateTime)) return;

                    // 檢查下班時間是否晚於上班時間
                    if (new Date(outDateTime) <= new Date(inDateTime)) {
                        showNotification(t("MSG_OUT_BEFORE_IN"), "error");
                        return;
                    }

                    // 添加確認對話框
                    const confirmMsg = t('CONFIRM_REPAIR_BOTH', { in: inDateTime, out: outDateTime });
                    const confirmed = await showConfirmDialog(confirmMsg);
                    if (!confirmed) return;

                } else {
                    // 單次打卡
                    const adjustDateTimeInput = document.getElementById("adjustDateTime");
                    const datetime = adjustDateTimeInput?.value;
                    if (!datetime) {
                        showNotification(t("MSG_PLEASE_SELECT_REPAIR_DATETIME"), "error");
                        return;
                    }
                    if (!validateAdjustTime(datetime)) return;
                    inDateTime = type === 'in' ? datetime : null;
                    outDateTime = type === 'out' ? datetime : null;

                    // 添加確認對話框
                    const typeText = t(type === 'in' ? 'PUNCH_IN' : 'PUNCH_OUT');
                    const confirmMsg = t('CONFIRM_REPAIR_SINGLE', { type: typeText, datetime: datetime });
                    const confirmed = await showConfirmDialog(confirmMsg);
                    if (!confirmed) return;
                }

                generalButtonState(adjustButton, 'processing', loadingText);

                const lat = 0; // 補卡不需精確 GPS
                const lng = 0;

                try {
                    if (type === 'full') {
                        // 全日打卡：需要提交上班和下班兩次
                        const inRes = await callApifetch({
                            action: 'adjustPunch',
                            type: "上班",
                            lat: lat,
                            lng: lng,
                            datetime: new Date(inDateTime).toISOString(),
                            note: encodeURIComponent(navigator.userAgent)
                        }, "loadingMsg");

                        if (!inRes.ok) {
                            const msg = t(inRes.code || "UNKNOWN_ERROR", inRes.params || {});
                            showNotification(t("MSG_PUNCH_IN_FAILED", { msg: msg }), "error");
                            return;
                        }

                        const outRes = await callApifetch({
                            action: 'adjustPunch',
                            type: "下班",
                            lat: lat,
                            lng: lng,
                            datetime: new Date(outDateTime).toISOString(),
                            note: encodeURIComponent(navigator.userAgent)
                        }, "loadingMsg");

                        const msg = t(outRes.code || "UNKNOWN_ERROR", outRes.params || {});
                        showNotification(outRes.ok ? "全日打卡補登成功" : "下班打卡失敗：" + msg, outRes.ok ? "success" : "error");

                        if (outRes.ok) {
                            hostContainer.replaceChildren();
                            if (inModal) _closeMakeupModal();
                            refreshAbnormalAfterApplication();
                            _refreshCalendarAfterMakeup();
                        }
                    } else {
                        // 單次打卡
                        const datetime = inDateTime || outDateTime;
                        const res = await callApifetch({
                            action: 'adjustPunch',
                            type: type === 'in' ? "上班" : "下班",
                            lat: lat,
                            lng: lng,
                            datetime: new Date(datetime).toISOString(),
                            note: encodeURIComponent(navigator.userAgent)
                        }, "loadingMsg");
                        const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
                        showNotification(msg, res.ok ? "success" : "error");

                        if (res.ok) {
                            hostContainer.replaceChildren();
                            if (inModal) _closeMakeupModal();
                            refreshAbnormalAfterApplication();
                            _refreshCalendarAfterMakeup();
                        }
                    }

                } catch (err) {
                    console.error(err);
                    showNotification(t('NETWORK_ERROR') || '網絡錯誤', 'error');
                } finally {
                    if (hostContainer && hostContainer.children.length > 0) {
                        generalButtonState(adjustButton, 'idle');
                    }
                }
            } else if (leaveButton) {
                // 🌟 修正點 (問題8.6)：請假申請前添加確認
                const loadingText = '提交中...';
                const date = leaveButton.dataset.date;
                const reason = document.getElementById("leaveReason").value;
                const note = document.getElementById("leaveNote").value;

                if (!reason) {
                    showNotification(t('SELECT_LEAVE_REASON') || "請選擇請假原因", "error");
                    return;
                }

                // 病假未附證明 → 二次確認（鼓勵附但不強制）
                const sickText = t('LEAVE_SICK') || '病假';
                if (reason === sickText && !_pendingLeaveProof) {
                    const proofConfirm = t('MSG_SICK_NO_PROOF_CONFIRM') || '病假未附證明照片，確定要提交嗎？';
                    const proceed = await showConfirmDialog(proofConfirm);
                    if (!proceed) return;
                }

                // 添加確認對話框
                const confirmMsg = t('CONFIRM_LEAVE_VACATION', { date: date, reason: reason });
                const confirmed = await showConfirmDialog(confirmMsg);

                if (!confirmed) {
                    return; // 用戶取消操作
                }

                generalButtonState(leaveButton, 'processing', loadingText);

                try {
                    const res = await callApifetch({
                        action: 'submitLeave',
                        date: date,
                        type: 'leave',
                        reason: reason,
                        note: note || '',
                        photo: _pendingLeaveProof || ''
                    }, "loadingMsg");

                    const msg = res.ok ? (t('LEAVE_SUBMIT_SUCCESS') || "請假申請已提交") : (res.msg || (t(res.code) || t('LEAVE_SUBMIT_FAILURE') || "請假申請失敗"));
                    showNotification(msg, res.ok ? "success" : "error");

                    if (res.ok) {
                        _pendingLeaveProof = null;
                        hostContainer.replaceChildren();
                        if (inModal) _closeMakeupModal();
                        refreshAbnormalAfterApplication();
                        _refreshCalendarAfterMakeup();
                    }

                } catch (err) {
                    console.error(err);
                    showNotification(t('MSG_NETWORK_ERROR_RETRY'), 'error');
                } finally {
                    if (hostContainer && hostContainer.children.length > 0) {
                        generalButtonState(leaveButton, 'idle');
                    }
                }
            } else if (vacationButton) {
                // 🌟 修正點 (問題8.6)：休假申請前添加確認
                const loadingText = '提交中...';
                const date = vacationButton.dataset.date;
                const vacationType = document.getElementById("vacationType").value;
                const note = document.getElementById("vacationNote").value;

                if (!vacationType) {
                    showNotification(t('SELECT_VACATION_TYPE') || "請選擇休假類型", "error");
                    return;
                }

                // 添加確認對話框
                const confirmMsg = t('CONFIRM_LEAVE_VACATION', { date: date, reason: vacationType });
                const confirmed = await showConfirmDialog(confirmMsg);

                if (!confirmed) {
                    return; // 用戶取消操作
                }

                generalButtonState(vacationButton, 'processing', loadingText);

                try {
                    const res = await callApifetch({
                        action: 'submitLeave',
                        date: date,
                        type: 'vacation',
                        reason: vacationType,
                        note: note || ''
                    }, "loadingMsg");

                    const msg = res.ok ? (t('VACATION_SUBMIT_SUCCESS') || "休假申請已提交") : (res.msg || (t('VACATION_SUBMIT_FAILURE') || "休假申請失敗"));
                    showNotification(msg, res.ok ? "success" : "error");

                    if (res.ok) {
                        hostContainer.replaceChildren();
                        if (inModal) _closeMakeupModal();
                        refreshAbnormalAfterApplication();
                        _refreshCalendarAfterMakeup();
                    }

                } catch (err) {
                    console.error(err);
                    showNotification(t('MSG_NETWORK_ERROR_RETRY'), 'error');
                } finally {
                    if (hostContainer && hostContainer.children.length > 0) {
                        generalButtonState(vacationButton, 'idle');
                    }
                }
            }
        });
    }
}

/**
 * 月曆補卡 / 請假 / 休假成功後刷新月曆 (若使用者在月曆 tab)
 * 觸發 getMonthlyDailyStatus 重新撈，重畫月曆 + 詳情卡
 */
function _refreshCalendarAfterMakeup() {
    try {
        if (typeof cacheManager !== 'undefined' && cacheManager?.clear) {
            cacheManager.clear('month');
        }
    } catch (_) { /* cache 失敗不影響流程 */ }
    if (typeof renderCalendar === 'function') {
        try {
            // renderCalendar(date, isrefresh=true) — 用 state.currentMonthDate 重撈該月
            const dateToRender = (typeof currentMonthDate !== 'undefined' && currentMonthDate)
                ? currentMonthDate : new Date();
            renderCalendar(dateToRender, true);
        } catch (_) { /* ignore */ }
    }
}

// 補打卡／請假／休假成功後刷新異常列表（讓「審核中」徽章立即出現）
function refreshAbnormalAfterApplication() {
    try {
        if (typeof cacheManager !== 'undefined' && cacheManager?.clear) {
            cacheManager.clear('abnormal');
        }
    } catch (_) { /* cache 失敗不影響流程 */ }
    if (typeof checkAbnormal === 'function') {
        checkAbnormal(1, true).catch(err => console.error('刷新異常記錄失敗:', err));
    }
}
// #endregion

console.log('✓ make-up 模組已加載');

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateAdjustTime, bindPunchEvents };
}