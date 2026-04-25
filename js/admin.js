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

            // 清空並填充下拉菜單 (使用全域變數)
            // ✅ XSS防護：使用 DOM API 代替 innerHTML
            adminSelectEmployee.replaceChildren();
            const option0 = document.createElement('option');
            option0.value = '';
            option0.textContent = '-- 請選擇一位員工 --';
            adminSelectEmployee.appendChild(option0);

            employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.userId;
                option.textContent = `${ employee.name } (${ employee.userId.substring(0, 8) }...)`;
                adminSelectEmployee.appendChild(option);
            });

            // 清空並填充下拉菜單 (使用全域變數)
            // ✅ XSS防護：使用 DOM API 代替 innerHTML
            adminSelectEmployeeMgmt.replaceChildren();
            const mgmtOption0 = document.createElement('option');
            mgmtOption0.value = '';
            mgmtOption0.textContent = '-- 請選擇一位員工 --';
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
    // 1. 處理員工選擇事件
    adminSelectEmployee.addEventListener('change', async (e) => {

        adminSelectedUserId = e.target.value; // 來自 state.js
        currentManagingEmployee = allEmployeeList.find(emp => emp.userId === adminSelectedUserId);;

        if (adminSelectedUserId) {
            adminEmployeeCalendarCard.style.display = 'block';
            await renderAdminCalendar(adminSelectedUserId, adminCurrentDate); // 來自 state.js
        } else {
            adminEmployeeCalendarCard.style.display = 'none';
        }
    });

    // 1. 處理員工選擇事件
    adminSelectEmployeeMgmt.addEventListener('change', async (e) => {
        const selectedUserId = e.target.value;
        const employee = allEmployeeList.find(emp => emp.userId === selectedUserId);
        if (employee) {
            // 修正屬性名稱：src 和您的資料屬性
            mgmtEmployeeName.textContent = employee.name;
            //mgmtEmployeeId.textContent = employee.userId;
            const joinTimeSource = employee.firstLoginTime;
            let seniorityText = 'N/A';
            let joinDateText = 'N/A';

            if (joinTimeSource) {
                const joinDate = new Date(joinTimeSource);
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
                seniorityText = seniorityText.trim() || 'N/A';
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
    });

    // 2. 處理月份切換事件
    adminPrevMonthBtn.addEventListener('click', () => {
        adminCurrentDate.setMonth(adminCurrentDate.getMonth() - 1);
        if (adminSelectedUserId) {
            renderAdminCalendar(adminSelectedUserId, adminCurrentDate);
        }
    });

    adminNextMonthBtn.addEventListener('click', () => {
        adminCurrentDate.setMonth(adminCurrentDate.getMonth() + 1);
        if (adminSelectedUserId) {
            renderAdminCalendar(adminSelectedUserId, adminCurrentDate);
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
    const subTabs = ['employee-mgmt-view', 'punch-mgmt-view', 'form-review-view', 'scheduling-view'];
    const subBtns = ['tab-employee-mgmt-btn', 'tab-punch-mgmt-btn', 'tab-form-review-btn', 'tab-scheduling-btn'];

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

    // 5. 根據子頁籤 ID 執行特定動作 (例如：載入資料)
    console.log(`切換到管理員子頁籤: ${ subTabId } `);
    if (subTabId === 'review-requests') {
        fetchAndRenderReviewRequests(); // 載入表單
    } else if (subTabId === 'manage-Punch') {
        // renderLocationManagement(); // 待實現
        console.log('載入打卡管理介面...');
    } else if (subTabId === 'manage-users') {
        // renderUserManagement(); // 待實現
        console.log('載入員工帳號管理介面...');
    }
};
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
        const selectEl = document.getElementById('admin-select-employee') || document.getElementById('admin-select-employee-mgmt');
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
        // 用 inline style 確保 row 是橫向 grid（避開 Tailwind JIT 對 grid-cols-12 等 class 未 build 的問題）
        return `
            <div class="break-row p-3 rounded-md bg-gray-50 dark:bg-gray-700"
                 style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;">
                <div style="min-width:0;">
                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${nameLabel}</label>
                    <input type="text" class="break-name ${inputCls}" style="width:100%;" value="${String(name).replace(/"/g, '&quot;')}" />
                </div>
                <div style="min-width:0;">
                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${startLabel}</label>
                    <input type="time" class="break-start ${inputCls}" style="width:100%;" value="${start}" />
                </div>
                <div style="min-width:0;">
                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${endLabel}</label>
                    <input type="time" class="break-end ${inputCls}" style="width:100%;" value="${end}" />
                </div>
                <div>
                    <button type="button" class="break-remove-btn text-sm font-semibold rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900"
                            style="padding:8px 10px;" title="${removeLabel}">✕</button>
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

    // 首次載入：抓資料
    (async () => {
        try {
            const res = await callApifetch({ action: 'getBreakTimes' });
            if (res && res.ok && Array.isArray(res.breaks)) {
                render(res.breaks);
            } else {
                render([]);
                showNotification(t('MSG_BREAK_TIMES_LOAD_FAILED'), 'error');
            }
        } catch (err) {
            console.error('getBreakTimes 失敗', err);
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
