/**
 * addLocation — 新增打卡地點（管理員專用）
 * 對應 GS：Handlers.gs handleAddLocation + DbOperations.gs addLocation
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifyAdmin, validateCoordinates, invalidateLocationsCache } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { name, lat, lng, radius } = request.data || {};

    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    if (!name) return { ok: false, code: "ERR_MISSING_NAME" };
    const validation = validateCoordinates(lat, lng);
    if (!validation.valid) return { ok: false, code: validation.error };

    const ref = await db.collection(COLLECTIONS.LOCATIONS).add({
      name: String(name).trim(),
      lat: validation.lat,
      lng: validation.lng,
      radius: Number(radius || 100),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.user.userId,
    });

    // 同容器 cache 立即清掉；其他容器最多 5 分鐘 TTL 後生效
    invalidateLocationsCache();

    return { ok: true, code: "新增地點成功", id: ref.id };
  }
);
