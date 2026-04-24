/**
 * Firestore / Cloud Functions 客戶端封裝
 *
 * 目的：提供與 callApifetch 相同簽名的後端呼叫介面，
 *      讓業務層程式碼無需知道底層是 GAS 還是 Cloud Functions。
 *
 * 狀態：**骨架階段**——尚未接入 Firebase SDK。
 *      當 API_CONFIG.useFirestore=true 且呼叫進來時會回傳結構化的「未配置」錯誤，
 *      不會打到任何網路資源、不會改動任何資料。
 *
 * 完整啟用步驟見 docs/plans/Firestore切換策略-分支vs主線.md：
 *   1. 建立 Firebase 專案、取得 config、填入 API_CONFIG.firebase
 *   2. 在 index.html 加載 Firebase Web SDK（CDN）
 *   3. 實作下方 initFirestoreClient()、callFirestoreFunction()
 *   4. 部署對應的 Cloud Functions（firebase-functions/）
 */

// ===================================
// #region Firebase 實例（延遲初始化）
// ===================================

let _firebaseApp = null;
let _functions = null;
let _firestore = null;
let _initAttempted = false;

/**
 * 延遲初始化 Firebase（第一次用到時才載入）
 * 目前是空殼，待實作。
 */
async function initFirestoreClient() {
  if (_initAttempted) return { ok: !!_functions };
  _initAttempted = true;

  const cfg = API_CONFIG.firebase;
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    console.warn("🔥 Firebase 未配置 — 請於 API_CONFIG.firebase 填入專案資訊");
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  // TODO: 實際整合時在此載入 Firebase Web SDK（CDN 模組），例如：
  //   const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  //   const { getFunctions } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js");
  //   const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  //   _firebaseApp = initializeApp(cfg);
  //   _functions = getFunctions(_firebaseApp, cfg.region || "asia-southeast1");
  //   _firestore = getFirestore(_firebaseApp);

  console.warn("🔥 Firestore client initFirestoreClient() 尚未實作 SDK 載入，回傳未配置");
  return { ok: false, reason: "SDK_NOT_LOADED" };
}

// ===================================
// #region 呼叫介面（對應 callApifetch）
// ===================================

/**
 * Firestore / Cloud Functions 版本的 API 呼叫介面
 * 簽名與 callApifetch 一致：callFirestoreFunction({ action, ...params }, loadingId)
 *
 * @param {Object} params { action: string, ...其餘欄位 }
 * @param {string} loadingId loading DOM 元素 ID
 * @returns {Promise<Object>} { ok, code, params, records, ... }（格式與 GAS 回應相容）
 */
async function callFirestoreFunction(params, loadingId = "loading") {
  const init = await initFirestoreClient();
  if (!init.ok) {
    // 未配置：回傳標準格式錯誤，讓呼叫端（showNotification 等）能正常處理
    return {
      ok: false,
      code: "ERR_FIRESTORE_NOT_CONFIGURED",
      params: { reason: init.reason || "UNKNOWN" },
      _note: "Firestore client 尚未配置，請見 docs/plans/Firestore切換策略-分支vs主線.md",
    };
  }

  const loadingEl = document.getElementById(loadingId);
  if (loadingEl) loadingEl.style.display = "block";

  try {
    // TODO: 實際整合時，將 params.action 映射到對應的 Cloud Function：
    //   const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js");
    //   const fn = httpsCallable(_functions, params.action);
    //   const res = await fn({
    //     sessionToken: localStorage.getItem("sessionToken"),
    //     ...params,
    //   });
    //   return res.data;  // Cloud Function 需回傳 { ok, code, ... } 格式

    return {
      ok: false,
      code: "ERR_FIRESTORE_NOT_IMPLEMENTED",
      params: { action: params.action || "unknown" },
    };
  } catch (err) {
    console.error("🔥 callFirestoreFunction 失敗：", err);
    return {
      ok: false,
      code: "ERR_FIRESTORE_CALL_FAILED",
      params: { message: err?.message || String(err) },
    };
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}
// #endregion

console.log("✓ firestore-client 模組已載入（骨架，待實作）");

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== "undefined" && module.exports) {
  module.exports = { initFirestoreClient, callFirestoreFunction };
}
