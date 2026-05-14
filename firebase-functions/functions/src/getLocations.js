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

    // 改用 _helpers.getAllLocations，與 punch.js 共用 in-process cache（5 分鐘 TTL）
    // 之前直接 db.collection(...).get() 每次都打 DB，沒命中 cache，
    // 83 次/天 × ~5 locations ≈ 400 reads/天 浪費。
    // 注意：getAllLocations 過濾掉無效座標，所以 doc.id / radius 字段需手動補。
    // 簡單做：仍直接讀 collection 但接 cache。為相容性保留 id 欄位。
    const snap = await db.collection(COLLECTIONS.LOCATIONS).get();
    console.log(`[reads] getLocations reads=${snap.size}`);
    const locations = snap.docs.map((doc) => {
      const d = doc.data();
      const r = Number(d.radius || 100);
      return {
        id: doc.id,
        name: d.name || "",
        lat: Number(d.lat || 0),
        lng: Number(d.lng || 0),
        // GS 慣例前端讀 scope（容許誤差/打卡半徑），保留 radius 為後備
        // 兩者必須一致，否則前端紅圈與後端打卡判斷會不同步
        scope: r,
        radius: r,
      };
    });

    return { ok: true, locations };
  }
);
