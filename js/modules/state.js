/**
 * 統一應用狀態管理
 * 將 53 個全局變量整合為單一 AppState 對象
 */

// ===================================
// 應用全局狀態 (AppState)
// ===================================

const AppState = {
  // 用戶認證狀態
  user: {
    id: localStorage.getItem("sessionUserId") || null,
    name: localStorage.getItem("userName") || null,
    picture: localStorage.getItem("userPicture") || null,
    dept: localStorage.getItem("userDept") || null, // 部門：'管理員' 或 '員工'
    isAdmin: false // 運行時計算
  },

  // 應用 UI 狀態
  ui: {
    currentLang: localStorage.getItem("lang") || 'zh-TW',
    currentMonthDate: new Date(), // 員工當前查看的月份
    adminSelectedUserId: null, // 管理員選擇的員工 ID
    adminCurrentDate: new Date() // 管理員查看的月份
  },

  // 伺服器數據（快取）
  data: {
    translations: {}, // i18n 翻譯字典
    allEmployees: [], // 所有員工列表
    navigationHistory: [], // 員工月份導航記錄
    adminNavigationHistory: [] // 管理員月份導航記錄
  },

  // 應用全局狀態標誌
  flags: {
    isApiCalled: false, // 防止重複 API 調用
    mapInitialized: false // 地圖初始化標誌
  }
};

// ===================================
// AppState 訪問器 (Getter/Setter)
// ===================================

/**
 * 獲取用戶狀態
 */
function getUserState() {
  return AppState.user;
}

/**
 * 設置用戶 ID 和基本信息
 */
function setUserInfo(userId, name, picture, dept) {
  AppState.user.id = userId;
  AppState.user.name = name;
  AppState.user.picture = picture;
  AppState.user.dept = dept;
  AppState.user.isAdmin = dept === '管理員';

  // 同時保存至 localStorage
  localStorage.setItem("sessionUserId", userId);
  localStorage.setItem("userName", name);
  localStorage.setItem("userPicture", picture);
  localStorage.setItem("userDept", dept);
}

/**
 * 清除用戶狀態（登出）
 */
function clearUserState() {
  AppState.user.id = null;
  AppState.user.name = null;
  AppState.user.picture = null;
  AppState.user.dept = null;
  AppState.user.isAdmin = false;

  localStorage.removeItem("sessionUserId");
  localStorage.removeItem("userName");
  localStorage.removeItem("userPicture");
  localStorage.removeItem("userDept");
}

/**
 * 設置當前語言
 */
function setLanguage(lang) {
  AppState.ui.currentLang = lang;
  localStorage.setItem("lang", lang);
}

/**
 * 獲取當前語言
 */
function getLanguage() {
  return AppState.ui.currentLang;
}

/**
 * 設置翻譯字典
 */
function setTranslations(translations) {
  AppState.data.translations = translations;
}

/**
 * 獲取翻譯字典
 */
function getTranslations() {
  return AppState.data.translations;
}

/**
 * 設置員工列表
 */
function setEmployeeList(employees) {
  AppState.data.allEmployees = employees;
}

/**
 * 獲取員工列表
 */
function getEmployeeList() {
  return AppState.data.allEmployees;
}

/**
 * 檢查用戶是否為管理員
 */
function isUserAdmin() {
  return AppState.user.isAdmin;
}

/**
 * 獲取當前用戶 ID
 */
function getUserId() {
  return AppState.user.id;
}

// ===================================

console.log('✓ state 模塊已加載');
