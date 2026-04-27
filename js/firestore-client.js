/**
 * Firestore / Cloud Functions 客戶端封裝
 *
 * 目的：提供與 callApifetch 相同簽名的後端呼叫介面，
 *      讓業務層程式碼無需知道底層是 GAS 還是 Cloud Functions。
 *
 * 狀態：**已接入 Firebase Web SDK v10（CDN 動態 import）**。
 *      若 API_CONFIG.firebase 未填則回 ERR_FIRESTORE_NOT_CONFIGURED；
 *      已填但 Cloud Functions 尚未部署則回 ERR_FIRESTORE_CALL_FAILED。
 *
 * 依賴：
 *   - API_CONFIG.firebase（js/config.js）
 *   - Cloud Functions 部署（firebase-functions/）
 */

// ===================================
// #region Firebase 實例（延遲初始化）
// ===================================

// Firebase Web SDK 版本（若需升級統一改這個）
const FIREBASE_SDK_VERSION = "10.14.1";
const FIREBASE_CDN_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let _firebaseApp = null;
let _functions = null;
let _firestore = null;
let _httpsCallable = null;
let _initPromise = null;

/**
 * 延遲初始化 Firebase（第一次用到時才載入 SDK）
 * 使用 dynamic import + CDN，無需 npm install。
 */
async function initFirestoreClient() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const cfg = API_CONFIG.firebase;
    if (!cfg || !cfg.apiKey || !cfg.projectId) {
      console.warn("🔥 Firebase 未配置 — 請於 API_CONFIG.firebase 填入專案資訊");
      return { ok: false, reason: "NOT_CONFIGURED" };
    }

    try {
      const [{ initializeApp }, { getFunctions, httpsCallable }, { getFirestore }] = await Promise.all([
        import(/* @vite-ignore */ `${FIREBASE_CDN_BASE}/firebase-app.js`),
        import(/* @vite-ignore */ `${FIREBASE_CDN_BASE}/firebase-functions.js`),
        import(/* @vite-ignore */ `${FIREBASE_CDN_BASE}/firebase-firestore.js`),
      ]);

      _firebaseApp = initializeApp(cfg);
      _functions = getFunctions(_firebaseApp, cfg.region || "asia-southeast1");
      _firestore = getFirestore(_firebaseApp);
      _httpsCallable = httpsCallable;

      console.log(`🔥 Firebase 初始化成功（${cfg.projectId} @ ${cfg.region || "asia-southeast1"}）`);
      return { ok: true };
    } catch (err) {
      console.error("🔥 Firebase SDK 載入失敗：", err);
      return { ok: false, reason: "SDK_LOAD_FAILED", error: err?.message };
    }
  })();

  return _initPromise;
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
    // 未配置或 SDK 載入失敗：回傳標準格式錯誤
    return {
      ok: false,
      code: "ERR_FIRESTORE_NOT_CONFIGURED",
      params: { reason: init.reason || "UNKNOWN" },
      _note: "Firestore client 尚未配置：請於 js/config.js 填入 firebase 設定並設 useFirestore=true",
    };
  }

  const loadingEl = document.getElementById(loadingId);
  if (loadingEl) loadingEl.style.display = "block";

  try {
    const action = params.action;
    if (!action) {
      return { ok: false, code: "ERR_MISSING_ACTION" };
    }

    // 把 action 之外的 params + sessionToken 傳給 Cloud Function
    const { action: _, ...rest } = params;
    const payload = {
      sessionToken: localStorage.getItem("sessionToken"),
      ...rest,
    };

    const fn = _httpsCallable(_functions, action);
    const res = await fn(payload);

    // onCall 回傳格式：{ data: {...} }，Cloud Function 本身回 { ok, code, ... }
    return res?.data || { ok: false, code: "ERR_EMPTY_RESPONSE" };
  } catch (err) {
    console.error("🔥 callFirestoreFunction 失敗：", err);
    return {
      ok: false,
      code: "ERR_FIRESTORE_CALL_FAILED",
      params: {
        message: err?.message || String(err),
        functionCode: err?.code || "unknown",
      },
    };
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
  }
}
// #endregion

console.log("✓ firestore-client 模組已載入");

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== "undefined" && module.exports) {
  module.exports = { initFirestoreClient, callFirestoreFunction };
}
