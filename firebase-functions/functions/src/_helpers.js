/**
 * 共用 helper
 *
 * - Firebase Admin 單例初始化
 * - LINE OAuth / Messaging secrets 宣告
 * - session token 驗證、管理員驗證
 * - 座標驗證、GPS 距離計算（Haversine）
 * - 集合名稱常數
 */

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");

if (!admin.apps.length) {
  admin.initializeApp();
}

// 明確使用 'default'（asia-east1）資料庫——非 SDK 預設的 (default) nam5
// 之所以指定，是因為專案中同時存在兩個 database：
//   - (default) 在 nam5（自動建立的標準 default）
//   - default 在 asia-east1（使用者手動建立、距離台灣近）
// 為避免 SDK routing 不確定性造成 NOT_FOUND，全部明確指 'default'
const FIRESTORE_DATABASE_ID = "default";
const db = getFirestore(admin.app(), FIRESTORE_DATABASE_ID);

// LINE secrets — 部署前需執行：
//   firebase functions:secrets:set LINE_CHANNEL_ID
//   firebase functions:secrets:set LINE_CHANNEL_SECRET
//   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
const LINE_CHANNEL_ID = defineSecret("LINE_CHANNEL_ID");
const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");

// LINE OAuth 預設回跳（可由前端參數覆寫，但須通過白名單）
const DEFAULT_LINE_REDIRECT_URL = "https://wenhuistage-ops.github.io/";

/**
 * 回跳網址白名單。前端可傳 redirectUrl，但只接受正式站與本機開發，
 * 避免攻擊者把 LINE authorization code 導向自己控制的已登記回跳頁（授權碼竊取）。
 * 不在白名單即回退為 DEFAULT_LINE_REDIRECT_URL。
 */
function safeRedirectUrl(url) {
  if (
    typeof url === "string" &&
    (url.startsWith("https://wenhuistage-ops.github.io") ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url))
  ) {
    return url;
  }
  return DEFAULT_LINE_REDIRECT_URL;
}

// 集合名稱常數（對應 GS/Constants.gs 的 SHEET_* 命名）
const COLLECTIONS = {
  EMPLOYEES: "employees",
  ATTENDANCE: "attendance",
  // 月度聚合 doc，每員工每月一筆 dailyStatus 物化視圖
  // 參考 docs/plans/Firestore-讀取最佳化-月度聚合計畫.md
  ATTENDANCE_MONTHLY: "attendanceMonthly",
  LOCATIONS: "locations",
  SESSIONS: "sessions",
  ONE_TIME_TOKENS: "oneTimeTokens",
  REVIEW_REQUESTS: "reviewRequests",
  NOTIFICATION_QUEUE: "notificationQueue",
};

// session 有效期（與 GS 保持一致）。可於需要時改由環境變數讀取。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// In-process verifySession 快取（同一容器內，TTL 60 秒）
//
// 為什麼：每個 Cloud Function call 都呼叫 verifySession，導致 sessions doc + employees doc
// 共 2 reads。短時間內同一 token 多次 call（admin 切月份、員工連點）會疊加。
// Cloud Functions 容器在活躍期會重複使用，module-level Map 可在請求間共享。
//
// 取捨：
//   - 員工權限變更（dept 改成/取消管理員、status 改未啟用）最多 60 秒後生效
//   - 容器冷啟時快取空的，第一次仍要 read
//   - 失敗結果也快取（避免 token 爆破測試燒 reads）
// 正向（成功）與負向（失敗）分開快取（L3）：
// 若共用一個 FIFO 上限，攻擊者丟大量偽 token 的失敗結果會把合法成功項擠出，
// 迫使合法使用者每次多付 2 次 reads。分離後失敗快取有獨立小容量與更短 TTL，
// 無法污染成功快取。
const SESSION_CACHE = new Map(); // 成功
const SESSION_NEG_CACHE = new Map(); // 失敗
const SESSION_CACHE_TTL_MS = 60 * 1000;
const SESSION_NEG_TTL_MS = 10 * 1000;
const SESSION_CACHE_MAX = 500;
const SESSION_NEG_MAX = 200;

function _capMap(map, max) {
  if (map.size > max) map.delete(map.keys().next().value); // FIFO 淘汰最舊
}

function setSessionCache(token, result) {
  if (result.ok) {
    SESSION_CACHE.set(token, { result, expiry: Date.now() + SESSION_CACHE_TTL_MS });
    _capMap(SESSION_CACHE, SESSION_CACHE_MAX);
  } else {
    SESSION_NEG_CACHE.set(token, { result, expiry: Date.now() + SESSION_NEG_TTL_MS });
    _capMap(SESSION_NEG_CACHE, SESSION_NEG_MAX);
  }
}

/**
 * 主動失效某員工的成功 session 快取（M1）。
 * setEmployeeStatus 降權/停用/離職後呼叫，讓權限變更盡快生效。
 * 注意：只清同一容器；跨容器仍需等 60 秒 TTL 過期（warm 容器的既有取捨）。
 */
function invalidateSessionCacheByUserId(userId) {
  for (const [token, entry] of SESSION_CACHE) {
    if (entry?.result?.user?.userId === userId) SESSION_CACHE.delete(token);
  }
}

/**
 * 驗證 session token，回傳員工資料或錯誤
 *
 * @param {string} sessionToken
 * @returns {Promise<{ ok: true, user: object } | { ok: false, code: string }>}
 */
async function verifySession(sessionToken) {
  if (!sessionToken) {
    return { ok: false, code: "ERR_SESSION_MISSING" };
  }

  // 命中快取直接回（省 2 reads）——成功或失敗快取皆檢查
  const cached = SESSION_CACHE.get(sessionToken) || SESSION_NEG_CACHE.get(sessionToken);
  if (cached && cached.expiry > Date.now()) {
    return cached.result;
  }

  const sessionSnap = await db
    .collection(COLLECTIONS.SESSIONS)
    .doc(sessionToken)
    .get();

  if (!sessionSnap.exists) {
    const result = { ok: false, code: "ERR_SESSION_INVALID" };
    setSessionCache(sessionToken, result);
    return result;
  }

  const session = sessionSnap.data();

  // 檢查過期
  const createdAt = session.createdAt?.toMillis?.() ?? session.createdAt ?? 0;
  if (createdAt > 0 && Date.now() - createdAt > SESSION_TTL_MS) {
    const result = { ok: false, code: "ERR_SESSION_EXPIRED" };
    setSessionCache(sessionToken, result);
    return result;
  }

  if (!session.userId) {
    const result = { ok: false, code: "ERR_SESSION_INVALID" };
    setSessionCache(sessionToken, result);
    return result;
  }

  const userSnap = await db
    .collection(COLLECTIONS.EMPLOYEES)
    .doc(session.userId)
    .get();

  if (!userSnap.exists) {
    const result = { ok: false, code: "ERR_USER_NOT_FOUND" };
    setSessionCache(sessionToken, result);
    return result;
  }

  const userData = userSnap.data();

  // 帳號狀態檢查：與 admin UI / 排程任務同一慣例——空值視為啟用（相容舊資料），
  // '未啟用'（新帳號待管理員啟用）/ '停用' / '已離職' 一律擋下。
  // 快取失敗結果，status 變更後最多 60 秒生效（見上方 SESSION_CACHE 註解）。
  if ((userData.status || "啟用") !== "啟用") {
    const result = { ok: false, code: "ERR_ACCOUNT_INACTIVE" };
    setSessionCache(sessionToken, result);
    return result;
  }

  const result = { ok: true, user: { userId: session.userId, ...userData } };
  setSessionCache(sessionToken, result);
  return result;
}

/**
 * 管理員身份檢查
 */
async function verifyAdmin(sessionToken) {
  const res = await verifySession(sessionToken);
  if (!res.ok) return res;
  if (res.user.dept !== "管理員") {
    return { ok: false, code: "ERR_NO_PERMISSION" };
  }
  return res;
}

// ===================================
// 輸入驗證
// ===================================

/**
 * 驗證月份參數格式（YYYY-MM）。
 * month 會被拼進 attendanceMonthly 的 doc id（`${userId}_${month}`），
 * 垃圾字串會產生垃圾聚合 doc、含 '/' 會直接 500，故所有接收 month 的端點都須先驗。
 */
function isValidMonth(month) {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/**
 * 驗證打卡/請假日期落在合理範圍。
 * 員工端 datetime/date 只驗 isNaN 不夠：new Date('+275760-09-13') 等極端日期可被解析，
 * 經 applyEventToMonthly 為任意遠期月份建立 attendanceMonthly 聚合 doc（每個新月 ~50 reads），
 * 可被腳本濫用灌爆讀取。限 2020-01-01 起、且不超過現在 +400 天。
 */
function isReasonableAttendanceDate(d) {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (isNaN(t)) return false;
  const MIN = Date.UTC(2020, 0, 1);
  const MAX = Date.now() + 400 * 24 * 60 * 60 * 1000;
  return t >= MIN && t <= MAX;
}

/**
 * 截斷自由文字欄位（note / reason 等）。
 * 無上限的字串會撐爆 attendanceMonthly 聚合 doc（Firestore 1MiB 上限），
 * 導致月曆 500 或聚合永久失效。500 字對正當用途綽綽有餘，靜默截斷即可。
 */
const MAX_TEXT_FIELD_CHARS = 500;
function clampText(value) {
  return String(value || "").slice(0, MAX_TEXT_FIELD_CHARS);
}

// ===================================
// 座標驗證與距離
// ===================================

function validateCoordinates(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (isNaN(latNum) || isNaN(lngNum)) {
    return { valid: false, error: "ERR_INVALID_COORDINATES" };
  }
  if (latNum < -90 || latNum > 90) {
    return { valid: false, error: "ERR_INVALID_LATITUDE" };
  }
  if (lngNum < -180 || lngNum > 180) {
    return { valid: false, error: "ERR_INVALID_LONGITUDE" };
  }
  return { valid: true, lat: latNum, lng: lngNum };
}

/**
 * Haversine 公式計算兩點距離（公尺）
 */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 地球半徑（公尺）
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 讀取所有地點（in-process cache，TTL 5 分鐘）
 *
 * 為什麼快取：每次打卡 + getLocations API 都會跑這個全 collection scan，
 * 但地點資料極少變動。容器活躍期共享 cache 可大幅省 reads。
 *
 * 取捨：addLocation 後其他 Cloud Function 容器最多 5 分鐘才看到新地點；
 * 地點變更頻率極低（年級），可接受。
 */
const LOCATIONS_CACHE_TTL_MS = 5 * 60 * 1000;
let _locationsCache = null; // { value, expiry }

async function getAllLocations() {
  if (_locationsCache && _locationsCache.expiry > Date.now()) {
    return _locationsCache.value;
  }

  const snap = await db.collection(COLLECTIONS.LOCATIONS).get();
  const value = snap.docs
    .map((doc) => ({
      name: String(doc.data().name || ""),
      lat: Number(doc.data().lat || 0),
      lng: Number(doc.data().lng || 0),
      radius: Number(doc.data().radius || 100),
    }))
    .filter(
      (loc) =>
        !isNaN(loc.lat) &&
        !isNaN(loc.lng) &&
        loc.lat >= -90 &&
        loc.lat <= 90 &&
        loc.lng >= -180 &&
        loc.lng <= 180
    );

  _locationsCache = { value, expiry: Date.now() + LOCATIONS_CACHE_TTL_MS };
  return value;
}

/**
 * 主動清除地點快取（addLocation 等 mutation 端使用）
 *
 * 注意：只清同一容器的 cache，跨容器仍要等 TTL 過期。
 */
function invalidateLocationsCache() {
  _locationsCache = null;
}

/**
 * 寫入或更新員工資料（對應 GS writeEmployee_）
 * @param {object} profile { userId, displayName, pictureUrl, email }
 */
async function upsertEmployee(profile) {
  const ref = db.collection(COLLECTIONS.EMPLOYEES).doc(profile.userId);
  const existing = await ref.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (existing.exists) {
    await ref.update({
      lastLoginTime: now,
      // 允許 LINE 顯示名/頭像更新
      name: profile.displayName || existing.data().name,
      picture: profile.pictureUrl || existing.data().picture,
      email: profile.email || existing.data().email || "",
    });
  } else {
    await ref.set({
      userId: profile.userId,
      email: profile.email || "",
      name: profile.displayName || "",
      picture: profile.pictureUrl || "",
      firstLoginTime: now,
      lastLoginTime: now,
      dept: "", // 預設空，由管理員設定
      salary: 0,
      leaveInsurance: "第2級",
      healthInsurance: "第2級",
      housingExpense: 1000,
      status: "未啟用", // 新員工預設未啟用
      preferredLanguage: "",
    });
  }
  return ref;
}

/**
 * 產生新的 session 直接寫入 sessions collection（對應 GS writeSession_ 的單階段流程）
 *
 * 注意：GS 的設計是 oneTimeToken 與 sessionToken 是同一個值（直接在 SHEET_SESSION 第 1 欄）。
 * 前端 LINE callback 拿到 sToken 後直接當 sessionToken 用，不會再呼叫 exchangeToken。
 * 故 getProfile 直接寫 sessions，回傳的 token 即為可用的 sessionToken。
 *
 * @returns {string} sessionToken（直接可用）
 */
async function createOneTimeToken(userId) {
  const sessionToken = db.collection(COLLECTIONS.SESSIONS).doc().id;
  await db.collection(COLLECTIONS.SESSIONS).doc(sessionToken).set({
    userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiredAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sessionToken;
}

/**
 * 一次性 token 換 sessionToken（對應 GS verifyOneTimeToken_）
 */
async function consumeOneTimeToken(oneTimeToken) {
  const ref = db.collection(COLLECTIONS.ONE_TIME_TOKENS).doc(oneTimeToken);
  const sessionToken = db.collection(COLLECTIONS.SESSIONS).doc().id;

  // 用 transaction 讓「檢查 used → 標記 used」原子化（L2）：
  // 原本 get 與 update 分離，兩個併發請求可同時通過 used 檢查各換一個 session，
  // 破壞一次性語意。交易內若 used 已被搶先標記則放棄。
  try {
    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const data = snap.data();
      if (data.used) return false;
      const expiredAt = data.expiredAt?.toMillis?.() ?? data.expiredAt ?? 0;
      if (expiredAt > 0 && Date.now() > expiredAt) return false;

      tx.set(db.collection(COLLECTIONS.SESSIONS).doc(sessionToken), {
        userId: data.userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiredAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      tx.update(ref, { used: true, consumedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    return ok ? sessionToken : null;
  } catch (err) {
    console.error("consumeOneTimeToken 交易失敗:", err?.message);
    return null;
  }
}

/**
 * 取得管理員清單（dept === '管理員'）— in-process cache，TTL 5 分鐘
 *
 * 為什麼快取：每次打卡 / 申請會 fire-and-forget notifyAdmins → getAdminList，
 * 短時間連續打卡會重複跑同一 query。
 *
 * 取捨：dept 變更後最多 5 分鐘才在通知端生效，可接受。
 *
 * @returns {Promise<Array<{userId, name, dept}>>}
 */
const ADMIN_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
let _adminListCache = null; // { value, expiry }

async function getAdminList() {
  if (_adminListCache && _adminListCache.expiry > Date.now()) {
    return _adminListCache.value;
  }
  const snap = await db
    .collection(COLLECTIONS.EMPLOYEES)
    .where("dept", "==", "管理員")
    .get();
  const value = snap.docs.map((doc) => ({
    userId: doc.id,
    name: doc.data().name || "",
    dept: doc.data().dept || "",
  }));
  _adminListCache = { value, expiry: Date.now() + ADMIN_LIST_CACHE_TTL_MS };
  return value;
}

function invalidateAdminListCache() {
  _adminListCache = null;
}

/**
 * 推送 LINE 訊息給單一使用者（對應 GS sendLinePushMessage）
 * @param {string} userId - LINE userId
 * @param {string} message - 訊息內容
 * @param {string} accessToken - LINE_CHANNEL_ACCESS_TOKEN.value()
 */
async function sendLinePush(userId, message, accessToken) {
  if (!accessToken) {
    console.warn("sendLinePush: LINE_CHANNEL_ACCESS_TOKEN 未設定");
    return { ok: false, msg: "TOKEN_MISSING" };
  }
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text: message }],
      }),
    });
    if (resp.ok) return { ok: true };
    const text = await resp.text();
    console.warn(`LINE push 失敗 ${userId}: ${resp.status} ${text}`);
    return { ok: false, status: resp.status, body: text };
  } catch (err) {
    console.error(`LINE push 例外 ${userId}:`, err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * 通知所有管理員（對應 GS notifyAdmins）
 * 異步發送，回傳成功 / 失敗計數
 *
 * 重要：呼叫端應「不 await」此函式（fire-and-forget），
 * 才能立即回應前端不阻塞。Cloud Function 會等所有非同步工作完成才結束實例，
 * 所以即使前端已收到回應，通知仍會送出。
 *
 * @param {string} message - 通知文字
 * @param {string} accessToken - LINE_CHANNEL_ACCESS_TOKEN.value()
 */
async function notifyAdmins(message, accessToken) {
  try {
    const admins = await getAdminList();
    if (admins.length === 0) {
      console.warn("notifyAdmins: 沒有管理員");
      return { ok: false, msg: "NO_ADMIN" };
    }
    const results = await Promise.all(
      admins.map((a) => sendLinePush(a.userId, message, accessToken))
    );
    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;
    console.log(`notifyAdmins: 成功 ${successCount} / 失敗 ${failCount}`);
    return { ok: successCount > 0, successCount, failCount };
  } catch (err) {
    console.error("notifyAdmins 例外:", err?.message);
    return { ok: false, error: err?.message };
  }
}

// Cloud Functions runtime 是 UTC，凡是要呈現給使用者（LINE 通知文字、管理員 UI）
// 的時間都需轉為 Asia/Taipei (UTC+8) 顯示，避免顯示成「少 8 小時」。
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
function toTaipei(date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS);
}
function formatTaipei(date, opts = {}) {
  if (!date) return "";
  const t = toTaipei(date);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  const h = String(t.getUTCHours()).padStart(2, "0");
  const mi = String(t.getUTCMinutes()).padStart(2, "0");
  if (opts.withSeconds) {
    const s = String(t.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${mi}:${s}`;
  }
  return `${y}-${m}-${day} ${h}:${mi}`;
}

module.exports = {
  admin,
  db,
  COLLECTIONS,
  SESSION_TTL_MS,
  DEFAULT_LINE_REDIRECT_URL,
  safeRedirectUrl,
  LINE_CHANNEL_ID,
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  verifySession,
  verifyAdmin,
  invalidateSessionCacheByUserId,
  isValidMonth,
  isReasonableAttendanceDate,
  clampText,
  validateCoordinates,
  getDistanceMeters,
  getAllLocations,
  invalidateLocationsCache,
  upsertEmployee,
  createOneTimeToken,
  consumeOneTimeToken,
  getAdminList,
  invalidateAdminListCache,
  sendLinePush,
  notifyAdmins,
  toTaipei,
  formatTaipei,
};
