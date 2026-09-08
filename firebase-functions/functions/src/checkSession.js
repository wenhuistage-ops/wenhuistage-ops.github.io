/**
 * checkSession — 驗證 sessionToken 並回傳員工資訊
 *
 * 對應 GS：Handlers.gs handleCheckSession + DbOperations.gs checkSession_
 *
 * 前端呼叫格式：
 *   callApifetch({ action: 'checkSession' })
 *   → httpsCallable(functions, 'checkSession')({ sessionToken })
 *
 * 回傳：
 *   成功：{ ok: true, user: { userId, name, picture, dept, ... } }
 *   失敗：{ ok: false, code: 'ERR_SESSION_INVALID' | ... }
 */

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifySession } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const result = await verifySession(sessionToken);

    if (!result.ok) {
      return { ok: false, code: result.code };
    }

    // 與 GS 版本格式對齊：不回傳完整 internal 欄位
    const { userId, name, displayName, picture, pictureUrl, dept, punchReminder } = result.user;

    // 同步介面語言到 employees.preferredLanguage（LINE 漏打卡提醒依此選語言）。
    // 只在有變動時寫入；verifySession 的快取物件一併更新，60 秒內不會重複寫。
    const language = request.data?.language;
    if (
      typeof language === "string" &&
      /^[a-z]{2}(-[A-Z]{2})?$/.test(language) &&
      language !== result.user.preferredLanguage
    ) {
      try {
        await db.collection(COLLECTIONS.EMPLOYEES).doc(userId).update({ preferredLanguage: language });
        result.user.preferredLanguage = language;
      } catch (err) {
        console.warn("preferredLanguage 更新失敗:", err?.message);
      }
    }

    return {
      ok: true,
      user: {
        userId,
        name: name || displayName || "",
        picture: picture || pictureUrl || "",
        dept: dept || "員工",
        punchReminder: punchReminder === true, // 員工端自助開關的初始值
      },
    };
  }
);
