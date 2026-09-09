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

// U-H3：httpsCallable 預設逾時 70 秒，弱網下打卡按鈕會卡在「處理中…」超過一分鐘，
// 員工只會重按或離開。逾時後走既有的 ERR_FIRESTORE_CALL_FAILED 文案。
//
// 分兩級：Cloud Functions 冷啟動（容器沒在跑）本身就可能吃掉 5~15 秒，
// 對登入與報表一律用 15 秒會在冷啟動時直接失敗，比慢還糟。
//   - 打卡類：員工手指還按在螢幕上，回饋速度優先 → 15 秒
//   - 其他（登入、月報、Excel 匯出）：容忍冷啟動 → 30 秒，仍遠優於預設 70 秒
const FUNCTIONS_CALL_TIMEOUT_MS = 30000;
const FUNCTIONS_FAST_TIMEOUT_MS = 15000;
const FAST_TIMEOUT_ACTIONS = ["punch", "punchWithoutLocation"];

/** 依 action 決定逾時長度（見上方註解的兩級策略） */
function callTimeoutFor(action) {
  return FAST_TIMEOUT_ACTIONS.includes(action)
    ? FUNCTIONS_FAST_TIMEOUT_MS
    : FUNCTIONS_CALL_TIMEOUT_MS;
}

// U-H5：session 失效類錯誤碼，任何一支 API 回這些都要統一處理（清狀態 + 導回登入）
const SESSION_INVALID_CODES = ["ERR_SESSION_EXPIRED", "ERR_SESSION_INVALID", "ERR_ACCOUNT_INACTIVE"];

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

      debugLog(`🔥 Firebase 初始化成功（${cfg.projectId} @ ${cfg.region || "asia-southeast1"}）`);
      return { ok: true };
    } catch (err) {
      console.error("🔥 Firebase SDK 載入失敗：", err);
      return { ok: false, reason: "SDK_LOAD_FAILED", error: err?.message };
    }
  })();

  return _initPromise;
}

// ===================================
// #region 全域載入指示（U-M14）
// ===================================
//
// 原本 callFirestoreFunction 預設 loadingId = "loading"，但 index.html 裡沒有 #loading
// 這個元素（#loadingMsg 也不存在），等於所有 API 呼叫期間畫面上毫無反應。
// index.html 由他人維護，這裡改用 JS 動態建立一條頂端進度條，並以計數器支援併發。

let _inflightCalls = 0;
let _progressBarEl = null;

/** 建立（或取回）頂端進度條元素；無 document 的環境（Node）回 null */
function _ensureProgressBar() {
  if (typeof document === "undefined" || !document.body) return null;
  if (_progressBarEl && document.body.contains(_progressBarEl)) return _progressBarEl;

  // 動畫只注入一次
  if (!document.getElementById("api-progress-style")) {
    const style = document.createElement("style");
    style.id = "api-progress-style";
    style.textContent = `
      @keyframes api-progress-slide {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
      #api-progress-bar > span {
        display:block; height:100%; width:25%;
        background:linear-gradient(90deg,#6366f1,#22d3ee);
        animation: api-progress-slide 1.1s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        #api-progress-bar > span { animation-duration: 2.4s; }
      }`;
    document.head.appendChild(style);
  }

  const bar = document.createElement("div");
  bar.id = "api-progress-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "loading");
  bar.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0", "height:3px",
    "z-index:10050", "overflow:hidden", "pointer-events:none",
    "background:rgba(99,102,241,.15)", "display:none",
  ].join(";");
  bar.appendChild(document.createElement("span"));
  document.body.appendChild(bar);
  _progressBarEl = bar;
  return bar;
}

/** 進入 API 呼叫：計數 +1，第一個請求負責顯示 */
function _startGlobalLoading() {
  _inflightCalls++;
  const bar = _ensureProgressBar();
  if (bar) bar.style.display = "block";
}

/** 離開 API 呼叫：計數 -1，最後一個請求結束才隱藏（支援併發） */
function _endGlobalLoading() {
  _inflightCalls = Math.max(0, _inflightCalls - 1);
  if (_inflightCalls === 0 && _progressBarEl) _progressBarEl.style.display = "none";
}
// #endregion

// ===================================
// #region Session 失效統一攔截（U-H5）
// ===================================

let _sessionExpiryHandled = false;

/**
 * 判斷回應是不是「session 已經不能用了」。
 * @param {{ok?: boolean, code?: string}} res
 */
function isSessionInvalidResponse(res) {
  return !!res && res.ok === false && SESSION_INVALID_CODES.includes(res.code);
}

/**
 * session 失效的統一處理：清本機登入狀態 → 提示重新登入 → 導回登入畫面。
 * 用 _sessionExpiryHandled 擋重複觸發：月曆／異常清單／打卡常常同時在跑，
 * 三個請求一起 401 的話不該連跳三次通知、導向三次。
 * @param {string} code 觸發的錯誤碼（僅供 log）
 */
function handleSessionExpired(code) {
  if (_sessionExpiryHandled) return;
  _sessionExpiryHandled = true;
  console.warn("🔒 session 失效，強制重新登入：", code);

  // 只有「本來是登入狀態」才導回登入頁：沒有 token 卻收到這些碼（例如尚未登入
  // 就打到需要驗證的 API）只要清乾淨即可，貿然導頁會打斷 LINE OAuth 回跳流程。
  let hadToken = false;
  try { hadToken = !!localStorage.getItem("sessionToken"); } catch (_) { /* ignore */ }

  ["sessionToken", "sessionUserId", "userDept", "userName", "userPicture", "userId", "isAdmin"]
    .forEach((k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } });
  try { if (typeof clearUserState === "function") clearUserState(); } catch (_) { /* ignore */ }

  // 停用帳號要講「帳號被停用」，講「請重新登入」只會讓人一直重登
  const msgKey = (code === "ERR_ACCOUNT_INACTIVE") ? "ERR_ACCOUNT_INACTIVE" : "PLEASE_RELOGIN";
  const msg = (typeof t === "function") ? t(msgKey) : "請重新登入";
  // 延遲一拍再顯示：呼叫端拿到回應後通常會自己 showNotification(t(res.code))，
  // 那則「Session 已過期」會蓋掉我們的訊息。最後說話的才是使用者看到的。
  setTimeout(() => {
    try {
      if (typeof showNotification === "function") showNotification(msg, "warning");
    } catch (_) { /* ignore */ }
  }, 60);

  if (!hadToken) return;
  // 留 2 秒讓使用者看完通知再導回登入畫面（與 app.js 登出同一個目的地）
  setTimeout(() => {
    try { window.location.href = "/index.html"; } catch (_) { /* ignore */ }
  }, 2000);
}
// #endregion

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
  // 進度條在 SDK 動態載入「之前」就開始跑：第一次呼叫要從 CDN 抓 Firebase SDK，
  // 正是最久、最需要有反應的那一次（initFirestoreClient 內部自己 catch，不會丟出）。
  _startGlobalLoading();

  const init = await initFirestoreClient();
  if (!init.ok) {
    _endGlobalLoading();
    // 未配置或 SDK 載入失敗：回傳標準格式錯誤
    return {
      ok: false,
      code: "ERR_FIRESTORE_NOT_CONFIGURED",
      params: { reason: init.reason || "UNKNOWN" },
      _note: "Firestore client 尚未配置：請於 js/config.js 填入 firebase 設定並設 useFirestore=true",
    };
  }

  // 舊介面相容：呼叫端仍會傳 loadingId，若該元素真的存在就照舊顯示；
  // 不存在（目前 index.html 就是如此）則由 U-M14 的全域頂端進度條負責。
  const loadingEl = loadingId ? document.getElementById(loadingId) : null;
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

    // U-H3：帶 timeout，逾時會丟 functions/deadline-exceeded，落到下面的 catch
    const fn = _httpsCallable(_functions, action, { timeout: callTimeoutFor(action) });
    const res = await fn(payload);

    // onCall 回傳格式：{ data: {...} }，Cloud Function 本身回 { ok, code, ... }
    const data = res?.data || { ok: false, code: "ERR_EMPTY_RESPONSE" };

    // U-H5：session 失效統一在這裡攔截，避免每支呼叫端各自（或根本沒有）處理，
    // 造成「畫面還顯示已登入、但每個動作都默默失敗」。
    if (isSessionInvalidResponse(data)) handleSessionExpired(data.code);

    return data;
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
    _endGlobalLoading();
  }
}
// #endregion


// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    initFirestoreClient,
    callFirestoreFunction,
    isSessionInvalidResponse,
    handleSessionExpired,
    SESSION_INVALID_CODES,
    FUNCTIONS_CALL_TIMEOUT_MS,
    FUNCTIONS_FAST_TIMEOUT_MS,
    callTimeoutFor,
  };
}
