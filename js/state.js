/**
 * 應用全局常數和配置
 * 🌟 P1-1 改進：
 * - 全局變量由 js/modules/state.js 的 AppState 管理
 * - DOM 元素由 js/modules/ui-manager.js 管理
 * - 本文件現在僅保留常數定義和初始化
 */

// ===================================
// 快取配置常數
// ===================================

const MAX_MONTH_CACHE_ENTRIES = 12;
const MAX_DETAIL_MONTH_CACHE_ENTRIES = 6;
const MAX_ADMIN_MONTH_CACHE_ENTRIES = 12;
const ABNORMAL_RECORDS_CACHE_DURATION = 5 * 60 * 1000; // 5 分鐘

// ===================================
// 預加載配置
// ===================================

const PRELOAD_BASE_DELAY = 500; // 預加載基礎延遲 (毫秒)
const PRELOAD_INCREMENT_DELAY = 250; // 每個預加載項目的額外延遲 (毫秒)

// ===================================
// CacheManager 初始化
// ===================================

// CacheManager 由 cache.js 提供全局實例：cacheManager

// ===================================
// 向後兼容的全局變量別名
// ===================================
// 這些變量仍保留在全局作用域中，用於支持現有代碼
// 實際數據由 AppState 或 UIManager 管理

let currentMonthDate = new Date(); // 當前月份（員工視圖）
let translations = {}; // 翻譯字典（由 i18n 模塊管理）

/**
 * 偵測瀏覽器語言 → 專案支援的語系代碼（U-M10）
 *
 * ⚠️ 舊版寫成 `localStorage.getItem("lang") || 'zh-TW'`，'zh-TW' 這個
 *    fallback 讓下方的偵測區塊變成永遠不執行的死碼；越南/印尼籍員工首次
 *    開啟一律看到中文。改成「沒存過語言時才走偵測」。
 *
 * @param {string} [browserLang] 覆寫用（測試）；預設讀 navigator.language
 * @returns {'zh-TW'|'ja'|'vi'|'id'|'en-US'}
 */
function detectBrowserLang(browserLang) {
    const raw = browserLang
        || (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage))
        || '';
    const lang = String(raw).toLowerCase();
    if (lang.startsWith('zh')) return 'zh-TW';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('vi')) return 'vi';
    if (lang.startsWith('id') || lang.startsWith('in')) return 'id'; // 舊版 Android 送 'in' 代表印尼文
    return 'en-US';
}

// 使用者選過語言就尊重選擇；沒選過才依瀏覽器語言決定
let currentLang = localStorage.getItem("lang") || detectBrowserLang(); // 當前語言

// 用戶相關（由 AppState 管理）
let userId = localStorage.getItem("sessionUserId");

// 管理員相關（由 AppState 管理）
let adminSelectedUserId = null;
let adminCurrentDate = new Date();
let allEmployeeList = [];

// API 狀態標誌
let isApiCalled = false;
let monthDetailLoadPromises = {};
let monthNavigationHistory = [];
let adminMonthNavigationHistory = [];
let adminMonthDataCache = {}; // 管理員月份數據快取
let adminMonthCacheOrder = []; // 管理員月份快取順序（用於 LRU 清理）

// 待審核請求（由 request-approval 模塊管理）
let pendingRequests = [];

// ===================================
// 地圖相關全局變量（由 location.js 管理）
// ===================================

let mapInstance = null;
let mapLoadingText = null;
let currentCoords = null;
let marker = null;
let circle = null;
let locationMarkers = null; // 將在 location.js 中初始化
let locationCircles = null; // 將在 location.js 中初始化

// 首屏就讓 <html lang> 與 currentLang 一致（讀屏發音引擎依這個屬性）
if (typeof applyDocumentLang === 'function') applyDocumentLang(currentLang);



let requestsLoading = null;
let requestsEmpty = null;
let pendingRequestsList = null;

let recordsLoadingEl = null;
let abnormalRecordsSectionEl = null;
let abnormalListEl = null;
let recordsEmptyEl = null;
let adminCalendarGrid = null;
let adminEventsBound = null;
let toggleRequestsBtn = null;
let pendingRequestsContent = null;

let toggleRequestsIcon = null;

let adminCurrentMonthDisplay = null;

const adminSelectEmployeeMgmt = document.getElementById('admin-select-employee-mgmt'); // 員工選擇下拉選單 (如果需要)
const employeeDetailCard = document.getElementById('employee-detail-card');
const mgmtPlaceholder = document.getElementById('mgmt-placeholder');
const mgmtEmployeeName = document.getElementById('mgmt-employee-name');
const mgmtEmployeeId = document.getElementById('mgmt-employee-id');
const mgmtEmployeeAvatar = document.getElementById('mgmt-employee-avatar');
// P2-3 優化: mgmtEmployeeSeniority 和 mgmtEmployeeJoinDate 現在由 JavaScript 動態生成

// 權限與狀態 Toggle（P2-3 優化: 現在由 JavaScript 動態生成）
let toggleAdmin = null;
let toggleActive = null;

// 打卡政策（薪資相關已移除，待重新設計）
const requireGpsCheckbox = document.getElementById('require-gps');
const allowManualAdjustCheckbox = document.getElementById('allow-manual-adjust');
const formPunchPolicy = document.getElementById('form-punch-policy');

let currentManagingEmployee;
