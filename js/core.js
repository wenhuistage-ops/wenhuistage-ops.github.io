
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
// #region 1. i18n相關
// ===================================
async function loadTranslations(lang) {
    try {
        const res = await fetch(`https://wenhuistage-ops.github.io/i18n/${lang}.json`);
        if (!res.ok) {
            throw new Error(`HTTP 錯誤: ${res.status}`);
        }
        translations = await res.json();
        currentLang = lang;
        localStorage.setItem("lang", lang);

        // 檢查翻譯完整性
        checkTranslationCompleteness(lang);

        renderTranslations();
    } catch (err) {
        console.error("載入語系失敗:", err);
    }
}

/**
 * 檢查翻譯的完整性，找出缺失的鍵值
 * @param {string} lang - 語言代碼
 */
function checkTranslationCompleteness(lang) {
    // 定義必須的核心翻譯鍵值（常用的UI元素）
    const coreTranslationKeys = [
        'APP_TITLE', 'SUBTITLE_LOGIN', 'LOGIN_INFO', 'BTN_LOGOIN',
        'BTN_LOGOUT', 'BTN_CANCEL', 'BTN_CONFIRM',
        'PUNCH_SECTION_TITLE', 'PUNCH_SECTION_DESCRIPTION',
        'PUNCH_IN_LABEL', 'PUNCH_OUT_LABEL',
        'TAB_DASHBOARD', 'TAB_MONTHLY', 'TAB_LOCATION', 'TAB_ADMIN'
    ];

    const missingKeys = [];
    coreTranslationKeys.forEach(key => {
        if (!translations[key]) {
            missingKeys.push(key);
        }
    });

    if (missingKeys.length > 0) {
        console.warn(`⚠️ 語言 ${lang} 缺少以下翻譯鍵值:`, missingKeys);
        console.warn(`建議檢查 i18n/${lang}.json 文件`);
    } else {
        console.log(`✅ 語言 ${lang} 的核心翻譯鍵值完整`);
    }

    // 記錄翻譯統計資訊
    const totalKeys = Object.keys(translations).length;
    console.log(`語言 ${lang} 共有 ${totalKeys} 個翻譯鍵值`);
}


// 翻譯函式
function t(code, params = {}) {
    let text = translations[code] || code;

    // 檢查並替換參數中的變數
    for (const key in params) {
        // 在替換之前，先翻譯參數的值
        let paramValue = params[key];
        if (paramValue in translations) {
            paramValue = translations[paramValue];
        }

        text = text.replace(`{${key}}`, paramValue);
    }
    return text;
}
// renderTranslations 可接受一個容器參數
function renderTranslations(container = document) {
    // 翻譯網頁標題（只在整頁翻譯時執行）
    if (container === document) {
        document.title = t("APP_TITLE");
    }

    // 處理靜態內容：[data-i18n]
    const elementsToTranslate = container.querySelectorAll('[data-i18n]');
    elementsToTranslate.forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translatedText = t(key);

        // 檢查翻譯結果是否為空字串，或是否回傳了原始鍵值
        if (translatedText !== key) {
            if (element.tagName === 'INPUT') {
                element.placeholder = translatedText;
            } else {
                element.textContent = translatedText;
            }
        }
    });

    // ✨ 新增邏輯：處理動態內容的翻譯，使用 [data-i18n-key]
    const dynamicElements = container.querySelectorAll('[data-i18n-key]');
    dynamicElements.forEach(element => {
        const key = element.getAttribute('data-i18n-key');
        if (key) {
            const translatedText = t(key);

            // 只有當翻譯結果不是原始鍵值時才進行更新
            if (translatedText !== key) {
                element.textContent = translatedText;
            }
        }
    });
}
// #endregion
// ===================================

// ===================================
// #region 2. callApi
// ===================================

/**
 * 透過 fetch API 呼叫後端 API。
 * ✅ 改進 2.1：改用 POST 請求，token 在 body 中，不在 URL 中
 * @param {object} params - 包含 action 和所有其他參數的物件 (e.g., { action: '...', month: '...', userId: '...' })
 * @param {string} [loadingId="loading"] - 顯示 loading 狀態的 DOM 元素 ID。
 * @returns {Promise<object>} - 回傳一個包含 API 回應資料的 Promise。
 */
async function callApifetch(params, loadingId = "loading") {
    const token = localStorage.getItem("sessionToken");

    // 1. 構造 URLSearchParams 物件（用於 POST body）
    const searchParams = new URLSearchParams(params);

    // ✅ 改進：將 token 放在 body 中，不在 URL 中
    searchParams.set("token", token);

    // 2. 加入 callback 參數以使用 JSONP 避免 CORS 問題
    const callback = 'callback' + Date.now() + Math.random().toString(36).substr(2, 9);
    searchParams.set("callback", callback);

    // 3. 構造 API URL（不包含任何參數）
    const url = API_CONFIG.apiUrl;

    // 顯示指定的 loading 元素
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.style.display = "block";

    try {
        // ✅ 改進：改用 POST 請求，避免 token 在 URL 中洩露
        const response = await fetch(url, {
            method: 'POST',  // 🌟 改為 POST
            mode: 'cors',
            body: searchParams.toString(),  // 參數放在 body 中
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        // 檢查 HTTP 狀態碼
        if (!response.ok) {
            throw new Error(`HTTP 錯誤: ${response.status}`);
        }

        // 解析 JSON 回應
        let text = await response.text();
        try {
            return JSON.parse(text);
        } catch (jsonError) {
            // 若回傳類似 callback({...}) 的 JSONP，嘗試抽取 JSON
            const match = text.match(/^[^(]*\((.*)\)\s*;?\s*$/s);
            if (match && match[1]) {
                return JSON.parse(match[1]);
            }
            throw jsonError;
        }
    } catch (error) {
        // 處理網路或其他錯誤
        showNotification(t("CONNECTION_FAILED"), "error");
        console.error("API 呼叫失敗:", error);
        // 拋出錯誤以便外部捕獲
        throw error;
    } finally {
        // 不論成功或失敗，都隱藏 loading 元素
        if (loadingEl) loadingEl.style.display = "none";
    }
}

// #endregion
// ===================================

// ===================================
// #region 3. 管理員權限驗證
// ===================================

/**
 * 驗證當前用戶是否為管理員（每次都查詢服務器）
 * 這是修復問題 1.1 & 1.2 的關鍵函數
 * @returns {Promise<boolean>} 是否為管理員
 */
async function verifyAdminPermission() {
    try {
        // 首先檢查 localStorage 中是否有用戶部門信息
        const userDept = localStorage.getItem("userDept");
        if (userDept === "管理員") {
            return true;
        }

        // 如果沒有部門信息，調用 checkSession API 驗證
        const res = await callApifetch({ action: 'checkSession' });
        if (res && res.ok && res.user) {
            const isAdmin = res.user.dept === "管理員";
            // 保存部門信息供後續使用
            if (isAdmin) {
                localStorage.setItem("userDept", res.user.dept);
            }
            return isAdmin;
        }
        return false;
    } catch (error) {
        console.error("驗證管理員權限失敗:", error);
        return false;
    }
}

/**
 * 安全的管理員操作包裝器
 * 在執行管理員操作前驗證權限
 * @param {Function} adminOperation - 要執行的管理員操作函數
 * @returns {Promise<boolean>} 操作是否成功執行
 */
async function executeAdminOperation(adminOperation) {
    const isAdmin = await verifyAdminPermission();
    if (!isAdmin) {
        showNotification(t("ERR_NO_PERMISSION") || "您沒有管理員權限", "error");
        return false;
    }

    try {
        await adminOperation();
        return true;
    } catch (error) {
        console.error("管理員操作失敗:", error);
        showNotification(t("OPERATION_FAILED") || "操作失敗，請稍後重試", "error");
        return false;
    }
}

// #endregion
// ===================================

/* ===== 共用訊息顯示 ===== */
const showNotification = (message, type = 'success') => {
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    notificationMessage.textContent = message;
    notification.className = 'notification'; // reset classes
    if (type === 'success') {
        notification.classList.add('bg-green-500', 'text-white');
    } else if (type === 'warning') {
        notification.classList.add('bg-yellow-500', 'text-white');
    } else {
        notification.classList.add('bg-red-500', 'text-white');
    }
    notification.classList.add('show');
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
};

// ===================================
// #region 4. 確認對話框（問題8.6）
// ===================================

/**
 * 顯示確認對話框
 * @param {string} message - 確認訊息
 * @returns {Promise<boolean>} 用戶是否點擊確認
 */
function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirm-dialog');
        const messageEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!dialog || !messageEl) {
            console.error("確認對話框 DOM 元素未找到");
            resolve(false);
            return;
        }

        messageEl.textContent = message;
        dialog.style.display = 'flex';

        // 防止背景滾動，避免對話框偏移
        document.body.style.overflow = 'hidden';

        // 定義一個函數來清理事件監聽器和恢復滾動
        const cleanup = () => {
            dialog.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('keydown', onKeyDown);
            // 恢復背景滾動
            document.body.style.overflow = '';
        };

        const onOk = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(false);
            }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('keydown', onKeyDown);
    });
}

// #endregion
// ===================================