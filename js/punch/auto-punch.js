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
 * 檢查 URL 參數，若有 ?action=in|out 則詢問後觸發打卡。
 *
 * F-M2：原本一開連結就直接打卡，完全沒有確認 —— 任何人把 `?action=out` 貼給同事，
 * 對方一點開就被打了下班卡。改成先跳確認框，由本人按下去才送出。
 * @returns {Promise<void>}
 */
async function checkAutoPunch() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    // 🌟 修正點：使用全域變數 🌟
    let targetButton = null;

    if (action === 'in' && punchInBtn) { // punchInBtn 來自 state.js
        targetButton = punchInBtn;
    } else if (action === 'out' && punchOutBtn) { // punchOutBtn 來自 state.js
        targetButton = punchOutBtn;
    }

    if (!targetButton) return;

    // sessionToken 是在 app.js 的登入流程中設置的，這裡直接檢查即可
    if (!localStorage.getItem("sessionToken")) {
        showNotification(t("PUNCH_REQUIRE_LOGIN") || '請先登入才能自動打卡！', "warning");
        return;
    }

    // 先把 URL 參數清掉：無論按確認或取消都不該留著，
    // 否則重新整理／PWA 還原分頁時又會再問一次（甚至又打一次卡）。
    const typeText = t(action === 'in' ? 'PUNCH_IN' : 'PUNCH_OUT');
    history.replaceState(null, '', window.location.pathname);

    const confirmed = (typeof showConfirmDialog === 'function')
        ? await showConfirmDialog(tOr('CONFIRM_AUTO_PUNCH', '確定要打「{type}」卡嗎？', { type: typeText }))
        : true;
    if (!confirmed) return;

    showNotification(t("PUNCH_AUTO_TRIGGERED") || '正在自動打卡...', "info");
    // 保留原本的小延遲，讓通知先畫出來、也避開確認框關閉動畫
    setTimeout(() => targetButton.click(), 300);
}
// #endregion


// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkAutoPunch };
}
