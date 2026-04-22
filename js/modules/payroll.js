/**
 * 薪資計算模塊（Payroll）
 * 集中管理薪資、加班費、扣款的計算邏輯
 */

// ===================================
// 常數定義
// ===================================

const MIN_MONTHLY_SALARY = 33840; // 2025 台灣最低月薪
const HOURLY_RATE = MIN_MONTHLY_SALARY / 240; // 約 141/小時
const OVERTIME_MULTIPLIER = 1.33; // 加班倍率
const HOURS_PER_DAY = 8; // 每日正常工時

/**
 * 計算每日薪資
 * @param {number} hours - 工作時數
 * @param {number} hourlyRate - 時薪
 * @param {string} dayType - 日期類型（'normal'、'weekend'、'holiday'）
 * @returns {number} - 日薪
 */
function calculateDailySalary(hours, hourlyRate, dayType = 'normal') {
  if (dayType === 'normal') {
    return Math.min(hours, HOURS_PER_DAY) * hourlyRate;
  } else if (dayType === 'weekend' || dayType === 'holiday') {
    // 假日時薪計算（2倍）
    return Math.min(hours, HOURS_PER_DAY) * hourlyRate * 2;
  }
  return 0;
}

/**
 * 計算加班費
 * @param {object} overtimeDetails - 加班詳情 { regular: 2, weekend: 1, holiday: 0.5 }
 * @param {number} baseHourlyRate - 基本時薪
 * @returns {number} - 加班費
 */
function calculateOvertimeFees(overtimeDetails, baseHourlyRate) {
  let totalOvertimeFee = 0;

  // 平日加班（1.33倍）
  if (overtimeDetails.regular) {
    totalOvertimeFee += overtimeDetails.regular * baseHourlyRate * OVERTIME_MULTIPLIER;
  }

  // 假日加班（2.67倍 = 2 * 1.33）
  if (overtimeDetails.weekend) {
    totalOvertimeFee += overtimeDetails.weekend * baseHourlyRate * 2 * OVERTIME_MULTIPLIER;
  }

  if (overtimeDetails.holiday) {
    totalOvertimeFee += overtimeDetails.holiday * baseHourlyRate * 2 * OVERTIME_MULTIPLIER;
  }

  return totalOvertimeFee;
}

/**
 * 計算有效工作時數
 * @param {string} punchInTime - 上班時間（HH:MM）
 * @param {string} punchOutTime - 下班時間（HH:MM）
 * @returns {number} - 工作時數
 */
function calculateEffectiveHours(punchInTime, punchOutTime) {
  if (!punchInTime || !punchOutTime) return 0;

  const [inHours, inMinutes] = punchInTime.split(':').map(Number);
  const [outHours, outMinutes] = punchOutTime.split(':').map(Number);

  const inTotalMinutes = inHours * 60 + inMinutes;
  const outTotalMinutes = outHours * 60 + outMinutes;

  if (outTotalMinutes <= inTotalMinutes) {
    return 0; // 下班時間早於上班時間
  }

  const diffMinutes = outTotalMinutes - inTotalMinutes;
  const hours = diffMinutes / 60;

  return Math.round(hours * 100) / 100; // 四捨五入到小數點後兩位
}

/**
 * 從打卡時間計算日薪
 * @param {string} punchInTime - 上班時間
 * @param {string} punchOutTime - 下班時間
 * @param {number} hourlyRate - 時薪
 * @param {string} dayType - 日期類型
 * @returns {number} - 日薪
 */
function calculateDailySalaryFromPunches(punchInTime, punchOutTime, hourlyRate, dayType = 'normal') {
  const hours = calculateEffectiveHours(punchInTime, punchOutTime);
  return calculateDailySalary(hours, hourlyRate, dayType);
}

/**
 * 計算月薪收入（底薪 + 加班費）
 * @param {array} monthRecords - 月度打卡記錄
 * @param {number} baseHourlyRate - 基本時薪
 * @param {object} employeeInfo - 員工信息 { baseSalary, holidaysPaid, etc. }
 * @returns {number} - 月總收入
 */
function calculatePayrollIncome(monthRecords, baseHourlyRate, employeeInfo) {
  const { baseSalary = MIN_MONTHLY_SALARY } = employeeInfo;

  // 計算加班費
  let totalOvertimeFee = 0;

  monthRecords.forEach(record => {
    if (record.punchInTime && record.punchOutTime) {
      const hours = calculateEffectiveHours(record.punchInTime, record.punchOutTime);
      if (hours > HOURS_PER_DAY) {
        const overtimeHours = hours - HOURS_PER_DAY;
        totalOvertimeFee += overtimeHours * baseHourlyRate * OVERTIME_MULTIPLIER;
      }
    }
  });

  return baseSalary + totalOvertimeFee;
}

/**
 * 計算月薪扣款（缺勤、保險等）
 * @param {number} totalIncome - 月總收入
 * @param {object} employeeInfo - 員工信息 { absenceHours, insuranceRate, etc. }
 * @returns {number} - 總扣款
 */
function calculatePayrollDeductions(totalIncome, employeeInfo) {
  const { baseSalary = MIN_MONTHLY_SALARY, absenceHours = 0 } = employeeInfo;

  // 缺勤扣款
  const hourlyRate = baseSalary / 240;
  const absenceDeduction = absenceHours * hourlyRate;

  // 保險扣款（例如健保、勞保，此處為示例）
  const insuranceRate = employeeInfo.insuranceRate || 0;
  const insuranceDeduction = totalIncome * insuranceRate;

  return absenceDeduction + insuranceDeduction;
}

/**
 * 生成薪資摘要
 * @param {array} monthRecords - 月度打卡記錄
 * @param {number} baseHourlyRate - 基本時薪
 * @param {object} employeeInfo - 員工信息
 * @returns {object} - 薪資摘要
 */
function generatePayrollSummary(monthRecords, baseHourlyRate, employeeInfo) {
  const income = calculatePayrollIncome(monthRecords, baseHourlyRate, employeeInfo);
  const deductions = calculatePayrollDeductions(income, employeeInfo);
  const netSalary = income - deductions;

  return {
    grossSalary: income,
    deductions: deductions,
    netSalary: netSalary,
    records: monthRecords.length
  };
}

/**
 * 計算月薪（完整版本）
 * @param {object} data - 計算參數
 *   - baseSalary: 基本薪資
 *   - normalHours: 正常工時
 *   - overtimeHours: 加班時數
 *   - absenceHours: 缺勤時數
 * @returns {object} - 薪資計算結果
 */
function calculateMonthlySalary(data) {
  const {
    baseSalary = MIN_MONTHLY_SALARY,
    normalHours = 0,
    overtimeHours = 0,
    absenceHours = 0
  } = data;

  // 計算基本薪資扣除
  const hourlyRate = baseSalary / 240;
  const absenceDeduction = absenceHours * hourlyRate;

  // 計算加班費
  const overtimePay = overtimeHours * hourlyRate * OVERTIME_MULTIPLIER;

  // 最終薪資
  const totalSalary = baseSalary - absenceDeduction + overtimePay;

  return {
    baseSalary,
    absenceDeduction: parseFloat(absenceDeduction.toFixed(2)),
    overtimePay: parseFloat(overtimePay.toFixed(2)),
    totalSalary: parseFloat(totalSalary.toFixed(2))
  };
}

/**
 * 生成薪資單 Sheet
 * @param {array} summaryRows - 薪資摘要行
 * @param {number} baseMonthly - 基本月薪
 * @param {number} hourlyRate - 時薪
 * @param {object} employeeInfo - 員工信息
 * @param {number} year - 年份
 * @param {number} month - 月份
 * @returns {array} - Sheet 數據
 */
function generatePayrollSheet(summaryRows, baseMonthly, hourlyRate, employeeInfo, year, month) {
  const { name = 'Unknown', dept = 'Unknown' } = employeeInfo;

  const sheet = [
    ['薪資單', `${year}年${month}月`, '', `姓名: ${name}`, '', `部門: ${dept}`],
    [],
    ['日期', '上班時間', '下班時間', '工時', '日薪', '類型'],
    ...summaryRows,
    [],
    ['合計時數', '', '', summaryRows.length, '', ''],
    ['基本月薪', baseMonthly],
    ['時薪', hourlyRate],
    []
  ];

  return sheet;
}

/**
 * 生成示例薪資單 Sheet（用於測試）
 */
function generateSamplePayrollFormatSheet(summaryRows, baseMonthly, hourlyRate, employeeInfo, year) {
  // 簡化版本，返回基本信息
  return {
    baseSalary: baseMonthly,
    hourlyRate: hourlyRate,
    employee: employeeInfo.name,
    records: summaryRows.length
  };
}

// 導出
export {
  MIN_MONTHLY_SALARY,
  HOURLY_RATE,
  OVERTIME_MULTIPLIER,
  HOURS_PER_DAY,
  calculateDailySalary,
  calculateOvertimeFees,
  calculateEffectiveHours,
  calculateDailySalaryFromPunches,
  calculatePayrollIncome,
  calculatePayrollDeductions,
  generatePayrollSummary,
  calculateMonthlySalary,
  generatePayrollSheet,
  generateSamplePayrollFormatSheet
};

console.log('✓ Payroll 模塊已加載');
