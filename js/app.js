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
// ===================================
// #region 1. 檢查登錄 (修正 ensureLogin 函式)
// ===================================

/**
 * 檢查 Token 並驗證用戶身份，同時檢查是否為管理員。
 * @returns {Promise<{isLoggedIn: boolean, isAdmin: boolean}>}
 */
async function ensureLogin() {
    return new Promise(async (resolve) => {

        // 預設未登入狀態
        const defaultResult = { isLoggedIn: false, isAdmin: false };

        if (localStorage.getItem("sessionToken")) {
            document.getElementById("status").textContent = t("CHECKING_LOGIN");
            try {
                const res = await callApifetch({ action: 'checkSession' });

                if (res.ok) {
                    const isAdmin = (res.user.dept === "管理員");

                    // 🌟 修正點 (問題1.2)：不再儲存 isAdmin 到 localStorage
                    // 改為每次需要時從服務器驗證
                    // localStorage.setItem("isAdmin", isAdmin ? 'true' : 'false'); // ❌ 已移除

                    if (isAdmin) {
                        // 顯示管理員按鈕
                        document.getElementById('tab-admin-btn').style.display = 'block';
                    }

                    document.getElementById("user-name").textContent = res.user.name;
                    document.getElementById("profile-img").src = res.user.picture || res.user.rate;
                    localStorage.setItem("sessionUserId", res.user.userId);
                    localStorage.setItem("userName", res.user.name);
                    localStorage.setItem("userPicture", res.user.picture || res.user.rate);
                    localStorage.setItem("userDept", res.user.dept); // 保存用戶部門信息用於後續管理員驗證
                    userId = res.user.userId;
                    showNotification(t("LOGIN_SUCCESS"));

                    // 顯示用戶介面
                    document.getElementById('login-section').style.display = 'none';
                    document.getElementById('user-header').style.display = 'flex';
                    document.getElementById('main-app').style.display = 'block';
                    // 🚀 P2-1 優化：刪除自動初始化地圖，改為延遲加載
                    // initLocationMap(); // ❌ 已移除，用戶點擊 location-view 時才初始化
                    // 檢查異常打卡 (在 checkSession 成功後執行)
                    checkAbnormal(); // 檢查本月的異常記錄

                    resolve({ isLoggedIn: true, isAdmin: isAdmin }); // 🌟 回傳狀態
                } else {
                    const errorMsg = t(res.code || "UNKNOWN_ERROR");
                    showNotification(`❌ ${errorMsg}`, "error");
                    document.getElementById("status").textContent = t("PLEASE_RELOGIN");
                    document.getElementById('login-btn').style.display = 'block';
                    document.getElementById('user-header').style.display = 'none';
                    document.getElementById('main-app').style.display = 'none';
                    resolve(defaultResult);
                }
            } catch (err) {
                console.error(err);
                document.getElementById('login-btn').style.display = 'block';
                document.getElementById('user-header').style.display = 'none';
                document.getElementById('main-app').style.display = 'none';
                document.getElementById("status").textContent = t("PLEASE_RELOGIN");
                resolve(defaultResult);
            }
        } else {
            // 未找到 Token，顯示登入按鈕
            document.getElementById('login-btn').style.display = 'block';
            document.getElementById('user-header').style.display = 'none';
            document.getElementById('main-app').style.display = 'none';
            document.getElementById("status").textContent = t("SUBTITLE_LOGIN");
            resolve(defaultResult);
        }
    });
}
// #endregion
// ===================================


// ===================================
// #region 2. 全域變數賦值 (getDOMElements)
// ===================================
// 註：所有變數的宣告 (let loginBtn = null;) 都在 js/state.js 中完成。
function getDOMElements() {
    // ⚠️ 注意：這裡移除了 const/let，直接對 state.js 的全域變數賦值

    // 核心 UI 元素
    loginBtn = document.getElementById('login-btn');
    logoutBtn = document.getElementById('logout-btn');
    punchInBtn = document.getElementById('punch-in-btn');
    punchOutBtn = document.getElementById('punch-out-btn');

    // Tab 按鈕
    tabDashboardBtn = document.getElementById('tab-dashboard-btn');
    tabMonthlyBtn = document.getElementById('tab-monthly-btn');
    tabLocationBtn = document.getElementById('tab-location-btn');
    tabAdminBtn = document.getElementById('tab-admin-btn');
    tabFormBtn = document.getElementById('tab-Form-btn');

    // 管理員頁面中 子選單Tab 按鈕
    tabEmployeeMgmtBtn = document.getElementById('tab-employee-mgmt-btn');
    tabEmployeeSettingsBtn = document.getElementById('tab-employee-settings-btn');
    tabPunchMgmtBtn = document.getElementById('tab-punch-mgmt-btn');
    tabFormReviewBtn = document.getElementById('tab-form-review-btn');
    tabSchedulingBtn = document.getElementById('tab-scheduling-btn');

    // 員工異常紀錄
    abnormalList = document.getElementById('abnormal-list');
    adjustmentFormContainer = document.getElementById('adjustment-form-container');
    recordsLoadingEl = document.getElementById("records-loading");
    abnormalRecordsSectionEl = document.getElementById("abnormal-records-section");
    abnormalListEl = document.getElementById("abnormal-list");
    recordsEmptyEl = document.getElementById("records-empty");

    // 員工月曆
    calendarGrid = document.getElementById('calendar-grid');

    // 地點管理 (Admin / Location View)
    getLocationBtn = document.getElementById('get-location-btn');
    locationLatInput = document.getElementById('location-lat');
    locationLngInput = document.getElementById('location-lng');
    addLocationBtn = document.getElementById('add-location-btn');

    locationName = document.getElementById('location-name');
    // 管理員專用：員工日曆
    // Phase 1：合併員工選擇器，#admin-select-employee 已移除，
    // adminSelectEmployee 全域變數指向唯一的 #admin-select-employee-mgmt
    adminSelectEmployee = document.getElementById('admin-select-employee-mgmt');
    adminEmployeeCalendarCard = document.getElementById('admin-employee-calendar-card');
    adminPrevMonthBtn = document.getElementById('admin-prev-month-btn');
    adminNextMonthBtn = document.getElementById('admin-next-month-btn');
    adminCalendarGrid = document.getElementById('admin-calendar-grid');
    // 薪資 DOM 綁定已移除，待重新設計

    // 管理員專用：日紀錄與審批
    adminDailyRecordsCard = document.getElementById('admin-daily-records-card');
    adminDailyRecordsTitle = document.getElementById('admin-daily-records-title');
    adminDailyRecordsList = document.getElementById('admin-daily-records-list');
    adminRecordsLoading = document.getElementById("admin-records-loading");
    adminDailyRecordsEmpty = document.getElementById('admin-daily-records-empty');

    requestsLoading = document.getElementById('requests-loading');
    requestsEmpty = document.getElementById('requests-empty');
    pendingRequestsList = document.getElementById('pending-requests-list');
    toggleRequestsIcon = document.getElementById('toggle-requests-icon');//
    pendingRequestsContent = document.getElementById('pending-requests-content');//
    toggleRequestsBtn = document.getElementById('toggle-requests-btn');
    adminCurrentMonthDisplay = document.getElementById('admin-current-month-display');


}
// #endregion
// ===================================


// ===================================
// #region 3. 事件綁定總覽（P1-1 改進：模塊化調用）
// ===================================
// 依賴的模塊函數：
// - loadTranslations(), t() → modules/i18n.js
// - renderCalendar() → modules/calendar.js
// - doPunch() → punch.js
// - verifyAdminPermission(), callApifetch() → core.js
// - loadAdminDashboard() → admin.js
function bindEvents() {
    // 登入/登出事件
    loginBtn.onclick = async () => {
        // 防連點：弱網下 getLoginUrl 可能慢，避免使用者狂點連發多個請求
        if (loginBtn.disabled) return;
        const _originalLabel = loginBtn.textContent;
        loginBtn.disabled = true;
        loginBtn.style.opacity = '0.7';
        loginBtn.textContent = t('LOADING') || '處理中...';
        try {
            // 根據當前環境動態決定登入後的回跳網址
            const redirectUrl = getRedirectUrl();
            const res = await callApifetch({
                action: 'getLoginUrl',
                redirectUrl: redirectUrl  // 將回跳網址作為參數傳遞給後端
            });
            if (res && res.url) {
                // CSRF 防護：記住本次授權的 state，callback 時比對
                // 用 localStorage（含時效）：iOS Safari / LINE 在 OAuth 跳轉回來時常開新分頁/webview，
                // sessionStorage（只活在原分頁）會遺失而誤判 state mismatch。以 state 值當鍵支援多分頁併發。
                if (res.state) {
                    try {
                        localStorage.setItem('lineLoginState:' + res.state, String(Date.now()));
                    } catch (_) { /* ignore */ }
                }
                window.location.href = res.url; // 導向 LINE 授權（頁面即將離開）
                return;
            }
            // 後端沒回 url → 明確回饋，而非默默無反應
            showNotification(t('CONNECTION_FAILED') || '無法取得登入連結，請稍後再試', 'error');
        } catch (err) {
            // callApifetch 內部已對網路錯誤顯示通知；這裡確保按鈕還原
            console.error('getLoginUrl 失敗:', err);
        } finally {
            loginBtn.disabled = false;
            loginBtn.style.opacity = '';
            loginBtn.textContent = _originalLabel;
        }
    };

    logoutBtn.onclick = () => {
        // 清除所有登入/身分快取：避免降權後仍保有管理員 UI，或換帳號後殘留舊姓名/頭像
        ['sessionToken', 'sessionUserId', 'userDept', 'userName', 'userPicture', 'userId', 'isAdmin']
            .forEach((k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } });
        window.location.href = "/index.html";
    };

    // === 核心業務：打卡事件 (呼叫 punch.js 中的 doPunch) ===
    punchInBtn.addEventListener('click', () => doPunch("上班"));
    punchOutBtn.addEventListener('click', () => doPunch("下班"));

    // === 導航 Tab 切換事件 ===
    tabDashboardBtn.addEventListener('click', () => switchTab('dashboard-view'));
    tabLocationBtn.addEventListener('click', () => switchTab('location-view'));
    tabMonthlyBtn.addEventListener('click', () => switchTab('monthly-view'));

    // 2026-05-15：我的補卡申請 tab
    const tabMyRequestsBtn = document.getElementById('tab-my-requests-btn');
    if (tabMyRequestsBtn) {
        tabMyRequestsBtn.addEventListener('click', () => switchTab('my-requests-view'));
    }

    tabFormBtn.addEventListener('click', () => switchTab('Form-view'));


    // === 導航 管理員子Tab 切換事件 () ===
    tabEmployeeMgmtBtn.addEventListener('click', () => switchAdminSubTab('employee-mgmt-view'));
    if (tabEmployeeSettingsBtn) {
        tabEmployeeSettingsBtn.addEventListener('click', () => switchAdminSubTab('employee-settings-view'));
    }
    tabPunchMgmtBtn.addEventListener('click', () => switchAdminSubTab('punch-mgmt-view'));
    tabFormReviewBtn.addEventListener('click', () => switchAdminSubTab('form-review-view'));
    tabSchedulingBtn.addEventListener('click', () => switchAdminSubTab('scheduling-view'));


    // 🌟 修正點 (問題1.1)：每次點擊管理員Tab時驗證服務器權限
    tabAdminBtn.addEventListener('click', async () => {
        const isUserAdmin = await verifyAdminPermission();

        if (isUserAdmin) {
            switchTab('admin-view');
        } else {
            showNotification(t("ERR_NO_PERMISSION"), "error");
        }
    });

    // === 月曆按鈕事件 (員工自己的月曆) ===
    // ⚠️ 用 new Date(年, 月±1, 1) 重建，而非 setMonth：
    // setMonth 會保留當前「日」，在 31 號往 2 月切會溢位成 3 月（月底跳錯月）。
    document.getElementById('prev-month').addEventListener('click', () => {
        currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);
        renderCalendar(currentMonthDate); // 來自 ui.js
    });

    document.getElementById('next-month').addEventListener('click', () => {
        currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1);
        renderCalendar(currentMonthDate); // 來自 ui.js
    });
    document.getElementById('refresh-month').addEventListener('click', () => {
        renderCalendar(currentMonthDate, true); // 來自 ui.js（強制重抓當月）
    });
    // === 語系切換事件 ===
    document.getElementById('language-switcher').addEventListener('change', (e) => {
        const newLang = e.target.value;
        loadTranslations(newLang);

        // 重新初始化需要翻譯的 Tab
        const currentTab = document.querySelector('.active');
        const currentTabId = currentTab ? currentTab.id : null;

        if (currentTabId === 'location-view' || currentTabId === 'dashboard-view') {
            initLocationMap(true); // 來自 location.js
        }
        // 這裡可以根據需要重新渲染當前視圖，確保所有 i18n 元素被更新
    });
}
// #endregion
// ===================================

// ===================================
// #region 4. 應用程式入口點 (DOMContentLoaded 內部 - 核心啟動流程)
// ===================================

document.addEventListener('DOMContentLoaded', async () => {

    // ✅ P1-1 改進：初始化模塊化架構
    // 注意：UIManager 和 AppState 由 js/modules/ 中的模塊提供
    if (typeof uiManager !== 'undefined' && uiManager.init) {
        uiManager.init(); // 初始化 DOM 元素管理器
    }

    // I. 獲取所有 DOM 元素和狀態設置
    getDOMElements(); // 必須在最前面執行
    document.getElementById('language-switcher').value = currentLang;
    localStorage.setItem("lang", currentLang);

    // II. 載入基本狀態 (翻譯)
    // ✅ P1-1 改進：i18n 模塊已遷移至 js/modules/i18n.js
    // 🚀 P2-1 優化：預加載常用語言，加快語言切換速度
    if (typeof preloadTranslations !== 'undefined') {
        // 異步預加載常用語言（除當前語言外），不阻塞主流程
        const availableLangs = ['zh-TW', 'en-US', 'ja', 'id', 'vi'];
        const otherLangs = availableLangs.filter(l => l !== currentLang).slice(0, 2);
        preloadTranslations(otherLangs); // 不等待，異步執行
    }

    await loadTranslations(currentLang);

    // III. 綁定所有事件
    bindEvents(); // 核心事件綁定 (登入/登出、Tab 切換)
    bindPunchEvents(); // 來自 punch.js，綁定補打卡等事件

    // ==========================================
    // IV. 核心登入檢查和流程控制
    // ==========================================
    let loginResult = { isLoggedIn: false, isAdmin: false };
    const params = new URLSearchParams(window.location.search);
    let otoken = params.get('code');

    // CSRF 防護：OAuth callback 必須帶回登入時存的 state，且與 sessionStorage 一致
    // 不一致 = 這個 authorization code 不是本瀏覽器發起的授權（login CSRF），丟棄
    if (otoken) {
        const returnedState = params.get('state');
        const STATE_TTL_MS = 10 * 60 * 1000; // state 僅在 10 分鐘內有效
        const stateKey = returnedState ? 'lineLoginState:' + returnedState : null;
        let storedAt = 0;
        try { if (stateKey) storedAt = Number(localStorage.getItem(stateKey)) || 0; } catch (_) { /* ignore */ }
        // 僅接受「本瀏覽器發起、且未過期」的 state：未知 state（CSRF）或過期一律拒絕
        const valid = !!storedAt && (Date.now() - storedAt) <= STATE_TTL_MS;
        // 清掉本次用過的 state（維持一次性），並順手清掉所有過期殘留鍵（含舊版扁平鍵）
        const clearStoredState = () => {
            try {
                if (stateKey) localStorage.removeItem(stateKey);
                localStorage.removeItem('lineLoginState');   // 舊版遺留鍵
                localStorage.removeItem('lineLoginStateAt'); // 舊版遺留鍵
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.indexOf('lineLoginState:') === 0) {
                        const ts = Number(localStorage.getItem(k)) || 0;
                        if (!ts || (Date.now() - ts) > STATE_TTL_MS) localStorage.removeItem(k);
                    }
                }
            } catch (_) { /* ignore */ }
        };
        if (!valid) {
            console.warn('OAuth state 驗證失敗，丟棄 authorization code（可能為 CSRF 或過期）');
            showNotification(t('ERROR_LOGIN_FAILED', { msg: 'state mismatch' }) || '登入驗證失敗，請重新登入', 'error');
            history.replaceState({}, '', window.location.pathname);
            clearStoredState();
            otoken = null;
        } else {
            clearStoredState();
        }
    }

    if (otoken) {
        // 處理 otoken 換取 sessionToken 的流程
        document.getElementById("status").textContent = t("VERIFYING_AUTH");
        try {
            console.log(currentLang);
            // 獲取當前環境的 redirect URL，與登入時相同
            const redirectUrl = getRedirectUrl();
            const res = await callApifetch({ action: 'getProfile', otoken: otoken, languag: currentLang, redirectUrl: redirectUrl });
            if (res.ok && res.sToken) {
                localStorage.setItem("sessionToken", res.sToken);
                history.replaceState({}, '', window.location.pathname);
                // 成功換取 sessionToken 後，檢查會話並獲取權限
                loginResult = await ensureLogin();
            } else {
                showNotification(t("ERROR_LOGIN_FAILED", { msg: res.msg || t("UNKNOWN_ERROR") }), "error");
                loginBtn.style.display = 'block';
            }
        } catch (err) {
            console.error(err);
            loginBtn.style.display = 'block';
        }
    } else {
        // 處理沒有 otoken 的情況
        // 檢查是否已經有有效的登入狀態（避免重新整理時重新登入）
        const sessionToken = localStorage.getItem("sessionToken");
        const sessionUserId = localStorage.getItem("sessionUserId");

        if (sessionToken && sessionUserId) {
            // 🌟 修正點 (問題1.2)：不再從 localStorage 讀取 isAdmin
            // 改為使用 verifyAdminPermission 動態驗證
            console.log("使用已存在的登入狀態，避免重新登入");

            // 先檢查是否為管理員（用於顯示管理員按鈕）
            const isUserAdmin = await verifyAdminPermission();
            loginResult = { isLoggedIn: true, isAdmin: isUserAdmin };

            // 恢復用戶介面
            document.getElementById("user-name").textContent = localStorage.getItem("userName") || "用戶";
            document.getElementById("profile-img").src = localStorage.getItem("userPicture") || "";
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('user-header').style.display = 'flex';
            document.getElementById('main-app').style.display = 'block';

            if (isUserAdmin) {
                document.getElementById('tab-admin-btn').style.display = 'block';
            }

            // 設置全域 userId 變數
            userId = sessionUserId;

            // 🚀 P2-1 優化：刪除自動初始化地圖，改為延遲加載
            // initLocationMap(); // ❌ 已移除，用戶點擊 location-view 時才初始化
            checkAbnormal();
            checkAutoPunch(); // 添加自動打卡檢查
        } else {
            // 沒有本地狀態，檢查會話
            loginResult = await ensureLogin();
        }
    }

    // ==========================================
    // V. 登入成功後的初始化 (關鍵修正區塊)
    // ==========================================
    if (loginResult.isLoggedIn) {
        checkAutoPunch(); // 來自 punch.js
        renderCalendar(currentMonthDate); // 來自 ui.js，員工自己的日曆
        // 載入今日打卡紀錄到 dashboard 即時回饋區
        if (typeof renderTodayPunches === 'function') {
            renderTodayPunches().catch(console.warn);
        }

        // 🚀 P2-1 優化修正：在登入成功後初始化地圖（延遲加載）
        // 確保地圖在應用初始化時就已準備好，但不會阻塞頁面加載
        if (typeof ensureMapInitialized === 'function') {
            ensureMapInitialized();
        }

        // 🌟 關鍵修正：只有管理員才啟動 loadAdminDashboard 🌟
        if (loginResult.isAdmin) {
            await loadAdminDashboard(); // 來自 admin.js，載入員工列表和綁定事件
        }
    }
});
// #endregion
/* Floating LINE 按鈕行為：長按隱藏、點擊開啟、雙擊顯示（會使用 data-line-url）
   改成在 DOMContentLoaded 後綁定，確保按鈕已存在於 DOM 中 */
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('floating-line-btn');
    if (!btn) return;

    const LINE_URL = btn.dataset.lineUrl || 'https://lin.ee/9j5mzVH';
    const HIDE_KEY = 'floatingLineBtnHidden_v1';
    const LONGPRESS_MS = 800;
    let longPressTimer = null;

    // 初始化隱藏狀態
    if (localStorage.getItem(HIDE_KEY) === '1') {
        btn.classList.add('hidden');
    }

    // 點擊打開連結（若為長按過程則忽略 click）
    btn.addEventListener('click', (e) => {
        if (longPressTimer) return;
        window.open(LINE_URL, '_blank');
    });

    function startLongPress() {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            btn.classList.add('hidden');
            localStorage.setItem(HIDE_KEY, '1');
            longPressTimer = null;
        }, LONGPRESS_MS);
    }
    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    // 支援滑鼠與觸控
    btn.addEventListener('mousedown', startLongPress);
    btn.addEventListener('touchstart', startLongPress, { passive: true });
    btn.addEventListener('mouseup', cancelLongPress);
    btn.addEventListener('mouseleave', cancelLongPress);
    btn.addEventListener('touchend', cancelLongPress);
    btn.addEventListener('touchcancel', cancelLongPress);

    // 雙擊快速顯示並清除儲存的隱藏狀態（方便測試）
    btn.addEventListener('dblclick', () => {
        btn.classList.remove('hidden');
        localStorage.removeItem(HIDE_KEY);
    });
});
