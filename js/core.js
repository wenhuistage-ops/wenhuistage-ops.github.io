
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
// ✅ P1-1 改進：i18n 模塊化遷移
// ===================================
// 國際化相關函數已遷移至 js/modules/i18n.js
//
// 已移轉的函數：
// - loadTranslations(lang) → modules/i18n.js
// - checkTranslationCompleteness(lang) → modules/i18n.js
// - t(code, params) → modules/i18n.js
// - renderTranslations(container) → modules/i18n.js
// - switchLanguage(lang) → modules/i18n.js
//
// 保留向後相容性：全局 t()、translations、currentLang 仍可直接使用
// ===================================

// ===================================
// #region 2. callApi
// ===================================

/**
 * 後端 API 呼叫入口（分流 GAS / Firestore）
 *
 * 依 API_CONFIG.useFirestore 決定底層實作：
 *   - true  → 呼叫 Cloud Functions（firestore-client.js）
 *   - false → 原有 GAS POST（以下實作）
 *
 * 回傳結構在兩端保持一致：{ ok, code, params, records, ... }
 * @param {object} params - 包含 action 和其他參數的物件
 * @param {string} [loadingId="loading"] - 顯示 loading 的 DOM ID
 * @returns {Promise<object>}
 */
async function callApifetch(params, loadingId = "loading") {
    // 後端固定走 Cloud Functions（Firestore）。舊 GAS 後端（含 JSONP 呼叫）已下線並移除，
    // 不再保留任何降級/回退路徑，避免殘留可被利用的弱後端呼叫碼。
    if (typeof callFirestoreFunction !== "function") {
        showNotification(t("CONNECTION_FAILED"), "error");
        throw new Error("callFirestoreFunction 未載入");
    }
    return await callFirestoreFunction(params, loadingId);
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
        // ⚠️ 一律向伺服器驗證，不信任 localStorage 快取：
        // 否則降權（管理員→一般員工）後，舊的 userDept 快取會讓對方繼續看到 admin UI；
        // 且該快取可被使用者於 devtools 自行竄改。安全邊界必須在伺服器。
        const res = await callApifetch({ action: 'checkSession' });
        if (res && res.ok && res.user) {
            const isAdmin = res.user.dept === "管理員";
            // 同步快取（僅供顯示用途），降權時一併清除
            try {
                if (isAdmin) localStorage.setItem("userDept", res.user.dept);
                else localStorage.removeItem("userDept");
            } catch (_) { /* ignore */ }
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
let _notificationTimer = null;
const showNotification = (message, type = 'success') => {
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    if (!notification || !notificationMessage) return;
    // 清掉上一則的計時器，避免殘留計時器把這則重要訊息提早關掉
    if (_notificationTimer) { clearTimeout(_notificationTimer); _notificationTimer = null; }
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
    // 點一下可手動關閉
    notification.style.cursor = 'pointer';
    notification.onclick = () => {
        notification.classList.remove('show');
        if (_notificationTimer) { clearTimeout(_notificationTimer); _notificationTimer = null; }
    };
    // 依訊息長度與類型調整停留時間：錯誤/警告久一點，長訊息加時，上限 8 秒
    const base = (type === 'error' || type === 'warning') ? 5000 : 3000;
    const len = message ? String(message).length : 0;
    const duration = Math.min(8000, base + Math.max(0, len - 20) * 60);
    _notificationTimer = setTimeout(() => {
        notification.classList.remove('show');
        _notificationTimer = null;
    }, duration);
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