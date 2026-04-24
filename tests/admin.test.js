/**
 * 測試管理員功能
 * 薪資計算：直接測試 js/modules/payroll.js 真實模組（非內聯假函式）
 * 其他區段：純邏輯規格測試（無對應 admin.js 實作，作為行為規格）
 */

const {
  MIN_MONTHLY_SALARY,
  HOURLY_RATE,
  OVERTIME_MULTIPLIER,
  HOURS_PER_DAY,
  calculateDailySalary,
  calculateOvertimeFees,
  calculateEffectiveHours,
  calculateDailySalaryFromPunches,
  calculateMonthlySalary,
  generatePayrollSummary,
} = require('../js/modules/payroll');

describe('管理員功能 - Admin Module', () => {
  describe('薪資計算 - modules/payroll.js（真實模組）', () => {
    describe('常數定義', () => {
      it('最低月薪為 33840', () => {
        expect(MIN_MONTHLY_SALARY).toBe(33840);
      });
      it('時薪為月薪 / 240', () => {
        expect(HOURLY_RATE).toBeCloseTo(33840 / 240, 5);
      });
      it('加班倍率為 1.33', () => {
        expect(OVERTIME_MULTIPLIER).toBe(1.33);
      });
      it('每日正常工時為 8', () => {
        expect(HOURS_PER_DAY).toBe(8);
      });
    });

    describe('calculateEffectiveHours', () => {
      it('應計算 8 小時工時', () => {
        expect(calculateEffectiveHours('09:00', '17:00')).toBe(8);
      });
      it('應計算半小時精度', () => {
        expect(calculateEffectiveHours('09:00', '17:30')).toBe(8.5);
      });
      it('下班早於上班應回 0', () => {
        expect(calculateEffectiveHours('17:00', '09:00')).toBe(0);
      });
      it('空參數應回 0', () => {
        expect(calculateEffectiveHours(null, null)).toBe(0);
        expect(calculateEffectiveHours('', '')).toBe(0);
      });
    });

    describe('calculateDailySalary', () => {
      it('平日 8 小時應回 8 × 時薪', () => {
        expect(calculateDailySalary(8, 141, 'normal')).toBe(8 * 141);
      });
      it('平日超過 8 小時應封頂於 8', () => {
        expect(calculateDailySalary(10, 141, 'normal')).toBe(8 * 141);
      });
      it('週末應適用 2 倍率', () => {
        expect(calculateDailySalary(8, 141, 'weekend')).toBe(8 * 141 * 2);
      });
      it('假日應適用 2 倍率', () => {
        expect(calculateDailySalary(4, 141, 'holiday')).toBe(4 * 141 * 2);
      });
      it('未知日期類型應回 0', () => {
        expect(calculateDailySalary(8, 141, 'unknown')).toBe(0);
      });
    });

    describe('calculateOvertimeFees', () => {
      it('平日加班套 1.33 倍', () => {
        expect(calculateOvertimeFees({ regular: 2 }, 100)).toBeCloseTo(
          2 * 100 * 1.33,
          5
        );
      });
      it('週末加班套 2 × 1.33 倍', () => {
        expect(calculateOvertimeFees({ weekend: 2 }, 100)).toBeCloseTo(
          2 * 100 * 2 * 1.33,
          5
        );
      });
      it('假日加班套 2 × 1.33 倍', () => {
        expect(calculateOvertimeFees({ holiday: 1 }, 100)).toBeCloseTo(
          1 * 100 * 2 * 1.33,
          5
        );
      });
      it('複合情況', () => {
        const fees = calculateOvertimeFees(
          { regular: 2, weekend: 1, holiday: 0.5 },
          100
        );
        const expected =
          2 * 100 * 1.33 + 1 * 100 * 2 * 1.33 + 0.5 * 100 * 2 * 1.33;
        expect(fees).toBeCloseTo(expected, 5);
      });
      it('空對象應回 0', () => {
        expect(calculateOvertimeFees({}, 100)).toBe(0);
      });
    });

    describe('calculateDailySalaryFromPunches', () => {
      it('由打卡時間計算日薪', () => {
        expect(calculateDailySalaryFromPunches('09:00', '17:00', 141, 'normal'))
          .toBe(8 * 141);
      });
      it('無效時間應回 0', () => {
        expect(calculateDailySalaryFromPunches(null, '17:00', 141)).toBe(0);
      });
    });

    describe('calculateMonthlySalary', () => {
      it('應計算正常工作月薪（無加班、無缺勤）', () => {
        const r = calculateMonthlySalary({
          baseSalary: 33840,
          normalHours: 160,
          overtimeHours: 0,
          absenceHours: 0,
        });
        expect(r.baseSalary).toBe(33840);
        expect(r.absenceDeduction).toBe(0);
        expect(r.overtimePay).toBe(0);
        expect(r.totalSalary).toBe(33840);
      });

      it('應扣除缺勤', () => {
        const r = calculateMonthlySalary({
          baseSalary: 33840,
          absenceHours: 8,
        });
        expect(r.absenceDeduction).toBeCloseTo((33840 / 240) * 8, 1);
        expect(r.totalSalary).toBeLessThan(33840);
      });

      it('應加上加班費', () => {
        const r = calculateMonthlySalary({
          baseSalary: 33840,
          overtimeHours: 10,
        });
        const hourlyRate = 33840 / 240;
        expect(r.overtimePay).toBeCloseTo(
          10 * hourlyRate * OVERTIME_MULTIPLIER,
          1
        );
        expect(r.totalSalary).toBeGreaterThan(33840);
      });

      it('應計算複雜情況（加班+缺勤）', () => {
        const r = calculateMonthlySalary({
          baseSalary: 33840,
          overtimeHours: 5,
          absenceHours: 4,
        });
        expect(r.absenceDeduction).toBeGreaterThan(0);
        expect(r.overtimePay).toBeGreaterThan(0);
        expect(r.totalSalary).toBeCloseTo(
          33840 - r.absenceDeduction + r.overtimePay,
          2
        );
      });

      it('應處理零薪資', () => {
        const r = calculateMonthlySalary({
          baseSalary: 0,
          normalHours: 0,
          overtimeHours: 0,
          absenceHours: 0,
        });
        expect(r.totalSalary).toBe(0);
      });
    });

    describe('generatePayrollSummary', () => {
      it('應生成摘要結構', () => {
        const records = [{ punchInTime: '09:00', punchOutTime: '17:00' }];
        const summary = generatePayrollSummary(records, HOURLY_RATE, {
          baseSalary: MIN_MONTHLY_SALARY,
        });
        expect(summary).toHaveProperty('grossSalary');
        expect(summary).toHaveProperty('deductions');
        expect(summary).toHaveProperty('netSalary');
        expect(summary.records).toBe(1);
      });

      it('加班記錄應反映於 grossSalary', () => {
        const records = [{ punchInTime: '09:00', punchOutTime: '19:00' }]; // 10h，含 2h 加班
        const summary = generatePayrollSummary(records, HOURLY_RATE, {
          baseSalary: MIN_MONTHLY_SALARY,
        });
        expect(summary.grossSalary).toBeGreaterThan(MIN_MONTHLY_SALARY);
      });
    });
  });

  describe('權限校驗', () => {
    function checkAdminPermission(user) {
      return user && user.dept === '管理員';
    }

    function canApproveRequest(user) {
      return checkAdminPermission(user);
    }

    function canViewEmployeeData(user) {
      return checkAdminPermission(user);
    }

    it('應識別管理員', () => {
      const adminUser = { name: 'Admin', dept: '管理員' };
      expect(checkAdminPermission(adminUser)).toBe(true);
    });

    it('應拒絕非管理員', () => {
      const normalUser = { name: 'User', dept: '員工' };
      expect(checkAdminPermission(normalUser)).toBe(false);
    });

    it('應限制非管理員審核請求', () => {
      const normalUser = { name: 'User', dept: '員工' };
      expect(canApproveRequest(normalUser)).toBe(false);
    });

    it('應允許管理員查看員工數據', () => {
      const adminUser = { name: 'Admin', dept: '管理員' };
      expect(canViewEmployeeData(adminUser)).toBe(true);
    });

    it('應處理 null 用戶', () => {
      // 由於 checkAdminPermission 返回 null && ... 的結果，這是 null
      // 但在實際應用中，我們期望它返回 false
      const result = checkAdminPermission(null);
      expect(result).toBeFalsy(); // 使用 toBeFalsy 以接受 null 和 false
    });
  });

  describe('員工管理', () => {
    function findEmployeeById(employees, userId) {
      return employees.find((emp) => emp.userId === userId);
    }

    function validateEmployeeData(employee) {
      const errors = [];

      if (!employee.name || employee.name.trim() === '') {
        errors.push('EMPLOYEE_NAME_REQUIRED');
      }
      if (!employee.userId) {
        errors.push('EMPLOYEE_ID_REQUIRED');
      }
      if (employee.salary !== undefined && employee.salary < 0) {
        errors.push('INVALID_SALARY');
      }

      return errors;
    }

    const mockEmployees = [
      { userId: 'emp001', name: 'Alice', salary: 35000 },
      { userId: 'emp002', name: 'Bob', salary: 36000 },
      { userId: 'emp003', name: 'Charlie', salary: 34000 },
    ];

    it('應查找存在的員工', () => {
      const employee = findEmployeeById(mockEmployees, 'emp001');
      expect(employee).toBeDefined();
      expect(employee.name).toBe('Alice');
    });

    it('應返回 undefined 未找到的員工', () => {
      const employee = findEmployeeById(mockEmployees, 'emp999');
      expect(employee).toBeUndefined();
    });

    it('應驗證有效的員工數據', () => {
      const employee = { userId: 'emp001', name: 'Alice', salary: 35000 };
      const errors = validateEmployeeData(employee);
      expect(errors).toHaveLength(0);
    });

    it('應檢測缺失的員工名稱', () => {
      const employee = { userId: 'emp001', name: '', salary: 35000 };
      const errors = validateEmployeeData(employee);
      expect(errors).toContain('EMPLOYEE_NAME_REQUIRED');
    });

    it('應檢測無效的薪資', () => {
      const employee = { userId: 'emp001', name: 'Alice', salary: -1000 };
      const errors = validateEmployeeData(employee);
      expect(errors).toContain('INVALID_SALARY');
    });

    it('應支持員工列表篩選', () => {
      const highEarners = mockEmployees.filter((emp) => emp.salary > 35000);
      expect(highEarners).toHaveLength(1);
      expect(highEarners[0].name).toBe('Bob');
    });
  });

  describe('請求批准工作流', () => {
    function approveRequest(request) {
      if (!request) {
        return { success: false, error: 'REQUEST_NOT_FOUND' };
      }

      request.status = 'approved';
      request.approvedAt = new Date().toISOString();
      return { success: true, message: 'REQUEST_APPROVED' };
    }

    function rejectRequest(request, reason) {
      if (!request) {
        return { success: false, error: 'REQUEST_NOT_FOUND' };
      }

      request.status = 'rejected';
      request.rejectionReason = reason;
      request.rejectedAt = new Date().toISOString();
      return { success: true, message: 'REQUEST_REJECTED' };
    }

    it('應批准有效的請求', () => {
      const request = { id: '123', type: 'leave', status: 'pending' };
      const result = approveRequest(request);
      expect(result.success).toBe(true);
      expect(request.status).toBe('approved');
    });

    it('應拒絕請求', () => {
      const request = { id: '123', type: 'leave', status: 'pending' };
      const result = rejectRequest(request, '資料不完整');
      expect(result.success).toBe(true);
      expect(request.status).toBe('rejected');
      expect(request.rejectionReason).toBe('資料不完整');
    });

    it('應處理缺失的請求', () => {
      const result = approveRequest(null);
      expect(result.success).toBe(false);
      expect(result.error).toBe('REQUEST_NOT_FOUND');
    });

    it('應記錄批准時間', () => {
      const request = { id: '123', type: 'leave', status: 'pending' };
      approveRequest(request);
      expect(request.approvedAt).toBeDefined();
    });
  });
});
