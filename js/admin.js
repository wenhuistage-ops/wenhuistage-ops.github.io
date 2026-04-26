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
// js/admin.js
// 依賴: state.js (adminMonthDataCache, DOM 元素), core.js, ui.js
// ===================================


// ===================================
// #region 1. 管理員日曆與紀錄渲染
// ===================================

/**
 * 渲染指定員工的日曆 (管理員專用)
 * 修正: 使用 state.js 中宣告的 DOM 變數
 * @param {string} userId - 要查詢的員工 userId
 * @param {Date} date - 要查詢的月份日期物件
 */
async function renderAdminCalendar(userId, date) {
    // 🚀 性能監測：開始記錄
    const renderStartTime = performance.now();
    const monthStr = String(date.getMonth() + 1).padStart(2, "0");
    console.log(`%c[Calendar Load] 開始載入員工月曆`, 'color: #0066cc; font-weight: bold;', {
        userId,
        month: `${date.getFullYear()}-${monthStr}`
    });

    // 1. 取得全域 DOM 元素 (建議加上防呆檢查)
    const monthTitle = adminCurrentMonthDisplay;
    const calendarGrid = adminCalendarGrid;

    if (!monthTitle || !calendarGrid) {
        console.error("DOM Elements (adminCurrentMonthDisplay or adminCalendarGrid) not found.");
        return;
    }

    // 2. 準備日期與參數
    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();

    // 統一格式：YYYY-MM (API用) 與 UserId-YYYY-MM (快取用)
    const apiMonthParam = `${year}-${monthStr}`;
    const cacheKey = `${userId}-${year}-${monthStr}`;

    // 定義一個內部函式來執行 UI 更新 (避免重複程式碼)
    const updateCalendarUI = (records) => {
        const uiStartTime = performance.now();

        // 清空並渲染日曆 (renderCalendarWithData 來自 ui.js)
        // ✅ XSS防護：使用 replaceChildren() 替代 innerHTML
        console.time('  ├─ replaceChildren');
        calendarGrid.replaceChildren();
        console.timeEnd('  ├─ replaceChildren');

        console.time('  ├─ renderCalendarWithData');
        renderCalendarWithData(year, month, today, records, calendarGrid, monthTitle, true);
        console.timeEnd('  ├─ renderCalendarWithData');

        // 加入星期標籤 (必須在格子生成後執行)
        console.time('  ├─ addWeekdayLabels');
        _addWeekdayLabelsToAdminCalendar(year, month);
        console.timeEnd('  ├─ addWeekdayLabels');

        const uiEndTime = performance.now();
        console.log(`  └─ UI更新完成: ${(uiEndTime - uiStartTime).toFixed(2)}ms`);
    };

    // 3. 邏輯分支：檢查快取 vs API 請求
    if (adminMonthDataCache[cacheKey]) {
        // --- 情境 A: 快取有資料 ---
        const cacheStartTime = performance.now();
        console.log(`%c[Cache Hit] ✓ 快取命中`, 'color: #00aa00; font-weight: bold;', `使用快取數據: ${cacheKey}`);
        updateCalendarUI(adminMonthDataCache[cacheKey]);
        const cacheEndTime = performance.now();
        console.log(`%c[Cache Load] 完成 - 耗時 ${(cacheEndTime - cacheStartTime).toFixed(2)}ms`, 'color: #00aa00;');
        recordAdminMonthNavigation(date);

        // 🚀 P4-2 優化：預加載和導航記錄並行執行（不阻塞主流程）
        Promise.all([
            prefetchMonthDetails(apiMonthParam, userId),
            preloadAdjacentAdminMonths(date, userId)
        ]).catch(err => console.warn("預加載出錯:", err));

    } else {
        // --- 情境 B: 無快取，需請求 API ---
        const apiStartTime = performance.now();
        console.log(`%c[API Request] ⏳ 快取未命中，發送 API 請求...`, 'color: #ff9900;');

        // 顯示 Loading 狀態
        // ✅ XSS防護：使用 DOMPurify 淨化 HTML
        calendarGrid.innerHTML = DOMPurify.sanitize('<div data-i18n="LOADING" class="col-span-full text-center text-gray-500 py-4">正在載入...</div>');
        if (typeof renderTranslations === 'function') renderTranslations(calendarGrid);

        try {
            console.time('  ├─ API callApifetch');
            const res = await callApifetch({
                action: 'getCalendarSummary',
                month: apiMonthParam,
                userId: userId
            });
            console.timeEnd('  ├─ API callApifetch');

            if (res.ok) {
                // 儲存至快取
                const records = res.records.dailyStatus || [];
                console.time('  ├─ cacheAdminMonthData');
                cacheAdminMonthData(cacheKey, records);
                console.timeEnd('  ├─ cacheAdminMonthData');

                // 更新 UI
                console.time('  ├─ updateCalendarUI');
                updateCalendarUI(records);
                console.timeEnd('  ├─ updateCalendarUI');

                const apiEndTime = performance.now();
                console.log(`%c[API Load] ✓ 完成 - 耗時 ${(apiEndTime - apiStartTime).toFixed(2)}ms`, 'color: #00aa00;');
                recordAdminMonthNavigation(date);

                // 🚀 P4-2 優化：預加載和導航記錄並行執行（不阻塞主流程）
                Promise.all([
                    prefetchMonthDetails(apiMonthParam, userId),
                    preloadAdjacentAdminMonths(date, userId)
                ]).catch(err => console.warn("預加載出錯:", err));
            } else {
                // API 回傳錯誤
                console.error("Failed to fetch admin attendance records:", res.msg);
                // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                calendarGrid.innerHTML = DOMPurify.sanitize(`<div class="col-span-full text-center text-red-500 py-4">${res.msg || '無法載入資料'}</div>`);
                showNotification(res.msg || t("ERROR_FETCH_RECORDS"), "error");
            }
        } catch (err) {
            // 網路或系統錯誤
            console.error("System Error in renderAdminCalendar:", err);
            // ✅ XSS防護：使用 DOMPurify 淨化 HTML
            calendarGrid.innerHTML = DOMPurify.sanitize('<div class="col-span-full text-center text-red-500 py-4">發生系統錯誤</div>');
        }
    }
}

function formatAdminMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function cacheAdminMonthData(monthkey, data) {
    const existingIndex = adminMonthCacheOrder.indexOf(monthkey);
    if (existingIndex !== -1) {
        adminMonthCacheOrder.splice(existingIndex, 1);
    }
    adminMonthCacheOrder.push(monthkey);
    adminMonthDataCache[monthkey] = data;
    while (adminMonthCacheOrder.length > MAX_ADMIN_MONTH_CACHE_ENTRIES) {
        const oldestKey = adminMonthCacheOrder.shift();
        delete adminMonthDataCache[oldestKey];
    }
}

function recordAdminMonthNavigation(date) {
    const monthKey = formatAdminMonthKey(date);
    if (adminMonthNavigationHistory[adminMonthNavigationHistory.length - 1] !== monthKey) {
        adminMonthNavigationHistory.push(monthKey);
    }
    if (adminMonthNavigationHistory.length > 6) {
        adminMonthNavigationHistory.shift();
    }
}

function parseAdminMonthKey(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

function getPredictedAdminMonthKeys(currentDate) {
    if (adminMonthNavigationHistory.length < 2) return [];

    const last = parseAdminMonthKey(adminMonthNavigationHistory[adminMonthNavigationHistory.length - 1]);
    const prev = parseAdminMonthKey(adminMonthNavigationHistory[adminMonthNavigationHistory.length - 2]);
    const direction = (last.getFullYear() - prev.getFullYear()) * 12 + (last.getMonth() - prev.getMonth());

    if (Math.abs(direction) !== 1) return [];

    const next1 = new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1);
    const next2 = new Date(currentDate.getFullYear(), currentDate.getMonth() + direction * 2, 1);
    const nextKeys = [formatAdminMonthKey(next1)];

    if (adminMonthNavigationHistory.length >= 3) {
        const prev2 = parseAdminMonthKey(adminMonthNavigationHistory[adminMonthNavigationHistory.length - 3]);
        const direction2 = (prev.getFullYear() - prev2.getFullYear()) * 12 + (prev.getMonth() - prev2.getMonth());
        if (direction2 === direction) {
            nextKeys.push(formatAdminMonthKey(next2));
        }
    }
    return nextKeys;
}

async function preloadAdjacentAdminMonths(currentDate, userId) {
    try {
        const prevMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        const prevKey = formatAdminMonthKey(prevMonth);
        const nextKey = formatAdminMonthKey(nextMonth);
        const predictedKeys = getPredictedAdminMonthKeys(currentDate);
        const uniqueKeys = [prevKey, nextKey, ...predictedKeys].filter((key, idx, arr) => key && arr.indexOf(key) === idx);

        uniqueKeys.forEach((key, index) => {
            if (adminMonthDataCache[key]) return;
            const delay = PRELOAD_BASE_DELAY + index * PRELOAD_INCREMENT_DELAY;
            setTimeout(async () => {
                try {
                    const res = await callApifetch({
                        action: 'getCalendarSummary',
                        month: key,
                        userId: userId
                    });
                    if (res.ok) {
                        cacheAdminMonthData(key, res.records.dailyStatus || []);
                        console.log(`✅ Admin 預加載 ${key} 成功`);
                    }
                } catch (err) {
                    console.warn(`⚠️ Admin 預加載 ${key} 失敗:`, err.message);
                }
            }, delay);
        });
    } catch (err) {
        console.warn("⚠️ Admin 預加載相鄰月份出錯:", err.message);
    }
}



/**
 * 渲染管理員視圖中，某一天點擊後的打卡紀錄
 * @param {string} dateKey - 點擊的日期 (YYYY-MM-DD)
 * @param {string} userId - 管理員選定的員工 ID
 */
async function renderAdminDailyRecords(dateKey, userId) {
    // 確保使用全域變數，而非 document.getElementById
    adminDailyRecordsTitle.textContent = t("DAILY_RECORDS_TITLE", { dateKey: dateKey });
    if (typeof renderDayKindBadge === 'function') {
        renderDayKindBadge(adminDailyRecordsTitle, dateKey);
    }

    adminDailyRecordsList.replaceChildren();
    adminDailyRecordsEmpty.style.display = 'none';
    adminDailyRecordsCard.style.display = 'block';
    adminRecordsLoading.style.display = 'block';

    const dateObject = new Date(dateKey);
    const monthKey = dateObject.getFullYear() + "-" + String(dateObject.getMonth() + 1).padStart(2, "0");

    try {
        const details = await loadMonthDetailData(monthKey, userId);
        adminRecordsLoading.style.display = 'none';

        if (details !== null && details !== undefined) {
            renderRecords(details);
        } else {
            const res = await callApifetch({
                action: 'getAttendanceDetails',
                month: monthKey,
                userId: userId
            }, 'admin-records-loading');

            adminRecordsLoading.style.display = 'none';
            if (res.ok) {
                renderRecords(res.records.dailyStatus);
            } else {
                console.error("Admin: Failed to fetch attendance records:", res.msg);
                showNotification(t("ERROR_FETCH_RECORDS"), "error");
            }
        }
    } catch (err) {
        adminRecordsLoading.style.display = 'none';
        console.error(err);
    }

    // 內部函式：渲染日紀錄列表
    function renderRecords(records) {
        const dailyRecords = records.filter(record => record.date === dateKey);
        console.log(dailyRecords);
        // 清空現有列表
        adminDailyRecordsList.replaceChildren();

        // 移除舊的 externalInfo（假設 className 為 'daily-summary' 以便識別）
        const existingSummaries = adminDailyRecordsList.parentNode.querySelectorAll('.daily-summary');
        existingSummaries.forEach(summary => summary.remove());

        if (dailyRecords.length > 0) {
            adminDailyRecordsEmpty.style.display = 'none';

            // 假設 dailyRecords 通常只有一個（單一日期），但以 forEach 處理可能多個
            dailyRecords.forEach(dailyRecord => {
                // 安全檢查：確保 record 存在且為數組
                if (!dailyRecord.record || !Array.isArray(dailyRecord.record)) {
                    console.warn('記錄數據結構異常:', dailyRecord);
                    return;
                }

                // 為每個打卡記錄創建獨立卡片
                dailyRecord.record.forEach(r => {
                    const li = document.createElement('li');
                    li.className = 'p-3 rounded-lg';

                    // 根據 type 設定不同顏色
                    if (r.type === '上班') {
                        li.classList.add('bg-blue-50', 'dark:bg-blue-700'); // 上班顏色（藍色系）
                    } else if (r.type === '下班') {
                        li.classList.add('bg-green-50', 'dark:bg-green-700'); // 下班顏色（綠色系）
                    } else {
                        li.classList.add('bg-gray-50', 'dark:bg-gray-700'); // 其他類型（灰色系）
                    }

                    // 根據 r.type 的值來選擇正確的翻譯鍵值
                    const typeKey = r.type === '上班' ? 'PUNCH_IN' : 'PUNCH_OUT';

                    // 產生單一打卡記錄的 HTML
                    // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                    const recordHtml = `
                        <p class="font-medium text-gray-800 dark:text-white">${r.time} - ${t(typeKey)}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">地點: ${r.location}</p>
                        <p data-i18n="RECORD_NOTE_PREFIX" class="text-sm text-gray-500 dark:text-gray-400">備註：${r.note}</p>
                    `;
                    li.innerHTML = DOMPurify.sanitize(recordHtml);

                    adminDailyRecordsList.appendChild(li);
                    renderTranslations(li);  // 渲染翻譯
                });

                // 在卡片列表外部顯示系統判斷與時數
                const externalInfo = document.createElement('div');
                externalInfo.className = 'daily-summary mt-4 p-3 bg-gray-100 dark:bg-gray-600 rounded-lg';

                // 薪資顯示已移除（待重新設計），此處只顯示工時
                let hoursHtml = '';
                if (dailyRecord.hours > 0) {
                    hoursHtml = `
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                            <span data-i18n="RECORD_HOURS_PREFIX">當日工作時數：</span>
                            ${dailyRecord.hours} 小時
                        </p>
                    `;
                }

                // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                const externalInfoHtml = `
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                            <span data-i18n="RECORD_REASON_PREFIX">系統判斷：</span>
                            ${t(dailyRecord.reason)}
                        </p>
                        ${hoursHtml}
                `;
                externalInfo.innerHTML = DOMPurify.sanitize(externalInfoHtml);
                // append 到 adminDailyRecordsList 後面
                adminDailyRecordsList.parentNode.appendChild(externalInfo);
                renderTranslations(externalInfo);  // 渲染翻譯
            });
        } else {
            adminDailyRecordsEmpty.style.display = 'block';
        }
        adminRecordsLoading.style.display = 'none';
    }
}

/**
 * 在管理員日曆上方顯示一列星期標頭（與月份檢視相同）
 * @param {number} year - 年份
 * @param {number} month - 月份 (0-11)
 */
function _addWeekdayLabelsToAdminCalendar(year, month) {
    const grid = document.getElementById('admin-calendar-grid');
    if (!grid) return;
    const parent = grid.parentNode;
    if (!parent) return;

    // 如果已經存在 header，就更新，否則建立一個放在 grid 之前
    let header = parent.querySelector('.admin-weekday-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'admin-weekday-header grid grid-cols-7 gap-1 mb-2 text-center text-sm text-gray-600 dark:text-gray-300';
        parent.insertBefore(header, grid);
    } else {
        header.replaceChildren();
    }

    const lang = (typeof currentLang !== 'undefined' && currentLang) ? currentLang : 'zh-TW';
    const fallbackWeek = ['日', '一', '二', '三', '四', '五', '六'];

    // 使用固定週起始日期 (2021-08-01 為週日)，用 toLocaleDateString 取得短週名稱
    for (let i = 0; i < 7; i++) {
        let label = '';
        try {
            const d = new Date(Date.UTC(2021, 7, 1 + i)); // 2021-08-01 ~ Sun
            label = d.toLocaleDateString(lang, { weekday: 'short' });
        } catch (e) {
            label = `週${ fallbackWeek[i] } `;
        }
        const cell = document.createElement('div');
        cell.className = 'py-1';
        cell.textContent = label;
        header.appendChild(cell);
    }
}
// #endregion

// ===================================
// #region 2. 待審核請求與審批
// ===================================

/**
 * 取得並渲染所有待審核的請求。
 */
async function fetchAndRenderReviewRequests() {
    // 🌟 修正點 (問題1.1)：在獲取審核請求前驗證管理員權限
    const isAdmin = await verifyAdminPermission();
    if (!isAdmin) {
        console.error("非管理員用戶嘗試獲取待審核請求");
        showNotification(t("ERR_NO_PERMISSION") || "您沒有管理員權限", "error");
        return;
    }

    // 修正：使用全域變數 (來自 state.js 並在 app.js/getDOMElements 中賦值)
    const loadingEl = requestsLoading;
    const emptyEl = requestsEmpty;
    const listEl = pendingRequestsList; // 假設您在 state.js 中正確宣告了這些變數

    loadingEl.style.display = 'block';
    emptyEl.style.display = 'none';
    listEl.replaceChildren();

    try {
        const res = await callApifetch({ action: 'getReviewRequest' }); // 來自 core.js
        if (res.ok && Array.isArray(res.reviewRequest)) {
            pendingRequests = res.reviewRequest; // 來自 state.js

            if (pendingRequests.length === 0) {
                emptyEl.style.display = 'block';
            } else {
                renderReviewRequests(pendingRequests);
            }
        } else {
            showNotification(t("MSG_FETCH_REVIEW_FAILED", { msg: res.msg || "" }), "error"); // 來自 core.js
            emptyEl.style.display = 'block';
        }
    } catch (error) {
        showNotification(t("MSG_FETCH_REVIEW_NETWORK_ERROR"), "error");
        emptyEl.style.display = 'block';
        console.error("Failed to fetch review requests:", error);
    } finally {
        loadingEl.style.display = 'none';
    }
}

/**
 * 根據資料渲染待審核列表。
 * 修正: 使用全域變數 pendingRequestsList
 * @param {Array<Object>} requests - 請求資料陣列。
 */
function renderReviewRequests(requests) {
    const listEl = pendingRequestsList; // 修正：使用全域變數
    listEl.replaceChildren();

    requests.forEach((req, index) => {
        const li = document.createElement('li');
        li.className = 'p-4 bg-gray-50 rounded-lg shadow-sm flex flex-col space-y-2 dark:bg-gray-700';

        // 判斷是補打卡還是請假/休假
        const isLeaveRequest = req.remark && req.remark !== "補打卡";

        // 構建詳情文字
        let detailText = req.name || "（未知）";
        if (isLeaveRequest) {
            // 請假/休假記錄：顯示 "姓名 - 原因"
            detailText = `${ req.name || "（未知）" } - ${ req.remark || "（無原因）" } `;
        }

        const unknownText = t('UNKNOWN') || '（未知）';
        const labelTimeKey = isLeaveRequest ? 'LABEL_LEAVE_VACATION_TIME' : 'LABEL_REPAIR_TIME';
        const badgeKey = isLeaveRequest ? 'BADGE_LEAVE_VACATION' : 'BADGE_REPAIR';

        // 將 prefix label 與 badge 用 data-i18n 包起，讓切換語言後 renderTranslations 自動更新
        // ✅ XSS防護：使用 DOMPurify 淨化 HTML
        const requestItemHtml = `
        <div class="flex flex-col space-y-1">
            <div class="flex items-center justify-between w-full">
                <div>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${detailText}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400"><span data-i18n="LABEL_APPLICATION_TIME">申請時間</span>：${req.applicationTime || unknownText}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400"><span data-i18n="${labelTimeKey}">${isLeaveRequest ? '請假/休假時間' : '補打卡時間'}</span>：${req.targetTime || unknownText}</p>
                </div>
                <span data-i18n="${badgeKey}" class="text-xs font-semibold px-2 py-1 rounded-md ${isLeaveRequest ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}">${isLeaveRequest ? '請假/休假' : '補打卡'}</span>
            </div>
        </div>

        <div class="flex items-center justify-between w-full mt-2">
            <p
                data-i18n-key="${req.type}"
                class="text-sm text-indigo-600 dark:text-indigo-400 font-medium">
            </p>

            <div class="flex space-x-2">
                <button data-i18n="ADMIN_APPROVE_BUTTON" data-index="${index}" class="approve-btn px-3 py-1 rounded-md text-sm font-bold btn-primary">核准</button>
                <button data-i18n="ADMIN_REJECT_BUTTON" data-index="${index}" class="reject-btn px-3 py-1 rounded-md text-sm font-bold btn-warning">拒絕</button>
            </div>
        </div>
    `;
        li.innerHTML = DOMPurify.sanitize(requestItemHtml);
        listEl.appendChild(li);
        renderTranslations(li); // 來自 core.js
    });

    // 事件綁定 (審批動作)
    listEl.querySelectorAll('.approve-btn').forEach(button => {
        button.addEventListener('click', (e) => handleReviewAction(e.currentTarget, e.currentTarget.dataset.index, 'approve'));
    });

    listEl.querySelectorAll('.reject-btn').forEach(button => {
        button.addEventListener('click', (e) => handleReviewAction(e.currentTarget, e.currentTarget.dataset.index, 'reject'));
    });
}

/**
 * 處理審核動作（核准或拒絕）。
 * 🌟 修正點 (問題1.1)：在執行操作前驗證管理員權限
 * 🌟 修正點 (問題8.6)：添加二次確認對話框
 */
async function handleReviewAction(button, index, action) {
    // 🌟 驗證管理員權限
    const isAdmin = await verifyAdminPermission();
    if (!isAdmin) {
        showNotification(t("ERR_NO_PERMISSION") || "您沒有管理員權限", "error");
        return;
    }

    const request = pendingRequests[index]; // 來自 state.js
    // ... (錯誤檢查與 API 呼叫邏輯與您提供的相同) ...

    const recordId = request.id;
    const endpoint = action === 'approve' ? 'approveReview' : 'rejectReview';
    const loadingText = t('LOADING') || '處理中...';

    // 🌟 修正點 (問題8.6)：添加確認對話框
    const actionText = t(action === 'approve' ? 'ACTION_APPROVE' : 'ACTION_REJECT');
    const confirmMsg = t('CONFIRM_REVIEW_ACTION', { action: actionText });
    const confirmed = await showConfirmDialog(confirmMsg);

    if (!confirmed) {
        return; // 用戶取消操作
    }

    // generalButtonState 來自 ui.js
    generalButtonState(button, 'processing', loadingText);

    try {
        const res = await callApifetch({
            action: endpoint,
            id: recordId
        });
        if (res.ok) {
            const translationKey = action === 'approve' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED';
            showNotification(t(translationKey), "success");
            await new Promise(resolve => setTimeout(resolve, 500));
            // 成功後重新整理列表
            fetchAndRenderReviewRequests();
        } else {
            showNotification(t('REVIEW_FAILED', { msg: res.msg }), "error");
        }
    } catch (err) {
        showNotification(t("REVIEW_NETWORK_ERROR"), "error");
        console.error(err);
    } finally {
        generalButtonState(button, 'idle'); // generalButtonState 來自 ui.js
    }
}
// #endregion

// ===================================
// #region 3. 員工列表與管理員初始化
// ===================================

/**
 * 載入員工列表 (新增一個 GAS 函式來獲取所有員工)
 * 修正: 使用全域變數 adminSelectEmployee
 */
async function loadEmployeeList() {
    const loadingId = "loading-employees";

    try {
        const data = await callApifetch({ action: 'getEmployeeList' }, loadingId);
        if (data && data.ok === true) {
            const employees = data.employeesList;
            allEmployeeList = employees; // 儲存員工列表 (來自 state.js)

            // Phase 1：合併員工選擇器，只填充唯一的 mgmt select
            // ✅ XSS防護：使用 DOM API 代替 innerHTML
            adminSelectEmployeeMgmt.replaceChildren();
            const mgmtOption0 = document.createElement('option');
            mgmtOption0.value = '';
            mgmtOption0.textContent = t('OPT_SELECT_EMPLOYEE') || '-- 請選擇一位員工 --';
            adminSelectEmployeeMgmt.appendChild(mgmtOption0);

            employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.userId;
                option.textContent = `${ employee.name } (${ employee.userId.substring(0, 8) }...)`;
                adminSelectEmployeeMgmt.appendChild(option);
            });
        } else {
            const errorMessage = data?.message || data?.code || t("FAILED_TO_LOAD_EMPLOYEES");
            console.error("載入員工列表時 API 回傳失敗:", data, errorMessage);
            showNotification(errorMessage, "error");
        }
    } catch (e) {
        console.error("loadEmployeeList 呼叫流程錯誤:", e);
    }
}


/**
 * 設置待審核請求區塊的收合/展開功能。
 */
function setupRequestToggle() {
    // 修正：使用全域變數 (來自 state.js 並在 app.js/getDOMElements 中賦值)
    const toggleButton = toggleRequestsBtn;
    const contentDiv = pendingRequestsContent;
    const iconSpan = toggleRequestsIcon; // 假設您在 state.js 中宣告了這些變數

    if (!toggleButton || !contentDiv || !iconSpan) {
        return;
    }

    function toggleCollapse() {
        // ... (收合/展開邏輯與您提供的相同) ...
        contentDiv.classList.toggle('hidden');

        if (contentDiv.classList.contains('hidden')) {
            toggleButton.classList.add('rotate-180');
        } else {
            toggleButton.classList.remove('rotate-180');
        }
    }

    toggleButton.addEventListener('click', toggleCollapse);
}


/**
 * 統一管理員頁面事件的綁定
 */
function initAdminEvents() {
    // Phase 1：合併員工選擇器
    // 一個 select 觸發：員工資料設定卡 + 員工日曆卡 + 後續所有 dashboard 卡
    adminSelectEmployeeMgmt.addEventListener('change', async (e) => {
        const selectedUserId = e.target.value;
        const employee = allEmployeeList.find(emp => emp.userId === selectedUserId);

        // 全域 state（給其他模組用）
        adminSelectedUserId = selectedUserId || null;
        currentManagingEmployee = employee || null;

        // 同步顯示／隱藏員工日曆卡（原本在獨立 handler 內）
        if (selectedUserId) {
            // Phase L2：預熱公司休息時段 cache（fire-and-forget；後續 enrich 取 getCachedBreakTimes()）
            loadBreakTimes().catch((err) => console.error('預熱 breakTimes cache 失敗：', err));

            adminEmployeeCalendarCard.style.display = 'block';
            renderAdminCalendar(selectedUserId, adminCurrentDate).catch((err) =>
                console.error('renderAdminCalendar 失敗：', err)
            );
            // Phase 3：載入並計算當月 KPI
            renderEmployeeKpi(selectedUserId, adminCurrentDate).catch((err) =>
                console.error('renderEmployeeKpi 失敗：', err)
            );
            // Phase 4：載入該員工申請紀錄（預設「待審核」tab）
            renderEmployeeRequestHistory(selectedUserId, '?').catch((err) =>
                console.error('renderEmployeeRequestHistory 失敗：', err)
            );
            // Phase 5：連續上工 + 請假統計
            renderEmployeeStreakAndLeaveStats(selectedUserId, adminCurrentDate).catch((err) =>
                console.error('renderEmployeeStreakAndLeaveStats 失敗：', err)
            );
            // Phase 6：本月打卡紀錄表格
            renderEmployeePunchTable(selectedUserId, adminCurrentDate).catch((err) =>
                console.error('renderEmployeePunchTable 失敗：', err)
            );
        } else {
            adminEmployeeCalendarCard.style.display = 'none';
            renderEmployeeKpi(null);
            renderEmployeeRequestHistory(null);
            renderEmployeeStreakAndLeaveStats(null);
            renderEmployeePunchTable(null);
        }

        if (employee) {
            // 修正屬性名稱：src 和您的資料屬性
            mgmtEmployeeName.textContent = employee.name;
            //mgmtEmployeeId.textContent = employee.userId;
            const joinTimeSource = employee.firstLoginTime;
            const naText = t('VALUE_NA') || 'N/A';
            let seniorityText = naText;
            let joinDateText = naText;

            // 防 Invalid Date：缺值或解析失敗均顯示 N/A，不嘗試 toLocaleDateString
            const joinDate = joinTimeSource ? new Date(joinTimeSource) : null;
            const hasValidJoinDate = joinDate && !isNaN(joinDate.getTime());

            if (hasValidJoinDate) {
                // 假設 currentLang 已經定義 (在 state.js 中)
                const formattedDate = joinDate.toLocaleDateString(currentLang, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                const formattedTime = joinDate.toLocaleTimeString(currentLang, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false // 使用 24 小時制
                });
                joinDateText = `${ formattedDate } ${ formattedTime } `;
                const today = new Date();

                // 計算總月份數 (更精確的年資計算方法)
                const totalMonths = (today.getFullYear() - joinDate.getFullYear()) * 12 + (today.getMonth() - joinDate.getMonth());

                let years = Math.floor(totalMonths / 12);
                let months = totalMonths % 12;

                // 如果當前日期比入職日期的當月日期早，則月份減一
                if (today.getDate() < joinDate.getDate()) {
                    months--;
                    if (months < 0) {
                        months += 12;
                        years--;
                    }
                }

                seniorityText = '';
                if (years > 0) seniorityText += `${ years } ${ t("YEAR") || '年' } `;
                // 只有當月份 > 0 或者總年資不到一年時才顯示月份
                if (months > 0 || (years === 0 && months === 0)) seniorityText += `${ months } ${ t("MONTH") || '個月' } `;
                seniorityText = seniorityText.trim() || naText;
            }

            // P2-3 優化：動態生成 Info Items
            const infoContainer = document.getElementById('employee-info-container');
            if (infoContainer) {
                infoContainer.replaceChildren();

                // 年資 Info Item
                const seniorityItem = UIComponentGenerator.createInfoItem({
                    icon: 'fa-crown',
                    label: t('SENIORITY') || '年資',
                    value: seniorityText,
                    colorScheme: 'yellow',
                    i18nKey: 'SENIORITY'
                });
                infoContainer.appendChild(seniorityItem);

                // 入職日期 Info Item
                const joinDateItem = UIComponentGenerator.createInfoItem({
                    icon: 'far fa-calendar-alt',
                    label: t('JOIN_DATE') || '入職日期',
                    value: joinDateText,
                    colorScheme: 'blue',
                    i18nKey: 'JOIN_DATE'
                });
                infoContainer.appendChild(joinDateItem);

                // 職務狀態 Info Item
                const positionText = employee.position || '正式員工';
                const positionItem = UIComponentGenerator.createInfoItem({
                    icon: 'fa-briefcase',
                    label: t('EMPLOYEE_TYPE') || '職務狀態',
                    value: positionText,
                    colorScheme: 'indigo',
                    i18nKey: 'EMPLOYEE_TYPE'
                });
                infoContainer.appendChild(positionItem);
            }

            mgmtEmployeeAvatar.src = employee.picture || '預設頭像 URL';
            // 薪資 UI 已移除，待重新設計後重建

            // P2-3 優化：動態生成 Toggle 設定項
            const settingsContainer = document.getElementById('employee-settings-container');
            if (settingsContainer) {
                settingsContainer.replaceChildren();

                // 管理員權限 Toggle
                const adminToggle = UIComponentGenerator.createToggleSetting({
                    id: 'toggle-admin',
                    label: t('IS_ADMIN') || '管理員權限',
                    checked: employee.position === "管理員",
                    colorScheme: 'yellow',
                    statusText: { on: '啟用', off: '關閉' },
                    i18nKey: 'IS_ADMIN',
                    onchange: (e) => toggleAdminStatus(currentManagingEmployee.userId, e.target.checked)
                });
                settingsContainer.appendChild(adminToggle);

                // 帳號啟用狀態 Toggle
                const activeToggle = UIComponentGenerator.createToggleSetting({
                    id: 'toggle-active',
                    label: t('ACCOUNT_STATUS') || '帳號啟用狀態',
                    checked: employee.status === "啟用",
                    colorScheme: 'green',
                    statusText: { on: '啟用', off: '關閉' },
                    i18nKey: 'ACCOUNT_STATUS',
                    onchange: (e) => toggleAccountStatus(currentManagingEmployee.userId, e.target.checked)
                });
                settingsContainer.appendChild(activeToggle);

                // 更新全域參考（以兼容舊代碼）
                toggleAdmin = document.getElementById('toggle-admin');
                toggleActive = document.getElementById('toggle-active');
            }

            employeeDetailCard.style.display = 'block';
            mgmtPlaceholder.style.display = 'none';
        } else {
            // 處理未選擇或找不到的情況
            employeeDetailCard.style.display = 'none';
            mgmtPlaceholder.style.display = 'block';
        }

        // Phase L0：跨 tab 共用員工選擇 → 同步顯示員工設定內容
        syncEmployeeSettingsVisibility();
    });

    // 2. 處理月份切換事件
    adminPrevMonthBtn.addEventListener('click', () => {
        adminCurrentDate.setMonth(adminCurrentDate.getMonth() - 1);
        if (adminSelectedUserId) {
            renderAdminCalendar(adminSelectedUserId, adminCurrentDate);
            renderEmployeeKpi(adminSelectedUserId, adminCurrentDate).catch(console.error);
            renderEmployeeStreakAndLeaveStats(adminSelectedUserId, adminCurrentDate).catch(console.error);
            renderEmployeePunchTable(adminSelectedUserId, adminCurrentDate).catch(console.error);
        }
    });

    adminNextMonthBtn.addEventListener('click', () => {
        adminCurrentDate.setMonth(adminCurrentDate.getMonth() + 1);
        if (adminSelectedUserId) {
            renderAdminCalendar(adminSelectedUserId, adminCurrentDate);
            renderEmployeeKpi(adminSelectedUserId, adminCurrentDate).catch(console.error);
            renderEmployeeStreakAndLeaveStats(adminSelectedUserId, adminCurrentDate).catch(console.error);
            renderEmployeePunchTable(adminSelectedUserId, adminCurrentDate).catch(console.error);
        }
    });

    // 3. 設置待審核請求收合功能
    setupRequestToggle();



    // 若新增按鈕為 disabled 時，點擊 wrapper 顯示具體提示（未輸入名稱 / 未取得位置）
    const addWrapper = document.getElementById('add-location-wrapper');
    if (addWrapper) {
        addWrapper.addEventListener('click', (e) => {
            const addBtnEl = document.getElementById('add-location-btn');
            if (!addBtnEl) return;
            if (!addBtnEl.disabled) return;

            const nameEl = document.getElementById('location-name');
            const latEl = document.getElementById('location-lat');
            const lngEl = document.getElementById('location-lng');

            let msg = '';
            if (!nameEl || !nameEl.value.trim()) {
                msg = (typeof t === 'function') ? (t('ADD_LOCATION_NAME_REQUIRED') || '請輸入地點名稱') : '請輸入地點名稱';
            } else if (!latEl || !latEl.value.trim() || !lngEl || !lngEl.value.trim()) {
                msg = (typeof t === 'function') ? (t('ADD_LOCATION_COORDS_REQUIRED') || '請先取得位置或在地圖上點選地點') : '請先取得位置或在地圖上點選地點';
            } else {
                msg = (typeof t === 'function') ? (t('ADD_LOCATION_DISABLED_HINT') || '請檢查欄位') : '請檢查欄位';
            }

            showNotification(msg, 'info');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    // 5. 處理新增打卡地點
    // 🌟 修正點 (問題1.1)：在新增地點前驗證管理員權限
    // 🌟 修正點 (問題8.6)：添加確認對話框
    addLocationBtn.addEventListener('click', async () => {
        // 驗證管理員權限
        const isAdmin = await verifyAdminPermission();
        if (!isAdmin) {
            showNotification(t("ERR_NO_PERMISSION") || "您沒有管理員權限", "error");
            return;
        }

        const name = locationName.value; // 假設您有宣告 locationName
        const lat = locationLatInput.value;
        const lng = locationLngInput.value;

        if (!name || !lat || !lng) {
            showNotification(t("MSG_FILL_FIELDS_AND_LOCATION"), "error");
            return;
        }

        // 🌟 修正點 (問題8.6)：添加確認對話框
        const confirmMsg = t('CONFIRM_ADD_LOCATION', { name: name });
        const confirmed = await showConfirmDialog(confirmMsg);

        if (!confirmed) {
            return; // 用戶取消操作
        }

        try {
            const res = await callApifetch({
                action: 'addLocation',
                name: name,
                lat: encodeURIComponent(lat),
                lng: encodeURIComponent(lng)
            });
            if (res.ok) {
                showNotification(t("MSG_LOCATION_ADDED"), "success");
                // 清空輸入欄位
                locationName.value = ''; // 假設您有宣告 locationName
                locationLatInput.value = '';
                locationLngInput.value = '';
                // 重設按鈕狀態
                getLocationBtn.textContent = '取得當前位置';
                getLocationBtn.disabled = false;
                addLocationBtn.disabled = true;
            } else {
                showNotification(t("MSG_ADD_LOCATION_FAILED", { msg: res.msg || "" }), "error");
            }
        } catch (err) {
            console.error(err);
        }
    });

    // 註冊月薪收折與匯出功能（確保 DOM 元素已存在）
    setupAdminExport();
    setupTestNotificationButton();
    setupBreakTimesEditor();
    // Phase L0：員工設定 sub-tab 切換
    setupEmployeeSettingTabs();
}

/**
 * 管理員儀表板的總啟動函式 (供 app.js 呼叫)
 * 🌟 修正點 (問題1.1)：在載入前驗證管理員權限
 */
async function loadAdminDashboard() {
    // 🌟 新增驗證：確保用戶真的有管理員權限
    const isAdmin = await verifyAdminPermission();
    if (!isAdmin) {
        console.error("非管理員用戶嘗試訪問管理員儀表板");
        showNotification(t("ERR_NO_PERMISSION") || "您沒有管理員權限", "error");
        // 隱藏管理員 Tab
        const tabAdminBtn = document.getElementById('tab-admin-btn');
        if (tabAdminBtn) tabAdminBtn.style.display = 'none';
        return;
    }

    // 確保 adminEventsBound 在 state.js 中被宣告為 let adminEventsBound = false;
    if (!adminEventsBound) {
        initAdminEvents();
        adminEventsBound = true;
    }

    // 1. 載入員工列表並填充下拉選單
    await loadEmployeeList();

    // 2. 載入待審核請求
    await fetchAndRenderReviewRequests();
}
// #endregion

// ===================================
// #region 4. API 測試（通用但為開發目的，可放在 core.js 或 app.js/bindEvents）
// 這裡暫時保留在 admin.js，但建議移動到 app.js/bindEvents
// ===================================

document.getElementById('test-api-btn').addEventListener('click', async () => {
    const testAction = "testEndpoint";
    try {
        const res = await callApifetch({ action: testAction });
        if (res && res.ok) {
            showNotification(t("MSG_API_TEST_SUCCESS", { response: JSON.stringify(res) }), "success");
        } else {
            showNotification(t("MSG_API_TEST_FAILED", { msg: (res && res.msg) || "" }), "error");
        }
    } catch (error) {
        console.error("API 呼叫發生錯誤:", error);
        showNotification(t("MSG_API_CALL_FAILED"), "error");
    }
});
// #endregion
// ===================================

// ===================================
// #region 5. 管理員子頁籤切換邏輯
// ===================================
/**
 * 切換管理員頁面內的子頁籤 (Admin Sub-Tab Switcher)
 * @param {string} subTabId - 要切換到的子頁籤 ID (例如: 'review-requests')
 */

const switchAdminSubTab = (subTabId) => {
    const subTabs = [
        'employee-mgmt-view',
        'employee-settings-view',
        'punch-mgmt-view',
        'form-review-view',
        'scheduling-view'
    ];
    const subBtns = [
        'tab-employee-mgmt-btn',
        'tab-employee-settings-btn',
        'tab-punch-mgmt-btn',
        'tab-form-review-btn',
        'tab-scheduling-btn'
    ];

    // 1. 移除所有子頁籤內容的顯示
    subTabs.forEach(id => {
        const tabElement = document.getElementById(id);
        if (tabElement) {
            tabElement.style.display = 'none';
        }
    });

    subBtns.forEach(id => {
        const btnElement = document.getElementById(id);
        if (btnElement) {
            btnElement.classList.replace('bg-indigo-600', 'bg-gray-200');
            btnElement.classList.replace('text-white', 'text-gray-600');
        }
    });

    // 3. 顯示新頁籤並新增 active 類別
    const newTabElement = document.getElementById(subTabId);
    if (newTabElement) {
        newTabElement.style.display = 'block'; // 顯示內容
    }

    // 4. 設定新頁籤按鈕的選中狀態
    const newBtnElement = document.getElementById(`tab-${subTabId.replace('-view', '-btn')}`);
    if (newBtnElement) {
        newBtnElement.classList.replace('bg-gray-200', 'bg-indigo-600');
        newBtnElement.classList.replace('text-gray-600', 'text-white');
    }

    // 5. 員工選擇器只與「員工報表 / 員工設定」相關，其他 tab 隱藏
    const selectorCard = document.getElementById('admin-employee-selector-card');
    if (selectorCard) {
        const needSelector = (subTabId === 'employee-mgmt-view' || subTabId === 'employee-settings-view');
        selectorCard.style.display = needSelector ? 'block' : 'none';
    }

    // 6. 根據子頁籤 ID 執行特定動作 (例如：載入資料)
    console.log(`切換到管理員子頁籤: ${ subTabId } `);
    if (subTabId === 'review-requests') {
        fetchAndRenderReviewRequests(); // 載入表單
    } else if (subTabId === 'employee-settings-view') {
        // 切到員工設定 tab：依當前選擇狀態同步顯示
        syncEmployeeSettingsVisibility();
    }
};

/**
 * Phase L0：依目前選擇的員工，同步顯示「員工設定」內容或空狀態
 */
function syncEmployeeSettingsVisibility() {
    const content = document.getElementById('employee-settings-content');
    const empty = document.getElementById('employee-settings-empty');
    if (!content || !empty) return;
    if (adminSelectedUserId) {
        content.style.display = 'block';
        empty.style.display = 'none';
    } else {
        content.style.display = 'none';
        empty.style.display = 'block';
    }
}

/**
 * Phase L0：員工設定 sub-tab 切換（帳號權限 / 打卡政策 / 薪資與勞保）
 */
function setupEmployeeSettingTabs() {
    const tabs = document.querySelectorAll('#employee-settings-content .emp-setting-tab');
    if (!tabs.length) return;
    const panels = document.querySelectorAll('#employee-settings-content .emp-setting-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.panel;
            // 切換 active 狀態
            tabs.forEach(t => {
                t.classList.remove('active');
                t.classList.replace('bg-indigo-600', 'bg-gray-200');
                t.classList.replace('text-white', 'text-gray-600');
            });
            tab.classList.add('active');
            tab.classList.replace('bg-gray-200', 'bg-indigo-600');
            tab.classList.replace('text-gray-600', 'text-white');
            // 切換 panel 顯示
            panels.forEach(p => {
                if (p.dataset.panel === target) {
                    p.removeAttribute('hidden');
                } else {
                    p.setAttribute('hidden', '');
                }
            });
        });
    });
}
// #endregion
// ===================================

// ===================================
// #region 6. 管理員 Excel 匯出（完整打卡紀錄）
// ===================================

function setupAdminExport() {
    const btn = document.getElementById('export-admin-month-excel-btn');
    if (!btn) return;

    const pad = n => String(n).padStart(2, '0');

    btn.addEventListener('click', async () => {
        const selectEl = document.getElementById('admin-select-employee-mgmt');
        const userId = selectEl && selectEl.value
            ? selectEl.value
            : (currentManagingEmployee && currentManagingEmployee.userId);
        if (!userId) {
            alert(t('MSG_PLEASE_SELECT_EMPLOYEE_ALERT'));
            return;
        }

        // 解析目前顯示的月份
        const monthText = (adminCurrentMonthDisplay && adminCurrentMonthDisplay.textContent)
            ? adminCurrentMonthDisplay.textContent.trim()
            : '';
        let year, month;
        const m = monthText.match(/(\d{4}).*?(\d{1,2})/);
        if (m) {
            year = parseInt(m[1], 10);
            month = parseInt(m[2], 10) - 1;
        } else {
            const d = new Date();
            year = d.getFullYear();
            month = d.getMonth();
        }

        const monthParam = `${year}-${pad(month + 1)}`;

        try {
            const response = await callApifetch({
                action: 'getAttendanceDetails',
                month: monthParam,
                userId: userId
            });
            if (!response.ok) {
                alert(t('MSG_FETCH_RECORDS_FAILED'));
                return;
            }

            // 只輸出完整打卡紀錄（薪資與加班分類已於重新設計前移除）
            const completeRecordRows = [
                ['日期', '時間', '打卡類型', '地點', '備註', '審核狀態']
            ];

            const dailyStatus = response.records?.dailyStatus || [];
            dailyStatus.forEach(day => {
                if (!Array.isArray(day.record)) return;
                day.record.forEach(punch => {
                    const dateStr = normalizeDateKey(day.date) || day.date || '';
                    const timeStr = punch.time || '';
                    const punchType = punch.type || '未知';
                    const location = punch.location || '';
                    const recordNote = punch.note || '';
                    const auditStatus = punch.audit === '?' ? '審核中'
                        : (punch.audit === 'v' ? '已批准'
                            : (punch.audit === 'x' ? '已拒絕' : ''));

                    completeRecordRows.push([
                        dateStr,
                        timeStr,
                        punchType,
                        location,
                        recordNote,
                        auditStatus
                    ]);
                });
            });

            try {
                const ws = XLSX.utils.aoa_to_sheet(completeRecordRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, '完整打卡紀錄');
                const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                const blob = new Blob([wbout], { type: 'application/octet-stream' });

                // 檔名用員工姓名（過濾非法字元）
                let employeeName = (currentManagingEmployee && currentManagingEmployee.name) || '';
                if (!employeeName && Array.isArray(allEmployeeList)) {
                    const found = allEmployeeList.find(e => e.userId === userId);
                    if (found) employeeName = found.name || '';
                }
                if (!employeeName) employeeName = userId ? userId.slice(0, 8) : 'unknown';
                employeeName = String(employeeName)
                    .replace(/[\/\\:\*\?"<>\|]/g, '')
                    .replace(/\s+/g, '_');

                const filename = `${employeeName}-${year}-${pad(month + 1)}.xlsx`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Excel 匯出失敗', err);
                alert(t('MSG_EXPORT_FAILED'));
            }
        } catch (err) {
            console.error('取得打卡記錄失敗', err);
            alert(t('MSG_FETCH_RECORDS_RETRY'));
        }
    });
}

function setupTestNotificationButton() {
    const btn = document.getElementById('test-notification-btn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', async () => {
        const loadingText = t('LOADING') || '處理中...';
        generalButtonState(btn, 'processing', loadingText);
        try {
            const res = await callApifetch({ action: 'testNotification' }, 'loadingMsg');
            if (res && res.ok) {
                const adminCount = res.adminCount != null ? res.adminCount : '';
                showNotification(`${res.msg || '測試通知發送成功'}（管理員 ${adminCount} 位）`, 'success');
            } else {
                const code = (res && res.code) || 'UNKNOWN_ERROR';
                showNotification(t(code) || (res && res.msg) || '測試通知發送失敗', 'error');
            }
        } catch (err) {
            console.error('testNotification 失敗', err);
            showNotification(t('NETWORK_ERROR') || '網路錯誤', 'error');
        } finally {
            generalButtonState(btn, 'idle');
        }
    });
}

// 休息時間設定編輯器
/**
 * Phase 6：本月打卡紀錄表格（含篩選與排序）
 *
 * 桌機：HTML table（日期 / 上班 / 下班 / 工時 / 地點 / 狀態），點表頭可切換排序
 * 手機：每筆 card（垂直堆疊欄位）
 * Toolbar：狀態篩選 dropdown + 排序欄位 dropdown + 升降序切換
 *
 * 來源：dailyStatus（與其他卡共用 loadMonthDetailData cache）
 */
async function renderEmployeePunchTable(userId, date) {
    const card = document.getElementById('employee-punch-table-card');
    if (!card) return;
    const titleHtml = `
        <h3 data-i18n="PUNCH_TABLE_TITLE"
            class="text-base font-semibold text-gray-700 dark:text-gray-200 mb-3">
            <i class="fas fa-table mr-2 text-emerald-500"></i>${t('PUNCH_TABLE_TITLE')}
        </h3>`;

    if (!userId) {
        card.innerHTML = titleHtml +
            `<p class="dashboard-placeholder">${t('MSG_PLEASE_SELECT_EMPLOYEE') || '請先選擇員工'}</p>`;
        renderTranslations(card);
        return;
    }

    card.innerHTML = titleHtml + `<p class="dashboard-placeholder">…</p>`;

    const d = date || new Date();
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    let dailyStatus = [];
    try {
        // Phase L3：取 enriched 版本（含 laborStats），cache 與其他 render 共用
        dailyStatus = await loadEnrichedMonthData(month, userId);
    } catch (err) {
        console.error('renderEmployeePunchTable fetch 失敗：', err);
    }

    if (!dailyStatus || dailyStatus.length === 0) {
        card.innerHTML = titleHtml +
            `<p class="dashboard-placeholder">${t('TABLE_NO_DATA') || '本月無打卡紀錄'}</p>`;
        renderTranslations(card);
        return;
    }

    // ===== 篩選/排序 state（card scope，每次 dropdown change 直接重渲染 rows）=====
    // 從 dailyStatus 萃取出現過的 reason 作為 filter options（避免顯示無資料的選項）
    const seenReasons = [...new Set(dailyStatus.map((d) => d.reason).filter(Boolean))];
    let filterReason = 'ALL';
    // Phase L4：sortBy 增加勞基法分段欄位
    let sortBy = 'date';   // 'date' | 'punchInTime' | 'punchOutTime' | 'hours' | 'plainOt' | 'restTotal'
    let sortDir = 'desc';  // 'asc' | 'desc'

    // Phase L4：從 laborStats 取分段加總（給排序用）
    const plainOtOf = (day) => {
        const s = day && day.laborStats;
        return s ? Number(s.ot1 || 0) + Number(s.ot2 || 0) : 0;
    };
    const restTotalOf = (day) => {
        const s = day && day.laborStats;
        return s ? Number(s.rest_ot1 || 0) + Number(s.rest_ot2 || 0) + Number(s.rest_ot3 || 0) : 0;
    };

    // 比較函式：時間/字串字典序、數字比大小、勞基法分段加總
    const cmp = (a, b) => {
        let av, bv;
        if (sortBy === 'hours') {
            av = Number(a.hours || 0); bv = Number(b.hours || 0);
        } else if (sortBy === 'plainOt') {
            av = plainOtOf(a); bv = plainOtOf(b);
        } else if (sortBy === 'restTotal') {
            av = restTotalOf(a); bv = restTotalOf(b);
        } else {
            av = String(a[sortBy] || ''); bv = String(b[sortBy] || '');
        }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
    };
    const applyFilterSort = () => {
        let rows = dailyStatus;
        if (filterReason !== 'ALL') rows = rows.filter((r) => r.reason === filterReason);
        return [...rows].sort(cmp);
    };

    // Phase L4：依日期類型把 laborStats 簡化成可讀字串
    //   workday: 「平日 8 +OT 0.5」
    //   rest:    「休息日 4」
    //   public:  「國定 6」
    //   regular: 「例假 +16」
    const laborBreakdownText = (day) => {
        const s = day && day.laborStats;
        if (!s) return '';
        const fmt = (n) => {
            const v = Number(n || 0);
            return v % 1 === 0 ? String(v) : v.toFixed(1);
        };
        switch (s.kind) {
            case 'workday': {
                const ot = Number(s.ot1 || 0) + Number(s.ot2 || 0);
                const normal = Number(s.normal || 0);
                if (normal === 0 && ot === 0) return '';
                return ot > 0
                    ? `${t('LABOR_NORMAL_HOURS')} ${fmt(normal)} + OT ${fmt(ot)}`
                    : `${t('LABOR_NORMAL_HOURS')} ${fmt(normal)}`;
            }
            case 'rest': {
                const total = Number(s.rest_ot1 || 0) + Number(s.rest_ot2 || 0) + Number(s.rest_ot3 || 0);
                if (total === 0) return '';
                return `${t('DAY_KIND_REST_DAY')} ${fmt(total)}`;
            }
            case 'public': {
                const total = Number(s.public_base || 0) + Number(s.public_ot1 || 0) + Number(s.public_ot2 || 0);
                if (total === 0) return '';
                return `${t('DAY_KIND_PUBLIC_HOLIDAY')} ${fmt(total)}`;
            }
            case 'regular': {
                const total = Number(s.regular_base || 0) + Number(s.regular_comp || 0) + Number(s.regular_ot || 0);
                if (total === 0) return '';
                return `${t('DAY_KIND_REGULAR_LEAVE')} +${fmt(total)}`;
            }
            default:
                return '';
        }
    };

    // 每筆萃取地點：去重 record.location，取非空
    const locationOf = (day) => {
        const set = new Set();
        (day.record || []).forEach((r) => {
            const loc = (r.location || '').trim();
            if (loc) set.add(loc);
        });
        const arr = [...set];
        if (arr.length === 0) return '–';
        if (arr.length === 1) return arr[0];
        return `${arr[0]} (+${arr.length - 1})`;
    };

    const reasonBadge = (reason) => {
        if (!reason) return '–';
        // 使用既有 STATUS_* i18n keys
        const cls = (() => {
            switch (reason) {
                case 'STATUS_PUNCH_NORMAL':
                case 'STATUS_LEAVE_APPROVED':
                case 'STATUS_VACATION_APPROVED':
                case 'STATUS_REPAIR_APPROVED':
                    return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200';
                case 'STATUS_LEAVE_PENDING':
                case 'STATUS_VACATION_PENDING':
                case 'STATUS_REPAIR_PENDING':
                    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200';
                case 'STATUS_BOTH_MISSING':
                case 'STATUS_PUNCH_IN_MISSING':
                case 'STATUS_PUNCH_OUT_MISSING':
                    return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200';
                default:
                    return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
            }
        })();
        return `<span data-i18n="${reason}" class="text-xs font-semibold px-2 py-0.5 rounded ${cls}">${t(reason) || reason}</span>`;
    };

    // ===== Toolbar HTML =====
    const filterOptions = `<option value="ALL" data-i18n="TABLE_FILTER_ALL">${t('TABLE_FILTER_ALL')}</option>` +
        seenReasons.map((reason) => `<option value="${reason}" data-i18n="${reason}">${t(reason) || reason}</option>`).join('');

    const sortFields = [
        { val: 'date', i18n: 'TABLE_HEADER_DATE' },
        { val: 'punchInTime', i18n: 'TABLE_HEADER_PUNCH_IN' },
        { val: 'punchOutTime', i18n: 'TABLE_HEADER_PUNCH_OUT' },
        { val: 'hours', i18n: 'TABLE_HEADER_HOURS' },
        // Phase L4：依勞基法分段加總排序
        { val: 'plainOt', i18n: 'TABLE_SORT_PLAIN_OT' },
        { val: 'restTotal', i18n: 'TABLE_SORT_REST_TOTAL' },
    ];
    const sortFieldOptions = sortFields.map((s) =>
        `<option value="${s.val}" data-i18n="${s.i18n}">${t(s.i18n)}</option>`
    ).join('');

    const inputCls = 'p-2 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
    const toolbarHtml = `
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:0.75rem;">
            <div style="flex:1 1 160px;min-width:140px;">
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1" data-i18n="TABLE_FILTER_LABEL">${t('TABLE_FILTER_LABEL')}</label>
                <select id="emp-punch-filter" class="${inputCls}" style="width:100%;">${filterOptions}</select>
            </div>
            <div style="flex:1 1 140px;min-width:120px;">
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1" data-i18n="TABLE_SORT_LABEL">${t('TABLE_SORT_LABEL')}</label>
                <select id="emp-punch-sort-by" class="${inputCls}" style="width:100%;">${sortFieldOptions}</select>
            </div>
            <div style="flex:0 0 auto;">
                <button id="emp-punch-sort-dir" type="button"
                    class="${inputCls}"
                    style="cursor:pointer;font-weight:600;min-width:60px;"
                    title="${t('TABLE_SORT_DESC')}">↓</button>
            </div>
        </div>`;

    // 表頭可點切換排序：點擊欄位設定 sortBy；同欄再點切換方向
    const headerHtml = (i18n, field) => {
        const arrow = (sortBy === field) ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
        const clickable = field !== '_';
        return `<th data-sort="${field}" class="py-2 px-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300"
            style="${clickable ? 'cursor:pointer;user-select:none;' : ''}">
            <span data-i18n="${i18n}">${t(i18n)}</span>${arrow}
        </th>`;
    };

    function rerenderTableBodies(rows) {
        const tableRowsHtml = rows.map((day) => {
            const breakdown = laborBreakdownText(day);
            const breakdownHtml = breakdown
                ? `<div style="font-size:0.7rem;margin-top:2px;color:#6b7280;">${breakdown}</div>`
                : '';
            return `
            <tr class="border-b border-gray-200 dark:border-gray-700">
                <td class="py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-200">${day.date || ''}</td>
                <td class="py-2 px-3 text-sm text-gray-600 dark:text-gray-300">${day.punchInTime || '–'}</td>
                <td class="py-2 px-3 text-sm text-gray-600 dark:text-gray-300">${day.punchOutTime || '–'}</td>
                <td class="py-2 px-3 text-sm text-gray-600 dark:text-gray-300">
                    <div>${Number(day.hours || 0).toFixed(1)}</div>
                    ${breakdownHtml}
                </td>
                <td class="py-2 px-3 text-sm text-gray-600 dark:text-gray-300">${locationOf(day)}</td>
                <td class="py-2 px-3">${reasonBadge(day.reason)}</td>
            </tr>`;
        }).join('');
        const cardRowsHtml = rows.map((day) => {
            const breakdown = laborBreakdownText(day);
            const breakdownLine = breakdown
                ? `<div style="font-size:0.7rem;margin-top:6px;color:#6b7280;">
                    <i class="fas fa-balance-scale mr-1"></i>${breakdown}
                   </div>`
                : '';
            return `
            <li class="emp-punch-card-row p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">${day.date || ''}</span>
                    ${reasonBadge(day.reason)}
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:0.75rem;" class="text-gray-500 dark:text-gray-400">
                    <div><span data-i18n="TABLE_HEADER_PUNCH_IN">${t('TABLE_HEADER_PUNCH_IN')}</span><br><span class="text-gray-800 dark:text-gray-100" style="font-weight:600;">${day.punchInTime || '–'}</span></div>
                    <div><span data-i18n="TABLE_HEADER_PUNCH_OUT">${t('TABLE_HEADER_PUNCH_OUT')}</span><br><span class="text-gray-800 dark:text-gray-100" style="font-weight:600;">${day.punchOutTime || '–'}</span></div>
                    <div><span data-i18n="TABLE_HEADER_HOURS">${t('TABLE_HEADER_HOURS')}</span><br><span class="text-gray-800 dark:text-gray-100" style="font-weight:600;">${Number(day.hours || 0).toFixed(1)}</span></div>
                </div>
                ${breakdownLine}
                <div style="font-size:0.75rem;margin-top:6px;" class="text-gray-500 dark:text-gray-400">
                    <span data-i18n="TABLE_HEADER_LOCATION">${t('TABLE_HEADER_LOCATION')}</span>：<span class="text-gray-800 dark:text-gray-100">${locationOf(day)}</span>
                </div>
            </li>`;
        }).join('');
        const tbody = card.querySelector('table tbody');
        const cardList = card.querySelector('.emp-punch-card-list');
        if (tbody) tbody.innerHTML = tableRowsHtml;
        if (cardList) cardList.innerHTML = cardRowsHtml;
        // table 內的 badge 仍含 data-i18n，確保切語言時有效
        renderTranslations(tbody);
        renderTranslations(cardList);
    }

    function rerenderHeaders() {
        const thead = card.querySelector('table thead');
        if (!thead) return;
        thead.innerHTML = `<tr style="background:rgba(99,102,241,0.06);">
            ${headerHtml('TABLE_HEADER_DATE', 'date')}
            ${headerHtml('TABLE_HEADER_PUNCH_IN', 'punchInTime')}
            ${headerHtml('TABLE_HEADER_PUNCH_OUT', 'punchOutTime')}
            ${headerHtml('TABLE_HEADER_HOURS', 'hours')}
            ${headerHtml('TABLE_HEADER_LOCATION', '_')}
            ${headerHtml('TABLE_HEADER_STATUS', '_')}
        </tr>`;
        thead.querySelectorAll('th[data-sort]').forEach((th) => {
            const field = th.dataset.sort;
            if (field === '_') return;
            th.addEventListener('click', () => {
                if (sortBy === field) sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
                else { sortBy = field; sortDir = (field === 'date' ? 'desc' : 'asc'); }
                syncToolbarFromState();
                rerenderHeaders();
                rerenderTableBodies(applyFilterSort());
            });
        });
    }

    function syncToolbarFromState() {
        const sortBySel = card.querySelector('#emp-punch-sort-by');
        const sortDirBtn = card.querySelector('#emp-punch-sort-dir');
        if (sortBySel) sortBySel.value = sortBy;
        if (sortDirBtn) {
            sortDirBtn.textContent = sortDir === 'asc' ? '↑' : '↓';
            sortDirBtn.title = sortDir === 'asc' ? (t('TABLE_SORT_ASC') || 'Asc') : (t('TABLE_SORT_DESC') || 'Desc');
        }
    }

    card.innerHTML = titleHtml + toolbarHtml + `
        <!-- 桌機 table -->
        <div class="emp-punch-table-wrap" style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
                <thead></thead>
                <tbody></tbody>
            </table>
        </div>
        <!-- 手機 card 列表 -->
        <ul class="emp-punch-card-list" style="display:none;list-style:none;padding:0;margin:0;"></ul>`;
    rerenderHeaders();
    rerenderTableBodies(applyFilterSort());
    renderTranslations(card);

    // toolbar 事件綁定
    const filterSel = card.querySelector('#emp-punch-filter');
    const sortBySel = card.querySelector('#emp-punch-sort-by');
    const sortDirBtn = card.querySelector('#emp-punch-sort-dir');
    if (filterSel) {
        filterSel.addEventListener('change', () => {
            filterReason = filterSel.value;
            rerenderTableBodies(applyFilterSort());
        });
    }
    if (sortBySel) {
        sortBySel.addEventListener('change', () => {
            sortBy = sortBySel.value;
            rerenderHeaders();
            rerenderTableBodies(applyFilterSort());
        });
    }
    if (sortDirBtn) {
        sortDirBtn.addEventListener('click', () => {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            syncToolbarFromState();
            rerenderHeaders();
            rerenderTableBodies(applyFilterSort());
        });
    }
}

/**
 * Phase 5：連續上工天數 + 請假/休假統計（純前端從 dailyStatus 推導）
 *
 * 連續上工：從今天反向掃描，連續 STATUS_PUNCH_NORMAL 的天數
 *   中斷規則：
 *   - PUNCH_NORMAL                    → +1
 *   - LEAVE/VACATION_APPROVED         → skip 不算也不中斷
 *   - 國定假日 / 例假日 (週日)         → skip
 *   - 其他狀態（缺打卡/異常/未來日）    → 中斷
 *
 * 請假統計：scan dailyStatus，找出 reason='STATUS_LEAVE_APPROVED' /
 *   'STATUS_VACATION_APPROVED' 的日子，從 record 裡 adjustmentType=
 *   '系統請假記錄' 的 location 欄位取請假類別（年假/病假/事假/...），
 *   按類別計天數。
 *
 * @param {string|null} userId
 * @param {Date}        date
 */
async function renderEmployeeStreakAndLeaveStats(userId, date) {
    const streakCard = document.getElementById('employee-streak-card');
    const leaveCard = document.getElementById('employee-leave-stats-card');
    if (!streakCard || !leaveCard) return;

    const titleStreak = `<h3 data-i18n="CONSECUTIVE_WORKDAYS_TITLE"
        class="text-base font-semibold text-gray-700 dark:text-gray-200 mb-2">
        <i class="fas fa-fire mr-2 text-orange-500"></i>${t('CONSECUTIVE_WORKDAYS_TITLE')}</h3>`;
    const titleLeave = `<h3 data-i18n="LEAVE_STATS_TITLE"
        class="text-base font-semibold text-gray-700 dark:text-gray-200 mb-2">
        <i class="fas fa-umbrella-beach mr-2 text-cyan-500"></i>${t('LEAVE_STATS_TITLE')}</h3>`;

    if (!userId) {
        streakCard.innerHTML = titleStreak +
            `<p class="dashboard-placeholder">${t('MSG_PLEASE_SELECT_EMPLOYEE') || '請先選擇員工'}</p>`;
        leaveCard.innerHTML = titleLeave +
            `<p class="dashboard-placeholder">${t('MSG_PLEASE_SELECT_EMPLOYEE') || '請先選擇員工'}</p>`;
        renderTranslations(streakCard);
        renderTranslations(leaveCard);
        return;
    }

    // 載入中
    streakCard.innerHTML = titleStreak + `<p class="dashboard-placeholder">…</p>`;
    leaveCard.innerHTML = titleLeave + `<p class="dashboard-placeholder">…</p>`;

    const d = date || new Date();
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    let dailyStatus = [];
    try {
        // Phase L3：取 enriched 版本，cache 與其他 render 共用
        dailyStatus = await loadEnrichedMonthData(month, userId);
    } catch (err) {
        console.error('renderEmployeeStreakAndLeaveStats fetch 失敗：', err);
    }

    // ===== 連續上工：從「昨天」往前掃 =====
    // 規則：當天有「上班」或「下班」其一打卡即算 +1；
    // 完全沒打卡（含請假/休假/國定假日）→ 中斷
    // 起點為昨天：今天還沒過完，無從判斷
    const byDate = {};
    (dailyStatus || []).forEach((day) => { if (day.date) byDate[day.date] = day; });
    const fmtKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const today = new Date();
    let streak = 0;
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    for (let i = 0; i < 60; i++) {
        const key = fmtKey(cursor);
        const day = byDate[key];
        if (day && (day.punchInTime || day.punchOutTime)) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        } else {
            break;
        }
    }

    // 連續上工：大數字置中顯示
    streakCard.innerHTML = titleStreak + `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem 0;">
            <div style="font-size:4rem;font-weight:800;line-height:1;color:#ea580c;">${streak}</div>
            <div data-i18n="CONSECUTIVE_DAYS_UNIT" style="font-size:0.95rem;color:#6b7280;margin-top:0.5rem;">${t('CONSECUTIVE_DAYS_UNIT') || '天'}</div>
        </div>`;
    renderTranslations(streakCard);

    // ===== 請假/休假統計：請假與休假分開計 =====
    // attendance.type 是中文「請假」/「休假」（submitLeave 寫入）
    // 請假組：員工提出的「不可預期/個人事務」(病假/事假/其他)
    // 休假組：使用「年假/特休/補休」等假別（休息日）
    const leaveStats = {};
    const vacationStats = {};
    (dailyStatus || []).forEach((day) => {
        if (day.reason !== 'STATUS_LEAVE_APPROVED' && day.reason !== 'STATUS_VACATION_APPROVED') return;
        const leaveRec = (day.record || []).find((r) => r.adjustmentType === '系統請假記錄');
        if (!leaveRec) return;
        const category = leaveRec.location || (t('VALUE_NA') || '其他');
        if (leaveRec.type === '休假') {
            vacationStats[category] = (vacationStats[category] || 0) + 1;
        } else {
            // 預設視為請假（含 type 為空或 '請假'）
            leaveStats[category] = (leaveStats[category] || 0) + 1;
        }
    });

    const leaveEntries = Object.entries(leaveStats).sort((a, b) => b[1] - a[1]);
    const vacationEntries = Object.entries(vacationStats).sort((a, b) => b[1] - a[1]);

    // ===== 異常統計：scan 月初 ~ 昨天 =====
    // 完全沒記錄 → 算「未打卡」(STATUS_BOTH_MISSING)
    // 有部分記錄但缺上/下班 → 各別算
    const abnormalStats = { both: 0, in: 0, out: 0 };
    const monthFirst = new Date(d.getFullYear(), d.getMonth(), 1);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    // 只 scan 該月內 + 不超過昨天的日子
    const monthEndExclusive = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const scanEnd = yesterday < monthEndExclusive ? yesterday : new Date(monthEndExclusive.getTime() - 86400000);
    for (let scan = new Date(monthFirst); scan <= scanEnd; scan.setDate(scan.getDate() + 1)) {
        const key = fmtKey(scan);
        const day = byDate[key];
        if (!day) {
            abnormalStats.both += 1;
        } else if (day.reason === 'STATUS_BOTH_MISSING') {
            abnormalStats.both += 1;
        } else if (day.reason === 'STATUS_PUNCH_IN_MISSING') {
            abnormalStats.in += 1;
        } else if (day.reason === 'STATUS_PUNCH_OUT_MISSING') {
            abnormalStats.out += 1;
        }
    }
    const abnormalEntries = [
        ['ABNORMAL_BOTH_MISSING', abnormalStats.both],
        ['ABNORMAL_IN_MISSING', abnormalStats.in],
        ['ABNORMAL_OUT_MISSING', abnormalStats.out],
    ].filter(([, n]) => n > 0);
    // 異常總數，0 也要顯示讓管理員確認
    const abnormalTotal = abnormalStats.both + abnormalStats.in + abnormalStats.out;

    if (leaveEntries.length === 0 && vacationEntries.length === 0 && abnormalTotal === 0) {
        leaveCard.innerHTML = titleLeave +
            `<p class="dashboard-placeholder">${t('LEAVE_NO_RECORDS') || '本月無紀錄'}</p>`;
        renderTranslations(leaveCard);
        return;
    }

    const unit = t('CONSECUTIVE_DAYS_UNIT') || '天';
    const sectionHtml = (groupKey, color, entries, useI18nKeyAsLabel = false) => {
        if (entries.length === 0) return '';
        const total = entries.reduce((s, [, n]) => s + n, 0);
        const itemsHtml = entries.map(([cat, days]) => {
            const label = useI18nKeyAsLabel
                ? `<span data-i18n="${cat}" style="color:#4b5563;">${t(cat)}</span>`
                : `<span style="color:#4b5563;">${cat}</span>`;
            return `
            <li style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(156,163,175,0.18);font-size:0.875rem;">
                ${label}
                <span style="font-weight:700;color:${color};">${days} ${unit}</span>
            </li>`;
        }).join('');
        return `
            <div style="margin-top:0.75rem;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
                    <span data-i18n="${groupKey}" style="font-size:0.8rem;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${t(groupKey)}</span>
                    <span style="font-size:0.75rem;color:#9ca3af;">${total} ${unit}</span>
                </div>
                <ul style="margin:0;padding:0;list-style:none;">${itemsHtml}</ul>
            </div>`;
    };

    // 異常組永遠顯示：即使 0 天也讓管理員看到本月「無異常」
    const abnormalSectionHtml = (() => {
        const color = '#a855f7';
        if (abnormalEntries.length === 0) {
            const unitTxt = t('CONSECUTIVE_DAYS_UNIT') || '天';
            return `
            <div style="margin-top:0.75rem;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
                    <span data-i18n="ABNORMAL_GROUP" style="font-size:0.8rem;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${t('ABNORMAL_GROUP')}</span>
                    <span style="font-size:0.75rem;color:#9ca3af;">0 ${unitTxt}</span>
                </div>
            </div>`;
        }
        return sectionHtml('ABNORMAL_GROUP', color, abnormalEntries, true);
    })();

    leaveCard.innerHTML = titleLeave +
        sectionHtml('LEAVE_GROUP_LEAVE', '#dc2626', leaveEntries) +
        sectionHtml('LEAVE_GROUP_VACATION', '#0891b2', vacationEntries) +
        abnormalSectionHtml;
    renderTranslations(leaveCard);
}

/**
 * Phase 4：員工申請紀錄整合（待審核 / 已批准 / 已拒絕 三 tab）
 *
 * 從擴充後的 getReviewRequest（接 userId + audit 參數）拉資料，
 * 渲染到員工 dashboard 的「申請紀錄」卡，待審核項目可直接 approve/reject。
 *
 * @param {string|null} userId       選中的員工 ID；null 重設為 placeholder
 * @param {string}      audit        '?' | 'v' | 'x'，預設 '?' (待審核)
 */
async function renderEmployeeRequestHistory(userId, audit = '?') {
    const card = document.getElementById('employee-request-history-card');
    if (!card) return;

    const titleHtml = `
        <h3 data-i18n="REQUEST_HISTORY_TITLE"
            class="text-base font-semibold text-gray-700 dark:text-gray-200 mb-3">
            <i class="fas fa-clipboard-list mr-2 text-indigo-500"></i>${t('REQUEST_HISTORY_TITLE')}
        </h3>`;

    if (!userId) {
        card.innerHTML = titleHtml +
            `<p class="dashboard-placeholder">${t('MSG_PLEASE_SELECT_EMPLOYEE') || '請先選擇員工'}</p>`;
        renderTranslations(card);
        return;
    }

    const tabs = [
        { audit: '?', i18n: 'REQUEST_TAB_PENDING' },
        { audit: 'v', i18n: 'REQUEST_TAB_APPROVED' },
        { audit: 'x', i18n: 'REQUEST_TAB_REJECTED' },
    ];
    const tabsHtml = tabs.map((tabItem) => {
        const active = tabItem.audit === audit;
        return `<button type="button" data-audit="${tabItem.audit}"
            class="emp-req-tab${active ? ' active' : ''}">
            <span data-i18n="${tabItem.i18n}">${t(tabItem.i18n)}</span>
        </button>`;
    }).join('');

    card.innerHTML = titleHtml +
        `<div class="flex flex-wrap gap-2 mb-3">${tabsHtml}</div>` +
        `<div id="employee-request-body" class="dashboard-placeholder">…</div>`;

    // tab 切換
    card.querySelectorAll('.emp-req-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            renderEmployeeRequestHistory(userId, btn.dataset.audit);
        });
    });
    renderTranslations(card);

    // 取資料
    let res;
    try {
        res = await callApifetch({ action: 'getReviewRequest', userId, audit });
    } catch (err) {
        console.error('renderEmployeeRequestHistory fetch 失敗：', err);
    }

    const body = card.querySelector('#employee-request-body');
    if (!body) return;
    if (!res || !res.ok) {
        body.textContent = t('MSG_FETCH_REVIEW_NETWORK_ERROR') || '載入失敗';
        return;
    }
    const items = res.reviewRequest || [];
    if (items.length === 0) {
        body.innerHTML = `<p class="dashboard-placeholder">${t('VALUE_NA') || '無資料'}</p>`;
        return;
    }

    // 顯示 list（每筆：類型 badge + 狀態 badge + 時間 + 動作）
    const STATUS_BADGE = {
        '?': { i18n: 'REQUEST_TAB_PENDING', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200' },
        'v': { i18n: 'REQUEST_TAB_APPROVED', cls: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200' },
        'x': { i18n: 'REQUEST_TAB_REJECTED', cls: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200' },
    };

    const itemsHtml = items.map((req) => {
        const isLeave = req.remark && req.remark !== '補打卡';
        const labelTimeKey = isLeave ? 'LABEL_LEAVE_VACATION_TIME' : 'LABEL_REPAIR_TIME';
        const typeBadgeKey = isLeave ? 'BADGE_LEAVE_VACATION' : 'BADGE_REPAIR';
        const typeBadgeCls = isLeave
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200';
        const statusBadge = STATUS_BADGE[req.audit] || STATUS_BADGE['?'];
        const showActions = req.audit === '?';
        const remarkLine = (isLeave && req.remark)
            ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${req.remark}</p>`
            : '';
        return `
        <li class="p-3 bg-gray-50 dark:bg-gray-700 rounded-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div class="flex-grow min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                    <span data-i18n="${typeBadgeKey}" class="text-xs font-semibold px-2 py-0.5 rounded ${typeBadgeCls}">${t(typeBadgeKey)}</span>
                    <span class="text-xs font-medium text-gray-600 dark:text-gray-300">${req.type || ''}</span>
                    <span data-i18n="${statusBadge.i18n}" class="text-xs font-semibold px-2 py-0.5 rounded ${statusBadge.cls}">${t(statusBadge.i18n)}</span>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span data-i18n="${labelTimeKey}">${t(labelTimeKey)}</span>：${req.targetTime || ''}
                    <span class="mx-1">·</span>
                    <span data-i18n="LABEL_APPLICATION_TIME">${t('LABEL_APPLICATION_TIME')}</span>：${req.applicationTime || ''}
                </p>
                ${remarkLine}
            </div>
            ${showActions ? `
            <div class="flex gap-2 shrink-0">
                <button type="button" data-action="approve" data-id="${req.id}"
                    class="emp-req-act px-3 py-1 rounded text-xs font-bold btn-primary"
                    data-i18n="ADMIN_APPROVE_BUTTON">${t('ADMIN_APPROVE_BUTTON') || '核准'}</button>
                <button type="button" data-action="reject" data-id="${req.id}"
                    class="emp-req-act px-3 py-1 rounded text-xs font-bold btn-warning"
                    data-i18n="ADMIN_REJECT_BUTTON">${t('ADMIN_REJECT_BUTTON') || '拒絕'}</button>
            </div>` : ''}
        </li>`;
    }).join('');

    body.outerHTML = `<ul id="employee-request-body" class="space-y-2">${itemsHtml}</ul>`;
    const newBody = card.querySelector('#employee-request-body');
    if (newBody) renderTranslations(newBody);

    // 綁 approve/reject
    card.querySelectorAll('.emp-req-act').forEach((btn) => {
        btn.addEventListener('click', () => handleEmployeeRequestAction(btn, userId, audit));
    });
}

async function handleEmployeeRequestAction(button, userId, currentAudit) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (!id || !action) return;

    const isAdmin = await verifyAdminPermission();
    if (!isAdmin) {
        showNotification(t('ERR_NO_PERMISSION') || '您沒有管理員權限', 'error');
        return;
    }

    const actionText = t(action === 'approve' ? 'ACTION_APPROVE' : 'ACTION_REJECT');
    const confirmMsg = t('CONFIRM_REVIEW_ACTION', { action: actionText });
    const confirmed = await showConfirmDialog(confirmMsg);
    if (!confirmed) return;

    const loadingText = t('LOADING') || '處理中...';
    generalButtonState(button, 'processing', loadingText);
    try {
        const endpoint = action === 'approve' ? 'approveReview' : 'rejectReview';
        const res = await callApifetch({ action: endpoint, id });
        if (res && res.ok) {
            const key = action === 'approve' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED';
            showNotification(t(key) || (action === 'approve' ? '已批准' : '已拒絕'), 'success');
            await renderEmployeeRequestHistory(userId, currentAudit);
        } else {
            showNotification(t('REVIEW_FAILED', { msg: (res && res.msg) || '' }) || '審核失敗', 'error');
        }
    } catch (err) {
        showNotification(t('REVIEW_NETWORK_ERROR') || '網路錯誤', 'error');
        console.error(err);
    } finally {
        generalButtonState(button, 'idle');
    }
}

/**
 * Phase 3：員工本月 KPI（總工時 / 正常 / 加班 / 請假天數）
 *
 * 從 loadMonthDetailData 拿 dailyStatus 算 4 個數字並寫入 #kpi-* span。
 * 標準工時 8 小時/天（與 weekly-chart 一致）。
 *
 * @param {string|null} userId  選中的員工 ID；null 重設 KPI 為 --
 * @param {Date}        date    決定月份（year/month）
 */
async function renderEmployeeKpi(userId, date) {
    const STANDARD = 8;
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    if (!userId) {
        ['kpi-total-hours', 'kpi-normal-hours', 'kpi-overtime-hours', 'kpi-leave-days']
            .forEach((id) => setVal(id, '--'));
        return;
    }

    const d = date || new Date();
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    // 重設為 loading 狀態
    ['kpi-total-hours', 'kpi-normal-hours', 'kpi-overtime-hours', 'kpi-leave-days']
        .forEach((id) => setVal(id, '…'));

    let dailyStatus = [];
    try {
        // Phase L3：取 enriched 版本，cache 與其他 render 共用（KPI 仍用原 day.hours，
        // 勞基法分段 KPI 在 Phase L5 才會用到 day.laborStats）
        dailyStatus = await loadEnrichedMonthData(month, userId);
    } catch (err) {
        console.error('renderEmployeeKpi loadEnrichedMonthData 失敗：', err);
    }

    let total = 0, normal = 0, overtime = 0, leaveDays = 0;
    for (const day of (dailyStatus || [])) {
        const h = Number(day.hours || 0);
        total += h;
        normal += Math.min(h, STANDARD);
        overtime += Math.max(0, h - STANDARD);
        if (day.reason === 'STATUS_LEAVE_APPROVED' || day.reason === 'STATUS_VACATION_APPROVED') {
            leaveDays += 1;
        }
    }

    setVal('kpi-total-hours', total.toFixed(1));
    setVal('kpi-normal-hours', normal.toFixed(1));
    setVal('kpi-overtime-hours', overtime.toFixed(1));
    setVal('kpi-leave-days', String(leaveDays));
}

// ===================================
// #region Phase L2：公司休息時段 cache（給 labor-hours / dashboard 共用）
// ===================================

/**
 * 公司休息時段 cache（module-level，全部管理員 dashboard 共用）。
 * 與 setupBreakTimesEditor 的編輯區同步：editor 儲存成功後 invalidate。
 */
let _breakTimesCache = null;          // null = 尚未載入；Array = 已載入結果
let _breakTimesLoadingPromise = null; // 正在 fetch 的 Promise，併發去重用

/**
 * 載入公司休息時段（預設 cache，多次呼叫只 fetch 一次）。
 * @param {boolean} force  傳 true 強制重抓（編輯後用）
 * @returns {Promise<Array<{name,start,end}>>}
 */
async function loadBreakTimes(force = false) {
    if (!force && Array.isArray(_breakTimesCache)) return _breakTimesCache;
    if (_breakTimesLoadingPromise) return _breakTimesLoadingPromise;
    _breakTimesLoadingPromise = (async () => {
        try {
            const res = await callApifetch({ action: 'getBreakTimes' });
            if (res && res.ok && Array.isArray(res.breaks)) {
                _breakTimesCache = res.breaks;
            } else {
                _breakTimesCache = [];
                console.warn('loadBreakTimes：API 回傳異常，使用空陣列', res);
            }
        } catch (err) {
            console.error('loadBreakTimes 失敗', err);
            _breakTimesCache = [];
        } finally {
            _breakTimesLoadingPromise = null;
        }
        return _breakTimesCache;
    })();
    return _breakTimesLoadingPromise;
}

/**
 * 同步取得 cache（未載入回空陣列）。給 render function 使用。
 */
function getCachedBreakTimes() {
    return Array.isArray(_breakTimesCache) ? _breakTimesCache : [];
}

/**
 * 編輯休息時段成功時呼叫，使下次取得自動重 fetch。
 */
function invalidateBreakTimesCache() {
    _breakTimesCache = null;
    _breakTimesLoadingPromise = null;
}

if (typeof window !== 'undefined') {
    window.loadBreakTimes = loadBreakTimes;
    window.getCachedBreakTimes = getCachedBreakTimes;
    window.invalidateBreakTimesCache = invalidateBreakTimesCache;
}

// #endregion
// ===================================

// ===================================
// #region Phase L3：月度 enriched dailyStatus cache（補上勞基法分段工時）
// ===================================

/**
 * 月度 enriched dailyStatus cache。
 * key 格式：`${userId}-${monthKey}` (monthKey = 'YYYY-MM')
 * value：Array<{ ...rawDay, laborStats }>
 *
 * 每月一個鍵；切月時 key 不同會自動重算。
 * 編輯休息時段時應呼叫 invalidateEnrichedMonthCache() 清空。
 */
const _enrichedMonthCache = {};

function _enrichedCacheKey(userId, monthKey) {
    return `${userId}-${monthKey}`;
}

/**
 * 取得指定月份 enriched dailyStatus（每筆已加 laborStats 分段工時）。
 *
 * - 自動 ensure breakTimes cache 已載入
 * - 結果 cache 在 module-level；同月份重複呼叫不重新 enrich
 * - 若 enrichDayWithLaborStats 未載入會 fallback 回 raw（不阻塞）
 *
 * @param {string} monthKey 'YYYY-MM'
 * @param {string} userId
 * @returns {Promise<Array>} enriched days；若取不到資料回空陣列
 */
async function loadEnrichedMonthData(monthKey, userId) {
    if (!monthKey || !userId) return [];
    const ck = _enrichedCacheKey(userId, monthKey);
    if (Array.isArray(_enrichedMonthCache[ck])) return _enrichedMonthCache[ck];

    const [rawDays, breakTimes] = await Promise.all([
        loadMonthDetailData(monthKey, userId),
        loadBreakTimes(),
    ]);

    if (typeof window.enrichDayWithLaborStats !== 'function') {
        console.warn('enrichDayWithLaborStats 未載入，回傳 raw dailyStatus');
        return rawDays || [];
    }

    const enriched = (rawDays || []).map((d) => window.enrichDayWithLaborStats(d, breakTimes));
    _enrichedMonthCache[ck] = enriched;
    return enriched;
}

/**
 * Invalidate enriched cache。
 *   - (userId, monthKey)：清單一月份
 *   - (userId)：清該員工所有月份
 *   - 無參數：清全部
 */
function invalidateEnrichedMonthCache(userId, monthKey) {
    if (userId && monthKey) {
        delete _enrichedMonthCache[_enrichedCacheKey(userId, monthKey)];
        return;
    }
    if (userId) {
        const prefix = `${userId}-`;
        Object.keys(_enrichedMonthCache).forEach((k) => {
            if (k.startsWith(prefix)) delete _enrichedMonthCache[k];
        });
        return;
    }
    Object.keys(_enrichedMonthCache).forEach((k) => delete _enrichedMonthCache[k]);
}

if (typeof window !== 'undefined') {
    window.loadEnrichedMonthData = loadEnrichedMonthData;
    window.invalidateEnrichedMonthCache = invalidateEnrichedMonthCache;
}

// #endregion
// ===================================

function setupBreakTimesEditor() {
    const listEl = document.getElementById('break-times-list');
    const addBtn = document.getElementById('break-times-add-btn');
    const saveBtn = document.getElementById('break-times-save-btn');
    if (!listEl || !addBtn || !saveBtn || listEl.dataset.bound === '1') return;
    listEl.dataset.bound = '1';

    function rowHtml(b) {
        const name = (b && b.name) || '';
        const start = (b && b.start) || '';
        const end = (b && b.end) || '';
        const nameLabel = t('BREAK_NAME_LABEL') || '休息名稱';
        const startLabel = t('BREAK_START_LABEL') || '開始時間';
        const endLabel = t('BREAK_END_LABEL') || '結束時間';
        const removeLabel = t('BTN_REMOVE_BREAK') || '移除';
        const inputCls = 'p-2 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
        // 兩列：第一列 = 休息名稱（填滿）+ 移除按鈕
        // 第二列 = 開始時間 + 結束時間（左右並列）
        return `
            <div class="break-row p-3 rounded-md bg-gray-50 dark:bg-gray-700"
                 style="display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;gap:8px;align-items:flex-end;">
                    <div style="flex:1 1 auto;min-width:0;">
                        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${nameLabel}</label>
                        <input type="text" class="break-name ${inputCls}" style="width:100%;box-sizing:border-box;" value="${String(name).replace(/"/g, '&quot;')}" />
                    </div>
                    <div style="flex:0 0 auto;">
                        <button type="button" class="break-remove-btn text-sm font-semibold rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900"
                                style="padding:8px 10px;" title="${removeLabel}">✕</button>
                    </div>
                </div>
                <div style="display:flex;gap:8px;">
                    <div style="flex:1 1 0;min-width:0;">
                        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${startLabel}</label>
                        <input type="time" class="break-start ${inputCls}" style="width:100%;box-sizing:border-box;" value="${start}" />
                    </div>
                    <div style="flex:1 1 0;min-width:0;">
                        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${endLabel}</label>
                        <input type="time" class="break-end ${inputCls}" style="width:100%;box-sizing:border-box;" value="${end}" />
                    </div>
                </div>
            </div>`;
    }

    function render(breaks) {
        const safeHtml = (breaks || []).map(rowHtml).join('');
        listEl.innerHTML = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(safeHtml) : safeHtml;
    }

    function collect() {
        return [...listEl.querySelectorAll('.break-row')].map((row) => ({
            name: (row.querySelector('.break-name')?.value || '').trim(),
            start: (row.querySelector('.break-start')?.value || '').trim(),
            end: (row.querySelector('.break-end')?.value || '').trim(),
        }));
    }

    listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.break-remove-btn');
        if (!btn) return;
        const row = btn.closest('.break-row');
        if (row) row.remove();
    });

    addBtn.addEventListener('click', () => {
        const current = collect();
        current.push({ name: '', start: '12:00', end: '13:00' });
        render(current);
    });

    saveBtn.addEventListener('click', async () => {
        const breaks = collect();
        const loadingText = t('LOADING') || '處理中...';
        generalButtonState(saveBtn, 'processing', loadingText);
        try {
            const res = await callApifetch({ action: 'setBreakTimes', breaks }, 'loadingMsg');
            if (res && res.ok) {
                showNotification(t('MSG_BREAK_TIMES_SAVED'), 'success');
                if (Array.isArray(res.breaks)) render(res.breaks);
                // Phase L2：儲存後 invalidate module-level cache，下次 dashboard 取會重抓
                invalidateBreakTimesCache();
                // Phase L3：休息時段改變 → enriched 結果失效，全部清空
                invalidateEnrichedMonthCache();
                loadBreakTimes(true).catch(() => { /* 已記錄 */ });
            } else {
                const code = (res && res.code) || 'UNKNOWN_ERROR';
                const msg = t(code) || (res && res.msg) || '';
                showNotification(t('MSG_BREAK_TIMES_SAVE_FAILED', { msg }), 'error');
            }
        } catch (err) {
            console.error('setBreakTimes 失敗', err);
            showNotification(t('NETWORK_ERROR') || '網路錯誤', 'error');
        } finally {
            generalButtonState(saveBtn, 'idle');
        }
    });

    // 首次載入：用 module-level cache（與 dashboard 共用，不會重複 fetch）
    (async () => {
        try {
            const breaks = await loadBreakTimes();
            render(breaks);
            if (!Array.isArray(breaks) || breaks.length === 0) {
                // 空陣列可能代表 API 失敗 — 顯示警告但不阻塞 UI
                console.warn('setupBreakTimesEditor：cache 為空');
            }
        } catch (err) {
            console.error('setupBreakTimesEditor 載入失敗', err);
            render([]);
            showNotification(t('MSG_BREAK_TIMES_LOAD_FAILED'), 'error');
        }
    })();
}
// #endregion
// ===================================

/* ===== 新增：共用 Helper 函式，放在檔案靠近開頭（或 renderAdminCalendar 之前） ===== */

/**
 * 將各種可能的日期表示正規化為 YYYY-MM-DD
 * @param {string|number} raw
 * @returns {string} YYYY-MM-DD 或空字串
 */
function normalizeDateKey(raw) {
    if (!raw && raw !== 0) return '';
    let s = String(raw);
    // 已經是 YYYY-M-D 或 YYYY-MM-DD
    const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m1) {
        const y = m1[1], mo = String(m1[2]).padStart(2, '0'), d = String(m1[3]).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }
    // YYYYMMDD
    const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
    // 嘗試用 Date 解析
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
        const y = dt.getFullYear(), mo = String(dt.getMonth() + 1).padStart(2, '0'), d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }
    return '';
}
// #endregion
// ===================================
