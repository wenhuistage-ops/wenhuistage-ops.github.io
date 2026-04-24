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
// js/punch.js
// 目前僅剩「補打卡 UI 與 API 邏輯」，其他區塊已拆出：
//   - 異常紀錄：js/punch/abnormal-records.js
//   - 自動打卡：js/punch/auto-punch.js
//   - 地理位置：js/punch/geolocation.js
//   - 打卡主流程：js/punch/punch-flow.js
// 依賴: state.js、core.js、ui.js
// ===================================

// ===================================
// #region 4. 補打卡 UI 與 API 邏輯
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

/**
 * 集中綁定所有與打卡、異常相關的事件
 * 供 app.js 的 bindEvents 呼叫
 */
function bindPunchEvents() {

    // 1. 處理補打卡表單 (點擊 '補打卡' 按鈕)
    // abnormalList 已在 state.js 宣告並在 app.js 中賦值
    if (abnormalList && adjustmentFormContainer) {
        abnormalList.addEventListener('click', (e) => {
            if (e.target.classList.contains('adjust-btn')) {
                // 補打卡按鈕處理邏輯
                const date = e.target.dataset.date;
                const reason = e.target.dataset.reason;

                // 判斷異常類型
                const isBothMissing = reason === "STATUS_BOTH_MISSING";
                const hasPunchInMissing = reason === "STATUS_PUNCH_IN_MISSING";
                const hasPunchOutMissing = reason === "STATUS_PUNCH_OUT_MISSING";

                // 決定按鈕顯示邏輯
                let formTitle = "補打卡";
                let buttonsHtml = "";
                let defaultTime = "09:00";
                let isFullDayForm = false;

                if (isBothMissing) {
                    // 本日未打卡：顯示兩個按鈕（上班和下班）
                    formTitle = "本日未打卡";
                    buttonsHtml = `
                        <button data-type="in" data-i18n="BTN_ADJUST_IN"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            補全上班打卡
                        </button>
                        <button data-type="out" data-i18n="BTN_ADJUST_OUT"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            補全下班打卡
                        </button>`;
                    defaultTime = "08:00"; // 上班卡預設早上8點
                } else if (hasPunchInMissing) {
                    // 只缺上班卡：顯示補上班卡按鈕
                    buttonsHtml = `
                        <button data-type="in" data-i18n="BTN_ADJUST_IN"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            補全上班打卡
                        </button>`;
                    defaultTime = "08:00"; // 上班卡預設早上8點
                } else if (hasPunchOutMissing) {
                    // 只缺下班卡：顯示補下班卡按鈕
                    buttonsHtml = `
                        <button data-type="out" data-i18n="BTN_ADJUST_OUT"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            補全下班打卡
                        </button>`;
                    defaultTime = "18:00"; // 下班卡預設下午6點
                }

                const formHtml = `
                    <div class="p-4 border-t border-gray-200 fade-in ">
                        <p class="font-semibold mb-2">${formTitle}：<span class="text-indigo-600">${date}</span></p>
                        <div id="timeInputsContainer">
                            ${isBothMissing ? `
                                <div class="form-group mb-3">
                                    <label for="adjustInTime" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">上班時間：</label>
                                    <input id="adjustInTime"
                                        type="datetime-local"
                                        class="w-full p-2
                                                border border-gray-300 dark:border-gray-600
                                                rounded-md shadow-sm
                                                dark:bg-gray-700 dark:text-white
                                                focus:ring-indigo-500 focus:border-indigo-500">
                                </div>
                                <div class="form-group mb-3">
                                    <label for="adjustOutTime" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">下班時間：</label>
                                    <input id="adjustOutTime"
                                        type="datetime-local"
                                        class="w-full p-2
                                                border border-gray-300 dark:border-gray-600
                                                rounded-md shadow-sm
                                                dark:bg-gray-700 dark:text-white
                                                focus:ring-indigo-500 focus:border-indigo-500">
                                </div>
                            ` : `
                                <div class="form-group mb-3">
                                    <label for="adjustDateTime" data-i18n="SELECT_DATETIME_LABEL" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">選擇日期與時間：</label>
                                    <input id="adjustDateTime"
                                        type="datetime-local"
                                        class="w-full p-2
                                                border border-gray-300 dark:border-gray-600
                                                rounded-md shadow-sm
                                                dark:bg-gray-700 dark:text-white
                                                focus:ring-indigo-500 focus:border-indigo-500">
                                </div>
                            `}
                        </div>
                        <div class="grid grid-cols-1 ${isBothMissing ? 'sm:grid-cols-2' : 'sm:grid-cols-1'} gap-2">
                            ${buttonsHtml}
                        </div>
                    </div>
                `;
                // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                adjustmentFormContainer.innerHTML = DOMPurify.sanitize(formHtml);
                renderTranslations(adjustmentFormContainer); // 來自 core.js

                // 設置默認時間值
                if (isBothMissing) {
                    document.getElementById("adjustInTime").value = `${date}T08:00`;
                    document.getElementById("adjustOutTime").value = `${date}T18:00`;
                } else {
                    const adjustDateTimeInput = document.getElementById("adjustDateTime");
                    if (adjustDateTimeInput) {
                        adjustDateTimeInput.value = `${date}T${defaultTime}`;
                    }
                }
            } else if (e.target.classList.contains('leave-btn')) {
                // 請假按鈕處理邏輯
                const date = e.target.dataset.date;
                const formHtml = `
                    <div class="p-4 border-t border-gray-200 fade-in ">
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
                        <button data-type="leave" data-date="${date}" 
                                class="submit-leave-btn w-full py-2 px-4 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white">
                            ${t('SUBMIT_LEAVE') || '提交請假'}
                        </button>
                    </div>
                `;
                // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                adjustmentFormContainer.innerHTML = DOMPurify.sanitize(formHtml);
            } else if (e.target.classList.contains('vacation-btn')) {
                // 休假按鈕處理邏輯
                const date = e.target.dataset.date;
                const formHtml = `
                    <div class="p-4 border-t border-gray-200 fade-in ">
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
                adjustmentFormContainer.innerHTML = DOMPurify.sanitize(formHtml);
            }
        });

        // 2. 處理補打卡、請假、休假表單的提交
        adjustmentFormContainer.addEventListener('click', async (e) => {
            const adjustButton = e.target.closest('.submit-adjust-btn');
            const leaveButton = e.target.closest('.submit-leave-btn');
            const vacationButton = e.target.closest('.submit-vacation-btn');

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
                        showNotification("請選擇上班和下班時間", "error");
                        return;
                    }
                    if (!validateAdjustTime(inDateTime) || !validateAdjustTime(outDateTime)) return;

                    // 檢查下班時間是否晚於上班時間
                    if (new Date(outDateTime) <= new Date(inDateTime)) {
                        showNotification("下班時間必須晚於上班時間", "error");
                        return;
                    }

                    // 添加確認對話框
                    const confirmMsg = `確定要補打卡嗎？\n上班: ${inDateTime}\n下班: ${outDateTime}`;
                    const confirmed = await showConfirmDialog(confirmMsg);
                    if (!confirmed) return;

                } else {
                    // 單次打卡
                    const adjustDateTimeInput = document.getElementById("adjustDateTime");
                    const datetime = adjustDateTimeInput?.value;
                    if (!datetime) {
                        showNotification("請選擇補打卡日期時間", "error");
                        return;
                    }
                    if (!validateAdjustTime(datetime)) return;
                    inDateTime = type === 'in' ? datetime : null;
                    outDateTime = type === 'out' ? datetime : null;

                    // 添加確認對話框
                    const typeText = type === 'in' ? '上班' : '下班';
                    const confirmMsg = `確定要補打 ${typeText} 卡嗎？\n時間: ${datetime}`;
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
                            showNotification("上班打卡失敗：" + msg, "error");
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
                            adjustmentFormContainer.replaceChildren();
                            // 🚀 P5-3 優化：移除補打卡後的異常記錄檢查，減少 API 調用
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
                            adjustmentFormContainer.replaceChildren();
                            // 🚀 P5-3 優化：移除補打卡後的異常記錄檢查，減少 API 調用
                        }
                    }

                } catch (err) {
                    console.error(err);
                    showNotification(t('NETWORK_ERROR') || '網絡錯誤', 'error');
                } finally {
                    if (adjustmentFormContainer.children.length > 0) {
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

                // 添加確認對話框
                const confirmMsg = `確定要在 ${date} 提交 ${reason} 的申請嗎？`;
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
                        note: note || ''
                    }, "loadingMsg");

                    const msg = res.ok ? (t('LEAVE_SUBMIT_SUCCESS') || "請假申請已提交") : (res.msg || (t('LEAVE_SUBMIT_FAILURE') || "請假申請失敗"));
                    showNotification(msg, res.ok ? "success" : "error");

                    if (res.ok) {
                        adjustmentFormContainer.replaceChildren();
                        // 🚀 P5-3 優化：移除請假後的異常記錄檢查，減少 API 調用
                    }

                } catch (err) {
                    console.error(err);
                    showNotification('網絡錯誤，請稍後再試', 'error');
                } finally {
                    if (adjustmentFormContainer.children.length > 0) {
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
                const confirmMsg = `確定要在 ${date} 提交 ${vacationType} 的申請嗎？`;
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
                        adjustmentFormContainer.replaceChildren();
                        // 🚀 P5-3 優化：移除休假後的異常記錄檢查，減少 API 調用
                    }

                } catch (err) {
                    console.error(err);
                    showNotification('網絡錯誤，請稍後再試', 'error');
                } finally {
                    if (adjustmentFormContainer.children.length > 0) {
                        generalButtonState(vacationButton, 'idle');
                    }
                }
            }
        });
    }
}
// #endregion