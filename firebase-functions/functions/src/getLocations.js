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
 * 2026-05-14：加入 in-process 5 分鐘 cache（與 punch.js 的 getAllLocations 並行）
 *   - 同容器活躍期 cache hit → 0 Firestore reads
 *   - 保留 doc.id（getAllLocations 沒給 id，前端 addLocation 操作會用到）
 *   - addLocation 端點之後若有寫入新地點，需呼叫 _cache=null 清此 cache
 */

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifySession, invalidateLocationsCache } = require("./_helpers");

// in-process cache（5 分鐘 TTL）
const LOCATIONS_CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null; // { value, expiry }

async function _getCachedLocations() {
  if (_cache && _cache.expiry > Date.now()) {
    return { value: _cache.value, fromCache: true };
  }
  const snap = await db.collection(COLLECTIONS.LOCATIONS).get();
  const value = snap.docs.map((doc) => {
    const d = doc.data();
    const r = Number(d.radius || 100);
    return {
      id: doc.id,
      name: d.name || "",
      lat: Number(d.lat || 0),
      lng: Number(d.lng || 0),
      scope: r,
      radius: r,
    };
  });
  _cache = { value, expiry: Date.now() + LOCATIONS_CACHE_TTL_MS };
  return { value, fromCache: false, reads: snap.size };
}

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

    const cached = await _getCachedLocations();
    if (cached.fromCache) {
      console.log(`[reads] getLocations reads=0 (cache hit)`);
    } else {
      console.log(`[reads] getLocations reads=${cached.reads} (cache miss → refilled)`);
      // 順便清 _helpers.getAllLocations 的 cache，避免新增地點時兩邊不同步
      invalidateLocationsCache();
    }

    return { ok: true, locations: cached.value };
  }
);

// 暴露 cache 清除 hook（給 addLocation 等 mutation 端點可主動清除）
module.exports.invalidateLocalCache = () => { _cache = null; };
