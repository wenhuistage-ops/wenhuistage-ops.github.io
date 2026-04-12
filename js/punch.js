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
// 依賴: state.js (全域變數), core.js (API/翻譯/通知), ui.js (generalButtonState)
// ===================================

// ===================================
// #region 1. 核心打卡邏輯
// ===================================

let lastPunchPosition = null;
const PUNCH_GEOLOCATION_OPTIONS = {
    enableHighAccuracy: false,
    timeout: 5000,
    maximumAge: 300000 // 5 分鐘內的快取位置
};

async function doPunch(type) {
    const punchButtonId = type === '上班' ? 'punch-in-btn' : 'punch-out-btn';

    // 🌟 修正點：使用全域變數，而非 document.getElementById 🌟
    // punchInBtn 和 punchOutBtn 已在 state.js 宣告並在 app.js 中賦值
    const button = (punchButtonId === 'punch-in-btn' ? punchInBtn : punchOutBtn);
    const loadingText = t('LOADING') || '處理中...';

    if (!button) return;

    // A. 進入處理中狀態 (generalButtonState 來自 ui.js)
    generalButtonState(button, 'processing', loadingText);

    if (!navigator.geolocation) {
        showNotification(t("ERROR_GEOLOCATION", { msg: "您的瀏覽器不支援地理位置功能。" }), "error");
        generalButtonState(button, 'idle');
        return;
    }

    const submitPunch = async (lat, lng) => {
        try {
            const res = await callApifetch({
                action: 'punch',
                type: type,
                lat: lat,
                lng: lng,
                note: navigator.userAgent
            });
            const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
            showNotification(msg, res.ok ? "success" : "error");
            generalButtonState(button, 'idle');

            if (res.ok) {
                checkAbnormal();
            }
        } catch (err) {
            console.error(err);
            generalButtonState(button, 'idle');
        }
    };

    const canUseCachedPosition = lastPunchPosition && (Date.now() - lastPunchPosition.timestamp < PUNCH_GEOLOCATION_OPTIONS.maximumAge);
    if (canUseCachedPosition) {
        submitPunch(lastPunchPosition.latitude, lastPunchPosition.longitude);
        return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
        lastPunchPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timestamp: Date.now()
        };
        await submitPunch(lastPunchPosition.latitude, lastPunchPosition.longitude);
    }, (err) => {
        showNotification(t("ERROR_GEOLOCATION", { msg: err.message }), "error");
        generalButtonState(button, 'idle');
    }, PUNCH_GEOLOCATION_OPTIONS);
}
// #endregion

// ===================================
// #region 2. 自動打卡
// ===================================

/**
 * 檢查 URL 參數，若有 ?action=punch 則自動觸發打卡。
 */
function checkAutoPunch() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    // 🌟 修正點：使用全域變數 🌟
    let targetButton = null;

    if (action === 'in' && punchInBtn) { // punchInBtn 來自 state.js
        targetButton = punchInBtn;
    } else if (action === 'out' && punchOutBtn) { // punchOutBtn 來自 state.js
        targetButton = punchOutBtn;
    }

    if (targetButton) {
        // sessionToken 是在 app.js 的登入流程中設置的，這裡直接檢查即可
        if (localStorage.getItem("sessionToken")) {
            showNotification(t("PUNCH_AUTO_TRIGGERED") || '正在自動打卡...', "info");

            setTimeout(() => {
                // 觸發目標打卡按鈕的點擊事件
                targetButton.click();
                // 清除 URL 參數
                history.replaceState(null, '', window.location.pathname);
            }, 500);

        } else {
            showNotification(t("PUNCH_REQUIRE_LOGIN") || '請先登入才能自動打卡！', "warning");
        }
    }
}
// #endregion

// ===================================
// #region 3. 異常紀錄檢查
// ===================================

async function checkAbnormal(monthsToCheck = 1) {
    const now = new Date();
    const currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const userId = localStorage.getItem("sessionUserId");

    console.log("檢查異常記錄 - 當前月份:", currentMonth, "檢查月份數:", monthsToCheck, "用戶ID:", userId);

    // 收集多個月份的異常記錄
    let allAbnormalRecords = [];

    for (let i = 0; i < monthsToCheck; i++) {
        const checkDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = checkDate.getFullYear() + "-" + String(checkDate.getMonth() + 1).padStart(2, "0");

        console.log(`檢查第 ${i + 1} 個月: ${month}`);

        try {
            const res = await callApifetch({
                action: 'getAbnormalRecords',
                month: month,
                userId: userId
            });

            if (res.ok && res.records) {
                // 為每個記錄添加月份標記
                const recordsWithMonth = res.records.map(record => ({
                    ...record,
                    month: month,
                    displayDate: `${month}-${record.date.split('-')[2]}`
                }));
                allAbnormalRecords = allAbnormalRecords.concat(recordsWithMonth);
                console.log(`月份 ${month} 找到 ${res.records.length} 條異常記錄`);
            }
        } catch (error) {
            console.error(`檢查月份 ${month} 時出錯:`, error);
        }
    }

    // 按日期排序（最新的在前面）
    allAbnormalRecords.sort((a, b) => new Date(b.displayDate) - new Date(a.displayDate));

    console.log("總共找到 " + allAbnormalRecords.length + " 條異常記錄");

    // 隱藏載入動畫
    const recordsLoading = recordsLoadingEl;
    if (recordsLoading) recordsLoading.style.display = 'none';

    renderAbnormalRecords(allAbnormalRecords);
}

/**
 * 渲染異常記錄列表
 * @param {Array} records - 異常記錄陣列
 */
function renderAbnormalRecords(records) {
    const abnormalRecordsSection = abnormalRecordsSectionEl;
    const abnormalList = abnormalListEl;
    const recordsEmpty = recordsEmptyEl;

    if (records.length > 0) {
        abnormalRecordsSection.style.display = 'block';
        recordsEmpty.style.display = 'none';
        abnormalList.innerHTML = '';

        records.forEach(record => {
            console.log("Abnormal Record:", record.displayDate, record.reason);

            // 處理多重異常情況（如同時缺少上班和下班卡）
            const reasons = record.reason.split(',');
            const hasPunchOutMissing = reasons.includes("STATUS_PUNCH_OUT_MISSING");
            const hasPunchInMissing = reasons.includes("STATUS_PUNCH_IN_MISSING");

            // 顯示主要異常原因（如果有多個，優先顯示上班卡缺失）
            const displayReason = hasPunchInMissing && hasPunchOutMissing ?
                "STATUS_PUNCH_IN_MISSING" : record.reason.split(',')[0];

            // 判斷是否需要顯示請假和休假按鈕（當上班和下班都沒有時）
            const showLeaveButtons = hasPunchInMissing && hasPunchOutMissing;

            const li = document.createElement('li');
            li.className = 'p-3 bg-gray-50 rounded-lg flex justify-between items-center dark:bg-gray-700';

            // 動態生成按鈕HTML
            let buttonsHtml = `
                <button data-i18n="ADJUST_BUTTON_TEXT" data-date="${record.displayDate}" data-reason="${record.reason}"
                        class="adjust-btn text-sm font-semibold
                               text-indigo-600 dark:text-indigo-400
                               hover:text-indigo-800 dark:hover:text-indigo-300 mr-2">
                    補打卡
                </button>`;

            if (showLeaveButtons) {
                buttonsHtml += `
                <button data-i18n="BTN_LEAVE" data-date="${record.displayDate}" data-reason="${record.reason}"
                        class="leave-btn text-sm font-semibold
                               text-orange-600 dark:text-orange-400
                               hover:text-orange-800 dark:hover:text-orange-300 mr-2">
                    請假
                </button>
                <button data-i18n="BTN_VACATION" data-date="${record.displayDate}" data-reason="${record.reason}"
                        class="vacation-btn text-sm font-semibold
                               text-green-600 dark:text-green-400
                               hover:text-green-800 dark:hover:text-green-300">
                    休假
                </button>`;
            }

            li.innerHTML = `
                <div>
                    <p class="font-medium text-gray-800 dark:text-white">${record.displayDate}</p>
                    <p class="text-sm text-red-600 dark:text-red-400"
                       data-i18n-dynamic="true"
                       data-i18n-key="${displayReason}">
                   </p>
                </div>
                <div class="flex flex-wrap gap-1">
                    ${buttonsHtml}
                </div>
            `;
            abnormalList.appendChild(li);
            renderTranslations(li); // 來自 core.js
        });

    } else {
        abnormalRecordsSection.style.display = 'block';
        recordsEmpty.style.display = 'block';
        abnormalList.innerHTML = '';
    }
}
// #endregion


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

                // 解析異常原因，支持多重異常
                const reasons = reason.split(',');
                const hasPunchOutMissing = reasons.includes("STATUS_PUNCH_OUT_MISSING");
                const hasPunchInMissing = reasons.includes("STATUS_PUNCH_IN_MISSING");
                const bothMissing = hasPunchInMissing && hasPunchOutMissing;

                // 決定按鈕顯示邏輯
                let formTitle = "補打卡";
                let buttonsHtml = "";
                let defaultTime = "09:00";
                let isFullDayForm = false;

                if (bothMissing) {
                    // 都沒有：顯示三個按鈕
                    formTitle = "本日為打卡";
                    buttonsHtml = `
                        <button data-type="full" data-i18n="BTN_ADJUST_FULL"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-primary">
                            補全日打卡
                        </button>
                        <button data-type="in" data-i18n="BTN_ADJUST_IN"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            補全上班打卡
                        </button>
                        <button data-type="out" data-i18n="BTN_ADJUST_OUT"
                                class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary">
                            補全下班打卡
                        </button>`;
                    defaultTime = "08:00"; // 全日打卡預設早上8點
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
                        </div>
                        <div class="grid grid-cols-1 ${bothMissing ? 'sm:grid-cols-3' : 'sm:grid-cols-1'} gap-2">
                            ${buttonsHtml}
                        </div>
                    </div>
                `;
                adjustmentFormContainer.innerHTML = formHtml;
                renderTranslations(adjustmentFormContainer); // 來自 core.js

                const adjustDateTimeInput = document.getElementById("adjustDateTime");
                adjustDateTimeInput.value = `${date}T${defaultTime}`;

                // 為全日打卡按鈕添加特殊處理
                const fullDayBtn = adjustmentFormContainer.querySelector('button[data-type="full"]');
                if (fullDayBtn) {
                    fullDayBtn.addEventListener('click', function () {
                        const timeInputsContainer = document.getElementById("timeInputsContainer");
                        timeInputsContainer.innerHTML = `
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
                        `;
                        document.getElementById("adjustInTime").value = `${date}T08:00`;
                        document.getElementById("adjustOutTime").value = `${date}T18:00`;
                    });
                }
            } else if (e.target.classList.contains('leave-btn')) {
                // 請假按鈕處理邏輯
                const date = e.target.dataset.date;
                const formHtml = `
                    <div class="p-4 border-t border-gray-200 fade-in ">
                        <p class="font-semibold mb-2 text-orange-600">請假：<span class="text-orange-600">${date}</span></p>
                        <div class="form-group mb-3">
                            <label for="leaveReason" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">請假原因：</label>
                            <select id="leaveReason" 
                                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white">
                                <option value="病假">病假</option>
                                <option value="事假">事假</option>
                                <option value="其他">其他</option>
                            </select>
                        </div>
                        <div class="form-group mb-3">
                            <label for="leaveNote" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">備註：</label>
                            <textarea id="leaveNote" 
                                      class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white" 
                                      rows="3" placeholder="請輸入請假備註..."></textarea>
                        </div>
                        <button data-type="leave" data-date="${date}" 
                                class="submit-leave-btn w-full py-2 px-4 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white">
                            提交請假
                        </button>
                    </div>
                `;
                adjustmentFormContainer.innerHTML = formHtml;
            } else if (e.target.classList.contains('vacation-btn')) {
                // 休假按鈕處理邏輯
                const date = e.target.dataset.date;
                const formHtml = `
                    <div class="p-4 border-t border-gray-200 fade-in ">
                        <p class="font-semibold mb-2 text-green-600">休假：<span class="text-green-600">${date}</span></p>
                        <div class="form-group mb-3">
                            <label for="vacationType" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">休假類型：</label>
                            <select id="vacationType" 
                                    class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white">
                                <option value="年假">年假</option>
                                <option value="特休">特休</option>
                                <option value="補休">補休</option>
                            </select>
                        </div>
                        <div class="form-group mb-3">
                            <label for="vacationNote" class="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">備註：</label>
                            <textarea id="vacationNote" 
                                      class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white" 
                                      rows="3" placeholder="請輸入休假備註..."></textarea>
                        </div>
                        <button data-type="vacation" data-date="${date}" 
                                class="submit-vacation-btn w-full py-2 px-4 rounded-lg font-bold bg-green-500 hover:bg-green-600 text-white">
                            提交休假
                        </button>
                    </div>
                `;
                adjustmentFormContainer.innerHTML = formHtml;
            }
        });

        // 2. 處理補打卡、請假、休假表單的提交
        adjustmentFormContainer.addEventListener('click', async (e) => {
            const adjustButton = e.target.closest('.submit-adjust-btn');
            const leaveButton = e.target.closest('.submit-leave-btn');
            const vacationButton = e.target.closest('.submit-vacation-btn');

            if (adjustButton) {
                // 補打卡處理邏輯
                const loadingText = t('LOADING') || '處理中...';
                const type = adjustButton.dataset.type;

                let inDateTime, outDateTime;

                if (type === 'full') {
                    // 全日打卡：需要兩個時間
                    inDateTime = document.getElementById("adjustInTime")?.value;
                    outDateTime = document.getElementById("adjustOutTime")?.value;

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
                } else {
                    // 單次打卡
                    const datetime = document.getElementById("adjustDateTime").value;
                    if (!datetime) {
                        showNotification("請選擇補打卡日期時間", "error");
                        return;
                    }
                    if (!validateAdjustTime(datetime)) return;
                    inDateTime = type === 'in' ? datetime : null;
                    outDateTime = type === 'out' ? datetime : null;
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
                            adjustmentFormContainer.innerHTML = '';
                            checkAbnormal(); // 補打卡成功後，重新檢查異常紀錄
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
                            adjustmentFormContainer.innerHTML = '';
                            checkAbnormal(); // 補打卡成功後，重新檢查異常紀錄
                        }
                    }

                } catch (err) {
                    console.error(err);
                    showNotification(t('NETWORK_ERROR') || '網絡錯誤', 'error');
                } finally {
                    if (adjustmentFormContainer.innerHTML !== '') {
                        generalButtonState(adjustButton, 'idle');
                    }
                }
            } else if (leaveButton) {
                // 請假處理邏輯
                const loadingText = '提交中...';
                const date = leaveButton.dataset.date;
                const reason = document.getElementById("leaveReason").value;
                const note = document.getElementById("leaveNote").value;

                if (!reason) {
                    showNotification("請選擇請假原因", "error");
                    return;
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

                    const msg = res.ok ? "請假申請已提交" : (res.msg || "請假申請失敗");
                    showNotification(msg, res.ok ? "success" : "error");

                    if (res.ok) {
                        adjustmentFormContainer.innerHTML = '';
                        checkAbnormal(); // 請假成功後，重新檢查異常紀錄
                    }

                } catch (err) {
                    console.error(err);
                    showNotification('網絡錯誤，請稍後再試', 'error');
                } finally {
                    if (adjustmentFormContainer.innerHTML !== '') {
                        generalButtonState(leaveButton, 'idle');
                    }
                }
            } else if (vacationButton) {
                // 休假處理邏輯
                const loadingText = '提交中...';
                const date = vacationButton.dataset.date;
                const vacationType = document.getElementById("vacationType").value;
                const note = document.getElementById("vacationNote").value;

                if (!vacationType) {
                    showNotification("請選擇休假類型", "error");
                    return;
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

                    const msg = res.ok ? "休假申請已提交" : (res.msg || "休假申請失敗");
                    showNotification(msg, res.ok ? "success" : "error");

                    if (res.ok) {
                        adjustmentFormContainer.innerHTML = '';
                        checkAbnormal(); // 休假成功後，重新檢查異常紀錄
                    }

                } catch (err) {
                    console.error(err);
                    showNotification('網絡錯誤，請稍後再試', 'error');
                } finally {
                    if (adjustmentFormContainer.innerHTML !== '') {
                        generalButtonState(vacationButton, 'idle');
                    }
                }
            }
        });
    }
}
// #endregion