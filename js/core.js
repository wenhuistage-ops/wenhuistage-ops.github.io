
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
        const res = await callApifetch({ action: 'checkSession', language: currentLang });
        if (res && res.ok && res.user) {
            const isAdmin = res.user.dept === "管理員";
            // 順手同步員工端「LINE 漏打卡提醒」開關（重新整理時走這條路徑，不經 ensureLogin）
            const reminderCb = document.getElementById('punch-reminder-toggle');
            if (reminderCb) reminderCb.checked = res.user.punchReminder === true;
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

/* ===== 除錯輸出 ===== */
/**
 * 只在除錯模式下印訊息（F-L4）。
 *
 * 原本全站 78 個 console.log 在正式環境照印，其中數個會印出 LINE userId、
 * GPS 座標與整筆出勤紀錄 —— 任何借用手機的人打開開發者工具就看得到。
 * console.error / console.warn 保留不動（那是真的異常，需要能追）。
 *
 * 開啟方式：localStorage.setItem('debug','1') 後重整；localhost 自動開啟。
 */
const DEBUG_ENABLED = (() => {
    try {
        if (localStorage.getItem('debug') === '1') return true;
    } catch (_) { /* localStorage 不可用 */ }
    const h = (typeof location !== 'undefined' && location.hostname) || '';
    return h === 'localhost' || h === '127.0.0.1';
})();

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

/* ===== HTML 轉義 ===== */
/**
 * 把使用者可控的字串（備註、請假原因、姓名、地點名稱…）轉成安全文字後再拼進 innerHTML。
 * DOMPurify 只擋 script，不擋「長得像按鈕的 HTML」（例如備註裡放一顆 .admin-delete-record-btn，
 * 事件委派會把它當真的按鈕）；拼字串前一律先過這裡，DOMPurify 當第二層。
 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

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
    } else if (type === 'info') {
        notification.classList.add('bg-blue-500', 'text-white');
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
 * @param {{variant?: 'neutral'|'warning'|'danger'}} [options]
 *        U-L8：確認鍵的顏色。style.css 依 `.confirm-ok-btn[data-variant]` 上色，
 *        預設中性；只有刪除紀錄、標記離職這類破壞性操作才傳 'danger'。
 *        舊呼叫端只傳 message，行為不變（＝中性色）。
 * @returns {Promise<boolean>} 用戶是否點擊確認
 */
function showConfirmDialog(message, options = {}) {
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

        // U-L8：每次開啟都重設 variant，否則上一次的破壞性紅色會殘留到下一個對話框
        if (okBtn) {
            const variant = options && options.variant;
            okBtn.dataset.variant = (variant === 'danger' || variant === 'warning') ? variant : 'neutral';
        }

        // 防止背景滾動，避免對話框偏移
        document.body.style.overflow = 'hidden';

        // U-M12：對話框缺 role/aria-modal，讀屏軟體不知道這是強制回應的對話框。
        // index.html 由他人維護，改由此處在開啟時補上（等效且不必動 HTML）。
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');

        // U-M12：記住觸發者，關閉後把焦點還回去（否則焦點掉回 <body>，
        // 鍵盤使用者要從頭 Tab 一遍才能回到原本的位置）。
        const previouslyFocused = document.activeElement;

        // 焦點放到第一個可操作元素（DOM 順序上是「取消」）。
        // 這一步是 Esc 能生效的前提：keydown 綁在 dialog 上，焦點不在裡面就收不到。
        // 順帶讓誤按 Enter 落在「取消」而非破壞性的「確認」。
        const focusTarget = cancelBtn || okBtn || dialog;
        try { focusTarget.focus({ preventScroll: true }); } catch (_) { try { focusTarget.focus(); } catch (__) { /* ignore */ } }

        // 定義一個函數來清理事件監聽器和恢復滾動
        const cleanup = () => {
            dialog.style.display = 'none';
            if (okBtn) okBtn.removeEventListener('click', onOk);
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keydown', onKeyDown, true);
            // 不移除 role/aria-modal：index.html 本來就寫了這些屬性，
            // 關閉時清掉等於把靜態標記也一起弄丟（對話框關閉時是 display:none，讀屏本就會略過）
            // 恢復背景滾動
            document.body.style.overflow = '';
            // 還原焦點（元素可能已被重繪移除，故先確認還在文件內）
            if (previouslyFocused && typeof previouslyFocused.focus === 'function' &&
                document.contains(previouslyFocused)) {
                try { previouslyFocused.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
            }
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
                e.preventDefault();
                cleanup();
                resolve(false);
                return;
            }
            // 簡易焦點循環：只有兩顆按鈕，Tab / Shift+Tab 在兩者之間繞，
            // 避免焦點跑到對話框後面的頁面上（看不見卻可操作）。
            if (e.key === 'Tab' && okBtn && cancelBtn) {
                e.preventDefault();
                const next = (document.activeElement === cancelBtn) ? okBtn : cancelBtn;
                try { next.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
            }
        };

        if (okBtn) okBtn.addEventListener('click', onOk);
        if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('keydown', onKeyDown);
        // 保險：若焦點被其他程式碼搶走（例如剛關閉的 modal 還原焦點），
        // capture 階段的 document 監聽仍能讓 Esc 關掉這個對話框。
        document.addEventListener('keydown', onKeyDown, true);
    });
}

// ===================================
// #region 5. 翻譯後備（key 還沒進 i18n 檔時不要把 key 秀給使用者）
// ===================================

/**
 * 取翻譯；找不到就用中文 fallback。
 *
 * t() 找不到 key 時會回傳 key 本身（例如 'MSG_SUBMITTING'），而它是 truthy，
 * 所以常見的 `t('X') || '中文'` 寫法其實永遠拿不到 fallback，按鈕會直接顯示
 * 大寫英文 key。新增 key 尚未併進 i18n/*.json 的空窗期都靠這支擋著。
 * （geolocation.js 的 tr_geo 是同樣做法，這裡提供給其他模組共用。）
 *
 * @param {string} key i18n 鍵
 * @param {string} fallback 找不到時顯示的中文（同樣支援 {param} 佔位符）
 * @param {object} [params] 參數替換
 * @returns {string}
 */
function tOr(key, fallback, params = {}) {
    let value = null;
    try {
        if (typeof t === 'function') value = t(key, params);
    } catch (_) { /* ignore */ }
    if (value && value !== key) return value;

    let text = String(fallback ?? '');
    for (const k in params) text = text.replace(`{${k}}`, params[k]);
    return text;
}

// ===================================
// #region 6. 裝置標記（取代把整串 userAgent 寫進人資紀錄）
// ===================================

/**
 * F-L5：打卡備註原本塞整串 navigator.userAgent，等於把瀏覽器指紋寫進人資紀錄，
 * 管理員畫面還會整串顯示。改成極簡的「作業系統/瀏覽器」標記，足夠排查又不留指紋。
 * @returns {string} 例如 'iOS/LINE'、'Android/Chrome'、'Windows/Edge'
 */
function deviceTag() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
        : /Android/i.test(ua) ? 'Android'
            : /Macintosh|Mac OS X/i.test(ua) ? 'Mac'
                : /Windows/i.test(ua) ? 'Windows'
                    : 'Other';
    // 順序有意義：LINE 內建瀏覽器的 UA 也含 Safari/Chrome，必須先判斷
    const browser = /\bLine\//i.test(ua) ? 'LINE'
        : /Edg(iOS|A)?\//i.test(ua) ? 'Edge'
            : /CriOS\/|Chrome\//i.test(ua) ? 'Chrome'
                : /FxiOS\/|Firefox\//i.test(ua) ? 'Firefox'
                    : /Safari\//i.test(ua) ? 'Safari'
                        : 'Other';
    return `${os}/${browser}`;
}

// #endregion
// ===================================