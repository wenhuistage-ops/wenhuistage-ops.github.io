/**
 * deleteLocation — 刪除打卡地點（管理員專用）
 *
 * 對應前端：管理員「打卡管理」→ 現有打卡地點清單 →「刪除」
 *
 * 前端呼叫格式：
 *   callApifetch({ action: 'deleteLocation', id })
 *
 * 回傳：
 *   成功：{ ok: true, code: "MSG_LOCATION_DELETED" }
 *   失敗：{ ok: false, code: 'ERR_NO_PERMISSION' | 'ERR_MISSING_ID' | 'ERR_LOCATION_NOT_FOUND' }
 *
 * 既有 attendance 只存 locationName 字串、不參照 doc id，刪地點不影響歷史紀錄；
 * 只是員工之後無法再於此處打卡。刪完 bump meta/locations.version。
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const {
  db,
  COLLECTIONS,
  verifyAdmin,
  isValidDocId,
  bumpLocationsVersion,
  CORS_ORIGINS,
} = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: CORS_ORIGINS },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;

    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const docId = String(request.data?.id || "").trim();
    if (!docId || !isValidDocId(docId)) return { ok: false, code: "ERR_MISSING_ID" };

    const ref = db.collection(COLLECTIONS.LOCATIONS).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, code: "ERR_LOCATION_NOT_FOUND" };

    await ref.delete();
    await bumpLocationsVersion();

    return { ok: true, code: "MSG_LOCATION_DELETED", id: docId };
  }
);
