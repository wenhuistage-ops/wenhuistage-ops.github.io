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
 * 檢查 URL 參數，若有 ?action=in|out 且已登入，直接觸發打卡。
 *
 * 2026-10-13：取消確認框。LINE 圖文選單的「上班 / 下班」就是這個連結，使用者要的是
 * 「點了就打卡」，再問一次等於每天多按一下。先前 F-M2 加確認框是擔心連結被轉傳給同事，
 * 但連結本身只會對「已登入的本人」打卡（需本機 sessionToken），轉傳給別人只會打到對方自己的卡，
 * 風險可接受；URL 參數仍會先清掉，避免重新整理 / PWA 還原分頁時重複打卡。
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

    // 先把 URL 參數清掉，否則重新整理／PWA 還原分頁時會又打一次卡。
    history.replaceState(null, '', window.location.pathname);

    showNotification(t("PUNCH_AUTO_TRIGGERED") || '正在自動打卡...', "info");
    // 保留小延遲，讓通知先畫出來
    setTimeout(() => targetButton.click(), 300);
}
// #endregion


// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkAutoPunch };
}
