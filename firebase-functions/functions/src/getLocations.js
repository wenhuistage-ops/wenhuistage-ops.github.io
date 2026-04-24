/**
 * getLocations — 讀取所有打卡地點
 *
 * 對應 GS：Handlers.gs handleGetLocation + DbOperations.gs getLocationsCached
 *
 * 前端呼叫：
 *   callApifetch({ action: 'getLocations' })
 *   → httpsCallable(functions, 'getLocations')({ sessionToken })
 *
 * 回傳：
 *   成功：{ ok: true, locations: [{ name, lat, lng, radius }, ...] }
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

    // 驗 session（不論員工或管理員都可查地點）
    const session = await verifySession(sessionToken);
    if (!session.ok) {
      return { ok: false, code: session.code };
    }

    const snap = await db.collection(COLLECTIONS.LOCATIONS).get();
    const locations = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        name: d.name || "",
        lat: Number(d.lat || 0),
        lng: Number(d.lng || 0),
        radius: Number(d.radius || 100),
      };
    });

    return { ok: true, locations };
  }
);
