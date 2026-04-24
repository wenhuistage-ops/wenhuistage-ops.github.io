/**
 * 共用 helper
 *
 * - Firebase Admin 單例初始化
 * - session token 驗證（對應 GS checkSession_）
 * - 統一回應格式
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// 集合名稱常數（對應 GS/Constants.gs 的 SHEET_* 命名）
const COLLECTIONS = {
  EMPLOYEES: "employees",
  ATTENDANCE: "attendance",
  LOCATIONS: "locations",
  SESSIONS: "sessions",
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

module.exports = {
  admin,
  db,
  COLLECTIONS,
  SESSION_TTL_MS,
  verifySession,
  verifyAdmin,
};
