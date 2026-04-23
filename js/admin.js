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
// 薪資計算配置 (Phase 1 - 數據模型)
// ===================================
/**
 * 加班倍率表（根據日期類型和時數區間）
 * 用於 classifyOvertimeHours() 和 calculateOvertimeFees()
 */
const OVERTIME_RATES = {
    "平日2H以內": 1.34,
    "平日3~4H以上": 1.67,
    "休息日2H以內": 1.34,
    "休息日3~8H": 1.67,
    "休息日9H以上": 2.67,
    "例假日8H以內": 1.0,
    "例假日8H以上": 2.0,
    "國定假日9~10H": 1.34,
    "國定假日11~12H以上": 1.67
};

/**
 * 保險費率表（用於計算應扣項目）
 * 員工等級：第1級、第2級等
 */
const INSURANCE_RATES = {
    "勞保": {
        "第1級": 0.0225,
        "第2級": 0.0225
    },
    "健保": {
        "第1級": 0.0130,
        "第2級": 0.0130
    }
};

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
 * 根據上班與下班時間，計算扣除休息時間後的有效工時 (小時)，並回傳被扣除的總分鐘數。
 *
 * @param {string} punchInTime - 上班打卡時間，格式 'HH:MM' (例如 '08:30')
 * @param {string} punchOutTime - 下班打卡時間，格式 'HH:MM' (例如 '17:30')
 * @returns {Object} { effectiveHours: number, totalBreakMinutes: number }
 */
function calculateEffectiveHours(punchInTime, punchOutTime) {
    // 休息時間定義 (格式: [開始時間, 結束時間]，皆為 'HH:MM')
    const breakTimes = [
        ['06:00', '06:30'], // 早餐
        ['12:00', '13:00'], // 午餐
        ['19:00', '19:30']  // 晚餐
    ];

    // 輔助函數：將 'HH:MM' 轉換為當天的分鐘數
    const timeToMinutes = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    // 輔助函數：計算兩個時間段的重疊分鐘數
    const getOverlapMinutes = (start1, end1, start2, end2) => {
        const latestStart = Math.max(start1, start2);
        const earliestEnd = Math.min(end1, end2);
        return Math.max(0, earliestEnd - latestStart);
    };

    const inMinutes = timeToMinutes(punchInTime);
    const outMinutes = timeToMinutes(punchOutTime);

    // 無效打卡 (下班早於上班)，返回 0
    if (outMinutes <= inMinutes) {
        return { effectiveHours: 0, totalBreakMinutes: 0 };
    }

    let totalDurationMinutes = outMinutes - inMinutes; // 總分鐘數
    let totalBreakMinutes = 0; // 應扣除的休息分鐘數

    // 計算重疊的休息時間
    breakTimes.forEach(breakPeriod => {
        const [breakStart, breakEnd] = breakPeriod;
        const breakStartMinutes = timeToMinutes(breakStart);
        const breakEndMinutes = timeToMinutes(breakEnd);

        const overlap = getOverlapMinutes(
            inMinutes,
            outMinutes,
            breakStartMinutes,
            breakEndMinutes
        );

        totalBreakMinutes += overlap;
    });

    // 實際應計薪的總分鐘數
    const effectiveMinutes = totalDurationMinutes - totalBreakMinutes;

    // 轉換為小時並保留兩位小數
    const effectiveHours = parseFloat(Math.max(0, effectiveMinutes / 60).toFixed(2));

    return { effectiveHours, totalBreakMinutes }; // 回傳物件
}

/**
 * 計算單日薪資 (符合勞動部一例一休規則)
 * @param {number} hours - 當日淨工時 (已扣除休息時間)
 * @param {number} hourlyRate - 等效時薪
 * @param {string} dayType - 日子類型 (來自 DAY_TYPE 常數)
 * @returns {Object} - { dailySalary: number, calculation: string }
 */
function calculateDailySalary(hours, hourlyRate, dayType) {
    let dailySalary = 0;
    let calculation = '';
    const NORMAL_WORK_HOURS = 8;
    // --- 🆕 初始化時數細節 ---
    const dailyHours = {
        normalHours: 0,   // 屬於法定正常工時 (平日前 8 小時)
        overtimeHours: 0, // 加班工時 (平日 >8h, 休息日所有時數)
        restHours: 0,     // 休息時數 (來自 calculateEffectiveHours 傳入)
        netHours: hours   // 淨工時 (總計薪時數)
    };

    // -------------------------
    // 如果 hours <= 0，直接返回 0
    if (hours <= 0) {
        return { dailySalary: 0, calculation: '淨工時 0h，無薪資' };
    }

    if (dayType === DAY_TYPE.REGULAR_OFF) {
        // =========================================================
        // 例假日 (週日) 計算
        // 前 8 小時至少給一日工資，另補休一日；此處依目前匯出口徑直接折現。
        // 超過 8 小時部分按 2 倍計。
        // =========================================================
        dailyHours.overtimeHours = hours; // 例假日出勤，所有工時皆為加班性質（特休/例假性質）
        const extraPay = hourlyRate * 8;
        dailySalary += extraPay;
        calculation += `${ hourlyRate } × 8(例假日前 8 小時，至少給 8 小時薪資) = ${ extraPay.toFixed(2) }; `;

        let hWorked = hours;
        let hOver8 = Math.max(0, hWorked - 8);

        // 例假日超時部分（超 8 小時）：按 2 倍計
        if (hOver8 > 0) {
            const payOver = hourlyRate * hOver8 * 2;
            dailySalary += payOver;
            calculation += `${ hourlyRate } × ${ hOver8 } × 2(例假日 > 8h 加班) = ${ payOver.toFixed(2) }; `;
        }

        // 例假日補休一天，依目前匯出口徑直接折現。
        dailySalary += extraPay;
        calculation += `${ hourlyRate } × 8(例假日補休折現) = ${ extraPay.toFixed(2) }; `;
    } else if (dayType === DAY_TYPE.HOLIDAY) {
        // =========================================================
        // 國定假日 (特別休假) 計算
        // =========================================================
        dailyHours.overtimeHours = hours; // 例假日出勤，所有工時皆為加班性質（特休/例假性質）
        if (hours <= 8) {
            dailySalary = hourlyRate * 8;
            calculation = `${ hourlyRate } × ${ 8 } (國定假日 - 不論工時長短，至少給予一日工資，即 8 小時薪資) = ${ dailySalary.toFixed(2) } `;
        } else {
            const normalPay = hourlyRate * 8;
            dailySalary += normalPay;
            calculation += `${ hourlyRate } × 8(國定假日) = ${ normalPay.toFixed(2) }; `;

            let overtimeHours = hours - 8;

            // 加班前 2 小時: 1.33 倍 (4/3)
            if (overtimeHours > 0) {
                const overtime1 = Math.min(overtimeHours, 2);
                const overtimePay1 = hourlyRate * overtime1 * 4 / 3;
                dailySalary += overtimePay1;
                calculation += `${ hourlyRate } × ${ overtime1 } × 4 / 3(國定假日加班 1 - 2h) = ${ overtimePay1.toFixed(2) }; `;
                overtimeHours -= overtime1;
            }
            // 加班後續小時: 1.66 倍 (5/3)
            if (overtimeHours > 0) {
                const overtimePay2 = hourlyRate * overtimeHours * 5 / 3;
                dailySalary += overtimePay2;
                calculation += `${ hourlyRate } × ${ overtimeHours } × 5 / 3(國定假日加班 > 2h) = ${ overtimePay2.toFixed(2) }; `;
            }
        }
    } else if (dayType === DAY_TYPE.REST_DAY) {
        // =========================================================
        // 休息日 (週六) 加班計算 (勞基法 §24 II)
        // 薪資基數：前 2h: 4/3；接著 6h: 5/3；超過 8h: 8/3。
        // =========================================================
        dailyHours.overtimeHours = hours; // 例假日出勤，所有工時皆為加班性質（特休/例假性質）
        let remainingHours = hours;

        // 1. 前 2 小時: 1.33 倍 (4/3)
        if (remainingHours > 0) {
            const h = Math.min(remainingHours, 2);
            const pay = hourlyRate * h * 4 / 3;
            dailySalary += pay;
            calculation += `${ hourlyRate } × ${ h } × 4 / 3(休息日 1 - 2h) = ${ pay.toFixed(2) }; `;
            remainingHours -= h;
        }

        // 2. 接著 6 小時 (總時數 3-8h): 1.66 倍 (5/3)
        if (remainingHours > 0) {
            const h = Math.min(remainingHours, 6);
            const pay = hourlyRate * h * 5 / 3;
            dailySalary += pay;
            calculation += `${ hourlyRate } × ${ h } × 5 / 3(休息日 3 - 8h) = ${ pay.toFixed(2) }; `;
            remainingHours -= h;
        }

        // 3. 超過 8 小時: 2.66 倍 (8/3)
        if (remainingHours > 0) {
            const h = remainingHours;
            const pay = hourlyRate * h * 8 / 3;
            dailySalary += pay;
            calculation += `${ hourlyRate } × ${ h } × 8 / 3(休息日 > 8h) = ${ pay.toFixed(2) }; `;
        }
    } else {
        // =========================================================
        // 平日/工作日 加班計算 (原邏輯，勞基法 §24 I)
        // =========================================================
        let normalHours = Math.min(hours, NORMAL_WORK_HOURS);
        let overtimeHours = Math.max(0, hours - NORMAL_WORK_HOURS);

        dailyHours.normalHours = normalHours;
        dailyHours.overtimeHours = overtimeHours;

        overtimeHours = hours - normalHours;

        // 加班前 2 小時: 1.33 倍 (4/3)
        if (overtimeHours > 0) {
            const overtime1 = Math.min(overtimeHours, 2);
            const overtimePay1 = hourlyRate * overtime1 * 4 / 3;
            dailySalary += overtimePay1;
            calculation += `${ hourlyRate } × ${ overtime1 } × 4 / 3(平日加班 1 - 2h) = ${ overtimePay1.toFixed(2) }; `;
            overtimeHours -= overtime1;
        }
        // 加班後續小時: 1.66 倍 (5/3)
        if (overtimeHours > 0) {
            const overtimePay2 = hourlyRate * overtimeHours * 5 / 3;
            dailySalary += overtimePay2;
            calculation += `${ hourlyRate } × ${ overtimeHours } × 5 / 3(平日加班 > 2h) = ${ overtimePay2.toFixed(2) }; `;
        }

    }

    // 將總計加入 calculation 字串
    if (calculation && !calculation.includes('總計')) {
        calculation += `總計 = ${ dailySalary.toFixed(2) } `;
    }

    return {
        dailySalary: parseFloat(dailySalary.toFixed(2)), calculation,
        laborHoursDetails: dailyHours
    };
}
/**
 * 🆕 專門用於處理「原始打卡時間」並計算單日薪資的函式。
 * 此函式確保計算前會扣除休息時間。
 *
 * @param {string} punchInTime - 上班打卡時間，格式 'HH:MM'
 * @param {string} punchOutTime - 下班打卡時間，格式 'HH:MM'
 * @param {number} hourlyRate - 等效時薪 (數字)
 * @returns {Object} 包含所有細節的物件：{ dailySalary, calculation, effectiveHours, totalBreakMinutes }
 */
function calculateDailySalaryFromPunches(punchInTime, punchOutTime, hourlyRate, dayType) {
    // 1. 計算淨工時與休息扣除時間
    const { effectiveHours, totalBreakMinutes } = calculateEffectiveHours(punchInTime, punchOutTime);

    // 🌟 預先計算休息小時數 🌟
    const restHours = parseFloat((totalBreakMinutes / 60).toFixed(2));

    let result = {
        dailySalary: 0,
        calculation: '',
        effectiveHours: effectiveHours,
        totalBreakMinutes: totalBreakMinutes,
        // 預設的工時細節 (如果沒有 effectiveHours，只顯示休息時數)
        laborHoursDetails: {
            normalHours: 0,
            overtimeHours: 0,
            restHours: restHours, // 📌 初始化時填入正確的休息時數
            netHours: effectiveHours
        }
    };

    if (effectiveHours > 0) {
        // 2. 呼叫核心函式計算薪資
        const salaryResult = calculateDailySalary(effectiveHours, hourlyRate, dayType);

        result.dailySalary = salaryResult.dailySalary;
        result.calculation = salaryResult.calculation;

        // 🌟 修正點 1: 使用展開運算子 (Spread Operator) 整合時數分類 🌟
        // 這確保了 restHours 即使在 salaryResult 中沒有被明確處理，也能被保留。
        if (salaryResult.laborHoursDetails) {
            result.laborHoursDetails = {
                ...salaryResult.laborHoursDetails,
                restHours: restHours // 📌 確保 restHours 覆蓋/更新為本地計算的值
            };
        }

        // 修正點 2: 處理計算後，淨工時可能與有效工時不符的問題 (理論上不應發生，但為穩健而保留)
        result.laborHoursDetails.netHours = effectiveHours;
    }

    return result;
}

// ===================================
// Phase 2: 加班時數分類演算法
// ===================================

/**
 * 將總加班時數分配到9個加班類別
 * @param {number} totalHours - 總工時
 * @param {string} dayType - 日期類型 ("平日"|"例假日"|"休息日"|"國定假日")
 * @param {boolean} isHoliday - 是否為假日
 * @param {number} baseHours - 基準工時（預設8）
 * @returns {object} overtimeDetails - 各類型加班時數分配
 */
function classifyOvertimeHours(totalHours, dayType, isHoliday, baseHours = 8) {
    const overtimeDetails = {
        "平日2H以內": 0,
        "平日3~4H以上": 0,
        "休息日2H以內": 0,
        "休息日3~8H": 0,
        "休息日9H以上": 0,
        "例假日8H以內": 0,
        "例假日8H以上": 0,
        "國定假日9~10H": 0,
        "國定假日11~12H以上": 0
    };

    const workedHours = Math.max(0, Number(totalHours) || 0);
    const normalizedDayType = (() => {
        if (dayType === DAY_TYPE.NORMAL || dayType === 'NORMAL' || dayType === '平日') return '平日';
        if (dayType === DAY_TYPE.REST_DAY || dayType === 'REST_DAY' || dayType === '休息日') return '休息日';
        if (dayType === DAY_TYPE.REGULAR_OFF || dayType === 'REGULAR_OFF' || dayType === '例假日') return '例假日';
        if (dayType === DAY_TYPE.HOLIDAY || dayType === 'HOLIDAY' || dayType === '國定假日') return '國定假日';
        return String(dayType || '');
    })();

    switch (normalizedDayType) {
        case '平日': {
            // 依勞基法第24條：平日延長工時前2小時與再2小時倍率不同
            const overtimeHours = Math.max(0, workedHours - baseHours);
            overtimeDetails['平日2H以內'] = Math.min(overtimeHours, 2);
            overtimeDetails['平日3~4H以上'] = Math.min(Math.max(overtimeHours - 2, 0), 2);
            break;
        }

        case '休息日': {
            // 休息日按總出勤時數分段
            overtimeDetails['休息日2H以內'] = Math.min(workedHours, 2);
            overtimeDetails['休息日3~8H'] = Math.min(Math.max(workedHours - 2, 0), 6);
            overtimeDetails['休息日9H以上'] = Math.max(workedHours - 8, 0);
            break;
        }

        case '例假日': {
            // 例假日前 8 小時比照國定假日給薪，超過 8 小時部分另按 2 倍計。
            overtimeDetails['例假日8H以內'] = workedHours > 0 ? baseHours : 0;
            overtimeDetails['例假日8H以上'] = Math.max(workedHours - baseHours, 0);
            break;
        }

        case '國定假日': {
            // 國定假日以超過 8 小時部分分為 9~10H 與 11~12H 以上
            const overtimeHours = Math.max(0, workedHours - baseHours);
            overtimeDetails['國定假日9~10H'] = Math.min(overtimeHours, 2);
            overtimeDetails['國定假日11~12H以上'] = Math.max(overtimeHours - 2, 0);
            break;
        }

        default:
            console.warn(`未知的日期類型: ${ dayType } `);
    }

    return overtimeDetails;
}

/**
 * 計算各類加班費
 * @param {object} overtimeDetails - 各類型加班時數
 * @param {number} baseHourlyRate - 基礎時薪
 * @returns {object} 各類型加班費及合計
 */
function calculateOvertimeFees(overtimeDetails, baseHourlyRate) {
    const fees = {};
    let totalFees = 0;

    for (const [category, hours] of Object.entries(overtimeDetails)) {
        if (hours > 0 && OVERTIME_RATES[category]) {
            const rate = OVERTIME_RATES[category];
            const fee = hours * baseHourlyRate * rate;
            fees[category] = {
                hours: parseFloat(hours.toFixed(2)),
                rate: rate,
                fee: parseFloat(fee.toFixed(0))
            };
            totalFees += fee;
        }
    }

    fees.total = parseFloat(totalFees.toFixed(0));
    return fees;
}

// ===================================
// Phase 3: 薪資計算邏輯
// ===================================

/**
 * 計算月度應發項目（基本薪資、津貼、加班費）
 * @param {Array} monthRecords - 月份的所有日期記錄
 * @param {number} baseHourlyRate - 基礎時薪
 * @param {object} employeeInfo - 員工信息（包含salary、leaveInsurance等）
 * @returns {object} 應發項目詳細信息
 */
function calculatePayrollIncome(monthRecords, baseHourlyRate, employeeInfo) {
    const baseSalary = employeeInfo.salary || 0;

    // 計算例假日和國定假日天數
    let leaveHolidayCount = 0;  // 例假日（周日）
    let nationalHolidayCount = 0; // 國定假日
    let totalOvertimeFees = 0;

    // 遍歷月度記錄，計算加班費和假日天數
    monthRecords.forEach(record => {
        if (!record || !record.date) return;

        const dateObj = new Date(record.date);
        const dayOfWeek = dateObj.getDay(); // 0=周日, 6=周六

        // 判斷假日類型
        if (dayOfWeek === 0 && !record.isHoliday) {
            // 周日（例假日）
            leaveHolidayCount++;
        } else if (record.isHoliday && dayOfWeek !== 6) {
            // 國定假日（排除周六）
            nationalHolidayCount++;
        }
    });

    // 計算津貼
    const leaveBonus = (baseSalary / 240) * leaveHolidayCount * 8; // 例假日津貼
    const holidayBonus = (baseSalary / 240) * nationalHolidayCount * 8; // 國定假日津貼

    // 計算總應發
    const totalIncome = baseSalary + leaveBonus + holidayBonus + totalOvertimeFees;

    return {
        baseSalary: parseFloat(baseSalary.toFixed(0)),
        leaveBonus: parseFloat(leaveBonus.toFixed(0)),
        holidayBonus: parseFloat(holidayBonus.toFixed(0)),
        overtimeFees: parseFloat(totalOvertimeFees.toFixed(0)),
        totalIncome: parseFloat(totalIncome.toFixed(0)),
        leaveHolidayCount: leaveHolidayCount,
        nationalHolidayCount: nationalHolidayCount
    };
}

/**
 * 計算月度應扣項目（保險費、稅金等）
 * @param {number} totalIncome - 總應發
 * @param {object} employeeInfo - 員工信息
 * @returns {object} 應扣項目詳細信息
 */
function calculatePayrollDeductions(totalIncome, employeeInfo) {
    const leaveInsurance = String(employeeInfo.leaveInsurance || "第2級").trim();
    const healthInsurance = String(employeeInfo.healthInsurance || "第2級").trim();
    const housingExpense = Number(employeeInfo.housingExpense || 1000);

    // 計算保險費
    const leaveInsuranceFee = totalIncome * (INSURANCE_RATES["勳保"][leaveInsurance] || 0.0225);
    const healthInsuranceFee = totalIncome * (INSURANCE_RATES["健保"][healthInsurance] || 0.0130);

    // 計算所得稅（簡化版本：應發 × 6%）
    const incomeTax = totalIncome * 0.06;

    // 總應扣
    const totalDeductions = leaveInsuranceFee + healthInsuranceFee + housingExpense + incomeTax;

    return {
        leaveInsurance: parseFloat(leaveInsuranceFee.toFixed(0)),
        healthInsurance: parseFloat(healthInsuranceFee.toFixed(0)),
        housingExpense: parseFloat(housingExpense.toFixed(0)),
        incomeTax: parseFloat(incomeTax.toFixed(0)),
        totalDeductions: parseFloat(totalDeductions.toFixed(0))
    };
}

/**
 * 生成完整的薪資摘要
 * @param {Array} monthRecords - 月份的所有日期記錄
 * @param {number} baseHourlyRate - 基礎時薪
 * @param {object} employeeInfo - 員工信息
 * @returns {object} 完整的薪資計算結果
 */
function generatePayrollSummary(monthRecords, baseHourlyRate, employeeInfo) {
    // 計算應發
    const income = calculatePayrollIncome(monthRecords, baseHourlyRate, employeeInfo);

    // 計算應扣
    const deductions = calculatePayrollDeductions(income.totalIncome, employeeInfo);

    // 計算淨額
    const netAmount = income.totalIncome - deductions.totalDeductions;

    return {
        income: income,
        deductions: deductions,
        netAmount: parseFloat(netAmount.toFixed(0)),
        payableAmount: parseFloat(netAmount.toFixed(0)) // 實支額
    };
}

/**
 * 渲染管理員視圖中，某一天點擊後的打卡紀錄
 * @param {string} dateKey - 點擊的日期 (YYYY-MM-DD)
 * @param {string} userId - 管理員選定的員工 ID
 */
async function renderAdminDailyRecords(dateKey, userId) {
    // 確保使用全域變數，而非 document.getElementById
    adminDailyRecordsTitle.textContent = t("DAILY_RECORDS_TITLE", { dateKey: dateKey });

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

                let hoursHtml = '';
                let salaryHtml = '';
                if (dailyRecord.hours > 0) {
                    hoursHtml = `
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                            <span data-i18n="RECORD_HOURS_PREFIX">當日工作時數：</span>
                            ${dailyRecord.hours} 小時
                        </p>
                    `;
                    // 計算當日薪資 (使用 currentManagingEmployee.salary，假設已從員工選擇事件中設定)
                    const monthlySalary = currentManagingEmployee.salary || 30000; // 預設為2025最低月薪，如果無資料
                    const hourlyRate = (monthlySalary / 240); // 確保是數字進行計算，用於傳遞給底層函式

                    const dateObject = new Date(dailyRecord.date);

                    // 檢查轉換是否成功，避免轉換失敗時繼續執行
                    if (isNaN(dateObject)) {
                        console.error(`日期格式錯誤，無法轉換: ${ dailyRecord.date } `);
                        return; // 跳過此筆紀錄
                    }

                    const dayOfWeek = dateObject.getDay(); // 0=週日, 6=週六

                    const isNationalHoliday = dailyRecord.isHoliday || false;
                    const hasHolidayField = Object.prototype.hasOwnProperty.call(dailyRecord || {}, 'isHoliday')
                        || Object.prototype.hasOwnProperty.call(dailyRecord || {}, 'holiday');
                    const holidayRawValue = hasHolidayField
                        ? (dailyRecord?.isHoliday ?? dailyRecord?.holiday)
                        : undefined;
                    const isWeekendWorkday = (dayOfWeek === 0 || dayOfWeek === 6)
                        && hasHolidayField
                        && isExplicitNonHolidayValue(holidayRawValue);

                    const dayType = determineDayType(dayOfWeek, isNationalHoliday, isWeekendWorkday);
                    console.log(`計算日期: ${ dailyRecord.date }, dayOfWeek:${ dayOfWeek }, 類型: ${ dayType } `);
                    const hourlyRateDisplay = hourlyRate.toFixed(2); // 用於顯示

                    // 🚨 關鍵變動：使用新的包裝函式來計算所有細節
                    const {
                        dailySalary,
                        calculation,
                        effectiveHours,
                        totalBreakMinutes
                    } = calculateDailySalaryFromPunches(
                        dailyRecord.punchInTime,
                        dailyRecord.punchOutTime,
                        hourlyRate,
                        dayType
                    );

                    const breakHoursDisplay = (totalBreakMinutes / 60).toFixed(2);
                    const effectiveHoursFixed = effectiveHours.toFixed(2);
                    const dailySalaryFixed = dailySalary.toFixed(2); // 確保薪資顯示兩位小數

                    if (effectiveHours > 0) {
                        salaryHtml = `
                        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
                            <span data-i18n="RECORD_SALARY_PREFIX">當日薪資：</span>
                            <span class="font-bold text-indigo-600 dark:text-indigo-400">${dailySalaryFixed} NTD</span>
                        </p>
                        <details class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            <summary>薪資計算細節</summary>
                            <ul class="list-disc ml-4 mt-1 space-y-0.5">
                                <li><span data-i18n="HOURLY_RATE_CALCULATED">等效時薪：</span> ${hourlyRateDisplay} NTD/小時</li>
                                <li><span data-i18n="BREAK_DEDUCTION">休息扣除：</span> ${breakHoursDisplay}h (淨工時 ${effectiveHoursFixed}h)</li>
                                <li><span data-i18n="SALARY_CALCULATION">日薪計算式：</span> ${calculation}</li>
                            </ul>
                        </details>
                        `;
                    } else {
                        // 處理淨工時為 0 但有打卡的情況
                        salaryHtml = `
                        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
                            <span data-i18n="RECORD_SALARY_PREFIX">當日加班薪資：</span>
                            0.00 NTD
                        </p>
                        <p class="text-xs text-red-400 mt-1 italic">
                            <span data-i18n="NO_EFFECTIVE_HOURS">淨工時為 0。</span> 休息扣除 ${breakHoursDisplay}h。
                        </p>
                        `;
                    }
                }

                // ✅ XSS防護：使用 DOMPurify 淨化 HTML
                const externalInfoHtml = `
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                            <span data-i18n="RECORD_REASON_PREFIX">系統判斷：</span>
                            ${t(dailyRecord.reason)}
                        </p>
                        ${hoursHtml}
                        ${salaryHtml}
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
// 日子類型常數 (新增區分 例假日 與 國定假日)
const DAY_TYPE = {
    NORMAL: 'NORMAL',         // 平日 (週一至週五)
    REST_DAY: 'REST_DAY',     // 休息日 (週六)
    REGULAR_OFF: 'REGULAR_OFF', // 例假日 (週日)
    HOLIDAY: 'HOLIDAY'         // 國定假日 (特別休假日)
};

/**
 * 根據星期幾和是否為國定假日，判斷該日子的類型。
 * @param {number} dayOfWeek - 星期幾 (0=日, 6=六)
 * @param {boolean} isNationalHoliday - 是否為國定假日 (來自 holiday map)
 * @param {boolean} isWeekendWorkday - 是否為週末補班日（是否假日=否）
 * @returns {string} - 回傳 DAY_TYPE 中的常數
 */
function isExplicitNonHolidayValue(value) {
    if (value === false || value === 0) return true;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'false' || normalized === '0' || normalized === '否' || normalized === 'no' || normalized === 'n';
}

function determineDayType(dayOfWeek, isNationalHoliday, isWeekendWorkday = false) {
    if (isWeekendWorkday && (dayOfWeek === 0 || dayOfWeek === 6)) {
        return DAY_TYPE.NORMAL; // 週末補班視為平日
    }
    if (dayOfWeek === 0) {
        return DAY_TYPE.REGULAR_OFF; // 週日 (例假日)
    }
    if (dayOfWeek === 6) {
        return DAY_TYPE.REST_DAY; // 週六 (休息日)
    }
    // 只有平日且標記為假日時，才判定為國定假日
    if (isNationalHoliday) {
        return DAY_TYPE.HOLIDAY; // 國定假日（平日遇國定假日）
    }
    return DAY_TYPE.NORMAL; // 週一到週五 (平日)
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
            showNotification("取得待審核請求失敗：" + res.msg, "error"); // 來自 core.js
            emptyEl.style.display = 'block';
        }
    } catch (error) {
        showNotification("取得待審核請求失敗，請檢查網路。", "error");
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

        // ✅ XSS防護：使用 DOMPurify 淨化 HTML
        const requestItemHtml = `
        <div class="flex flex-col space-y-1">
            <div class="flex items-center justify-between w-full">
                <div>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${detailText}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">申請時間: ${req.applicationTime || "（未知）"}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">${isLeaveRequest ? '請假/休假時間' : '補打卡時間'}: ${req.targetTime || "（未知）"}</p>
                </div>
                <span class="text-xs font-semibold px-2 py-1 rounded-md ${isLeaveRequest ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}">${isLeaveRequest ? '請假/休假' : '補打卡'}</span>
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
    const actionText = action === 'approve' ? '核准' : '拒絕';
    const confirmMsg = `確定要${ actionText } 此項申請嗎？`;
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
            salaryValueSpan.innerText = employee.salary || 60;
            basicSalaryInput.value = employee.salary || 0;

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
            showNotification("請填寫所有欄位並取得位置", "error");
            return;
        }

        // 🌟 修正點 (問題8.6)：添加確認對話框
        const confirmMsg = `確定要新增地點 "${name}" 嗎？`;
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
                showNotification("地點新增成功！", "success");
                // 清空輸入欄位
                locationName.value = ''; // 假設您有宣告 locationName
                locationLatInput.value = '';
                locationLngInput.value = '';
                // 重設按鈕狀態
                getLocationBtn.textContent = '取得當前位置';
                getLocationBtn.disabled = false;
                addLocationBtn.disabled = true;
            } else {
                showNotification("新增地點失敗：" + res.msg, "error");
            }
        } catch (err) {
            console.error(err);
        }
    });

    // 註冊月薪收折與匯出功能（確保 DOM 元素已存在）
    setupAdminSalaryToggle && setupAdminSalaryToggle();
    setupAdminExport();
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
            showNotification("API 測試成功！回應：" + JSON.stringify(res), "success");
        } else {
            showNotification("API 測試失敗：" + (res ? res.msg : "無回應資料"), "error");
        }
    } catch (error) {
        console.error("API 呼叫發生錯誤:", error);
        showNotification("API 呼叫失敗，請檢查網路連線或後端服務。", "error");
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
        btnElement.classList.replace('bg-indigo-600', 'bg-gray-200');
        btnElement.classList.replace('text-white', 'text-gray-600');
    });

    // 3. 顯示新頁籤並新增 active 類別
    const newTabElement = document.getElementById(subTabId);
    newTabElement.style.display = 'block'; // 顯示內容

    // 4. 設定新頁籤按鈕的選中狀態
    const newBtnElement = document.getElementById(`tab - ${ subTabId.replace('-view', '-btn') } `);
    newBtnElement.classList.replace('bg-gray-200', 'bg-indigo-600');
    newBtnElement.classList.replace('text-gray-600', 'text-white');

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
// #region 6. 管理員月薪摘要收折邏輯
// ===================================
/**
 * 設置管理員月薪摘要的收合/展開功能。
 */
function setupAdminSalaryToggle() {
    const btn = document.getElementById('toggle-admin-salary-btn');
    const panel = document.getElementById('admin-monthly-salary-display');
    if (!btn || !panel) return;

    // 初始化狀態（預設收折）
    panel.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '顯示月薪摘要 ▼';

    btn.addEventListener('click', () => {
        const isHidden = panel.style.display === 'none' || panel.style.display === '';
        panel.style.display = isHidden ? 'block' : 'none';
        btn.setAttribute('aria-expanded', String(isHidden));
        btn.textContent = isHidden ? '隱藏月薪摘要 ▲' : '顯示月薪摘要 ▼';
    });
}
/**
 * 設置管理員匯出月曆為 Excel 的功能
 */
/**
 * 生成薪資明細表 Sheet 的數據行
 * @param {Array} summaryRows - 日摘要的行數據
 * @param {number} baseMonthly - 基本月薪
 * @param {number} hourlyRate - 時薪
 * @param {object} employeeInfo - 員工信息
 * @param {string} year - 年度
 * @param {string} month - 月份
 * @returns {Array} 薪資明細表的所有行數據
 */
function generatePayrollSheet(summaryRows, baseMonthly, hourlyRate, employeeInfo, year, month) {
    const sheetRows = [];

    // 第一部分：員工基本信息
    sheetRows.push(['', employeeInfo?.name || '']);
    sheetRows.push([year + '年', '', '', '']);
    sheetRows.push([month + '月', '', '', '']);
    sheetRows.push(['本薪', baseMonthly, '', '']);

    // 空行分隔
    sheetRows.push([]);

    // 第二部分：日期明細區
    // 🔧 更新：新的 summaryRows 結構包含22列（增加日期類型和9種加班分類）
    // [日期, 星期, 日期類型, 上班時間, 上班地點, 下班時間, 下班地點,
    //  原始時數, 淨工時, 休息扣除, 正常工時,
    //  平日2H以內, 平日3~4H以上, 休息日2H以內, 休息日3~8H, 休息日9H以上,
    //  例假日8H以內, 例假日8H以上, 國定假日9~10H, 國定假日11~12H以上,
    //  日薪, 備註]
    sheetRows.push(['例', '日', '年月日', '上班', '下班', '', '加班時數']);

    // 遍歷summaryRows，添加日期明細（跳過標題行）
    // 新增：收集各類加班時數用於計算加班費
    const overtimeByCategory = {
        '平日2H以內': { hours: 0, rate: 1.34 },
        '平日3~4H以上': { hours: 0, rate: 1.67 },
        '休息日2H以內': { hours: 0, rate: 1.34 },
        '休息日3~8H': { hours: 0, rate: 1.67 },
        '休息日9H以上': { hours: 0, rate: 2.67 },
        '例假日8H以內': { hours: 0, rate: 1.0 },
        '例假日8H以上': { hours: 0, rate: 2.0 },
        '國定假日9~10H': { hours: 0, rate: 1.34 },
        '國定假日11~12H以上': { hours: 0, rate: 1.67 }
    };

    summaryRows.slice(1).forEach(row => {
        if (row.length === 0 || !row[0]) return; // 跳過空行和沒有日期的行

        const dateStr = row[0]; // 日期 (YYYY-MM-DD)
        const weekday = row[1]; // 星期
        const dateType = row[2]; // 日期類型
        const inTime = row[3]; // 上班時間
        const outTime = row[5]; // 下班時間

        // 確保使用正確的時間格式（保持為字符串，直接來自summaryRows，避免Date解析時區問題）
        const inTimeStr = typeof inTime === 'string' ? inTime : (inTime ? String(inTime) : '');
        const outTimeStr = typeof outTime === 'string' ? outTime : (outTime ? String(outTime) : '');

        // 只添加有打卡記錄的日期
        if (inTimeStr || outTimeStr) {
            sheetRows.push([
                dateType || '',  // 例休
                weekday,         // 日期星期
                dateStr,         // 日期
                inTimeStr,       // 上班時間
                outTimeStr,      // 下班時間
                '',              // 空
                ''               // 加班時數（這裡不再使用簡單的總數）
            ]);
        }

        // 🔧 新增：收集各類加班時數
        if (row.length >= 20) {
            overtimeByCategory['平日2H以內'].hours += Number(row[11] || 0);
            overtimeByCategory['平日3~4H以上'].hours += Number(row[12] || 0);
            overtimeByCategory['休息日2H以內'].hours += Number(row[13] || 0);
            overtimeByCategory['休息日3~8H'].hours += Number(row[14] || 0);
            overtimeByCategory['休息日9H以上'].hours += Number(row[15] || 0);
            overtimeByCategory['例假日8H以內'].hours += Number(row[16] || 0);
            overtimeByCategory['例假日8H以上'].hours += Number(row[17] || 0);
            overtimeByCategory['國定假日9~10H'].hours += Number(row[18] || 0);
            overtimeByCategory['國定假日11~12H以上'].hours += Number(row[19] || 0);
        }
    });

    // 空行分隔
    sheetRows.push([]);

    // 第三部分：應發項目區
    sheetRows.push(['', '應發項目']);
    sheetRows.push(['', '項目', '金額', '加班別', '', '倍率', '時數', '加班費']);
    sheetRows.push(['', '本薪', baseMonthly]);

    // 🔧 改進：按各類加班費率計算加班費
    let totalOvertimeFee = 0;
    for (const [category, data] of Object.entries(overtimeByCategory)) {
        if (data.hours > 0) {
            const fee = data.hours * hourlyRate * data.rate;
            totalOvertimeFee += fee;
            // 可選：添加詳細的加班費行（如需要在 Excel 中顯示）
            // sheetRows.push(['', category, Number(fee.toFixed(0)), '', '', data.rate, data.hours]);
        }
    }

    if (totalOvertimeFee > 0) {
        sheetRows.push(['', '加班費', Number(totalOvertimeFee.toFixed(0))]);
    }

    const totalIncome = baseMonthly + Number(totalOvertimeFee.toFixed(0));
    sheetRows.push(['', '合計', totalIncome]);

    // 空行分隔
    sheetRows.push([]);

    // 第四部分：應扣金額區
    sheetRows.push(['', '應扣金額']);
    sheetRows.push(['', '項目', '金額']);

    const leaveInsuranceLevel = String(employeeInfo?.leaveInsurance || '第2級').trim();
    const healthInsuranceLevel = String(employeeInfo?.healthInsurance || '第2級').trim();
    const laborInsuranceFee = totalIncome * (INSURANCE_RATES["勞保"][leaveInsuranceLevel] || 0.0225);
    const healthInsuranceFee = totalIncome * (INSURANCE_RATES["健保"][healthInsuranceLevel] || 0.0130);
    const housingExpense = employeeInfo?.housingExpense || 1000;
    const incomeTax = totalIncome * 0.06;

    sheetRows.push(['', '勞保費', Number(laborInsuranceFee.toFixed(0)), '', '', '', '', '']);
    sheetRows.push(['', '健保費', Number(healthInsuranceFee.toFixed(0))]);
    sheetRows.push(['', '住宿', housingExpense]);
    sheetRows.push(['', '所得稅', Number(incomeTax.toFixed(0))]);

    const totalDeductions = Number(laborInsuranceFee.toFixed(0)) + Number(healthInsuranceFee.toFixed(0)) + housingExpense + Number(incomeTax.toFixed(0));
    sheetRows.push(['', '合計', -totalDeductions]);

    // 空行分隔
    sheetRows.push([]);

    // 第五部分：最終結算
    sheetRows.push(['', '小計', totalIncome]);
    sheetRows.push(['', '實支額', totalIncome - totalDeductions]);

    return sheetRows;
}

/**
 * 生成對齊「外籍薪資範例 Excel」版型的試算表資料
 * @param {Array} summaryRows - 日摘要的行數據
 * @param {number} baseMonthly - 基本月薪
 * @param {number} hourlyRate - 時薪
 * @param {object} employeeInfo - 員工資訊
 * @param {number} year - 西元年
 * @returns {Array} 範例版型工作表行資料
 */
function generateSamplePayrollFormatSheet(summaryRows, baseMonthly, hourlyRate, employeeInfo, year) {
    const rows = [];
    const rocYear = Number(year) - 1911;

    const normalizeSheetTime = (rawTime) => {
        if (!rawTime) return '休';
        if (typeof rawTime !== 'string') return String(rawTime);

        // 若已是 HH:MM，直接返回
        if (/^\d{1,2}:\d{2}$/.test(rawTime)) {
            return rawTime;
        }

        // 處理格式不標準的空白（將 "2026-02-01 06:31" 轉為 "2026-02-01T06:31" 讓 Date 好讀取）
        const standardFormat = rawTime.replace(' ', 'T');
        const dt = new Date(standardFormat);
        if (!isNaN(dt.getTime())) {
            const h = String(dt.getHours()).padStart(2, '0');
            const m = String(dt.getMinutes()).padStart(2, '0');
            return `${ h }:${ m } `;
        }

        if (rawTime.includes('T')) return rawTime.split('T')[1].substring(0, 5);
        if (rawTime.includes(' ')) return rawTime.split(' ')[1].substring(0, 5);
        return rawTime;
    };

    const categories = [
        { key: '平日2H以內', idx: 11, rate: 1.34, multiplierLabel: '1又1/3' },
        { key: '平日3~4H以上', idx: 12, rate: 1.67, multiplierLabel: '1又2/3' },
        { key: '休息日2H以內', idx: 13, rate: 1.34, multiplierLabel: '1又1/3' },
        { key: '休息日3~8H', idx: 14, rate: 1.67, multiplierLabel: '1又2/3' },
        { key: '休息日9H以上', idx: 15, rate: 2.67, multiplierLabel: '2又2/3' },
        { key: '例假日8H以內', idx: 16, rate: 1.0, multiplierLabel: '1' },
        { key: '例假日8H以上', idx: 17, rate: 2.0, multiplierLabel: '2' },
        { key: '國定假日9~10H', idx: 18, rate: 1.34, multiplierLabel: '1又1/3' },
        { key: '國定假日11~12H以上', idx: 19, rate: 1.67, multiplierLabel: '1又2/3' }
    ];

    const categoryTotals = {};
    categories.forEach(c => {
        categoryTotals[c.key] = 0;
    });

    let totalEffectiveHours = 0;
    let workedRegularOffDays = 0;
    let workedHolidayDays = 0;

    rows.push([
        '',
        employeeInfo?.name || '',
        `${ rocYear } 年`,
        '上班',
        '下班',
        '上班',
        '下班',
        '加班時數',
        '平日2H以內',
        '平日3~4H以上',
        '休息日2H以內',
        '休息日3~8H',
        '休息日9H以上',
        '例假日8H以內',
        '例假日8H以上',
        '國定假日9~10H',
        '國定假日11~12H以上'
    ]);

    summaryRows.slice(1).forEach(row => {
        if (!row || !row[0]) return;

        const dateStr = String(row[0] || '');
        const parts = dateStr.split('-');
        const md = parts.length === 3 ? `${ Number(parts[1]) }/${Number(parts[2])}` : dateStr;

    const rawDayType = String(row[2] || '');
    const dayType = rawDayType === '國' ? '國定假日' : rawDayType;
    const weekday = String(row[1] || '').replace('週', '');
    const inTime = normalizeSheetTime(row[3]);
    const outTime = normalizeSheetTime(row[5]);
    const effectiveHours = Number(row[8] || 0);

    const categoryValues = categories.map(c => {
        const v = Number(row[c.idx] || 0);
        categoryTotals[c.key] += v;
        return Number(v.toFixed(2));
    });

    totalEffectiveHours += effectiveHours;
    if (rawDayType === '例' && effectiveHours > 0) workedRegularOffDays += 1;
    if (rawDayType === '國' && effectiveHours > 0) workedHolidayDays += 1;

    rows.push([
        dayType,
        weekday,
        md,
        inTime,
        outTime,
        '',
        '',
        Number(effectiveHours.toFixed(2)),
        ...categoryValues
    ]);
});

const overtimeHourValues = categories.map(c => Number(categoryTotals[c.key].toFixed(2)));
const overtimeRateValues = categories.map(c => Number((hourlyRate * c.rate).toFixed(0)));
const overtimeFeeValues = categories.map(c => Number((categoryTotals[c.key] * hourlyRate * c.rate).toFixed(0)));
const totalOvertimeHours = overtimeHourValues.reduce((sum, v) => sum + Number(v || 0), 0);
const totalOvertimeFee = overtimeFeeValues.reduce((sum, v) => sum + Number(v || 0), 0);

rows.push(['', '', '', '', '', '', Number(totalOvertimeHours.toFixed(2)), '加班時數', ...overtimeHourValues, Number(totalOvertimeHours.toFixed(2))]);
rows.push(['', '', '', '', '', '', '', '加班時薪', ...overtimeRateValues]);
rows.push(['', '', '', '', '', '', '', '加班費', ...overtimeFeeValues, Number(totalOvertimeFee.toFixed(0))]);
rows.push([]);
rows.push([]);

const regularOffAllowancePerDay = Number((hourlyRate * 8).toFixed(0));
const holidayAllowancePerDay = Number((hourlyRate * 8).toFixed(0));
const regularOffAllowance = workedRegularOffDays * regularOffAllowancePerDay;
const holidayAllowance = workedHolidayDays * holidayAllowancePerDay;

rows.push(['', '應發項目']);
rows.push(['', '項目', '金額', '加班別', '', '倍率', '時數', '加班費']);
rows.push(['', '本薪', Number(baseMonthly.toFixed(0)), '平日加班', '', categories[0].multiplierLabel, overtimeHourValues[0], overtimeFeeValues[0]]);
rows.push(['', `例假日補休折現${workedRegularOffDays}天`, regularOffAllowance, '', '', categories[1].multiplierLabel, overtimeHourValues[1], overtimeFeeValues[1]]);
rows.push(['', `國定假日${workedHolidayDays}天`, holidayAllowance, '休息日加班', '8小時以內', categories[2].multiplierLabel, overtimeHourValues[2], overtimeFeeValues[2]]);
rows.push(['', '', '', '', '', categories[3].multiplierLabel, overtimeHourValues[3], overtimeFeeValues[3]]);
rows.push(['', '', '', '', '逾8小時', categories[4].multiplierLabel, overtimeHourValues[4], overtimeFeeValues[4]]);
rows.push(['', '', '', '例假日出勤', '8小時以內', categories[5].multiplierLabel, overtimeHourValues[5], overtimeFeeValues[5]]);
rows.push(['', '', '', '', '逾8小時', categories[6].multiplierLabel, overtimeHourValues[6], overtimeFeeValues[6]]);
rows.push(['', '', '', '國定假日出勤', '9~10小時', categories[7].multiplierLabel, overtimeHourValues[7], overtimeFeeValues[7]]);
rows.push(['', '', '', '', '11~12小時', categories[8].multiplierLabel, overtimeHourValues[8], overtimeFeeValues[8]]);

const totalIncome = Number(baseMonthly.toFixed(0)) + regularOffAllowance + holidayAllowance + Number(totalOvertimeFee.toFixed(0));
rows.push(['', '合計', Number((Number(baseMonthly.toFixed(0)) + regularOffAllowance + holidayAllowance).toFixed(0)), '', '', '合計', '', Number(totalOvertimeFee.toFixed(0))]);
rows.push([]);
rows.push(['', '應扣金額', '', '', '', '', Number(totalIncome.toFixed(0))]);

const leaveInsuranceLevel = String(employeeInfo?.leaveInsurance || '第2級').trim();
const healthInsuranceLevel = String(employeeInfo?.healthInsurance || '第2級').trim();
const laborInsuranceFee = Number((totalIncome * (INSURANCE_RATES['勞保'][leaveInsuranceLevel] || 0.0225)).toFixed(0));
const healthInsuranceFee = Number((totalIncome * (INSURANCE_RATES['健保'][healthInsuranceLevel] || 0.0130)).toFixed(0));
const housingExpense = Number(employeeInfo?.housingExpense || 1000);
const incomeTax = Number((totalIncome * 0.06).toFixed(0));

rows.push(['', `勞保費29500`, '', -laborInsuranceFee]);
rows.push(['', `健保費29500`, '', -healthInsuranceFee]);
rows.push(['', '住宿', '', -housingExpense]);
rows.push(['', '所得稅', '', -incomeTax]);
rows.push([]);

const totalDeductions = laborInsuranceFee + healthInsuranceFee + housingExpense + incomeTax;
const netPay = totalIncome - totalDeductions;
rows.push(['', '合計', '', -totalDeductions]);
rows.push([]);
rows.push(['', '小計', '', netPay]);
rows.push(['', '實支額', '', netPay]);

return rows;
}

function setupAdminExport() {
    const btn = document.getElementById('export-admin-month-excel-btn');
    if (!btn) return;

    const pad = n => String(n).padStart(2, '0');

    function tryParseHoursFromTimes(inTime, outTime, dateStr) {
        // 保留舊的兼容性實作（仍可用）
        if (!inTime || !outTime) return null;
        try {
            const base = new Date(dateStr);
            if (isNaN(base.getTime())) base.setFullYear(new Date().getFullYear());
            const parse = t => {
                if (!t) return null;
                if (/^\d{1,2}:\d{2}$/.test(t)) {
                    const [hh, mm] = t.split(':').map(Number);
                    const d = new Date(base);
                    d.setHours(hh, mm, 0, 0);
                    return d;
                }
                const d = new Date(t);
                return isNaN(d.getTime()) ? null : d;
            };
            const a = parse(inTime);
            const b = parse(outTime);
            if (!a || !b) return null;
            const diffH = (b - a) / 3600000;
            return diffH >= 0 ? Number(diffH.toFixed(2)) : null;
        } catch (e) {
            return null;
        }
    }

    btn.addEventListener('click', async () => {
        const selectEl = document.getElementById('admin-select-employee') || document.getElementById('admin-select-employee-mgmt');
        const userId = selectEl && selectEl.value ? selectEl.value : (currentManagingEmployee && currentManagingEmployee.userId);
        if (!userId) {
            alert('請先選擇員工');
            return;
        }

        // 解析目前顯示的月份
        const monthText = (adminCurrentMonthDisplay && adminCurrentMonthDisplay.textContent) ? adminCurrentMonthDisplay.textContent.trim() : '';
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
        const { baseMonthly, hourlyRate } = resolveHourlyRateForExport();

        // 從後端直接取得所有該月份的打卡記錄（完整紀錄）
        try {
            const token = localStorage.getItem('sessionToken');

            const response = await callApifetch({
                action: 'getCompleteAttendanceRecords',
                month: monthParam,
                userId: userId,
                token: token
            });
            if (!response.ok) {
                alert('無法取得完整的打卡記錄');
                return;
            }

            // allRecords 是該月份該員工的所有打卡記錄
            const allRecords = Array.isArray(response.records) ? response.records : [];

            // Sheet 1: 所有完整打卡紀錄
            const completeRecordRows = [
                ['日期', '時間', '打卡類型', '地點', '備註', '審核狀態']
            ];

            // Sheet 2: 日摘要（用於薪資計算）
            const summaryRows = [
                ['日期', '星期', '日期類型', '上班時間', '上班地點', '下班時間', '下班地點',
                    '原始時數(小時)', '淨工時(小時)',
                    '休息扣除(小時)', '正常工時(小時)',
                    '平日2H以內', '平日3~4H以上',
                    '休息日2H以內', '休息日3~8H', '休息日9H以上',
                    '例假日8H以內', '例假日8H以上',
                    '國定假日9~10H', '國定假日11~12H以上',
                    '日薪(NTD)', '備註']
            ];

            const daysInMonth = new Date(year, month + 1, 0).getDate();

            // ===== 處理完整紀錄 =====
            allRecords.forEach(record => {
                if (!record.date) return;

                const dateStr = normalizeDateKey(record.date);
                if (!dateStr) return;

                // 提取時間字串（處理各種日期格式）
                let timeStr = '';
                let dateObj = null;

                if (typeof record.date === 'string') {
                    // 處理格式不標準的空白（將 "2026-02-01 06:31" 轉為 "2026-02-01T06:31" 讓 Date 好讀取）
                    const standardFormat = record.date.replace(' ', 'T');
                    dateObj = new Date(standardFormat);
                } else if (record.date instanceof Date) {
                    dateObj = record.date;
                }

                if (dateObj && !isNaN(dateObj.getTime())) {
                    // 使用 getHours() 會根據使用者電腦的時區顯示
                    const h = String(dateObj.getHours()).padStart(2, '0');
                    const m = String(dateObj.getMinutes()).padStart(2, '0');
                    timeStr = `${h}:${m}`;
                }

                const punchType = record.type || '未知';
                const location = record.location || '';
                const recordNote = record.note || '';
                const auditStatus = record.audit === '?' ? '審核中' : (record.audit === 'v' ? '已批准' : (record.audit === 'x' ? '已拒絕' : ''));

                completeRecordRows.push([
                    dateStr,
                    timeStr,
                    punchType,
                    location,
                    recordNote,
                    auditStatus
                ]);
            });

            // ===== 處理日摘要（含薪資計算）=====
            let totalHours = 0, totalRawHours = 0, totalBreakMinutes = 0, totalSalary = 0;
            let totalNormalHours = 0, totalOvertimeHours = 0;

            // 根據日期分組打卡記錄
            const dailyGroupMap = {};
            allRecords.forEach(record => {
                if (!record.date) return;
                const dateKey = normalizeDateKey(record.date);
                if (!dateKey) return;
                if (!dailyGroupMap[dateKey]) {
                    dailyGroupMap[dateKey] = [];
                }
                dailyGroupMap[dateKey].push(record);
            });

            // 由月曆快取建立國定假日日期集合，避免無打卡日無法判斷日期類型
            const monthCacheKey = `${userId}-${year}-${pad(month + 1)}`;
            let monthCacheRecords = (typeof adminMonthDataCache !== 'undefined' && adminMonthDataCache[monthCacheKey])
                ? adminMonthDataCache[monthCacheKey]
                : [];

            // 匯出時若該月快取不存在，主動補抓月摘要，避免國定假日（例如春節）漏判。
            if ((!Array.isArray(monthCacheRecords) || monthCacheRecords.length === 0) && typeof callApifetch === 'function') {
                try {
                    const monthSummaryRes = await callApifetch({
                        action: 'getCalendarSummary',
                        month: monthParam,
                        userId: userId
                    });
                    if (monthSummaryRes && monthSummaryRes.ok) {
                        monthCacheRecords = monthSummaryRes.records?.dailyStatus || [];
                        if (typeof cacheAdminMonthData === 'function') {
                            cacheAdminMonthData(monthCacheKey, monthCacheRecords);
                        } else if (typeof adminMonthDataCache !== 'undefined') {
                            adminMonthDataCache[monthCacheKey] = monthCacheRecords;
                        }
                    }
                } catch (e) {
                    console.warn('匯出時取得月份摘要失敗，改用既有資料判斷國定假日:', e?.message || e);
                }
            }

            const isNationalHolidayRecord = (r) => {
                if (!r) return false;
                if (r.isHoliday === true || r.holiday === true) return true;

                const rawHoliday = String(r.isHoliday ?? r.holiday ?? r.holidayType ?? r.dayType ?? '').toLowerCase();
                if (rawHoliday === 'true' || rawHoliday === '1') return true;

                const hint = `${r?.note || ''}${r?.type || ''}${r?.tag || ''}${r?.dayType || ''}${r?.holidayName || ''}${r?.holidayType || ''}`;
                return /國定假日|national\s*holiday|holiday|春節|農曆年|農曆新年|除夕/i.test(hint);
            };

            const isWeekendWorkdayRecord = (r) => {
                if (!r) return false;
                const hasHolidayField = Object.prototype.hasOwnProperty.call(r, 'isHoliday')
                    || Object.prototype.hasOwnProperty.call(r, 'holiday')
                    || Object.prototype.hasOwnProperty.call(r, 'is_holiday');
                const rawHoliday = r?.isHoliday ?? r?.holiday ?? r?.is_holiday;
                if (hasHolidayField && isExplicitNonHolidayValue(rawHoliday)) {
                    return true;
                }

                const hint = `${r?.note || ''}${r?.type || ''}${r?.tag || ''}${r?.dayType || ''}${r?.holidayName || ''}${r?.holidayType || ''}${r?.caption || ''}`;
                return /補班|補上班|make\s*up\s*work/i.test(hint);
            };

            const nationalHolidaySet = new Set(
                (Array.isArray(monthCacheRecords) ? monthCacheRecords : [])
                    .filter(isNationalHolidayRecord)
                    .map(r => normalizeDateKey(r?.date || r?.day || r?.workDate || r?.dateKey || ''))
                    .filter(Boolean)
            );

            const weekendWorkdaySet = new Set(
                (Array.isArray(monthCacheRecords) ? monthCacheRecords : [])
                    .filter(isWeekendWorkdayRecord)
                    .map(r => normalizeDateKey(r?.date || r?.day || r?.workDate || r?.dateKey || ''))
                    .filter(Boolean)
            );

            // 遍歷該月份的每一天
            for (let d = 1; d <= daysInMonth; d++) {
                const dateKey = `${year}-${pad(month + 1)}-${pad(d)}`;
                const dateObj = new Date(year, month, d);
                const weekday = dateObj.toLocaleDateString(currentLang || 'zh-TW', { weekday: 'short' });

                const dayRecords = dailyGroupMap[dateKey] || [];

                // 挑出上班和下班記錄
                const inRecord = dayRecords.find(r => /上班|IN|in/i.test(String(r.type || '')));
                const outRecord = dayRecords.find(r => /下班|OUT|out/i.test(String(r.type || '')));

                // 補打卡或請假記錄
                const specialRecord = dayRecords.find(r => /補打卡|系統請假記錄/i.test(String(r.note || '')));

                // 提取時間的輔助函式：統一走本地時區，避免與完整打卡紀錄出現 8 小時差
                const extractTime = (dateVal) => {
                    if (!dateVal) return '';

                    const formatLocalHM = (dt) => {
                        const h = String(dt.getHours()).padStart(2, '0');
                        const m = String(dt.getMinutes()).padStart(2, '0');
                        return `${h}:${m}`;
                    };

                    if (dateVal instanceof Date) {
                        return isNaN(dateVal.getTime()) ? '' : formatLocalHM(dateVal);
                    }

                    if (typeof dateVal === 'string') {
                        const normalized = dateVal.includes(' ') ? dateVal.replace(' ', 'T') : dateVal;
                        const parsed = new Date(normalized);
                        if (!isNaN(parsed.getTime())) {
                            return formatLocalHM(parsed);
                        }

                        // 無法被 Date 正確解析時，退回字串提取（例如僅 HH:MM）
                        if (/^\d{1,2}:\d{2}/.test(dateVal)) {
                            return dateVal.substring(0, 5);
                        }
                        if (dateVal.includes('T')) {
                            return dateVal.split('T')[1].substring(0, 5);
                        }
                        if (dateVal.includes(' ')) {
                            return dateVal.split(' ')[1].substring(0, 5);
                        }
                    }

                    return '';
                };

                const inTime = inRecord ? extractTime(inRecord.date) : '';
                const inLoc = inRecord?.location || '';

                const outTime = outRecord ? extractTime(outRecord.date) : '';
                const outLoc = outRecord?.location || '';

                // 計算工時
                const dayOfWeek = dateObj.getDay();
                const isNationalHoliday = nationalHolidaySet.has(dateKey) || dayRecords.some(isNationalHolidayRecord);
                const isWeekendWorkday = weekendWorkdaySet.has(dateKey) || dayRecords.some(isWeekendWorkdayRecord);
                const dayType = determineDayType(dayOfWeek, isNationalHoliday, isWeekendWorkday);

                let rawHours = 0, effectiveHours = 0, breakMinutes = 0, dailySalary = 0;
                let normalHours = 0, overtimeHours = 0, restHours = 0;

                if (inTime && outTime && typeof calculateDailySalaryFromPunches === 'function') {
                    const res = calculateDailySalaryFromPunches(inTime, outTime, hourlyRate, dayType);
                    rawHours = computeRawHoursFromPunches({ time: inTime }, { time: outTime }, dateKey) || 0;
                    effectiveHours = Number(res.effectiveHours || 0);
                    breakMinutes = Number(res.totalBreakMinutes || 0);
                    dailySalary = Number(res.dailySalary || 0);
                    if (res.laborHoursDetails) {
                        normalHours = Number(res.laborHoursDetails.normalHours || 0);
                        overtimeHours = Number(res.laborHoursDetails.overtimeHours || 0);
                        restHours = Number(res.laborHoursDetails.restHours || 0);
                    }
                } else if (inTime && outTime) {
                    rawHours = computeRawHoursFromPunches({ time: inTime }, { time: outTime }, dateKey) || 0;
                    effectiveHours = rawHours;
                    if (typeof calculateDailySalary === 'function') {
                        const rcalc = calculateDailySalary(effectiveHours, hourlyRate, dayType);
                        dailySalary = rcalc?.dailySalary ? Number(rcalc.dailySalary) : (effectiveHours * hourlyRate);
                    } else {
                        dailySalary = effectiveHours * hourlyRate;
                    }
                }

                const remark = specialRecord ? (specialRecord.note || specialRecord.audit) : '';

                // 🔧 新增：計算日期類型字符串和加班分類
                let dateTypeStr = '';
                switch (dayType) {
                    case DAY_TYPE.REGULAR_OFF:
                        dateTypeStr = '例';
                        break;
                    case DAY_TYPE.REST_DAY:
                        dateTypeStr = '休';
                        break;
                    case DAY_TYPE.HOLIDAY:
                        dateTypeStr = '國';
                        break;
                    default:
                        dateTypeStr = '';
                }

                // 計算9種加班分類
                const overtimeDetails = classifyOvertimeHours(effectiveHours, dayType, false);

                summaryRows.push([
                    dateKey, weekday, dateTypeStr, inTime, inLoc, outTime, outLoc,
                    Number(rawHours.toFixed(2)),
                    Number(effectiveHours.toFixed(2)),
                    Number((breakMinutes / 60).toFixed(2)),
                    Number(normalHours.toFixed(2)),
                    // 9種加班分類
                    Number((overtimeDetails["平日2H以內"] || 0).toFixed(2)),
                    Number((overtimeDetails["平日3~4H以上"] || 0).toFixed(2)),
                    Number((overtimeDetails["休息日2H以內"] || 0).toFixed(2)),
                    Number((overtimeDetails["休息日3~8H"] || 0).toFixed(2)),
                    Number((overtimeDetails["休息日9H以上"] || 0).toFixed(2)),
                    Number((overtimeDetails["例假日8H以內"] || 0).toFixed(2)),
                    Number((overtimeDetails["例假日8H以上"] || 0).toFixed(2)),
                    Number((overtimeDetails["國定假日9~10H"] || 0).toFixed(2)),
                    Number((overtimeDetails["國定假日11~12H以上"] || 0).toFixed(2)),
                    Number(dailySalary.toFixed(2)),
                    remark
                ]);

                totalRawHours += Number(rawHours || 0);
                totalHours += Number(effectiveHours || 0);
                totalBreakMinutes += Number(breakMinutes || 0);
                totalSalary += Number(dailySalary || 0);
                totalNormalHours += normalHours;
                totalOvertimeHours += overtimeHours;
            }

            // 生成「範例 Excel 格式」工作表
            const samplePayrollSheetRows = generateSamplePayrollFormatSheet(summaryRows, baseMonthly, hourlyRate, currentManagingEmployee, year);

            try {
                const ws1 = XLSX.utils.aoa_to_sheet(completeRecordRows);
                const ws2 = XLSX.utils.aoa_to_sheet(samplePayrollSheetRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws1, '完整打卡紀錄');
                XLSX.utils.book_append_sheet(wb, ws2, '薪資明細(範例格式)');
                const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                const blob = new Blob([wbout], { type: 'application/octet-stream' });

                // 檔名使用員工姓名或 userId（簡單過濾）
                let employeeName = (currentManagingEmployee && currentManagingEmployee.name) || '';
                if (!employeeName && Array.isArray(allEmployeeList)) {
                    const found = allEmployeeList.find(e => e.userId === userId);
                    if (found) employeeName = found.name || '';
                }
                if (!employeeName) employeeName = userId ? userId.slice(0, 8) : 'unknown';
                employeeName = String(employeeName).replace(/[\/\\:\*\?"<>\|]/g, '').replace(/\s+/g, '_');

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
                alert('匯出失敗，請看 console 取得詳細錯誤訊息。');
            }
        } catch (err) {
            console.error('取得打卡記錄失敗', err);
            alert('無法取得打卡記錄，請重試。');
        }
    });
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

/**
 * 從 record 物件取出打卡陣列 (容錯)
 */
function getPunchesFromRecord(r) {
    if (!r) return [];
    if (Array.isArray(r.record)) return r.record;
    if (Array.isArray(r.punches)) return r.punches;
    if (Array.isArray(r.dailyPunches)) return r.dailyPunches;
    if (Array.isArray(r.records)) return r.records;
    return [];
}

/**
 * 從 punches 陣列挑出最合理的上班(第一個 IN)與下班(最後一個 OUT)
 * @param {Array} punches
 * @returns {{inPunch:object|null, outPunch:object|null}}
 */
function pickInOutPunches(punches) {
    let inPunch = null, outPunch = null;
    if (!Array.isArray(punches) || punches.length === 0) return { inPunch, outPunch };

    const isInType = t => /上班|上班打卡|IN|in|clock_in|checkin|start/i.test(String(t || ''));
    const isOutType = t => /下班|下班打卡|OUT|out|clock_out|checkout|end|finish/i.test(String(t || ''));

    for (let i = 0; i < punches.length; i++) {
        const p = punches[i];
        if (!inPunch && (isInType(p.type || p.label || p.tag) || isInType(p.mode || p.action))) inPunch = p;
    }
    for (let i = punches.length - 1; i >= 0; i--) {
        const p = punches[i];
        if (!outPunch && (isOutType(p.type || p.label || p.tag) || isOutType(p.mode || p.action))) outPunch = p;
    }
    if (!inPunch) inPunch = punches[0];
    if (!outPunch) outPunch = punches[punches.length - 1];
    return { inPunch, outPunch };
}

/**
 * 將時間字串（HH:MM 或 ISO）轉為當日 Date（使用 dateKey 作 base）
 */
function parseTimeToDate(timeStr, dateKey) {
    if (!timeStr) return null;
    // 如果是 HH:MM
    const hm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (hm && dateKey) {
        const [y, m, d] = dateKey.split('-').map(Number);
        const dt = new Date(y, m - 1, d, Number(hm[1]), Number(hm[2]), 0, 0);
        return dt;
    }
    // 嘗試直接解析
    const dt2 = new Date(timeStr);
    return isNaN(dt2.getTime()) ? null : dt2;
}

/**
 * 由 in/out 打卡物件與 dateKey 計算原始時數 (小時，保留兩位)
 */
function computeRawHoursFromPunches(inPunch, outPunch, dateKey) {
    const inTimeStr = inPunch && (inPunch.time || inPunch.timeString || inPunch.clockTime || inPunch.t || inPunch.ts) || '';
    const outTimeStr = outPunch && (outPunch.time || outPunch.timeString || outPunch.clockTime || outPunch.t || outPunch.ts) || '';
    const a = parseTimeToDate(inTimeStr, dateKey);
    const b = parseTimeToDate(outTimeStr, dateKey);
    if (!a || !b) return 0;
    const diff = (b - a) / 3600000;
    return diff >= 0 ? Number(diff.toFixed(2)) : 0;
}

/**
 * 取得時薪（優先 employee.salary，次優 UI 輸入，否則回預設）
 */
function resolveHourlyRateForExport() {
    const empSalary = (currentManagingEmployee && Number(currentManagingEmployee.salary)) || 0;
    const basicSalaryInputEl = document.getElementById('basic-salary') || document.getElementById('basicSalary') || null;
    const inputSalary = basicSalaryInputEl ? Number(basicSalaryInputEl.value || 0) : 0;
    const base = empSalary || inputSalary || 28950;
    const standardMonthHours = 240;
    return { baseMonthly: base, hourlyRate: base > 0 ? (base / standardMonthHours) : 0 };
}
// #endregion
// ===================================
