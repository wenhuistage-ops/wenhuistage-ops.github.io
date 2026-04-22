/**
 * Jest 測試環境設置
 * 配置全局測試工具和模擬
 */

require('@testing-library/jest-dom');

// 模擬 localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// 模擬 DOMPurify
global.DOMPurify = {
  sanitize: (dirty) => dirty,
};

// 模擬翻譯函數
global.t = (key, params = {}) => {
  const translations = {
    'APP_TITLE': '0rigin Attendance System',
    'CHECKING_LOGIN': '正在檢查登入...',
    'PUNCH_IN': '上班',
    'PUNCH_OUT': '下班',
    'LOADING': '正在載入...',
    'ERROR_FETCH_RECORDS': '無法載入考勤記錄',
    'MONTHLY_SALARY_PREFIX': '本月總薪資：',
    'RECORD_HOURS_PREFIX': '當日工作時數：',
  };
  return translations[key] || key;
};

// 模擬 renderTranslations
global.renderTranslations = jest.fn();

// 模擬 fetch 全局
global.fetch = jest.fn();

// 重置 mock 在每個測試前
beforeEach(() => {
  jest.clearAllMocks();
});


