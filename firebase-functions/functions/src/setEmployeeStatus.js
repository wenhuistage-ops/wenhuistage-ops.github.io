/**
 * setEmployeeStatus — 切換員工的「管理員權限」「帳號啟用狀態」「離職」或「LINE 漏打卡提醒」
 *
 * 對應 employees/{userId} 的 dept / status / punchReminder 欄位
 *
 * 規則：
 *   - isAdmin / active / resign：必須是管理員 session，且不能改自己（避免自我鎖死）
 *   - punchReminder：管理員可改任何人；一般員工只能改「自己的」（自助開關）
 *   - field 白名單，避免任意覆寫敏感欄位
 *
 * 請求格式：
 *   { action, sessionToken, userId, field: 'isAdmin' | 'active' | 'resign' | 'punchReminder', value: boolean }
 *
 * 寫入：
 *   - field === 'isAdmin' && value === true  →  dept = '管理員'
 *   - field === 'isAdmin' && value === false →  dept = '一般員工'
 *   - field === 'active' && value === true   →  status = '啟用'
 *   - field === 'active' && value === false  →  status = '停用'
 *   - field === 'resign'                     →  status = '已離職'
 *   - field === 'punchReminder'              →  punchReminder = value（預設缺值 = 不提醒，opt-in）
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifySession,
  invalidateAdminListCache,
  invalidateSessionCacheByUserId,
  isValidDocId,
  CORS_ORIGINS,
} = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: CORS_ORIGINS,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const auth = await verifySession(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const data = request.data || {};
    const userId = String(data.userId || "").trim();
    const field = String(data.field || "");
    const value = data.value;

    if (!userId) {
      return { ok: false, code: "ERR_MISSING_USER_ID", msg: "userId required" };
    }
    // B-L9：userId 直接拼進 employees/{userId} 路徑，含 '/' 會拋錯 500
    if (!isValidDocId(userId)) {
      return { ok: false, code: "ERR_MISSING_USER_ID", msg: "userId 格式不正確" };
    }
    if (!["isAdmin", "active", "resign", "punchReminder"].includes(field)) {
      return {
        ok: false,
        code: "ERR_INVALID_FIELD",
        msg: "field must be 'isAdmin', 'active', 'resign', or 'punchReminder'",
      };
    }
    if (typeof value !== "boolean") {
      return { ok: false, code: "ERR_INVALID_VALUE", msg: "value must be boolean" };
    }
    // resign 是單向操作：只能設成 true（員工離職）；要回復請改用 field='active' value=true
    if (field === "resign" && value !== true) {
      return {
        ok: false,
        code: "ERR_INVALID_VALUE",
        msg: "resign can only be set to true; to reactivate use field='active' value=true",
      };
    }

    const isSelf = auth.user?.userId === userId;
    const isAdmin = auth.user?.dept === "管理員";

    // 一般員工只能改自己的「漏打卡提醒」；其他欄位或改別人一律要管理員
    if (!isAdmin && !(isSelf && field === "punchReminder")) {
      return { ok: false, code: "ERR_NO_PERMISSION" };
    }
    // 不能修改自己的權限/狀態（避免自我鎖死）；提醒開關除外
    if (isSelf && field !== "punchReminder") {
      return { ok: false, code: "ERR_CANNOT_MODIFY_SELF", msg: "cannot change your own admin/active status" };
    }

    // 確認目標員工存在
    const empRef = db.collection(COLLECTIONS.EMPLOYEES).doc(userId);
    const empSnap = await empRef.get();
    if (!empSnap.exists) {
      return { ok: false, code: "ERR_USER_NOT_FOUND", msg: "target employee not found" };
    }

    const update = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.user.userId,
    };

    if (field === "isAdmin") {
      update.dept = value ? "管理員" : "一般員工";
    } else if (field === "active") {
      update.status = value ? "啟用" : "停用";
      // 重新啟用時清掉 resignedAt（若有），避免狀態與時戳不一致
      if (value === true) {
        update.resignedAt = admin.firestore.FieldValue.delete();
      }
    } else if (field === "resign") {
      update.status = "已離職";
      update.resignedAt = admin.firestore.FieldValue.serverTimestamp();
    } else if (field === "punchReminder") {
      update.punchReminder = value;
    }

    await empRef.set(update, { merge: true });

    // M1：降權/停用/離職後主動清該員工的 session 快取，讓權限變更盡快生效，
    // 避免被降級者在 60 秒快取窗口內仍持舊管理員權（其他容器仍待 TTL）。
    // punchReminder 也清，讓 checkSession 立刻回傳新開關值。
    invalidateSessionCacheByUserId(userId);

    // 改 dept 會影響 getAdminList 結果，清同容器 cache（其他容器待 5 分鐘 TTL）
    if (field === "isAdmin") {
      invalidateAdminListCache();
    }

    return { ok: true, field, value, applied: update };
  }
);
