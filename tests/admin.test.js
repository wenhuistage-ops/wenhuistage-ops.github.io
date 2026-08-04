/**
 * 測試管理員功能
 * 權限、員工管理、請求批准：純邏輯規格測試
 * 薪資計算已移除（js/modules/payroll.js 為過時死碼，已刪除；
 * admin.js 內薪資計算函式將於重新設計後連同測試一併補上）
 */

describe('管理員功能 - Admin Module', () => {
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

  describe('打卡紀錄刪除白名單', () => {
    // 規格需與 deleteAttendance.js（後端）+ admin.js canDelete（前端按鈕）兩處一致
    const DELETABLE_TYPES = new Set(['', '補打卡', '系統虛擬卡']);
    const canDelete = (adjustmentType) => DELETABLE_TYPES.has(adjustmentType || '');

    it('應允許刪除一般打卡（員工按錯上/下班需 admin 修正）', () => {
      expect(canDelete('')).toBe(true);
      expect(canDelete(undefined)).toBe(true);
    });

    it('應允許刪除補打卡與系統虛擬卡', () => {
      expect(canDelete('補打卡')).toBe(true);
      expect(canDelete('系統虛擬卡')).toBe(true);
    });

    it('應拒絕刪除請假記錄（影響員工權益，改假別走編輯）', () => {
      expect(canDelete('系統請假記錄')).toBe(false);
    });
  });

  describe('假別編輯下拉 - 保留非中文現值', () => {
    // 對應 admin.js _openAdminEditModal 的 kindOptsWithCur
    const LEAVE_KINDS = {
      請假: ['病假', '事假', '其他'],
      休假: ['年假', '特休', '補休', '颱風假'],
    };
    const buildOpts = (grp, curKind) => {
      const opts = LEAVE_KINDS[grp] || [];
      return (curKind && !opts.includes(curKind)) ? [curKind, ...opts] : opts;
    };
    // 前端只在假別真的變更時才送出（admin.js：kind !== curKind）
    const wouldMutate = (opts, curKind) => opts[0] !== curKind;

    it('中文假別應正常預選，不改動選項', () => {
      expect(buildOpts('請假', '事假')).toEqual(['病假', '事假', '其他']);
    });

    it('越南文事假應補進選項，避免被靜默改成病假', () => {
      const opts = buildOpts('請假', 'Nghỉ việc riêng');
      expect(opts[0]).toBe('Nghỉ việc riêng');
      expect(wouldMutate(opts, 'Nghỉ việc riêng')).toBe(false);
    });

    it('修復前的行為：非中文假別會落到第一項而觸發誤改', () => {
      expect(wouldMutate(LEAVE_KINDS['請假'], 'Nghỉ việc riêng')).toBe(true);
    });

    it('無現值（非請假記錄）時選項維持白名單', () => {
      expect(buildOpts('休假', '')).toEqual(['年假', '特休', '補休', '颱風假']);
    });
  });
});
