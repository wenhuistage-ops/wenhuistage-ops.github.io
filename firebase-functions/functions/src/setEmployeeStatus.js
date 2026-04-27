/**
 * setEmployeeStatus — 切換員工的「管理員權限」或「帳號啟用狀態」
 *
 * 對應 employees/{userId} 的 dept / status 欄位（管理員 dashboard toggle 兩顆按鈕）
 *
 * 規則：
 *   - 必須是管理員 session
 *   - 不能把自己「降級」（避免管理員把自己變一般員工後沒人能改回來）
 *   - 不能把自己「停用」
 *   - field 限定 'isAdmin' 或 'active'，避免任意覆寫敏感欄位
 *
 * 請求格式：
 *   { action, sessionToken, userId, field: 'isAdmin' | 'active', value: boolean }
 *
 * 寫入：
 *   - field === 'isAdmin' && value === true  →  dept = '管理員'
 *   - field === 'isAdmin' && value === false →  dept = '一般員工'
 *   - field === 'active' && value === true   →  status = '啟用'
 *   - field === 'active' && value === false  →  status = '停用'
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifyAdmin, invalidateAdminListCache } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const data = request.data || {};
    const userId = String(data.userId || "").trim();
    const field = String(data.field || "");
    const value = data.value;

    if (!userId) {
      return { ok: false, code: "ERR_MISSING_USER_ID", msg: "userId required" };
    }
    if (!["isAdmin", "active"].includes(field)) {
      return { ok: false, code: "ERR_INVALID_FIELD", msg: "field must be 'isAdmin' or 'active'" };
    }
    if (typeof value !== "boolean") {
      return { ok: false, code: "ERR_INVALID_VALUE", msg: "value must be boolean" };
    }

    // 不能修改自己（避免自我鎖死）
    if (auth.user?.userId && userId === auth.user.userId) {
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
    }

    await empRef.set(update, { merge: true });

    // 改 dept 會影響 getAdminList 結果，清同容器 cache（其他容器待 5 分鐘 TTL）
    if (field === "isAdmin") {
      invalidateAdminListCache();
    }

    return { ok: true, field, value, applied: update };
  }
);
