/**
 * UI 管理器 - 統一管理所有 DOM 元素引用
 * 解決分散在多個文件中的 DOM 查詢問題
 */

class UIManager {
  constructor() {
    this.elements = {};
    this.initialized = false;
  }

  /**
   * 初始化所有 DOM 元素引用
   * 應在 DOMContentLoaded 事件中調用
   */
  init() {
    if (this.initialized) {
      console.warn('UIManager 已初始化');
      return;
    }

    // 登入相關
    this.elements.loginSection = document.getElementById('login-section');
    this.elements.loginBtn = document.getElementById('login-btn');
    this.elements.status = document.getElementById('status');

    // 用戶認證相關
    this.elements.userHeader = document.getElementById('user-header');
    this.elements.userName = document.getElementById('user-name');
    this.elements.profileImg = document.getElementById('profile-img');
    this.elements.logoutBtn = document.getElementById('logout-btn');
    this.elements.themeToggle = document.getElementById('theme-toggle');
    this.elements.languageSwitcher = document.getElementById('language-switcher');

    // 主應用容器
    this.elements.mainApp = document.getElementById('main-app');
    this.elements.appContainer = document.getElementById('app-container');

    // Tab 導航
    this.elements.tabDashboardBtn = document.getElementById('tab-dashboard-btn');
    this.elements.tabMonthlyBtn = document.getElementById('tab-monthly-btn');
    this.elements.tabFormBtn = document.getElementById('tab-Form-btn');
    this.elements.tabLocationBtn = document.getElementById('tab-location-btn');
    this.elements.tabAdminBtn = document.getElementById('tab-admin-btn');

    // 儀表板視圖
    this.elements.dashboardView = document.getElementById('dashboard-view');
    this.elements.punchInBtn = document.getElementById('punch-in-btn');
    this.elements.punchOutBtn = document.getElementById('punch-out-btn');
    this.elements.monthlySalaryEl = document.getElementById('monthly-salary');
    this.elements.monthlyHoursEl = document.getElementById('monthly-hours');
    this.elements.abnormalSectionEl = document.getElementById('abnormal-section');
    this.elements.abnormalLoadingEl = document.getElementById('abnormal-loading');
    this.elements.abnormalEmptyEl = document.getElementById('abnormal-empty');
    this.elements.abnormalListEl = document.getElementById('abnormal-list');
    this.elements.adjustmentFormContainer = document.getElementById('adjustment-form-container');

    // 月份視圖
    this.elements.monthlyView = document.getElementById('monthly-view');
    this.elements.monthTitle = document.getElementById('month-title');
    this.elements.prevMonthBtn = document.getElementById('prev-month-btn');
    this.elements.nextMonthBtn = document.getElementById('next-month-btn');
    this.elements.calendarGrid = document.getElementById('calendar-grid');
    this.elements.recordsLoadingEl = document.getElementById('records-loading');
    this.elements.abnormalRecordsSectionEl = document.getElementById('abnormal-records-section');
    this.elements.recordsEmptyEl = document.getElementById('records-empty');

    // 表單申請視圖
    this.elements.formView = document.getElementById('form-view');

    // 定位視圖
    this.elements.locationView = document.getElementById('location-view');
    this.elements.mapContainer = document.getElementById('map-container');
    this.elements.getLocationBtn = document.getElementById('get-location-btn');
    this.elements.locationLatInput = document.getElementById('location-lat');
    this.elements.locationLngInput = document.getElementById('location-lng');
    this.elements.locationName = document.getElementById('location-name');
    this.elements.addLocationBtn = document.getElementById('add-location-btn');
    this.elements.mapLoadingText = document.getElementById('map-loading-text');
    this.elements.searchResultsEl = document.getElementById('search-results');

    // 管理員視圖
    this.elements.adminView = document.getElementById('admin-view');
    this.elements.adminTabs = document.getElementById('admin-tabs');
    this.elements.tabEmployeeMgmtBtn = document.getElementById('tab-employee-mgmt-btn');
    this.elements.tabPunchMgmtBtn = document.getElementById('tab-punch-mgmt-btn');
    this.elements.tabFormReviewBtn = document.getElementById('tab-form-review-btn');
    this.elements.tabSchedulingBtn = document.getElementById('tab-scheduling-btn');

    // 管理員 - 員工管理
    this.elements.adminSelectEmployee = document.getElementById('admin-select-employee');
    this.elements.employeeDetailCard = document.getElementById('employee-detail-card');
    this.elements.mgmtPlaceholder = document.getElementById('mgmt-placeholder');
    this.elements.mgmtEmployeeName = document.getElementById('mgmt-employee-name');
    this.elements.mgmtEmployeeId = document.getElementById('mgmt-employee-id');
    this.elements.mgmtEmployeeAvatar = document.getElementById('mgmt-employee-avatar');
    this.elements.mgmtEmployeeSeniority = document.getElementById('mgmt-employee-seniority');
    this.elements.mgmtEmployeeJoinDate = document.getElementById('mgmt-employee-join-date');
    this.elements.toggleAdmin = document.getElementById('toggle-admin');
    this.elements.adminStatusSpan = document.getElementById('admin-status-span');
    this.elements.toggleActive = document.getElementById('toggle-active');
    this.elements.activeStatusSpan = document.getElementById('active-status-span');
    // 薪資 DOM 綁定已移除，待重新設計
    this.elements.requireGpsCheckbox = document.getElementById('require-gps-checkbox');
    this.elements.allowManualAdjustCheckbox = document.getElementById('allow-manual-adjust-checkbox');
    this.elements.formPunchPolicy = document.getElementById('form-punch-policy');
    this.elements.saveEmployeeBtn = document.getElementById('save-employee-btn');

    // 管理員 - 打卡管理
    this.elements.adminSelectEmployeePunch = document.getElementById('admin-select-employee-punch');
    this.elements.adminEmployeeCalendarCard = document.getElementById('admin-employee-calendar-card');
    this.elements.adminPrevMonthBtn = document.getElementById('admin-prev-month-btn');
    this.elements.adminNextMonthBtn = document.getElementById('admin-next-month-btn');
    this.elements.adminCurrentMonthDisplay = document.getElementById('admin-current-month-display');
    this.elements.adminCalendarGrid = document.getElementById('admin-calendar-grid');

    // 管理員 - 日常記錄
    this.elements.adminDailyRecordsCard = document.getElementById('admin-daily-records-card');
    this.elements.adminDailyRecordsTitle = document.getElementById('admin-daily-records-title');
    this.elements.adminRecordsLoading = document.getElementById('admin-records-loading');
    this.elements.adminDailyRecordsList = document.getElementById('admin-daily-records-list');
    this.elements.adminDailyRecordsEmpty = document.getElementById('admin-daily-records-empty');

    // 管理員 - 薪資管理（已移除，待重新設計）

    // 管理員 - 待審核請求
    this.elements.toggleRequestsBtn = document.getElementById('toggle-requests-btn');
    this.elements.toggleRequestsIcon = document.getElementById('toggle-requests-icon');
    this.elements.pendingRequestsContent = document.getElementById('pending-requests-content');
    this.elements.requestsLoading = document.getElementById('requests-loading');
    this.elements.requestsEmpty = document.getElementById('requests-empty');
    this.elements.pendingRequestsList = document.getElementById('pending-requests-list');

    // 確認對話框
    this.elements.confirmDialog = document.getElementById('confirm-dialog');
    this.elements.confirmMessage = document.getElementById('confirm-message');
    this.elements.confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    this.elements.confirmOkBtn = document.getElementById('confirm-ok-btn');

    // Floating 按鈕
    this.elements.floatingLineBtn = document.getElementById('floating-line-btn');

    this.initialized = true;
    console.log(`✓ UIManager 初始化完成（管理 ${Object.keys(this.elements).length} 個 DOM 元素）`);
  }

  /**
   * 獲取 DOM 元素
   * @param {string} elementName - 元素名稱
   * @returns {HTMLElement|null}
   */
  get(elementName) {
    if (!this.initialized) {
      console.warn('UIManager 未初始化，請先調用 init()');
      return null;
    }

    const element = this.elements[elementName];
    if (!element) {
      console.warn(`未找到元素: ${elementName}`);
      return null;
    }

    return element;
  }

  /**
   * 獲取所有已初始化的 DOM 元素（用於調試）
   */
  getAll() {
    return this.elements;
  }

  /**
   * 批量獲取多個元素
   * @param {string[]} names - 元素名稱數組
   * @returns {object}
   */
  getBatch(names) {
    const result = {};
    names.forEach(name => {
      result[name] = this.get(name);
    });
    return result;
  }
}

// 創建全局單例
const uiManager = new UIManager();


console.log('✓ ui-manager 模塊已加載');
