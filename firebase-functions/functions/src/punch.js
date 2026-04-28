/**
 * punch — 員工打卡
 *
 * 對應 GS：Handlers.gs handlePunch + DbOperations.gs punch（勞基法邏輯）
 *
 * 前端呼叫：
 *   callApifetch({ action: 'punch', type, lat, lng, note })
 *
 * 流程：
 *   1. 驗 sessionToken → user
 *   2. 驗座標合法性
 *   3. 查所有打卡地點，找最近 & 在半徑內的那個
 *   4. 寫入 attendance 文件
 *
 * 回傳：
 *   成功：{ ok: true, code: "PUNCH_SUCCESS", params: { type }, backend_timings }
 *   失敗：
 *     - { ok: false, code: "ERR_SESSION_INVALID" | "ERR_INVALID_COORDINATES" | ... }
 *     - { ok: false, code: "ERR_OUT_OF_RANGE_WITH_DISTANCE", params: { distance, location, radius } }
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifySession,
  validateCoordinates,
  getDistanceMeters,
  getAllLocations,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate } = require("./_attendance");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const t0 = Date.now();
    const timings = {};

    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { type, lat, lng, note } = request.data || {};

    // 1. 驗 session
    const t1 = Date.now();
    const sessionRes = await verifySession(sessionToken);
    timings.session = Date.now() - t1;
    if (!sessionRes.ok) {
      return { ok: false, code: sessionRes.code };
    }
    const user = sessionRes.user;

    // 2. 驗座標
    const t2 = Date.now();
    const validation = validateCoordinates(lat, lng);
    timings.validate = Date.now() - t2;
    if (!validation.valid) {
      return { ok: false, code: validation.error };
    }
    const latNum = validation.lat;
    const lngNum = validation.lng;

    // 3. 查地點 + 距離
    const t3 = Date.now();
    const locations = await getAllLocations();
    timings.locations = Date.now() - t3;

    const t4 = Date.now();
    let locationName = null;
    let minDistance = Infinity;
    let bestLocation = null;

    for (const loc of locations) {
      const dist = getDistanceMeters(latNum, lngNum, loc.lat, loc.lng);
      if (dist < minDistance) {
        minDistance = dist;
        bestLocation = { name: loc.name, distance: dist, radius: loc.radius };
      }
      if (dist <= loc.radius) {
        locationName = loc.name;
        break;
      }
    }
    timings.distance = Date.now() - t4;

    if (!locationName) {
      if (bestLocation) {
        return {
          ok: false,
          code: "ERR_OUT_OF_RANGE_WITH_DISTANCE",
          params: {
            distance: Math.round(bestLocation.distance),
            location: bestLocation.name,
            radius: bestLocation.radius,
          },
        };
      }
      return { ok: false, code: "ERR_OUT_OF_RANGE" };
    }

    // 4. 寫入 attendance
    const t5 = Date.now();
    const now = new Date();
    const docRef = await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(now),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type: type || "",
      coords: `(${latNum},${lngNum})`,
      lat: latNum,
      lng: lngNum,
      locationName,
      note: note || "",
      audit: "",
      adjustmentType: "", // 補打卡類型，空白代表正常打卡
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // 同容器月度 cache 立即清掉，跨容器仰賴 5 分鐘 TTL
    invalidateMonthlyCacheForDate(now, user.userId);
    timings.append = Date.now() - t5;

    const totalTime = Date.now() - t0;
    console.log(`✅ 打卡完成 - 後端耗時: ${totalTime}ms (docId=${docRef.id})`);

    return {
      ok: true,
      code: "PUNCH_SUCCESS",
      params: { type: type || "" },
      backend_timings: {
        total: String(totalTime),
        session: String(timings.session),
        validate: String(timings.validate),
        locations: String(timings.locations),
        distance: String(timings.distance),
        append: String(timings.append),
      },
    };
  }
);
