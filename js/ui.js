
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
// #region 1. 月曆
// ===================================

// 渲染日曆的函式
async function renderCalendar(date, isrefresh = false) {
    const monthTitle = document.getElementById('month-title');
    const calendarGrid = document.getElementById('calendar-grid');
    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();

    // 生成 monthKey
    const monthkey = year + "-" + String(month + 1).padStart(2, "0");

    // 檢查快取中是否已有該月份資料
    const cachedData = cacheManager.get('month', monthkey);
    if (cachedData && !isrefresh) {
        // 如果有，直接從快取讀取資料並渲染
        const records = cachedData;
        renderCalendarWithData(year, month, today, records, calendarGrid, monthTitle);
        recordMonthNavigation(date);
        // 預加載已停用（2026-04-27）：與 getCalendarSummary 重複燒 reads，
        // detail 與相鄰月份改為 lazy load。詳見 admin.js 同處註解。
    } else {
        // 如果沒有，才發送 API 請求
        // 清空日曆，顯示載入狀態，並確保置中
        // ✅ XSS防護：使用 DOMPurify 淨化 HTML
        calendarGrid.innerHTML = DOMPurify.sanitize('<div data-i18n="LOADING" class="col-span-full text-center text-gray-500 py-4">正在載入...</div>');
        renderTranslations(calendarGrid);
        try {
            const res = await callApifetch({
                action: 'getCalendarSummary',
                month: monthkey,
                userId: userId
            });
            if (res.ok) {
                cacheMonthData(monthkey, res.records.dailyStatus);

                // 收到資料後，清空載入訊息
                // ✅ XSS防護：使用 replaceChildren() 替代 innerHTML
                calendarGrid.replaceChildren();

                const records = cacheManager.get('month', monthkey) || [];
                renderCalendarWithData(year, month, today, records, calendarGrid, monthTitle);
                recordMonthNavigation(date);

                // 預加載已停用（2026-04-27），同上方註解。
            } else {
                console.error("Failed to fetch attendance records:", res.msg);
                showNotification(t("ERROR_FETCH_RECORDS"), "error");
            }
        } catch (err) {
            console.error(err);
        }
    }
}

/**
 * 🚀 預加載相鄰月份資料
 * 當用戶查看當前月份時，異步加載上一個月和下一個月
 * 預加載靜默進行，不會阻塞 UI
 * @param {Date} currentDate - 當前查看的月份
 */
async function preloadAdjacentMonths(currentDate) {
    try {
        const userId = localStorage.getItem("sessionUserId");
        if (!userId) return; // 未登入，不預加載

        // 計算上一個月和下一個月
        const prevMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

        // 生成月份鍵值
        const prevKey = formatMonthKey(prevMonth);
        const nextKey = formatMonthKey(nextMonth);
        const predictedKeys = getPredictedMonthKeys(currentDate);
        const uniqueKeys = [prevKey, nextKey, ...predictedKeys].filter((key, idx, arr) => key && arr.indexOf(key) === idx);

        uniqueKeys.forEach((key, index) => {
            if (cacheManager.get('month', key)) return;
            const delay = PRELOAD_BASE_DELAY + index * PRELOAD_INCREMENT_DELAY;
            setTimeout(async () => {
                try {
                    const res = await callApifetch({
                        action: 'getCalendarSummary',
                        month: key,
                        userId: userId
                    });

                    if (res.ok) {
                        cacheMonthData(key, res.records.dailyStatus);
                        console.log(`✅ 預加載 ${key} 成功`);
                    }
                } catch (err) {
                    console.warn(`⚠️ 預加載 ${key} 失敗:`, err.message);
                }
            }, delay);
        });
    } catch (err) {
        console.warn("⚠️ 預加載相鄰月份出錯:", err.message);
    }
}

function cacheMonthData(monthkey, data) {
    // 🌟 P1-3 改進：使用統一的 CacheManager
    cacheManager.set('month', monthkey, data);
}

async function loadMonthDetailData(monthkey, targetUserId = null) {
    const userId = targetUserId || localStorage.getItem("sessionUserId") || window.userId;
    if (!userId) return [];

    // 2026-04-27 合併：getCalendarSummary 與 getAttendanceDetails 後端產生
    // 完全相同的 dailyStatus；不再呼叫 getAttendanceDetails，改從既有月曆快取取，
    // 沒有再呼叫 getCalendarSummary 補上。
    if (targetUserId) {
        // admin 模式：先看 admin 月曆快取（key 統一走 adminMonthCacheKey，定義在 admin.js）
        const adminKey = adminMonthCacheKey(targetUserId, monthkey);
        if (typeof adminMonthDataCache !== 'undefined' && adminMonthDataCache[adminKey]) {
            return adminMonthDataCache[adminKey];
        }
    } else {
        // 員工自己模式：先看員工月曆快取（key = monthkey）
        const cached = cacheManager.get('month', monthkey);
        if (cached) return cached;
    }

    // 進行中的同月份載入：等同一個 promise，避免重複發請求
    const promiseKey = `${userId}-${monthkey}`;
    if (monthDetailLoadPromises[promiseKey]) {
        const res = await monthDetailLoadPromises[promiseKey];
        return res.ok ? (res.records.dailyStatus || []) : [];
    }

    try {
        monthDetailLoadPromises[promiseKey] = callApifetch({
            action: 'getCalendarSummary',
            month: monthkey,
            userId: userId,
        });
        const res = await monthDetailLoadPromises[promiseKey];
        if (res.ok) {
            const details = res.records.dailyStatus || [];
            // 寫回對應的月曆快取，下次切月份就能直接命中
            if (targetUserId && typeof adminMonthDataCache !== 'undefined') {
                adminMonthDataCache[adminMonthCacheKey(targetUserId, monthkey)] = details;
            } else {
                cacheManager.set('month', monthkey, details);
            }
            return details;
        }
    } catch (err) {
        console.error('Failed to load month data:', err);
    } finally {
        delete monthDetailLoadPromises[promiseKey];
    }
    return [];
}

function formatMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthKey(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

function recordMonthNavigation(date) {
    const monthKey = formatMonthKey(date);
    if (monthNavigationHistory[monthNavigationHistory.length - 1] !== monthKey) {
        monthNavigationHistory.push(monthKey);
    }
    if (monthNavigationHistory.length > 6) {
        monthNavigationHistory.shift();
    }
}

function getPredictedMonthKeys(currentDate) {
    if (monthNavigationHistory.length < 2) return [];

    const last = parseMonthKey(monthNavigationHistory[monthNavigationHistory.length - 1]);
    const prev = parseMonthKey(monthNavigationHistory[monthNavigationHistory.length - 2]);
    const direction = (last.getFullYear() - prev.getFullYear()) * 12 + (last.getMonth() - prev.getMonth());

    if (Math.abs(direction) !== 1) return [];

    const next1 = new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1);
    const next2 = new Date(currentDate.getFullYear(), currentDate.getMonth() + direction * 2, 1);
    const nextKeys = [formatMonthKey(next1)];

    // 只有當預測方向持續一致時才額外預載第二個月
    if (monthNavigationHistory.length >= 3) {
        const prev2 = parseMonthKey(monthNavigationHistory[monthNavigationHistory.length - 3]);
        const direction2 = (prev.getFullYear() - prev2.getFullYear()) * 12 + (prev.getMonth() - prev2.getMonth());
        if (direction2 === direction) {
            nextKeys.push(formatMonthKey(next2));
        }
    }
    return nextKeys;
}

// 新增一個獨立的渲染函式，以便從快取或 API 回應中調用
function renderCalendarWithData(year, month, today, records, calendarGrid, monthTitle, isForAdmin = false) {
    // 確保日曆網格在每次渲染前被清空
    calendarGrid.replaceChildren();
    monthTitle.textContent = t("MONTH_YEAR_TEMPLATE", {
        year: year,
        month: month + 1
    });

    // 預載當年（與相鄰年）國定假日，第一次有等待，後續從 cache 取
    if (typeof ensureHolidaysLoaded === 'function') {
        ensureHolidaysLoaded(year).then(() => {
            // 載入完後若日曆還在頁面上，補標紅字
            calendarGrid.querySelectorAll('.day-cell[data-date]').forEach((cell) => {
                const dk = cell.dataset.date;
                if (typeof isHoliday === 'function' && isHoliday(dk)) {
                    cell.classList.add('holiday-text');
                    const name = (typeof getHolidayName === 'function') ? getHolidayName(dk) : '';
                    if (name) cell.title = name;
                }
            });
        });
    }

    // 移除舊的累計時數行
    const existingTotalRows = calendarGrid.parentNode.querySelectorAll('.total-hours-row');
    existingTotalRows.forEach(row => row.remove());

    // 計算本月累計時數
    const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    let totalHours = 0;

    // 🚀 P4-2 優化：提前建立 recordsByDate Map
    const recordsByDate = {};
    records.forEach(r => {
        if (!recordsByDate[r.date]) recordsByDate[r.date] = [];
        recordsByDate[r.date].push(r);
        // 同時計算時數（避免第二次循環）
        if (r.date.startsWith(currentMonthKey)) {
            totalHours += parseFloat(r.hours || 0);
        }
    });
    totalHours = totalHours.toFixed(2);

    // 取得該月第一天是星期幾
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 🚀 P4-2 優化：使用 DocumentFragment 批量插入日期格子
    const fragment = document.createDocumentFragment();

    // 填補月初的空白格子
    for (let i = 0; i < firstDayOfMonth; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'day-cell';
        fragment.appendChild(emptyCell);
    }

    // 根據資料渲染每一天的顏色
    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        const cellDate = new Date(year, month, i);
        dayCell.textContent = i;
        let dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        let dateClass = 'normal-day';

        const todayRecords = recordsByDate[dateKey] || [];
        // 假日判斷：優先從 holidays-client 取（台灣國定假日 + 補假），
        // 退路用 dailyStatus.isHoliday（GS 後端標記）。
        let isHolidayDay = false;
        if (typeof window !== 'undefined' && typeof window.isHoliday === 'function') {
            isHolidayDay = window.isHoliday(dateKey);
        }

        if (todayRecords.length > 0) {
            const record = todayRecords[0];
            const reason = record.reason;

            // dailyStatus.isHoliday 作為退路（若 holidays-client 還沒 ready）
            if (!isHolidayDay) isHolidayDay = record.isHoliday || false;

            // 設定背景顏色 (根據打卡狀態)
            switch (reason) {
                case "STATUS_PUNCH_IN_MISSING":
                    dateClass = 'abnormal-day';
                    break;
                case "STATUS_PUNCH_OUT_MISSING":
                    dateClass = 'abnormal-day';
                    break;
                case "STATUS_PUNCH_NORMAL":
                    dateClass = 'day-off';
                    break;
                case "STATUS_REPAIR_PENDING":
                    dateClass = 'pending-virtual';
                    break;
                case "STATUS_REPAIR_APPROVED":
                    dateClass = 'approved-virtual';
                    break;
                case "STATUS_LEAVE_PENDING":
                    dateClass = 'leave-pending';
                    break;
                case "STATUS_LEAVE_APPROVED":
                    dateClass = 'leave-approved';
                    break;
                case "STATUS_VACATION_PENDING":
                    dateClass = 'vacation-pending';
                    break;
                case "STATUS_VACATION_APPROVED":
                    dateClass = 'vacation-approved';
                    break;
                default:
                    if (reason && reason !== "") {
                        dateClass = 'pending-adjustment'; // 假設所有有備註的都算 pending
                    }
                    break;
            }
        }
        if (isHolidayDay) {
            // 由於是假日，將日期文字設為紅色 (需在 CSS 中定義 .holiday-text)
            dayCell.classList.add('holiday-text');
            // 顯示假日名稱（hover tooltip）
            if (typeof window !== 'undefined' && typeof window.getHolidayName === 'function') {
                const name = window.getHolidayName(dateKey);
                if (name) dayCell.title = name;
            }
        }

        const isToday = (year === today.getFullYear() && month === today.getMonth() && i === today.getDate());
        if (isToday) {
            dayCell.classList.add('today');
        } else if (cellDate > today) {
            dayCell.classList.add('future-day');
            dayCell.style.pointerEvents = 'none'; // 未來日期不可點擊
        } else {
            dayCell.classList.add(dateClass);
        }

        // 2026-05-14：含「系統虛擬卡」的日子加紫色角標（不影響 reason 顏色）
        // record.hasVirtual flag 由後端 summarizeByDay 設置
        if (todayRecords.length > 0 && todayRecords[0].hasVirtual) {
            dayCell.classList.add('has-virtual');
        }

        dayCell.classList.add('day-cell');
        dayCell.dataset.date = dateKey;
        dayCell.dataset.records = JSON.stringify(todayRecords); // 儲存當天資料

        fragment.appendChild(dayCell);
    }

    // 填補月末的空白格子，使日曆填滿完整的行數
    const cellsAdded = firstDayOfMonth + daysInMonth;
    const rowsNeeded = Math.ceil(cellsAdded / 7);
    const totalCells = rowsNeeded * 7;
    const remainingCells = totalCells - cellsAdded;

    for (let i = 0; i < remainingCells; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'day-cell empty';
        fragment.appendChild(emptyCell);
    }

    calendarGrid.appendChild(fragment);

    // 🚀 優化：使用事件委托替代 31 個個別監聽器
    // 先移除舊的監聽器（如果存在），避免重複添加
    const oldListener = calendarGrid._calendarClickListener;
    if (oldListener) {
        calendarGrid.removeEventListener('click', oldListener);
    }

    // 創建新的事件監聽器函數
    const newListener = (event) => {
        const dayCell = event.target.closest('.day-cell:not(.empty)');
        if (!dayCell) return;

        const dateStr = dayCell.dataset.date;
        const cellDate = new Date(dateStr);

        // 排除未來日期
        if (cellDate > today) return;

        // 判斷是否為管理員日曆
        if (isForAdmin && adminSelectedUserId) {
            renderAdminDailyRecords(dateStr, adminSelectedUserId);
        } else if (!isForAdmin) {
            renderDailyRecords(dateStr);
        }

        // 同步渲染週工時長條圖
        if (typeof renderWeeklyChart === 'function') {
            const chartCard = isForAdmin
                ? document.getElementById('admin-weekly-chart-card')
                : document.getElementById('weekly-chart-card');
            if (chartCard) renderWeeklyChart(chartCard, records, dateStr, 'total');
        }
    };

    // 保存監聽器引用以便後續移除
    calendarGrid._calendarClickListener = newListener;
    calendarGrid.addEventListener('click', newListener);

    // 在日曆最下面一行顯示本月累計時數（作為獨立的全寬行）
    const totalRow = document.createElement('div');
    totalRow.className = 'total-hours-row mt-2 p-2 bg-gray-100 dark:bg-gray-700 text-center rounded-lg';

    // 🚀 優化：簡單的數字不需要 DOMPurify 掃描
    // 使用 textContent 設置文本內容，避免 XSS 風險且性能更好
    const hourLabel = document.createElement('span');
    hourLabel.setAttribute('data-i18n', 'MONTH_TOTAL_HOURS_PREFIX');
    hourLabel.textContent = '本月累計時數：';

    const hourValue = document.createElement('span');
    const hoursUnit = (typeof t === 'function' && t('UNIT_HOURS')) || '小時';
    hourValue.textContent = totalHours + ' ' + hoursUnit;

    totalRow.appendChild(hourLabel);
    totalRow.appendChild(hourValue);

    calendarGrid.parentNode.appendChild(totalRow);
    renderTranslations(totalRow); // 如果有翻譯需求，渲染翻譯

    // 預設渲染週工時長條圖：若所在月為當月則 default 為今天，否則該月最後有資料的一天
    if (typeof renderWeeklyChart === 'function') {
        const chartCard = isForAdmin
            ? document.getElementById('admin-weekly-chart-card')
            : document.getElementById('weekly-chart-card');
        if (chartCard) {
            const isCurrentMonth = (year === today.getFullYear() && month === today.getMonth());
            let defaultDateKey = null;
            if (isCurrentMonth) {
                defaultDateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            } else {
                // 找該月最後一筆有資料的日期
                const inMonth = (records || []).filter((r) => r.date && r.date.startsWith(currentMonthKey));
                if (inMonth.length) {
                    defaultDateKey = inMonth[inMonth.length - 1].date;
                }
            }
            renderWeeklyChart(chartCard, records, defaultDateKey, 'total');

            // 監聽 chart 內 column 點擊，同步切換打卡紀錄（避免重複綁定：先解綁舊的）
            if (chartCard._weeklyChartSelectListener) {
                chartCard.removeEventListener('weeklyChart:select', chartCard._weeklyChartSelectListener);
            }
            const listener = (e) => {
                const dk = e.detail?.date;
                if (!dk) return;
                if (isForAdmin && adminSelectedUserId) {
                    renderAdminDailyRecords(dk, adminSelectedUserId);
                } else if (!isForAdmin) {
                    renderDailyRecords(dk);
                }
            };
            chartCard.addEventListener('weeklyChart:select', listener);
            chartCard._weeklyChartSelectListener = listener;
        }
    }
}

// 共用 helper：在指定 title 元素之後插入「假日類型」badge
// （國定假日 / 例假日 / 休息日 / 工作日 + 假日名稱 hover 顯示）
function renderDayKindBadge(titleEl, dateKey) {
    if (!titleEl || !dateKey) return;
    // 移除舊 badge（如果有）
    const next = titleEl.nextElementSibling;
    if (next && next.classList && next.classList.contains('day-kind-badge-row')) {
        next.remove();
    }
    if (typeof window.getDayKind !== 'function') return;
    const info = window.getDayKind(dateKey);
    const KIND_KEY = {
        public: 'DAY_KIND_PUBLIC_HOLIDAY',
        regular: 'DAY_KIND_REGULAR_LEAVE',
        rest: 'DAY_KIND_REST_DAY',
        workday: 'DAY_KIND_WORKDAY',
    };
    const COLORS = {
        public: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
        regular: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
        rest: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200',
        workday: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    };
    const i18nKey = KIND_KEY[info.kind] || 'DAY_KIND_WORKDAY';
    const colorClass = COLORS[info.kind] || COLORS.workday;
    const labelText = t(i18nKey) || info.kind;
    const row = document.createElement('div');
    row.className = 'day-kind-badge-row flex items-center gap-2 mb-3 -mt-1';
    const badge = document.createElement('span');
    badge.setAttribute('data-i18n', i18nKey);
    badge.className = `text-xs font-semibold px-2 py-1 rounded-md ${colorClass}`;
    badge.textContent = labelText;
    row.appendChild(badge);
    if (info.name) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'text-sm font-medium text-red-600 dark:text-red-300';
        nameSpan.textContent = info.name;
        row.appendChild(nameSpan);
    }
    titleEl.parentNode.insertBefore(row, titleEl.nextSibling);
}

// 新增：渲染每日紀錄的函式 (修正非同步問題)
async function renderDailyRecords(dateKey) {
    const dailyRecordsCard = document.getElementById('daily-records-card');
    const dailyRecordsTitle = document.getElementById('daily-records-title');
    const dailyRecordsList = document.getElementById('daily-records-list');
    const dailyRecordsEmpty = document.getElementById('daily-records-empty');
    const dailyRecordsLoading = document.getElementById('daily-records-loading');

    dailyRecordsTitle.textContent = t("DAILY_RECORDS_TITLE", {
        dateKey: dateKey
    });
    renderDayKindBadge(dailyRecordsTitle, dateKey);

    dailyRecordsCard.style.display = 'block';
    dailyRecordsList.replaceChildren();
    dailyRecordsEmpty.style.display = 'none';
    if (dailyRecordsLoading) {
        dailyRecordsLoading.style.display = 'block';
    }


    const dateObject = new Date(dateKey);
    const month = dateObject.getFullYear() + "-" + String(dateObject.getMonth() + 1).padStart(2, "0");
    const userId = localStorage.getItem("sessionUserId");

    try {
        // 2026-04-27 合併：直接從 'month' 月曆快取取（loadMonthDetailData 也會走這個快取）
        const cachedDetails = cacheManager.get('month', month);
        if (cachedDetails) {
            if (dailyRecordsLoading) dailyRecordsLoading.style.display = 'none';
            return renderRecords(cachedDetails);
        }

        const details = await loadMonthDetailData(month);
        if (dailyRecordsLoading) dailyRecordsLoading.style.display = 'none';
        renderRecords(details);
    } catch (err) {
        if (dailyRecordsLoading) dailyRecordsLoading.style.display = 'none';
        console.error('API call failed:', err);
        showNotification(t("ERROR_FETCH_RECORDS"), "error");
    }

    /**
     * 渲染指定月份的出席記錄，過濾出所選日期的紀錄，並在畫面上顯示。
     * 每個打卡記錄獨立渲染成一張卡片，上班與下班使用不同顏色。
     * 系統判斷與當日工作時數顯示在卡片列表外部。
     * @param {Array} records - 出席記錄陣列，每個元素包含 date, record, reason, hours 等資訊。
     */
    function renderRecords(records) {
        // 從該月份的所有紀錄中，過濾出所選日期的紀錄
        const dailyRecords = records.filter(record => {
            return record.date === dateKey;
        });

        console.log('Filtered dailyRecords for', dateKey, ':', dailyRecords);

        // 清空現有列表
        dailyRecordsList.replaceChildren();

        // 移除舊的 externalInfo（假設 className 為 'daily-summary' 以便識別）
        const existingSummaries = dailyRecordsList.parentNode.querySelectorAll('.daily-summary');
        existingSummaries.forEach(summary => summary.remove());

        if (dailyRecords.length > 0) {
            dailyRecordsEmpty.style.display = 'none';

            // 假設 dailyRecords 通常只有一個（單一日期），但以 forEach 處理可能多個
            dailyRecords.forEach(dailyRecord => {
                console.log('Processing dailyRecord:', dailyRecord);
                // 安全檢查：確保 record 存在且為數組
                if (!dailyRecord.record || !Array.isArray(dailyRecord.record)) {
                    console.warn('記錄數據結構異常:', dailyRecord);
                    return;
                }

                // 為每個打卡記錄創建獨立卡片
                dailyRecord.record.forEach(r => {
                    const li = document.createElement('li');
                    li.className = 'p-3 rounded-lg';

                    // 🌟 檢查是否為請假/休假記錄
                    if (r.note === "系統請假記錄") {
                        // 請假/休假特殊處理：不顯示時間，只顯示申請狀態
                        const isApproved = r.audit === "v";
                        // '請假'/'休假' 已是語系檔 key，t() 會翻成使用者語言
                        const leaveType = t(r.type || "請假");
                        const statusText = t(isApproved ? "STATUS_APPROVED" : "STATUS_PENDING");

                        li.classList.add('bg-orange-50', 'dark:bg-orange-700'); // 請假/休假顏色（橙色系）
                        // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                        const leaveHtml = `
                        <p class="font-medium text-gray-800 dark:text-white">${leaveType} - <span style="color: ${isApproved ? 'green' : 'orange'}; font-weight: bold;">${statusText}</span></p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">${t('LEAVE_REQUEST_RECORD')}</p>
                    `;
                        li.innerHTML = DOMPurify.sanitize(leaveHtml);
                    } else {
                        // 普通打卡記錄：顯示時間、位置等
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

                        // 系統虛擬卡是 dailyVirtualPunch 寫入的特殊 locationName 標記，
                        // 對使用者顯示時需翻譯（i18n 鍵 LOCATION_VIRTUAL_PUNCH）
                        const locationDisplay = r.location === '系統虛擬卡'
                            ? (typeof t === 'function' ? t('LOCATION_VIRTUAL_PUNCH') : r.location)
                            : r.location;

                        // 2026-05-15：來源類型 badge（員工端也顯示，方便員工識別 admin 代補等）
                        const sourceBadge = (typeof recordSourceBadgeHtml === 'function')
                            ? recordSourceBadgeHtml(r) : '';

                        // 產生單一打卡記錄的 HTML
                        // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                        const punchHtml = `
                        <p class="font-medium text-gray-800 dark:text-white">${r.time} - ${t(typeKey)}${sourceBadge}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">${locationDisplay}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400"><span data-i18n="RECORD_NOTE_PREFIX">備註：</span>${r.note}</p>
                    `;
                        li.innerHTML = DOMPurify.sanitize(punchHtml);
                    }

                    dailyRecordsList.appendChild(li);
                    renderTranslations(li);  // 渲染翻譯
                });

                // 在卡片列表外部顯示系統判斷與時數
                const externalInfo = document.createElement('div');
                externalInfo.className = 'daily-summary mt-4 p-3 bg-gray-100 dark:bg-gray-600 rounded-lg';

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

                // append 到 dailyRecordsList 後面
                dailyRecordsList.parentNode.appendChild(externalInfo);
                renderTranslations(externalInfo);  // 渲染翻譯
            });
        } else {
            dailyRecordsEmpty.style.display = 'block';
        }

        // 2026-05-14：員工月曆點某天 → 詳情卡末尾加「+ 補打卡」按鈕
        // 允許員工針對非異常日（譬如雙班、午休下班、特殊加班）主動補卡
        // class 'adjust-btn' 跟既有 make-up.js handler 相容（事件委派接管）
        _appendMakeupButtonToDailyCard(dailyRecordsList.parentNode, dateKey);

        dailyRecordsCard.style.display = 'block';
    }
}

/**
 * 2026-05-15：依 record 屬性產生「來源類型 badge」HTML
 *
 * 五種來源（依優先順序判斷）：
 *   1. adjustmentType === '系統虛擬卡' → 紫色「虛擬卡」
 *   2. adjustmentType === '系統請假記錄' → 橘色「請假」
 *   3. adjustmentType === '補打卡' + createdByAdmin 不為空 → 琥珀色「Admin 代補」
 *      （fallback：note 開頭含 '[Admin '）
 *   4. adjustmentType === '補打卡' → 靛色「員工補卡」
 *   5. 其他（adjustmentType === ''） → 灰色「正常打卡」
 *
 * @param {object} r record 物件（含 adjustmentType / createdByAdmin / note）
 * @returns {string} <span class="..."> 之 HTML 片段
 */
function recordSourceBadgeHtml(r) {
    const tt = (k, fb) => (typeof t === 'function' ? (t(k) || fb) : fb);
    const adjType = r?.adjustmentType || '';
    const createdByAdmin = r?.createdByAdmin || '';
    const note = r?.note || '';
    // fallback：note 開頭含 '[Admin ' 或 '[由 admin '（舊版 suffix tag 也接住）
    const isAdminMakeup = !!createdByAdmin || /^\[Admin\s/.test(note) || /\[由 admin/.test(note);

    let label, classes;
    if (adjType === '系統虛擬卡') {
        label = tt('BADGE_SOURCE_VIRTUAL', '虛擬卡');
        classes = 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-200';
    } else if (adjType === '系統請假記錄') {
        label = tt('BADGE_SOURCE_LEAVE', '請假');
        classes = 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-200';
    } else if (adjType === '補打卡' && isAdminMakeup) {
        label = tt('BADGE_SOURCE_ADMIN_MAKEUP', 'Admin 代補');
        classes = 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200';
    } else if (adjType === '補打卡') {
        label = tt('BADGE_SOURCE_EMPLOYEE_MAKEUP', '員工補卡');
        classes = 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200';
    } else {
        label = tt('BADGE_SOURCE_NORMAL', '正常打卡');
        classes = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200';
    }
    return `<span class="px-2 py-0.5 ml-2 text-xs font-medium rounded-full ${classes}">${label}</span>`;
}

if (typeof window !== 'undefined') {
    window.recordSourceBadgeHtml = recordSourceBadgeHtml;
}

/**
 * 在「某日詳情卡」末尾附加「+ 補打卡」按鈕（員工側 + admin 側共用）
 *
 * 顯示條件：dateKey 不可未來日（make-up.js 內部還會做當月驗證）
 *
 * @param {HTMLElement} container 詳情卡父節點（按鈕會 append 進去）
 * @param {string} dateKey 'YYYY-MM-DD'
 */
function _appendMakeupButtonToDailyCard(container, dateKey) {
    if (!container || !dateKey) return;
    // 移除舊按鈕群組（避免重複）
    const old = container.querySelector('.calendar-action-group');
    if (old) old.remove();

    // 不允許補未來
    try {
        const [y, m, d] = dateKey.split('-').map(Number);
        const cellDate = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (cellDate > today) return;
    } catch (_) { /* 解析失敗也直接 append */ }

    // 2026-06-10：月曆詳情卡末尾的三個操作按鈕（補打卡 / 請假 / 休假）
    // 都帶 class 'from-calendar' → make-up.js 偵測後渲染進獨立 modal（而非儀表板表單）
    // reason 給 STATUS_BOTH_MISSING → 補打卡走「全日」UI；請假/休假不看 reason
    const group = document.createElement('div');
    group.className = 'calendar-action-group grid grid-cols-3 gap-2 mt-3';

    const mkBtn = (cls, color, i18nKey, fallback) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
            `${cls} from-calendar px-2 py-2 text-sm font-medium rounded-lg border transition ` +
            color;
        b.dataset.date = dateKey;
        b.dataset.reason = 'STATUS_BOTH_MISSING';
        b.setAttribute('data-i18n', i18nKey);
        b.textContent = fallback;
        return b;
    };

    group.appendChild(mkBtn(
        'makeup-from-calendar-btn adjust-btn',
        'text-indigo-700 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border-indigo-300 dark:border-indigo-700',
        'BTN_MAKEUP_FROM_CALENDAR', '+ 補打卡'));
    group.appendChild(mkBtn(
        'leave-btn',
        'text-orange-700 dark:text-orange-200 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/50 border-orange-300 dark:border-orange-700',
        'BTN_LEAVE', '請假'));
    group.appendChild(mkBtn(
        'vacation-btn',
        'text-green-700 dark:text-green-200 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 border-green-300 dark:border-green-700',
        'BTN_VACATION', '休假'));

    container.appendChild(group);
    if (typeof renderTranslations === 'function') renderTranslations(group);
}

// 暴露給 admin.js 共用
if (typeof window !== 'undefined') {
    window._appendMakeupButtonToDailyCard = _appendMakeupButtonToDailyCard;
}

// #endregion
// ===================================

// UI切換邏輯
const switchTab = (tabId) => {
    const tabs = ['dashboard-view', 'monthly-view', 'my-requests-view', 'location-view', 'Form-view', 'admin-view'];
    const btns = ['tab-dashboard-btn', 'tab-monthly-btn', 'tab-my-requests-btn', 'tab-location-btn', 'tab-Form-btn', 'tab-admin-btn'];

    // 1. 移除舊的 active 類別和 CSS 屬性
    tabs.forEach(id => {
        const tabElement = document.getElementById(id);
        tabElement.style.display = 'none'; // 隱藏內容
        tabElement.classList.remove('active'); // 移除 active 類別
    });

    // 2. 移除按鈕的選中狀態
    btns.forEach(id => {
        const btnElement = document.getElementById(id);
        btnElement.classList.replace('bg-indigo-600', 'bg-gray-200');
        btnElement.classList.replace('text-white', 'text-gray-600');
    });

    // 3. 顯示新頁籤並新增 active 類別
    const newTabElement = document.getElementById(tabId);
    newTabElement.style.display = 'block'; // 顯示內容
    newTabElement.classList.add('active'); // 新增 active 類別

    // 4. 設定新頁籤按鈕的選中狀態
    const newBtnElement = document.getElementById(`tab-${tabId.replace('-view', '-btn')}`);
    newBtnElement.classList.replace('bg-gray-200', 'bg-indigo-600');
    newBtnElement.classList.replace('text-gray-600', 'text-white');

    // 5. 根據頁籤 ID 執行特定動作
    if (tabId === 'monthly-view') {
        renderCalendar(currentMonthDate);
    } else if (tabId === 'location-view' || tabId === 'dashboard-view') {
        // 🚀 P2-1 優化：改用 ensureMapInitialized() 實現延遲加載
        // 只在用戶點擊 location-view 時才初始化地圖，而不是立即初始化
        if (typeof ensureMapInitialized === 'function') {
            ensureMapInitialized();
        } else {
            // 降級方案：如果 ensureMapInitialized 未定義，直接初始化
            initLocationMap();
        }
        // 切到 dashboard 時刷新今日打卡紀錄
        if (tabId === 'dashboard-view' && typeof renderTodayPunches === 'function') {
            renderTodayPunches().catch(console.warn);
        }
    } else if (tabId === 'admin-view') {
        fetchAndRenderReviewRequests();
    } else if (tabId === 'my-requests-view') {
        // 2026-05-15：切到「我的補卡申請」tab → 觸發載入
        if (typeof loadMyRequests === 'function') {
            loadMyRequests({ force: false });
        }
    }
};

function generalButtonState(button, state, loadingText = '處理中...') {
    if (!button) return;
    const loadingClasses = 'opacity-50 cursor-not-allowed';

    if (state === 'processing') {
        // --- 進入處理中狀態 ---

        // 1. 儲存原始文本 (用於恢復)
        button.dataset.originalText = button.textContent;

        // 2. 儲存原始類別 (用於恢復樣式)
        // 這是為了在恢復時移除我們為了禁用而添加的類別
        button.dataset.loadingClasses = 'opacity-50 cursor-not-allowed';

        // 3. 禁用並設置處理中文字
        button.disabled = true;
        button.textContent = loadingText; // 使用傳入的 loadingText

        // 4. 添加視覺反饋 (禁用時的樣式)
        button.classList.add(...loadingClasses.split(' '));

        // 可選：移除 hover 效果，防止滑鼠移動時顏色變化
        // 假設您的按鈕有 hover:opacity-100 之類的類別，這裡需要調整

    } else {
        // --- 恢復到原始狀態 ---

        // 1. 移除視覺反饋
        if (button.dataset.loadingClasses) {
            button.classList.remove(...button.dataset.loadingClasses.split(' '));
        }

        // 2. 恢復禁用狀態
        button.disabled = false;

        // 3. 恢復原始文本
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText; // 清除儲存，讓它在下一次點擊時再次儲存
        }
    }
}

// ===================================
// 今日打卡紀錄即時回饋（P2 防重複打卡 + UI 反饋）
// ===================================

/**
 * 樂觀更新：立即在「今日打卡紀錄」區塊追加一筆
 * @param {string} type   '上班' / '下班'
 * @param {Date} when     打卡時間（預設 now）
 */
function appendTodayPunch(type, when = new Date()) {
    const list = document.getElementById('today-punches-list');
    const empty = document.getElementById('today-punches-empty');
    if (!list) return;
    const hh = String(when.getHours()).padStart(2, '0');
    const mm = String(when.getMinutes()).padStart(2, '0');
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between p-2 rounded bg-white dark:bg-gray-800';
    const typeColor = type === '上班' ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400';
    li.innerHTML = `
        <span class="${typeColor} font-semibold">
            <i class="fas fa-${type === '上班' ? 'sign-in-alt' : 'sign-out-alt'} mr-1"></i>
            ${t(type)}
        </span>
        <span class="text-gray-700 dark:text-gray-200 font-mono">${hh}:${mm}</span>
    `;
    list.appendChild(li);
    if (empty) empty.style.display = 'none';
}

/**
 * 從 API（或 cache）讀今日的打卡 record，重 render 整個列表
 */
async function renderTodayPunches() {
    const list = document.getElementById('today-punches-list');
    const empty = document.getElementById('today-punches-empty');
    if (!list) return;

    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const dateKey = `${monthKey}-${String(today.getDate()).padStart(2, '0')}`;

    list.replaceChildren();
    if (empty) empty.style.display = 'block';

    try {
        const days = await loadMonthDetailData(monthKey);
        const todayRec = (days || []).find(d => d.date === dateKey);
        const records = (todayRec && todayRec.record) || [];
        // 排序按時間
        const sorted = records
            .filter(r => r && r.time)
            .sort((a, b) => String(a.time).localeCompare(String(b.time)));
        if (sorted.length === 0) return;
        if (empty) empty.style.display = 'none';
        sorted.forEach(r => {
            const m = String(r.time).match(/^(\d{1,2}):(\d{2})/);
            const hhmm = m ? `${m[1].padStart(2, '0')}:${m[2]}` : r.time;
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-2 rounded bg-white dark:bg-gray-800';
            const isIn = r.type === '上班';
            const typeColor = isIn ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400';
            const audit = r.audit === '?' ? ` <span class="text-xs text-yellow-600">(${t('STATUS_PENDING')})</span>`
                : (r.audit === 'x' ? ` <span class="text-xs text-red-600">(${t('STATUS_REJECTED')})</span>` : '');
            li.innerHTML = `
                <span class="${typeColor} font-semibold">
                    <i class="fas fa-${isIn ? 'sign-in-alt' : 'sign-out-alt'} mr-1"></i>
                    ${r.type ? t(r.type) : '?'}${audit}
                </span>
                <span class="text-gray-700 dark:text-gray-200 font-mono">${hhmm}</span>
            `;
            list.appendChild(li);
        });
    } catch (err) {
        console.warn('renderTodayPunches 失敗：', err);
    }
}

if (typeof window !== 'undefined') {
    window.appendTodayPunch = appendTodayPunch;
    window.renderTodayPunches = renderTodayPunches;
}