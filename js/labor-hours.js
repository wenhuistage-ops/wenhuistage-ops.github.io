/**
 * 勞基法工時計算 lib
 *
 * 把 dailyStatus 單筆補上勞基法分段工時：
 *   - 平日：normal / ot1 (1.34×) / ot2 (1.67×)
 *   - 休息日：rest_ot1 / rest_ot2 / rest_ot3 (2.67×)
 *   - 國定假日：public_base (保證 8h) / public_ot1 / public_ot2
 *   - 例假日：regular_base / regular_comp (補休折現) / regular_ot (實際時數，
 *           × 2 倍由 equivalentHours 與工資計算端處理)
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
 * 把當日 record 配對成「上下班班次區間」（支援一天多班）
 *
 * 規則：
 *   - 只取 上班/下班（容錯 IN/OUT），依時間排序
 *   - 上班 配 下一筆 下班為一班；連續上班取最早、連續下班取最晚
 *   - 缺上班或缺下班的殘段不回傳（calcWorkHours 對殘段本來就回 0）
 *
 * @param {Array} record day.record（[{ time:'HH:MM', type:'上班'|'下班' }]）
 * @returns {Array<{ inTime, outTime }>} 完整班次區間
 */
function _pairShiftRanges(record) {
    const isOut = (t) => /下班|OUT/i.test(t || '');
    const isIn = (t) => !isOut(t) && /上班|IN/i.test(t || '');
    // 工時只計「已核准」的補打卡：未核准（'?'）或已拒絕（'x'）的補打卡不得灌薪資工時
    // （與後端 _attendance.js summarizeByDay 同一規則）。
    const countable = (r) => !r || r.adjustmentType !== '補打卡' || r.audit === 'v';
    const arr = (record || [])
        .filter((r) => r && r.time && countable(r) && (isIn(r.type) || isOut(r.type)))
        .map((r) => ({ time: String(r.time), out: isOut(r.type) }))
        .sort((a, b) => a.time.localeCompare(b.time));

    const ranges = [];
    let pendingIn = null;
    for (const r of arr) {
        if (!r.out) {
            // 連續上班：取最早（與後端 punchInTime 取「最早上班」一致）
            if (pendingIn == null) pendingIn = r.time;
        } else if (pendingIn != null) {
            ranges.push({ inTime: pendingIn, outTime: r.time });
            pendingIn = null;
        } else if (ranges.length > 0 && r.time > ranges[ranges.length - 1].outTime) {
            // 連續下班（先按下班又回去工作再補一筆）：取最晚，與後端 last-out 一致
            ranges[ranges.length - 1].outTime = r.time;
        }
    }
    return ranges;
}

/**
 * 依班次區間逐班計算工時加總（雙班 / 多班日專用）
 *
 * 與 calcWorkHours(首上班, 末下班) 的差異：班與班之間的空檔不計入工時，
 * 公司休息時段只扣「落在班次內」的部分。
 *
 * @returns {{ gross, net, shiftCount }|null} record 配不出完整班次時回 null（呼叫端 fallback）
 */
function calcWorkHoursFromShifts(record, breakTimes) {
    const ranges = _pairShiftRanges(record);
    if (!ranges.length) return null;
    let gross = 0;
    let net = 0;
    for (const rg of ranges) {
        const r = calcWorkHours(rg.inTime, rg.outTime, breakTimes);
        gross += r.gross;
        net += r.net;
    }
    return {
        gross: Math.round(gross * 100) / 100,
        net: Math.round(net * 100) / 100,
        shiftCount: ranges.length,
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
    // 2026-06-03：優先逐班計算（修雙班 bug — 舊版用 首上班→末下班 整段計算，
    // 班距空檔被誤算成工時，雙班日 net 灌水導致 Excel OT / 違法工時 / 工資全錯）
    // record 配不出完整班次（單缺卡 / 無 record 舊聚合 doc）時 fallback 回整段法
    const fromShifts = Array.isArray(day.record) && day.record.length > 0
        ? calcWorkHoursFromShifts(day.record, breakTimes)
        : null;
    const { gross, net } = fromShifts
        || calcWorkHours(day.punchInTime, day.punchOutTime, breakTimes);

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
        // 違法工時：勞基法 §32 §36 規定每日最多 12h（含加班），超過 12h 為違法
        // 系統仍按實際工時計薪，此欄位用於警告管理員「人為錯誤 or 真的超時」
        illegalHours: 0,
    };

    // M4「請假為準」：當日已核准請假/休假時，一律不計工時（避免請假與出勤雙重給付）。
    // 請假為整日單位，其給付另循請假規則，不在此列工時/加班。
    if (day.reason === 'STATUS_LEAVE_APPROVED' || day.reason === 'STATUS_VACATION_APPROVED') {
        stats.gross = 0;
        stats.net = 0;
        return { ...day, laborStats: stats };
    }

    if (net <= 0 && kind !== 'public' && kind !== 'regular') {
        // 沒實際打卡，且非國定/例假日（後者只要當日是該類型，就算保證 8h?
        // 依規則 4.3/4.4：要「出勤」才有給；沒打卡→不給
        return { ...day, laborStats: stats };
    }

    // 倍率：勞動部試算範例慣用小數 1.34 / 1.67 / 2.67（取小數兩位，對員工
    // 略有利約 0.5%），與台灣業界主流薪資單一致。
    if (kind === 'workday') {
        stats.normal = Math.min(net, STANDARD_HOURS);
        stats.ot1 = Math.min(Math.max(net - STANDARD_HOURS, 0), 2);
        stats.ot2 = Math.max(net - STANDARD_HOURS - 2, 0);
        stats.equivalentHours = stats.normal * 1.0 + stats.ot1 * 1.34 + stats.ot2 * 1.67;
    } else if (kind === 'rest') {
        // 休息日：全部時數視為加班，3 段倍率
        // ⚠️ 不 cap 在 12h——員工真的超時上班還是要付薪資。
        //    超過 12h 的部分會列入 illegalHours 警告管理員（員工亂打 or 真的超時）。
        stats.rest_ot1 = Math.min(net, 2);
        stats.rest_ot2 = Math.min(Math.max(net - 2, 0), 6);
        stats.rest_ot3 = Math.max(net - 8, 0); // 不再 cap，全部按 2.67 倍計算
        stats.equivalentHours = stats.rest_ot1 * 1.34 + stats.rest_ot2 * 1.67 + stats.rest_ot3 * 2.67;
    } else if (kind === 'public') {
        // 國定假日：出勤即至少給 8h（保證），超過分段
        if (net > 0) {
            stats.public_base = STANDARD_HOURS; // 8h 保證
            stats.public_ot1 = Math.min(Math.max(net - STANDARD_HOURS, 0), 2);
            stats.public_ot2 = Math.max(net - STANDARD_HOURS - 2, 0);
            stats.equivalentHours = stats.public_base + stats.public_ot1 * 1.34 + stats.public_ot2 * 1.67;
        }
    } else if (kind === 'regular') {
        // 例假日：出勤即 1 日工資 + 補休折現；regular_ot 存「實際時數」與其他段
        // 一致，× 2 倍由 equivalentHours 與工資計算端處理。
        if (net > 0) {
            stats.regular_base = STANDARD_HOURS;     // 8h
            stats.regular_comp = STANDARD_HOURS;     // 補休折現 8h
            stats.regular_ot = Math.max(net - STANDARD_HOURS, 0); // 超 8h 實際時數
            stats.equivalentHours = stats.regular_base + stats.regular_comp + stats.regular_ot * 2;
        }
    }

    // 違法工時警告（勞基法 §32：每日含加班最多 12h）
    // 不影響薪資計算，純粹給管理員看的紅旗。例假日因法律本就禁止出勤，
    // 任何 net > 0 都標違法（但若你實務上常排班例假日，可改為 max(net-12,0)）
    if (kind === 'regular') {
        stats.illegalHours = net; // 例假日出勤本身違法
    } else {
        stats.illegalHours = Math.max(net - 12, 0); // 其他日：> 12h 違法
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
        illegalHours: 0,        // 月度違法工時加總
        illegalDays: 0,         // 違法日數（不重複計算）
    };
    (enrichedDays || []).forEach((day) => {
        const s = day && day.laborStats;
        if (!s) return;
        Object.keys(sum).forEach((k) => {
            // illegalDays 不從 stats 累加；單獨計算
            if (k === 'illegalDays') return;
            sum[k] += Number(s[k] || 0);
        });
        if (Number(s.illegalHours || 0) > 0) sum.illegalDays += 1;
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

// 2026/01/01 起適用（勞動部 114.11.21 勞動保 2 字第 1140091863 號令發布）
// 來源 PDF：勞工保險普通事故保險費分擔金額表(自115年1月1日起適用)
// 共 11 級，第 1 級為基本工資 29,500 元，最高級 45,800 元
const LABOR_INSURANCE_GRADES = [
    { grade: 1, salary: 29500 },   // 基本工資（2026/01/01 起 29,500）
    { grade: 2, salary: 30300 },
    { grade: 3, salary: 31800 },
    { grade: 4, salary: 33300 },
    { grade: 5, salary: 34800 },
    { grade: 6, salary: 36300 },
    { grade: 7, salary: 38200 },
    { grade: 8, salary: 40100 },
    { grade: 9, salary: 42000 },
    { grade: 10, salary: 43900 },
    { grade: 11, salary: 45800 },  // 最高級
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
// 員工自付費率（2026 年起適用）
//
// ⚠️ 維護指引：政府每年元旦前公告新費率／新級距，請手動檢查並更新：
//   勞保：https://www.bli.gov.tw/0005475.html （勞保局 - 投保薪資分級表）
//   健保：https://www.nhi.gov.tw/ch/np-2571-1.html （健保署 - 保險費負擔金額表）
//   基本工資：勞動部公告
//
// 同步檢查清單（每年元旦前）：
//   [ ] LABOR_INSURANCE_GRADES（勞保分級表）
//   [ ] laborInsuranceTaiwanese / laborInsuranceForeign 費率
//   [ ] healthInsurance 費率（健保署公告，跟著健保總費率動）
//   [ ] MIN_MONTHLY_WAGE_2026 / MIN_HOURLY_WAGE_2026（admin.js）
//   [ ] MIN_MONTHLY_WAGE（firebase-functions/setEmployeeSalaryProfile.js）
//   [ ] index.html / i18n/*.json 的「2026 基本工資 X 元」文字
// ============================================================

const EMPLOYEE_CONTRIBUTION_RATES = {
    // 本國勞工（2026/01/01 起）：
    //   勞保普通事故 11.5% + 就業保險 1% = 12.5%
    //   員工自付 20% → 2.5%
    laborInsuranceTaiwanese: 0.025,

    // 外籍勞工（2026/01/01 起）：
    //   不適用就業保險法（就保法 §5 限定 ROC 國籍）
    //   只有勞保普通事故 11.5%，員工自付 20% → 2.3%
    laborInsuranceForeign: 0.023,

    // 健保（2026 維持 2025 費率，未調漲）：
    //   一般保險費率 5.17%，員工自付 30%
    //   官方公式：投保金額 × 5.17% × 30% × (本人 + 眷屬人數)
    //   以本人 1 口計算 → 0.0517 × 0.30 = 0.01551（不是 0.0155）
    //
    //   ⚠️ 健保不分國籍（外籍員工同樣需強制納保）
    //   ⚠️ 精度提醒：用 0.0155 在 29,500 級會少算 1 元（457 vs 官方 458）
    //              因此明確用 5.17% × 30% 算，與官方表完全一致
    //   TODO：未來若需支援眷屬，把「本人 + 眷屬人數」乘數加進來
    healthInsurance: 0.0517 * 0.30, // = 0.01551

    // 勞退自提率由員工自選 0~6%
    //   ⚠️ 一般外籍移工通常無勞退（雇主不需提繳 6%、員工亦無自提）
    //   由 employees.hasLaborPension（依 nationality='foreign' 自動 false）控制
};

/**
 * 計算員工自付月扣繳金額
 *
 * @param {number} insuredSalary    勞保月投保薪資（=該員工的等級薪資）
 * @param {number} pensionRate      勞退自提率 % (0~6)
 * @param {object} opts
 *   @param {string} opts.nationality 'taiwanese' | 'foreign'（預設 taiwanese）
 * @returns {{ labor, health, pension, total }} 各項扣繳金額
 */
function calcEmployeeDeductions(insuredSalary, pensionRate = 0, opts = {}) {
    const s = Number(insuredSalary) || 0;
    const p = Math.max(0, Math.min(6, Number(pensionRate) || 0));
    const nationality = opts.nationality === 'foreign' ? 'foreign' : 'taiwanese';
    const laborRate = nationality === 'foreign'
        ? EMPLOYEE_CONTRIBUTION_RATES.laborInsuranceForeign
        : EMPLOYEE_CONTRIBUTION_RATES.laborInsuranceTaiwanese;
    const labor = Math.round(s * laborRate);
    const health = Math.round(s * EMPLOYEE_CONTRIBUTION_RATES.healthInsurance);
    const pension = Math.round(s * (p / 100));
    return { labor, health, pension, total: labor + health + pension };
}

// 暴露給瀏覽器全域
if (typeof window !== 'undefined') {
    window.calcWorkHours = calcWorkHours;
    window.calcWorkHoursFromShifts = calcWorkHoursFromShifts;
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
        calcWorkHoursFromShifts,
        _pairShiftRanges,
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
