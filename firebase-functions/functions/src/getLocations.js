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
 *   成功：{ ok: true, locations: [{ id, name, lat, lng, scope, radius }, ...] }
 *   失敗：{ ok: false, code: 'ERR_SESSION_INVALID' | ... }
 *
 * 快取：共用 _helpers.getAllLocations（in-process cache + meta/locations 版本戳）。
 *   原本這裡自己再養一份 5 分鐘 cache，addLocation 清不到它（不同實例），
 *   新增地點後地圖上要等很久才看得到；現在每次只多 1 read 讀版本戳。
 */

const { onCall } = require("firebase-functions/v2/https");
const { CORS_ORIGINS, verifySession, getAllLocations } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: CORS_ORIGINS,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;

    // 驗 session（不論員工或管理員都可查地點）
    const session = await verifySession(sessionToken);
    if (!session.ok) {
      return { ok: false, code: session.code };
    }

    const locations = (await getAllLocations()).map((loc) => ({
      id: loc.id,
      name: loc.name,
      lat: loc.lat,
      lng: loc.lng,
      scope: loc.radius, // 前端 location.js 讀 scope 畫圓
      radius: loc.radius,
    }));

    return { ok: true, locations };
  }
);
