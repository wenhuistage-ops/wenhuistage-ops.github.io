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

async function checkAbnormal() {
    const now = new Date();
    const month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const userId = localStorage.getItem("sessionUserId"); // 假設您在登入成功後儲存了 sessionUserId

    console.log("檢查異常記錄 - 月份:", month, "用戶ID:", userId); // 添加調試信息

    // 假設 recordsLoading 也在 state.js 中宣告
    const recordsLoading = recordsLoadingEl; // 假設您在 state.js 中宣告為 recordsLoadingEl

    if (!recordsLoading) {
        console.warn("recordsLoading 元素未找到");
        return; // 錯誤處理
    }

    recordsLoading.style.display = 'block';

    try {
        const res = await callApifetch({
            action: 'getAbnormalRecords',
            month: month,
            userId: userId
        })
        recordsLoading.style.display = 'none';

        console.log("Abnormal records response:", res); // 添加調試信息

        const abnormalRecordsSection = abnormalRecordsSectionEl;
        const abnormalList = abnormalListEl;
        const recordsEmpty = recordsEmptyEl;

        if (res.ok) {
            if (res.records.length > 0) {
                abnormalRecordsSection.style.display = 'block';
                recordsEmpty.style.display = 'none';
                abnormalList.innerHTML = '';
                res.records.forEach(record => {
                    console.log("Abnormal Record:", record.date, record.reason); // 添加調試信息

                    // 處理多重異常情況（如同時缺少上班和下班卡）
                    const reasons = record.reason.split(',');
                    const hasPunchOutMissing = reasons.includes("STATUS_PUNCH_OUT_MISSING");
                    const hasPunchInMissing = reasons.includes("STATUS_PUNCH_IN_MISSING");

                    // 顯示主要異常原因（如果有多個，優先顯示上班卡缺失）
                    const displayReason = hasPunchInMissing && hasPunchOutMissing ?
                        "STATUS_PUNCH_IN_MISSING" : record.reason.split(',')[0];

                    const li = document.createElement('li');
                    li.className = 'p-3 bg-gray-50 rounded-lg flex justify-between items-center dark:bg-gray-700';
                    li.innerHTML = `
                        <div>
                            <p class="font-medium text-gray-800 dark:text-white">${record.date}</p>
                            <p class="text-sm text-red-600 dark:text-red-400"
                               data-i18n-dynamic="true"
                               data-i18n-key="${displayReason}">
                           </p>
                        </div>
                        <button data-i18n="ADJUST_BUTTON_TEXT" data-date="${record.date}" data-reason="${record.reason}" 
                                class="adjust-btn text-sm font-semibold 
                                       text-indigo-600 dark:text-indigo-400 
                                       hover:text-indigo-800 dark:hover:text-indigo-300">
                            補打卡
                        </button>
                    `;
                    abnormalList.appendChild(li);
                    renderTranslations(li); // 來自 core.js
                });

            } else {
                abnormalRecordsSection.style.display = 'block';
                recordsEmpty.style.display = 'block';
                abnormalList.innerHTML = '';
            }
        } else {
            console.error("Failed to fetch abnormal records:", res.msg);
            showNotification(t("ERROR_FETCH_RECORDS"), "error");
        }
    } catch (err) {
        console.error(err);
        if (recordsLoading) recordsLoading.style.display = 'none';
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
                const date = e.target.dataset.date;
                const reason = e.target.dataset.reason;

                // 解析異常原因，支持多重異常
                const reasons = reason.split(',');
                const hasPunchOutMissing = reasons.includes("STATUS_PUNCH_OUT_MISSING");
                const hasPunchInMissing = reasons.includes("STATUS_PUNCH_IN_MISSING");

                // 決定哪些按鈕應該隱藏
                const hideIn = hasPunchOutMissing;  // 如果缺下班卡，隱藏補上班卡按鈕
                const hideOut = hasPunchInMissing; // 如果缺上班卡，隱藏補下班卡按鈕
                const formHtml = `
                    <div class="p-4 border-t border-gray-200 fade-in ">
                        <p data-i18n="ADJUST_BUTTON_TEXT" class="font-semibold mb-2">補打卡：<span class="text-indigo-600">${date}</span></p>
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
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button data-type="in" data-i18n="BTN_ADJUST_IN" 
                                    class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary"
                                    style="display: ${hideIn ? 'none' : 'block'};"> // 🌟 關鍵修正 1
                                補上班卡
                            </button>
                            <button data-type="out" data-i18n="BTN_ADJUST_OUT" 
                                    class="submit-adjust-btn w-full py-2 px-4 rounded-lg font-bold btn-secondary"
                                    style="display: ${hideOut ? 'none' : 'block'};"> // 🌟 關鍵修正 2
                                補下班卡
                            </button>
                        </div>
                    </div>
                `;
                adjustmentFormContainer.innerHTML = formHtml;
                renderTranslations(adjustmentFormContainer); // 來自 core.js

                const adjustDateTimeInput = document.getElementById("adjustDateTime"); // 這裡使用 ID 獲取是正確的
                let defaultTime = "09:00";
                if (reason.includes("STATUS_PUNCH_OUT_MISSING")) {
                    defaultTime = "18:00";
                }
                adjustDateTimeInput.value = `${date}T${defaultTime}`;
            }
        });

        // 2. 處理補打卡表單的提交
        adjustmentFormContainer.addEventListener('click', async (e) => {
            const button = e.target.closest('.submit-adjust-btn');

            if (button) {
                const loadingText = t('LOADING') || '處理中...';

                // 這裡使用 ID 獲取是正確的
                const datetime = document.getElementById("adjustDateTime").value;
                const type = button.dataset.type;

                if (!datetime) {
                    showNotification("請選擇補打卡日期時間", "error");
                    return;
                }
                if (!validateAdjustTime(datetime)) return;

                // 步驟 A: 進入處理中狀態 (generalButtonState 來自 ui.js)
                generalButtonState(button, 'processing', loadingText);

                // ------------------ API 邏輯 ------------------
                const dateObj = new Date(datetime);
                const lat = 0; // 補卡不需精確 GPS 
                const lng = 0;

                try {
                    const res = await callApifetch({ // callApifetch 來自 core.js
                        action: 'adjustPunch',
                        type: type === 'in' ? "上班" : "下班",
                        lat: lat,
                        lng: lng,
                        datetime: dateObj.toISOString(),
                        note: encodeURIComponent(navigator.userAgent)
                    }, "loadingMsg");
                    const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
                    showNotification(msg, res.ok ? "success" : "error");

                    if (res.ok) {
                        adjustmentFormContainer.innerHTML = '';
                        checkAbnormal(); // 補打卡成功後，重新檢查異常紀錄
                    }

                } catch (err) {
                    console.error(err);
                    showNotification(t('NETWORK_ERROR') || '網絡錯誤', 'error');

                } finally {
                    // 恢復按鈕狀態，只有在表單容器沒有被清空時才需要（即請求失敗）
                    if (adjustmentFormContainer.innerHTML !== '') {
                        generalButtonState(button, 'idle');
                    }
                }
            }
        });
    }
}
// #endregion