/**
 * 勞基法工時計算 lib
 *
 * 把 dailyStatus 單筆補上勞基法分段工時：
 *   - 平日：normal / ot1 (1.34×) / ot2 (1.67×)
 *   - 休息日：rest_ot1 / rest_ot2 / rest_ot3 (2.67×)
 *   - 國定假日：public_base (保證 8h) / public_ot1 / public_ot2
 *   - 例假日：regular_base / regular_comp (補休折現) / regular_ot (×2)
 *
 * 規則對齊：docs/rules/薪資與加班計算規則整理.md
 *
 * 需求：
 *   - window.getDayKind(dateKey)  ← holidays-client.js
 *   - breakTimes 由呼叫方傳入（getBreakTimes API 結果）
 *
 * 純前端、無外部依賴（除 window.getDayKind）。
 */

const STANDARD_HOURS = 8;

/**
 * 'HH:MM' → 分鐘
 */
function _toMinutes(hhmm) {
    if (!hhmm) return null;
    const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 計算 [aStart, aEnd] 與 [bStart, bEnd] 兩個區間（分鐘）的重疊分鐘數
 */
function _overlapMinutes(aStart, aEnd, bStart, bEnd) {
    const lo = Math.max(aStart, bStart);
    const hi = Math.min(aEnd, bEnd);
    return Math.max(0, hi - lo);
}

/**
 * 從上下班時間 + breakTimes 計算總工時與淨工時（小時）
 *
 * @param {string} inTime   'HH:MM'
 * @param {string} outTime  'HH:MM'
 * @param {Array<{start,end}>} breakTimes
 * @returns {{ gross: number, net: number }}
 */
function calcWorkHours(inTime, outTime, breakTimes) {
    const inMin = _toMinutes(inTime);
    const outMin = _toMinutes(outTime);
    if (inMin == null || outMin == null) return { gross: 0, net: 0 };
    if (outMin <= inMin) return { gross: 0, net: 0 };

    const grossMin = outMin - inMin;
    let breakMin = 0;
    for (const b of (breakTimes || [])) {
        const bs = _toMinutes(b.start);
        const be = _toMinutes(b.end);
        if (bs == null || be == null || be <= bs) continue;
        breakMin += _overlapMinutes(inMin, outMin, bs, be);
    }
    const netMin = Math.max(0, grossMin - breakMin);
    return {
        gross: Math.round((grossMin / 60) * 100) / 100,
        net: Math.round((netMin / 60) * 100) / 100,
    };
}

/**
 * 將單日 dailyStatus 補上勞基法分段工時
 *
 * @param {Object} day            dailyStatus 元素（含 date / punchInTime / punchOutTime / hours / record）
 * @param {Array} breakTimes      [{ name, start, end }]
 * @returns {Object} enriched day = day + { laborStats: {...} }
 */
function enrichDayWithLaborStats(day, breakTimes) {
    if (!day || !day.date) return day;

    // 取得日期類型（依 holidays-client.getDayKind）
    let kind = 'workday';
    if (typeof window !== 'undefined' && typeof window.getDayKind === 'function') {
        const info = window.getDayKind(day.date);
        kind = info?.kind || 'workday';
    } else {
        // 退路：純粹依星期判斷
        const [y, m, d] = day.date.split('-').map(Number);
        const dow = new Date(y, m - 1, d).getDay();
        if (dow === 0) kind = 'regular';
        else if (dow === 6) kind = 'rest';
    }

    // 計算淨工時
    const { gross, net } = calcWorkHours(day.punchInTime, day.punchOutTime, breakTimes);

    // 各段預設 0
    const stats = {
        kind,
        gross,
        net,
        // 平日
        normal: 0, ot1: 0, ot2: 0,
        // 休息日
        rest_ot1: 0, rest_ot2: 0, rest_ot3: 0,
        // 國定假日
        public_base: 0, public_ot1: 0, public_ot2: 0,
        // 例假日
        regular_base: 0, regular_comp: 0, regular_ot: 0,
        // 衍生：「等價時數」（各段 × 倍率合計），用於估算工資
        equivalentHours: 0,
    };

    if (net <= 0 && kind !== 'public' && kind !== 'regular') {
        // 沒實際打卡，且非國定/例假日（後者只要當日是該類型，就算保證 8h?
        // 依規則 4.3/4.4：要「出勤」才有給；沒打卡→不給
        return { ...day, laborStats: stats };
    }

    if (kind === 'workday') {
        stats.normal = Math.min(net, STANDARD_HOURS);
        stats.ot1 = Math.min(Math.max(net - STANDARD_HOURS, 0), 2);
        stats.ot2 = Math.max(net - STANDARD_HOURS - 2, 0);
        stats.equivalentHours = stats.normal * 1.0 + stats.ot1 * (4 / 3) + stats.ot2 * (5 / 3);
    } else if (kind === 'rest') {
        // 休息日：全部時數視為加班，3 段倍率
        stats.rest_ot1 = Math.min(net, 2);
        stats.rest_ot2 = Math.min(Math.max(net - 2, 0), 6);
        stats.rest_ot3 = Math.min(Math.max(net - 8, 0), 4); // 最多 12 小時
        stats.equivalentHours = stats.rest_ot1 * (4 / 3) + stats.rest_ot2 * (5 / 3) + stats.rest_ot3 * (8 / 3);
    } else if (kind === 'public') {
        // 國定假日：出勤即至少給 8h（保證），超過分段
        if (net > 0) {
            stats.public_base = STANDARD_HOURS; // 8h 保證
            stats.public_ot1 = Math.min(Math.max(net - STANDARD_HOURS, 0), 2);
            stats.public_ot2 = Math.max(net - STANDARD_HOURS - 2, 0);
            stats.equivalentHours = stats.public_base + stats.public_ot1 * (4 / 3) + stats.public_ot2 * (5 / 3);
        }
    } else if (kind === 'regular') {
        // 例假日：出勤即 1 日工資 + 補休折現
        if (net > 0) {
            stats.regular_base = STANDARD_HOURS;     // 8h
            stats.regular_comp = STANDARD_HOURS;     // 補休折現 8h
            stats.regular_ot = Math.max(net - STANDARD_HOURS, 0) * 2; // 超 8h × 2 倍
            stats.equivalentHours = stats.regular_base + stats.regular_comp + stats.regular_ot;
        }
    }

    // 四捨五入到小數第 2 位
    Object.keys(stats).forEach((k) => {
        if (typeof stats[k] === 'number') stats[k] = Math.round(stats[k] * 100) / 100;
    });

    return { ...day, laborStats: stats };
}

/**
 * 累計多日 → 月度 KPI
 *
 * @param {Array} enrichedDays
 * @returns {Object} 各段時數合計
 */
function aggregateMonthLaborStats(enrichedDays) {
    const sum = {
        gross: 0, net: 0,
        normal: 0, ot1: 0, ot2: 0,
        rest_ot1: 0, rest_ot2: 0, rest_ot3: 0,
        public_base: 0, public_ot1: 0, public_ot2: 0,
        regular_base: 0, regular_comp: 0, regular_ot: 0,
        equivalentHours: 0,
    };
    (enrichedDays || []).forEach((day) => {
        const s = day && day.laborStats;
        if (!s) return;
        Object.keys(sum).forEach((k) => {
            sum[k] += Number(s[k] || 0);
        });
    });
    Object.keys(sum).forEach((k) => { sum[k] = Math.round(sum[k] * 100) / 100; });
    return sum;
}

// ============================================================
// 月薪 / 時薪 換算（勞基法施行細則第 31 條：÷ 30 ÷ 8 = ÷ 240）
// ============================================================

/**
 * 月薪換算時薪（勞基法施行細則第 31 條）
 */
function monthlyToHourly(monthlySalary) {
    return Math.round((Number(monthlySalary) || 0) / 240);
}

// ============================================================
// 勞保投保薪資分級表（2026 年）
// 資料來源：勞動部勞工保險局公告
// 每年 1/1 可能調整，更新時請改下面陣列並更新 LABOR_RATES_YEAR
// ============================================================

const LABOR_RATES_YEAR = 2026;

const LABOR_INSURANCE_GRADES = [
    { grade: 1, salary: 28590 },   // 基本工資
    { grade: 2, salary: 30300 },
    { grade: 3, salary: 31800 },
    { grade: 4, salary: 33300 },
    { grade: 5, salary: 34800 },
    { grade: 6, salary: 36300 },
    { grade: 7, salary: 38200 },
    { grade: 8, salary: 40100 },
    { grade: 9, salary: 42000 },
    { grade: 10, salary: 43900 },
    { grade: 11, salary: 45800 },
    { grade: 12, salary: 48200 },
    { grade: 13, salary: 50600 },
    { grade: 14, salary: 53000 },
    { grade: 15, salary: 55400 },
    { grade: 16, salary: 57800 },
    { grade: 17, salary: 60800 },
    { grade: 18, salary: 63800 },
    { grade: 19, salary: 66800 },
    { grade: 20, salary: 69800 },
    { grade: 21, salary: 72800 },
    { grade: 22, salary: 76500 },
    { grade: 23, salary: 80200 }, // 最高級
];

/**
 * 依月薪自動推算勞保投保等級
 * @returns {{ grade, salary }} 等級代碼 + 該等級的月投保薪資
 */
function inferGradeFromSalary(monthlySalary) {
    const s = Number(monthlySalary) || 0;
    if (s <= 0) return LABOR_INSURANCE_GRADES[0];
    for (const g of LABOR_INSURANCE_GRADES) {
        if (s <= g.salary) return g;
    }
    return LABOR_INSURANCE_GRADES[LABOR_INSURANCE_GRADES.length - 1];
}

// ============================================================
// 員工自付費率（2026 年）
// ============================================================

const EMPLOYEE_CONTRIBUTION_RATES = {
    laborInsurance: 0.024,   // 勞保普通事故 12% × 員工 20% = 2.4%
    healthInsurance: 0.0155, // 健保 5.17% × 員工 30% ≈ 1.55%
    // 勞退自提率由員工自選 0~6%
};

/**
 * 計算員工自付月扣繳金額
 *
 * @param {number} insuredSalary    勞保月投保薪資（=該員工的等級薪資）
 * @param {number} pensionRate      勞退自提率 % (0~6)
 * @returns {{ labor, health, pension, total }} 各項扣繳金額
 */
function calcEmployeeDeductions(insuredSalary, pensionRate = 0) {
    const s = Number(insuredSalary) || 0;
    const p = Math.max(0, Math.min(6, Number(pensionRate) || 0));
    const labor = Math.round(s * EMPLOYEE_CONTRIBUTION_RATES.laborInsurance);
    const health = Math.round(s * EMPLOYEE_CONTRIBUTION_RATES.healthInsurance);
    const pension = Math.round(s * (p / 100));
    return { labor, health, pension, total: labor + health + pension };
}

// 暴露給瀏覽器全域
if (typeof window !== 'undefined') {
    window.calcWorkHours = calcWorkHours;
    window.enrichDayWithLaborStats = enrichDayWithLaborStats;
    window.aggregateMonthLaborStats = aggregateMonthLaborStats;
    window.monthlyToHourly = monthlyToHourly;
    window.LABOR_INSURANCE_GRADES = LABOR_INSURANCE_GRADES;
    window.inferGradeFromSalary = inferGradeFromSalary;
    window.calcEmployeeDeductions = calcEmployeeDeductions;
}

console.log('✓ labor-hours 模組已加載');

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calcWorkHours,
        enrichDayWithLaborStats,
        aggregateMonthLaborStats,
        monthlyToHourly,
        LABOR_INSURANCE_GRADES,
        inferGradeFromSalary,
        calcEmployeeDeductions,
        EMPLOYEE_CONTRIBUTION_RATES,
        LABOR_RATES_YEAR,
    };
}
