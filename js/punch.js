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
    enableHighAccuracy: true,  // 改為高精確度模式
    timeout: 15000,            // 增加超時時間到15秒
    maximumAge: 300000         // 5 分鐘內的快取位置
};

// GPS 精確度閾值設定
const GPS_ACCURACY_THRESHOLDS = {
    EXCELLENT: 10,   // 10公尺以內 - 優秀
    GOOD: 25,        // 25公尺以內 - 良好
    FAIR: 50,        // 50公尺以內 - 一般
    POOR: 100        // 100公尺以上 - 較差
};

// 地理位置權限狀態快取
let geolocationPermissionStatus = null;

// 檢查地理位置權限狀態
async function checkGeolocationPermission() {
    if (!navigator.permissions) {
        // 不支持 Permissions API 的瀏覽器
        return 'unknown';
    }

    try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        geolocationPermissionStatus = result.state;

        // 監聽權限變化
        result.addEventListener('change', () => {
            geolocationPermissionStatus = result.state;
            console.log('地理位置權限狀態變更:', result.state);
        });

        return result.state; // 'granted', 'denied', 'prompt'
    } catch (error) {
        console.warn('檢查地理位置權限失敗:', error);
        return 'unknown';
    }
}

// 請求地理位置權限（優化用戶體驗）
async function requestGeolocationPermission() {
    return new Promise((resolve) => {
        // 先檢查權限狀態
        checkGeolocationPermission().then(permission => {
            if (permission === 'granted') {
                // 權限已授予，直接解析
                resolve(true);
            } else if (permission === 'denied') {
                // 權限被拒絕
                resolve(false);
            } else {
                // 需要請求權限，嘗試獲取一次位置來觸發權限請求
                navigator.geolocation.getCurrentPosition(
                    () => resolve(true),  // 成功
                    (error) => {
                        if (error.code === error.PERMISSION_DENIED) {
                            resolve(false); // 用戶拒絕
                        } else {
                            resolve(false); // 其他錯誤
                        }
                    },
                    { timeout: 10000, enableHighAccuracy: false } // 快速檢查
                );
            }
        });
    });
}

async function doPunch(type) {
    const punchButtonId = type === '上班' ? 'punch-in-btn' : 'punch-out-btn';

    // 🌟 修正點：使用全域變數，而非 document.getElementById 🌟
    // punchInBtn 和 punchOutBtn 已在 state.js 宣告並在 app.js 中賦值
    const button = (punchButtonId === 'punch-in-btn' ? punchInBtn : punchOutBtn);
    const loadingText = t('LOADING') || '處理中...';

    if (!button) return;

    // A. 進入處理中狀態 (generalButtonState 來自 ui.js)
    generalButtonState(button, 'processing', loadingText);

    // B. 檢查地理位置權限
    const hasPermission = await requestGeolocationPermission();
    if (!hasPermission) {
        // 權限被拒絕，提供降級方案
        await handleLocationPermissionDenied(button);
        return;
    }

    const submitPunch = async (lat, lng, accuracy) => {
        try {
            const res = await callApifetch({
                action: 'punch',
                type: type,
                lat: lat,
                lng: lng,
                note: `精確度: ${Math.round(accuracy)}m | ${navigator.userAgent}`
            });
            const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
            showNotification(msg, res.ok ? "success" : "error");
            generalButtonState(button, 'idle');

            if (res.ok) {
                checkAbnormal(1, true);
            }
        } catch (err) {
            console.error(err);
            generalButtonState(button, 'idle');
        }
    };

    // 檢查快取位置是否仍然有效
    const canUseCachedPosition = lastPunchPosition &&
        (Date.now() - lastPunchPosition.timestamp < PUNCH_GEOLOCATION_OPTIONS.maximumAge) &&
        lastPunchPosition.accuracy <= GPS_ACCURACY_THRESHOLDS.FAIR;

    if (canUseCachedPosition) {
        await submitPunch(lastPunchPosition.latitude, lastPunchPosition.longitude, lastPunchPosition.accuracy);
        return;
    }

    // 獲取新位置，帶有精確度檢查和重試機制
    await getAccurateLocation(submitPunch, button);
}

// 處理地理位置權限被拒絕的情況
async function handleLocationPermissionDenied(button) {
    // 顯示權限被拒絕的通知
    const permissionMsg = t('LOCATION_PERMISSION_DENIED_DETAIL') ||
        '地理位置權限已被拒絕。請在瀏覽器設定中允許此網站存取您的位置，或聯繫管理員進行手動打卡。';

    showNotification(permissionMsg, "warning");

    // 提供重新請求權限的選項
    const retryPermission = confirm(t('RETRY_LOCATION_PERMISSION') ||
        '是否要重新請求地理位置權限？');

    if (retryPermission) {
        // 清除權限快取並重試
        geolocationPermissionStatus = null;
        // 重新載入頁面來重置權限狀態（某些瀏覽器需要）
        window.location.reload();
        return;
    }

    // 詢問是否要進行無定位打卡（管理員功能）
    const proceedWithoutLocation = confirm(t('PROCEED_WITHOUT_LOCATION') ||
        '是否要進行無定位打卡？（需要管理員權限）');

    if (proceedWithoutLocation) {
        await submitPunchWithoutLocation(button);
    } else {
        generalButtonState(button, 'idle');
    }
}

// 無定位打卡功能（管理員專用）
async function submitPunchWithoutLocation(button) {
    try {
        // 🌟 修正點 (問題1.1)：使用新的驗證函數
        const isAdmin = await verifyAdminPermission();
        if (!isAdmin) {
            showNotification(t('ADMIN_ONLY_FEATURE') || '此功能僅限管理員使用', "error");
            generalButtonState(button, 'idle');
            return;
        }

        // 獲取打卡類型
        const punchType = button === punchInBtn ? '上班' : '下班';

        // 提交無定位打卡
        const res = await callApifetch({
            action: 'punchWithoutLocation',
            type: punchType,
            note: '管理員手動授權 - 無GPS定位 | ' + navigator.userAgent
        });

        const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
        showNotification(msg, res.ok ? "success" : "error");
        generalButtonState(button, 'idle');

        if (res.ok) {
            checkAbnormal(1, true);
        }
    } catch (err) {
        console.error('無定位打卡失敗:', err);
        showNotification(t('PUNCH_FAILED') || '打卡失敗', "error");
        generalButtonState(button, 'idle');
    }
}

// 獲取精確位置的函數，包含精確度檢查和重試機制
async function getAccurateLocation(onSuccess, button, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2秒重試延遲

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const accuracy = pos.coords.accuracy;
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;

                // 儲存位置資訊
                lastPunchPosition = {
                    latitude: lat,
                    longitude: lng,
                    accuracy: accuracy,
                    timestamp: Date.now()
                };

                // 評估精確度品質
                let quality;
                if (accuracy <= GPS_ACCURACY_THRESHOLDS.EXCELLENT) {
                    quality = 'excellent';
                } else if (accuracy <= GPS_ACCURACY_THRESHOLDS.GOOD) {
                    quality = 'good';
                } else if (accuracy <= GPS_ACCURACY_THRESHOLDS.FAIR) {
                    quality = 'fair';
                } else {
                    quality = 'poor';
                }

                // 如果精確度太差且還有重試次數，提示用戶並重試
                if (quality === 'poor' && retryCount < MAX_RETRIES) {
                    const retryMsg = t('GPS_ACCURACY_LOW_RETRY', {
                        accuracy: Math.round(accuracy),
                        retry: retryCount + 1,
                        max: MAX_RETRIES
                    }) || `GPS精確度較差 (${Math.round(accuracy)}m)，正在重試 (${retryCount + 1}/${MAX_RETRIES})...`;

                    showNotification(retryMsg, "warning");

                    // 等待一段時間後重試
                    setTimeout(() => {
                        getAccurateLocation(onSuccess, button, retryCount + 1)
                            .then(resolve)
                            .catch(reject);
                    }, RETRY_DELAY);
                    return;
                }

                // 精確度可接受或已達最大重試次數，直接使用
                if (quality !== 'excellent' && quality !== 'good') {
                    const accuracyMsg = t('GPS_ACCURACY_WARNING', {
                        accuracy: Math.round(accuracy),
                        quality: t(`GPS_QUALITY_${quality.toUpperCase()}`) || quality
                    }) || `GPS精確度: ${Math.round(accuracy)}m (${quality})`;
                    showNotification(accuracyMsg, "info");
                }

                // 呼叫成功回調
                await onSuccess(lat, lng, accuracy);
                resolve();
            },
            (err) => {
                // 如果還有重試次數，自動重試
                if (retryCount < MAX_RETRIES) {
                    const retryMsg = t('GPS_RETRY_ON_ERROR', {
                        error: err.message,
                        retry: retryCount + 1,
                        max: MAX_RETRIES
                    }) || `GPS獲取失敗，正在重試 (${retryCount + 1}/${MAX_RETRIES})...`;

                    showNotification(retryMsg, "warning");

                    setTimeout(() => {
                        getAccurateLocation(onSuccess, button, retryCount + 1)
                            .then(resolve)
                            .catch(reject);
                    }, RETRY_DELAY);
                    return;
                }

                // 達到最大重試次數，顯示錯誤
                const errorMsg = t("ERROR_GEOLOCATION", {
                    msg: `${err.message} (已重試 ${MAX_RETRIES} 次)`
                });
                showNotification(errorMsg, "error");
                generalButtonState(button, 'idle');
                reject(err);
            },
            PUNCH_GEOLOCATION_OPTIONS
        );
    });
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

async function checkAbnormal(monthsToCheck = 1, forceRefresh = false) {
    // 檢查快取是否有效（問題 8.4：性能優化）
    const now = Date.now();
    if (!forceRefresh && abnormalRecordsCache && abnormalRecordsCacheTime) {
        const cacheAge = now - abnormalRecordsCacheTime;
        if (cacheAge < ABNORMAL_RECORDS_CACHE_DURATION) {
            console.log(`使用快取的異常記錄（快取年齡: ${Math.floor(cacheAge / 1000)}秒）`);
            renderAbnormalRecords(abnormalRecordsCache);
            return;
        }
    }

    const currentDate = new Date();
    const currentMonth = currentDate.getFullYear() + "-" + String(currentDate.getMonth() + 1).padStart(2, "0");
    const sessionUserId = localStorage.getItem("sessionUserId");

    console.log("檢查異常記錄 - 當前月份:", currentMonth, "檢查月份數:", monthsToCheck, "用戶ID:", sessionUserId);

    // 收集多個月份的異常記錄
    let allAbnormalRecords = [];

    for (let i = 0; i < monthsToCheck; i++) {
        const checkDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const month = checkDate.getFullYear() + "-" + String(checkDate.getMonth() + 1).padStart(2, "0");

        console.log(`檢查第 ${i + 1} 個月: ${month}`);

        try {
            const res = await callApifetch({
                action: 'getAbnormalRecords',
                month: month,
                userId: sessionUserId
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

    // 保存到快取
    abnormalRecordsCache = allAbnormalRecords;
    abnormalRecordsCacheTime = now;
    console.log("異常記錄已快取");

    // 查詢待審核申請，並將狀態合併到異常記錄中
    await enrichAbnormalRecordsWithApplicationStatus(allAbnormalRecords);

    renderAbnormalRecords(allAbnormalRecords);
}

/**
 * 查詢待審核申請，並將狀態信息添加到異常記錄中
 * @param {Array} records - 異常記錄陣列
 */
async function enrichAbnormalRecordsWithApplicationStatus(records) {
    try {
        // 查詢所有待審核申請
        const res = await callApifetch({
            action: 'getReviewRequest'
        });

        if (res.ok && res.reviewRequest) {
            // 為每個異常記錄檢查是否有對應的待審核申請
            const applicationsByDate = {};
            res.reviewRequest.forEach(app => {
                // 日期格式可能是 YYYY-MM-DD 或其他格式
                const appDate = app.date || app.displayDate;
                if (!applicationsByDate[appDate]) {
                    applicationsByDate[appDate] = [];
                }
                applicationsByDate[appDate].push(app);
            });

            // 將狀態合併到異常記錄中
            records.forEach(record => {
                // 匹配時需要考慮日期格式，記錄的 displayDate 格式是 YYYY-MM-DD
                const displayDate = record.displayDate; // 格式: YYYY-MM-DD

                if (applicationsByDate[displayDate] && applicationsByDate[displayDate].length > 0) {
                    record.status = 'pending'; // 有待審核申請
                    record.applications = applicationsByDate[displayDate];
                    console.log(`異常記錄 ${displayDate} 有 ${record.applications.length} 個待審核申請`);
                }
            });
        }
    } catch (error) {
        console.error("查詢待審核申請時出錯:", error);
        // 即使出錯也繼續，不阻止異常記錄顯示
    }
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
            console.log("Abnormal Record:", record.displayDate, record.reason, "Status:", record.status);

            // 判斷異常類型
            const displayReason = record.reason; // 直接使用 reason 作為顯示鍵

            // 只有當上班和下班都沒有打卡時，才顯示請假和休假按鈕
            const showLeaveButtons = record.reason === "STATUS_BOTH_MISSING";

            // 檢查是否有待審核申請（status: 'pending' 或 'reviewing'）
            const hasPendingApplication = record.status === 'pending' || record.status === 'reviewing';

            const li = document.createElement('li');
            li.className = 'p-3 bg-gray-50 rounded-lg flex justify-between items-center dark:bg-gray-700';

            // 動態生成按鈕HTML - 只在沒有待審核申請時顯示
            let buttonsHtml = '';
            if (!hasPendingApplication) {
                buttonsHtml = `
                    <button data-i18n="ADJUST_BUTTON_TEXT" data-date="${record.displayDate}" data-reason="${record.reason}"
                            class="adjust-btn text-sm font-semibold
                                   text-indigo-600 dark:text-indigo-400
                                   hover:text-indigo-800 dark:hover:text-indigo-300 mr-2">
                        補打卡
                    </button>`;
            }

            if (showLeaveButtons && !hasPendingApplication) {
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

            // 如果有待審核申請，顯示狀態標籤
            let statusBadge = '';
            if (hasPendingApplication) {
                statusBadge = `
                    <span class="px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs rounded-full font-medium">
                        <i class="fas fa-hourglass-half mr-1"></i>審核中
                    </span>`;
            }

            li.innerHTML = `
                <div>
                    <p class="font-medium text-gray-800 dark:text-white">${record.displayDate}</p>
                    <p class="text-sm text-red-600 dark:text-red-400"
                       data-i18n-dynamic="true"
                       data-i18n-key="${displayReason}">
                   </p>
                </div>
                <div class="flex flex-wrap gap-1 items-center">
                    ${statusBadge}
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
                adjustmentFormContainer.innerHTML = formHtml;
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
                adjustmentFormContainer.innerHTML = formHtml;
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
                adjustmentFormContainer.innerHTML = formHtml;
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

                    // 添加確認對話框
                    const confirmMsg = `確定要補打卡嗎？\n上班: ${inDateTime}\n下班: ${outDateTime}`;
                    const confirmed = await showConfirmDialog(confirmMsg);
                    if (!confirmed) return;

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
                            adjustmentFormContainer.innerHTML = '';
                            checkAbnormal(1, true); // 補打卡成功後，重新檢查異常紀錄
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
                            checkAbnormal(1, true); // 補打卡成功後，重新檢查異常紀錄
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
                        adjustmentFormContainer.innerHTML = '';
                        checkAbnormal(1, true); // 請假成功後，重新檢查異常紀錄
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
                        adjustmentFormContainer.innerHTML = '';
                        checkAbnormal(1, true); // 休假成功後，重新檢查異常紀錄
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