/**
 * 自動打卡模組（從 punch.js Region 2 抽出）
 *
 * 職責：解析 URL 參數 `?action=in|out`，若符合則自動點擊對應打卡按鈕。
 * 使用場景：Line 通知或捷徑點擊後帶參返回頁面，一鍵完成打卡。
 *
 * 依賴全域：punchInBtn、punchOutBtn（state.js）、showNotification（core.js）、
 *           t（i18n.js）、sessionToken 於 localStorage
 *
 * 載入順序：必須在 punch.js 之前載入（index.html 已處理）。
 */

// ===================================
// #region 自動打卡
// ===================================

/**
 * 檢查 URL 參數，若有 ?action=punch 則自動觸發打卡。
 */
function checkAutoPunch() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    // 🌟 修正點：使用全域變數 🌟
    let targetButton = null;

    if (action === 'in' && punchInBtn) { // punchInBtn 來自 state.js
        targetButton = punchInBtn;
    } else if (action === 'out' && punchOutBtn) { // punchOutBtn 來自 state.js
        targetButton = punchOutBtn;
    }

    if (targetButton) {
        // sessionToken 是在 app.js 的登入流程中設置的，這裡直接檢查即可
        if (localStorage.getItem("sessionToken")) {
            showNotification(t("PUNCH_AUTO_TRIGGERED") || '正在自動打卡...', "info");

            setTimeout(() => {
                // 觸發目標打卡按鈕的點擊事件
                targetButton.click();
                // 清除 URL 參數
                history.replaceState(null, '', window.location.pathname);
            }, 500);

        } else {
            showNotification(t("PUNCH_REQUIRE_LOGIN") || '請先登入才能自動打卡！', "warning");
        }
    }
}
// #endregion

console.log('✓ auto-punch 模組已加載');

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkAutoPunch };
}
