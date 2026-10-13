/**
 * updateLocation — 修改打卡地點（管理員專用）
 *
 * 對應前端：管理員「打卡管理」→ 現有打卡地點清單 →「修改」→ 表單帶入 →「儲存修改」
 *
 * 前端呼叫格式：
 *   callApifetch({ action: 'updateLocation', id, name, lat, lng, radius })
 *
 * 回傳：
 *   成功：{ ok: true, code: "MSG_LOCATION_UPDATED" }
 *   失敗：{ ok: false, code: 'ERR_NO_PERMISSION' | 'ERR_MISSING_ID' | 'ERR_LOCATION_NOT_FOUND'
 *                          | 'ERR_MISSING_NAME' | 'ERR_INVALID_*' | 'ERR_INVALID_RADIUS' }
 *
 * 驗證規則與 addLocation 完全相同（名稱長度、座標範圍、半徑 10–10000）。
 * 改完 bump meta/locations.version，getLocations / punch 下一次呼叫即讀到新資料。
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifyAdmin,
  isValidDocId,
  validateCoordinates,
  bumpLocationsVersion,
  clampText,
  CORS_ORIGINS,
} = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: CORS_ORIGINS },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { id, name, lat, lng, radius } = request.data || {};

    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const docId = String(id || "").trim();
    if (!docId || !isValidDocId(docId)) return { ok: false, code: "ERR_MISSING_ID" };

    const cleanName = clampText(name).trim();
    if (!cleanName) return { ok: false, code: "ERR_MISSING_NAME" };
    const validation = validateCoordinates(lat, lng);
    if (!validation.valid) return { ok: false, code: validation.error };

    const radiusNum = radius === undefined || radius === "" ? 100 : Number(radius);
    if (isNaN(radiusNum) || radiusNum < 10 || radiusNum > 10000) {
      return { ok: false, code: "ERR_INVALID_RADIUS", msg: "radius must be 10–10000 (meters)" };
    }

    const ref = db.collection(COLLECTIONS.LOCATIONS).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, code: "ERR_LOCATION_NOT_FOUND" };

    await ref.update({
      name: cleanName,
      lat: validation.lat,
      lng: validation.lng,
      radius: radiusNum,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.user.userId,
    });

    await bumpLocationsVersion();

    return { ok: true, code: "MSG_LOCATION_UPDATED", id: docId };
  }
);
