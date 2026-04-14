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
//let currentLang = localStorage.getItem("lang");//當前語言
let currentMonthDate = new Date();//當前月份
let translations = {};
const MAX_MONTH_CACHE_ENTRIES = 12;
const MAX_DETAIL_MONTH_CACHE_ENTRIES = 6;
const PRELOAD_BASE_DELAY = 500; // 預加載基礎延遲 (毫秒)
const PRELOAD_INCREMENT_DELAY = 250; // 每個預加載項目的額外延遲 (毫秒)
let monthDataCache = {}; // 新增：用於快取月份打卡摘要資料
let monthCacheOrder = []; // LRU 快取順序
let detailMonthDataCache = {}; // 新增：用於快取月份打卡詳細資料
let detailMonthCacheOrder = []; // LRU 快取順序
let monthDetailLoadPromises = {}; // 避免重複請求同一月份詳細資料
let monthNavigationHistory = []; // 月曆翻頁行為記錄
let adminMonthNavigationHistory = []; // 管理員月曆翻頁行為記錄
let isApiCalled = false; // 新增：用於追蹤 API 呼叫狀態，避免重複呼叫
let userId = localStorage.getItem("sessionUserId");

// 異常記錄快取相關（問題 8.4）
let abnormalRecordsCache = null; // 快取的異常記錄
let abnormalRecordsCacheTime = null; // 快取時間
const ABNORMAL_RECORDS_CACHE_DURATION = 5 * 60 * 1000; // 5 分鐘快取

// 新增用於管理員日曆檢視的狀態變數
let adminSelectedUserId = null;
let adminCurrentDate = new Date(); // 初始化為當前月份
let allEmployeeList = []; // 用於儲存所有員工列表
const adminMonthDataCache = {};
const MAX_ADMIN_MONTH_CACHE_ENTRIES = 12;
let adminMonthCacheOrder = []; // Admin LRU 快取順序



// 員工/通用 UI 元素
let loginBtn = null;
let logoutBtn = null;
let punchInBtn = null;
let punchOutBtn = null;
let tabDashboardBtn = null;
let tabMonthlyBtn = null;
let tabLocationBtn = null;
let tabAdminBtn = null;
let abnormalList = null;
let adjustmentFormContainer = null;
let calendarGrid = null;

// 地點管理元素 (Admin/Location View)
let getLocationBtn = null;
let locationLatInput = null;
let locationLngInput = null;
let addLocationBtn = null;

// 管理員專屬元素
let adminSelectEmployee = null;
let adminEmployeeCalendarCard = null;
let adminPrevMonthBtn = null;
let adminNextMonthBtn = null;
// 🌟 新增：全域宣告管理員日紀錄相關的 DOM 元素 🌟
let adminDailyRecordsCard = null;
let adminDailyRecordsTitle = null;
let adminDailyRecordsList = null;
let adminRecordsLoading = null;
let adminDailyRecordsEmpty = null;

let pendingRequests = []; // 新增：用於快取待審核的請求

// 全域變數，用於儲存地圖實例
let mapInstance = null;
let mapLoadingText = null;
let currentCoords = null;
let marker = null;
let circle = null;
/**
 * 從後端取得所有打卡地點，並將它們顯示在地圖上。
 */
// 全域變數，用於儲存地點標記和圓形
let locationMarkers = L.layerGroup();
let locationCircles = L.layerGroup();

// 語系初始化邏輯 (從 DOMContentLoaded 移至此處)
let currentLang = localStorage.getItem("lang");

if (!currentLang) {
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang.startsWith("zh")) {
        currentLang = "zh-TW";
    } else if (browserLang.startsWith("ja")) {
        currentLang = "ja";
    } else if (browserLang.startsWith("vi")) {
        currentLang = "vi";
    } else if (browserLang.startsWith("id")) {
        currentLang = "id";
    } else {
        currentLang = "en-US";
    }
}

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
const mgmtEmployeeSeniority = document.getElementById('mgmt-employee-seniority');
const mgmtEmployeeJoinDate = document.getElementById('mgmt-employee-join-date');

// 權限與狀態 Toggle
const toggleAdmin = document.getElementById('toggle-admin');
const adminStatusSpan = document.getElementById('admin-status');
const toggleActive = document.getElementById('toggle-active');
const activeStatusSpan = document.getElementById('active-status');

// 薪資與政策
const basicSalaryInput = document.getElementById('basic-salary');
const salaryValueSpan = document.getElementById('salary-value');
const requireGpsCheckbox = document.getElementById('require-gps');
const allowManualAdjustCheckbox = document.getElementById('allow-manual-adjust');
const formLeaveSalary = document.getElementById('form-leave-salary');
const formPunchPolicy = document.getElementById('form-punch-policy');

//計算薪水
// state.js
let adminMonthlySalaryDisplay;  // 用於顯示月薪資摘要的 DOM 元素
let currentManagingEmployee;
