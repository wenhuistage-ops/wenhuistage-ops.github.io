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
const { defineSecret } = require("firebase-functions/params");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// LINE secrets — 部署前需執行：
//   firebase functions:secrets:set LINE_CHANNEL_ID
//   firebase functions:secrets:set LINE_CHANNEL_SECRET
//   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
const LINE_CHANNEL_ID = defineSecret("LINE_CHANNEL_ID");
const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");

// LINE OAuth 預設回跳（可由前端參數覆寫）
const DEFAULT_LINE_REDIRECT_URL = "https://wenhuistage-ops.github.io/";

// 集合名稱常數（對應 GS/Constants.gs 的 SHEET_* 命名）
const COLLECTIONS = {
  EMPLOYEES: "employees",
  ATTENDANCE: "attendance",
  LOCATIONS: "locations",
  SESSIONS: "sessions",
  ONE_TIME_TOKENS: "oneTimeTokens",
  REVIEW_REQUESTS: "reviewRequests",
  NOTIFICATION_QUEUE: "notificationQueue",
};

// session 有效期（與 GS 保持一致）。可於需要時改由環境變數讀取。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

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

  const sessionSnap = await db
    .collection(COLLECTIONS.SESSIONS)
    .doc(sessionToken)
    .get();

  if (!sessionSnap.exists) {
    return { ok: false, code: "ERR_SESSION_INVALID" };
  }

  const session = sessionSnap.data();

  // 檢查過期
  const createdAt = session.createdAt?.toMillis?.() ?? session.createdAt ?? 0;
  if (createdAt > 0 && Date.now() - createdAt > SESSION_TTL_MS) {
    return { ok: false, code: "ERR_SESSION_EXPIRED" };
  }

  if (!session.userId) {
    return { ok: false, code: "ERR_SESSION_INVALID" };
  }

  const userSnap = await db
    .collection(COLLECTIONS.EMPLOYEES)
    .doc(session.userId)
    .get();

  if (!userSnap.exists) {
    return { ok: false, code: "ERR_USER_NOT_FOUND" };
  }

  return { ok: true, user: { userId: session.userId, ...userSnap.data() } };
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
 * 讀取所有地點（未含快取，v1 簡化；之後可加 in-memory cache）
 */
async function getAllLocations() {
  const snap = await db.collection(COLLECTIONS.LOCATIONS).get();
  return snap.docs
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
 * 產生新的 session 文件（對應 GS writeSession_ 的一次性 token 邏輯）
 * @returns {string} oneTimeToken
 */
async function createOneTimeToken(userId) {
  const oneTimeToken = db.collection(COLLECTIONS.ONE_TIME_TOKENS).doc().id; // 用 Firestore doc id 作 token
  await db.collection(COLLECTIONS.ONE_TIME_TOKENS).doc(oneTimeToken).set({
    userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiredAt: new Date(Date.now() + SESSION_TTL_MS),
    used: false,
  });
  return oneTimeToken;
}

/**
 * 一次性 token 換 sessionToken（對應 GS verifyOneTimeToken_）
 */
async function consumeOneTimeToken(oneTimeToken) {
  const ref = db.collection(COLLECTIONS.ONE_TIME_TOKENS).doc(oneTimeToken);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.used) return null;

  const expiredAt = data.expiredAt?.toMillis?.() ?? data.expiredAt ?? 0;
  if (expiredAt > 0 && Date.now() > expiredAt) return null;

  const sessionToken = db.collection(COLLECTIONS.SESSIONS).doc().id;
  await db.collection(COLLECTIONS.SESSIONS).doc(sessionToken).set({
    userId: data.userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiredAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await ref.update({ used: true, consumedAt: admin.firestore.FieldValue.serverTimestamp() });
  return sessionToken;
}

module.exports = {
  admin,
  db,
  COLLECTIONS,
  SESSION_TTL_MS,
  DEFAULT_LINE_REDIRECT_URL,
  LINE_CHANNEL_ID,
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  verifySession,
  verifyAdmin,
  validateCoordinates,
  getDistanceMeters,
  getAllLocations,
  upsertEmployee,
  createOneTimeToken,
  consumeOneTimeToken,
};
